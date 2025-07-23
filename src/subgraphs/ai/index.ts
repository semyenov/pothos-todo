import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { schema } from './simple-schema.js';
import { logger } from '../../lib/unjs-utils.js';
import { Container } from '../../infrastructure/container/Container.js';

const PORT = process.env.AI_SUBGRAPH_PORT || 4003;

/**
 * AI Subgraph Server
 *
 * This subgraph handles all AI-related operations including:
 * - Semantic search
 * - Task suggestions
 * - Natural language processing
 * - Predictive analytics
 */
export async function startAISubgraph() {
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
    graphqlEndpoint: '/graphql',
    logging: logger.withTag('ai-subgraph'),
  });

  // Create HTTP server
  const server = createServer(yoga);

  server.listen(PORT, () => {
    logger.info(`🚀 AI subgraph ready at http://localhost:${PORT}/graphql`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.info('AI subgraph server closed');
    });
  });
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startAISubgraph().catch((error) => {
    logger.error('Failed to start AI subgraph', error);
    process.exit(1);
  });
}

export default startAISubgraph;