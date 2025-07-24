import { PrismaClient } from "@prisma/client";
import { logger } from "@/logger.js";
import { env } from "@/config/env.validation.js";
import { SingletonService } from "../core/SingletonService.js";

export interface PrismaServiceOptions {
  /**
   * Maximum number of connections in the pool
   */
  connectionLimit?: number;

  /**
   * Connection timeout in milliseconds
   */
  connectTimeout?: number;

  /**
   * Pool timeout in milliseconds
   */
  poolTimeout?: number;

  /**
   * Idle timeout in milliseconds
   */
  idleTimeout?: number;

  /**
   * Query timeout in milliseconds
   */
  queryTimeout?: number;

  /**
   * Enable query logging
   */
  enableQueryLogging?: boolean;

  /**
   * Enable metrics collection
   */
  enableMetrics?: boolean;
}

export class PrismaService extends SingletonService {
  private config: PrismaServiceOptions = defaultPoolConfig;
  private prisma: PrismaClient | null = null;
  private connectionCount = 0;
  private queryCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  protected constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  public static override getInstance<T extends PrismaService>(
    config: PrismaServiceOptions = defaultPoolConfig
  ): T {
    const instance = super.getInstance(config) as T;
    instance.configure(config);
    return instance;
  }

  /**
   * Configure the PrismaService with options
   */
  public configure(options: PrismaServiceOptions = {}): void {
    this.config = { ...defaultPoolConfig, ...options };

    if (!this.prisma) {
      const log = this.configureLogging(this.config) as any;

      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: env.DATABASE_URL,
          },
        },
        log,
        errorFormat: "pretty",
      });

      // Set up middleware for metrics and logging
      this.setupMiddleware(this.config);

      // Handle connection events
      this.setupEventHandlers();
    }
  }

  /**
   * Get Prisma client
   */
  public getClient(): PrismaClient {
    if (!this.prisma) {
      this.configure();
    }
    return this.prisma!;
  }

  /**
   * Connect to database with retry logic
   */
  public async connect(): Promise<void> {
    if (!this.prisma) {
      this.configure();
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.prisma!.$connect();
        this.connectionCount++;
        logger.info("Database connected successfully", {
          attempt,
          connectionCount: this.connectionCount,
        });
        return;
      } catch (error) {
        lastError = error as Error;
        logger.error(`Database connection attempt ${attempt} failed`, {
          error,
          attempt,
          maxRetries,
        });

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed to connect to database after ${maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.connectionCount--;
      logger.info("Database disconnected", {
        connectionCount: this.connectionCount,
      });
    }
  }

  /**
   * Get connection pool statistics
   */
  public getPoolStats() {
    const uptime = Date.now() - this.startTime;
    const avgQueryTime =
      this.queryCount > 0 ? Math.round(uptime / this.queryCount) : 0;

    return {
      connectionCount: this.connectionCount,
      queryCount: this.queryCount,
      errorCount: this.errorCount,
      uptime,
      avgQueryTime,
      errorRate:
        this.queryCount > 0
          ? ((this.errorCount / this.queryCount) * 100).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * Build optimized connection URL with pooling parameters
   */
  private buildConnectionUrl(
    dbConfig: any,
    options: PrismaServiceOptions
  ): string {
    const url = new URL(dbConfig.url);

    // Connection pool settings
    if (options.connectionLimit) {
      url.searchParams.set(
        "connection_limit",
        options.connectionLimit.toString()
      );
    }

    // Timeouts
    if (options.connectTimeout) {
      url.searchParams.set(
        "connect_timeout",
        options.connectTimeout.toString()
      );
    }

    if (options.poolTimeout) {
      url.searchParams.set("pool_timeout", options.poolTimeout.toString());
    }

    if (options.idleTimeout) {
      url.searchParams.set(
        "idle_in_transaction_session_timeout",
        options.idleTimeout.toString()
      );
    }

    if (options.queryTimeout) {
      url.searchParams.set(
        "statement_timeout",
        options.queryTimeout.toString()
      );
    }

    // PostgreSQL specific optimizations
    url.searchParams.set("schema", "public");
    url.searchParams.set("pgbouncer", "true"); // Enable PgBouncer mode
    url.searchParams.set("sslmode", "prefer");

    return url.toString();
  }

  /**
   * Configure Prisma logging
   */
  private configureLogging(options: PrismaServiceOptions) {
    if (!options.enableQueryLogging) {
      return ["error", "warn"];
    }

    return [
      {
        emit: "event",
        level: "query",
      },
      {
        emit: "event",
        level: "error",
      },
      {
        emit: "event",
        level: "info",
      },
      {
        emit: "event",
        level: "warn",
      },
    ];
  }

  /**
   * Set up Prisma middleware for metrics and logging
   */
  private setupMiddleware(options: PrismaServiceOptions) {
    if (options.enableMetrics && this.prisma) {
      this.prisma.$use(async (params, next) => {
        const start = Date.now();

        try {
          const result = await next(params);
          const duration = Date.now() - start;

          this.queryCount++;

          // Log slow queries
          if (duration > 1000) {
            logger.warn("Slow query detected", {
              model: params.model,
              action: params.action,
              duration,
            });
          }

          return result;
        } catch (error) {
          this.errorCount++;
          throw error;
        }
      });
    }
  }

  /**
   * Set up event handlers for logging
   */
  private setupEventHandlers() {
    if (!this.prisma) return;

    // @ts-ignore - Prisma event types
    this.prisma.$on("query", (e: any) => {
      if (e.duration > 100) {
        logger.debug("Database query", {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      }
    });

    // @ts-ignore - Prisma event types
    this.prisma.$on("error", (e: any) => {
      logger.error("Database error", {
        message: e.message,
        target: e.target,
      });
    });

    // @ts-ignore - Prisma event types
    this.prisma.$on("warn", (e: any) => {
      logger.warn("Database warning", {
        message: e.message,
      });
    });
  }

  /**
   * Execute a transaction with retry logic
   */
  public async transaction<T>(
    fn: (
      prisma: Omit<
        PrismaClient,
        | "$connect"
        | "$disconnect"
        | "$on"
        | "$transaction"
        | "$use"
        | "$extends"
      >
    ) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?:
        | "ReadUncommitted"
        | "ReadCommitted"
        | "RepeatableRead"
        | "Serializable";
    }
  ): Promise<T> {
    if (!this.prisma) {
      this.configure();
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const prisma = this.prisma! as PrismaClient;
      try {
        return await prisma.$transaction<T>(fn, options);
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        const errorMessage = lastError.message.toLowerCase();
        const isRetryable =
          errorMessage.includes("deadlock") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("connection");

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        logger.warn(`Transaction attempt ${attempt} failed, retrying...`, {
          error: lastError.message,
          attempt,
        });

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Health check for database connection
   */
  public async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    latency: number;
    details?: any;
  }> {
    if (!this.prisma) {
      this.configure();
    }

    const start = Date.now();

    try {
      await this.prisma!.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return {
        status: "healthy",
        latency,
        details: this.getPoolStats(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        latency: Date.now() - start,
        details: {
          error: (error as Error).message,
          ...this.getPoolStats(),
        },
      };
    }
  }
}

/**
 * Default connection pool configuration
 */
export const defaultPoolConfig: PrismaServiceOptions = {
  connectionLimit: 10, // Maximum connections in pool
  connectTimeout: 30000, // 30 seconds
  poolTimeout: 10000, // 10 seconds
  idleTimeout: 60000, // 1 minute
  queryTimeout: 30000, // 30 seconds
  enableQueryLogging: false, // Disable in production
  enableMetrics: true,
};
