import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ReadModelManagerEventMap } from '../core/InfrastructureEventMaps.js';
import { ReadModelManagerConfig, ReadModelManagerConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { DomainEvent } from '@/domain/events/DomainEvent.js';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export interface ReadModel {
  name: string;
  version: string;
  eventTypes: string[];
  handler: (event: DomainEvent) => Promise<void>;
  initialize?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

export interface ProjectionState {
  modelName: string;
  position: number;
  lastEventId?: string;
  lastUpdated: Date;
  status: 'active' | 'paused' | 'error';
  error?: string;
}

interface ModelStatistics {
  eventCount: number;
  lastProcessedAt: Date;
  averageProcessingTime: number;
  errorCount: number;
}

/**
 * Read Model Manager Service
 * Manages CQRS read models and projections with caching and performance optimization
 * 
 * @example
 * ```typescript
 * const manager = await ReadModelManager.getInstance();
 * 
 * // Register a read model
 * await manager.registerModel({
 *   name: 'UserStatistics',
 *   version: '1.0.0',
 *   eventTypes: ['TodoCreated', 'TodoCompleted'],
 *   handler: async (event) => {
 *     // Update statistics
 *   }
 * });
 * 
 * // Process events
 * await manager.processEvent(event);
 * 
 * // Query read model
 * const stats = await manager.query('UserStatistics', { userId: 'user-123' });
 * ```
 */
@ServiceConfig({
  schema: ReadModelManagerConfigSchema,
  prefix: 'read_model',
  hot: true,
})
export class ReadModelManager extends BaseAsyncService<ReadModelManagerConfig, ReadModelManagerEventMap> {
  private models: Map<string, ReadModel> = new Map();
  private projectionStates: Map<string, ProjectionState> = new Map();
  private modelStatistics: Map<string, ModelStatistics> = new Map();
  private processingQueue: Map<string, DomainEvent[]> = new Map();
  private cache?: Redis;
  private prisma!: PrismaClient;

  // Processing state
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private batchProcessor?: Promise<void>;

  // Metrics
  private totalEventsProcessed = 0;
  private totalErrors = 0;

  /**
   * Get the singleton instance
   */
  static async getInstance(prisma?: PrismaClient): Promise<ReadModelManager> {
    return super.getInstanceAsync(async (instance) => {
      if (prisma) {
        instance.setPrisma(prisma);
      }
      await instance.initialize();
      await instance.start();
    });
  }

  protected getServiceName(): string {
    return 'read-model-manager';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Manages CQRS read models and projections';
  }

  protected getServiceDependencies(): string[] {
    return ['prisma'];
  }

  /**
   * Set Prisma client
   */
  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('ReadModelManager initializing', {
      storage: this.config.storage.type,
      cache: this.config.cache.enabled,
      projections: this.config.projections,
    });

    if (!this.prisma) {
      throw new Error('Prisma client not provided');
    }

    // Initialize cache if enabled
    if (this.config.cache.enabled) {
      this.cache = this.createResource({
        resource: new Redis({
          host: 'localhost',
          port: 6379,
          keyPrefix: 'readmodel:',
        }),
        dispose: async () => {
          await this.cache?.quit();
        },
      } as any);
    }

    // Load projection states from storage
    await this.loadProjectionStates();
  }

  /**
   * Start the read model manager
   */
  protected async onStart(): Promise<void> {
    // Start batch processing
    this.startBatchProcessing();

    // Register default read models
    await this.registerDefaultModels();

    logger.info('Read Model Manager started', {
      models: this.models.size,
      batchSize: this.config.projections.batchSize,
    });
  }

  /**
   * Stop the read model manager
   */
  protected async onStop(): Promise<void> {
    // Stop processing
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    // Wait for current batch to complete
    if (this.batchProcessor) {
      await this.batchProcessor;
    }

    // Destroy all models
    for (const model of this.models.values()) {
      if (model.destroy) {
        await model.destroy();
      }
    }

    logger.info('Read Model Manager stopped');
  }

  /**
   * Check read model health
   */
  @HealthCheck({
    name: 'readmodel:health',
    critical: false,
    interval: 60000,
  })
  async checkReadModelHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const errorModels = Array.from(this.projectionStates.values())
      .filter(state => state.status === 'error');

    const totalQueueSize = Array.from(this.processingQueue.values())
      .reduce((sum, queue) => sum + queue.length, 0);

    if (errorModels.length > 0) {
      return {
        status: 'degraded',
        message: `${errorModels.length} models in error state`,
      };
    }

    if (totalQueueSize > 10000) {
      return {
        status: 'degraded',
        message: `High queue size: ${totalQueueSize} events pending`,
      };
    }

    return {
      status: 'healthy',
      message: `${this.models.size} models active, ${totalQueueSize} events queued`,
    };
  }

  /**
   * Register a read model
   */
  @Metric({ name: 'readmodel.registered' })
  async registerModel(model: ReadModel): Promise<void> {
    // Check for existing model
    const existing = this.models.get(model.name);
    if (existing && existing.version !== model.version) {
      logger.warn('Model version changed, migrating', {
        model: model.name,
        oldVersion: existing.version,
        newVersion: model.version,
      });
      
      // In production, would handle migration
      if (existing.destroy) {
        await existing.destroy();
      }
    }

    this.models.set(model.name, model);
    
    // Initialize projection state
    if (!this.projectionStates.has(model.name)) {
      this.projectionStates.set(model.name, {
        modelName: model.name,
        position: 0,
        lastUpdated: new Date(),
        status: 'active',
      });
    }

    // Initialize statistics
    if (!this.modelStatistics.has(model.name)) {
      this.modelStatistics.set(model.name, {
        eventCount: 0,
        lastProcessedAt: new Date(),
        averageProcessingTime: 0,
        errorCount: 0,
      });
    }

    // Initialize processing queue
    if (!this.processingQueue.has(model.name)) {
      this.processingQueue.set(model.name, []);
    }

    // Run initialization if provided
    if (model.initialize) {
      await model.initialize();
    }

    this.emit('model:created', {
      modelName: model.name,
      version: model.version,
    });

    logger.info('Read model registered', {
      name: model.name,
      version: model.version,
      eventTypes: model.eventTypes,
    });
  }

  /**
   * Process a domain event
   */
  @Metric({ name: 'readmodel.event.processed' })
  async processEvent(event: DomainEvent): Promise<void> {
    // Find models interested in this event type
    const interestedModels = Array.from(this.models.entries())
      .filter(([_, model]) => model.eventTypes.includes(event.eventType));

    if (interestedModels.length === 0) {
      return;
    }

    // Queue event for each interested model
    for (const [modelName] of interestedModels) {
      const queue = this.processingQueue.get(modelName) || [];
      queue.push(event);
      this.processingQueue.set(modelName, queue);
    }

    // Trigger immediate processing if below batch size
    if (!this.isProcessing) {
      this.processBatch().catch(error => {
        logger.error('Batch processing error', { error });
      });
    }
  }

  /**
   * Process a batch of events
   */
  @Retry({ attempts: 3, delay: 1000 })
  private async processBatch(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    const startTime = Date.now();

    try {
      // Process each model's queue concurrently
      const processingPromises: Promise<void>[] = [];

      for (const [modelName, queue] of this.processingQueue.entries()) {
        if (queue.length === 0) continue;

        const model = this.models.get(modelName);
        if (!model) continue;

        const state = this.projectionStates.get(modelName);
        if (!state || state.status !== 'active') continue;

        // Take batch of events
        const batch = queue.splice(0, this.config.projections.batchSize);
        
        const promise = this.processModelBatch(model, batch, state);
        processingPromises.push(promise);

        // Limit concurrency
        if (processingPromises.length >= this.config.projections.concurrency) {
          await Promise.race(processingPromises);
          processingPromises.length = 0;
        }
      }

      // Wait for remaining
      await Promise.all(processingPromises);

    } finally {
      this.isProcessing = false;
      
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        logger.warn('Slow batch processing', { duration });
      }
    }
  }

  /**
   * Process a batch of events for a specific model
   */
  private async processModelBatch(
    model: ReadModel,
    events: DomainEvent[],
    state: ProjectionState
  ): Promise<void> {
    const stats = this.modelStatistics.get(model.name)!;
    const startTime = Date.now();

    this.emit('projection:batch', {
      modelName: model.name,
      batchSize: events.length,
      processed: 0,
    });

    let processed = 0;
    let lastError: Error | undefined;

    try {
      for (const event of events) {
        try {
          await model.handler(event);
          processed++;
          
          // Update state
          state.position++;
          state.lastEventId = event.id;
          state.lastUpdated = new Date();
          
          // Invalidate cache for this model
          if (this.cache) {
            await this.invalidateModelCache(model.name);
          }

        } catch (error) {
          stats.errorCount++;
          lastError = error as Error;
          
          logger.error('Event processing failed', {
            model: model.name,
            event: event.id,
            error,
          });

          // Continue processing other events
          if (this.config.projections.errorRetries > 0) {
            // Re-queue for retry
            const queue = this.processingQueue.get(model.name) || [];
            queue.push(event);
            this.processingQueue.set(model.name, queue);
          }
        }
      }

      // Update statistics
      const duration = Date.now() - startTime;
      stats.eventCount += processed;
      stats.lastProcessedAt = new Date();
      stats.averageProcessingTime = 
        (stats.averageProcessingTime * (stats.eventCount - processed) + duration) / stats.eventCount;

      this.totalEventsProcessed += processed;

      this.emit('projection:processed', {
        modelName: model.name,
        eventCount: processed,
        duration,
      });

    } catch (error) {
      // Model handler threw unexpected error
      state.status = 'error';
      state.error = (error as Error).message;
      
      this.emit('projection:error', {
        name: model.name,
        error: error as Error,
        position: state.position,
      });

      throw error;
    }

    // Check for lag
    const lag = Date.now() - events[events.length - 1]?.occurredAt.getTime();
    if (lag > 10000) { // 10 seconds
      this.emit('projection:lag', {
        modelName: model.name,
        lag,
        threshold: 10000,
      });
    }

    // Persist state
    await this.saveProjectionState(state);
  }

  /**
   * Query a read model
   */
  @Metric({ name: 'readmodel.queried' })
  @CircuitBreaker({ threshold: 5, timeout: 10000 })
  async query(modelName: string, parameters: any): Promise<any> {
    const model = this.models.get(modelName);
    if (!model) {
      throw new Error(`Read model ${modelName} not found`);
    }

    // Check cache first
    const cacheKey = this.getCacheKey(modelName, parameters);
    
    if (this.cache && this.config.cache.enabled) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.emit('cache:hit', {
          modelName,
          key: cacheKey,
        });
        return JSON.parse(cached);
      }
      
      this.emit('cache:miss', {
        modelName,
        key: cacheKey,
      });
    }

    // Query from storage
    const result = await this.queryStorage(modelName, parameters);

    // Cache result
    if (this.cache && this.config.cache.enabled && result) {
      await this.cache.setex(
        cacheKey,
        this.config.cache.ttl,
        JSON.stringify(result)
      );
    }

    return result;
  }

  /**
   * Update user statistics (specific projection handler)
   */
  async updateUserStatistics(event: DomainEvent): Promise<void> {
    const userId = event.metadata?.userId;
    if (!userId) return;

    const stats = await this.calculateUserStats(userId);

    await this.prisma.$executeRaw`
      INSERT INTO user_statistics (
        user_id, total_todos, completed_todos, 
        completion_rate, avg_completion_time,
        last_updated
      ) VALUES (
        ${userId},
        ${stats.totalTodos},
        ${stats.completedTodos},
        ${stats.completionRate},
        ${stats.avgCompletionTime},
        ${new Date()}
      ) ON CONFLICT (user_id) DO UPDATE SET
        total_todos = EXCLUDED.total_todos,
        completed_todos = EXCLUDED.completed_todos,
        completion_rate = EXCLUDED.completion_rate,
        avg_completion_time = EXCLUDED.avg_completion_time,
        last_updated = EXCLUDED.last_updated
    `;

    this.emit('model:updated', {
      modelName: 'UserStatistics',
      records: 1,
    });
  }

  /**
   * Update todos by tag projection
   */
  async updateTodosByTag(event: DomainEvent): Promise<void> {
    if (!event.payload.tags || event.payload.tags.length === 0) return;

    for (const tag of event.payload.tags) {
      await this.prisma.$executeRaw`
        INSERT INTO todos_by_tag (
          tag, todo_id, title, status, created_at
        ) VALUES (
          ${tag},
          ${event.aggregateId},
          ${event.payload.title},
          ${event.payload.status || 'PENDING'},
          ${event.occurredAt}
        ) ON CONFLICT (tag, todo_id) DO UPDATE SET
          title = EXCLUDED.title,
          status = EXCLUDED.status
      `;
    }

    this.emit('model:updated', {
      modelName: 'TodosByTag',
      records: event.payload.tags.length,
    });
  }

  /**
   * Update todo timeline projection
   */
  async updateTodoTimeline(event: DomainEvent): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO todo_timeline (
        todo_id, event_type, event_data, 
        user_id, occurred_at
      ) VALUES (
        ${event.aggregateId},
        ${event.eventType},
        ${JSON.stringify(event.payload)},
        ${event.metadata?.userId},
        ${event.occurredAt}
      )
    `;

    this.emit('model:updated', {
      modelName: 'TodoTimeline',
      records: 1,
    });
  }

  /**
   * Calculate user statistics
   */
  private async calculateUserStats(userId: string): Promise<any> {
    // In real implementation, would query event store or aggregated data
    return {
      totalTodos: 0,
      completedTodos: 0,
      completionRate: 0,
      avgCompletionTime: 0,
    };
  }

  /**
   * Query storage
   */
  private async queryStorage(modelName: string, parameters: any): Promise<any> {
    // Route to appropriate storage query
    switch (modelName) {
      case 'UserStatistics':
        return this.prisma.$queryRaw`
          SELECT * FROM user_statistics 
          WHERE user_id = ${parameters.userId}
        `;

      case 'TodosByTag':
        return this.prisma.$queryRaw`
          SELECT * FROM todos_by_tag 
          WHERE tag = ${parameters.tag}
          ORDER BY created_at DESC
          LIMIT ${parameters.limit || 50}
        `;

      case 'TodoTimeline':
        return this.prisma.$queryRaw`
          SELECT * FROM todo_timeline 
          WHERE todo_id = ${parameters.todoId}
          ORDER BY occurred_at DESC
        `;

      default:
        throw new Error(`Unknown model: ${modelName}`);
    }
  }

  /**
   * Get cache key
   */
  private getCacheKey(modelName: string, parameters: any): string {
    return `${modelName}:${JSON.stringify(parameters)}`;
  }

  /**
   * Invalidate model cache
   */
  private async invalidateModelCache(modelName: string): Promise<void> {
    if (!this.cache) return;

    const pattern = `${modelName}:*`;
    const keys = await this.cache.keys(pattern);
    
    if (keys.length > 0) {
      await this.cache.del(...keys);
      
      this.emit('cache:invalidated', {
        modelName,
        reason: 'Model updated',
      });
    }
  }

  /**
   * Load projection states from storage
   */
  private async loadProjectionStates(): Promise<void> {
    try {
      const states = await this.prisma.$queryRaw<ProjectionState[]>`
        SELECT * FROM projection_states
      `;

      for (const state of states) {
        this.projectionStates.set(state.modelName, state);
      }

      logger.info('Loaded projection states', { count: states.length });
    } catch (error) {
      logger.warn('Failed to load projection states', { error });
    }
  }

  /**
   * Save projection state
   */
  private async saveProjectionState(state: ProjectionState): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO projection_states (
          model_name, position, last_event_id, 
          last_updated, status, error
        ) VALUES (
          ${state.modelName},
          ${state.position},
          ${state.lastEventId},
          ${state.lastUpdated},
          ${state.status},
          ${state.error}
        ) ON CONFLICT (model_name) DO UPDATE SET
          position = EXCLUDED.position,
          last_event_id = EXCLUDED.last_event_id,
          last_updated = EXCLUDED.last_updated,
          status = EXCLUDED.status,
          error = EXCLUDED.error
      `;
    } catch (error) {
      logger.error('Failed to save projection state', { error });
    }
  }

  /**
   * Start batch processing
   */
  private startBatchProcessing(): void {
    this.processingInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.batchProcessor = this.processBatch().catch(error => {
          logger.error('Batch processing error', { error });
        });
      }
    }, 100); // Process every 100ms
  }

  /**
   * Register default read models
   */
  private async registerDefaultModels(): Promise<void> {
    // User Statistics Model
    await this.registerModel({
      name: 'UserStatistics',
      version: '1.0.0',
      eventTypes: ['TodoCreated', 'TodoCompleted', 'TodoDeleted'],
      handler: async (event) => {
        await this.updateUserStatistics(event);
      },
    });

    // Todos by Tag Model
    await this.registerModel({
      name: 'TodosByTag',
      version: '1.0.0',
      eventTypes: ['TodoCreated', 'TodoUpdated', 'TodoTagged'],
      handler: async (event) => {
        await this.updateTodosByTag(event);
      },
    });

    // Todo Timeline Model
    await this.registerModel({
      name: 'TodoTimeline',
      version: '1.0.0',
      eventTypes: ['TodoCreated', 'TodoCompleted', 'TodoUpdated', 'TodoDeleted'],
      handler: async (event) => {
        await this.updateTodoTimeline(event);
      },
    });
  }

  /**
   * Get read model statistics
   */
  async getStats(): Promise<{
    models: number;
    totalEvents: number;
    totalErrors: number;
    averageProcessingTime: number;
    queueSizes: Record<string, number>;
    projectionStates: Record<string, string>;
  }> {
    const queueSizes: Record<string, number> = {};
    const projectionStates: Record<string, string> = {};

    for (const [modelName, queue] of this.processingQueue.entries()) {
      queueSizes[modelName] = queue.length;
    }

    for (const [modelName, state] of this.projectionStates.entries()) {
      projectionStates[modelName] = state.status;
    }

    const avgProcessingTime = Array.from(this.modelStatistics.values())
      .reduce((sum, stats) => sum + stats.averageProcessingTime, 0) / this.modelStatistics.size;

    return {
      models: this.models.size,
      totalEvents: this.totalEventsProcessed,
      totalErrors: this.totalErrors,
      averageProcessingTime: avgProcessingTime || 0,
      queueSizes,
      projectionStates,
    };
  }

  /**
   * Run maintenance tasks
   */
  @Metric({ name: 'readmodel.maintenance' })
  async runMaintenance(): Promise<void> {
    if (!this.config.maintenance.vacuumEnabled) return;

    logger.info('Running read model maintenance');

    // Vacuum old timeline entries
    if (this.config.maintenance.archiveOldData) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.maintenance.archiveAfterDays);

      const deleted = await this.prisma.$executeRaw`
        DELETE FROM todo_timeline 
        WHERE occurred_at < ${cutoffDate}
      `;

      if (deleted > 0) {
        this.emit('maintenance:archive', {
          modelName: 'TodoTimeline',
          records: Number(deleted),
          age: this.config.maintenance.archiveAfterDays,
        });
      }
    }

    // Vacuum tables
    await this.prisma.$executeRaw`VACUUM ANALYZE user_statistics`;
    await this.prisma.$executeRaw`VACUUM ANALYZE todos_by_tag`;
    await this.prisma.$executeRaw`VACUUM ANALYZE todo_timeline`;

    this.emit('maintenance:vacuum', {
      modelName: 'all',
      duration: 0,
      freed: 0,
    });
  }
}