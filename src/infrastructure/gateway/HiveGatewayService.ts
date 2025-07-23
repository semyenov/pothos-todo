import { createGateway, type Gateway } from '@graphql-hive/gateway';
import { useResponseCache } from '@graphql-yoga/plugin-response-cache';
import { useGraphQLSSE } from '@graphql-yoga/plugin-graphql-sse';
import { useCSRFPrevention } from '@graphql-yoga/plugin-csrf-prevention';
import { useRateLimiter } from '@envelop/rate-limiter';
import { useOpenTelemetry } from '@envelop/opentelemetry';
import { logger } from '../../lib/unjs-utils.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { RedisClusterManager } from '../cache/RedisClusterManager.js';
import { getServerConfig, getCacheConfig } from '../../config/index.js';
import type { GraphQLSchema } from 'graphql';
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';

export interface IHiveGatewayService {
  gateway: Gateway | null;
  initialized: boolean;
  metricsCollector: MetricsCollector | null;
  redisManager: RedisClusterManager | null;
  getGateway: () => Gateway;
  getSchema: () => Promise<GraphQLSchema>;
  start: (port: number) => Promise<void>;
  stop: () => Promise<void>;
  isHealthy: () => Promise<boolean>;
  getMetrics: () => {
    initialized: boolean;
    healthy: Promise<boolean>;
  };
  clearAllInstances: () => void;
}

/**
 * HiveGatewayService - Manages the GraphQL Hive Gateway instance
 * 
 * This service provides:
 * - Federation gateway functionality
 * - Schema composition from subgraphs
 * - CDN-based schema distribution
 * - Integration with existing infrastructure
 */
export class HiveGatewayService extends AsyncSingletonService<IHiveGatewayService> {
  private gateway: Gateway | null = null;
  private initialized = false;
  private metricsCollector: MetricsCollector;
  private redisManager: RedisClusterManager;

  protected constructor() {
    super();
    this.metricsCollector = MetricsCollector.getInstance();
    this.redisManager = RedisClusterManager.getInstance();
  }

  public static async getInstance(): Promise<IHiveGatewayService> {
    return super.getInstanceAsync(async (instance) => {
      const gatewayService = new HiveGatewayService();
      await gatewayService.initialize();
      return gatewayService;
    });
  }

  /**
   * Initialize the Hive Gateway with configuration
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('HiveGatewayService already initialized');
      return;
    }

    try {
      const serverConfig = getServerConfig();
      const cacheConfig = getCacheConfig();

      logger.info('Initializing Hive Gateway...');

      // Create the gateway instance
      this.gateway = createGateway({
        // Gateway identification
        name: 'pothos-todo-gateway',

        // Supergraph configuration from CDN
        supergraph: () => ({
          type: 'hive',
          endpoint: process.env.HIVE_CDN_ENDPOINT!,
          key: process.env.HIVE_CDN_KEY!,
          pollIntervalInMs: 10_000,
        }),

        // Hive reporting
        reporting: {
          type: 'hive',
          token: process.env.HIVE_TOKEN!,
          enabled: true,
          usage: {
            enabled: true,
          },
        },

        // Plugins configuration
        plugins: () => [
          // Response caching with Redis
          useResponseCache({
            ttl: cacheConfig.defaultTTL,
            ttlPerType: {
              User: 300_000,
              Todo: 60_000,
              TodoList: 120_000,
            },
            invalidateViaMutation: true,
            includeExtensionMetadata: true,
            cache: this.createRedisCache(),
          }),

          // CSRF prevention
          useCSRFPrevention({
            requestHeaders: ['x-graphql-client', 'x-csrf-token'],
          }),

          // Rate limiting
          useRateLimiter({
            identifyFn: (context) => {
              // Identify by user ID if authenticated, otherwise by IP
              return context.request.user?.id || context.request.ip;
            },
            rateLimitDirectiveName: 'rateLimit',
            globalConfig: {
              max: 100,
              window: '1m',
            },
          }),

          // OpenTelemetry tracing
          useOpenTelemetry({
            resolvers: true,
            variables: true,
            result: false,
          }),

          // GraphQL SSE for subscriptions
          useGraphQLSSE(),
        ],

        // Health check configuration
        healthCheckEndpoint: '/health',
        readinessCheckEndpoint: '/ready',

        // Logging
        logging: {
          level: serverConfig.env === 'production' ? 'info' : 'debug',
        },

        // Metrics endpoint
        metrics: {
          enabled: true,
          endpoint: '/metrics',
        },

        // CORS configuration
        cors: {
          origin: serverConfig.cors.origin,
          credentials: serverConfig.cors.credentials,
          methods: ['GET', 'POST', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
        },

        // GraphQL endpoint
        graphqlEndpoint: '/graphql',

        // Enable GraphiQL in development
        graphiql: serverConfig.env === 'development',

        // Request parsing
        parserAndValidationCache: true,

        // WebSocket configuration for subscriptions
        websocket: {
          path: '/graphql',
          keepAlive: 10_000,
          onConnect: async (ctx: any) => {
            const auth = ctx.connectionParams?.authorization;
            if (!auth) {
              throw new Error('Missing authentication');
            }
            return true;
          },
        },

        // Subgraph health checks
        serviceHealthCheck: {
          enabled: true,
          interval: 30_000,
          timeout: 5_000,
        },

        // Query planning cache
        queryPlannerCache: {
          enabled: true,
          ttl: 300_000,
        },
      });

      this.initialized = true;
      logger.info('Hive Gateway initialized successfully');

      // Record initialization metric
      this.metricsCollector.recordGauge('gateway.initialized', 1, {
        type: 'hive',
      });
    } catch (error) {
      logger.error('Failed to initialize Hive Gateway', error);
      throw error;
    }
  }

  /**
   * Create Redis cache adapter for response caching
   */
  private createRedisCache() {
    return {
      get: async (key: string) => {
        try {
          const value = await this.redisManager.get(key);
          return value ? JSON.parse(value) : undefined;
        } catch (error) {
          logger.error('Redis cache get error', error);
          return undefined;
        }
      },
      set: async (key: string, value: any, ttl?: number) => {
        try {
          await this.redisManager.set(
            key,
            JSON.stringify(value),
            ttl || 3600
          );
        } catch (error) {
          logger.error('Redis cache set error', error);
        }
      },
      delete: async (key: string) => {
        try {
          await this.redisManager.delete(key);
        } catch (error) {
          logger.error('Redis cache delete error', error);
        }
      },
    };
  }

  /**
   * Get the gateway instance
   */
  public getGateway(): Gateway {
    if (!this.gateway) {
      throw new Error('Hive Gateway not initialized');
    }
    return this.gateway;
  }

  /**
   * Get the composed schema
   */
  public async getSchema(): Promise<GraphQLSchema> {
    const gateway = this.getGateway();
    return gateway.getSchema();
  }

  /**
   * Start the gateway server
   */
  public async start(port: number = 4000): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const gateway = this.getGateway();

    // Start the server
    await gateway.listen(port);

    logger.info(`Hive Gateway listening on http://localhost:${port}/graphql`);

    // Record startup metric
    this.metricsCollector.recordGauge('gateway.running', 1, {
      port: port.toString(),
    });
  }

  /**
   * Stop the gateway server
   */
  public async stop(): Promise<void> {
    if (this.gateway) {
      // Gateway stop logic would go here
      logger.info('Stopping Hive Gateway...');

      // Record shutdown metric
      this.metricsCollector.recordGauge('gateway.running', 0);

      this.gateway = null;
      this.initialized = false;
    }
  }

  /**
   * Check if the gateway is healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      if (!this.initialized || !this.gateway) {
        return false;
      }

      // Check if we can get the schema
      const schema = await this.getSchema();
      return !!schema;
    } catch (error) {
      logger.error('Gateway health check failed', error);
      return false;
    }
  }

  /**
   * Get gateway metrics
   */
  public getMetrics() {
    return {
      initialized: this.initialized,
      healthy: this.isHealthy(),
      // Additional metrics can be added here
    };
  }
}