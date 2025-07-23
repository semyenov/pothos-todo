import { logger } from '@/logger.js';
import { CacheManager } from '../cache/CacheManager.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { SingletonService } from '../core/SingletonService.js';

export interface ThrottleConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number;
  
  /**
   * Time window in milliseconds
   */
  windowMs: number;
  
  /**
   * Identifier for the throttle rule
   */
  name: string;
  
  /**
   * Function to generate the key for throttling (e.g., by IP, user ID)
   */
  keyGenerator: (identifier: string) => string;
  
  /**
   * Skip throttling for certain conditions
   */
  skip?: (identifier: string) => boolean;
  
  /**
   * Custom error message when throttled
   */
  message?: string;
  
  /**
   * Headers to include in throttle response
   */
  headers?: boolean;
}

export interface ThrottleResult {
  allowed: boolean;
  totalRequests: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

export class ThrottledError extends Error {
  constructor(
    public throttleName: string,
    public retryAfter: number,
    public remaining: number,
    message?: string
  ) {
    super(message || `Request throttled. Retry after ${retryAfter}ms`);
    this.name = 'ThrottledError';
  }
}

export class RequestThrottling {
  private cache: CacheManager;
  private metrics: MetricsCollector;

  constructor() {
    this.cache = CacheManager.getInstance();
    this.metrics = MetricsCollector.getInstance();
  }

  /**
   * Check if request should be throttled
   */
  async checkThrottle(
    identifier: string,
    config: ThrottleConfig
  ): Promise<ThrottleResult> {
    // Skip throttling if configured
    if (config.skip && config.skip(identifier)) {
      return {
        allowed: true,
        totalRequests: 0,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs),
      };
    }

    const key = config.keyGenerator(identifier);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Get current request count for the window
      const requests = await this.getRequestsInWindow(key, windowStart, now);
      const totalRequests = requests.length;
      const remaining = Math.max(0, config.maxRequests - totalRequests);
      const resetTime = new Date(now + config.windowMs);

      // Check if request should be allowed
      const allowed = totalRequests < config.maxRequests;

      if (allowed) {
        // Add current request to the window
        await this.addRequest(key, now, config.windowMs);
        
        this.metrics.recordMetric('throttle.request.allowed', 1, {
          throttleName: config.name,
          identifier,
        });
      } else {
        // Calculate retry after time
        const oldestRequest = Math.min(...requests);
        const retryAfter = Math.max(0, oldestRequest + config.windowMs - now);
        
        this.metrics.recordMetric('throttle.request.blocked', 1, {
          throttleName: config.name,
          identifier,
          totalRequests,
        });

        logger.warn('Request throttled', {
          throttleName: config.name,
          identifier,
          totalRequests,
          maxRequests: config.maxRequests,
          retryAfter,
        });

        return {
          allowed: false,
          totalRequests,
          remaining: 0,
          resetTime,
          retryAfter,
        };
      }

      return {
        allowed: true,
        totalRequests: totalRequests + 1,
        remaining: remaining - 1,
        resetTime,
      };

    } catch (error) {
      logger.error('Throttling check failed', {
        error,
        throttleName: config.name,
        identifier,
      });

      // Fail open - allow request if throttling system fails
      return {
        allowed: true,
        totalRequests: 0,
        remaining: config.maxRequests,
        resetTime: new Date(now + config.windowMs),
      };
    }
  }

  /**
   * Execute function with throttling protection
   */
  async executeWithThrottle<T>(
    identifier: string,
    config: ThrottleConfig,
    fn: () => Promise<T>
  ): Promise<T> {
    const result = await this.checkThrottle(identifier, config);

    if (!result.allowed) {
      throw new ThrottledError(
        config.name,
        result.retryAfter || 0,
        result.remaining,
        config.message
      );
    }

    return fn();
  }

  /**
   * Get requests in current time window
   */
  private async getRequestsInWindow(
    key: string,
    windowStart: number,
    now: number
  ): Promise<number[]> {
    const cacheKey = `throttle:${key}`;
    
    try {
      const data = await this.cache.get(cacheKey);
      const requests: number[] = data ? JSON.parse(data) : [];
      
      // Filter requests within the current window
      return requests.filter(timestamp => timestamp > windowStart);
    } catch (error) {
      logger.error('Failed to get throttle window data', { error, key });
      return [];
    }
  }

  /**
   * Add current request to the window
   */
  private async addRequest(
    key: string,
    timestamp: number,
    windowMs: number
  ): Promise<void> {
    const cacheKey = `throttle:${key}`;
    const windowStart = timestamp - windowMs;
    
    try {
      // Get existing requests and filter to current window
      const existing = await this.getRequestsInWindow(key, windowStart, timestamp);
      
      // Add current request
      const updated = [...existing, timestamp];
      
      // Store with TTL slightly longer than window to account for clock drift
      const ttl = Math.ceil(windowMs / 1000) + 10;
      await this.cache.set(cacheKey, JSON.stringify(updated), { ttl });
      
    } catch (error) {
      logger.error('Failed to add request to throttle window', { error, key });
    }
  }

  /**
   * Clear throttle data for identifier (admin function)
   */
  async clearThrottle(identifier: string, throttleName: string): Promise<void> {
    const key = `throttle:${throttleName}:${identifier}`;
    await this.cache.delete(key);
    
    logger.info('Throttle data cleared', { identifier, throttleName });
  }

  /**
   * Get throttle statistics for identifier
   */
  async getThrottleStats(
    identifier: string,
    config: ThrottleConfig
  ): Promise<{
    currentRequests: number;
    maxRequests: number;
    remaining: number;
    resetTime: Date;
    windowMs: number;
  }> {
    const key = config.keyGenerator(identifier);
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    const requests = await this.getRequestsInWindow(key, windowStart, now);
    const currentRequests = requests.length;
    const remaining = Math.max(0, config.maxRequests - currentRequests);
    
    return {
      currentRequests,
      maxRequests: config.maxRequests,
      remaining,
      resetTime: new Date(now + config.windowMs),
      windowMs: config.windowMs,
    };
  }
}

/**
 * Throttle registry for managing multiple throttle configurations
 */
export class ThrottleRegistry extends SingletonService<ThrottleRegistry> {
  private throttling: RequestThrottling;
  private configs = new Map<string, ThrottleConfig>();

  protected constructor() {
    super();
    this.throttling = new RequestThrottling();
  }

  public static getInstance(): ThrottleRegistry {
    return super.getInstance();
  }

  /**
   * Register a throttle configuration
   */
  register(config: ThrottleConfig): void {
    this.configs.set(config.name, config);
    
    logger.info('Throttle configuration registered', {
      name: config.name,
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
    });
  }

  /**
   * Check throttle by name
   */
  async checkThrottle(
    throttleName: string,
    identifier: string
  ): Promise<ThrottleResult> {
    const config = this.configs.get(throttleName);
    
    if (!config) {
      throw new Error(`Throttle configuration '${throttleName}' not found`);
    }
    
    return this.throttling.checkThrottle(identifier, config);
  }

  /**
   * Execute function with named throttle
   */
  async executeWithThrottle<T>(
    throttleName: string,
    identifier: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const config = this.configs.get(throttleName);
    
    if (!config) {
      throw new Error(`Throttle configuration '${throttleName}' not found`);
    }
    
    return this.throttling.executeWithThrottle(identifier, config, fn);
  }

  /**
   * Get all throttle statistics
   */
  async getAllStats(identifier: string): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const [name, config] of this.configs.entries()) {
      try {
        stats[name] = await this.throttling.getThrottleStats(identifier, config);
      } catch (error) {
        stats[name] = { error: (error as Error).message };
      }
    }
    
    return stats;
  }
}

/**
 * Common throttle key generators
 */
export const throttleKeyGenerators = {
  byIP: (identifier: string) => `ip:${identifier}`,
  byUser: (identifier: string) => `user:${identifier}`,
  bySession: (identifier: string) => `session:${identifier}`,
  byApiKey: (identifier: string) => `apikey:${identifier}`,
  global: () => 'global',
  combined: (ip: string, userId?: string) => 
    userId ? `combined:${userId}:${ip}` : `ip:${ip}`,
};

/**
 * Default throttle configurations
 */
export const defaultThrottleConfigs: ThrottleConfig[] = [
  {
    name: 'auth',
    maxRequests: 5,
    windowMs: 60000, // 1 minute
    keyGenerator: throttleKeyGenerators.byIP,
    message: 'Too many authentication attempts. Please try again later.',
    headers: true,
  },
  {
    name: 'graphql-query',
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    keyGenerator: throttleKeyGenerators.byUser,
    skip: (identifier) => identifier === 'admin',
    headers: true,
  },
  {
    name: 'graphql-mutation',
    maxRequests: 50,
    windowMs: 60000, // 1 minute
    keyGenerator: throttleKeyGenerators.byUser,
    headers: true,
  },
  {
    name: 'ai-operations',
    maxRequests: 10,
    windowMs: 60000, // 1 minute
    keyGenerator: throttleKeyGenerators.byUser,
    message: 'AI operation rate limit exceeded. Please wait before making more AI requests.',
    headers: true,
  },
  {
    name: 'global',
    maxRequests: 10000,
    windowMs: 60000, // 1 minute
    keyGenerator: throttleKeyGenerators.global,
    message: 'Global rate limit exceeded. Please try again later.',
    headers: true,
  },
];