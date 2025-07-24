import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
  timeout: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
  attemptDetails: Array<{
    attempt: number;
    success: boolean;
    duration: number;
    error?: string;
    delay?: number;
  }>;
}

interface RetryEventMap {
  'retry:started': {
    operation: string;
    config: RetryConfig;
    timestamp: Date;
  };
  'retry:attempt': {
    operation: string;
    attempt: number;
    maxAttempts: number;
    delay?: number;
    timestamp: Date;
  };
  'retry:success': {
    operation: string;
    attempts: number;
    totalDuration: number;
    timestamp: Date;
  };
  'retry:failed': {
    operation: string;
    attempts: number;
    totalDuration: number;
    finalError: Error;
    timestamp: Date;
  };
  'retry:exhausted': {
    operation: string;
    maxAttempts: number;
    totalDuration: number;
    timestamp: Date;
  };
}

export class RetryPolicy extends TypedEventEmitter<RetryEventMap> {
  private static instance: RetryPolicy;
  private defaultConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'],
    timeout: 60000,
  };

  private constructor() {
    super();
  }

  static getInstance(): RetryPolicy {
    if (!RetryPolicy.instance) {
      RetryPolicy.instance = new RetryPolicy();
    }
    return RetryPolicy.instance;
  }

  setDefaultConfig(config: Partial<RetryConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    logger.info('Default retry policy updated', config);
  }

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string = 'unnamed',
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const result = await this.executeWithResult(operation, operationName, config);
    
    if (result.success && result.result !== undefined) {
      return result.result;
    } else {
      throw result.error || new Error('Operation failed after all retry attempts');
    }
  }

  async executeWithResult<T>(
    operation: () => Promise<T>,
    operationName: string = 'unnamed',
    config?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    
    this.emit('retry:started', {
      operation: operationName,
      config: finalConfig,
      timestamp: new Date(),
    });

    const attemptDetails: RetryResult<T>['attemptDetails'] = [];
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      const attemptStartTime = Date.now();
      
      try {
        // Emit attempt event
        this.emit('retry:attempt', {
          operation: operationName,
          attempt,
          maxAttempts: finalConfig.maxAttempts,
          timestamp: new Date(),
        });

        // Execute the operation with timeout
        const result = await this.executeWithTimeout(operation, finalConfig.timeout);
        const attemptDuration = Date.now() - attemptStartTime;
        const totalDuration = Date.now() - startTime;

        // Record successful attempt
        attemptDetails.push({
          attempt,
          success: true,
          duration: attemptDuration,
        });

        // Emit success event
        this.emit('retry:success', {
          operation: operationName,
          attempts: attempt,
          totalDuration,
          timestamp: new Date(),
        });

        logger.debug(`Operation ${operationName} succeeded on attempt ${attempt}/${finalConfig.maxAttempts}`, {
          duration: attemptDuration,
          totalDuration,
        });

        return {
          success: true,
          result,
          attempts: attempt,
          totalDuration,
          attemptDetails,
        };

      } catch (error) {
        const attemptDuration = Date.now() - attemptStartTime;
        lastError = error as Error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError, finalConfig);
        
        // Record failed attempt
        attemptDetails.push({
          attempt,
          success: false,
          duration: attemptDuration,
          error: lastError.message,
        });

        logger.debug(`Operation ${operationName} failed on attempt ${attempt}/${finalConfig.maxAttempts}`, {
          error: lastError.message,
          retryable: isRetryable,
          duration: attemptDuration,
        });

        // Don't retry if error is not retryable or this was the last attempt
        if (!isRetryable || attempt === finalConfig.maxAttempts) {
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, finalConfig);
        attemptDetails[attemptDetails.length - 1].delay = delay;

        // Emit attempt event with delay
        this.emit('retry:attempt', {
          operation: operationName,
          attempt: attempt + 1,
          maxAttempts: finalConfig.maxAttempts,
          delay,
          timestamp: new Date(),
        });

        // Wait before next attempt
        await this.delay(delay);
      }
    }

    const totalDuration = Date.now() - startTime;

    // All attempts exhausted
    this.emit('retry:exhausted', {
      operation: operationName,
      maxAttempts: finalConfig.maxAttempts,
      totalDuration,
      timestamp: new Date(),
    });

    this.emit('retry:failed', {
      operation: operationName,
      attempts: finalConfig.maxAttempts,
      totalDuration,
      finalError: lastError,
      timestamp: new Date(),
    });

    logger.warn(`Operation ${operationName} failed after ${finalConfig.maxAttempts} attempts`, {
      totalDuration,
      finalError: lastError.message,
    });

    return {
      success: false,
      error: lastError,
      attempts: finalConfig.maxAttempts,
      totalDuration,
      attemptDetails,
    };
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private isRetryableError(error: Error, config: RetryConfig): boolean {
    // Check if error message or code matches retryable patterns
    const errorString = error.toString().toLowerCase();
    const errorCode = (error as any).code;

    // Check for specific error codes
    if (errorCode && config.retryableErrors.includes(errorCode)) {
      return true;
    }

    // Check for error message patterns
    for (const retryableError of config.retryableErrors) {
      if (errorString.includes(retryableError.toLowerCase())) {
        return true;
      }
    }

    // Check for common network/temporary errors
    const commonRetryablePatterns = [
      'network error',
      'connection refused',
      'timeout',
      'service unavailable',
      'temporary failure',
      'rate limit',
      'too many requests',
    ];

    for (const pattern of commonRetryablePatterns) {
      if (errorString.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    // Calculate exponential backoff delay
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    
    // Apply maximum delay limit
    delay = Math.min(delay, config.maxDelay);
    
    // Add jitter if enabled
    if (config.jitter) {
      // Add random jitter of ±25%
      const jitterRange = delay * 0.25;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay = Math.max(0, delay + jitter);
    }
    
    return Math.floor(delay);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility methods for common retry patterns

  /**
   * Retry with exponential backoff - good for API calls
   */
  async withExponentialBackoff<T>(
    operation: () => Promise<T>,
    operationName?: string,
    maxAttempts: number = 5
  ): Promise<T> {
    return this.execute(operation, operationName, {
      maxAttempts,
      baseDelay: 1000,
      backoffMultiplier: 2,
      maxDelay: 30000,
      jitter: true,
    });
  }

  /**
   * Retry with fixed delay - good for polling
   */
  async withFixedDelay<T>(
    operation: () => Promise<T>,
    operationName?: string,
    delay: number = 2000,
    maxAttempts: number = 10
  ): Promise<T> {
    return this.execute(operation, operationName, {
      maxAttempts,
      baseDelay: delay,
      backoffMultiplier: 1,
      maxDelay: delay,
      jitter: false,
    });
  }

  /**
   * Retry with linear backoff - good for resource contention
   */
  async withLinearBackoff<T>(
    operation: () => Promise<T>,
    operationName?: string,
    baseDelay: number = 1000,
    maxAttempts: number = 5
  ): Promise<T> {
    return this.execute(operation, operationName, {
      maxAttempts,
      baseDelay,
      backoffMultiplier: 1,
      maxDelay: baseDelay * maxAttempts,
      jitter: true,
    });
  }

  /**
   * Immediate retry - good for transient failures
   */
  async withImmediateRetry<T>(
    operation: () => Promise<T>,
    operationName?: string,
    maxAttempts: number = 3
  ): Promise<T> {
    return this.execute(operation, operationName, {
      maxAttempts,
      baseDelay: 0,
      backoffMultiplier: 1,
      maxDelay: 0,
      jitter: false,
    });
  }

  /**
   * Create a retry decorator for functions
   */
  createRetryDecorator(config?: Partial<RetryConfig>) {
    return <T extends any[], R>(
      target: (...args: T) => Promise<R>,
      operationName?: string
    ) => {
      return async (...args: T): Promise<R> => {
        return this.execute(
          () => target(...args),
          operationName || target.name || 'decorated-function',
          config
        );
      };
    };
  }

  /**
   * Batch retry operations
   */
  async executeBatch<T>(
    operations: Array<{
      operation: () => Promise<T>;
      name: string;
      config?: Partial<RetryConfig>;
    }>,
    options?: {
      concurrency?: number;
      failFast?: boolean;
    }
  ): Promise<Array<RetryResult<T>>> {
    const { concurrency = 5, failFast = false } = options || {};
    const results: Array<RetryResult<T>> = [];
    
    // Process operations in batches
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async ({ operation, name, config }) => {
        try {
          const result = await this.executeWithResult(operation, name, config);
          
          if (failFast && !result.success) {
            throw result.error;
          }
          
          return result;
        } catch (error) {
          if (failFast) {
            throw error;
          }
          
          return {
            success: false,
            error: error as Error,
            attempts: 0,
            totalDuration: 0,
            attemptDetails: [],
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }
}