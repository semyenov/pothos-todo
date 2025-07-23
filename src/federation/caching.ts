import { Plugin } from '@envelop/core';
import { useResponseCache, createInMemoryCache } from '@envelop/response-cache';
import { createRedisCache } from '@envelop/response-cache-redis';
import Redis from 'ioredis';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import crypto from 'crypto';
import { federationMetrics } from './monitoring.js';

// Cache configuration
export interface CacheConfig {
  enabled: boolean;
  strategy: 'memory' | 'redis' | 'hybrid';
  ttl: {
    default: number;
    query: Record<string, number>;
    type: Record<string, number>;
  };
  invalidation: {
    enabled: boolean;
    patterns: Array<{
      mutation: string;
      invalidates: string[];
    }>;
  };
  redis?: {
    host: string;
    port: number;
    password?: string;
    keyPrefix: string;
  };
  maxSize?: number;
  warmup?: {
    enabled: boolean;
    queries: Array<{
      query: string;
      variables?: Record<string, any>;
      ttl?: number;
    }>;
  };
}

// Default cache configuration
export const defaultCacheConfig: CacheConfig = {
  enabled: true,
  strategy: process.env.REDIS_URL ? 'redis' : 'memory',
  ttl: {
    default: 60 * 1000, // 1 minute
    query: {
      // Specific query TTLs
      users: 5 * 60 * 1000, // 5 minutes
      todos: 2 * 60 * 1000, // 2 minutes
      suggestTodos: 10 * 60 * 1000, // 10 minutes
      getUserInsights: 30 * 60 * 1000, // 30 minutes
    },
    type: {
      // Type-specific TTLs
      User: 5 * 60 * 1000,
      Todo: 2 * 60 * 1000,
      TodoList: 5 * 60 * 1000,
      AIInsight: 30 * 60 * 1000,
    },
  },
  invalidation: {
    enabled: true,
    patterns: [
      // User mutations
      { mutation: 'createUser', invalidates: ['users', 'User:*'] },
      { mutation: 'updateUser', invalidates: ['users', 'User:{args.id}'] },
      { mutation: 'deleteUser', invalidates: ['users', 'User:{args.id}'] },
      
      // Todo mutations
      { mutation: 'createTodo', invalidates: ['todos', 'Todo:*', 'User:{args.input.userId}'] },
      { mutation: 'updateTodo', invalidates: ['todos', 'Todo:{args.id}', 'User:*'] },
      { mutation: 'deleteTodo', invalidates: ['todos', 'Todo:{args.id}', 'User:*'] },
      { mutation: 'updateTodoStatus', invalidates: ['Todo:{args.id}', 'todoStats'] },
      
      // TodoList mutations
      { mutation: 'createTodoList', invalidates: ['todoLists', 'TodoList:*', 'User:{args.input.userId}'] },
      { mutation: 'addTodoToList', invalidates: ['TodoList:{args.listId}', 'Todo:{args.todoId}'] },
      
      // AI mutations (less aggressive invalidation)
      { mutation: 'executeNLPCommand', invalidates: ['suggestTodos'] },
    ],
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    keyPrefix: 'federation:cache:',
  },
  maxSize: 1000, // Max entries for in-memory cache
  warmup: {
    enabled: true,
    queries: [
      {
        query: `query WarmupUsers { users(first: 10) { id email name } }`,
        ttl: 10 * 60 * 1000,
      },
      {
        query: `query WarmupTodos { todos(first: 20, where: { status: "pending" }) { id title } }`,
        ttl: 5 * 60 * 1000,
      },
    ],
  },
};

// Cache key generator
export class CacheKeyGenerator {
  static generate(
    typeName: string,
    fieldName: string,
    args: Record<string, any>,
    context: any
  ): string {
    const parts = [typeName, fieldName];
    
    // Add user context if available
    if (context.userId) {
      parts.push(`user:${context.userId}`);
    }
    
    // Add sorted args
    if (args && Object.keys(args).length > 0) {
      const sortedArgs = Object.keys(args)
        .sort()
        .map(key => `${key}:${JSON.stringify(args[key])}`)
        .join(',');
      parts.push(crypto.createHash('md5').update(sortedArgs).digest('hex'));
    }
    
    return parts.join(':');
  }
  
  static generatePattern(pattern: string, args: Record<string, any>): string {
    // Replace placeholders with actual values
    return pattern.replace(/\{args\.([^}]+)\}/g, (match, path) => {
      const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], args);
      return value || '*';
    });
  }
}

// Cache storage implementations
export class HybridCache {
  private memoryCache: Map<string, { value: any; expires: number }>;
  private redisClient?: Redis;
  
  constructor(
    private config: CacheConfig,
    redisClient?: Redis
  ) {
    this.memoryCache = new Map();
    this.redisClient = redisClient;
    
    // Periodic cleanup for memory cache
    setInterval(() => this.cleanup(), 60 * 1000); // Every minute
  }
  
  async get(key: string): Promise<any | null> {
    // Try memory cache first
    const memoryResult = this.memoryCache.get(key);
    if (memoryResult && memoryResult.expires > Date.now()) {
      federationMetrics.cacheHits.inc({ subgraph: 'gateway', cache_type: 'memory' });
      return memoryResult.value;
    }
    
    // Try Redis if available
    if (this.redisClient) {
      try {
        const redisResult = await this.redisClient.get(key);
        if (redisResult) {
          const parsed = JSON.parse(redisResult);
          // Update memory cache
          this.memoryCache.set(key, {
            value: parsed,
            expires: Date.now() + 60 * 1000, // Keep in memory for 1 minute
          });
          federationMetrics.cacheHits.inc({ subgraph: 'gateway', cache_type: 'redis' });
          return parsed;
        }
      } catch (error) {
        logger.warn('Redis cache error:', error);
      }
    }
    
    federationMetrics.cacheMisses.inc({ subgraph: 'gateway', cache_type: 'hybrid' });
    return null;
  }
  
  async set(key: string, value: any, ttl: number): Promise<void> {
    // Set in memory cache
    this.memoryCache.set(key, {
      value,
      expires: Date.now() + ttl,
    });
    
    // Enforce max size
    if (this.memoryCache.size > (this.config.maxSize || 1000)) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }
    
    // Set in Redis if available
    if (this.redisClient) {
      try {
        await this.redisClient.setex(key, Math.floor(ttl / 1000), JSON.stringify(value));
      } catch (error) {
        logger.warn('Redis cache set error:', error);
      }
    }
  }
  
  async invalidate(patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      // Invalidate memory cache
      for (const key of this.memoryCache.keys()) {
        if (this.matchesPattern(key, pattern)) {
          this.memoryCache.delete(key);
        }
      }
      
      // Invalidate Redis cache
      if (this.redisClient) {
        try {
          const keys = await this.redisClient.keys(`${this.config.redis?.keyPrefix}${pattern}`);
          if (keys.length > 0) {
            await this.redisClient.del(...keys);
          }
        } catch (error) {
          logger.warn('Redis cache invalidation error:', error);
        }
      }
    }
  }
  
  private matchesPattern(key: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(key);
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expires < now) {
        this.memoryCache.delete(key);
      }
    }
  }
}

// Create caching plugin
export function createCachingPlugin(config: CacheConfig = defaultCacheConfig): Plugin[] {
  if (!config.enabled) {
    return [];
  }
  
  const plugins: Plugin[] = [];
  
  // Create cache storage
  let cache: any;
  if (config.strategy === 'redis' && config.redis) {
    const redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    });
    
    cache = createRedisCache({ redis: redisClient });
    logger.info(chalk.green('Using Redis cache'));
  } else if (config.strategy === 'hybrid' && config.redis) {
    const redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    });
    
    cache = new HybridCache(config, redisClient);
    logger.info(chalk.green('Using Hybrid cache (Memory + Redis)'));
  } else {
    cache = createInMemoryCache({ max: config.maxSize });
    logger.info(chalk.green('Using In-Memory cache'));
  }
  
  // Response caching plugin
  plugins.push(
    useResponseCache({
      cache,
      ttl: (context) => {
        const operation = context.operation;
        const operationName = context.operationName;
        
        // Check specific query TTLs
        if (operationName && config.ttl.query[operationName]) {
          return config.ttl.query[operationName];
        }
        
        // Check type TTLs
        const typeName = operation.selectionSet.selections[0]?.name?.value;
        if (typeName && config.ttl.type[typeName]) {
          return config.ttl.type[typeName];
        }
        
        return config.ttl.default;
      },
      ignoredTypes: ['Mutation', 'Subscription'],
      session: (context) => context.userId || 'anonymous',
      enabled: (context) => {
        // Disable caching for certain operations
        const operation = context.operation;
        const operationName = context.operationName;
        
        // Skip caching for introspection
        if (operationName?.startsWith('__')) {
          return false;
        }
        
        // Skip caching if explicitly disabled in context
        if (context.skipCache) {
          return false;
        }
        
        return true;
      },
    })
  );
  
  // Cache invalidation plugin
  if (config.invalidation.enabled) {
    plugins.push({
      onExecute({ args }) {
        return {
          onExecuteDone({ result }) {
            if (!result.errors && args.document.definitions[0]?.operation === 'mutation') {
              const mutationName = args.document.definitions[0]?.selectionSet?.selections[0]?.name?.value;
              
              if (mutationName) {
                // Find invalidation patterns
                const patterns = config.invalidation.patterns
                  .filter(p => p.mutation === mutationName)
                  .flatMap(p => p.invalidates)
                  .map(pattern => CacheKeyGenerator.generatePattern(pattern, args.variableValues || {}));
                
                if (patterns.length > 0) {
                  // Invalidate cache entries
                  if (cache instanceof HybridCache) {
                    cache.invalidate(patterns).catch(error => {
                      logger.error('Cache invalidation error:', error);
                    });
                  }
                  
                  logger.info(chalk.yellow(`Cache invalidated for mutation ${mutationName}:`, patterns));
                }
              }
            }
          },
        };
      },
    });
  }
  
  return plugins;
}

// Cache warmup utility
export async function warmupCache(
  endpoint: string,
  config: CacheConfig
): Promise<void> {
  if (!config.warmup?.enabled || !config.warmup.queries) {
    return;
  }
  
  logger.info(chalk.blue('Starting cache warmup...'));
  
  for (const warmupQuery of config.warmup.queries) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: warmupQuery.query,
          variables: warmupQuery.variables,
        }),
      });
      
      if (response.ok) {
        logger.info(chalk.green(`✓ Warmed up query: ${warmupQuery.query.substring(0, 50)}...`));
      } else {
        logger.warn(chalk.yellow(`Failed to warmup query: ${response.status}`));
      }
    } catch (error) {
      logger.error('Cache warmup error:', error);
    }
  }
  
  logger.info(chalk.green('Cache warmup completed'));
}

// Cache statistics
export class CacheStats {
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private errors = 0;
  
  recordHit(): void {
    this.hits++;
  }
  
  recordMiss(): void {
    this.misses++;
  }
  
  recordInvalidation(): void {
    this.invalidations++;
  }
  
  recordError(): void {
    this.errors++;
  }
  
  getStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    invalidations: number;
    errors: number;
  } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      invalidations: this.invalidations,
      errors: this.errors,
    };
  }
  
  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    this.errors = 0;
  }
}

// Export cache stats instance
export const cacheStats = new CacheStats();

// Cache debugging plugin
export function createCacheDebugPlugin(): Plugin {
  return {
    onExecute({ args }) {
      const startTime = Date.now();
      const operationName = args.operationName || 'anonymous';
      
      return {
        onExecuteDone({ result }) {
          const duration = Date.now() - startTime;
          const cached = duration < 5; // Assume cached if very fast
          
          if (cached) {
            logger.debug(chalk.cyan(`[CACHE HIT] ${operationName} (${duration}ms)`));
            cacheStats.recordHit();
          } else {
            logger.debug(chalk.yellow(`[CACHE MISS] ${operationName} (${duration}ms)`));
            cacheStats.recordMiss();
          }
        },
      };
    },
  };
}