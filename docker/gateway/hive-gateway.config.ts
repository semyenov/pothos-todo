import { defineConfig } from '@graphql-hive/gateway';

export const gatewayConfig = defineConfig({
  /**
   * Hive CDN configuration for schema composition
   */
  // // cdn: {
  // //   endpoint: process.env.HIVE_CDN_ENDPOINT!,
  // //   key: process.env.HIVE_CDN_KEY!,
  // // },

  // // /**
  // //  * Polling interval for schema updates (in milliseconds)
  // //  */
  // // polling: {
  // //   interval: 10_000, // 10 seconds
  // // },

  // // /**
  // //  * HTTP server configuration
  // //  */
  // // http: {
  // //   port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4000,
  // // },

  // /**
  //  * GraphQL endpoint configuration
  //  */
  // graphql: {
  //   endpoint: '/graphql',
  // },

  /**
   * Enable GraphiQL in development
   */
  graphiql: process.env.NODE_ENV !== 'production',

  /**
   * CORS configuration
   */
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
  },

  /**
   * Health check endpoints
   */
  healthCheckEndpoint: '/healthcheck',

  // /**
  //  * Metrics configuration
  //  */
  // metrics: {
  //   enabled: true,
  //   endpoint: '/metrics',
  // },

  /**
   * Request logging
   */
  logging: process.env.NODE_ENV == 'development' ? 'info' : 'warn',

  /**
   * Tracing configuration
   */
  // tracing: {
  //   enabled: process.env.TELEMETRY_ENABLED === 'true',
  //   serviceName: 'hive-gateway',
  //   endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  // },

  /**
   * Rate limiting
   */
  rateLimiting: false,

  /**
   * Response caching
   */
  // responseCache: {
  //   enabled: true,
  //   ttl: 60, // 60 seconds default TTL
  //   // Cache based on user ID from context
  //   sessionId: (context: any) => context.userId || 'anonymous',
  // },

  /**
   * Subgraph configuration (for development without Hive CDN)
   */
  // subgraphs: process.env.HIVE_CDN_ENDPOINT ? undefined : [
  //   {
  //     name: 'user',
  //     url: process.env.USER_SUBGRAPH_URL || 'http://localhost:4001/graphql',
  //   },
  //   {
  //     name: 'todo',
  //     url: process.env.TODO_SUBGRAPH_URL || 'http://localhost:4002/graphql',
  //   },
  //   {
  //     name: 'ai',
  //     url: process.env.AI_SUBGRAPH_URL || 'http://localhost:4003/graphql',
  //   },
  // ],

  /**
   * Custom plugins
   */
  plugins: (context: any) => [
    // Add custom plugins here
  ],
});
