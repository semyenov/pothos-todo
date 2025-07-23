import Redis from 'ioredis';
import type { Redis as RedisClient, RedisOptions } from 'ioredis';
import { destr } from 'destr';
// import { env } from '@/config/env.validation.js';
import { logger } from '../../lib/unjs-utils.js';
// import { AsyncSingletonService } from '@/infrastructure/core/SingletonService.js';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
}

export class CacheManager {
  private client: RedisClient | null = null;
  public isConnected = false;

  private static instance: CacheManager | null = null;
  
  protected constructor() {
    // Removed super() call
  }

  public static async getInstance(): Promise<CacheManager> {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
      await CacheManager.instance.connect();
    }
    return CacheManager.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) { // || !env.CACHE_ENABLED) {
      return;
    }

    try {
      const options: RedisOptions = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'cache:',
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableOfflineQueue: true,
        maxRetriesPerRequest: 3,
      };

      this.client = new Redis(options);

      // Handle connection events
      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        logger.error('Redis error:', error);
      });

      this.client.on('close', () => {
        logger.info('Redis connection closed');
        this.isConnected = false;
      });

      // Wait for connection
      await this.client.ping();
      logger.info('Redis cache manager initialized');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      // Don't throw - cache should be optional
      // Cache disabled due to connection error
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  /**
   * Get a value from cache
   */
  public async get<T = any>(key: string): Promise<T | null> {
    if (!this.isEnabled()) return null;

    try {
      const value = await this.client!.get(key);
      if (!value) return null;

      return destr<T>(value);
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  public async set<T = any>(
    key: string,
    value: T,
    options?: CacheOptions
  ): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const ttl = options?.ttl || parseInt(process.env.CACHE_DEFAULT_TTL || '3600');
      const serialized = JSON.stringify(value);

      if (ttl > 0) {
        await this.client!.setex(key, ttl, serialized);
      } else {
        await this.client!.set(key, serialized);
      }

      // Handle tags for cache invalidation
      if (options?.tags && options.tags.length > 0) {
        await this.addToTags(key, options.tags);
      }

      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a value from cache
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const result = await this.client!.del(key);
      return result > 0;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  public async clear(): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      await this.client!.flushdb();
      return true;
    } catch (error) {
      logger.error('Cache clear error:', error);
      return false;
    }
  }

  /**
   * Invalidate cache by tags
   */
  public async invalidateByTags(tags: string[]): Promise<number> {
    if (!this.isEnabled() || tags.length === 0) return 0;

    try {
      const keys = new Set<string>();

      // Get all keys associated with each tag
      for (const tag of tags) {
        const tagKey = `tag:${tag}`;
        const taggedKeys = await this.client!.smembers(tagKey);
        taggedKeys.forEach(key => keys.add(key));

        // Remove the tag set
        await this.client!.del(tagKey);
      }

      // Delete all tagged keys
      if (keys.size > 0) {
        const keysArray = Array.from(keys);
        await this.client!.del(...keysArray);
      }

      return keys.size;
    } catch (error) {
      logger.error('Cache invalidate by tags error:', error);
      return 0;
    }
  }

  /**
   * Get or set cache value
   */
  public async getOrSet<T = any>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Generate value
    const value = await factory();

    // Store in cache
    await this.set(key, value, options);

    return value;
  }

  /**
   * Check if cache is enabled and connected
   */
  private isEnabled(): boolean {
    return (process.env.CACHE_ENABLED !== 'false') && this.isConnected && this.client !== null;
  }

  /**
   * Add a key to tag sets
   */
  private async addToTags(key: string, tags: string[]): Promise<void> {
    const pipeline = this.client!.pipeline();

    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      pipeline.sadd(tagKey, key);
      // Set expiration on tag set to match max TTL
      pipeline.expire(tagKey, parseInt(process.env.CACHE_DEFAULT_TTL || '3600') * 2);
    }

    await pipeline.exec();
  }

  /**
   * Create a cache key with namespace
   */
  public static createKey(...parts: string[]): string {
    return parts.join(':');
  }
}