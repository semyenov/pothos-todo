import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { MessageBrokerEventMap } from '../core/InfrastructureEventMaps.js';
import { MessageBrokerConfig, MessageBrokerConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export interface Message {
  id: string;
  type: string;
  topic: string;
  payload: any;
  metadata: {
    source: string;
    timestamp: Date;
    correlationId?: string;
    traceId?: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    retryCount: number;
    maxRetries: number;
    ttl?: number;
  };
  routing: {
    exchange?: string;
    routingKey?: string;
    headers?: Record<string, any>;
  };
}

export interface MessageHandler {
  id: string;
  topic: string;
  pattern?: RegExp;
  handler: (message: Message) => Promise<void>;
  options: {
    autoAck: boolean;
    prefetch?: number;
    retryDelay?: number;
    deadLetterQueue?: string;
    concurrency?: number;
  };
}

export interface Queue {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers' | 'priority' | 'delay';
  durable: boolean;
  autoDelete: boolean;
  options: {
    maxLength?: number;
    messageTtl?: number;
    deadLetterExchange?: string;
    priority?: number;
    delayed?: boolean;
  };
  statistics: {
    messageCount: number;
    consumerCount: number;
    publishRate: number;
    consumeRate: number;
  };
}

export interface EventStore {
  streamId: string;
  events: StoredEvent[];
  version: number;
  snapshot?: {
    version: number;
    data: any;
    timestamp: Date;
  };
}

export interface StoredEvent {
  id: string;
  streamId: string;
  type: string;
  data: any;
  metadata: any;
  version: number;
  timestamp: Date;
}

export interface Saga {
  id: string;
  type: string;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'compensating';
  steps: SagaStep[];
  currentStep: number;
  context: any;
  startTime: Date;
  endTime?: Date;
}

export interface SagaStep {
  id: string;
  name: string;
  action: (context: any) => Promise<any>;
  compensation: (context: any) => Promise<void>;
  status: 'pending' | 'completed' | 'failed' | 'compensated';
  result?: any;
  error?: string;
}

const MessageSchema = z.object({
  type: z.string().min(1),
  topic: z.string().min(1),
  payload: z.any(),
  metadata: z.object({
    source: z.string(),
    priority: z.enum(['low', 'normal', 'high', 'critical']),
    retryCount: z.number().min(0),
    maxRetries: z.number().min(0),
    correlationId: z.string().optional(),
    traceId: z.string().optional(),
    ttl: z.number().optional(),
  }).partial(),
  routing: z.object({
    exchange: z.string().optional(),
    routingKey: z.string().optional(),
    headers: z.record(z.any()).optional(),
  }).optional(),
});

/**
 * Advanced Message Broker System
 * Event-driven microservices communication with pub/sub, queues, and event sourcing
 * 
 * @example
 * ```typescript
 * const broker = await MessageBroker.getInstance();
 * 
 * // Subscribe to messages
 * await broker.subscribe('user.created', async (message) => {
 *   console.log('User created:', message.payload);
 * });
 * 
 * // Publish message
 * await broker.publish('user.created', {
 *   userId: '123',
 *   email: 'user@example.com'
 * });
 * 
 * // Create a saga
 * const saga = await broker.createSaga('order-processing', [
 *   {
 *     name: 'reserve-inventory',
 *     action: async (ctx) => reserveInventory(ctx.orderId),
 *     compensation: async (ctx) => releaseInventory(ctx.orderId)
 *   },
 *   {
 *     name: 'charge-payment',
 *     action: async (ctx) => chargePayment(ctx.amount),
 *     compensation: async (ctx) => refundPayment(ctx.chargeId)
 *   }
 * ]);
 * ```
 */
@ServiceConfig({
  schema: MessageBrokerConfigSchema,
  prefix: 'message_broker',
  hot: true,
})
export class MessageBroker extends BaseAsyncService<MessageBrokerConfig, MessageBrokerEventMap> {
  private queues: Map<string, Queue> = new Map();
  private handlers: Map<string, MessageHandler[]> = new Map();
  private eventStore: Map<string, EventStore> = new Map();
  private sagas: Map<string, Saga> = new Map();
  private messageBuffer: Map<string, Message[]> = new Map();
  private deadLetterQueue: Message[] = [];
  private subscriptions: Map<string, Set<string>> = new Map();

  private processingInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private sagaInterval?: NodeJS.Timeout;

  // Metrics
  private publishedCount = 0;
  private consumedCount = 0;
  private failedCount = 0;

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<MessageBroker> {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'message-broker';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Event-driven message broker with pub/sub and event sourcing';
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('MessageBroker initializing', {
      brokerType: this.config.broker.type,
      eventSourcing: this.config.eventSourcing.enabled,
      saga: this.config.saga.enabled,
    });

    // Setup default queues
    this.setupDefaultQueues();
  }

  /**
   * Start the message broker
   */
  protected async onStart(): Promise<void> {
    // Start message processing
    this.startMessageProcessing();
    
    // Start event store cleanup
    if (this.config.eventSourcing.enabled) {
      this.startEventStoreCleanup();
    }
    
    // Start saga processor
    if (this.config.saga.enabled) {
      this.startSagaProcessor();
    }

    logger.info('Message Broker started', {
      queues: this.queues.size,
      handlers: this.handlers.size,
    });
  }

  /**
   * Stop the message broker
   */
  protected async onStop(): Promise<void> {
    // Clear intervals
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.sagaInterval) {
      clearInterval(this.sagaInterval);
      this.sagaInterval = undefined;
    }

    // Process remaining messages
    await this.drainQueues();

    logger.info('Message Broker stopped');
  }

  /**
   * Check broker health
   */
  @HealthCheck({
    name: 'broker:health',
    critical: true,
    interval: 30000,
  })
  async checkBrokerHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const deadLetterSize = this.deadLetterQueue.length;
    const totalQueued = Array.from(this.messageBuffer.values())
      .reduce((sum, messages) => sum + messages.length, 0);

    if (deadLetterSize > 1000) {
      return { 
        status: 'unhealthy', 
        message: `Dead letter queue too large: ${deadLetterSize} messages` 
      };
    } else if (totalQueued > 10000) {
      return { 
        status: 'degraded', 
        message: `High message backlog: ${totalQueued} messages queued` 
      };
    }

    return { 
      status: 'healthy', 
      message: `Broker healthy, ${totalQueued} messages queued` 
    };
  }

  /**
   * Create a queue
   */
  @Metric({ name: 'broker.queue.created' })
  async createQueue(queueConfig: Omit<Queue, 'statistics'>): Promise<void> {
    const queue: Queue = {
      ...queueConfig,
      statistics: {
        messageCount: 0,
        consumerCount: 0,
        publishRate: 0,
        consumeRate: 0,
      },
    };

    this.queues.set(queue.name, queue);
    this.messageBuffer.set(queue.name, []);

    this.emit('queue:created', {
      name: queue.name,
      type: queue.type === 'delay' ? 'dead-letter' : 
            queue.type === 'priority' ? 'priority' : 'standard',
    });

    logger.info('Queue created', {
      name: queue.name,
      type: queue.type,
      durable: queue.durable,
    });
  }

  /**
   * Publish a message
   */
  @Metric({ name: 'broker.message.published', recordDuration: true })
  @Retry({ attempts: 3, delay: 1000 })
  async publish(
    topic: string, 
    payload: any, 
    options?: Partial<Message['metadata'] & Message['routing']>
  ): Promise<string> {
    const messageId = uuidv4();
    
    const message: Message = {
      id: messageId,
      type: options?.type || 'generic',
      topic,
      payload,
      metadata: {
        source: this.metadata.name,
        timestamp: new Date(),
        priority: options?.priority || 'normal',
        retryCount: 0,
        maxRetries: options?.maxRetries || this.config.deadLetter.maxRetries,
        correlationId: options?.correlationId,
        traceId: options?.traceId,
        ttl: options?.ttl,
      },
      routing: {
        exchange: options?.exchange,
        routingKey: options?.routingKey || topic,
        headers: options?.headers,
      },
    };

    // Validate message
    const validation = MessageSchema.safeParse(message);
    if (!validation.success) {
      throw new Error(`Invalid message: ${validation.error.message}`);
    }

    // Add to appropriate queue
    const queueName = this.getQueueForTopic(topic);
    const queue = this.messageBuffer.get(queueName) || [];
    queue.push(message);
    this.messageBuffer.set(queueName, queue);

    // Update statistics
    this.publishedCount++;
    const queueInfo = this.queues.get(queueName);
    if (queueInfo) {
      queueInfo.statistics.messageCount++;
      queueInfo.statistics.publishRate++;
    }

    // Store in event store if enabled
    if (this.config.eventSourcing.enabled) {
      await this.storeEvent(message);
    }

    this.emit('message:published', {
      topic,
      messageId,
      size: JSON.stringify(payload).length,
    });

    logger.debug('Message published', {
      messageId,
      topic,
      priority: message.metadata.priority,
    });

    return messageId;
  }

  /**
   * Subscribe to messages
   */
  @Metric({ name: 'broker.subscription.created' })
  async subscribe(
    topic: string,
    handler: (message: Message) => Promise<void>,
    options?: Partial<MessageHandler['options']>
  ): Promise<string> {
    const handlerId = uuidv4();
    
    const messageHandler: MessageHandler = {
      id: handlerId,
      topic,
      pattern: this.createTopicPattern(topic),
      handler,
      options: {
        autoAck: options?.autoAck ?? true,
        prefetch: options?.prefetch ?? 1,
        retryDelay: options?.retryDelay ?? 5000,
        deadLetterQueue: options?.deadLetterQueue,
        concurrency: options?.concurrency ?? 1,
      },
    };

    const handlers = this.handlers.get(topic) || [];
    handlers.push(messageHandler);
    this.handlers.set(topic, handlers);

    // Track subscription
    const subs = this.subscriptions.get(topic) || new Set();
    subs.add(handlerId);
    this.subscriptions.set(topic, subs);

    logger.info('Subscription created', {
      handlerId,
      topic,
      options: messageHandler.options,
    });

    return handlerId;
  }

  /**
   * Unsubscribe from messages
   */
  async unsubscribe(handlerId: string): Promise<void> {
    for (const [topic, handlers] of this.handlers.entries()) {
      const filtered = handlers.filter(h => h.id !== handlerId);
      if (filtered.length !== handlers.length) {
        this.handlers.set(topic, filtered);
        
        const subs = this.subscriptions.get(topic);
        if (subs) {
          subs.delete(handlerId);
        }
        
        logger.info('Subscription removed', { handlerId, topic });
        return;
      }
    }
  }

  /**
   * Create a saga
   */
  @Metric({ name: 'broker.saga.created' })
  async createSaga(
    type: string,
    steps: Omit<SagaStep, 'id' | 'status' | 'result' | 'error'>[],
    context?: any
  ): Promise<string> {
    if (!this.config.saga.enabled) {
      throw new Error('Saga functionality is not enabled');
    }

    const sagaId = uuidv4();
    
    const saga: Saga = {
      id: sagaId,
      type,
      state: 'pending',
      steps: steps.map((step, index) => ({
        ...step,
        id: `${sagaId}_step_${index}`,
        status: 'pending',
      })),
      currentStep: 0,
      context: context || {},
      startTime: new Date(),
    };

    this.sagas.set(sagaId, saga);

    this.emit('saga:started', {
      sagaId,
      type,
    });

    logger.info('Saga created', {
      sagaId,
      type,
      steps: saga.steps.length,
    });

    return sagaId;
  }

  /**
   * Execute a saga
   */
  @Retry({ attempts: 3, delay: 5000 })
  @CircuitBreaker({ threshold: 5, timeout: 300000 })
  async executeSaga(sagaId: string): Promise<void> {
    const saga = this.sagas.get(sagaId);
    if (!saga) {
      throw new Error(`Saga ${sagaId} not found`);
    }

    saga.state = 'running';

    try {
      // Execute steps in order
      for (let i = saga.currentStep; i < saga.steps.length; i++) {
        const step = saga.steps[i];
        
        try {
          logger.info('Executing saga step', {
            sagaId,
            step: step.name,
            index: i,
          });

          step.result = await step.action(saga.context);
          step.status = 'completed';
          saga.currentStep = i + 1;

          this.emit('saga:step:completed', {
            sagaId,
            step: step.name,
          });

        } catch (error) {
          step.status = 'failed';
          step.error = (error as Error).message;
          
          logger.error('Saga step failed', {
            sagaId,
            step: step.name,
            error: (error as Error).message,
          });

          // Start compensation
          await this.compensateSaga(saga);
          throw error;
        }
      }

      // All steps completed successfully
      saga.state = 'completed';
      saga.endTime = new Date();

      this.emit('saga:completed', {
        sagaId,
        duration: saga.endTime.getTime() - saga.startTime.getTime(),
      });

      logger.info('Saga completed successfully', {
        sagaId,
        duration: saga.endTime.getTime() - saga.startTime.getTime(),
      });

    } catch (error) {
      saga.state = 'failed';
      saga.endTime = new Date();
      throw error;
    }
  }

  /**
   * Compensate a failed saga
   */
  private async compensateSaga(saga: Saga): Promise<void> {
    saga.state = 'compensating';

    this.emit('saga:compensated', {
      sagaId: saga.id,
      reason: 'Step failure',
    });

    // Compensate in reverse order
    for (let i = saga.currentStep - 1; i >= 0; i--) {
      const step = saga.steps[i];
      
      if (step.status === 'completed') {
        try {
          await step.compensation(saga.context);
          step.status = 'compensated';
          
          logger.info('Saga step compensated', {
            sagaId: saga.id,
            step: step.name,
          });
        } catch (error) {
          logger.error('Saga compensation failed', {
            sagaId: saga.id,
            step: step.name,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  /**
   * Store event in event store
   */
  private async storeEvent(message: Message): Promise<void> {
    const streamId = `${message.topic}:${message.metadata.correlationId || 'global'}`;
    
    let store = this.eventStore.get(streamId);
    if (!store) {
      store = {
        streamId,
        events: [],
        version: 0,
      };
      this.eventStore.set(streamId, store);
    }

    const event: StoredEvent = {
      id: message.id,
      streamId,
      type: message.type,
      data: message.payload,
      metadata: message.metadata,
      version: ++store.version,
      timestamp: message.metadata.timestamp,
    };

    store.events.push(event);

    this.emit('event:stored', {
      streamId,
      eventType: event.type,
      version: event.version,
    });

    // Create snapshot if needed
    if (store.version % this.config.eventSourcing.snapshotInterval === 0) {
      await this.createSnapshot(store);
    }
  }

  /**
   * Create event store snapshot
   */
  private async createSnapshot(store: EventStore): Promise<void> {
    // Aggregate events into snapshot
    const snapshot = {
      version: store.version,
      data: store.events.reduce((acc, event) => {
        // Simple aggregation - in real implementation would be more sophisticated
        return { ...acc, ...event.data };
      }, {}),
      timestamp: new Date(),
    };

    store.snapshot = snapshot;

    this.emit('snapshot:created', {
      streamId: store.streamId,
      version: snapshot.version,
    });

    logger.debug('Event store snapshot created', {
      streamId: store.streamId,
      version: snapshot.version,
    });
  }

  /**
   * Process messages from queues
   */
  private async processMessages(): Promise<void> {
    for (const [queueName, messages] of this.messageBuffer.entries()) {
      if (messages.length === 0) continue;

      // Get handlers for this queue
      const handlers = this.getHandlersForQueue(queueName);
      if (handlers.length === 0) continue;

      // Process messages in batches
      const batch = messages.splice(0, this.config.performance.batchSize);
      
      for (const message of batch) {
        // Check TTL
        if (message.metadata.ttl) {
          const age = Date.now() - message.metadata.timestamp.getTime();
          if (age > message.metadata.ttl) {
            logger.warn('Message expired', {
              messageId: message.id,
              topic: message.topic,
              age,
              ttl: message.metadata.ttl,
            });
            continue;
          }
        }

        // Process with matching handlers
        for (const handler of handlers) {
          if (this.matchesTopic(message.topic, handler.pattern)) {
            await this.processMessage(message, handler);
          }
        }
      }

      // Update queue statistics
      const queue = this.queues.get(queueName);
      if (queue) {
        queue.statistics.messageCount = messages.length;
        queue.statistics.consumeRate = batch.length;
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: Message, handler: MessageHandler): Promise<void> {
    try {
      await handler.handler(message);
      
      this.consumedCount++;
      
      this.emit('message:consumed', {
        topic: message.topic,
        messageId: message.id,
        consumer: handler.id,
      });

    } catch (error) {
      message.metadata.retryCount++;
      
      if (message.metadata.retryCount >= message.metadata.maxRetries) {
        // Move to dead letter queue
        this.deadLetterQueue.push(message);
        
        this.emit('message:failed', {
          topic: message.topic,
          messageId: message.id,
          error: error as Error,
        });
        
        logger.error('Message moved to dead letter queue', {
          messageId: message.id,
          topic: message.topic,
          error: (error as Error).message,
        });
      } else {
        // Retry later
        setTimeout(() => {
          const queue = this.messageBuffer.get(this.getQueueForTopic(message.topic)) || [];
          queue.push(message);
          this.messageBuffer.set(this.getQueueForTopic(message.topic), queue);
          
          this.emit('message:retried', {
            topic: message.topic,
            messageId: message.id,
            attempt: message.metadata.retryCount,
          });
        }, handler.options.retryDelay || this.config.deadLetter.retryDelay);
      }
      
      this.failedCount++;
    }
  }

  /**
   * Get queue name for topic
   */
  private getQueueForTopic(topic: string): string {
    // Simple mapping - in real implementation would be more sophisticated
    const parts = topic.split('.');
    return parts[0] || 'default';
  }

  /**
   * Get handlers for queue
   */
  private getHandlersForQueue(queueName: string): MessageHandler[] {
    const allHandlers: MessageHandler[] = [];
    
    for (const [topic, handlers] of this.handlers.entries()) {
      if (topic.startsWith(queueName)) {
        allHandlers.push(...handlers);
      }
    }
    
    return allHandlers;
  }

  /**
   * Create topic pattern
   */
  private createTopicPattern(topic: string): RegExp {
    // Convert topic pattern to regex (e.g., "user.*" -> /^user\..*$/)
    const pattern = topic
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\+/g, '[^.]+');
    return new RegExp(`^${pattern}$`);
  }

  /**
   * Check if topic matches pattern
   */
  private matchesTopic(topic: string, pattern?: RegExp): boolean {
    if (!pattern) return true;
    return pattern.test(topic);
  }

  /**
   * Setup default queues
   */
  private setupDefaultQueues(): void {
    // Create default queues
    const defaultQueues = [
      {
        name: 'default',
        type: 'direct' as const,
        durable: true,
        autoDelete: false,
        options: {},
      },
      {
        name: 'events',
        type: 'topic' as const,
        durable: true,
        autoDelete: false,
        options: {},
      },
      {
        name: 'commands',
        type: 'direct' as const,
        durable: true,
        autoDelete: false,
        options: {
          priority: 10,
        },
      },
    ];

    for (const queue of defaultQueues) {
      this.createQueue(queue).catch(error => {
        logger.error('Failed to create default queue', {
          queue: queue.name,
          error,
        });
      });
    }
  }

  /**
   * Start message processing loop
   */
  private startMessageProcessing(): void {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processMessages();
      } catch (error) {
        logger.error('Message processing error', { error });
      }
    }, 100); // Process every 100ms
  }

  /**
   * Start event store cleanup
   */
  private startEventStoreCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const retention = this.config.eventSourcing.retention * 1000;
      const cutoff = Date.now() - retention;

      for (const [streamId, store] of this.eventStore.entries()) {
        // Remove old events (keep after snapshot)
        if (store.snapshot) {
          store.events = store.events.filter(
            event => event.version > store.snapshot!.version ||
                    event.timestamp.getTime() > cutoff
          );
        }
      }
    }, 3600000); // Every hour
  }

  /**
   * Start saga processor
   */
  private startSagaProcessor(): void {
    this.sagaInterval = setInterval(async () => {
      // Process pending sagas
      for (const [sagaId, saga] of this.sagas.entries()) {
        if (saga.state === 'pending') {
          this.executeSaga(sagaId).catch(error => {
            logger.error('Saga execution failed', {
              sagaId,
              error,
            });
          });
        }

        // Clean up old completed/failed sagas
        if (saga.endTime) {
          const age = Date.now() - saga.endTime.getTime();
          if (age > 86400000) { // 24 hours
            this.sagas.delete(sagaId);
          }
        }

        // Timeout running sagas
        if (saga.state === 'running' && !saga.endTime) {
          const runtime = Date.now() - saga.startTime.getTime();
          if (runtime > this.config.saga.timeout) {
            saga.state = 'failed';
            saga.endTime = new Date();
            await this.compensateSaga(saga);
          }
        }
      }
    }, 5000); // Every 5 seconds
  }

  /**
   * Drain all queues
   */
  private async drainQueues(): Promise<void> {
    // Process all remaining messages
    let totalMessages = 0;
    
    for (const messages of this.messageBuffer.values()) {
      totalMessages += messages.length;
    }

    if (totalMessages > 0) {
      logger.info('Draining queues', { totalMessages });
      
      // Process messages one more time
      await this.processMessages();
    }
  }

  /**
   * Get broker statistics
   */
  async getStats(): Promise<{
    queues: number;
    handlers: number;
    published: number;
    consumed: number;
    failed: number;
    deadLetter: number;
    eventStreams: number;
    activeSagas: number;
  }> {
    return {
      queues: this.queues.size,
      handlers: Array.from(this.handlers.values()).flat().length,
      published: this.publishedCount,
      consumed: this.consumedCount,
      failed: this.failedCount,
      deadLetter: this.deadLetterQueue.length,
      eventStreams: this.eventStore.size,
      activeSagas: Array.from(this.sagas.values()).filter(s => !s.endTime).length,
    };
  }

  /**
   * Replay events from event store
   */
  @Metric({ name: 'broker.events.replayed' })
  async replayEvents(
    streamId: string,
    fromVersion: number,
    toVersion?: number
  ): Promise<void> {
    const store = this.eventStore.get(streamId);
    if (!store) {
      throw new Error(`Event stream ${streamId} not found`);
    }

    const events = store.events.filter(e => {
      const afterFrom = e.version >= fromVersion;
      const beforeTo = !toVersion || e.version <= toVersion;
      return afterFrom && beforeTo;
    });

    this.emit('event:replayed', {
      streamId,
      fromVersion,
      toVersion: toVersion || store.version,
    });

    logger.info('Events replayed', {
      streamId,
      count: events.length,
      fromVersion,
      toVersion: toVersion || store.version,
    });

    // Re-publish events
    for (const event of events) {
      await this.publish(streamId, event.data, {
        correlationId: event.metadata.correlationId,
        type: event.type,
      });
    }
  }
}