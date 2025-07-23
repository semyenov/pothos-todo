import { logger } from '../../lib/unjs-utils.js';
// import { CacheManager } from './CacheManager.js';
// import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { hash } from 'ohash';
import type { Redis } from 'ioredis';

// Temporary interfaces for missing dependencies
interface CacheManager {
  get(key: string): Promise<any>;
  set(key: string, value: any, options?: any): Promise<void>;
  del(key: string): Promise<void>;
}

interface MetricsCollector {
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  getMetrics(name: string): Promise<{ avg: number; count: number; sum: number } | null>;
}

interface Span {
  setTag(key: string, value: any): void;
  finish(): void;
}

export interface CacheWarmingConfig {
  /**
   * Query patterns to warm on startup
   */
  warmupQueries: Array<{
    name: string;
    query: string;
    variables?: Record<string, any>;
    priority: 'high' | 'medium' | 'low';
    frequency: number; // seconds between refreshes
  }>;

  /**
   * Enable predictive caching based on user patterns
   */
  enablePredictiveCache: boolean;

  /**
   * Cache preloading strategies
   */
  preloadStrategies: Array<{
    pattern: string;
    trigger: 'time' | 'event' | 'usage';
    condition?: string;
  }>;
}

export interface CacheStrategy {
  name: string;
  pattern: string | RegExp;
  ttl: number;
  tags: string[];
  refreshStrategy: 'lazy' | 'eager' | 'background';
  compression: boolean;
  priority: number;
}

export interface CacheAnalytics {
  hitRate: number;
  missRate: number;
  totalRequests: number;
  averageResponseTime: number;
  topMissedQueries: Array<{ query: string; misses: number }>;
  cacheSize: number;
  memoryUsage: number;
}

export class AdvancedCacheManager {
  private cache = new Map<string, any>();
  
  // Basic cache methods
  public async get<T>(key: string): Promise<T | null> {
    return this.cache.get(key) as T | null;
  }
  
  public async set<T>(key: string, value: T, options?: { ttl?: number; tags?: string[] }): Promise<void> {
    this.cache.set(key, value);
    // TTL and tags would be handled by a real cache implementation
  }
  
  public async del(key: string): Promise<void> {
    this.cache.delete(key);
  }
  
  public async invalidateByTag(tag: string): Promise<void> {
    // Tag-based invalidation would be handled by a real cache implementation
    logger.debug('Tag-based cache invalidation', { tag });
  }
  private static advancedInstance: AdvancedCacheManager;
  private cacheStrategies = new Map<string, CacheStrategy>();
  private queryPatterns = new Map<string, number>(); // Query pattern -> usage count
  private warmupInterval?: NodeJS.Timeout;
  private analyticsInterval?: NodeJS.Timeout;
  private metrics: MetricsCollector | null;
  private warmingConfig?: CacheWarmingConfig;

  private constructor() {
    this.metrics = null; // MetricsCollector.getInstance();
    this.setupDefaultStrategies();
    this.startAnalytics();
  }

  public static getAdvancedInstance(): AdvancedCacheManager {
    if (!AdvancedCacheManager.advancedInstance) {
      AdvancedCacheManager.advancedInstance = new AdvancedCacheManager();
    }
    return AdvancedCacheManager.advancedInstance;
  }

  /**
   * Configure cache warming strategies
   */
  public configureCacheWarming(config: CacheWarmingConfig): void {
    this.warmingConfig = config;
    this.startCacheWarming();

    logger.info('Cache warming configured', {
      queries: config.warmupQueries.length,
      predictive: config.enablePredictiveCache,
      strategies: config.preloadStrategies.length,
    });
  }

  /**
   * Add a custom cache strategy
   */
  public addCacheStrategy(strategy: CacheStrategy): void {
    this.cacheStrategies.set(strategy.name, strategy);
    
    logger.info('Cache strategy added', {
      name: strategy.name,
      pattern: strategy.pattern.toString(),
      ttl: strategy.ttl,
      refreshStrategy: strategy.refreshStrategy,
    });
  }

  /**
   * Get cache strategy for a query
   */
  public getCacheStrategy(queryName: string, query: string): CacheStrategy | undefined {
    // Find matching strategy by pattern
    for (const [name, strategy] of this.cacheStrategies.entries()) {
      if (typeof strategy.pattern === 'string') {
        if (queryName.includes(strategy.pattern)) {
          return strategy;
        }
      } else if (strategy.pattern instanceof RegExp) {
        if (strategy.pattern.test(query)) {
          return strategy;
        }
      }
    }

    return undefined;
  }

  /**
   * Enhanced get with strategy-aware caching
   */
  public async getWithStrategy<T>(
    key: string, 
    queryName?: string, 
    query?: string
  ): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      // Record query pattern for analytics
      if (queryName) {
        this.recordQueryPattern(queryName);
      }

      // Get strategy if available
      const strategy = queryName && query ? 
        this.getCacheStrategy(queryName, query) : undefined;

      // Try to get from cache
      let result = this.cache.get(key) as T | null;

      // If miss and strategy supports background refresh
      if (!result && strategy?.refreshStrategy === 'background') {
        // Try to get stale data and refresh in background
        const staleKey = `${key}:stale`;
        result = this.cache.get(staleKey) as T | null;
        
        if (result) {
          // Trigger background refresh
          this.scheduleBackgroundRefresh(key, strategy);
        }
      }

      // Record hit/miss metrics
      const duration = Date.now() - startTime;
      this.metrics?.recordMetric('cache.get.duration', duration, {
        hit: result ? 'true' : 'false',
        strategy: strategy?.name || 'default',
      });

      return result;
    } catch (error) {
      logger.error('Advanced cache get failed', error as Error, { key, queryName });
      return null;
    }
  }

  /**
   * Enhanced set with compression and strategy awareness
   */
  public async setWithStrategy<T>(
    key: string,
    value: T,
    options?: { ttl?: number; tags?: string[] },
    strategy?: CacheStrategy
  ): Promise<void> {
    try {
      let processedValue = value;
      let finalTtl = options?.ttl;

      // Apply strategy if provided
      if (strategy) {
        finalTtl = strategy.ttl;
        
        // Apply compression if enabled
        if (strategy.compression && typeof value === 'object') {
          processedValue = await this.compressValue(value);
        }

        // Store stale copy for background refresh
        if (strategy.refreshStrategy === 'background') {
          const staleKey = `${key}:stale`;
          this.cache.set(staleKey, value);
        }
      }

      this.cache.set(key, processedValue);

      this.metrics?.recordMetric('cache.set', 1, {
        compressed: strategy?.compression ? 'true' : 'false',
        strategy: strategy?.name || 'default',
      });

    } catch (error) {
      logger.error('Advanced cache set failed', error as Error, { key });
      throw error;
    }
  }

  /**
   * Warm cache with predefined queries
   */
  public async warmCache(): Promise<void> {
    if (!this.warmingConfig) {
      logger.warn('Cache warming not configured');
      return;
    }

    logger.info('Starting cache warming', {
      queries: this.warmingConfig.warmupQueries.length,
    });

    const promises = this.warmingConfig.warmupQueries.map(async (warmupQuery) => {
      try {
        // This would typically execute the GraphQL query
        // For now, we'll simulate cache warming
        const cacheKey = `warmup:${hash({ 
          query: warmupQuery.query, 
          variables: warmupQuery.variables 
        })}`;

        // Simulate query execution and caching
        await this.set(cacheKey, { 
          warmed: true, 
          timestamp: Date.now(),
          query: warmupQuery.name 
        }, { ttl: 3600 });

        logger.debug('Cache warmed for query', { name: warmupQuery.name });

      } catch (error) {
        logger.error('Failed to warm cache for query', error as Error, {
          queryName: warmupQuery.name,
        });
      }
    });

    await Promise.allSettled(promises);
    
    this.metrics?.recordMetric('cache.warmup.completed', 1, {
      queries: this.warmingConfig.warmupQueries.length.toString(),
    });
  }

  /**
   * Predictive cache preloading based on usage patterns
   */
  public async predictivePreload(): Promise<void> {
    if (!this.warmingConfig?.enablePredictiveCache) {
      return;
    }

    // Analyze query patterns and preload likely-to-be-requested data
    const topPatterns = Array.from(this.queryPatterns.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    logger.info('Running predictive cache preload', {
      patterns: topPatterns.length,
    });

    for (const [pattern, usage] of topPatterns) {
      if (usage > 5) { // Only preload frequently used patterns
        await this.preloadPattern(pattern);
      }
    }
  }

  /**
   * Get comprehensive cache analytics
   */
  public async getCacheAnalytics(): Promise<CacheAnalytics> {
    try {
      const redis = this.getRedisClient();
      if (!redis) {
        throw new Error('Redis not available for analytics');
      }

      // Get cache statistics
      const info = await redis.info('memory');
      const memoryUsage = this.parseMemoryInfo(info);

      // Calculate hit/miss rates from metrics
      const totalHits = (await this.metrics?.getMetrics('cache.hit'))?.sum || 0;
      const totalMisses = (await this.metrics?.getMetrics('cache.miss'))?.sum || 0;
      const totalRequests = totalHits + totalMisses;

      const hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
      const missRate = totalRequests > 0 ? (totalMisses / totalRequests) * 100 : 0;

      // Get top missed queries
      const topMissedQueries = Array.from(this.queryPatterns.entries())
        .map(([query, count]) => ({ query, misses: count }))
        .sort((a, b) => b.misses - a.misses)
        .slice(0, 10);

      // Get cache size
      const cacheSize = await redis.dbsize();

      return {
        hitRate,
        missRate,
        totalRequests,
        averageResponseTime: (await this.metrics?.getMetrics('cache.get.duration'))?.avg || 0,
        topMissedQueries,
        cacheSize,
        memoryUsage,
      };

    } catch (error) {
      logger.error('Failed to get cache analytics', error as Error);
      return {
        hitRate: 0,
        missRate: 0,
        totalRequests: 0,
        averageResponseTime: 0,
        topMissedQueries: [],
        cacheSize: 0,
        memoryUsage: 0,
      };
    }
  }

  /**
   * Intelligent cache eviction based on usage patterns
   */
  public async intelligentEviction(): Promise<void> {
    try {
      const redis = this.getRedisClient();
      if (!redis) return;

      // Get keys with their access patterns
      const keys = await redis.keys('*');
      const evictionCandidates: Array<{ key: string; score: number }> = [];

      for (const key of keys) {
        const ttl = await redis.ttl(key);
        const size = await redis.memory('USAGE', key);
        
        // Calculate eviction score (higher = more likely to evict)
        let score = 0;
        
        // Factor in TTL (keys expiring soon get lower score)
        if (ttl > 0) {
          score -= ttl / 3600; // Hours until expiration
        }
        
        // Factor in size (larger keys get higher score)
        if (size) {
          score += size / 1024; // KB
        }
        
        // Factor in usage pattern (less used keys get higher score)
        const usage = this.queryPatterns.get(key) || 0;
        score += Math.max(0, 10 - usage);

        evictionCandidates.push({ key, score });
      }

      // Sort by score and evict top candidates if memory usage is high
      evictionCandidates.sort((a, b) => b.score - a.score);
      
      const memoryInfo = await redis.info('memory');
      const memoryUsage = this.parseMemoryInfo(memoryInfo);
      
      if (memoryUsage > 80) { // If memory usage > 80%
        const toEvict = evictionCandidates.slice(0, Math.ceil(keys.length * 0.1)); // Evict 10%
        
        for (const { key } of toEvict) {
          await redis.del(key);
        }
        
        logger.info('Intelligent cache eviction completed', {
          evicted: toEvict.length,
          memoryUsage,
        });
      }

    } catch (error) {
      logger.error('Intelligent eviction failed', error as Error);
    }
  }

  /**
   * Setup default caching strategies
   */
  private setupDefaultStrategies(): void {
    // User data strategy
    this.addCacheStrategy({
      name: 'user-data',
      pattern: /user|profile|account/i,
      ttl: 1800, // 30 minutes
      tags: ['user'],
      refreshStrategy: 'lazy',
      compression: false,
      priority: 1,
    });

    // Todo data strategy
    this.addCacheStrategy({
      name: 'todo-data',
      pattern: /todo|task|list/i,
      ttl: 600, // 10 minutes
      tags: ['todo'],
      refreshStrategy: 'background',
      compression: true,
      priority: 2,
    });

    // AI/Search results strategy
    this.addCacheStrategy({
      name: 'ai-results',
      pattern: /search|ai|nlp|embedding/i,
      ttl: 3600, // 1 hour
      tags: ['ai'],
      refreshStrategy: 'eager',
      compression: true,
      priority: 3,
    });

    // Analytics strategy
    this.addCacheStrategy({
      name: 'analytics',
      pattern: /stats|analytics|metrics/i,
      ttl: 300, // 5 minutes
      tags: ['analytics'],
      refreshStrategy: 'background',
      compression: false,
      priority: 4,
    });
  }

  /**
   * Start cache warming process
   */
  private startCacheWarming(): void {
    if (!this.warmingConfig) return;

    // Initial warmup
    setTimeout(() => {
      this.warmCache();
    }, 1000);

    // Periodic warmup for high-priority queries
    this.warmupInterval = setInterval(async () => {
      const highPriorityQueries = this.warmingConfig!.warmupQueries
        .filter(q => q.priority === 'high');

      for (const query of highPriorityQueries) {
        if (Date.now() % (query.frequency * 1000) < 60000) { // Within 1 minute window
          await this.warmQueryCache(query);
        }
      }

      // Run predictive preloading
      await this.predictivePreload();

    }, 60000); // Check every minute
  }

  /**
   * Start cache analytics collection
   */
  private startAnalytics(): void {
    this.analyticsInterval = setInterval(async () => {
      const analytics = await this.getCacheAnalytics();
      
      // Log analytics
      logger.info('Cache analytics', analytics);
      
      // Record metrics
      this.metrics.recordMetric('cache.analytics.hit_rate', analytics.hitRate);
      this.metrics.recordMetric('cache.analytics.miss_rate', analytics.missRate);
      this.metrics.recordMetric('cache.analytics.size', analytics.cacheSize);
      this.metrics.recordMetric('cache.analytics.memory_usage', analytics.memoryUsage);

      // Run intelligent eviction if needed
      if (analytics.memoryUsage > 75) {
        await this.intelligentEviction();
      }

    }, 300000); // Every 5 minutes
  }

  /**
   * Record query pattern for analytics
   */
  private recordQueryPattern(queryName: string): void {
    const current = this.queryPatterns.get(queryName) || 0;
    this.queryPatterns.set(queryName, current + 1);
  }

  /**
   * Compress cache value
   */
  private async compressValue<T>(value: T): Promise<T> {
    // In a real implementation, you would use a compression library like zlib
    // For now, we'll just return the value as-is
    return value;
  }

  /**
   * Schedule background refresh for a cache key
   */
  private scheduleBackgroundRefresh(key: string, strategy: CacheStrategy): void {
    setTimeout(async () => {
      try {
        // This would typically re-execute the original query
        logger.debug('Background cache refresh triggered', { key, strategy: strategy.name });
        
        // Placeholder for actual refresh logic
        // In practice, you'd need to store the original query/function to re-execute
        
      } catch (error) {
        logger.error('Background cache refresh failed', error as Error, { key });
      }
    }, 1000); // Refresh after 1 second delay
  }

  /**
   * Preload cache for a specific pattern
   */
  private async preloadPattern(pattern: string): Promise<void> {
    try {
      // This would analyze the pattern and preload likely queries
      logger.debug('Preloading cache pattern', { pattern });
      
      // Placeholder for actual preloading logic
      
    } catch (error) {
      logger.error('Cache pattern preload failed', error as Error, { pattern });
    }
  }

  /**
   * Warm cache for a specific query
   */
  private async warmQueryCache(warmupQuery: CacheWarmingConfig['warmupQueries'][0]): Promise<void> {
    try {
      const cacheKey = `warmup:${hash({ 
        query: warmupQuery.query, 
        variables: warmupQuery.variables 
      })}`;

      // Check if already warmed recently
      const existing = await this.get(cacheKey);
      if (existing) return;

      // Execute warmup
      await this.set(cacheKey, {
        warmed: true,
        timestamp: Date.now(),
        query: warmupQuery.name,
      }, { ttl: warmupQuery.frequency });

      logger.debug('Query cache warmed', { name: warmupQuery.name });

    } catch (error) {
      logger.error('Query cache warming failed', error as Error, {
        queryName: warmupQuery.name,
      });
    }
  }

  /**
   * Parse Redis memory info
   */
  private parseMemoryInfo(info: string): number {
    const lines = info.split('\r\n');
    const usedMemoryLine = lines.find(line => line.startsWith('used_memory:'));
    const maxMemoryLine = lines.find(line => line.startsWith('maxmemory:'));
    
    if (!usedMemoryLine || !maxMemoryLine) return 0;
    
    const usedMemory = parseInt(usedMemoryLine.split(':')[1]);
    const maxMemory = parseInt(maxMemoryLine.split(':')[1]);
    
    return maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;
  }

  /**
   * Get Redis client (protected method from parent)
   */
  private getRedisClient(): Redis | null {
    // Access the protected redis property from parent class
    return (this as any).redis;
  }

  /**
   * Shutdown advanced cache manager
   */
  public async shutdown(): Promise<void> {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = undefined;
    }

    if (this.analyticsInterval) {
      clearInterval(this.analyticsInterval);
      this.analyticsInterval = undefined;
    }

    await super.disconnect();
    logger.info('Advanced cache manager shutdown completed');
  }
}

/**
 * Cache warming configuration for common queries
 */
export const defaultCacheWarmingConfig: CacheWarmingConfig = {
  warmupQueries: [
    {
      name: 'user-todos',
      query: 'query GetUserTodos($userId: ID!) { user(id: $userId) { todos { id title status } } }',
      variables: {},
      priority: 'high',
      frequency: 300, // 5 minutes
    },
    {
      name: 'todo-stats',
      query: 'query GetTodoStats { todoStats { total completed pending } }',
      priority: 'medium',
      frequency: 600, // 10 minutes
    },
    {
      name: 'ai-suggestions',
      query: 'query GetAISuggestions($userId: ID!) { generateTaskSuggestions(userId: $userId) }',
      variables: {},
      priority: 'low',
      frequency: 1800, // 30 minutes
    },
  ],
  enablePredictiveCache: true,
  preloadStrategies: [
    {
      pattern: 'user-*',
      trigger: 'usage',
      condition: 'usage > 10',
    },
    {
      pattern: 'todo-*',
      trigger: 'time',
      condition: 'hour in [8, 12, 17]', // Business hours
    },
  ],
};