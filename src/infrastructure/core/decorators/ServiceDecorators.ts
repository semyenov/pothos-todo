import { z } from 'zod';
import type { ServiceConfigOptions } from '../BaseService.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Class decorator for automatic service configuration
 * 
 * @example
 * ```typescript
 * @ServiceConfig({
 *   schema: z.object({ host: z.string(), port: z.number() }),
 *   prefix: 'redis',
 *   hot: true
 * })
 * class RedisService extends BaseService<RedisConfig> {
 *   // Config automatically loaded and validated
 * }
 * ```
 */
export function ServiceConfig<T>(options: ServiceConfigOptions<T>) {
  return function <TClass extends new (...args: any[]) => any>(constructor: TClass) {
    return class extends constructor {
      protected getConfigSchema() {
        return options.schema;
      }

      protected getConfigPrefix() {
        return options.prefix || super.getConfigPrefix?.() || this.getServiceName();
      }

      async initialize() {
        await super.initialize(options);
      }
    };
  };
}

/**
 * Method decorator for caching
 * 
 * @example
 * ```typescript
 * @Cache({ ttl: 300, key: (args) => `user:${args[0]}` })
 * async getUser(id: string) {
 *   return database.findUser(id);
 * }
 * ```
 */
export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  key?: (...args: any[]) => string; // Custom cache key generator
  condition?: (...args: any[]) => boolean; // Conditional caching
  invalidateOn?: string[]; // Event names that invalidate this cache
}

export function Cache(options: CacheOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      // Check if caching should be applied
      if (options.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      // Generate cache key
      const cacheKey = options.key
        ? options.key(...args)
        : `${methodName}:${JSON.stringify(args)}`;

      // Try to get from cache
      if (this.cacheManager) {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached !== null) {
          this.emit?.('cache:hit', { key: cacheKey, method: methodName });
          return cached;
        }
      }

      // Execute method
      const result = await originalMethod.apply(this, args);

      // Store in cache
      if (this.cacheManager && result !== null && result !== undefined) {
        await this.cacheManager.set(cacheKey, result, { ttl: options.ttl });
        this.emit?.('cache:miss', { key: cacheKey, method: methodName });
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * Method decorator for retry logic
 * 
 * @example
 * ```typescript
 * @Retry({ attempts: 3, backoff: 'exponential', maxDelay: 10000 })
 * async fetchData() {
 *   return externalApi.getData();
 * }
 * ```
 */
export interface RetryOptions {
  attempts?: number;
  delay?: number;
  maxDelay?: number;
  backoff?: 'fixed' | 'exponential' | 'linear';
  retryIf?: (error: Error) => boolean;
}

export function Retry(options: RetryOptions = {}) {
  const {
    attempts = 3,
    delay = 1000,
    maxDelay = 30000,
    backoff = 'exponential',
    retryIf = () => true,
  } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      let lastError: Error;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const result = await originalMethod.apply(this, args);

          if (attempt > 1) {
            logger.info(`${methodName} succeeded after ${attempt} attempts`);
          }

          return result;
        } catch (error) {
          lastError = error as Error;

          if (!retryIf(lastError) || attempt === attempts) {
            throw lastError;
          }

          // Calculate delay
          let retryDelay = delay;
          if (backoff === 'exponential') {
            retryDelay = Math.min(delay * Math.pow(2, attempt - 1), maxDelay);
          } else if (backoff === 'linear') {
            retryDelay = Math.min(delay * attempt, maxDelay);
          }

          logger.warn(
            `${methodName} failed (attempt ${attempt}/${attempts}), retrying in ${retryDelay}ms`,
            { error: lastError.message }
          );

          this.emit?.('method:retry', {
            method: methodName,
            attempt,
            maxAttempts: attempts,
            delay: retryDelay,
            error: lastError,
          });

          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }

      throw lastError!;
    };

    return descriptor;
  };
}

/**
 * Method decorator for circuit breaker pattern
 * 
 * @example
 * ```typescript
 * @CircuitBreaker({ threshold: 5, timeout: 30000, resetTime: 60000 })
 * async callExternalService() {
 *   return externalApi.call();
 * }
 * ```
 */
export interface CircuitBreakerOptions {
  threshold?: number; // Number of failures before opening
  timeout?: number; // Timeout for each call
  resetTime?: number; // Time before attempting to close circuit
  fallback?: (...args: any[]) => any; // Fallback function when circuit is open
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

export function CircuitBreaker(options: CircuitBreakerOptions = {}) {
  const {
    threshold = 5,
    timeout = 10000,
    resetTime = 60000,
    fallback,
  } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;
    const circuitKey = methodName;

    // Initialize circuit breaker state
    if (!circuitBreakers.has(circuitKey)) {
      circuitBreakers.set(circuitKey, {
        failures: 0,
        lastFailureTime: 0,
        state: 'closed',
      });
    }

    descriptor.value = async function (this: any, ...args: any[]) {
      const circuit = circuitBreakers.get(circuitKey)!;

      // Check if circuit should be reset
      if (
        circuit.state === 'open' &&
        Date.now() - circuit.lastFailureTime > resetTime
      ) {
        circuit.state = 'half-open';
        circuit.failures = 0;
      }

      // If circuit is open, use fallback or throw
      if (circuit.state === 'open') {
        this.emit?.('circuit:open', {
          method: methodName,
          failures: circuit.failures,
        });

        if (fallback) {
          return fallback.apply(this, args);
        }
        throw new Error(`Circuit breaker is open for ${methodName}`);
      }

      try {
        // Execute with timeout
        const result = await Promise.race([
          originalMethod.apply(this, args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Circuit breaker timeout')), timeout)
          ),
        ]);

        // Success - reset failures if in half-open state
        if (circuit.state === 'half-open') {
          circuit.state = 'closed';
          this.emit?.('circuit:closed', { method: methodName });
        }
        circuit.failures = 0;

        return result;
      } catch (error) {
        circuit.failures++;
        circuit.lastFailureTime = Date.now();

        if (circuit.failures >= threshold) {
          circuit.state = 'open';
          this.emit?.('circuit:opened', {
            method: methodName,
            failures: circuit.failures,
            error: (error as Error).message,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Method decorator for rate limiting
 * 
 * @example
 * ```typescript
 * @RateLimit({ window: 60000, max: 100 })
 * async processRequest() {
 *   // Limited to 100 calls per minute
 * }
 * ```
 */
export interface RateLimitOptions {
  window: number; // Time window in milliseconds
  max: number; // Maximum calls in window
  keyGenerator?: (...args: any[]) => string; // Custom key for rate limiting
}

const rateLimiters = new Map<string, { calls: number[]; }>();

export function RateLimit(options: RateLimitOptions) {
  const { window, max, keyGenerator } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      const key = keyGenerator
        ? keyGenerator(...args)
        : methodName;

      if (!rateLimiters.has(key)) {
        rateLimiters.set(key, { calls: [] });
      }

      const limiter = rateLimiters.get(key)!;
      const now = Date.now();

      // Remove old calls outside the window
      limiter.calls = limiter.calls.filter(time => now - time < window);

      // Check rate limit
      if (limiter.calls.length >= max) {
        const oldestCall = limiter.calls[0];
        const resetTime = new Date(oldestCall + window);

        this.emit?.('rate:limited', {
          method: methodName,
          limit: max,
          window,
          resetTime,
        });

        throw new Error(
          `Rate limit exceeded for ${methodName}. Reset at ${resetTime.toISOString()}`
        );
      }

      // Record the call
      limiter.calls.push(now);

      // Execute method
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Method decorator for automatic metric recording
 * 
 * @example
 * ```typescript
 * @Metric({ name: 'api.request', tags: { endpoint: 'users' } })
 * async getUsers() {
 *   return userService.findAll();
 * }
 * ```
 */
export interface MetricOptions {
  name?: string;
  tags?: Record<string, string>;
  recordDuration?: boolean;
  recordErrors?: boolean;
}

export function Metric(options: MetricOptions = {}) {
  const { recordDuration = true, recordErrors = true } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;
    const metricName = options.name || methodName;

    descriptor.value = async function (this: any, ...args: any[]) {
      const startTime = Date.now();

      try {
        const result = await originalMethod.apply(this, args);

        if (recordDuration && this.recordMetric) {
          this.recordMetric(`${metricName}.duration`, Date.now() - startTime, options.tags);
          this.recordMetric(`${metricName}.success`, 1, options.tags);
        }

        return result;
      } catch (error) {
        if (recordErrors && this.recordMetric) {
          this.recordMetric(`${metricName}.error`, 1, {
            ...options.tags,
            error: (error as Error).name,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Method decorator for health check registration
 * 
 * @example
 * ```typescript
 * @HealthCheck({ name: 'database:ping', critical: true })
 * async checkDatabaseConnection() {
 *   return { status: 'healthy', message: 'Database is connected' };
 * }
 * ```
 */
export interface HealthCheckOptions {
  name: string;
  critical?: boolean;
  interval?: number;
  timeout?: number;
}

export function HealthCheck(options: HealthCheckOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    // Store health check metadata
    if (!target._healthChecks) {
      target._healthChecks = [];
    }

    target._healthChecks.push({
      ...options,
      method: propertyKey,
    });

    // Register health check on initialization
    const originalOnInitialize = target.onInitialize;
    target.onInitialize = async function (this: any) {
      if (originalOnInitialize) {
        await originalOnInitialize.call(this);
      }

      // Register the health check
      this.registerHealthCheck({
        name: options.name,
        critical: options.critical,
        interval: options.interval,
        timeout: options.timeout,
        check: async () => {
          const result = await originalMethod.call(this);
          return {
            name: options.name,
            status: result.status || 'healthy',
            message: result.message,
            timestamp: new Date(),
          };
        },
      });
    };

    return descriptor;
  };
}