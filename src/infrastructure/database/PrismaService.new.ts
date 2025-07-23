import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { DatabaseServiceEventMap } from '../core/ServiceEventMaps.js';
import { ServiceConfig, Retry, CircuitBreaker, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Prisma configuration schema
 */
const PrismaConfigSchema = z.object({
  databaseUrl: z.string().url(),
  connectionLimit: z.number().default(10),
  connectTimeout: z.number().default(30000), // 30 seconds
  poolTimeout: z.number().default(10000), // 10 seconds
  idleTimeout: z.number().default(60000), // 1 minute
  queryTimeout: z.number().default(30000), // 30 seconds
  enableQueryLogging: z.boolean().default(false),
  enableMetrics: z.boolean().default(true),
  slowQueryThreshold: z.number().default(1000), // 1 second
  maxRetries: z.number().default(3),
  pgBouncer: z.boolean().default(true),
  sslMode: z.enum(['disable', 'prefer', 'require']).default('prefer'),
});

export type PrismaConfig = z.infer<typeof PrismaConfigSchema>;

/**
 * Transaction options
 */
export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/**
 * Enhanced PrismaService using the new base service architecture
 * 
 * Features:
 * - Automatic configuration with validation
 * - Type-safe database events
 * - Built-in health checks and metrics
 * - Connection pooling optimization
 * - Automatic retry and circuit breaker
 * - Query performance monitoring
 * 
 * @example
 * ```typescript
 * const prisma = await PrismaService.getInstance();
 * 
 * // Listen to database events
 * prisma.on('database:slow-query', ({ query, duration }) => {
 *   console.log(`Slow query detected: ${duration}ms`);
 * });
 * 
 * // Use with automatic retries
 * const users = await prisma.getClient().user.findMany();
 * ```
 */
@ServiceConfig({
  schema: PrismaConfigSchema,
  prefix: 'database',
  hot: false, // Database connections shouldn't hot reload
})
export class PrismaService extends BaseAsyncService<PrismaConfig, DatabaseServiceEventMap> {
  private client!: PrismaClient;
  private queryCount = 0;
  private errorCount = 0;
  private slowQueryCount = 0;
  private transactionCount = 0;

  /**
   * Get the singleton instance
   */
  static override async getInstance(): Promise<PrismaService> {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'prisma-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Database service with Prisma ORM, connection pooling, and monitoring';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('PrismaService initializing with config:', {
      connectionLimit: this.config.connectionLimit,
      connectTimeout: this.config.connectTimeout,
      queryTimeout: this.config.queryTimeout,
      enableMetrics: this.config.enableMetrics,
    });
  }

  /**
   * Start the database connection
   */
  protected override async onStart(): Promise<void> {
    // Build optimized connection URL
    const databaseUrl = this.buildConnectionUrl(this.config);

    // Create Prisma client as a tracked resource
    this.client = this.createResource({
      resource: new PrismaClient({
        datasources: {
          db: { url: databaseUrl },
        },
        log: this.configureLogging(),
        errorFormat: 'pretty',
      }),
      dispose: async () => {
        await this.client.$disconnect();
      },
    } as any);

    // Set up middleware for metrics and monitoring
    if (this.config.enableMetrics) {
      this.setupMiddleware();
    }

    // Set up event handlers
    this.setupEventHandlers();

    // Connect with retry logic
    await this.connectWithRetry();

    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    // Resources are automatically cleaned up by BaseService
    logger.info('PrismaService stopped');
  }

  /**
   * Get Prisma client
   */
  public getClient(): PrismaClient {
    if (this.state !== 'running') {
      throw new Error('PrismaService is not running');
    }
    return this.client;
  }

  /**
   * Connect to database with retry logic
   */
  @Retry({
    attempts: 3,
    delay: 1000,
    backoff: 'exponential',
    retryIf: (error) => {
      const message = error.message.toLowerCase();
      return message.includes('connection') || message.includes('timeout');
    },
  })
  private async connectWithRetry(): Promise<void> {
    const start = Date.now();
    await this.client.$connect();
    const duration = Date.now() - start;

    this.emit('database:connected', {
      connectionTime: duration,
      config: {
        host: new URL(this.config.databaseUrl).hostname,
        database: new URL(this.config.databaseUrl).pathname.slice(1),
      },
    });

    logger.info('Database connected successfully', { duration });
  }

  /**
   * Health check for database connection
   */
  @HealthCheck({
    name: 'database:connection',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const start = Date.now();
      await this.client.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      if (latency > this.config.slowQueryThreshold) {
        return {
          status: 'unhealthy',
          message: `Database latency too high: ${latency}ms`,
        };
      }

      return {
        status: 'healthy',
        message: `Database connection healthy (latency: ${latency}ms)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database connection failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for connection pool
   */
  @HealthCheck({
    name: 'database:pool',
    critical: false,
    interval: 60000,
  })
  async checkConnectionPool(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const stats = this.getPoolStats();
    const errorRate = this.queryCount > 0 ? (this.errorCount / this.queryCount) : 0;

    if (errorRate > 0.1) { // 10% error rate
      return {
        status: 'degraded',
        message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
      };
    }

    return {
      status: 'healthy',
      message: `Pool healthy - Queries: ${stats.queryCount}, Errors: ${stats.errorCount}`,
    };
  }

  /**
   * Execute a transaction with monitoring
   */
  @Metric({ name: 'database.transaction', recordDuration: true })
  @CircuitBreaker({
    threshold: 5,
    timeout: 30000,
    resetTime: 60000,
  })
  async transaction<T>(
    fn: (prisma: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const start = Date.now();
    this.transactionCount++;

    try {
      const result = await this.client.$transaction(fn, options);
      const duration = Date.now() - start;

      this.emit('database:transaction', {
        id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'success',
        duration,
        isolationLevel: options?.isolationLevel,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - start;

      this.emit('database:transaction', {
        id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'failed',
        duration,
        error: error as Error,
      });

      // Check if error is retryable
      const errorMessage = (error as Error).message.toLowerCase();
      const isRetryable =
        errorMessage.includes('deadlock') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection');

      if (!isRetryable) {
        throw error;
      }

      // Retry transaction for retryable errors
      logger.warn('Retryable transaction error, will be retried by decorator', {
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Get connection pool statistics
   */
  public getPoolStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgQueryTime = this.queryCount > 0
      ? Math.round(uptime / this.queryCount)
      : 0;

    return {
      queryCount: this.queryCount,
      errorCount: this.errorCount,
      slowQueryCount: this.slowQueryCount,
      transactionCount: this.transactionCount,
      uptime,
      avgQueryTime,
      errorRate: this.queryCount > 0
        ? (this.errorCount / this.queryCount * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Build optimized connection URL
   */
  private buildConnectionUrl(config: PrismaConfig): string {
    const url = new URL(config.databaseUrl);

    // Connection pool settings
    url.searchParams.set('connection_limit', config.connectionLimit.toString());
    url.searchParams.set('connect_timeout', config.connectTimeout.toString());
    url.searchParams.set('pool_timeout', config.poolTimeout.toString());
    url.searchParams.set('idle_in_transaction_session_timeout', config.idleTimeout.toString());
    url.searchParams.set('statement_timeout', config.queryTimeout.toString());

    // PostgreSQL specific optimizations
    url.searchParams.set('schema', 'public');
    if (config.pgBouncer) {
      url.searchParams.set('pgbouncer', 'true');
    }
    url.searchParams.set('sslmode', config.sslMode);

    return url.toString();
  }

  /**
   * Configure Prisma logging
   */
  private configureLogging() {
    if (!this.config.enableQueryLogging) {
      return ['error', 'warn'];
    }

    return [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
    ];
  }

  /**
   * Set up Prisma middleware
   */
  private setupMiddleware() {
    this.client.$use(async (params, next) => {
      const start = Date.now();

      try {
        const result = await next(params);
        const duration = Date.now() - start;

        this.queryCount++;

        // Track slow queries
        if (duration > this.config.slowQueryThreshold) {
          this.slowQueryCount++;
          this.emit('database:slow-query', {
            model: params.model || 'unknown',
            action: params.action,
            duration,
            args: params.args,
          });
        }

        // Record metrics
        this.recordMetric('database.query.duration', duration, {
          model: params.model || 'unknown',
          action: params.action,
        });

        return result;
      } catch (error) {
        this.errorCount++;

        this.emit('database:error', {
          error: error as Error,
          model: params.model || 'unknown',
          action: params.action,
        });

        this.recordMetric('database.query.error', 1, {
          model: params.model || 'unknown',
          action: params.action,
          error: (error as Error).name,
        });

        throw error;
      }
    });
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers() {
    // @ts-ignore - Prisma event types
    this.client.$on('query', (e: any) => {
      this.emit('database:query', {
        query: e.query,
        params: e.params,
        duration: e.duration,
        target: e.target,
      });
    });

    // @ts-ignore - Prisma event types
    this.client.$on('error', (e: any) => {
      this.emit('database:error', {
        error: new Error(e.message),
        target: e.target,
      });
    });

    // @ts-ignore - Prisma event types
    this.client.$on('warn', (e: any) => {
      logger.warn('Database warning', { message: e.message });
    });
  }

  /**
   * Start monitoring tasks
   */
  private startMonitoring(): void {
    // Periodic stats reporting
    setInterval(() => {
      const stats = this.getPoolStats();
      this.emit('database:stats', stats);

      // Update metrics
      this.recordMetric('database.queries.total', this.queryCount);
      this.recordMetric('database.queries.slow', this.slowQueryCount);
      this.recordMetric('database.errors.total', this.errorCount);
      this.recordMetric('database.transactions.total', this.transactionCount);
    }, 60000); // Every minute
  }

  /**
   * Execute raw query with monitoring
   */
  @Metric({ name: 'database.raw-query', recordDuration: true })
  async $queryRaw<T = unknown>(
    query: TemplateStringsArray | string,
    ...values: any[]
  ): Promise<T> {
    const queryStr = typeof query === 'string' ? query : query.join('?');
    const start = Date.now();

    try {
      const result = await this.client.$queryRaw<T>(query as any, ...values);
      const duration = Date.now() - start;

      if (duration > this.config.slowQueryThreshold) {
        this.emit('database:slow-query', {
          query: queryStr,
          duration,
          model: 'raw',
          action: 'queryRaw',
        });
      }

      return result;
    } catch (error) {
      this.emit('database:error', {
        error: error as Error,
        query: queryStr,
      });
      throw error;
    }
  }

  /**
   * Execute raw command with monitoring
   */
  @Metric({ name: 'database.raw-execute', recordDuration: true })
  async $executeRaw(
    query: TemplateStringsArray | string,
    ...values: any[]
  ): Promise<number> {
    const queryStr = typeof query === 'string' ? query : query.join('?');
    const start = Date.now();

    try {
      const result = await this.client.$executeRaw(query as any, ...values);
      const duration = Date.now() - start;

      if (duration > this.config.slowQueryThreshold) {
        this.emit('database:slow-query', {
          query: queryStr,
          duration,
          model: 'raw',
          action: 'executeRaw',
        });
      }

      return result;
    } catch (error) {
      this.emit('database:error', {
        error: error as Error,
        query: queryStr,
      });
      throw error;
    }
  }
}