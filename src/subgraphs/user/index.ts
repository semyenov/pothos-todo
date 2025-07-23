import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";
import { logger } from "../../lib/unjs-utils.js";
import { Container } from "../../infrastructure/container/Container.js";

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
  // Initialize container and dependencies
  const container = Container.getInstance();

  // Create Yoga server
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
