import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceConfig, HealthMonitored, CacheEnabled, MetricsCollected } from '../core/ServiceDecorators.js';
import { DomainEvent } from '@/domain/events/DomainEvent.js';
import { logger } from '@/lib/unjs-utils.js';
import { randomBytes } from 'crypto';

// Configuration Schema
const EventBusConfigSchema = z.object({
  messaging: z.object({
    adapters: z.array(z.enum(['redis', 'rabbitmq', 'kafka', 'inmemory'])).default(['redis', 'inmemory']),
    defaultAdapter: z.string().default('redis'),
    enableFallback: z.boolean().default(true),
    enableReplication: z.boolean().default(true),
  }),
  resilience: z.object({
    retryAttempts: z.number().min(0).max(10).default(3),
    retryBackoffMs: z.number().min(100).max(60000).default(1000),
    enableDeadLetterQueue: z.boolean().default(true),
    enableCircuitBreaker: z.boolean().default(true),
    timeoutMs: z.number().min(1000).max(300000).default(30000),
  }),
  performance: z.object({
    enableBatching: z.boolean().default(true),
    batchSize: z.number().min(1).max(1000).default(100),
    batchTimeoutMs: z.number().min(10).max(5000).default(100),
    enableCompression: z.boolean().default(true),
    maxMessageSize: z.number().min(1024).max(104857600).default(1048576), // 1MB
  }),
  monitoring: z.object({
    enableMetrics: z.boolean().default(true),
    enableTracing: z.boolean().default(true),
    metricsWindow: z.number().min(60).max(3600).default(300), // 5 minutes
    alertOnErrors: z.boolean().default(true),
    alertThreshold: z.number().min(0).max(1).default(0.05), // 5% error rate
  }),
  filtering: z.object({
    enableFilters: z.boolean().default(true),
    enableRouting: z.boolean().default(true),
    enableTransformation: z.boolean().default(true),
    enableValidation: z.boolean().default(true),
  }),
  persistence: z.object({
    enableEventStore: z.boolean().default(true),
    enableSnapshots: z.boolean().default(true),
    retentionDays: z.number().min(1).max(2555).default(365),
    compressionEnabled: z.boolean().default(true),
  }),
});

type EventBusConfig = z.infer<typeof EventBusConfigSchema>;

// Event Map for EventBus Service
interface EventBusEventMap {
  'eventbus:event-published': { eventType: string; topic: string; adapters: string[]; timestamp: Date };
  'eventbus:event-received': { eventType: string; topic: string; handlerCount: number; timestamp: Date };
  'eventbus:event-failed': { eventType: string; topic: string; error: string; retryCount: number; timestamp: Date };
  'eventbus:adapter-connected': { adapterName: string; config: any; timestamp: Date };
  'eventbus:adapter-disconnected': { adapterName: string; reason: string; timestamp: Date };
  'eventbus:adapter-failed': { adapterName: string; error: string; willRetry: boolean; timestamp: Date };
  'eventbus:dlq-message': { eventType: string; topic: string; reason: string; timestamp: Date };
  'eventbus:batch-processed': { batchSize: number; processingTime: number; errors: number; timestamp: Date };
  'eventbus:circuit-opened': { adapterName: string; errorRate: number; timestamp: Date };
  'eventbus:circuit-closed': { adapterName: string; timestamp: Date };
}

// Enhanced data types
export interface EventEnvelope<T extends DomainEvent = DomainEvent> {
  event: T;
  metadata: {
    correlationId: string;
    causationId?: string;
    userId?: string;
    tenantId?: string;
    timestamp: Date;
    version: string;
    source: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    retry: {
      count: number;
      maxAttempts: number;
      lastAttempt?: Date;
    };
    routing: {
      topic: string;
      partition?: string;
      headers: Record<string, string>;
    };
    tracing: {
      traceId: string;
      spanId: string;
      parentSpanId?: string;
    };
    security: {
      encrypted: boolean;
      signature?: string;
      permissions: string[];
    };
  };
}

export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(envelope: EventEnvelope<T>): Promise<void>;
  supportedEvents(): string[];
  handlerName: string;
  priority?: number;
  concurrency?: number;
  timeout?: number;
}

export interface EventBusAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  isHealthy(): boolean;
  
  publish<T extends DomainEvent>(
    topic: string,
    envelope: EventEnvelope<T>,
    options?: PublishOptions
  ): Promise<void>;
  
  subscribe(
    topic: string,
    handler: (envelope: EventEnvelope) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<string>; // Returns subscription ID
  
  unsubscribe(subscriptionId: string): Promise<void>;
  
  createTopic(topic: string, options?: TopicOptions): Promise<void>;
  deleteTopic(topic: string): Promise<void>;
  listTopics(): Promise<string[]>;
  
  getMetrics(): AdapterMetrics;
}

export interface PublishOptions {
  partition?: string;
  headers?: Record<string, string>;
  timeout?: number;
  compression?: boolean;
  encryption?: boolean;
}

export interface SubscribeOptions {
  consumerGroup?: string;
  startPosition?: 'earliest' | 'latest' | 'timestamp';
  timestamp?: Date;
  batchSize?: number;
  concurrency?: number;
}

export interface TopicOptions {
  partitions?: number;
  replicationFactor?: number;
  retentionMs?: number;
  compression?: string;
}

export interface AdapterMetrics {
  messagesPublished: number;
  messagesConsumed: number;
  publishErrors: number;
  consumeErrors: number;
  averageLatency: number;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  lastActivity: Date;
}

export interface EventFilter {
  name: string;
  condition: (envelope: EventEnvelope) => boolean;
  transform?: (envelope: EventEnvelope) => EventEnvelope;
  priority: number;
  enabled: boolean;
}

export interface EventRoute {
  sourcePattern: string;
  destinationTopic: string;
  filters: string[];
  transformations: string[];
  enabled: boolean;
}

export interface EventBusMetrics {
  events: {
    published: number;
    consumed: number;
    failed: number;
    dlq: number;
    byType: Record<string, number>;
    byTopic: Record<string, number>;
  };
  adapters: {
    total: number;
    connected: number;
    healthy: number;
    byType: Record<string, number>;
  };
  performance: {
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    throughputPerSecond: number;
    errorRate: number;
  };
  handlers: {
    registered: number;
    active: number;
    byEvent: Record<string, number>;
  };
  circuits: {
    open: number;
    halfOpen: number;
    closed: number;
  };
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
  errorThreshold: number;
  timeout: number;
}

/**
 * Enterprise Event Bus Service
 * Advanced event-driven architecture with comprehensive enterprise features
 */
@ServiceConfig({
  schema: EventBusConfigSchema,
  prefix: 'eventbus',
  hot: true,
})
@HealthMonitored({
  interval: 30000, // 30 seconds
  timeout: 10000,
})
@CacheEnabled({
  ttl: 300, // 5 minutes
  maxSize: 100000,
})
@MetricsCollected(['event_operations', 'adapter_operations', 'handler_operations', 'batch_operations'])
export class EventBus extends BaseAsyncService<EventBusConfig, EventBusEventMap> {
  private adapters: Map<string, EventBusAdapter> = new Map();
  private handlers: Map<string, EventHandler[]> = new Map();
  private subscriptions: Map<string, string[]> = new Map(); // topic -> subscription IDs
  private filters: Map<string, EventFilter> = new Map();
  private routes: Map<string, EventRoute> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  
  private eventBatch: EventEnvelope[] = [];
  private batchTimer?: NodeJS.Timeout;
  private metrics: EventBusMetrics = {
    events: {
      published: 0,
      consumed: 0,
      failed: 0,
      dlq: 0,
      byType: {},
      byTopic: {},
    },
    adapters: {
      total: 0,
      connected: 0,
      healthy: 0,
      byType: {},
    },
    performance: {
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      throughputPerSecond: 0,
      errorRate: 0,
    },
    handlers: {
      registered: 0,
      active: 0,
      byEvent: {},
    },
    circuits: {
      open: 0,
      halfOpen: 0,
      closed: 0,
    },
  };

  private latencyHistory: number[] = [];
  private monitoringInterval?: NodeJS.Timeout;

  protected getServiceName(): string {
    return 'event-bus';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Enterprise event bus with advanced messaging and resilience features';
  }

  protected async onInitialize(): Promise<void> {
    this.initializeDefaultFilters();
    this.setupHealthChecks();
    
    // Initialize adapters based on configuration
    await this.initializeAdapters();
    
    // Start batch processing if enabled
    if (this.config.performance.enableBatching) {
      this.startBatchProcessing();
    }
    
    // Start monitoring
    this.startMonitoring();
  }

  protected async onStart(): Promise<void> {
    // Connect all adapters
    await this.connectAdapters();
    
    // Initialize circuit breakers
    this.initializeCircuitBreakers();

    logger.info('EventBus service started', {
      adapters: Array.from(this.adapters.keys()),
      filters: this.filters.size,
      routes: this.routes.size,
    });
  }

  protected async onStop(): Promise<void> {
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Stop batch processing
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      await this.processBatch(); // Process remaining events
    }
    
    // Disconnect all adapters
    await this.disconnectAdapters();
  }

  /**
   * Register an event bus adapter
   */
  async registerAdapter(adapter: EventBusAdapter): Promise<void> {
    this.adapters.set(adapter.name, adapter);
    this.metrics.adapters.total++;
    this.metrics.adapters.byType[adapter.name] = (this.metrics.adapters.byType[adapter.name] || 0) + 1;
    
    // Initialize circuit breaker for this adapter
    this.circuitBreakers.set(adapter.name, {
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      errorThreshold: 5,
      timeout: 60000, // 1 minute
    });

    logger.info('EventBus adapter registered', { adapterName: adapter.name });
  }

  /**
   * Publish an event with comprehensive features
   */
  async publish<T extends DomainEvent>(
    event: T,
    metadata: Partial<EventEnvelope<T>['metadata']> = {}
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Create comprehensive envelope
      const envelope: EventEnvelope<T> = {
        event,
        metadata: {
          correlationId: metadata.correlationId || this.generateCorrelationId(),
          causationId: metadata.causationId,
          userId: metadata.userId,
          tenantId: metadata.tenantId,
          timestamp: new Date(),
          version: '1.0',
          source: this.getServiceName(),
          priority: metadata.priority || 'normal',
          retry: {
            count: 0,
            maxAttempts: this.config.resilience.retryAttempts,
          },
          routing: {
            topic: this.getTopicForEvent(event),
            headers: metadata.routing?.headers || {},
          },
          tracing: {
            traceId: metadata.tracing?.traceId || this.generateTraceId(),
            spanId: this.generateSpanId(),
            parentSpanId: metadata.tracing?.parentSpanId,
          },
          security: {
            encrypted: false,
            permissions: metadata.security?.permissions || [],
          },
          ...metadata,
        },
      };

      // Apply filters and transformations
      const processedEnvelope = await this.applyFilters(envelope);
      
      // Validate event if enabled
      if (this.config.filtering.enableValidation) {
        await this.validateEvent(processedEnvelope);
      }

      // Route event if routing is enabled
      const topics = this.config.filtering.enableRouting 
        ? await this.routeEvent(processedEnvelope)
        : [processedEnvelope.metadata.routing.topic];

      // Publish to all topics
      for (const topic of topics) {
        await this.publishToTopic(processedEnvelope, topic);
      }

      // Update metrics
      this.metrics.events.published++;
      this.metrics.events.byType[event.eventType] = (this.metrics.events.byType[event.eventType] || 0) + 1;
      for (const topic of topics) {
        this.metrics.events.byTopic[topic] = (this.metrics.events.byTopic[topic] || 0) + 1;
      }

      const duration = performance.now() - startTime;
      this.latencyHistory.push(duration);
      
      // Emit event
      this.emit('eventbus:event-published', {
        eventType: event.eventType,
        topic: topics[0], // Primary topic
        adapters: Array.from(this.adapters.keys()),
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('event_operations', 1, {
        operation: 'publish',
        eventType: event.eventType,
        topics: topics.length.toString(),
      });

      logger.debug('Event published successfully', {
        eventType: event.eventType,
        eventId: event.eventId,
        correlationId: envelope.metadata.correlationId,
        topics,
        duration: `${duration.toFixed(2)}ms`,
      });
    } catch (error) {
      this.metrics.events.failed++;
      
      this.emit('eventbus:event-failed', {
        eventType: event.eventType,
        topic: this.getTopicForEvent(event),
        error: (error as Error).message,
        retryCount: 0,
        timestamp: new Date(),
      });

      logger.error('Event publication failed', error as Error, {
        eventType: event.eventType,
        eventId: event.eventId,
      });
      throw error;
    }
  }

  /**
   * Subscribe to events with comprehensive options
   */
  async subscribe<T extends DomainEvent>(
    eventTypeOrPattern: string,
    handler: EventHandler<T>,
    options: SubscribeOptions = {}
  ): Promise<string> {
    const topic = this.getTopicForEventType(eventTypeOrPattern);
    
    // Register handler locally
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
    }
    this.handlers.get(topic)!.push(handler as EventHandler);

    // Update metrics
    this.metrics.handlers.registered++;
    this.metrics.handlers.byEvent[eventTypeOrPattern] = 
      (this.metrics.handlers.byEvent[eventTypeOrPattern] || 0) + 1;

    // Subscribe on all healthy adapters
    const subscriptionIds: string[] = [];
    for (const [adapterName, adapter] of this.adapters) {
      if (this.isAdapterHealthy(adapterName)) {
        try {
          const subscriptionId = await adapter.subscribe(
            topic,
            async (envelope) => {
              await this.handleEventWithResilience(envelope, handler as EventHandler, adapterName);
            },
            options
          );
          subscriptionIds.push(subscriptionId);
        } catch (error) {
          logger.error('Failed to subscribe on adapter', error as Error, {
            adapterName,
            topic,
          });
        }
      }
    }

    // Store subscription IDs
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    this.subscriptions.get(topic)!.push(...subscriptionIds);

    const subscriptionId = `sub_${Date.now()}_${randomBytes(4).toString('hex')}`;
    
    logger.info('Event subscription created', {
      eventType: eventTypeOrPattern,
      topic,
      handlerName: handler.handlerName,
      subscriptionId,
      adapters: subscriptionIds.length,
    });

    return subscriptionId;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(eventTypeOrPattern: string, subscriptionId?: string): Promise<void> {
    const topic = this.getTopicForEventType(eventTypeOrPattern);
    
    // Remove local handlers
    this.handlers.delete(topic);
    
    // Unsubscribe from adapters
    const subscriptionIds = this.subscriptions.get(topic) || [];
    for (const [adapterName, adapter] of this.adapters) {
      for (const subId of subscriptionIds) {
        try {
          await adapter.unsubscribe(subId);
        } catch (error) {
          logger.error('Failed to unsubscribe from adapter', error as Error, {
            adapterName,
            subscriptionId: subId,
          });
        }
      }
    }
    
    this.subscriptions.delete(topic);
    this.metrics.handlers.registered = Math.max(0, this.metrics.handlers.registered - 1);

    logger.info('Event subscription removed', {
      eventType: eventTypeOrPattern,
      topic,
      subscriptionId,
    });
  }

  /**
   * Add event filter
   */
  addFilter(filter: EventFilter): void {
    this.filters.set(filter.name, filter);
    
    logger.info('Event filter added', {
      filterName: filter.name,
      priority: filter.priority,
      enabled: filter.enabled,
    });
  }

  /**
   * Add event route
   */
  addRoute(route: EventRoute): void {
    this.routes.set(route.sourcePattern, route);
    
    logger.info('Event route added', {
      sourcePattern: route.sourcePattern,
      destinationTopic: route.destinationTopic,
      enabled: route.enabled,
    });
  }

  /**
   * Get comprehensive metrics
   */
  async getMetrics(): Promise<EventBusMetrics> {
    // Update real-time metrics
    await this.updateMetrics();
    return { ...this.metrics };
  }

  // Private helper methods

  private setupHealthChecks(): void {
    this.registerHealthCheck({
      name: 'adapters-connected',
      check: async () => ({
        name: 'adapters-connected',
        status: this.metrics.adapters.connected > 0 ? 'healthy' : 'unhealthy',
        message: `${this.metrics.adapters.connected}/${this.metrics.adapters.total} adapters connected`,
        timestamp: new Date(),
      }),
      critical: true,
    });

    this.registerHealthCheck({
      name: 'event-processing',
      check: async () => ({
        name: 'event-processing',
        status: this.metrics.performance.errorRate < this.config.monitoring.alertThreshold ? 'healthy' : 'degraded',
        message: `Error rate: ${(this.metrics.performance.errorRate * 100).toFixed(2)}%`,
        timestamp: new Date(),
      }),
    });
  }

  private initializeDefaultFilters(): void {
    // Add security filter
    this.addFilter({
      name: 'security-filter',
      condition: (envelope) => {
        // Check permissions
        return envelope.metadata.security.permissions.length === 0 || 
               envelope.metadata.security.permissions.includes('event.publish');
      },
      priority: 100,
      enabled: true,
    });

    // Add size filter
    this.addFilter({
      name: 'size-filter',
      condition: (envelope) => {
        const size = JSON.stringify(envelope).length;
        return size <= this.config.performance.maxMessageSize;
      },
      priority: 90,
      enabled: true,
    });
  }

  private async initializeAdapters(): Promise<void> {
    // Initialize adapters based on configuration
    // This would typically load adapter implementations
    logger.info('Initializing event bus adapters', {
      adapters: this.config.messaging.adapters,
    });
  }

  private async connectAdapters(): Promise<void> {
    const connectionPromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        try {
          await adapter.connect();
          this.metrics.adapters.connected++;
          
          this.emit('eventbus:adapter-connected', {
            adapterName: name,
            config: {}, // Adapter-specific config
            timestamp: new Date(),
          });
          
          logger.info('EventBus adapter connected', { adapterName: name });
        } catch (error) {
          this.handleAdapterError(name, error as Error, true);
        }
      }
    );

    await Promise.allSettled(connectionPromises);
  }

  private async disconnectAdapters(): Promise<void> {
    const disconnectionPromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        try {
          await adapter.disconnect();
          this.metrics.adapters.connected = Math.max(0, this.metrics.adapters.connected - 1);
          
          this.emit('eventbus:adapter-disconnected', {
            adapterName: name,
            reason: 'service-shutdown',
            timestamp: new Date(),
          });
          
          logger.info('EventBus adapter disconnected', { adapterName: name });
        } catch (error) {
          logger.error('Failed to disconnect adapter', error as Error, { adapterName: name });
        }
      }
    );

    await Promise.allSettled(disconnectionPromises);
  }

  private startBatchProcessing(): void {
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.config.performance.batchTimeoutMs);
  }

  private async processBatch(): Promise<void> {
    if (this.eventBatch.length === 0) {
      this.startBatchProcessing();
      return;
    }

    const startTime = performance.now();
    const batch = [...this.eventBatch];
    this.eventBatch = [];

    try {
      // Process batch
      const results = await Promise.allSettled(
        batch.map(envelope => this.processSingleEvent(envelope))
      );

      const errors = results.filter(r => r.status === 'rejected').length;
      const duration = performance.now() - startTime;

      this.emit('eventbus:batch-processed', {
        batchSize: batch.length,
        processingTime: duration,
        errors,
        timestamp: new Date(),
      });

      this.recordMetric('batch_operations', 1, {
        batchSize: batch.length.toString(),
        errors: errors.toString(),
      });

      logger.debug('Event batch processed', {
        batchSize: batch.length,
        errors,
        duration: `${duration.toFixed(2)}ms`,
      });
    } catch (error) {
      logger.error('Batch processing failed', error as Error, {
        batchSize: batch.length,
      });
    } finally {
      this.startBatchProcessing();
    }
  }

  private async applyFilters(envelope: EventEnvelope): Promise<EventEnvelope> {
    // Sort filters by priority
    const sortedFilters = Array.from(this.filters.values())
      .filter(f => f.enabled)
      .sort((a, b) => b.priority - a.priority);

    let processedEnvelope = envelope;

    for (const filter of sortedFilters) {
      try {
        if (!filter.condition(processedEnvelope)) {
          throw new Error(`Event filtered by ${filter.name}`);
        }

        if (filter.transform) {
          processedEnvelope = filter.transform(processedEnvelope);
        }
      } catch (error) {
        logger.warn('Event filtered', error as Error, {
          filterName: filter.name,
          eventType: envelope.event.eventType,
        });
        throw error;
      }
    }

    return processedEnvelope;
  }

  private async validateEvent(envelope: EventEnvelope): Promise<void> {
    // Basic validation
    if (!envelope.event.eventId) {
      throw new Error('Event must have an eventId');
    }

    if (!envelope.event.eventType) {
      throw new Error('Event must have an eventType');
    }

    if (!envelope.metadata.correlationId) {
      throw new Error('Event must have a correlationId');
    }
  }

  private async routeEvent(envelope: EventEnvelope): Promise<string[]> {
    const topics = [envelope.metadata.routing.topic]; // Default topic

    for (const [pattern, route] of this.routes) {
      if (route.enabled && this.matchesPattern(envelope.metadata.routing.topic, pattern)) {
        topics.push(route.destinationTopic);
      }
    }

    return [...new Set(topics)]; // Remove duplicates
  }

  private async publishToTopic(envelope: EventEnvelope, topic: string): Promise<void> {
    if (this.config.performance.enableBatching) {
      // Add to batch
      this.eventBatch.push({ ...envelope, metadata: { ...envelope.metadata, routing: { ...envelope.metadata.routing, topic } } });
      
      if (this.eventBatch.length >= this.config.performance.batchSize) {
        await this.processBatch();
      }
    } else {
      await this.processSingleEvent({ ...envelope, metadata: { ...envelope.metadata, routing: { ...envelope.metadata.routing, topic } } });
    }
  }

  private async processSingleEvent(envelope: EventEnvelope): Promise<void> {
    // Publish to all healthy adapters
    const publishPromises = Array.from(this.adapters.entries())
      .filter(([name]) => this.isAdapterHealthy(name))
      .map(([name, adapter]) => 
        this.publishWithCircuitBreaker(adapter, envelope.metadata.routing.topic, envelope, name)
      );

    await Promise.allSettled(publishPromises);
  }

  private async publishWithCircuitBreaker(
    adapter: EventBusAdapter,
    topic: string,
    envelope: EventEnvelope,
    adapterName: string
  ): Promise<void> {
    const circuit = this.circuitBreakers.get(adapterName);
    if (!circuit) return;

    // Check circuit breaker state
    if (circuit.state === 'open') {
      if (Date.now() - (circuit.nextAttemptTime?.getTime() || 0) < 0) {
        throw new Error(`Circuit breaker open for adapter ${adapterName}`);
      }
      circuit.state = 'half-open';
    }

    try {
      await this.publishWithRetry(adapter, topic, envelope, adapterName);
      
      // Success - reset circuit breaker
      circuit.successCount++;
      circuit.failureCount = 0;
      if (circuit.state === 'half-open') {
        circuit.state = 'closed';
        this.emit('eventbus:circuit-closed', {
          adapterName,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      // Failure - update circuit breaker
      circuit.failureCount++;
      circuit.lastFailureTime = new Date();
      
      if (circuit.failureCount >= circuit.errorThreshold) {
        circuit.state = 'open';
        circuit.nextAttemptTime = new Date(Date.now() + circuit.timeout);
        
        this.emit('eventbus:circuit-opened', {
          adapterName,
          errorRate: circuit.failureCount / (circuit.failureCount + circuit.successCount),
          timestamp: new Date(),
        });
      }
      
      throw error;
    }
  }

  private async publishWithRetry(
    adapter: EventBusAdapter,
    topic: string,
    envelope: EventEnvelope,
    adapterName: string
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.resilience.retryAttempts; attempt++) {
      try {
        await adapter.publish(topic, envelope, {
          timeout: this.config.resilience.timeoutMs,
          compression: this.config.performance.enableCompression,
        });
        return;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.resilience.retryAttempts) {
          const delay = this.config.resilience.retryBackoffMs * Math.pow(2, attempt);
          await this.delay(delay);
          envelope.metadata.retry.count = attempt + 1;
        }
      }
    }

    // All retries failed
    if (this.config.resilience.enableDeadLetterQueue) {
      await this.sendToDeadLetterQueue(topic, envelope, lastError!);
    }

    throw lastError;
  }

  private async handleEventWithResilience(
    envelope: EventEnvelope,
    handler: EventHandler,
    adapterName: string
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await handler.handle(envelope);
      
      this.metrics.events.consumed++;
      const duration = performance.now() - startTime;
      this.latencyHistory.push(duration);

      this.emit('eventbus:event-received', {
        eventType: envelope.event.eventType,
        topic: envelope.metadata.routing.topic,
        handlerCount: 1,
        timestamp: new Date(),
      });

      this.recordMetric('handler_operations', 1, {
        operation: 'success',
        eventType: envelope.event.eventType,
        handlerName: handler.handlerName,
      });
    } catch (error) {
      this.metrics.events.failed++;
      
      this.emit('eventbus:event-failed', {
        eventType: envelope.event.eventType,
        topic: envelope.metadata.routing.topic,
        error: (error as Error).message,
        retryCount: envelope.metadata.retry.count,
        timestamp: new Date(),
      });

      this.recordMetric('handler_operations', 1, {
        operation: 'failure',
        eventType: envelope.event.eventType,
        handlerName: handler.handlerName,
      });

      logger.error('Event handler failed', error as Error, {
        eventType: envelope.event.eventType,
        handlerName: handler.handlerName,
        correlationId: envelope.metadata.correlationId,
      });

      throw error;
    }
  }

  private async sendToDeadLetterQueue(
    topic: string,
    envelope: EventEnvelope,
    error: Error
  ): Promise<void> {
    const dlqTopic = `${topic}.dlq`;
    const dlqEnvelope = {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        routing: {
          ...envelope.metadata.routing,
          topic: dlqTopic,
          headers: {
            ...envelope.metadata.routing.headers,
            'x-original-topic': topic,
            'x-error-message': error.message,
            'x-dlq-timestamp': new Date().toISOString(),
          },
        },
      },
    };

    this.metrics.events.dlq++;

    this.emit('eventbus:dlq-message', {
      eventType: envelope.event.eventType,
      topic: dlqTopic,
      reason: error.message,
      timestamp: new Date(),
    });

    logger.warn('Event sent to DLQ', {
      eventType: envelope.event.eventType,
      originalTopic: topic,
      dlqTopic,
      error: error.message,
    });
  }

  private isAdapterHealthy(adapterName: string): boolean {
    const adapter = this.adapters.get(adapterName);
    return adapter?.isConnected() && adapter?.isHealthy() || false;
  }

  private handleAdapterError(adapterName: string, error: Error, willRetry: boolean): void {
    this.emit('eventbus:adapter-failed', {
      adapterName,
      error: error.message,
      willRetry,
      timestamp: new Date(),
    });

    logger.error('EventBus adapter error', error, {
      adapterName,
      willRetry,
    });
  }

  private initializeCircuitBreakers(): void {
    for (const adapterName of this.adapters.keys()) {
      if (!this.circuitBreakers.has(adapterName)) {
        this.circuitBreakers.set(adapterName, {
          state: 'closed',
          failureCount: 0,
          successCount: 0,
          errorThreshold: 5,
          timeout: 60000,
        });
      }
    }
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.updateMetrics();
      await this.checkHealthAndAlerts();
    }, this.config.monitoring.metricsWindow * 1000);
  }

  private async updateMetrics(): Promise<void> {
    // Update adapter metrics
    this.metrics.adapters.connected = Array.from(this.adapters.values())
      .filter(adapter => adapter.isConnected()).length;
    this.metrics.adapters.healthy = Array.from(this.adapters.values())
      .filter(adapter => adapter.isHealthy()).length;

    // Update performance metrics
    if (this.latencyHistory.length > 0) {
      const sorted = [...this.latencyHistory].sort((a, b) => a - b);
      this.metrics.performance.averageLatency = 
        this.latencyHistory.reduce((sum, lat) => sum + lat, 0) / this.latencyHistory.length;
      this.metrics.performance.p95Latency = sorted[Math.floor(sorted.length * 0.95)] || 0;
      this.metrics.performance.p99Latency = sorted[Math.floor(sorted.length * 0.99)] || 0;
    }

    // Calculate error rate
    const totalEvents = this.metrics.events.published + this.metrics.events.consumed;
    this.metrics.performance.errorRate = totalEvents > 0 
      ? this.metrics.events.failed / totalEvents 
      : 0;

    // Update circuit breaker metrics
    this.metrics.circuits.open = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'open').length;
    this.metrics.circuits.halfOpen = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'half-open').length;
    this.metrics.circuits.closed = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'closed').length;

    // Clean up old latency data
    if (this.latencyHistory.length > 10000) {
      this.latencyHistory = this.latencyHistory.slice(-5000);
    }
  }

  private async checkHealthAndAlerts(): Promise<void> {
    // Check error rate
    if (this.config.monitoring.alertOnErrors && 
        this.metrics.performance.errorRate > this.config.monitoring.alertThreshold) {
      logger.warn('High error rate detected', {
        errorRate: this.metrics.performance.errorRate,
        threshold: this.config.monitoring.alertThreshold,
      });
    }

    // Check adapter health
    if (this.metrics.adapters.connected === 0) {
      logger.error('No adapters connected - event bus unavailable');
    }
  }

  // Utility methods

  private getTopicForEvent(event: DomainEvent): string {
    return `events.${event.aggregateType || 'unknown'}.${event.eventType}`.toLowerCase();
  }

  private getTopicForEventType(eventType: string): string {
    return `events.*.${eventType}`.toLowerCase();
  }

  private matchesPattern(topic: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(topic);
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private generateSpanId(): string {
    return `span_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}