import { createApp, eventHandler, useSession, toNodeListener } from "h3";
import { yoga } from "./src/api/server/server.js";
import { logger } from "./src/logger.js";
import {
  loadAppConfig,
  getServerConfig,
  getSessionConfig,
  getTelemetryConfig,
  getCacheConfig,
  getAIConfig,
} from "./src/config/index.js";
import {
  handleGoogleLogin,
  handleGoogleCallback,
  handleGitHubLogin,
  handleGitHubCallback,
  handleLogout,
  handleLogoutAll,
} from "./src/routes/auth/index.js";
import { createServer } from "node:http";
import { initializeTelemetry, shutdownTelemetry } from "./src/infrastructure/telemetry/telemetry.js";
import { CacheManager } from "./src/infrastructure/cache/CacheManager.js";
import { Container } from "./src/infrastructure/container/Container.js";
import { websocketHandler } from "./src/routes/websocket.js";
import { graphqlWebSocketHandler } from "./src/routes/graphql-ws.js";
import { env } from "./src/config/env.validation.js";
import {
  handleHealthCheck,
  handleLivenessProbe,
  handleReadinessProbe,
  handleDetailedHealthCheck
} from "./src/routes/health.js";
import { correlationIdMiddleware, withCorrelation } from "./src/middleware/correlationId.js";
import { security } from "./src/middleware/security.js";
import { errorHandler } from "./src/middleware/errorHandler.js";
import { rateLimiters } from "./src/middleware/rateLimit.js";
import { CacheWarmer, defaultCacheWarmingConfig } from "./src/infrastructure/cache/CacheWarmer.js";
import { prismaService } from "./src/lib/prisma.js";
import { getDatabaseConfig } from "./src/config/env.validation.js";
import { MetricsCollector, createMetricsMiddleware } from "./src/infrastructure/monitoring/MetricsCollector.js";
import { handleMetrics, handleMetricsHistory, handlePrometheusMetrics } from "./src/routes/metrics.js";

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

async function startServer() {
  console.log('START: startServer');
  try {
    // Environment variables are validated on import
    logger.info("Environment variables validated successfully", {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
    });

    // Load configuration
    await loadAppConfig();
    const serverConfig = getServerConfig();
    const sessionConfig = getSessionConfig();
    const telemetryConfig = getTelemetryConfig();
    const cacheConfig = getCacheConfig();
    const aiConfig = getAIConfig();

    // Initialize telemetry if enabled
    if (telemetryConfig.enabled) {
      initializeTelemetry();
      logger.info("OpenTelemetry initialized");
    }

    // Initialize database with optimized pooling
    const databaseConfig = getDatabaseConfig();
    logger.info("Initializing database connection pool", {
      poolSize: databaseConfig.poolSize,
    });
    await prismaService.connect();
    logger.info("Database connection pool initialized");

    // Initialize cache manager if enabled
    if (cacheConfig.enabled) {
      const cacheManager = await CacheManager.getInstance();
      logger.info("Cache manager initialized");

      // Start cache warming
      const cacheWarmer = CacheWarmer.getInstance();
      await cacheWarmer.startWarming();
      logger.info("Cache warming started");
    }

    // Initialize metrics collection
    const metricsCollector = MetricsCollector.getInstance();
    metricsCollector.start(60000); // Collect metrics every minute
    logger.info("Metrics collection started");

    // Initialize AI services if enabled
    if (aiConfig.enabled) {
      const container = Container.getInstance();

      // Initialize vector store
      await container.vectorStore.connect(aiConfig.vectorStore.url);
      logger.info("Vector store initialized");

      // Initialize AI services
      if (aiConfig.openai.apiKey) {
        container.embeddingService.initialize(aiConfig.openai.apiKey);
        container.nlpService.initialize(aiConfig.openai.apiKey);
        container.ragService.initialize(aiConfig.openai.apiKey);
        container.mlPredictionService.initialize(aiConfig.openai.apiKey);
        await container.initializeEmbeddingHandler();
        logger.info("AI services initialized (Embedding, NLP, RAG, ML Predictions)");
      } else {
        logger.warn("OpenAI API key not configured, AI features will be limited");
      }
    }

    // Create H3 app
    const app = createApp();

    // Global error handler
    app.use(
      eventHandler(async (event) => {
        try {
          // H3 events don't have a next() method, this is handled by the router
        } catch (error) {
          return errorHandler(error, event);
        }
      })
    );

    // Security middleware
    app.use(
      eventHandler((event) => {
        security()(event);
      })
    );

    // Correlation ID middleware
    app.use(
      eventHandler((event) => {
        correlationIdMiddleware(event);
      })
    );

    // Metrics collection middleware
    app.use(
      eventHandler((event) => {
        createMetricsMiddleware()(event);
      })
    );

    // Global middleware for request logging with correlation
    app.use(
      eventHandler(withCorrelation(async (event) => {
        const startTime = Date.now();
        event.context.startTime = startTime;

        logger.info("Request", {
          method: event.node.req.method,
          url: event.node.req.url,
          userAgent: event.node.req.headers["user-agent"],
          correlationId: event.context.correlationId,
          requestId: event.context.requestId,
        });
      }))
    );

    // Session middleware
    app.use(
      eventHandler(async (event) => {
        if (event.node.req.url?.startsWith("/auth/")) {
          const session = await useSession(event, {
            password: sessionConfig.secret,
            name: sessionConfig.name,
            maxAge: sessionConfig.maxAge,
            cookie: {
              secure: sessionConfig.secure,
              sameSite: sessionConfig.sameSite,
            },
          });
          event.context.session = session;
        }
      })
    );

    // Health check routes
    app.use(
      "/health",
      eventHandler(async (event) => {
        return await handleHealthCheck(event);
      })
    );

    app.use(
      "/health/live",
      eventHandler(async (event) => {
        return await handleLivenessProbe(event);
      })
    );

    app.use(
      "/health/ready",
      eventHandler(async (event) => {
        return await handleReadinessProbe(event);
      })
    );

    app.use(
      "/health/detailed",
      eventHandler(async (event) => {
        return await handleDetailedHealthCheck(event);
      })
    );

    // Metrics endpoints
    app.use(
      "/metrics",
      eventHandler(async (event) => {
        return await handleMetrics(event);
      })
    );

    app.use(
      "/metrics/history",
      eventHandler(async (event) => {
        return await handleMetricsHistory(event);
      })
    );

    app.use(
      "/metrics/prometheus",
      eventHandler(async (event) => {
        return await handlePrometheusMetrics(event);
      })
    );

    // Auth routes with native H3 event handling and rate limiting
    app.use(
      "/auth/google",
      eventHandler(withCorrelation(async (event) => {
        await rateLimiters.auth(event);
        return await handleGoogleLogin(event);
      }))
    );

    app.use(
      "/auth/google/callback",
      eventHandler(async (event) => {
        return await handleGoogleCallback(event);
      })
    );

    app.use(
      "/auth/github",
      eventHandler(async (event) => {
        return await handleGitHubLogin(event);
      })
    );

    app.use(
      "/auth/github/callback",
      eventHandler(async (event) => {
        return await handleGitHubCallback(event);
      })
    );

    app.use(
      "/auth/logout",
      eventHandler(async (event) => {
        if (event.node.req.method === "POST") {
          return await handleLogout(event);
        }
      })
    );

    app.use(
      "/auth/logout/all",
      eventHandler(async (event) => {
        if (event.node.req.method === "POST") {
          return await handleLogoutAll(event);
        }
      })
    );

    // Mount GraphQL Yoga with WebSocket support
    app.use(
      "/graphql",
      eventHandler(async (event) => {
        // Check if this is a WebSocket upgrade request
        if (event.node.req.headers.upgrade === 'websocket') {
          return graphqlWebSocketHandler(event);
        }
        return yoga(event.node.req, event.node.res, { h3Event: event });
      })
    );

    // Mount WebSocket handler
    app.use(
      "/websocket",
      eventHandler(async (event) => {
        // Check if this is a WebSocket upgrade request
        if (event.node.req.headers.upgrade === 'websocket') {
          return websocketHandler(event);
        }
        return { status: 426, statusText: 'Upgrade Required' };
      })
    );

    // Create server using H3 app with toNodeListener
    const server = createServer(toNodeListener(app));

    server.listen(serverConfig.port, serverConfig.host, () => {
      logger.info("Server started", {
        port: serverConfig.port,
        host: serverConfig.host,
        graphqlEndpoint: yoga.graphqlEndpoint,
        graphiqlUrl: `http://${serverConfig.host}:${serverConfig.port}${yoga.graphqlEndpoint}`,
        webSocketEndpoints: [
          `ws://${serverConfig.host}:${serverConfig.port}/websocket`,
          `ws://${serverConfig.host}:${serverConfig.port}/graphql`
        ],
        authEndpoints: [
          "/auth/google",
          "/auth/google/callback",
          "/auth/github",
          "/auth/github/callback",
          "/auth/logout",
          "/auth/logout/all",
        ],
        healthEndpoints: [
          "/health",
          "/health/live",
          "/health/ready",
          "/health/detailed",
        ],
        metricsEndpoints: [
          "/metrics",
          "/metrics/history",
          "/metrics/prometheus",
        ],
      });
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);

      server.close(async () => {
        logger.info("HTTP server closed");

        // WebSocket cleanup is handled by H3/crossws
        logger.info("WebSocket connections closed");

        // Shutdown AI services
        if (aiConfig.enabled) {
          const container = Container.getInstance();
          await container.vectorStore.disconnect();
          logger.info("Vector store shutdown complete");
        }

        // Stop metrics collection
        const metricsCollector = MetricsCollector.getInstance();
        metricsCollector.stop();
        logger.info("Metrics collection stopped");

        // Shutdown database connection pool
        await prismaService.disconnect();
        logger.info("Database connection pool shutdown complete");

        // Shutdown cache manager
        if (cacheConfig.enabled) {
          const cacheWarmer = CacheWarmer.getInstance();
          cacheWarmer.stop();
          logger.info("Cache warming stopped");

          const cacheManager = await CacheManager.getInstance();
          await cacheManager.disconnect();
          logger.info("Cache manager shutdown complete");
        }

        // Shutdown telemetry
        if (telemetryConfig.enabled) {
          await shutdownTelemetry();
          logger.info("Telemetry shutdown complete");
        }

        // Add any other cleanup here
        logger.info("Graceful shutdown complete");
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error("Forced shutdown due to timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    return server;
  } catch (error) {
    console.error('Failed to start server', { error });
    console.error('EXITING with code 1');
    process.exit(1);
  }
  console.log('END: startServer');
}

startServer();