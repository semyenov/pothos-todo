import { logger } from '@/logger.js';
import { CircuitBreaker, CircuitBreakerRegistry } from './CircuitBreaker.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { SingletonService } from '../core/SingletonService.js';

export interface DegradationConfig {
  /**
   * Service name for monitoring and logging
   */
  serviceName: string;
  
  /**
   * Maximum number of retries before degrading
   */
  maxRetries: number;
  
  /**
   * Delay between retries in milliseconds
   */
  retryDelay: number;
  
  /**
   * Timeout for each attempt in milliseconds
   */
  timeout: number;
  
  /**
   * Circuit breaker configuration
   */
  circuitBreaker?: {
    failureThreshold: number;
    resetTimeout: number;
    timeWindow: number;
  };
  
  /**
   * Fallback strategy
   */
  fallbackStrategy: 'cache' | 'static' | 'simplified' | 'disabled';
  
  /**
   * Whether to enable degradation monitoring
   */
  enableMonitoring: boolean;
}

export interface ServiceHealth {
  serviceName: string;
  isHealthy: boolean;
  lastHealthCheck: Date;
  errorRate: number;
  avgResponseTime: number;
  degradationLevel: DegradationLevel;
}

export enum DegradationLevel {
  NORMAL = 'NORMAL',
  PARTIAL = 'PARTIAL',
  SEVERE = 'SEVERE',
  DISABLED = 'DISABLED'
}

export class GracefulDegradation extends SingletonService {
  private services = new Map<string, DegradationConfig>();
  private healthStates = new Map<string, ServiceHealth>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private metrics: MetricsCollector | null = null;
  private healthCheckInterval?: NodeJS.Timeout;

  protected constructor() {
    super();
  }

  public initialize(): void {
    this.metrics = MetricsCollector.getInstance();
    this.startHealthChecks();
  }

  private ensureMetrics(): MetricsCollector {
    if (!this.metrics) {
      throw new Error('GracefulDegradation not initialized');
    }
    return this.metrics;
  }

  public static getInstance(): GracefulDegradation {
    const instance = super.getInstance() as GracefulDegradation;
    if (!instance.metrics) {
      instance.initialize();
    }
    return instance;
  }

  /**
   * Register a service for graceful degradation
   */
  public registerService(config: DegradationConfig): void {
    this.services.set(config.serviceName, config);
    
    // Initialize health state
    this.healthStates.set(config.serviceName, {
      serviceName: config.serviceName,
      isHealthy: true,
      lastHealthCheck: new Date(),
      errorRate: 0,
      avgResponseTime: 0,
      degradationLevel: DegradationLevel.NORMAL,
    });

    // Set up circuit breaker if configured
    if (config.circuitBreaker) {
      const circuitBreakerRegistry = CircuitBreakerRegistry.getInstance();
      const circuitBreaker = circuitBreakerRegistry.register({
        name: config.serviceName,
        failureThreshold: config.circuitBreaker.failureThreshold,
        resetTimeout: config.circuitBreaker.resetTimeout,
        timeWindow: config.circuitBreaker.timeWindow,
        minimumNumberOfCalls: 5,
        failureRateThreshold: 50,
      });
      
      this.circuitBreakers.set(config.serviceName, circuitBreaker);
    }

    logger.info('Service registered for graceful degradation', {
      serviceName: config.serviceName,
      fallbackStrategy: config.fallbackStrategy,
    });
  }

  /**
   * Execute operation with graceful degradation
   */
  public async executeWithDegradation<T>(
    serviceName: string,
    primaryOperation: () => Promise<T>,
    fallbackOperation?: () => Promise<T>
  ): Promise<T> {
    const config = this.services.get(serviceName);
    if (!config) {
      throw new Error(`Service '${serviceName}' not registered for degradation`);
    }

    const health = this.healthStates.get(serviceName)!;
    const startTime = Date.now();

    // Check if service is completely disabled
    if (health.degradationLevel === DegradationLevel.DISABLED) {
      return this.executeFallback(serviceName, fallbackOperation, config);
    }

    // Try primary operation with retries
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          primaryOperation,
          config.timeout,
          serviceName
        );

        // Record successful operation
        this.recordSuccess(serviceName, Date.now() - startTime);
        return result;

      } catch (error) {
        this.recordFailure(serviceName, error as Error, Date.now() - startTime);

        // If this is the last attempt, try fallback
        if (attempt === config.maxRetries) {
          logger.warn(`Primary operation failed after ${config.maxRetries} attempts, using fallback`, {
            serviceName,
            error: (error as Error).message,
          });

          return this.executeFallback(serviceName, fallbackOperation, config);
        }

        // Wait before retry (with exponential backoff)
        const delay = config.retryDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);

        logger.debug(`Retrying operation for service ${serviceName}`, {
          attempt: attempt + 1,
          delay,
        });
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error(`Unexpected error in graceful degradation for ${serviceName}`);
  }

  /**
   * Execute AI operation with specific degradation strategies
   */
  public async executeAIOperation<T>(
    operationType: 'embedding' | 'nlp' | 'search' | 'suggestion',
    primaryOperation: () => Promise<T>,
    context?: {
      query?: string;
      userId?: string;
      fallbackData?: any;
    }
  ): Promise<T> {
    const serviceName = `ai-${operationType}`;
    
    return this.executeWithDegradation(
      serviceName,
      primaryOperation,
      () => this.getAIFallback(operationType, context)
    );
  }

  /**
   * Get AI-specific fallback based on operation type
   */
  private async getAIFallback<T>(
    operationType: string,
    context?: any
  ): Promise<T> {
    switch (operationType) {
      case 'embedding':
        // Return empty embedding or cached embedding
        return this.getCachedEmbedding(context?.query) as T;

      case 'nlp':
        // Return simple keyword-based parsing
        return this.parseNLPFallback(context?.query) as T;

      case 'search':
        // Return basic text search results
        return this.getBasicSearchResults(context?.query, context?.userId) as T;

      case 'suggestion':
        // Return static suggestions
        return this.getStaticSuggestions(context?.userId) as T;

      default:
        throw new Error(`No fallback available for AI operation: ${operationType}`);
    }
  }

  /**
   * Execute fallback operation
   */
  private async executeFallback<T>(
    serviceName: string,
    fallbackOperation: (() => Promise<T>) | undefined,
    config: DegradationConfig
  ): Promise<T> {
    if (fallbackOperation) {
      try {
        const result = await fallbackOperation();
        
        this.ensureMetrics().recordMetric('degradation.fallback.success', 1, {
          serviceName,
          strategy: 'custom',
        });

        return result;
      } catch (error) {
        logger.error(`Fallback operation failed for service ${serviceName}`, {
          error: (error as Error).message,
        });
      }
    }

    // Use configured fallback strategy
    return this.executeConfiguredFallback(serviceName, config);
  }

  /**
   * Execute configured fallback strategy
   */
  private async executeConfiguredFallback<T>(
    serviceName: string,
    config: DegradationConfig
  ): Promise<T> {
    switch (config.fallbackStrategy) {
      case 'cache':
        return this.getCachedResult(serviceName) as T;

      case 'static':
        return this.getStaticResult(serviceName) as T;

      case 'simplified':
        return this.getSimplifiedResult(serviceName) as T;

      case 'disabled':
        throw new Error(`Service '${serviceName}' is currently disabled`);

      default:
        throw new Error(`Unknown fallback strategy: ${config.fallbackStrategy}`);
    }
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number,
    serviceName: string
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timeout after ${timeout}ms for service ${serviceName}`));
        }, timeout);
      }),
    ]);
  }

  /**
   * Record successful operation
   */
  private recordSuccess(serviceName: string, duration: number): void {
    const health = this.healthStates.get(serviceName)!;
    
    // Update health metrics
    this.updateHealthMetrics(serviceName, true, duration);
    
    // Potentially improve degradation level
    if (health.errorRate < 10 && health.degradationLevel !== DegradationLevel.NORMAL) {
      this.updateDegradationLevel(serviceName, DegradationLevel.NORMAL);
    }

    this.ensureMetrics().recordMetric('degradation.operation.success', 1, {
      serviceName,
      duration,
    });
  }

  /**
   * Record failed operation
   */
  private recordFailure(serviceName: string, error: Error, duration: number): void {
    this.updateHealthMetrics(serviceName, false, duration);
    
    const health = this.healthStates.get(serviceName)!;
    
    // Update degradation level based on error rate
    if (health.errorRate > 50) {
      this.updateDegradationLevel(serviceName, DegradationLevel.DISABLED);
    } else if (health.errorRate > 25) {
      this.updateDegradationLevel(serviceName, DegradationLevel.SEVERE);
    } else if (health.errorRate > 10) {
      this.updateDegradationLevel(serviceName, DegradationLevel.PARTIAL);
    }

    this.ensureMetrics().recordMetric('degradation.operation.failure', 1, {
      serviceName,
      error: error.message,
      duration,
    });
  }

  /**
   * Update health metrics for a service
   */
  private updateHealthMetrics(serviceName: string, success: boolean, duration: number): void {
    const health = this.healthStates.get(serviceName)!;
    
    // Simple moving average for response time and error rate
    const alpha = 0.1; // Smoothing factor
    
    health.avgResponseTime = health.avgResponseTime * (1 - alpha) + duration * alpha;
    health.errorRate = health.errorRate * (1 - alpha) + (success ? 0 : 100) * alpha;
    health.lastHealthCheck = new Date();
    health.isHealthy = health.errorRate < 25;
  }

  /**
   * Update degradation level for a service
   */
  private updateDegradationLevel(serviceName: string, level: DegradationLevel): void {
    const health = this.healthStates.get(serviceName)!;
    const previousLevel = health.degradationLevel;
    
    health.degradationLevel = level;

    if (level !== previousLevel) {
      logger.warn(`Service degradation level changed`, {
        serviceName,
        previousLevel,
        newLevel: level,
        errorRate: health.errorRate,
        avgResponseTime: health.avgResponseTime,
      });

      this.ensureMetrics().recordMetric('degradation.level.changed', 1, {
        serviceName,
        previousLevel,
        newLevel: level,
      });
    }
  }

  /**
   * Get cached result for fallback
   */
  private async getCachedResult<T>(serviceName: string): Promise<T> {
    // This would typically check Redis or other cache
    // For now, return a placeholder
    logger.info(`Using cached result for ${serviceName}`);
    return {} as T;
  }

  /**
   * Get static result for fallback
   */
  private getStaticResult<T>(serviceName: string): T {
    logger.info(`Using static result for ${serviceName}`);
    return {} as T;
  }

  /**
   * Get simplified result for fallback
   */
  private getSimplifiedResult<T>(serviceName: string): T {
    logger.info(`Using simplified result for ${serviceName}`);
    return {} as T;
  }

  /**
   * Get cached embedding for fallback
   */
  private async getCachedEmbedding(query?: string): Promise<any> {
    // Return zero vector or cached embedding
    return {
      embedding: new Array(1536).fill(0),
      model: 'fallback',
      usage: { total_tokens: 0 },
    };
  }

  /**
   * Parse NLP command using simple keyword matching
   */
  private parseNLPFallback(command?: string): any {
    if (!command) return { action: 'unknown', success: false };

    const keywords = {
      create: ['create', 'add', 'new', 'make'],
      update: ['update', 'change', 'modify', 'edit'],
      delete: ['delete', 'remove', 'destroy'],
      list: ['list', 'show', 'display', 'get'],
    };

    for (const [action, words] of Object.entries(keywords)) {
      if (words.some(word => command.toLowerCase().includes(word))) {
        return {
          action,
          success: true,
          message: `Simple parsing detected ${action} command`,
          confidence: 0.6,
        };
      }
    }

    return {
      action: 'unknown',
      success: false,
      message: 'Could not parse command using simple fallback',
    };
  }

  /**
   * Get basic search results using text matching
   */
  private async getBasicSearchResults(query?: string, userId?: string): Promise<any> {
    // This would perform basic database text search
    return {
      results: [],
      total: 0,
      message: 'Using basic text search fallback',
      source: 'fallback',
    };
  }

  /**
   * Get static suggestions
   */
  private getStaticSuggestions(userId?: string): any {
    const staticSuggestions = [
      'Review your daily tasks',
      'Update task priorities',
      'Clean up completed items',
      'Plan for tomorrow',
      'Take a break',
    ];

    return staticSuggestions;
  }

  /**
   * Get service health status
   */
  public getServiceHealth(serviceName: string): ServiceHealth | undefined {
    return this.healthStates.get(serviceName);
  }

  /**
   * Get all services health status
   */
  public getAllServicesHealth(): ServiceHealth[] {
    return Array.from(this.healthStates.values());
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds
  }

  /**
   * Perform health checks on all services
   */
  private async performHealthChecks(): Promise<void> {
    for (const [serviceName, health] of this.healthStates.entries()) {
      // Check if service hasn't been used recently
      const timeSinceLastCheck = Date.now() - health.lastHealthCheck.getTime();
      
      if (timeSinceLastCheck > 300000) { // 5 minutes
        // Gradually improve degradation level for unused services
        if (health.degradationLevel === DegradationLevel.DISABLED) {
          this.updateDegradationLevel(serviceName, DegradationLevel.SEVERE);
        } else if (health.degradationLevel === DegradationLevel.SEVERE) {
          this.updateDegradationLevel(serviceName, DegradationLevel.PARTIAL);
        } else if (health.degradationLevel === DegradationLevel.PARTIAL) {
          this.updateDegradationLevel(serviceName, DegradationLevel.NORMAL);
        }
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown graceful degradation
   */
  public shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    logger.info('Graceful degradation shutdown completed');
  }
}

/**
 * Default degradation configurations for AI services
 */
export const defaultAIDegradationConfigs: DegradationConfig[] = [
  {
    serviceName: 'ai-embedding',
    maxRetries: 2,
    retryDelay: 1000,
    timeout: 10000,
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 60000,
      timeWindow: 120000,
    },
    fallbackStrategy: 'cache',
    enableMonitoring: true,
  },
  {
    serviceName: 'ai-nlp',
    maxRetries: 3,
    retryDelay: 500,
    timeout: 15000,
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeout: 30000,
      timeWindow: 60000,
    },
    fallbackStrategy: 'simplified',
    enableMonitoring: true,
  },
  {
    serviceName: 'ai-search',
    maxRetries: 2,
    retryDelay: 1000,
    timeout: 8000,
    fallbackStrategy: 'static',
    enableMonitoring: true,
  },
  {
    serviceName: 'ai-suggestion',
    maxRetries: 1,
    retryDelay: 500,
    timeout: 5000,
    fallbackStrategy: 'static',
    enableMonitoring: true,
  },
];