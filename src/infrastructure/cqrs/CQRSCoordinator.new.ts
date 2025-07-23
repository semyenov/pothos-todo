import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { CQRSCoordinatorEventMap } from '../core/InfrastructureEventMaps.js';
import { CQRSCoordinatorConfig, CQRSCoordinatorConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { EventBus } from '../events/EventBus.js';
import type { IEventStore } from '../events/EventStore.js';
import { ProjectionManager } from '../events/EventSourcing.js';
import { SagaOrchestrator } from '../saga/SagaOrchestrator.js';
import { ReadModelManager } from './ReadModel.js';
import {
  TodoQueryService,
  UserQueryService,
  TagQueryService
} from './QueryService.js';
import { CreateTodoWithNotificationsSaga } from '../saga/Saga.js';
import { RabbitMQAdapter } from '../events/adapters/RabbitMQAdapter.js';
import { RedisAdapter } from '../events/adapters/RedisAdapter.js';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

/**
 * CQRS Coordinator Service
 * Central coordinator for the entire CQRS/Event-Driven architecture
 * 
 * @example
 * ```typescript
 * const cqrs = await CQRSCoordinator.getInstance();
 * 
 * // Execute a command
 * const result = await cqrs.executeCommand({
 *   id: uuidv4(),
 *   type: 'CreateTodo',
 *   payload: { title: 'New todo', userId: 'user-123' }
 * });
 * 
 * // Execute a query
 * const todos = await cqrs.executeQuery({
 *   type: 'GetUserTodos',
 *   userId: 'user-123',
 *   filters: { completed: false }
 * });
 * ```
 */
@ServiceConfig({
  schema: CQRSCoordinatorConfigSchema,
  prefix: 'cqrs',
  hot: true,
})
export class CQRSCoordinator extends BaseAsyncService<CQRSCoordinatorConfig, CQRSCoordinatorEventMap> {
  private eventBus!: EventBus;
  private eventStore!: IEventStore;
  private projectionManager!: ProjectionManager;
  private sagaOrchestrator!: SagaOrchestrator;
  private readModelManager!: ReadModelManager;
  private queryCache?: Redis;

  // Query Services
  private todoQueryService!: TodoQueryService;
  private userQueryService!: UserQueryService;
  private tagQueryService!: TagQueryService;

  // External dependencies
  private prisma!: PrismaClient;

  // Metrics
  private commandCount = 0;
  private queryCount = 0;
  private commandErrors = 0;
  private queryErrors = 0;

  /**
   * Get the singleton instance
   */
  static async getInstance(
    prisma?: PrismaClient,
    eventStore?: IEventStore
  ): Promise<CQRSCoordinator> {
    return super.getInstanceAsync(async (instance) => {
      if (prisma && eventStore) {
        instance.setPrisma(prisma);
        instance.setEventStore(eventStore);
      }
      await instance.initialize();
      await instance.start();
    });
  }

  protected getServiceName(): string {
    return 'cqrs-coordinator';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Central coordinator for CQRS/Event-Driven architecture';
  }

  protected getServiceDependencies(): string[] {
    return ['event-bus', 'event-store', 'prisma'];
  }

  /**
   * Set Prisma client (for dependency injection)
   */
  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  /**
   * Set Event Store (for dependency injection)
   */
  setEventStore(eventStore: IEventStore): void {
    this.eventStore = eventStore;
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('CQRSCoordinator initializing', {
      commandTimeout: this.config.command.timeout,
      queryCache: this.config.query.cacheEnabled,
      eventStore: this.config.eventStore.type,
      projections: this.config.projections.enabled,
    });

    // Validate dependencies
    if (!this.prisma) {
      throw new Error('Prisma client not provided');
    }
    if (!this.eventStore) {
      throw new Error('Event store not provided');
    }

    // Initialize core components
    this.eventBus = EventBus.getInstance();
    this.projectionManager = new ProjectionManager(this.eventStore);
    this.sagaOrchestrator = new SagaOrchestrator(this.eventBus);
    this.readModelManager = new ReadModelManager();

    // Initialize query cache if enabled
    if (this.config.query.cacheEnabled) {
      this.queryCache = this.createResource({
        resource: new Redis({
          host: 'localhost',
          port: 6379,
          keyPrefix: 'cqrs:query:',
        }),
        dispose: async () => {
          await this.queryCache?.quit();
        },
      } as any);
    }

    // Initialize query services
    this.todoQueryService = new TodoQueryService(
      this.prisma,
      this.readModelManager,
      this.queryCache
    );
    this.userQueryService = new UserQueryService(
      this.prisma,
      this.readModelManager,
      this.queryCache
    );
    this.tagQueryService = new TagQueryService(
      this.prisma,
      this.readModelManager,
      this.queryCache
    );
  }

  /**
   * Start the CQRS coordinator
   */
  protected async onStart(): Promise<void> {
    // Setup message brokers
    await this.setupMessageBrokers();

    // Register sagas
    this.registerSagas();

    // Subscribe saga orchestrator to event bus
    await this.eventBus.subscribe('*', this.sagaOrchestrator);

    // Resume incomplete sagas
    await this.sagaOrchestrator.resumeIncompleteSagas();

    // Register projections and read models
    if (this.config.projections.enabled) {
      this.registerProjections();
      await this.projectionManager.start();
    }

    // Setup event handlers for cache invalidation
    this.setupCacheInvalidation();

    logger.info('CQRS Coordinator started');
  }

  /**
   * Stop the CQRS coordinator
   */
  protected async onStop(): Promise<void> {
    // Stop projection manager
    await this.projectionManager.stop();

    // Clear cache connections
    if (this.queryCache) {
      await this.queryCache.quit();
    }

    logger.info('CQRS Coordinator stopped');
  }

  /**
   * Check CQRS health
   */
  @HealthCheck({
    name: 'cqrs:health',
    critical: true,
    interval: 30000,
  })
  async checkCQRSHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    try {
      // Check event store connection
      const eventStoreHealthy = await this.eventStore.isHealthy();
      
      // Check projection lag
      const projectionLag = await this.projectionManager.getMaxLag();
      
      // Check saga processing
      const pendingSagas = await this.sagaOrchestrator.getPendingSagaCount();

      if (!eventStoreHealthy) {
        return { status: 'unhealthy', message: 'Event store is not healthy' };
      }

      if (projectionLag > 10000) { // 10 seconds
        return { 
          status: 'degraded', 
          message: `High projection lag: ${projectionLag}ms` 
        };
      }

      if (pendingSagas > 100) {
        return { 
          status: 'degraded', 
          message: `Many pending sagas: ${pendingSagas}` 
        };
      }

      return { status: 'healthy', message: 'CQRS system is healthy' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `Health check failed: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Execute a command
   */
  @Metric({ name: 'cqrs.command.executed', recordDuration: true })
  @Retry({ attempts: 3, delay: 1000 })
  @CircuitBreaker({ threshold: 5, timeout: 30000 })
  async executeCommand(command: {
    id: string;
    type: string;
    payload: any;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    const commandId = command.id || uuidv4();

    this.emit('command:received', {
      commandId,
      type: command.type,
      userId: command.userId,
    });

    try {
      // Validate command if enabled
      if (this.config.command.validationEnabled) {
        await this.validateCommand(command);
        
        this.emit('command:validated', {
          commandId,
        });
      }

      // Execute command with timeout
      const result = await Promise.race([
        this.processCommand(command),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Command timeout')), this.config.command.timeout)
        ),
      ]);

      this.commandCount++;
      
      this.emit('command:executed', {
        commandId,
        duration: 0, // Would be calculated in real implementation
      });

      return result;

    } catch (error) {
      this.commandErrors++;
      
      this.emit('command:failed', {
        commandId,
        error: error as Error,
      });

      throw error;
    }
  }

  /**
   * Execute a query
   */
  @Metric({ name: 'cqrs.query.executed', recordDuration: true })
  async executeQuery(query: {
    id?: string;
    type: string;
    parameters: any;
    userId?: string;
  }): Promise<any> {
    const queryId = query.id || uuidv4();
    const complexity = this.calculateQueryComplexity(query);

    this.emit('query:received', {
      queryId,
      type: query.type,
      complexity,
    });

    try {
      // Check cache if enabled
      let result: any;
      const cacheKey = this.getCacheKey(query);

      if (this.config.query.cacheEnabled && this.queryCache) {
        const cached = await this.queryCache.get(cacheKey);
        if (cached) {
          this.emit('query:cached', {
            queryId,
            cacheKey,
          });
          return JSON.parse(cached);
        }
      }

      // Check query complexity
      if (complexity > this.config.query.maxComplexity) {
        throw new Error(`Query complexity ${complexity} exceeds limit ${this.config.query.maxComplexity}`);
      }

      // Execute query
      result = await this.processQuery(query);

      // Cache result if enabled
      if (this.config.query.cacheEnabled && this.queryCache) {
        await this.queryCache.setex(
          cacheKey,
          this.config.query.cacheTTL,
          JSON.stringify(result)
        );
      }

      this.queryCount++;

      this.emit('query:executed', {
        queryId,
        duration: 0, // Would be calculated
        resultCount: Array.isArray(result) ? result.length : 1,
      });

      return result;

    } catch (error) {
      this.queryErrors++;
      throw error;
    }
  }

  /**
   * Rebuild projections
   */
  @Metric({ name: 'cqrs.projections.rebuilt' })
  async rebuildProjections(projectionName?: string): Promise<void> {
    logger.info('Rebuilding projections', { projectionName });

    if (projectionName) {
      await this.projectionManager.rebuildProjection(projectionName);
    } else {
      await this.projectionManager.rebuildAll();
    }
  }

  /**
   * Process a command
   */
  private async processCommand(command: any): Promise<any> {
    // In real implementation, would route to appropriate command handler
    switch (command.type) {
      case 'CreateTodo':
        // Execute command logic
        const event = {
          aggregateId: uuidv4(),
          type: 'TodoCreated',
          payload: command.payload,
          version: 1,
        };
        
        // Store event
        await this.eventStore.append(event);
        
        // Publish to event bus
        await this.eventBus.publish(event);
        
        return { id: event.aggregateId };

      default:
        throw new Error(`Unknown command type: ${command.type}`);
    }
  }

  /**
   * Process a query
   */
  private async processQuery(query: any): Promise<any> {
    // Route to appropriate query service
    switch (query.type) {
      case 'GetUserTodos':
        return this.todoQueryService.getUserTodos(
          query.parameters.userId,
          query.parameters.filters
        );

      case 'GetTodoById':
        return this.todoQueryService.getTodoById(
          query.parameters.id
        );

      case 'GetUserProfile':
        return this.userQueryService.getUserProfile(
          query.parameters.userId
        );

      case 'GetTags':
        return this.tagQueryService.getAllTags(
          query.parameters.filters
        );

      default:
        throw new Error(`Unknown query type: ${query.type}`);
    }
  }

  /**
   * Validate command
   */
  private async validateCommand(command: any): Promise<void> {
    // Basic validation - in real implementation would use schema validation
    if (!command.type) {
      throw new Error('Command type is required');
    }

    if (!command.payload) {
      throw new Error('Command payload is required');
    }

    // Type-specific validation would go here
  }

  /**
   * Calculate query complexity
   */
  private calculateQueryComplexity(query: any): number {
    // Simple complexity calculation - in real implementation would be more sophisticated
    let complexity = 1;

    if (query.parameters.filters) {
      complexity += Object.keys(query.parameters.filters).length;
    }

    if (query.parameters.include) {
      complexity += query.parameters.include.length * 2;
    }

    if (query.parameters.limit > 100) {
      complexity += Math.floor(query.parameters.limit / 100);
    }

    return complexity;
  }

  /**
   * Get cache key for query
   */
  private getCacheKey(query: any): string {
    return `query:${query.type}:${JSON.stringify(query.parameters)}`;
  }

  /**
   * Setup message brokers
   */
  private async setupMessageBrokers(): Promise<void> {
    if (this.config.eventStore.type === 'eventstore') {
      // EventStore specific setup
      logger.info('Setting up EventStore adapter');
    } else if (this.config.broker?.type === 'rabbitmq') {
      const adapter = new RabbitMQAdapter({
        url: this.config.broker.hosts?.[0] || 'amqp://localhost',
      });
      await this.eventBus.addAdapter(adapter);
    } else if (this.config.broker?.type === 'redis') {
      const adapter = new RedisAdapter({
        host: 'localhost',
        port: 6379,
      });
      await this.eventBus.addAdapter(adapter);
    }
  }

  /**
   * Register sagas
   */
  private registerSagas(): void {
    // Register domain sagas
    this.sagaOrchestrator.registerSaga(new CreateTodoWithNotificationsSaga());
    
    // Additional sagas would be registered here
    logger.info('Sagas registered');
  }

  /**
   * Register projections
   */
  private registerProjections(): void {
    // Register read model projections
    this.projectionManager.registerProjection({
      name: 'UserStatistics',
      eventTypes: ['TodoCreated', 'TodoCompleted', 'TodoDeleted'],
      handler: async (event) => {
        // Update user statistics
        await this.readModelManager.updateUserStatistics(event);
      },
    });

    this.projectionManager.registerProjection({
      name: 'TodosByTag',
      eventTypes: ['TodoCreated', 'TodoUpdated', 'TodoTagged'],
      handler: async (event) => {
        // Update todos by tag index
        await this.readModelManager.updateTodosByTag(event);
      },
    });

    this.projectionManager.registerProjection({
      name: 'TodoTimeline',
      eventTypes: ['TodoCreated', 'TodoCompleted', 'TodoUpdated'],
      handler: async (event) => {
        // Update todo timeline
        await this.readModelManager.updateTodoTimeline(event);
      },
    });

    logger.info('Projections registered', {
      count: 3,
      concurrency: this.config.projections.concurrency,
    });
  }

  /**
   * Setup cache invalidation
   */
  private setupCacheInvalidation(): void {
    if (!this.config.query.cacheEnabled || !this.queryCache) {
      return;
    }

    // Invalidate cache on relevant events
    const invalidationEvents = [
      'TodoCreated',
      'TodoUpdated',
      'TodoDeleted',
      'TodoCompleted',
      'UserUpdated',
    ];

    for (const eventType of invalidationEvents) {
      this.eventBus.subscribe(eventType, {
        handle: async (event: any) => {
          // Clear relevant cache entries
          const patterns = this.getCacheInvalidationPatterns(event);
          
          for (const pattern of patterns) {
            const keys = await this.queryCache!.keys(pattern);
            if (keys.length > 0) {
              await this.queryCache!.del(...keys);
            }
          }
        },
      });
    }

    logger.info('Cache invalidation setup complete');
  }

  /**
   * Get cache invalidation patterns for an event
   */
  private getCacheInvalidationPatterns(event: any): string[] {
    const patterns: string[] = [];

    // User-specific queries
    if (event.userId) {
      patterns.push(`query:GetUserTodos:*${event.userId}*`);
      patterns.push(`query:GetUserProfile:*${event.userId}*`);
    }

    // Entity-specific queries
    if (event.aggregateId) {
      patterns.push(`query:GetTodoById:*${event.aggregateId}*`);
    }

    // Tag-related queries
    if (event.payload?.tags) {
      patterns.push(`query:GetTags:*`);
      patterns.push(`query:GetTodosByTag:*`);
    }

    return patterns;
  }

  /**
   * Get CQRS statistics
   */
  async getStats(): Promise<{
    commands: {
      total: number;
      errors: number;
      errorRate: number;
    };
    queries: {
      total: number;
      errors: number;
      errorRate: number;
      cacheHitRate?: number;
    };
    projections: {
      active: number;
      lag: number;
    };
    sagas: {
      pending: number;
      completed: number;
    };
  }> {
    const projectionLag = await this.projectionManager.getMaxLag();
    const pendingSagas = await this.sagaOrchestrator.getPendingSagaCount();
    const completedSagas = await this.sagaOrchestrator.getCompletedSagaCount();

    return {
      commands: {
        total: this.commandCount,
        errors: this.commandErrors,
        errorRate: this.commandCount > 0 ? this.commandErrors / this.commandCount : 0,
      },
      queries: {
        total: this.queryCount,
        errors: this.queryErrors,
        errorRate: this.queryCount > 0 ? this.queryErrors / this.queryCount : 0,
        // Cache hit rate would be calculated from cache statistics
      },
      projections: {
        active: 3, // Hardcoded for now
        lag: projectionLag,
      },
      sagas: {
        pending: pendingSagas,
        completed: completedSagas,
      },
    };
  }

  /**
   * Handle configuration changes
   */
  protected async onConfigChanged(
    oldConfig: CQRSCoordinatorConfig,
    newConfig: CQRSCoordinatorConfig
  ): Promise<void> {
    // Handle cache configuration changes
    if (oldConfig.query.cacheEnabled !== newConfig.query.cacheEnabled) {
      if (newConfig.query.cacheEnabled && !this.queryCache) {
        // Enable cache
        this.queryCache = new Redis({
          host: 'localhost',
          port: 6379,
          keyPrefix: 'cqrs:query:',
        });
        this.setupCacheInvalidation();
      } else if (!newConfig.query.cacheEnabled && this.queryCache) {
        // Disable cache
        await this.queryCache.quit();
        this.queryCache = undefined;
      }
    }

    // Handle projection configuration changes
    if (oldConfig.projections.enabled !== newConfig.projections.enabled) {
      if (newConfig.projections.enabled) {
        await this.projectionManager.start();
      } else {
        await this.projectionManager.stop();
      }
    }
  }
}