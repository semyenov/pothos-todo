import { logger } from '@/logger.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { SingletonService } from '../core/SingletonService.js';

export interface CircuitBreakerConfig {
  /**
   * Name of the circuit breaker (for logging/metrics)
   */
  name: string;

  /**
   * Number of failures before opening the circuit
   */
  failureThreshold: number;

  /**
   * Time window in milliseconds to count failures
   */
  timeWindow: number;

  /**
   * Timeout in milliseconds before attempting to close the circuit
   */
  resetTimeout: number;

  /**
   * Minimum number of requests in time window before circuit can open
   */
  minimumNumberOfCalls: number;

  /**
   * Percentage of failures that will cause the circuit to open
   */
  failureRateThreshold: number;

  /**
   * Function to determine if an error should count as a failure
   */
  isFailure?: (error: Error) => boolean;
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Circuit is open, calls are failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing if the service has recovered
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  failureRate: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttemptTime?: Date;
}

export class CircuitBreakerError extends Error {
  constructor(public circuitBreakerName: string, message?: string) {
    super(message || `Circuit breaker '${circuitBreakerName}' is OPEN`);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private totalCalls = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private callWindow: Date[] = [];
  private failureWindow: Date[] = [];
  private metrics: MetricsCollector;

  constructor(private config: CircuitBreakerConfig) {
    this.metrics = MetricsCollector.getInstance();
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const canExecute = this.canExecute();

    if (!canExecute) {
      this.metrics.recordMetric('circuit_breaker.rejected', 1, {
        name: this.config.name,
        state: this.state,
      });

      throw new CircuitBreakerError(
        this.config.name,
        `Circuit breaker '${this.config.name}' is ${this.state}. Next attempt allowed at: ${this.nextAttemptTime?.toISOString()}`
      );
    }

    const startTime = Date.now();
    this.totalCalls++;

    try {
      const result = await fn();
      this.onSuccess();

      this.metrics.recordMetric('circuit_breaker.success', 1, {
        name: this.config.name,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.onFailure(error as Error);

      this.metrics.recordMetric('circuit_breaker.failure', 1, {
        name: this.config.name,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  /**
   * Check if the circuit breaker allows execution
   */
  private canExecute(): boolean {
    const now = new Date();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (this.nextAttemptTime && now >= this.nextAttemptTime) {
          this.state = CircuitBreakerState.HALF_OPEN;
          logger.info('Circuit breaker transitioning to HALF_OPEN', {
            name: this.config.name,
          });
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = new Date();
    this.cleanupTimeWindows();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.reset();
      logger.info('Circuit breaker closed after successful test', {
        name: this.config.name,
      });
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error): void {
    const now = new Date();
    this.failureCount++;
    this.lastFailureTime = now;

    const isFailure = this.config.isFailure ? this.config.isFailure(error) : true;

    if (isFailure) {
      this.failureWindow.push(now);
    }

    this.callWindow.push(now);
    this.cleanupTimeWindows();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.openCircuit();
      logger.warn('Circuit breaker opened after failed test', {
        name: this.config.name,
        error: error.message,
      });
    } else if (this.shouldOpenCircuit()) {
      this.openCircuit();
      logger.error('Circuit breaker opened due to failure threshold', {
        name: this.config.name,
        failureCount: this.failureCount,
        failureRate: this.getFailureRate(),
        totalCalls: this.callWindow.length,
      });
    }
  }

  /**
   * Check if circuit should be opened
   */
  private shouldOpenCircuit(): boolean {
    if (this.callWindow.length < this.config.minimumNumberOfCalls) {
      return false;
    }

    const failureRate = this.getFailureRate();
    return failureRate >= this.config.failureRateThreshold;
  }

  /**
   * Open the circuit breaker
   */
  private openCircuit(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);

    this.metrics.recordMetric('circuit_breaker.opened', 1, {
      name: this.config.name,
      failureRate: this.getFailureRate(),
      nextAttemptTime: this.nextAttemptTime.toISOString(),
    });
  }

  /**
   * Reset the circuit breaker to closed state
   */
  private reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.totalCalls = 0;
    this.callWindow = [];
    this.failureWindow = [];
    this.nextAttemptTime = undefined;

    this.metrics.recordMetric('circuit_breaker.closed', 1, {
      name: this.config.name,
    });
  }

  /**
   * Clean up old entries from time windows
   */
  private cleanupTimeWindows(): void {
    const cutoff = new Date(Date.now() - this.config.timeWindow);

    this.callWindow = this.callWindow.filter(time => time > cutoff);
    this.failureWindow = this.failureWindow.filter(time => time > cutoff);
  }

  /**
   * Calculate current failure rate
   */
  private getFailureRate(): number {
    if (this.callWindow.length === 0) return 0;
    return (this.failureWindow.length / this.callWindow.length) * 100;
  }

  /**
   * Get current circuit breaker statistics
   */
  public getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      totalCalls: this.totalCalls,
      successfulCalls: this.successCount,
      failedCalls: this.failureCount,
      failureRate: this.getFailureRate(),
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Force the circuit breaker to open (for testing/maintenance)
   */
  public forceOpen(): void {
    this.openCircuit();
    logger.warn('Circuit breaker force opened', {
      name: this.config.name,
    });
  }

  /**
   * Force the circuit breaker to close (for testing/maintenance)
   */
  public forceClose(): void {
    this.reset();
    logger.info('Circuit breaker force closed', {
      name: this.config.name,
    });
  }
}

/**
 * Circuit breaker registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry extends SingletonService<CircuitBreakerRegistry> {
  private circuitBreakers = new Map<string, CircuitBreaker>();

  protected constructor() {
    super();
  }

  public static getInstance(): CircuitBreakerRegistry {
    return super.getInstance();
  }

  /**
   * Register a circuit breaker
   */
  public register(config: CircuitBreakerConfig): CircuitBreaker {
    const circuitBreaker = new CircuitBreaker(config);
    this.circuitBreakers.set(config.name, circuitBreaker);

    logger.info('Circuit breaker registered', {
      name: config.name,
      failureThreshold: config.failureThreshold,
      timeWindow: config.timeWindow,
    });

    return circuitBreaker;
  }

  /**
   * Get a circuit breaker by name
   */
  public get(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Get all circuit breaker statistics
   */
  public getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};

    for (const [name, circuitBreaker] of this.circuitBreakers.entries()) {
      stats[name] = circuitBreaker.getStats();
    }

    return stats;
  }

  /**
   * Execute function with named circuit breaker
   */
  public async execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const circuitBreaker = this.circuitBreakers.get(name);

    if (!circuitBreaker) {
      throw new Error(`Circuit breaker '${name}' not found`);
    }

    return circuitBreaker.execute(fn);
  }
}

/**
 * Default circuit breaker configurations for common services
 */
export const defaultCircuitBreakerConfigs = {
  database: {
    name: 'database',
    failureThreshold: 10,
    timeWindow: 60000, // 1 minute
    resetTimeout: 30000, // 30 seconds  
    minimumNumberOfCalls: 5,
    failureRateThreshold: 50, // 50%
    isFailure: (error: Error) => {
      // Database connection errors should trigger circuit breaker
      return error.message.includes('connection') ||
        error.message.includes('timeout') ||
        error.message.includes('ECONNREFUSED');
    },
  },

  ai: {
    name: 'ai-services',
    failureThreshold: 5,
    timeWindow: 120000, // 2 minutes
    resetTimeout: 60000, // 1 minute
    minimumNumberOfCalls: 3,
    failureRateThreshold: 40, // 40%
    isFailure: (error: Error) => {
      // OpenAI rate limits and API errors should trigger circuit breaker
      return error.message.includes('rate limit') ||
        error.message.includes('quota') ||
        error.message.includes('API') ||
        error.message.includes('401') ||
        error.message.includes('429');
    },
  },

  cache: {
    name: 'cache',
    failureThreshold: 15,
    timeWindow: 30000, // 30 seconds
    resetTimeout: 15000, // 15 seconds
    minimumNumberOfCalls: 10,
    failureRateThreshold: 60, // 60%
    isFailure: (error: Error) => {
      // Redis connection errors
      return error.message.includes('ECONNREFUSED') ||
        error.message.includes('Redis') ||
        error.message.includes('connection');
    },
  },
};