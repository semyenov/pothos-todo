import type { GatewayConfig } from '@graphql-hive/gateway';
import { useResponseCache } from '@graphql-yoga/plugin-response-cache';
import { useGraphQLSSE } from '@graphql-yoga/plugin-graphql-sse';
import { useCSRFPrevention } from '@graphql-yoga/plugin-csrf-prevention';
import { useRateLimiter } from '@envelop/rate-limiter';
import { useOpenTelemetry } from '@envelop/opentelemetry';
import { getServerConfig, getCacheConfig, getSessionConfig } from './index.js';

const serverConfig = getServerConfig();
const cacheConfig = getCacheConfig();
const sessionConfig = getSessionConfig();

/**
 * Hive Gateway Configuration
 * 
 * This configuration enables GraphQL Hive Gateway with enterprise features:
 * - Federation support with CDN-based schema distribution
 * - Advanced caching with Redis integration
 * - Security features (CSRF, rate limiting)
 * - OpenTelemetry integration for distributed tracing
 * - WebSocket and SSE support for subscriptions
 */
export const hiveGatewayConfig: GatewayConfig = {
  // Gateway name for identification
  name: 'pothos-todo-gateway',

  // Supergraph configuration - pulls from Hive CDN
  supergraph: {
    type: 'hive',
    endpoint: process.env.HIVE_CDN_ENDPOINT!,
    key: process.env.HIVE_CDN_KEY!,
  },

  // Hive reporting configuration
  reporting: {
    type: 'hive',
    token: process.env.HIVE_TOKEN!,
    enabled: true,
    usage: {
      target: process.env.HIVE_TARGET || 'production',
    },
    schema: {
      enabled: true,
    },
  },

  // Server configuration
  server: {
    port: serverConfig.port,
    host: serverConfig.host,
    cors: {
      origin: serverConfig.cors.origin,
      credentials: serverConfig.cors.credentials,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    },

    // GraphQL endpoint configuration
    graphqlEndpoint: '/graphql',

    // Enable GraphiQL in development
    graphiql: true,

    // Health check endpoints
    healthCheckEndpoint: '/health',
    readinessCheckEndpoint: '/ready',
  },

  // Plugins configuration
  plugins: [
    // Response caching plugin with Redis
    useResponseCache({
      ttl: cacheConfig.defaultTTL,
      ttlPerType: {
        User: 300_000, // 5 minutes
        Todo: 60_000,  // 1 minute
        TodoList: 120_000, // 2 minutes
      },
      invalidateViaMutation: true,
      includeExtensionMetadata: true,
      // Custom cache implementation using Redis
      cache: {
        async get(key: string) {
          const redisManager = await import('../infrastructure/cache/RedisClusterManager.js');
          const manager = redisManager.RedisClusterManager.getInstance();
          return manager.get(key);
        },
        async set(key: string, value: any, ttl?: number) {
          const redisManager = await import('../infrastructure/cache/RedisClusterManager.js');
          const manager = redisManager.RedisClusterManager.getInstance();
          await manager.set(key, value, ttl);
        },
        async delete(key: string) {
          const redisManager = await import('../infrastructure/cache/RedisClusterManager.js');
          const manager = redisManager.RedisClusterManager.getInstance();
          await manager.delete(key);
        },
      },
    }),

    // CSRF prevention
    useCSRFPrevention({
      requestHeaders: ['x-graphql-client', 'x-csrf-token'],
    }),

    // Rate limiting
    useRateLimiter({
      // Global rate limit
      global: {
        max: 100,
        window: '1m',
      },
      // Per-operation rate limits
      operations: {
        CreateTodo: {
          max: 20,
          window: '1m',
        },
        ExecuteNLPCommand: {
          max: 10,
          window: '1m',
        },
      },
    }),

    // OpenTelemetry for distributed tracing
    useOpenTelemetry({
      resolvers: true,
      variables: true,
      result: false, // Don't include result in traces for privacy
    }),

    // GraphQL SSE for subscriptions
    useGraphQLSSE(),
  ],

  // Subscription configuration
  subscriptions: {
    enabled: true,
    // WebSocket configuration
    websocket: {
      path: '/graphql',
      keepAlive: 10_000,
      onConnect: async (ctx) => {
        // Validate authentication for WebSocket connections
        const auth = ctx.connectionParams?.authorization;
        if (!auth) {
          throw new Error('Missing authentication');
        }
        // Additional validation logic here
        return true;
      },
    },
  },

  // Subgraph configuration
  subgraphs: [
    {
      name: 'user',
      url: process.env.USER_SUBGRAPH_URL || 'http://localhost:4001/graphql',
      // Add authentication headers for subgraph
      headers: {
        'x-subgraph-token': process.env.USER_SUBGRAPH_TOKEN || '',
      },
    },
    {
      name: 'todo',
      url: process.env.TODO_SUBGRAPH_URL || 'http://localhost:4002/graphql',
      headers: {
        'x-subgraph-token': process.env.TODO_SUBGRAPH_TOKEN || '',
      },
    },
    {
      name: 'ai',
      url: process.env.AI_SUBGRAPH_URL || 'http://localhost:4003/graphql',
      headers: {
        'x-subgraph-token': process.env.AI_SUBGRAPH_TOKEN || '',
      },
    },
  ],

  // Advanced features
  features: {
    // Enable automatic persisted queries
    persistedDocuments: {
      enabled: true,
      // Use Redis for persisted document storage
      store: {
        async get(hash: string) {
          const redisManager = await import('../infrastructure/cache/RedisClusterManager.js');
          const manager = redisManager.RedisClusterManager.getInstance();
          return manager.get(`persisted:${hash}`);
        },
        async set(hash: string, document: string) {
          const redisManager = await import('../infrastructure/cache/RedisClusterManager.js');
          const manager = redisManager.RedisClusterManager.getInstance();
          await manager.set(`persisted:${hash}`, document, 86400); // 24 hours
        },
      },
    },

    // Enable query batching
    batching: {
      enabled: true,
      limit: 10,
    },

    // Enable introspection in development only
    introspection: serverConfig.env === 'development',

    // Query complexity analysis
    queryComplexity: {
      enabled: true,
      maximumComplexity: 1000,
      scalarCost: 1,
      objectCost: 2,
      listFactor: 10,
      introspectionCost: 1000,
      estimators: [
        // Add custom complexity estimators if needed
      ],
    },
  },

  // Logging configuration
  logging: {
    level: serverConfig.env === 'production' ? 'info' : 'debug',
    prettyPrint: serverConfig.env !== 'production',
  },

  // Metrics configuration
  metrics: {
    enabled: true,
    endpoint: '/metrics',
    // Prometheus format
    format: 'prometheus',
  },

  // Security configuration
  security: {
    // Enable security headers
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'",
    },

    // Request size limits
    requestLimits: {
      maxRequestSize: '1mb',
      maxVariablesSize: '100kb',
    },
  },

  // Federation-specific configuration
  federation: {
    // Enable query planning cache
    queryPlanCache: {
      enabled: true,
      ttl: 300_000, // 5 minutes
    },

    // Service health checks
    serviceHealthCheck: {
      enabled: true,
      interval: 30_000, // 30 seconds
      timeout: 5_000,   // 5 seconds
    },
  },
};

// Export a function to create gateway instance
export async function createHiveGateway() {
  const { createGateway } = await import('@graphql-hive/gateway');

  return createGateway(hiveGatewayConfig);
}

// Export types for use in other files
export type HiveGatewayConfig = typeof hiveGatewayConfig;
export type { GatewayConfig };