import { EnhancedServiceRegistry } from './ServiceRegistry.enhanced.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';
import { BaseService, BaseAsyncService } from './BaseService.js';

export interface ServiceMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'event' | 'broadcast';
  method?: string;
  payload: any;
  timestamp: Date;
  correlationId?: string;
  replyTo?: string;
  timeout?: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  nextAttempt?: Date;
}

export interface LoadBalancerConfig {
  strategy: 'round-robin' | 'least-connections' | 'random' | 'weighted';
  weights?: Map<string, number>;
  healthCheck: boolean;
}

interface CommunicationHubEventMap {
  'message:sent': {
    message: ServiceMessage;
    target: string;
  };
  'message:received': {
    message: ServiceMessage;
    source: string;
  };
  'message:failed': {
    message: ServiceMessage;
    error: Error;
  };
  'circuit-breaker:opened': {
    service: string;
    failureCount: number;
  };
  'circuit-breaker:closed': {
    service: string;
  };
  'circuit-breaker:half-opened': {
    service: string;
  };
  'load-balancer:target-selected': {
    capability: string;
    selected: string;
    strategy: string;
  };
  'rpc:call': {
    from: string;
    to: string;
    method: string;
    duration?: number;
  };
  'rpc:response': {
    from: string;
    to: string;
    method: string;
    duration: number;
    success: boolean;
  };
}

/**
 * Service Communication Hub for inter-service communication
 * Provides type-safe RPC calls, event messaging, circuit breaking, and load balancing
 */
export class ServiceCommunicationHub extends TypedEventEmitter<CommunicationHubEventMap> {
  private static instance: ServiceCommunicationHub;
  
  private registry: EnhancedServiceRegistry;
  private messageQueues: Map<string, ServiceMessage[]> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private loadBalancers: Map<string, {
    config: LoadBalancerConfig;
    connections: Map<string, number>; // connection count per service
    lastUsed: number; // for round-robin
  }> = new Map();
  
  private constructor() {
    super();
    this.registry = EnhancedServiceRegistry.getInstance();
    this.setupRegistryListeners();
  }

  static getInstance(): ServiceCommunicationHub {
    if (!ServiceCommunicationHub.instance) {
      ServiceCommunicationHub.instance = new ServiceCommunicationHub();
    }
    return ServiceCommunicationHub.instance;
  }

  /**
   * Make a type-safe RPC call to a service
   */
  async call<TRequest, TResponse>(
    targetService: string,
    method: string,
    request: TRequest,
    options?: {
      timeout?: number;
      priority?: ServiceMessage['priority'];
      correlationId?: string;
      retries?: number;
    }
  ): Promise<TResponse> {
    const {
      timeout = 30000,
      priority = 'normal',
      correlationId,
      retries = 0,
    } = options || {};

    const fromService = this.getCurrentServiceName();
    const callStartTime = Date.now();

    this.emit('rpc:call', {
      from: fromService,
      to: targetService,
      method,
    });

    // Check circuit breaker
    if (!this.isCircuitClosed(targetService)) {
      const error = new Error(`Circuit breaker is open for service: ${targetService}`);
      this.emit('rpc:response', {
        from: fromService,
        to: targetService,
        method,
        duration: Date.now() - callStartTime,
        success: false,
      });
      throw error;
    }

    const messageId = this.generateMessageId();
    const message: ServiceMessage = {
      id: messageId,
      from: fromService,
      to: targetService,
      type: 'request',
      method,
      payload: request,
      timestamp: new Date(),
      correlationId: correlationId || messageId,
      timeout,
      priority,
    };

    try {
      const response = await this.sendMessage<TResponse>(message);
      
      // Record success for circuit breaker
      this.recordSuccess(targetService);
      
      const duration = Date.now() - callStartTime;
      this.emit('rpc:response', {
        from: fromService,
        to: targetService,
        method,
        duration,
        success: true,
      });

      return response;

    } catch (error) {
      // Record failure for circuit breaker
      this.recordFailure(targetService);
      
      const duration = Date.now() - callStartTime;
      this.emit('rpc:response', {
        from: fromService,
        to: targetService,
        method,
        duration,
        success: false,
      });

      // Retry if configured
      if (retries > 0) {
        logger.warn(`RPC call failed, retrying (${retries} attempts left)`, {
          from: fromService,
          to: targetService,
          method,
          error: (error as Error).message,
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
        
        return this.call(targetService, method, request, {
          ...options,
          retries: retries - 1,
        });
      }
      
      throw error;
    }
  }

  /**
   * Call a service by capability (with load balancing)
   */
  async callByCapability<TRequest, TResponse>(
    capability: string,
    method: string,
    request: TRequest,
    options?: {
      timeout?: number;
      priority?: ServiceMessage['priority'];
      correlationId?: string;
      loadBalancerConfig?: LoadBalancerConfig;
    }
  ): Promise<TResponse> {
    const targetService = this.selectServiceByCapability(capability, options?.loadBalancerConfig);
    
    if (!targetService) {
      throw new Error(`No available service found for capability: ${capability}`);
    }

    return this.call<TRequest, TResponse>(targetService, method, request, options);
  }

  /**
   * Send an event to a specific service
   */
  async sendEvent(
    targetService: string,
    eventType: string,
    payload: any,
    options?: {
      priority?: ServiceMessage['priority'];
      correlationId?: string;
    }
  ): Promise<void> {
    const { priority = 'normal', correlationId } = options || {};
    const fromService = this.getCurrentServiceName();

    const message: ServiceMessage = {
      id: this.generateMessageId(),
      from: fromService,
      to: targetService,
      type: 'event',
      method: eventType,
      payload,
      timestamp: new Date(),
      correlationId,
      priority,
    };

    await this.deliverMessage(message);
  }

  /**
   * Broadcast an event to all services with a specific capability
   */
  async broadcastEvent(
    capability: string,
    eventType: string,
    payload: any,
    options?: {
      priority?: ServiceMessage['priority'];
      correlationId?: string;
    }
  ): Promise<void> {
    const services = this.registry.getServicesByCapability(capability);
    
    await Promise.all(
      services.map(serviceName => 
        this.sendEvent(serviceName, eventType, payload, options)
      )
    );
  }

  /**
   * Subscribe to events from other services
   */
  subscribeToEvents(
    serviceName: string,
    eventTypes: string[],
    handler: (eventType: string, payload: any, message: ServiceMessage) => Promise<void>
  ): () => void {
    const unsubscribeFunctions: Array<() => void> = [];

    for (const eventType of eventTypes) {
      const listener = async (data: { message: ServiceMessage }) => {
        const { message } = data;
        
        if (
          message.to === serviceName &&
          message.type === 'event' &&
          message.method === eventType
        ) {
          try {
            await handler(eventType, message.payload, message);
          } catch (error) {
            logger.error(`Event handler failed for ${eventType}`, {
              service: serviceName,
              error,
            });
          }
        }
      };

      this.on('message:received', listener);
      unsubscribeFunctions.push(() => this.off('message:received', listener));
    }

    // Return cleanup function
    return () => {
      unsubscribeFunctions.forEach(unsub => unsub());
    };
  }

  /**
   * Configure circuit breaker for a service
   */
  configureCircuitBreaker(
    serviceName: string,
    config: {
      failureThreshold: number;
      timeout: number;
      halfOpenRetryTimeout: number;
    }
  ): void {
    this.circuitBreakers.set(serviceName, {
      state: 'closed',
      failureCount: 0,
      ...config,
    } as any);
  }

  /**
   * Configure load balancer for a capability
   */
  configureLoadBalancer(
    capability: string,
    config: LoadBalancerConfig
  ): void {
    this.loadBalancers.set(capability, {
      config,
      connections: new Map(),
      lastUsed: 0,
    });
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(serviceName: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(serviceName) || null;
  }

  /**
   * Get communication statistics
   */
  getStatistics(): {
    totalMessages: number;
    messagesByType: Record<string, number>;
    circuitBreakers: Map<string, CircuitBreakerState>;
    activeConnections: number;
    averageResponseTime: number;
  } {
    // This would be implemented with proper metrics collection
    return {
      totalMessages: 0,
      messagesByType: {},
      circuitBreakers: new Map(this.circuitBreakers),
      activeConnections: this.pendingRequests.size,
      averageResponseTime: 0,
    };
  }

  private async sendMessage<TResponse>(message: ServiceMessage): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`RPC call timeout: ${message.to}.${message.method}`));
      }, message.timeout || 30000);

      this.pendingRequests.set(message.id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      this.deliverMessage(message).catch(error => {
        this.pendingRequests.delete(message.id);
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  private async deliverMessage(message: ServiceMessage): Promise<void> {
    const targetService = this.registry.get(message.to);
    
    if (!targetService) {
      throw new Error(`Target service not found: ${message.to}`);
    }

    try {
      this.emit('message:sent', {
        message,
        target: message.to,
      });

      // Add to target service's message queue
      if (!this.messageQueues.has(message.to)) {
        this.messageQueues.set(message.to, []);
      }
      
      this.messageQueues.get(message.to)!.push(message);
      
      // Process message queue for target service
      await this.processMessageQueue(message.to);

    } catch (error) {
      this.emit('message:failed', {
        message,
        error: error as Error,
      });
      throw error;
    }
  }

  private async processMessageQueue(serviceName: string): Promise<void> {
    const queue = this.messageQueues.get(serviceName) || [];
    
    // Sort by priority and timestamp
    queue.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    const service = this.registry.get(serviceName);
    if (!service) {
      return;
    }

    // Process messages one by one
    while (queue.length > 0) {
      const message = queue.shift()!;
      
      try {
        await this.processMessage(service, message);
      } catch (error) {
        logger.error(`Failed to process message for ${serviceName}`, {
          message: message.id,
          error,
        });
        
        // Handle request message failures
        if (message.type === 'request') {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            pending.reject(error as Error);
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.id);
          }
        }
      }
    }
  }

  private async processMessage(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    message: ServiceMessage
  ): Promise<void> {
    this.emit('message:received', {
      message,
      source: message.from,
    });

    switch (message.type) {
      case 'request':
        await this.handleRpcRequest(service, message);
        break;
        
      case 'response':
        this.handleRpcResponse(message);
        break;
        
      case 'event':
        await this.handleEvent(service, message);
        break;
        
      case 'broadcast':
        await this.handleBroadcast(service, message);
        break;
    }
  }

  private async handleRpcRequest(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    message: ServiceMessage
  ): Promise<void> {
    try {
      // Call the method on the target service
      const method = (service as any)[message.method!];
      
      if (typeof method !== 'function') {
        throw new Error(`Method ${message.method} not found on service ${service.metadata.name}`);
      }

      const result = await method.call(service, message.payload);
      
      // Send response back
      const response: ServiceMessage = {
        id: this.generateMessageId(),
        from: message.to,
        to: message.from,
        type: 'response',
        payload: result,
        timestamp: new Date(),
        correlationId: message.correlationId,
        priority: message.priority,
      };

      await this.deliverMessage(response);

    } catch (error) {
      // Send error response
      const errorResponse: ServiceMessage = {
        id: this.generateMessageId(),
        from: message.to,
        to: message.from,
        type: 'response',
        payload: {
          error: {
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        },
        timestamp: new Date(),
        correlationId: message.correlationId,
        priority: message.priority,
      };

      await this.deliverMessage(errorResponse);
    }
  }

  private handleRpcResponse(message: ServiceMessage): void {
    const pending = this.pendingRequests.get(message.correlationId!);
    
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.correlationId!);
      
      if (message.payload?.error) {
        pending.reject(new Error(message.payload.error.message));
      } else {
        pending.resolve(message.payload);
      }
    }
  }

  private async handleEvent(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    message: ServiceMessage
  ): Promise<void> {
    // Emit the event on the service's event emitter
    service.emit(message.method as any, message.payload);
  }

  private async handleBroadcast(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    message: ServiceMessage
  ): Promise<void> {
    // Handle broadcast messages (similar to events but for all services)
    service.emit(message.method as any, message.payload);
  }

  private selectServiceByCapability(
    capability: string,
    config?: LoadBalancerConfig
  ): string | null {
    const services = this.registry.getServicesByCapability(capability)
      .filter(serviceName => {
        const availability = this.registry.getAvailability(serviceName);
        return availability?.available && this.isCircuitClosed(serviceName);
      });

    if (services.length === 0) {
      return null;
    }

    const strategy = config?.strategy || 'round-robin';
    let selected: string;

    switch (strategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(capability, services);
        break;
        
      case 'least-connections':
        selected = this.selectLeastConnections(capability, services);
        break;
        
      case 'random':
        selected = services[Math.floor(Math.random() * services.length)];
        break;
        
      case 'weighted':
        selected = this.selectWeighted(capability, services, config?.weights);
        break;
        
      default:
        selected = services[0];
    }

    this.emit('load-balancer:target-selected', {
      capability,
      selected,
      strategy,
    });

    return selected;
  }

  private selectRoundRobin(capability: string, services: string[]): string {
    const lb = this.loadBalancers.get(capability) || {
      config: { strategy: 'round-robin', healthCheck: true },
      connections: new Map(),
      lastUsed: 0,
    };

    const index = lb.lastUsed % services.length;
    lb.lastUsed = index + 1;
    
    this.loadBalancers.set(capability, lb);
    return services[index];
  }

  private selectLeastConnections(capability: string, services: string[]): string {
    const lb = this.loadBalancers.get(capability) || {
      config: { strategy: 'least-connections', healthCheck: true },
      connections: new Map(),
      lastUsed: 0,
    };

    let selected = services[0];
    let minConnections = lb.connections.get(selected) || 0;

    for (const service of services.slice(1)) {
      const connections = lb.connections.get(service) || 0;
      if (connections < minConnections) {
        selected = service;
        minConnections = connections;
      }
    }

    // Increment connection count
    lb.connections.set(selected, minConnections + 1);
    this.loadBalancers.set(capability, lb);

    return selected;
  }

  private selectWeighted(
    capability: string,
    services: string[],
    weights?: Map<string, number>
  ): string {
    if (!weights || weights.size === 0) {
      return services[0];
    }

    const totalWeight = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0);
    const random = Math.random() * totalWeight;
    
    let currentWeight = 0;
    for (const service of services) {
      const weight = weights.get(service) || 1;
      currentWeight += weight;
      
      if (random <= currentWeight) {
        return service;
      }
    }

    return services[0];
  }

  private isCircuitClosed(serviceName: string): boolean {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (!breaker) {
      return true; // No circuit breaker configured
    }

    const now = Date.now();
    
    switch (breaker.state) {
      case 'closed':
        return true;
        
      case 'open':
        if (breaker.nextAttempt && now >= breaker.nextAttempt.getTime()) {
          breaker.state = 'half-open';
          this.emit('circuit-breaker:half-opened', { service: serviceName });
          return true;
        }
        return false;
        
      case 'half-open':
        return true;
        
      default:
        return true;
    }
  }

  private recordSuccess(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (breaker) {
      breaker.lastSuccess = new Date();
      breaker.failureCount = 0;
      
      if (breaker.state !== 'closed') {
        breaker.state = 'closed';
        this.emit('circuit-breaker:closed', { service: serviceName });
      }
    }
  }

  private recordFailure(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (breaker) {
      breaker.failureCount++;
      breaker.lastFailure = new Date();
      
      // Default thresholds if not configured
      const failureThreshold = (breaker as any).failureThreshold || 5;
      const timeout = (breaker as any).timeout || 60000;
      
      if (breaker.failureCount >= failureThreshold && breaker.state === 'closed') {
        breaker.state = 'open';
        breaker.nextAttempt = new Date(Date.now() + timeout);
        
        this.emit('circuit-breaker:opened', {
          service: serviceName,
          failureCount: breaker.failureCount,
        });
      }
    }
  }

  private getCurrentServiceName(): string {
    // This would typically be injected or determined from context
    // For now, return a placeholder
    return 'communication-hub';
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupRegistryListeners(): void {
    this.registry.on('service:deregistered', ({ name }) => {
      // Clean up resources for deregistered service
      this.messageQueues.delete(name);
      this.circuitBreakers.delete(name);
      
      // Update load balancer connections
      for (const [capability, lb] of this.loadBalancers.entries()) {
        lb.connections.delete(name);
      }
    });
  }
}