import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { useServer } from "graphql-ws/use/ws";
import { WebSocketServer } from "ws";
import { schema } from "./schema.js";
import { logger } from "../../lib/unjs-utils.js";
import { Container } from "../../infrastructure/container/Container.js";
import { loadAppConfig } from "../../config/index.js";
import { 
  createMonitoringPlugin, 
  startMetricsServer, 
  initializeOpenTelemetry 
} from "../../federation/monitoring.js";

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
  // Load configuration first
  await loadAppConfig();
  
  // Initialize container and dependencies
  const container = Container.getInstance();

  // Initialize OpenTelemetry
  initializeOpenTelemetry('todo-subgraph');
  
  // Start metrics server
  startMetricsServer(9092);
  
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
    logging: logger.withTag("todo-subgraph"),
    plugins: [createMonitoringPlugin('todo')],
  });

  // Create HTTP server
  const server = createServer(yoga);

  server.listen(PORT, () => {
    logger.info(`🚀 Todo subgraph ready at http://localhost:${PORT}/graphql`);
    
    // Set up WebSocket server for subscriptions
    const wsServer = new WebSocketServer({
      server,
      path: '/graphql',
    });
    
    useServer(
      {
        execute: (args: any) => args.rootValue.execute(args),
        subscribe: (args: any) => args.rootValue.subscribe(args),
        onSubscribe: async (ctx, msg: any) => {
          const { schema, execute, subscribe, contextFactory, parse, validate } =
            yoga.getEnveloped({
              ...ctx,
              req: ctx.extra.request,
              socket: ctx.extra.socket,
              params: msg.payload,
            });

          const args = {
            schema,
            operationName: msg.payload.operationName,
            document: parse(msg.payload.query),
            variableValues: msg.payload.variables,
            contextValue: await contextFactory(),
            rootValue: {
              execute,
              subscribe,
            },
          };

          const errors = validate(args.schema, args.document);
          if (errors.length) return errors;
          return args;
        },
      },
      wsServer
    );
    
    logger.info(`🔌 WebSocket server ready for subscriptions`);
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
