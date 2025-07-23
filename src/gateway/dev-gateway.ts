import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { stitchSchemas } from '@graphql-tools/stitch';
import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { schemaFromExecutor, wrapSchema } from '@graphql-tools/wrap';
import { logger } from '../lib/unjs-utils.js';

const PORT = process.env.GATEWAY_PORT || 4000;

/**
 * Development Gateway
 * 
 * This gateway runs without Hive credentials by directly connecting to subgraphs.
 * It's useful for local development and testing.
 */
export async function startDevGateway() {
  logger.info('Starting Development Gateway (without Hive)...');

  // Define subgraph endpoints
  const subgraphs = [
    { name: 'user', url: 'http://localhost:4001/graphql' },
    { name: 'todo', url: 'http://localhost:4002/graphql' },
    { name: 'ai', url: 'http://localhost:4003/graphql' },
  ];

  // Create executors for each subgraph
  const subgraphSchemas = await Promise.all(
    subgraphs.map(async ({ name, url }) => {
      logger.info(`Connecting to ${name} subgraph at ${url}`);
      
      const executor = buildHTTPExecutor({
        endpoint: url,
      });

      const schema = wrapSchema({
        schema: await schemaFromExecutor(executor),
        executor,
      });

      return {
        schema,
        name,
      };
    })
  );

  // Stitch schemas together
  const gatewaySchema = stitchSchemas({
    subschemas: subgraphSchemas.map(({ schema, name }) => ({
      schema,
      batch: true,
      merge: {
        // Define how to merge types across subgraphs
        User: {
          fieldName: 'user',
          selectionSet: '{ id }',
          args: (originalObject: any) => ({ id: originalObject.id }),
        },
        Todo: {
          fieldName: 'todo',
          selectionSet: '{ id }',
          args: (originalObject: any) => ({ id: originalObject.id }),
        },
        TodoList: {
          fieldName: 'todoList',
          selectionSet: '{ id }',
          args: (originalObject: any) => ({ id: originalObject.id }),
        },
      },
    })),
  });

  // Create Yoga server with the stitched schema
  const yoga = createYoga({
    schema: gatewaySchema,
    graphqlEndpoint: '/graphql',
    logging: {
      debug: (...args) => logger.debug(...args),
      info: (...args) => logger.info(...args),
      warn: (...args) => logger.warn(...args),
      error: (...args) => logger.error(...args),
    },
  });

  // Create HTTP server
  const server = createServer(yoga);

  server.listen(PORT, () => {
    logger.info(`🚀 Development Gateway ready at http://localhost:${PORT}/graphql`);
    logger.info('GraphiQL interface available at http://localhost:${PORT}/graphql');
    logger.warn('⚠️  This is a development gateway - not suitable for production!');
    logger.info('\nMake sure all subgraphs are running:');
    subgraphs.forEach(({ name, url }) => {
      logger.info(`  - ${name}: ${url}`);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.info('Development gateway server closed');
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    server.close(() => {
      logger.info('Development gateway server closed');
    });
  });
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startDevGateway().catch((error) => {
    logger.error('Failed to start development gateway', error);
    process.exit(1);
  });
}