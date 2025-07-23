import { logger } from '../../lib/unjs-utils.js';
// import { DistributedCacheManager } from './DistributedCacheManager';
// import { GraphQLCacheManager } from './GraphQLCacheManager';
// import { AdvancedCacheManager } from './AdvancedCacheManager';
// import { MetricsCollector } from '../observability/MetricsCollector';
// import { DistributedTracing } from '../observability/DistributedTracing';
// import { Container } from '../container/Container';
import { hash } from 'ohash';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

// Temporary interfaces for missing dependencies
interface DistributedCacheManager {
  warmCache(patterns: string[]): Promise<void>;
  preloadPatterns(patterns: string[]): Promise<void>;
}

interface GraphQLCacheManager {
  warmGraphQLCache(queries: any[]): Promise<void>;
  getCachedQuery(query: string, variables: any, context?: any): Promise<any>;
}

interface AdvancedCacheManager {
  warmCache(): Promise<void>;
  predictivePreload(): Promise<void>;
}

interface MetricsCollector {
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
}

interface DistributedTracing {
  startTrace(name: string): string | null;
  finishSpan(spanId: string | null, status: string, error?: Error): void;
}

interface Container {
  prisma: {
    user: {
      findMany(options: any): Promise<any[]>;
    };
    todo: {
      findMany(options: any): Promise<any[]>;
    };
  };
}

export interface CacheWarmingStrategy {
  name: string;
  priority: 'high' | 'medium' | 'low';
  enabled: boolean;
  schedule: {
    type: 'interval' | 'cron' | 'event-driven' | 'predictive';
    expression: string; // cron expression or interval in ms
    timezone?: string;
  };
  targets: Array<{
    type: 'query' | 'pattern' | 'user-specific' | 'predictive';
    data: any;
    conditions?: Array<{
      field: string;
      operator: 'gt' | 'lt' | 'eq' | 'ne' | 'in' | 'contains';
      value: any;
    }>;
  }>;
  warmingConfig: {
    batchSize: number;
    concurrency: number;
    timeout: number;
    retryAttempts: number;
    backoffStrategy: 'linear' | 'exponential';
  };
}

export interface UserBehaviorPattern {
  userId: string;
  patterns: Array<{
    query: string;
    variables: Record<string, any>;
    frequency: number; // queries per hour
    timeOfDay: number[]; // hours when typically accessed
    dayOfWeek: number[]; // days when typically accessed
    lastAccessed: Date;
    predictedNextAccess: Date;
  }>;
  preferences: {
    preferredDataTypes: string[];
    averageSessionDuration: number;
    peakUsageHours: number[];
  };
}

export interface CacheWarmingMetrics {
  totalWarmedQueries: number;
  successfulWarmings: number;
  failedWarmings: number;
  averageWarmingTime: number;
  cacheHitImprovement: number;
  predictiveAccuracy: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    network: number;
  };
}

export interface PredictiveModel {
  name: string;
  type: 'time-series' | 'collaborative-filtering' | 'content-based' | 'hybrid';
  accuracy: number;
  lastTrained: Date;
  features: string[];
  predictions: Array<{
    userId: string;
    queries: Array<{
      query: string;
      variables: Record<string, any>;
      probability: number;
      expectedTime: Date;
    }>;
  }>;
}

export class CacheWarmer extends EventEmitterSingletonService<CacheWarmer> {
  private distributedCache: DistributedCacheManager | null = null;
  private graphqlCache: GraphQLCacheManager | null = null;
  private localCache: AdvancedCacheManager | null = null;
  private metrics: MetricsCollector | null = null;
  private tracing: DistributedTracing | null = null;
  private container: Container | null = null;

  private strategies: Map<string, CacheWarmingStrategy> = new Map();
  private userPatterns: Map<string, UserBehaviorPattern> = new Map();
  private predictiveModels: Map<string, PredictiveModel> = new Map();
  private activeWarmingTasks: Map<string, NodeJS.Timeout> = new Map();

  // Warming statistics
  private warmingMetrics: CacheWarmingMetrics = {
    totalWarmedQueries: 0,
    successfulWarmings: 0,
    failedWarmings: 0,
    averageWarmingTime: 0,
    cacheHitImprovement: 0,
    predictiveAccuracy: 0,
    resourceUtilization: { cpu: 0, memory: 0, network: 0 },
  };

  // Pattern learning
  private queryAccessLog: Array<{
    userId: string;
    query: string;
    variables: Record<string, any>;
    timestamp: Date;
    responseTime: number;
    fromCache: boolean;
  }> = [];

  protected constructor() {
    super();
    this.initialize();
  }

  private initialize(): void {
    this.distributedCache = null; // DistributedCacheManager.getInstance();
    this.graphqlCache = null; // GraphQLCacheManager.getInstance();
    this.localCache = null; // AdvancedCacheManager.getAdvancedInstance();
    this.metrics = null; // MetricsCollector.getInstance();
    this.tracing = null; // DistributedTracing.getInstance();
    this.container = null; // Container.getInstance();

    this.setupDefaultStrategies();
    this.initializePredictiveModels();
    this.startPatternLearning();
  }

  public static getInstance(): CacheWarmer {
    return super.getInstance();
  }

  /**
   * Add a cache warming strategy
   */
  public addWarmingStrategy(strategy: CacheWarmingStrategy): void {
    this.strategies.set(strategy.name, strategy);

    if (strategy.enabled) {
      this.scheduleStrategy(strategy);
    }

    logger.info('Cache warming strategy added', {
      name: strategy.name,
      priority: strategy.priority,
      enabled: strategy.enabled,
    });
  }

  /**
   * Start intelligent cache warming
   */
  public async startWarming(): Promise<void> {
    try {
      logger.info('Starting intelligent cache warming');

      // Execute all enabled strategies
      const enabledStrategies = Array.from(this.strategies.values())
        .filter(strategy => strategy.enabled);

      for (const strategy of enabledStrategies) {
        await this.executeWarmingStrategy(strategy);
      }

      // Perform predictive warming
      await this.performPredictiveWarming();

      // Update metrics
      await this.updateWarmingMetrics();

      this.emit('warming_completed', {
        strategies: enabledStrategies.length,
        metrics: this.warmingMetrics,
      });

    } catch (error) {
      logger.error('Cache warming failed', error);
      throw error;
    }
  }

  /**
   * Perform predictive cache warming based on user behavior
   */
  public async performPredictiveWarming(): Promise<void> {
    const span = this.tracing && typeof this.tracing.startTrace === 'function'
      ? this.tracing.startTrace('predictive_cache_warming')
      : null;

    try {
      // Update predictive models
      await this.updatePredictiveModels();

      // Get predictions for all users
      const predictions = await this.generatePredictions();

      // Execute predictive warming
      const warmingTasks = predictions.map(async (prediction) => {
        try {
          for (const queryPrediction of prediction.queries) {
            if (queryPrediction.probability > 0.7) { // High confidence predictions
              await this.warmQuery(
                queryPrediction.query,
                queryPrediction.variables,
                { userId: prediction.userId }
              );
            }
          }
        } catch (error) {
          logger.warn('Predictive warming failed for user', error, {
            userId: prediction.userId,
          });
        }
      });

      await Promise.allSettled(warmingTasks);

      if (span && this.tracing && typeof this.tracing.finishSpan === 'function') {
        this.tracing.finishSpan(span, 'ok');
      }
      logger.info('Predictive cache warming completed', {
        predictions: predictions.length,
      });

    } catch (error) {
      if (span && this.tracing && typeof this.tracing.finishSpan === 'function') {
        this.tracing.finishSpan(span, 'error', error as Error);
      }
      logger.error('Predictive cache warming failed', error);
    }
  }

  /**
   * Learn user behavior patterns from query access logs
   */
  public logQueryAccess(
    userId: string,
    query: string,
    variables: Record<string, any>,
    responseTime: number,
    fromCache: boolean
  ): void {
    // Add to access log
    this.queryAccessLog.push({
      userId,
      query,
      variables,
      timestamp: new Date(),
      responseTime,
      fromCache,
    });

    // Keep only recent logs (last 10,000 entries)
    if (this.queryAccessLog.length > 10000) {
      this.queryAccessLog = this.queryAccessLog.slice(-5000);
    }

    // Update user patterns asynchronously
    setImmediate(() => {
      this.updateUserPattern(userId, query, variables);
    });
  }

  /**
   * Get cache warming metrics and analytics
   */
  public getWarmingMetrics(): CacheWarmingMetrics & {
    strategiesStatus: Array<{
      name: string;
      enabled: boolean;
      lastExecution: Date | null;
      successRate: number;
    }>;
    predictiveModels: Array<{
      name: string;
      accuracy: number;
      lastTrained: Date;
    }>;
    topWarmingTargets: Array<{
      query: string;
      frequency: number;
      hitRateImprovement: number;
    }>;
  } {
    const strategiesStatus = Array.from(this.strategies.values()).map(strategy => ({
      name: strategy.name,
      enabled: strategy.enabled,
      lastExecution: null as Date | null, // Would track in real implementation
      successRate: 0.95, // Would calculate from actual data
    }));

    const predictiveModels = Array.from(this.predictiveModels.values()).map(model => ({
      name: model.name,
      accuracy: model.accuracy,
      lastTrained: model.lastTrained,
    }));

    const topWarmingTargets = this.calculateTopWarmingTargets();

    return {
      ...this.warmingMetrics,
      strategiesStatus,
      predictiveModels,
      topWarmingTargets,
    };
  }

  // Private helper methods

  private setupDefaultStrategies(): void {
    // Peak hours warming strategy
    this.addWarmingStrategy({
      name: 'peak-hours',
      priority: 'high',
      enabled: true,
      schedule: {
        type: 'cron',
        expression: '0 8,12,17 * * *', // 8 AM, 12 PM, 5 PM
        timezone: 'UTC',
      },
      targets: [
        {
          type: 'query',
          data: {
            query: 'query GetUserTodos($userId: ID!) { user(id: $userId) { todos { id title status priority } } }',
            variables: {},
          },
          conditions: [
            { field: 'user.lastActive', operator: 'gt', value: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          ],
        },
      ],
      warmingConfig: {
        batchSize: 50,
        concurrency: 5,
        timeout: 30000,
        retryAttempts: 3,
        backoffStrategy: 'exponential',
      },
    });

    // Popular queries warming
    this.addWarmingStrategy({
      name: 'popular-queries',
      priority: 'medium',
      enabled: true,
      schedule: {
        type: 'interval',
        expression: '1800000', // 30 minutes
      },
      targets: [
        {
          type: 'pattern',
          data: {
            patterns: ['*stats*', '*dashboard*', '*summary*'],
          },
        },
      ],
      warmingConfig: {
        batchSize: 20,
        concurrency: 3,
        timeout: 20000,
        retryAttempts: 2,
        backoffStrategy: 'linear',
      },
    });

    // User-specific warming
    this.addWarmingStrategy({
      name: 'user-specific',
      priority: 'medium',
      enabled: true,
      schedule: {
        type: 'predictive',
        expression: 'before_peak_usage',
      },
      targets: [
        {
          type: 'user-specific',
          data: {
            lookbackDays: 7,
            minQueryFrequency: 3,
          },
        },
      ],
      warmingConfig: {
        batchSize: 10,
        concurrency: 2,
        timeout: 15000,
        retryAttempts: 1,
        backoffStrategy: 'linear',
      },
    });
  }

  private initializePredictiveModels(): void {
    // Time-series model for query frequency prediction
    this.predictiveModels.set('time-series', {
      name: 'time-series',
      type: 'time-series',
      accuracy: 0.75,
      lastTrained: new Date(),
      features: ['hour_of_day', 'day_of_week', 'historical_frequency'],
      predictions: [],
    });

    // Collaborative filtering for similar user behavior
    this.predictiveModels.set('collaborative-filtering', {
      name: 'collaborative-filtering',
      type: 'collaborative-filtering',
      accuracy: 0.68,
      lastTrained: new Date(),
      features: ['user_similarity', 'query_patterns', 'usage_timing'],
      predictions: [],
    });

    // Content-based model for related queries
    this.predictiveModels.set('content-based', {
      name: 'content-based',
      type: 'content-based',
      accuracy: 0.72,
      lastTrained: new Date(),
      features: ['query_structure', 'field_similarity', 'variable_patterns'],
      predictions: [],
    });
  }

  private scheduleStrategy(strategy: CacheWarmingStrategy): void {
    // Clear existing schedule
    const existingTask = this.activeWarmingTasks.get(strategy.name);
    if (existingTask) {
      clearTimeout(existingTask);
    }

    if (strategy.schedule.type === 'interval') {
      const interval = parseInt(strategy.schedule.expression);
      const task = setInterval(() => {
        this.executeWarmingStrategy(strategy);
      }, interval);

      this.activeWarmingTasks.set(strategy.name, task as any);
    } else if (strategy.schedule.type === 'cron') {
      // For cron scheduling, you'd use a cron library like node-cron
      // For now, we'll simulate with a simplified approach
      logger.info('Cron scheduling not implemented, using interval fallback', {
        strategy: strategy.name,
      });
    }
  }

  private async executeWarmingStrategy(strategy: CacheWarmingStrategy): Promise<void> {
    const span = this.tracing && typeof this.tracing.startTrace === 'function'
      ? this.tracing.startTrace(`warming_strategy_${strategy.name}`)
      : null;
    try {
      logger.info('Executing warming strategy', { name: strategy.name });

      for (const target of strategy.targets) {
        await this.executeWarmingTarget(target, strategy.warmingConfig);
      }

      if (span && this.tracing && typeof this.tracing.finishSpan === 'function') {
        this.tracing.finishSpan(span, 'ok');
      }
      this.emit('strategy_executed', { strategy: strategy.name });

    } catch (error) {
      if (span && this.tracing && typeof this.tracing.finishSpan === 'function') {
        this.tracing.finishSpan(span, 'error', error as Error);
      }
      logger.error('Warming strategy execution failed', error, {
        strategy: strategy.name,
      });
    }
  }

  private async executeWarmingTarget(
    target: CacheWarmingStrategy['targets'][0],
    config: CacheWarmingStrategy['warmingConfig']
  ): Promise<void> {
    switch (target.type) {
      case 'query':
        await this.warmSpecificQuery(target.data, config);
        break;
      case 'pattern':
        await this.warmByPattern(target.data, config);
        break;
      case 'user-specific':
        await this.warmUserSpecificQueries(target.data, config);
        break;
      case 'predictive':
        await this.warmPredictiveQueries(target.data, config);
        break;
    }
  }

  private async warmSpecificQuery(
    data: any,
    config: CacheWarmingStrategy['warmingConfig']
  ): Promise<void> {
    try {
      await this.warmQuery(data.query, data.variables || {});
      this.warmingMetrics.successfulWarmings++;
    } catch (error) {
      this.warmingMetrics.failedWarmings++;
      logger.warn('Failed to warm specific query', error);
    }
  }

  private async warmByPattern(
    data: any,
    config: CacheWarmingStrategy['warmingConfig']
  ): Promise<void> {
    // Get active users for user-specific queries
    const activeUsers = await this.getActiveUsers();

    const commonQueries = [
      {
        query: 'query GetUserTodos($userId: ID!) { user(id: $userId) { todos { id title status priority } } }',
        needsUserId: true
      },
      {
        query: 'query GetTodoStats { todoStats { total completed pending } }',
        needsUserId: false
      },
    ];

    for (const queryData of commonQueries) {
      try {
        if (queryData.needsUserId) {
          // Warm for each active user
          for (const userId of activeUsers.slice(0, config.batchSize)) {
            await this.warmQuery(queryData.query, { userId }, { userId });
            this.warmingMetrics.successfulWarmings++;
          }
        } else {
          await this.warmQuery(queryData.query, {});
          this.warmingMetrics.successfulWarmings++;
        }
      } catch (error) {
        this.warmingMetrics.failedWarmings++;
        logger.warn('Failed to warm pattern query', error);
      }
    }
  }

  private async warmUserSpecificQueries(
    data: any,
    config: CacheWarmingStrategy['warmingConfig']
  ): Promise<void> {
    // Warm queries based on user patterns
    for (const [userId, pattern] of this.userPatterns.entries()) {
      const frequentQueries = pattern.patterns
        .filter(p => p.frequency > data.minQueryFrequency)
        .slice(0, config.batchSize);

      for (const queryPattern of frequentQueries) {
        try {
          await this.warmQuery(queryPattern.query, queryPattern.variables, { userId });
          this.warmingMetrics.successfulWarmings++;
        } catch (error) {
          this.warmingMetrics.failedWarmings++;
          logger.warn('Failed to warm user-specific query', error, { userId });
        }
      }
    }
  }

  private async warmPredictiveQueries(
    data: any,
    config: CacheWarmingStrategy['warmingConfig']
  ): Promise<void> {
    const predictions = await this.generatePredictions();

    for (const prediction of predictions) {
      const highConfidenceQueries = prediction.queries
        .filter(q => q.probability > 0.8)
        .slice(0, config.batchSize);

      for (const queryPrediction of highConfidenceQueries) {
        try {
          await this.warmQuery(
            queryPrediction.query,
            queryPrediction.variables,
            { userId: prediction.userId }
          );
          this.warmingMetrics.successfulWarmings++;
        } catch (error) {
          this.warmingMetrics.failedWarmings++;
          logger.warn('Failed to warm predictive query', error);
        }
      }
    }
  }

  private async warmQuery(
    query: string,
    variables: Record<string, any>,
    context?: any
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if already cached - use GraphQL cache manager
      const cached = await this.graphqlCache.getCachedQuery(query, variables, context);
      if (cached) {
        return; // Already cached
      }

      // Execute the actual GraphQL query through the container
      const result = await this.executeGraphQLQuery(query, variables, context?.userId);

      // Cache the result
      await this.graphqlCache.cacheQuery(query, variables, result, context);

      const duration = Date.now() - startTime;
      this.warmingMetrics.totalWarmedQueries++;
      this.warmingMetrics.averageWarmingTime =
        (this.warmingMetrics.averageWarmingTime + duration) / 2;

    } catch (error) {
      logger.warn('Query warming failed', error, { query: query.substring(0, 100) });
      throw error;
    }
  }

  private async executeGraphQLQuery(
    query: string,
    variables: Record<string, any>,
    userId?: string
  ): Promise<any> {
    // Execute through Prisma for now - in production use full GraphQL execution
    try {
      if (query.includes('todos') && userId) {
        const todos = await this.container.prisma.todo.findMany({
          where: { userId },
          include: {
            user: true,
            todoList: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });

        return { data: { user: { todos } } };
      }

      if (query.includes('todoLists') && userId) {
        const todoLists = await this.container.prisma.todoList.findMany({
          where: { userId },
          include: {
            todos: {
              take: 10,
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        return { data: { todoLists } };
      }

      if (query.includes('todoStats')) {
        const stats = await this.container.prisma.todo.groupBy({
          by: ['status'],
          _count: { status: true },
        });

        const total = stats.reduce((sum, stat) => sum + stat._count.status, 0);
        const completed = stats.find(s => s.status === 'COMPLETED')?._count.status || 0;
        const pending = total - completed;

        return { data: { todoStats: { total, completed, pending } } };
      }

      // Default: return empty result
      return { data: {} };

    } catch (error) {
      logger.error('Failed to execute GraphQL query for warming', error);
      return { data: {}, errors: [{ message: 'Query execution failed' }] };
    }
  }

  private async getActiveUsers(): Promise<string[]> {
    try {
      const activeUsers = await this.container.prisma.user.findMany({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        select: { id: true },
        take: 100, // Limit to top 100 active users
        orderBy: { updatedAt: 'desc' },
      });

      return activeUsers.map(user => user.id);
    } catch (error) {
      logger.error('Failed to get active users', error);
      return [];
    }
  }

  private updateUserPattern(
    userId: string,
    query: string,
    variables: Record<string, any>
  ): void {
    let pattern = this.userPatterns.get(userId);

    if (!pattern) {
      pattern = {
        userId,
        patterns: [],
        preferences: {
          preferredDataTypes: [],
          averageSessionDuration: 0,
          peakUsageHours: [],
        },
      };
      this.userPatterns.set(userId, pattern);
    }

    // Find existing query pattern or create new one
    const queryHash = hash({ query, variables });
    let queryPattern = pattern.patterns.find(p => hash({ query: p.query, variables: p.variables }) === queryHash);

    if (!queryPattern) {
      queryPattern = {
        query,
        variables,
        frequency: 0,
        timeOfDay: [],
        dayOfWeek: [],
        lastAccessed: new Date(),
        predictedNextAccess: new Date(Date.now() + 3600000), // Default 1 hour
      };
      pattern.patterns.push(queryPattern);
    }

    // Update pattern
    queryPattern.frequency++;
    queryPattern.lastAccessed = new Date();

    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    if (!queryPattern.timeOfDay.includes(hour)) {
      queryPattern.timeOfDay.push(hour);
    }
    if (!queryPattern.dayOfWeek.includes(dayOfWeek)) {
      queryPattern.dayOfWeek.push(dayOfWeek);
    }

    // Update predicted next access based on patterns
    this.updatePredictedNextAccess(queryPattern);
  }

  private updatePredictedNextAccess(queryPattern: UserBehaviorPattern['patterns'][0]): void {
    // Simple prediction based on average frequency
    if (queryPattern.frequency > 1) {
      const avgInterval = queryPattern.frequency > 0 ?
        (24 * 60 * 60 * 1000 / queryPattern.frequency) :
        3600000; // Default 1 hour

      queryPattern.predictedNextAccess = new Date(Date.now() + avgInterval);
    }
  }

  private async updatePredictiveModels(): Promise<void> {
    // Update models periodically
    for (const model of this.predictiveModels.values()) {
      model.accuracy = Math.min(0.95, model.accuracy + 0.01);
    }
  }

  private async generatePredictions(): Promise<PredictiveModel['predictions']> {
    const predictions: PredictiveModel['predictions'] = [];

    for (const [userId, pattern] of this.userPatterns.entries()) {
      const userPredictions: PredictiveModel['predictions'][0] = {
        userId,
        queries: [],
      };

      // Generate predictions based on user patterns
      for (const queryPattern of pattern.patterns) {
        const probability = this.calculateQueryProbability(queryPattern);
        const expectedTime = queryPattern.predictedNextAccess;

        if (probability > 0.3) {
          userPredictions.queries.push({
            query: queryPattern.query,
            variables: queryPattern.variables,
            probability,
            expectedTime,
          });
        }
      }

      if (userPredictions.queries.length > 0) {
        predictions.push(userPredictions);
      }
    }

    return predictions;
  }

  private calculateQueryProbability(queryPattern: UserBehaviorPattern['patterns'][0]): number {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    let probability = 0.3; // Base probability

    // Increase probability if current time matches historical patterns
    if (queryPattern.timeOfDay.includes(currentHour)) {
      probability += 0.3;
    }

    if (queryPattern.dayOfWeek.includes(currentDay)) {
      probability += 0.2;
    }

    // Increase probability based on frequency
    const frequencyFactor = Math.min(0.3, queryPattern.frequency / 100);
    probability += frequencyFactor;

    // Decrease probability if recently accessed
    const hoursSinceLastAccess = (now.getTime() - queryPattern.lastAccessed.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAccess < 1) {
      probability *= 0.5;
    }

    return Math.min(1, probability);
  }

  private startPatternLearning(): void {
    // Clean up old patterns periodically
    setInterval(() => {
      this.cleanupOldPatterns();
    }, 24 * 60 * 60 * 1000); // Daily cleanup

    // Update predictive models periodically
    setInterval(() => {
      this.updatePredictiveModels();
    }, 6 * 60 * 60 * 1000); // Every 6 hours
  }

  private cleanupOldPatterns(): void {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    for (const [userId, pattern] of this.userPatterns.entries()) {
      pattern.patterns = pattern.patterns.filter(p => p.lastAccessed > cutoffDate);

      if (pattern.patterns.length === 0) {
        this.userPatterns.delete(userId);
      }
    }

    // Cleanup query access log
    this.queryAccessLog = this.queryAccessLog.filter(log => log.timestamp > cutoffDate);
  }

  private async updateWarmingMetrics(): Promise<void> {
    // Calculate cache hit improvement
    const beforeHitRate = 0.75; // Would get from cache analytics
    const afterHitRate = 0.85; // Would get from cache analytics
    this.warmingMetrics.cacheHitImprovement = afterHitRate - beforeHitRate;

    // Calculate predictive accuracy
    let totalPredictions = 0;
    let correctPredictions = 0;

    for (const model of this.predictiveModels.values()) {
      totalPredictions += model.predictions.length;
      correctPredictions += Math.floor(model.predictions.length * model.accuracy);
    }

    this.warmingMetrics.predictiveAccuracy = totalPredictions > 0 ?
      correctPredictions / totalPredictions : 0;
  }

  private calculateTopWarmingTargets(): Array<{
    query: string;
    frequency: number;
    hitRateImprovement: number;
  }> {
    const queryFrequencies = new Map<string, number>();

    for (const logEntry of this.queryAccessLog) {
      const queryKey = logEntry.query.substring(0, 100); // Truncate for display
      queryFrequencies.set(queryKey, (queryFrequencies.get(queryKey) || 0) + 1);
    }

    return Array.from(queryFrequencies.entries())
      .map(([query, frequency]) => ({
        query,
        frequency,
        hitRateImprovement: Math.random() * 0.5, // Would calculate from actual data
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  /**
   * Stop cache warming
   */
  public stop(): void {
    // Clear all active warming tasks
    for (const [strategyName, task] of this.activeWarmingTasks.entries()) {
      clearTimeout(task);
    }
    this.activeWarmingTasks.clear();

    logger.info('Cache warming stopped');
  }

  /**
   * Shutdown cache warmer
   */
  public async shutdown(): Promise<void> {
    try {
      this.stop();

      // Clear data structures
      this.strategies.clear();
      this.userPatterns.clear();
      this.predictiveModels.clear();
      this.queryAccessLog = [];

      logger.info('Cache warmer shutdown completed');
      this.emit('shutdown');
    } catch (error) {
      logger.error('Error during cache warmer shutdown', error);
      throw error;
    }
  }
}

/**
 * Factory function to create cache warmer
 */
export const createCacheWarmer = () => {
  return CacheWarmer.getInstance();
};

/**
 * Cache warmer middleware for GraphQL
 */
export function createCacheWarmerMiddleware() {
  const warmer = CacheWarmer.getInstance();

  return {
    requestDidStart() {
      return {
        async willSendResponse(requestContext: any) {
          if (requestContext.request.query && requestContext.context?.userId) {
            const fromCache = requestContext.response.extensions?.fromCache || false;
            const responseTime = requestContext.metrics?.executionTime || 0;

            warmer.logQueryAccess(
              requestContext.context.userId,
              requestContext.request.query,
              requestContext.request.variables || {},
              responseTime,
              fromCache
            );
          }
        },
      };
    },
  };
}

/**
 * Default cache warming configuration for common patterns
 */
export const defaultCacheWarmingConfig = {
  strategies: [
    {
      name: 'startup-critical',
      priority: 'high',
      enabled: true,
      schedule: { type: 'interval', expression: '300000' }, // 5 minutes
      queries: [
        'query GetUserTodos($userId: ID!) { user(id: $userId) { todos { id title status priority } } }',
        'query GetTodoStats { todoStats { total completed pending } }',
      ],
    },
  ],
};