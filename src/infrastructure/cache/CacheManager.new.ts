import Redis from 'ioredis';
import type { Redis as RedisClient, RedisOptions } from 'ioredis';
import { destr } from 'destr';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { RedisServiceEventMap } from '../core/ServiceEventMaps.js';
import { ServiceConfig, Retry, CircuitBreaker, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { logger } from '../../lib/unjs-utils.js';

/**
 * Redis configuration schema with validation
 */
const RedisConfigSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  keyPrefix: z.string().default('cache:'),
  ttl: z.number().default(3600), // Default 1 hour
  maxRetriesPerRequest: z.number().default(3),
  enableOfflineQueue: z.boolean().default(true),
  slowQueryThreshold: z.number().default(100), // ms
  memoryWarningThreshold: z.number().default(0.9), // 90% memory usage
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
}

/**
 * Enhanced CacheManager using the new base service architecture
 * 
 * Features:
 * - Automatic configuration loading and validation
 * - Type-safe event emissions
 * - Built-in health checks
 * - Metrics collection
 * - Circuit breaker for resilience
 * - Hot reload support
 * 
 * @example
 * ```typescript
 * const cache = await CacheManager.getInstance();
 * 
 * // Listen to typed events
 * cache.on('redis:slow-query', ({ command, duration }) => {
 *   console.log(`Slow query detected: ${command} took ${duration}ms`);
 * });
 * 
 * // Use the cache
 * await cache.set('key', 'value', { ttl: 300 });
 * const value = await cache.get('key');
 * ```
 */
@ServiceConfig({
  schema: RedisConfigSchema,
  prefix: 'cache',
  hot: true, // Enable hot reload
})
export class CacheManager extends BaseAsyncService<RedisConfig, RedisServiceEventMap> {
  private client!: RedisClient;
  private commandCount = 0;
  private slowQueryCount = 0;

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<CacheManager> {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'cache-manager';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Redis-based caching service with automatic configuration and monitoring';
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('CacheManager initializing with config:', {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      keyPrefix: this.config.keyPrefix,
    });
  }

  /**
   * Start the Redis connection
   */
  protected async onStart(): Promise<void> {
    if (!this.config.enabled) {
      logger.warn('Cache is disabled by configuration');
      return;
    }

    const options: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      keyPrefix: this.config.keyPrefix,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableOfflineQueue: this.config.enableOfflineQueue,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
    };

    // Create Redis client as a tracked resource
    this.client = this.createResource({
      resource: new Redis(options),
      dispose: async () => {
        await this.client.quit();
      },
    } as any);

    // Setup event handlers with typed events
    this.client.on('connect', () => {
      this.emit('redis:connected', {
        host: this.config.host,
        port: this.config.port,
      });
    });

    this.client.on('error', (error) => {
      this.emit('redis:error', { error });
      this.handleError(error, 'redis-connection');
    });

    this.client.on('close', () => {
      this.emit('redis:disconnected', { reason: 'Connection closed' });
    });

    // Wait for connection
    await this.client.ping();
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Stop the service
   */
  protected async onStop(): Promise<void> {
    // Resources are automatically cleaned up by BaseService
    logger.info('CacheManager stopped');
  }

  /**
   * Handle configuration changes
   */
  protected async onConfigChanged(oldConfig: RedisConfig, newConfig: RedisConfig): Promise<void> {
    // Only restart if critical settings changed
    if (
      oldConfig.host !== newConfig.host ||
      oldConfig.port !== newConfig.port ||
      oldConfig.password !== newConfig.password ||
      oldConfig.db !== newConfig.db
    ) {
      logger.info('Critical Redis configuration changed, restarting connection...');
      await this.restart();
    } else {
      logger.info('Non-critical configuration updated');
      // Update non-critical settings without restart
      this.config = newConfig;
    }
  }

  /**
   * Check Redis connection health
   */
  @HealthCheck({
    name: 'redis:ping',
    critical: true,
    interval: 30000, // Check every 30 seconds
    timeout: 5000,
  })
  async checkConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    if (!this.isEnabled()) {
      return { status: 'healthy', message: 'Cache is disabled' };
    }

    try {
      const start = Date.now();
      const result = await this.client.ping();
      const duration = Date.now() - start;

      if (duration > this.config.slowQueryThreshold) {
        return {
          status: 'unhealthy',
          message: `Redis ping took ${duration}ms (threshold: ${this.config.slowQueryThreshold}ms)`,
        };
      }

      return {
        status: result === 'PONG' ? 'healthy' : 'unhealthy',
        message: result === 'PONG' ? 'Redis connection is healthy' : 'Invalid ping response',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis ping failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Check Redis memory usage
   */
  @HealthCheck({
    name: 'redis:memory',
    critical: false,
    interval: 60000, // Check every minute
  })
  async checkMemory(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    if (!this.isEnabled()) {
      return { status: 'healthy', message: 'Cache is disabled' };
    }

    try {
      const info = await this.client.info('memory');
      const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
      const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || '0');

      if (maxMemory > 0) {
        const usage = usedMemory / maxMemory;
        
        if (usage > this.config.memoryWarningThreshold) {
          this.emit('redis:memory-warning', {
            used: usedMemory,
            limit: maxMemory,
            percentage: usage * 100,
          });

          return {
            status: usage > 0.95 ? 'unhealthy' : 'degraded',
            message: `Memory usage at ${(usage * 100).toFixed(1)}%`,
          };
        }
      }

      return {
        status: 'healthy',
        message: `Memory usage: ${(usedMemory / 1024 / 1024).toFixed(1)}MB`,
      };
    } catch (error) {
      return {
        status: 'degraded',
        message: `Failed to check memory: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get a value from cache with metrics and circuit breaker
   */
  @Metric({ name: 'cache.get', recordDuration: true })
  @CircuitBreaker({ threshold: 5, timeout: 5000 })
  @Retry({ attempts: 2, delay: 100, backoff: 'exponential' })
  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isEnabled()) return null;

    try {
      const start = Date.now();
      const value = await this.client.get(key);
      const duration = Date.now() - start;

      this.trackCommand('GET', duration);

      if (value === null) {
        this.emit('cache:miss', { key });
        return null;
      }

      this.emit('cache:hit', { key });
      return destr<T>(value);
    } catch (error) {
      this.emit('redis:error', {
        error: error as Error,
        operation: 'get',
      });
      throw error;
    }
  }

  /**
   * Set a value in cache
   */
  @Metric({ name: 'cache.set', recordDuration: true })
  @CircuitBreaker({ threshold: 5, timeout: 5000 })
  async set<T = any>(
    key: string,
    value: T,
    options?: CacheOptions
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const start = Date.now();
      const ttl = options?.ttl || this.config.ttl;
      const serialized = JSON.stringify(value);

      if (ttl > 0) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }

      const duration = Date.now() - start;
      this.trackCommand('SET', duration);

      this.emit('cache:set', {
        key,
        ttl,
        size: serialized.length,
      });

      // Handle tags for invalidation
      if (options?.tags) {
        await this.addTags(key, options.tags);
      }
    } catch (error) {
      this.emit('redis:error', {
        error: error as Error,
        operation: 'set',
      });
      throw error;
    }
  }

  /**
   * Delete a key from cache
   */
  @Metric({ name: 'cache.delete' })
  async delete(key: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const start = Date.now();
      const result = await this.client.del(key);
      const duration = Date.now() - start;

      this.trackCommand('DEL', duration);
      this.emit('cache:delete', { key });

      return result > 0;
    } catch (error) {
      this.emit('redis:error', {
        error: error as Error,
        operation: 'delete',
      });
      throw error;
    }
  }

  /**
   * Clear cache by pattern
   */
  @Metric({ name: 'cache.clear' })
  async clear(pattern?: string): Promise<number> {
    if (!this.isEnabled()) return 0;

    try {
      const start = Date.now();
      const keys = await this.client.keys(pattern || '*');
      
      if (keys.length === 0) return 0;

      const result = await this.client.del(...keys);
      const duration = Date.now() - start;

      this.trackCommand('CLEAR', duration);
      this.emit('cache:clear', {
        pattern,
        count: result,
      });

      return result;
    } catch (error) {
      this.emit('redis:error', {
        error: error as Error,
        operation: 'clear',
      });
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    if (!this.isEnabled() || tags.length === 0) return 0;

    let totalDeleted = 0;

    for (const tag of tags) {
      const keys = await this.client.smembers(`tag:${tag}`);
      if (keys.length > 0) {
        totalDeleted += await this.client.del(...keys);
        await this.client.del(`tag:${tag}`);
      }
    }

    return totalDeleted;
  }

  /**
   * Check if cache is enabled
   */
  private isEnabled(): boolean {
    return this.config.enabled && this.state === 'running' && this.client?.status === 'ready';
  }

  /**
   * Add tags to a key for invalidation
   */
  private async addTags(key: string, tags: string[]): Promise<void> {
    const pipeline = this.client.pipeline();
    
    for (const tag of tags) {
      pipeline.sadd(`tag:${tag}`, key);
    }
    
    await pipeline.exec();
  }

  /**
   * Track command metrics
   */
  private trackCommand(command: string, duration: number): void {
    this.commandCount++;
    
    this.emit('redis:command', {
      command,
      duration,
      status: 'success',
    });

    if (duration > this.config.slowQueryThreshold) {
      this.slowQueryCount++;
      this.emit('redis:slow-query', {
        command,
        duration,
        threshold: this.config.slowQueryThreshold,
      });
    }

    // Update metrics
    this.recordMetric('cache.commands.total', this.commandCount);
    this.recordMetric('cache.commands.slow', this.slowQueryCount);
    this.recordMetric('cache.command.duration', duration, { command });
  }

  /**
   * Start monitoring tasks
   */
  private startMonitoring(): void {
    // Monitor slow log periodically
    setInterval(async () => {
      try {
        const slowlog = await this.client.slowlog('get', 10);
        if (Array.isArray(slowlog) && slowlog.length > 0) {
          for (const entry of slowlog) {
            const [id, timestamp, duration, command] = entry;
            this.emit('redis:slow-query', {
              command: command.join(' '),
              duration: duration / 1000, // Convert to ms
              threshold: this.config.slowQueryThreshold,
            });
          }
        }
      } catch (error) {
        // Ignore monitoring errors
      }
    }, 60000); // Check every minute
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    enabled: boolean;
    connected: boolean;
    commandCount: number;
    slowQueryCount: number;
    keyCount?: number;
    memoryUsage?: number;
  }> {
    const stats = {
      enabled: this.config.enabled,
      connected: this.isEnabled(),
      commandCount: this.commandCount,
      slowQueryCount: this.slowQueryCount,
    };

    if (this.isEnabled()) {
      try {
        const dbsize = await this.client.dbsize();
        const info = await this.client.info('memory');
        const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');

        return {
          ...stats,
          keyCount: dbsize,
          memoryUsage: usedMemory,
        };
      } catch {
        // Return basic stats if additional info fails
      }
    }

    return stats;
  }
}