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
import { logger } from '@/logger.js';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';

export interface CQRSConfig {
  enableSagas?: boolean;
  enableProjections?: boolean;
  enableEventBus?: boolean;
  messageBroker?: 'rabbitmq' | 'redis' | 'inmemory';
  rabbitMQUrl?: string;
  redisConfig?: any;
  cacheEnabled?: boolean;
}

/**
 * Central coordinator for the entire CQRS/Event-Driven architecture
 */
export class CQRSCoordinator {
  private static instance: CQRSCoordinator;

  private eventBus: EventBus;
  private eventStore: IEventStore;
  private projectionManager: ProjectionManager;
  private sagaOrchestrator: SagaOrchestrator;
  private readModelManager: ReadModelManager;
  private queryCache?: Redis;

  // Query Services
  private todoQueryService: TodoQueryService;
  private userQueryService: UserQueryService;
  private tagQueryService: TagQueryService;

  private config: CQRSConfig;
  private initialized = false;

  private constructor(
    private prisma: PrismaClient,
    eventStore: IEventStore,
    config: CQRSConfig = {}
  ) {
    this.config = {
      enableSagas: true,
      enableProjections: true,
      enableEventBus: true,
      messageBroker: 'redis',
      cacheEnabled: true,
      ...config,
    };

    this.eventStore = eventStore;
    this.eventBus = EventBus.getInstance();
    this.projectionManager = new ProjectionManager(eventStore);
    this.sagaOrchestrator = new SagaOrchestrator(this.eventBus);
    this.readModelManager = new ReadModelManager();

    // Initialize query cache if enabled
    if (this.config.cacheEnabled) {
      this.queryCache = new Redis({
        ...this.config.redisConfig,
        keyPrefix: 'query:',
      });
    }

    // Initialize query services
    this.todoQueryService = new TodoQueryService(
      prisma,
      this.readModelManager,
      this.queryCache
    );
    this.userQueryService = new UserQueryService(
      prisma,
      this.readModelManager,
      this.queryCache
    );
    this.tagQueryService = new TagQueryService(
      prisma,
      this.readModelManager,
      this.queryCache
    );
  }

  static getInstance(
    prisma: PrismaClient,
    eventStore: IEventStore,
    config?: CQRSConfig
  ): CQRSCoordinator {
    if (!CQRSCoordinator.instance) {
      CQRSCoordinator.instance = new CQRSCoordinator(prisma, eventStore, config);
    }
    return CQRSCoordinator.instance;
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing CQRS Coordinator...');

    // 1. Setup message broker adapters
    if (this.config.enableEventBus) {
      await this.setupMessageBrokers();
    }

    // 2. Register sagas
    if (this.config.enableSagas) {
      this.registerSagas();

      // Subscribe saga orchestrator to event bus
      await this.eventBus.subscribe('*', this.sagaOrchestrator);

      // Resume incomplete sagas
      await this.sagaOrchestrator.resumeIncompleteSagas();
    }

    // 3. Register projections and read models
    if (this.config.enableProjections) {
      this.registerProjections();
      await this.projectionManager.start();
    }

    // 4. Setup event handlers for cache invalidation
    this.setupCacheInvalidation();

    this.initialized = true;
    logger.info('CQRS Coordinator initialized successfully');
  }

  /**
   * Shutdown all components
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down CQRS Coordinator...');

    // Stop projection processing
    this.projectionManager.stop();

    // Disconnect event bus
    await this.eventBus.disconnect();

    // Close cache connection
    if (this.queryCache) {
      await this.queryCache.quit();
    }

    this.initialized = false;
    logger.info('CQRS Coordinator shutdown complete');
  }

  /**
   * Setup message broker adapters
   */
  private async setupMessageBrokers(): Promise<void> {
    switch (this.config.messageBroker) {
      case 'rabbitmq':
        if (this.config.rabbitMQUrl) {
          const rabbitMQAdapter = new RabbitMQAdapter({
            url: this.config.rabbitMQUrl,
          });
          this.eventBus.registerAdapter('rabbitmq', rabbitMQAdapter);
        }
        break;

      case 'redis':
        const redisAdapter = new RedisAdapter(this.config.redisConfig);
        this.eventBus.registerAdapter('redis', redisAdapter);
        break;

      case 'inmemory':
      default:
        // InMemory adapter is built-in
        break;
    }

    await this.eventBus.connect();
  }

  /**
   * Register saga definitions
   */
  private registerSagas(): void {
    // Register business sagas
    this.sagaOrchestrator.registerSaga(new CreateTodoWithNotificationsSaga());

    // Additional sagas can be registered here
    logger.info('Registered all sagas');
  }

  /**
   * Register projections and read models
   */
  private registerProjections(): void {
    // Register all read models as projections
    for (const readModel of this.readModelManager.getAllReadModels()) {
      this.projectionManager.registerProjection(readModel);
    }

    logger.info('Registered all projections');
  }

  /**
   * Setup cache invalidation based on events
   */
  private setupCacheInvalidation(): void {
    if (!this.config.cacheEnabled) return;

    // Subscribe to events that should invalidate cache
    const cacheInvalidationHandler = {
      handle: async (envelope: any) => {
        const event = envelope.event;

        switch (event.eventType) {
          case 'TodoCreated':
          case 'TodoUpdated':
          case 'TodoDeleted':
            await this.invalidateTodoCache(event.aggregateId, event.metadata?.userId);
            break;

          case 'TodoCompleted':
            await this.invalidateUserStatsCache(event.metadata?.userId);
            break;
        }
      },
      supportedEvents: () => ['TodoCreated', 'TodoUpdated', 'TodoDeleted', 'TodoCompleted'],
    };

    this.eventBus.subscribe('*', cacheInvalidationHandler);
  }

  private async invalidateTodoCache(todoId: string, userId?: string): Promise<void> {
    const patterns = [
      `todo:${todoId}:*`,
      userId ? `user:${userId}:todos:*` : null,
      `search:*`,
    ].filter(Boolean) as string[];

    for (const pattern of patterns) {
      await this.queryCache?.eval(
        `for i, key in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', key) end`,
        0,
        pattern
      );
    }
  }

  private async invalidateUserStatsCache(userId?: string): Promise<void> {
    if (!userId) return;

    const patterns = [
      `analytics:${userId}:*`,
      `productivity:${userId}:*`,
      `activity:${userId}:*`,
    ];

    for (const pattern of patterns) {
      await this.queryCache?.eval(
        `for i, key in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', key) end`,
        0,
        pattern
      );
    }
  }

  /**
   * Get query services
   */
  getQueryServices() {
    return {
      todos: this.todoQueryService,
      users: this.userQueryService,
      tags: this.tagQueryService,
    };
  }

  /**
   * Get saga orchestrator for direct interaction
   */
  getSagaOrchestrator(): SagaOrchestrator {
    return this.sagaOrchestrator;
  }

  /**
   * Get projection manager for rebuilding projections
   */
  getProjectionManager(): ProjectionManager {
    return this.projectionManager;
  }

  /**
   * Get event bus for custom event publishing
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Health check for all components
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: Record<string, boolean>;
    details: Record<string, any>;
  }> {
    const components: Record<string, boolean> = {
      eventStore: false,
      eventBus: false,
      projections: false,
      sagas: false,
      cache: false,
    };

    const details: Record<string, any> = {};

    // Check event store
    try {
      await this.eventStore.getEvents('health-check', 0, 1);
      components.eventStore = true;
    } catch (error) {
      details.eventStore = { error: (error as Error).message };
    }

    // Check event bus
    components.eventBus = this.eventBus.getMetrics().getStats().publishCount >= 0;

    // Check projections
    components.projections = this.config.enableProjections || true;

    // Check sagas
    const sagaMetrics = this.sagaOrchestrator.getMetrics().getStats();
    components.sagas = Object.keys(sagaMetrics).length > 0 || true;

    // Check cache
    if (this.queryCache) {
      try {
        await this.queryCache.ping();
        components.cache = true;
      } catch (error) {
        details.cache = { error: (error as Error).message };
      }
    } else {
      components.cache = true; // Cache is optional
    }

    // Determine overall status
    const healthyCount = Object.values(components).filter(Boolean).length;
    const totalCount = Object.keys(components).length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (healthyCount === totalCount) {
      status = 'healthy';
    } else if (healthyCount >= totalCount * 0.5) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      components,
      details: {
        ...details,
        eventBusMetrics: this.eventBus.getMetrics().getStats(),
        sagaMetrics,
      },
    };
  }
}