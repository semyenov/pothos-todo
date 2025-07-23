import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';
import { KafkaEventStream, StreamEvent, createEventConsumer } from '@/infrastructure/streaming/KafkaEventStream';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager';
import { logger } from '@/logger';
import { ErrorHandler } from '@/infrastructure/core/ErrorHandler';
import { nanoid } from 'nanoid';

export interface ProjectionDefinition {
  name: string;
  version: number;
  topics: string[];
  eventHandlers: Map<string, ProjectionEventHandler>;
  options?: {
    batchSize?: number;
    checkpointInterval?: number;
    enableSnapshots?: boolean;
    snapshotInterval?: number;
  };
}

export interface ProjectionEventHandler {
  (event: StreamEvent, projection: ProjectionContext): Promise<void>;
}

export interface ProjectionContext {
  projectionName: string;
  checkpoint: ProjectionCheckpoint;
  readModel: ReadModelStore;
  emit: (event: any) => Promise<void>;
}

export interface ProjectionCheckpoint {
  projectionName: string;
  position: {
    topic: string;
    partition: number;
    offset: string;
  };
  timestamp: Date;
  eventCount: number;
}

export interface ReadModelStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  mset<T>(entries: Array<[string, T]>, ttl?: number): Promise<void>;
  increment(key: string, by?: number): Promise<number>;
  expire(key: string, ttl: number): Promise<void>;
  exists(key: string): Promise<boolean>;
  scan(pattern: string, count?: number): Promise<string[]>;
}

class RedisReadModelStore implements ReadModelStore {
  constructor(
    private redis: RedisClusterManager,
    private projectionName: string
  ) {}

  private getKey(key: string): string {
    return `projection:${this.projectionName}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.redis.get(this.getKey(key));
    return result ? JSON.parse(result) : null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const redisKey = this.getKey(key);
    await this.redis.set(redisKey, JSON.stringify(value), ttl);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.getKey(key));
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const redisKeys = keys.map(key => this.getKey(key));
    const results = await this.redis.mget(redisKeys);
    return results.map(result => result ? JSON.parse(result) : null);
  }

  async mset<T>(entries: Array<[string, T]>, ttl?: number): Promise<void> {
    const redisEntries: Array<[string, string]> = entries.map(([key, value]) => [
      this.getKey(key),
      JSON.stringify(value)
    ]);
    
    await this.redis.mset(redisEntries, ttl);
  }

  async increment(key: string, by: number = 1): Promise<number> {
    return await this.redis.incr(this.getKey(key), by);
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.redis.expire(this.getKey(key), ttl);
  }

  async exists(key: string): Promise<boolean> {
    return await this.redis.exists(this.getKey(key));
  }

  async scan(pattern: string, count: number = 100): Promise<string[]> {
    const redisPattern = this.getKey(pattern);
    return await this.redis.scan(redisPattern, count);
  }
}

export class EventProjectionManager extends AsyncSingletonService<EventProjectionManager> {
  private projections: Map<string, ProjectionDefinition> = new Map();
  private checkpoints: Map<string, ProjectionCheckpoint> = new Map();
  private readModelStores: Map<string, ReadModelStore> = new Map();
  private eventStream: KafkaEventStream | null = null;
  private redis: RedisClusterManager | null = null;
  private errorHandler = ErrorHandler.getInstance();
  private running = false;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<EventProjectionManager> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing Event Projection Manager...');
      
      this.eventStream = await KafkaEventStream.getInstance();
      this.redis = await RedisClusterManager.getInstance();
      
      // Load existing checkpoints
      await this.loadCheckpoints();
      
      logger.info('Event Projection Manager initialized');
    } catch (error) {
      logger.error('Failed to initialize Event Projection Manager', error);
      throw error;
    }
  }

  async registerProjection(projection: ProjectionDefinition): Promise<void> {
    logger.info('Registering projection', { 
      name: projection.name,
      version: projection.version,
      topics: projection.topics,
    });

    // Validate projection
    if (!projection.name || !projection.topics.length || !projection.eventHandlers.size) {
      throw new Error('Invalid projection definition');
    }

    // Check for version conflicts
    const existing = this.projections.get(projection.name);
    if (existing && existing.version >= projection.version) {
      throw new Error(`Projection ${projection.name} version ${projection.version} is not newer than existing version ${existing.version}`);
    }

    this.projections.set(projection.name, projection);
    
    // Create read model store
    const readModelStore = new RedisReadModelStore(this.redis!, projection.name);
    this.readModelStores.set(projection.name, readModelStore);

    // Initialize checkpoint if not exists
    if (!this.checkpoints.has(projection.name)) {
      const checkpoint: ProjectionCheckpoint = {
        projectionName: projection.name,
        position: {
          topic: projection.topics[0],
          partition: 0,
          offset: '0',
        },
        timestamp: new Date(),
        eventCount: 0,
      };
      
      this.checkpoints.set(projection.name, checkpoint);
      await this.saveCheckpoint(checkpoint);
    }

    logger.info('Projection registered successfully', { name: projection.name });
  }

  async startProjections(): Promise<void> {
    if (this.running) {
      logger.warn('Projections already running');
      return;
    }

    logger.info('Starting event projections...');
    this.running = true;

    for (const [projectionName, projection] of this.projections) {
      await this.startProjection(projectionName, projection);
    }

    logger.info('All projections started');
  }

  async stopProjections(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping event projections...');
    this.running = false;

    // Save all checkpoints
    for (const checkpoint of this.checkpoints.values()) {
      await this.saveCheckpoint(checkpoint);
    }

    logger.info('All projections stopped');
  }

  async rebuildProjection(projectionName: string): Promise<void> {
    logger.info('Rebuilding projection', { projectionName });

    const projection = this.projections.get(projectionName);
    if (!projection) {
      throw new Error(`Projection ${projectionName} not found`);
    }

    // Clear existing read model
    const readModelStore = this.readModelStores.get(projectionName);
    if (readModelStore) {
      const keys = await readModelStore.scan('*');
      for (const key of keys) {
        await readModelStore.delete(key.replace(`projection:${projectionName}:`, ''));
      }
    }

    // Reset checkpoint
    const checkpoint: ProjectionCheckpoint = {
      projectionName,
      position: {
        topic: projection.topics[0],
        partition: 0,
        offset: '0',
      },
      timestamp: new Date(),
      eventCount: 0,
    };

    this.checkpoints.set(projectionName, checkpoint);
    await this.saveCheckpoint(checkpoint);

    // Restart projection if running
    if (this.running) {
      await this.startProjection(projectionName, projection);
    }

    logger.info('Projection rebuilt', { projectionName });
  }

  async getProjectionStats(): Promise<Array<{
    name: string;
    version: number;
    eventCount: number;
    lastProcessed: Date;
    topics: string[];
    running: boolean;
  }>> {
    const stats = [];

    for (const [name, projection] of this.projections) {
      const checkpoint = this.checkpoints.get(name);
      
      stats.push({
        name,
        version: projection.version,
        eventCount: checkpoint?.eventCount || 0,
        lastProcessed: checkpoint?.timestamp || new Date(0),
        topics: projection.topics,
        running: this.running,
      });
    }

    return stats;
  }

  async queryReadModel<T>(
    projectionName: string,
    query: {
      key?: string;
      keys?: string[];
      pattern?: string;
      operation?: 'get' | 'mget' | 'scan' | 'exists';
    }
  ): Promise<T | T[] | null> {
    const readModelStore = this.readModelStores.get(projectionName);
    if (!readModelStore) {
      throw new Error(`Read model store for projection ${projectionName} not found`);
    }

    switch (query.operation || 'get') {
      case 'get':
        if (!query.key) throw new Error('Key required for get operation');
        return await readModelStore.get<T>(query.key);
        
      case 'mget':
        if (!query.keys) throw new Error('Keys required for mget operation');
        return await readModelStore.mget<T>(query.keys);
        
      case 'scan':
        if (!query.pattern) throw new Error('Pattern required for scan operation');
        const keys = await readModelStore.scan(query.pattern);
        return keys as any;
        
      case 'exists':
        if (!query.key) throw new Error('Key required for exists operation');
        return await readModelStore.exists(query.key) as any;
        
      default:
        throw new Error(`Unknown query operation: ${query.operation}`);
    }
  }

  private async startProjection(
    projectionName: string,
    projection: ProjectionDefinition
  ): Promise<void> {
    const groupId = `projection-${projectionName}-${projection.version}`;
    
    await createEventConsumer(
      groupId,
      projection.topics,
      async (event: StreamEvent) => {
        await this.processProjectionEvent(projectionName, projection, event);
      }
    );

    logger.info('Projection consumer started', { 
      projectionName,
      groupId,
      topics: projection.topics,
    });
  }

  private async processProjectionEvent(
    projectionName: string,
    projection: ProjectionDefinition,
    event: StreamEvent
  ): Promise<void> {
    const handler = projection.eventHandlers.get(event.type);
    if (!handler) {
      // Event type not handled by this projection
      return;
    }

    try {
      const checkpoint = this.checkpoints.get(projectionName)!;
      const readModelStore = this.readModelStores.get(projectionName)!;

      const context: ProjectionContext = {
        projectionName,
        checkpoint,
        readModel: readModelStore,
        emit: async (outputEvent: any) => {
          // Emit derived events if needed
          await this.eventStream!.publishEvent(outputEvent, {
            topic: `projection-${projectionName}`,
          });
        },
      };

      await handler(event, context);

      // Update checkpoint
      checkpoint.eventCount++;
      checkpoint.timestamp = new Date();
      this.checkpoints.set(projectionName, checkpoint);

      // Save checkpoint periodically
      const checkpointInterval = projection.options?.checkpointInterval || 100;
      if (checkpoint.eventCount % checkpointInterval === 0) {
        await this.saveCheckpoint(checkpoint);
      }

      logger.debug('Projection event processed', {
        projectionName,
        eventType: event.type,
        eventId: event.id,
      });
    } catch (error) {
      logger.error('Failed to process projection event', {
        projectionName,
        eventType: event.type,
        eventId: event.id,
        error,
      });

      // Could implement retry logic or dead letter queue here
      throw error;
    }
  }

  private async loadCheckpoints(): Promise<void> {
    if (!this.redis) return;

    try {
      const checkpointKeys = await this.redis.scan('checkpoint:*');
      
      for (const key of checkpointKeys) {
        const checkpointData = await this.redis.get(key);
        if (checkpointData) {
          const checkpoint: ProjectionCheckpoint = JSON.parse(checkpointData);
          this.checkpoints.set(checkpoint.projectionName, checkpoint);
        }
      }

      logger.debug('Checkpoints loaded', { count: this.checkpoints.size });
    } catch (error) {
      logger.error('Failed to load checkpoints', error);
    }
  }

  private async saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `checkpoint:${checkpoint.projectionName}`;
      await this.redis.set(key, JSON.stringify(checkpoint));
      
      logger.debug('Checkpoint saved', {
        projectionName: checkpoint.projectionName,
        eventCount: checkpoint.eventCount,
      });
    } catch (error) {
      logger.error('Failed to save checkpoint', {
        projectionName: checkpoint.projectionName,
        error,
      });
    }
  }
}

// Utility functions for creating projections
export function createProjection(
  name: string,
  version: number,
  topics: string[],
  options?: ProjectionDefinition['options']
): {
  name: string;
  version: number;
  topics: string[];
  eventHandlers: Map<string, ProjectionEventHandler>;
  options?: ProjectionDefinition['options'];
  on: (eventType: string, handler: ProjectionEventHandler) => void;
} {
  const eventHandlers = new Map<string, ProjectionEventHandler>();

  return {
    name,
    version,
    topics,
    eventHandlers,
    options,
    on: (eventType: string, handler: ProjectionEventHandler) => {
      eventHandlers.set(eventType, handler);
    },
  };
}

// Common projection utilities
export const ProjectionUtils = {
  async upsertEntity<T extends { id: string }>(
    readModel: ReadModelStore,
    entityType: string,
    entity: T
  ): Promise<void> {
    const key = `${entityType}:${entity.id}`;
    await readModel.set(key, entity);
  },

  async deleteEntity(
    readModel: ReadModelStore,
    entityType: string,
    entityId: string
  ): Promise<void> {
    const key = `${entityType}:${entityId}`;
    await readModel.delete(key);
  },

  async incrementCounter(
    readModel: ReadModelStore,
    counterName: string,
    by: number = 1
  ): Promise<number> {
    return await readModel.increment(`counter:${counterName}`, by);
  },

  async updateIndex<T>(
    readModel: ReadModelStore,
    indexName: string,
    indexKey: string,
    entityId: string,
    entityData?: T
  ): Promise<void> {
    const key = `index:${indexName}:${indexKey}`;
    
    if (entityData) {
      await readModel.set(key, { entityId, ...entityData });
    } else {
      await readModel.set(key, entityId);
    }
  },
};