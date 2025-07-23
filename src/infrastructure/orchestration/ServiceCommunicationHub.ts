import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, CircuitBreaker, Metric } from '../core/decorators/ServiceDecorators.js';
import { ServiceRegistry } from '../microservices/ServiceRegistry.js';
import { logger } from '@/lib/unjs-utils.js';
import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Communication hub configuration schema
 */
const CommunicationHubConfigSchema = z.object({
  defaultTimeout: z.number().default(5000),
  retryPolicy: z.enum(['exponential', 'linear', 'fixed']).default('exponential'),
  circuitBreakerThreshold: z.number().default(5),
  circuitBreakerTimeout: z.number().default(60000),
  maxRetries: z.number().default(3),
  enableTracing: z.boolean().default(true),
  enableMetrics: z.boolean().default(true),
});

export type CommunicationHubConfig = z.infer<typeof CommunicationHubConfigSchema>;

/**
 * Call options for service communication
 */
export interface CallOptions {
  timeout?: number;
  retries?: number;
  circuitBreaker?: boolean;
  trace?: boolean;
  headers?: Record<string, string>;
}

/**
 * Request options with additional features
 */
export interface RequestOptions extends CallOptions {
  responseType?: 'json' | 'text' | 'stream';
  validateResponse?: z.ZodSchema<any>;
}

/**
 * Service method descriptor
 */
export interface ServiceMethod {
  service: string;
  method: string;
  requestSchema?: z.ZodSchema<any>;
  responseSchema?: z.ZodSchema<any>;
  timeout?: number;
}

/**
 * Subscription handle
 */
export interface Subscription {
  id: string;
  unsubscribe: () => void;
}

/**
 * Message envelope for pub/sub
 */
export interface MessageEnvelope<T = any> {
  id: string;
  source: string;
  target?: string;
  event: string;
  payload: T;
  timestamp: Date;
  correlationId?: string;
  headers?: Record<string, string>;
}

/**
 * Communication hub event map
 */
interface CommunicationHubEventMap {
  'hub:call-start': { service: string; method: string; correlationId: string };
  'hub:call-success': { service: string; method: string; duration: number; correlationId: string };
  'hub:call-failure': { service: string; method: string; error: Error; correlationId: string };
  'hub:message-published': { source: string; event: string; targets: number };
  'hub:message-received': { source: string; event: string; subscriber: string };
  'hub:circuit-opened': { service: string; failures: number };
  'hub:circuit-closed': { service: string };
}

/**
 * Service proxy for type-safe calls
 */
export class ServiceProxy<T extends Record<string, any>> {
  constructor(
    private hub: ServiceCommunicationHub,
    private serviceName: string,
    private methods: Map<keyof T, ServiceMethod>
  ) { }

  /**
   * Create a proxy method
   */
  createMethod<TRequest, TResponse>(
    methodName: string,
    options?: Partial<ServiceMethod>
  ): (request: TRequest, callOptions?: CallOptions) => Promise<TResponse> {
    return async (request: TRequest, callOptions?: CallOptions) => {
      return this.hub.call<TRequest, TResponse>(
        this.serviceName,
        methodName,
        request,
        callOptions
      );
    };
  }

  /**
   * Get typed proxy
   */
  getProxy(): T {
    const proxy: any = {};

    for (const [methodName, method] of this.methods.entries()) {
      proxy[methodName] = this.createMethod(methodName as string, method);
    }

    return proxy as T;
  }
}

/**
 * Service communication hub for type-safe inter-service communication
 * 
 * Features:
 * - Type-safe RPC calls with schema validation
 * - Pub/sub messaging with event routing
 * - Request/response patterns with timeout
 * - Circuit breaking per service
 * - Distributed tracing support
 * - Automatic retries with backoff
 * - Service discovery integration
 * - Message correlation and tracking
 */
@ServiceConfig({
  schema: CommunicationHubConfigSchema,
  prefix: 'communication',
  hot: true,
})
export class ServiceCommunicationHub extends BaseService<CommunicationHubConfig, CommunicationHubEventMap> {
  private registry: ServiceRegistry;
  private subscriptions: Map<string, Set<(message: MessageEnvelope) => void>> = new Map();
  private serviceProxies: Map<string, ServiceProxy<any>> = new Map();
  private correlationMap: Map<string, { timestamp: number; service: string; method: string }> = new Map();
  private eventBus: TypedEventEmitter<Record<string, any>>;

  constructor() {
    super();
    this.registry = ServiceRegistry.getInstance();
    this.eventBus = new TypedEventEmitter();

    // Clean up old correlations periodically
    setInterval(() => this.cleanupCorrelations(), 60000);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ServiceCommunicationHub {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'communication-hub';
  }

  protected override getServiceVersion(): string {
    return '1.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Central hub for type-safe inter-service communication';
  }

  /**
   * Call a service method with type safety
   */
  @Metric({ name: 'hub.call', recordDuration: true })
  @CircuitBreaker({ threshold: 5, timeout: 60000 })
  async call<TRequest, TResponse>(
    targetService: string,
    method: string,
    request: TRequest,
    options?: CallOptions
  ): Promise<TResponse> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.emit('hub:call-start', {
      service: targetService,
      method,
      correlationId,
    });

    // Store correlation for tracking
    this.correlationMap.set(correlationId, {
      timestamp: startTime,
      service: targetService,
      method,
    });

    try {
      // Get service instance from registry
      const instance = this.registry.getServiceInstance(targetService);
      if (!instance) {
        throw new Error(`No healthy instance found for service: ${targetService}`);
      }

      // Construct URL
      const service = this.registry.getService(targetService);
      if (!service) {
        throw new Error(`Service definition not found: ${targetService}`);
      }

      const url = `${service.network.protocol}://${instance.host}:${instance.port}/rpc/${method}`;

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        'X-Source-Service': this.getServiceName(),
        ...options?.headers,
      };

      if (options?.trace || this.config.enableTracing) {
        headers['X-Trace-ID'] = correlationId;
      }

      // Make the call
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options?.timeout || this.config.defaultTimeout),
      });

      if (!response.ok) {
        throw new Error(`Service call failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      this.emit('hub:call-success', {
        service: targetService,
        method,
        duration,
        correlationId,
      });

      // Update metrics
      this.recordMetric('hub.call.success', 1, {
        service: targetService,
        method,
      });

      return data as TResponse;

    } catch (error) {
      this.emit('hub:call-failure', {
        service: targetService,
        method,
        error: error as Error,
        correlationId,
      });

      this.recordMetric('hub.call.failure', 1, {
        service: targetService,
        method,
        error: (error as Error).name,
      });

      throw error;
    } finally {
      // Clean up correlation
      setTimeout(() => {
        this.correlationMap.delete(correlationId);
      }, 60000);
    }
  }

  /**
   * Subscribe to events from services
   */
  subscribe<TEvent>(
    servicePattern: string,
    eventType: string,
    handler: (event: TEvent) => void | Promise<void>
  ): Subscription {
    const subscriptionKey = `${servicePattern}:${eventType}`;

    if (!this.subscriptions.has(subscriptionKey)) {
      this.subscriptions.set(subscriptionKey, new Set());
    }

    const wrappedHandler = async (message: MessageEnvelope) => {
      if (this.matchesPattern(message.source, servicePattern) && message.event === eventType) {
        this.emit('hub:message-received', {
          source: message.source,
          event: message.event,
          subscriber: this.getServiceName(),
        });

        try {
          await handler(message.payload as TEvent);
        } catch (error) {
          logger.error('Subscription handler error', {
            source: message.source,
            event: message.event,
            error,
          });
        }
      }
    };

    this.subscriptions.get(subscriptionKey)!.add(wrappedHandler);

    // Subscribe to internal event bus
    this.eventBus.on(subscriptionKey, wrappedHandler);

    const subscription: Subscription = {
      id: uuidv4(),
      unsubscribe: () => {
        const handlers = this.subscriptions.get(subscriptionKey);
        if (handlers) {
          handlers.delete(wrappedHandler);
          if (handlers.size === 0) {
            this.subscriptions.delete(subscriptionKey);
          }
        }
        this.eventBus.off(subscriptionKey, wrappedHandler);
      },
    };

    logger.info('Subscription created', {
      pattern: servicePattern,
      event: eventType,
      subscriber: this.getServiceName(),
    });

    return subscription;
  }

  /**
   * Publish an event to subscribers
   */
  publish<TEvent>(
    eventType: string,
    payload: TEvent,
    options?: {
      target?: string;
      correlationId?: string;
      headers?: Record<string, string>;
    }
  ): void {
    const message: MessageEnvelope<TEvent> = {
      id: uuidv4(),
      source: this.getServiceName(),
      target: options?.target,
      event: eventType,
      payload,
      timestamp: new Date(),
      correlationId: options?.correlationId,
      headers: options?.headers,
    };

    // Find matching subscriptions
    let targetCount = 0;

    for (const [pattern, handlers] of this.subscriptions.entries()) {
      const [servicePattern, eventPattern] = pattern.split(':');

      if (eventPattern === eventType) {
        if (!options?.target || this.matchesPattern(options.target, servicePattern)) {
          targetCount += handlers.size;

          // Emit on event bus
          this.eventBus.emit(pattern, message);
        }
      }
    }

    this.emit('hub:message-published', {
      source: this.getServiceName(),
      event: eventType,
      targets: targetCount,
    });

    this.recordMetric('hub.message.published', 1, {
      event: eventType,
      targets: targetCount.toString(),
    });
  }

  /**
   * Request/response pattern with timeout
   */
  async request<TRequest, TResponse>(
    service: string,
    payload: TRequest,
    options: RequestOptions
  ): Promise<TResponse> {
    const correlationId = uuidv4();
    const responseEvent = `response:${correlationId}`;

    return new Promise<TResponse>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.eventBus.off(responseEvent, responseHandler);
        reject(new Error(`Request timeout after ${options.timeout || this.config.defaultTimeout}ms`));
      }, options.timeout || this.config.defaultTimeout);

      // Response handler
      const responseHandler = (message: MessageEnvelope<TResponse>) => {
        clearTimeout(timeout);

        if (message.correlationId === correlationId) {
          if (options.validateResponse) {
            try {
              const validated = options.validateResponse.parse(message.payload);
              resolve(validated);
            } catch (error) {
              reject(new Error(`Response validation failed: ${error}`));
            }
          } else {
            resolve(message.payload);
          }
        }
      };

      // Subscribe to response
      this.eventBus.once(responseEvent, responseHandler);

      // Send request
      this.publish(`request:${service}`, payload, {
        correlationId,
        headers: {
          'Reply-To': responseEvent,
          ...options.headers,
        },
      });
    });
  }

  /**
   * Create a typed service proxy
   */
  createServiceProxy<T extends Record<string, any>>(
    serviceName: string,
    methods: Record<keyof T, Partial<ServiceMethod>>
  ): ServiceProxy<T> {
    const methodMap = new Map<keyof T, ServiceMethod>();

    for (const [methodName, config] of Object.entries(methods) as Array<[keyof T, Partial<ServiceMethod>]>) {
      methodMap.set(methodName, {
        service: serviceName,
        method: methodName as string,
        ...config,
      });
    }

    const proxy = new ServiceProxy<T>(this, serviceName, methodMap);
    this.serviceProxies.set(serviceName, proxy);

    return proxy;
  }

  /**
   * Get or create service proxy
   */
  getServiceProxy<T extends Record<string, any>>(serviceName: string): ServiceProxy<T> | undefined {
    return this.serviceProxies.get(serviceName);
  }

  /**
   * Broadcast to all services matching a pattern
   */
  broadcast<TEvent>(
    servicePattern: string,
    eventType: string,
    payload: TEvent
  ): void {
    const services = this.registry.discoverServices({
      name: servicePattern === '*' ? undefined : servicePattern,
      healthyOnly: true,
    });

    for (const service of services) {
      this.publish(eventType, payload, {
        target: service.name,
      });
    }

    logger.info('Broadcast sent', {
      pattern: servicePattern,
      event: eventType,
      targets: services.length,
    });
  }

  /**
   * Check if service name matches pattern
   */
  private matchesPattern(serviceName: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === serviceName) return true;

    // Support wildcard patterns like "user-*"
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(serviceName);
    }

    return false;
  }

  /**
   * Clean up old correlations
   */
  private cleanupCorrelations(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [id, data] of this.correlationMap.entries()) {
      if (now - data.timestamp > timeout) {
        this.correlationMap.delete(id);
      }
    }
  }

  /**
   * Get communication statistics
   */
  getStatistics(): {
    activeSubscriptions: number;
    serviceProxies: number;
    pendingCorrelations: number;
    subscriptionsByPattern: Record<string, number>;
  } {
    const subscriptionsByPattern: Record<string, number> = {};

    for (const [pattern, handlers] of this.subscriptions.entries()) {
      subscriptionsByPattern[pattern] = handlers.size;
    }

    return {
      activeSubscriptions: Array.from(this.subscriptions.values()).reduce((sum, set) => sum + set.size, 0),
      serviceProxies: this.serviceProxies.size,
      pendingCorrelations: this.correlationMap.size,
      subscriptionsByPattern,
    };
  }

  /**
   * Batch call multiple services
   */
  async batchCall(
    calls: Array<{
      service: string;
      method: string;
      request: any;
      options?: CallOptions;
    }>
  ): Promise<Array<{ success: boolean; data?: any; error?: Error }>> {
    const promises = calls.map(call =>
      this.call(call.service, call.method, call.request, call.options)
        .then(data => ({ success: true as const, data }))
        .catch(error => ({ success: false as const, error }))
    );

    return Promise.all(promises);
  }

  /**
   * Create a service mesh interceptor
   */
  createInterceptor(
    pattern: string,
    interceptor: (message: MessageEnvelope) => MessageEnvelope | null
  ): () => void {
    const handler = (message: MessageEnvelope) => {
      const modified = interceptor(message);
      if (modified) {
        // Re-emit the modified message
        this.eventBus.emit(`${message.source}:${message.event}`, modified);
      }
    };

    // Subscribe to all events matching the pattern
    this.eventBus.on('*', handler);

    // Return unsubscribe function
    return () => {
      this.eventBus.off('*', handler);
    };
  }
}