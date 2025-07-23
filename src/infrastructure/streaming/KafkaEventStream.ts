import { Kafka, Producer, Consumer, KafkaMessage } from 'kafkajs';
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';
import { logger } from '@/logger';
import { DomainEvent } from '@/domain/events/DomainEvent';
import { ErrorHandler } from '@/infrastructure/core/ErrorHandler';

export interface StreamEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: any;
  metadata: {
    timestamp: Date;
    userId?: string;
    correlationId?: string;
    causationId?: string;
  };
}

export interface StreamConsumerConfig {
  groupId: string;
  topics: string[];
  handler: (event: StreamEvent) => Promise<void>;
  options?: {
    fromBeginning?: boolean;
    autoCommit?: boolean;
    batchSize?: number;
  };
}

export interface StreamProducerConfig {
  topic: string;
  partitionKey?: string;
  headers?: Record<string, string>;
}

export class KafkaEventStream extends AsyncSingletonService<KafkaEventStream> {
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private errorHandler = ErrorHandler.getInstance();
  
  protected constructor() {
    super();
  }

  static async getInstance(): Promise<KafkaEventStream> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing Kafka Event Stream...');
      
      const brokers = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];
      const clientId = process.env.KAFKA_CLIENT_ID || 'pothos-todo-api';
      
      this.kafka = new Kafka({
        clientId,
        brokers,
        connectionTimeout: 3000,
        authenticationTimeout: 1000,
        reauthenticationThreshold: 10000,
        retry: {
          initialRetryTime: 100,
          retries: 8,
        },
        logLevel: process.env.NODE_ENV === 'development' ? 0 : 2,
      });

      // Create producer
      this.producer = this.kafka.producer({
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000,
        retry: {
          retries: 5,
        },
      });

      await this.producer.connect();
      
      logger.info('Kafka Event Stream initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Kafka Event Stream', error);
      throw error;
    }
  }

  async publishEvent(
    event: DomainEvent | StreamEvent,
    config: StreamProducerConfig
  ): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    const streamEvent = this.toStreamEvent(event);
    
    try {
      await this.errorHandler.handleAsync(
        async () => {
          await this.producer!.send({
            topic: config.topic,
            messages: [{
              key: config.partitionKey || streamEvent.aggregateId,
              value: JSON.stringify(streamEvent),
              headers: {
                eventType: streamEvent.type,
                aggregateId: streamEvent.aggregateId,
                timestamp: streamEvent.metadata.timestamp.toISOString(),
                ...config.headers,
              },
            }],
          });
        },
        { 
          operation: 'publishEvent',
          eventType: streamEvent.type,
          topic: config.topic,
        }
      );

      logger.debug('Event published to stream', {
        eventId: streamEvent.id,
        eventType: streamEvent.type,
        topic: config.topic,
      });
    } catch (error) {
      logger.error('Failed to publish event to stream', {
        eventId: streamEvent.id,
        eventType: streamEvent.type,
        topic: config.topic,
        error,
      });
      throw error;
    }
  }

  async publishBatch(
    events: (DomainEvent | StreamEvent)[],
    config: StreamProducerConfig
  ): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    const messages = events.map(event => {
      const streamEvent = this.toStreamEvent(event);
      return {
        key: config.partitionKey || streamEvent.aggregateId,
        value: JSON.stringify(streamEvent),
        headers: {
          eventType: streamEvent.type,
          aggregateId: streamEvent.aggregateId,
          timestamp: streamEvent.metadata.timestamp.toISOString(),
          ...config.headers,
        },
      };
    });

    try {
      await this.errorHandler.handleAsync(
        async () => {
          await this.producer!.send({
            topic: config.topic,
            messages,
          });
        },
        { 
          operation: 'publishBatch',
          eventCount: events.length,
          topic: config.topic,
        }
      );

      logger.debug('Event batch published to stream', {
        eventCount: events.length,
        topic: config.topic,
      });
    } catch (error) {
      logger.error('Failed to publish event batch to stream', {
        eventCount: events.length,
        topic: config.topic,
        error,
      });
      throw error;
    }
  }

  async subscribe(consumerConfig: StreamConsumerConfig): Promise<void> {
    if (!this.kafka) {
      throw new Error('Kafka not initialized');
    }

    const consumer = this.kafka.consumer({
      groupId: consumerConfig.groupId,
      sessionTimeout: 30000,
      rebalanceTimeout: 60000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576,
      retry: {
        retries: 5,
      },
    });

    await consumer.connect();
    
    await consumer.subscribe({
      topics: consumerConfig.topics,
      fromBeginning: consumerConfig.options?.fromBeginning || false,
    });

    await consumer.run({
      autoCommit: consumerConfig.options?.autoCommit !== false,
      partitionsConsumedConcurrently: 1,
      eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
        const batchSize = consumerConfig.options?.batchSize || 100;
        const messages = batch.messages.slice(0, batchSize);
        
        for (const message of messages) {
          try {
            await this.processMessage(message, consumerConfig.handler);
            resolveOffset(message.offset);
            await heartbeat();
          } catch (error) {
            logger.error('Failed to process stream message', {
              partition: batch.partition,
              offset: message.offset,
              error,
            });
            
            // Dead letter queue logic could go here
            throw error;
          }
        }
        
        await commitOffsetsIfNecessary();
      },
    });

    this.consumers.set(consumerConfig.groupId, consumer);
    
    logger.info('Kafka consumer subscribed', {
      groupId: consumerConfig.groupId,
      topics: consumerConfig.topics,
    });
  }

  async createTopics(topics: Array<{ topic: string; numPartitions?: number; replicationFactor?: number }>): Promise<void> {
    if (!this.kafka) {
      throw new Error('Kafka not initialized');
    }

    const admin = this.kafka.admin();
    await admin.connect();

    try {
      const existingTopics = await admin.listTopics();
      const topicsToCreate = topics.filter(t => !existingTopics.includes(t.topic));

      if (topicsToCreate.length > 0) {
        await admin.createTopics({
          topics: topicsToCreate.map(t => ({
            topic: t.topic,
            numPartitions: t.numPartitions || 3,
            replicationFactor: t.replicationFactor || 1,
          })),
        });

        logger.info('Kafka topics created', {
          topics: topicsToCreate.map(t => t.topic),
        });
      }
    } finally {
      await admin.disconnect();
    }
  }

  async getStreamHealth(): Promise<{
    producer: { connected: boolean };
    consumers: Array<{ groupId: string; connected: boolean }>;
    topics: string[];
  }> {
    const health = {
      producer: { connected: false },
      consumers: [] as Array<{ groupId: string; connected: boolean }>,
      topics: [] as string[],
    };

    if (this.producer) {
      // Producer doesn't have a direct connected check, assume connected if exists
      health.producer.connected = true;
    }

    for (const [groupId, consumer] of this.consumers) {
      health.consumers.push({
        groupId,
        connected: true, // Consumer doesn't expose connection status directly
      });
    }

    if (this.kafka) {
      const admin = this.kafka.admin();
      try {
        await admin.connect();
        health.topics = await admin.listTopics();
        await admin.disconnect();
      } catch (error) {
        logger.error('Failed to get topic list', error);
      }
    }

    return health;
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnecting Kafka Event Stream...');

    try {
      // Disconnect all consumers
      for (const [groupId, consumer] of this.consumers) {
        await consumer.disconnect();
        logger.debug('Consumer disconnected', { groupId });
      }
      this.consumers.clear();

      // Disconnect producer
      if (this.producer) {
        await this.producer.disconnect();
        this.producer = null;
        logger.debug('Producer disconnected');
      }

      logger.info('Kafka Event Stream disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting Kafka Event Stream', error);
      throw error;
    }
  }

  private async processMessage(
    message: KafkaMessage,
    handler: (event: StreamEvent) => Promise<void>
  ): Promise<void> {
    if (!message.value) {
      return;
    }

    try {
      const streamEvent: StreamEvent = JSON.parse(message.value.toString());
      
      // Validate event structure
      if (!streamEvent.id || !streamEvent.type || !streamEvent.aggregateId) {
        throw new Error('Invalid stream event structure');
      }

      await handler(streamEvent);
      
      logger.debug('Stream event processed', {
        eventId: streamEvent.id,
        eventType: streamEvent.type,
      });
    } catch (error) {
      logger.error('Failed to process stream message', {
        messageValue: message.value?.toString(),
        error,
      });
      throw error;
    }
  }

  private toStreamEvent(event: DomainEvent | StreamEvent): StreamEvent {
    if ('metadata' in event && 'payload' in event) {
      return event as StreamEvent;
    }

    const domainEvent = event as DomainEvent;
    return {
      id: domainEvent.eventId,
      type: domainEvent.eventType,
      aggregateId: domainEvent.aggregateId,
      payload: domainEvent,
      metadata: {
        timestamp: domainEvent.occurredAt,
        correlationId: domainEvent.eventId,
      },
    };
  }
}

// Event stream topics
export const StreamTopics = {
  DOMAIN_EVENTS: 'domain-events',
  USER_EVENTS: 'user-events',
  TODO_EVENTS: 'todo-events',
  AI_EVENTS: 'ai-events',
  ANALYTICS_EVENTS: 'analytics-events',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOGS: 'audit-logs',
} as const;

// Convenience functions
export async function publishDomainEvent(
  event: DomainEvent,
  topic: string = StreamTopics.DOMAIN_EVENTS
): Promise<void> {
  const stream = await KafkaEventStream.getInstance();
  await stream.publishEvent(event, { topic });
}

export async function createEventConsumer(
  groupId: string,
  topics: string[],
  handler: (event: StreamEvent) => Promise<void>
): Promise<void> {
  const stream = await KafkaEventStream.getInstance();
  await stream.subscribe({
    groupId,
    topics,
    handler,
  });
}