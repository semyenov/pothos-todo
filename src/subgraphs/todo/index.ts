import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";
import { logger } from "../../lib/unjs-utils.js";
import { Container } from "../../infrastructure/container/Container.js";

const PORT = process.env.TODO_SUBGRAPH_PORT || 4002;

/**
 * Todo Subgraph Server
 *
 * This subgraph handles all todo-related operations including:
 * - Todo CRUD operations
 * - TodoList management
 * - Task assignments and priorities
 */
export async function startTodoSubgraph() {
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
    logging: logger.withTag("todo-subgraph"),
  });

  // Create HTTP server
  const server = createServer(yoga);

  server.listen(PORT, () => {
    logger.info(`🚀 Todo subgraph ready at http://localhost:${PORT}/graphql`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM signal received: closing HTTP server");
    server.close(() => {
      logger.info("Todo subgraph server closed");
    });
  });
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startTodoSubgraph().catch((error) => {
    logger.error("Failed to start todo subgraph", error);
    process.exit(1);
  });
}

export default startTodoSubgraph;
