import { DomainEvent } from '@/domain/events/DomainEvent.js';
import { logger } from '@/logger.js';
import { SingletonService } from '../core/SingletonService.js';

export interface EventBusOptions {
  retryAttempts?: number;
  retryDelay?: number;
  deadLetterQueue?: boolean;
  enableMetrics?: boolean;
}

export interface EventEnvelope<T extends DomainEvent = DomainEvent> {
  event: T;
  metadata: {
    correlationId: string;
    causationId?: string;
    userId?: string;
    timestamp: Date;
    retryCount?: number;
    source?: string;
  };
}

export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(envelope: EventEnvelope<T>): Promise<void>;
  supportedEvents(): string[];
}

export interface EventBusAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish<T extends DomainEvent>(
    topic: string,
    envelope: EventEnvelope<T>
  ): Promise<void>;
  subscribe(
    topic: string,
    handler: (envelope: EventEnvelope) => Promise<void>
  ): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  isConnected(): boolean;
}

/**
 * Advanced Event Bus with support for multiple message brokers
 * and production-ready features like retry, DLQ, and metrics
 */
export class EventBus extends SingletonService<EventBus> {
  private adapters: Map<string, EventBusAdapter> = new Map();
  private handlers: Map<string, EventHandler[]> = new Map();
  private options: EventBusOptions;
  private metrics: EventBusMetrics;

  protected constructor() {
    super();
    this.options = {
      retryAttempts: 3,
      retryDelay: 1000,
      deadLetterQueue: true,
      enableMetrics: true,
    };
    this.metrics = new EventBusMetrics();
  }

  static getInstance(): EventBus {
    return super.getInstance();
  }

  /**
   * Configure the EventBus with options
   */
  public configure(options: EventBusOptions = {}): void {
    this.options = {
      retryAttempts: 3,
      retryDelay: 1000,
      deadLetterQueue: true,
      enableMetrics: true,
      ...options,
    };
  }

  /**
   * Register a message broker adapter
   */
  registerAdapter(name: string, adapter: EventBusAdapter): void {
    this.adapters.set(name, adapter);
    logger.info(`Registered event bus adapter: ${name}`);
  }

  /**
   * Connect all registered adapters
   */
  async connect(): Promise<void> {
    const connectPromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        try {
          await adapter.connect();
          logger.info(`Connected to event bus adapter: ${name}`);
        } catch (error) {
          logger.error(`Failed to connect to adapter ${name}:`, error);
          throw error;
        }
      }
    );

    await Promise.all(connectPromises);
  }

  /**
   * Disconnect all adapters
   */
  async disconnect(): Promise<void> {
    const disconnectPromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        try {
          await adapter.disconnect();
          logger.info(`Disconnected from event bus adapter: ${name}`);
        } catch (error) {
          logger.error(`Failed to disconnect from adapter ${name}:`, error);
        }
      }
    );

    await Promise.all(disconnectPromises);
  }

  /**
   * Publish an event to all adapters
   */
  async publish<T extends DomainEvent>(
    event: T,
    metadata: Partial<EventEnvelope<T>['metadata']> = {}
  ): Promise<void> {
    const envelope: EventEnvelope<T> = {
      event,
      metadata: {
        correlationId: metadata.correlationId || this.generateCorrelationId(),
        causationId: metadata.causationId,
        userId: metadata.userId,
        timestamp: new Date(),
        retryCount: 0,
        source: 'event-bus',
        ...metadata,
      },
    };

    const topic = this.getTopicForEvent(event);

    if (this.options.enableMetrics) {
      this.metrics.recordPublish(topic);
    }

    // Publish to all adapters with retry logic
    const publishPromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        await this.publishWithRetry(adapter, topic, envelope, name);
      }
    );

    try {
      await Promise.all(publishPromises);
      logger.info(`Published event ${event.eventType} to topic ${topic}`, {
        eventId: event.eventId,
        correlationId: envelope.metadata.correlationId,
      });
    } catch (error) {
      logger.error(`Failed to publish event ${event.eventType}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to events of a specific type
   */
  async subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): Promise<void> {
    const topic = this.getTopicForEventType(eventType);

    // Register handler locally
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
    }
    this.handlers.get(topic)!.push(handler as EventHandler);

    // Subscribe on all adapters
    const subscribePromises = Array.from(this.adapters.entries()).map(
      async ([name, adapter]) => {
        await adapter.subscribe(topic, async (envelope) => {
          await this.handleEvent(envelope, handler as EventHandler);
        });
      }
    );

    await Promise.all(subscribePromises);
    logger.info(`Subscribed to event type ${eventType} on topic ${topic}`);
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(eventType: string): Promise<void> {
    const topic = this.getTopicForEventType(eventType);
    this.handlers.delete(topic);

    const unsubscribePromises = Array.from(this.adapters.values()).map(
      (adapter) => adapter.unsubscribe(topic)
    );

    await Promise.all(unsubscribePromises);
    logger.info(`Unsubscribed from topic ${topic}`);
  }

  private async publishWithRetry<T extends DomainEvent>(
    adapter: EventBusAdapter,
    topic: string,
    envelope: EventEnvelope<T>,
    adapterName: string
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.retryAttempts!; attempt++) {
      try {
        await adapter.publish(topic, envelope);
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `Failed to publish to ${adapterName}, attempt ${attempt + 1}/${this.options.retryAttempts! + 1
          }`,
          { error }
        );

        if (attempt < this.options.retryAttempts!) {
          await this.delay(this.options.retryDelay! * Math.pow(2, attempt));
          envelope.metadata.retryCount = attempt + 1;
        }
      }
    }

    // All retries failed, send to DLQ if enabled
    if (this.options.deadLetterQueue) {
      await this.sendToDeadLetterQueue(topic, envelope, lastError!);
    }

    throw lastError;
  }

  private async handleEvent(
    envelope: EventEnvelope,
    handler: EventHandler
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await handler.handle(envelope);

      if (this.options.enableMetrics) {
        this.metrics.recordHandle(
          envelope.event.eventType,
          Date.now() - startTime,
          true
        );
      }
    } catch (error) {
      logger.error(`Error handling event ${envelope.event.eventType}:`, error);

      if (this.options.enableMetrics) {
        this.metrics.recordHandle(
          envelope.event.eventType,
          Date.now() - startTime,
          false
        );
      }

      // Retry or send to DLQ based on configuration
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
        error: {
          message: error.message,
          stack: error.stack,
          timestamp: new Date(),
        },
      },
    };

    // Publish to DLQ on all adapters
    const dlqPromises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.publish(dlqTopic, dlqEnvelope)
    );

    try {
      await Promise.all(dlqPromises);
      logger.warn(`Sent event to DLQ: ${dlqTopic}`, {
        eventId: envelope.event.eventId,
        error: error.message,
      });
    } catch (dlqError) {
      logger.error('Failed to send event to DLQ:', dlqError);
    }
  }

  private getTopicForEvent(event: DomainEvent): string {
    return `events.${event.aggregateId}.${event.eventType}`.toLowerCase();
  }

  private getTopicForEventType(eventType: string): string {
    return `events.*.${eventType}`.toLowerCase();
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getMetrics(): EventBusMetrics {
    return this.metrics;
  }
}

/**
 * Event Bus Metrics for monitoring
 */
class EventBusMetrics {
  private publishCount = 0;
  private handleCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];

  recordPublish(topic: string): void {
    this.publishCount++;
  }

  recordHandle(eventType: string, latency: number, success: boolean): void {
    this.handleCount++;
    if (!success) {
      this.errorCount++;
    }
    this.latencies.push(latency);

    // Keep only last 1000 latencies
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  getStats() {
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
        : 0;

    return {
      publishCount: this.publishCount,
      handleCount: this.handleCount,
      errorCount: this.errorCount,
      errorRate: this.handleCount > 0 ? this.errorCount / this.handleCount : 0,
      avgLatency,
      p95Latency: this.calculatePercentile(this.latencies, 0.95),
      p99Latency: this.calculatePercentile(this.latencies, 0.99),
    };
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] || 0;
  }
}

export const eventBus = EventBus.getInstance();