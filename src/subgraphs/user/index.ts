import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";
import { logger } from "../../lib/unjs-utils.js";
import { Container } from "../../infrastructure/container/Container.js";
import { loadAppConfig } from "../../config/index.js";
import { 
  createMonitoringPlugin, 
  startMetricsServer, 
  initializeOpenTelemetry 
} from "../../federation/monitoring.js";

const PORT = process.env.USER_SUBGRAPH_PORT || 4001;

/**
 * User Subgraph Server
 *
 * This subgraph handles all user-related operations including:
 * - User authentication and authorization
 * - User profile management
 * - User preferences
 */
export async function startUserSubgraph() {
  // Load configuration first
  await loadAppConfig();
  
  // Initialize container and dependencies
  const container = Container.getInstance();

  // Initialize OpenTelemetry
  initializeOpenTelemetry('user-subgraph');
  
  // Start metrics server
  startMetricsServer(9091);
  
  // Create Yoga server with monitoring
  const yoga = createYoga({
    schema,
    context: async ({ request }) => {
      // Add container and other context values
      return {
        container,
        request,
      };
    },
    graphqlEndpoint: "/graphql",
    logging: logger.withTag("user-subgraph"),
    plugins: [createMonitoringPlugin('user')],
  });

  // Create HTTP server
  const server = createServer(yoga);

  server.listen(PORT, () => {
    logger.info(`🚀 User subgraph ready at http://localhost:${PORT}/graphql`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM signal received: closing HTTP server");
    server.close(() => {
      logger.info("User subgraph server closed");
    });
  });
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startUserSubgraph().catch((error) => {
    logger.error("Failed to start user subgraph", error);
    process.exit(1);
  });
}
