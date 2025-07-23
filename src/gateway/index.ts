import { createServer } from 'node:http';
import { logger } from '../lib/unjs-utils.js';
import { HiveGatewayService } from '../infrastructure/gateway/HiveGatewayService.js';
import { Container } from '../infrastructure/container/Container.js';

const PORT = process.env.GATEWAY_PORT || 4000;

/**
 * Hive Gateway Server
 * 
 * This is the main federation gateway that:
 * - Combines schemas from all subgraphs
 * - Routes queries to appropriate subgraphs
 * - Handles authentication and authorization
 * - Provides a single GraphQL endpoint
 */
export async function startGateway() {
  try {
    logger.info('Starting Hive Gateway...');

    // Check if we're in development mode without Hive credentials
    const isDevelopmentMode = process.env.FEDERATION_MODE === 'development';
    
    if (isDevelopmentMode) {
      logger.warn('Running in development mode - using local schema composition');
      // In development, we could use a local schema stitching approach
      // For now, we'll just log a warning
      logger.error('Development mode not yet implemented. Please configure Hive credentials.');
      process.exit(1);
    }

    // Initialize container
    const container = Container.getInstance();
    await container.initialize();
    logger.info('Container initialized');

    // Initialize Hive Gateway
    const hiveGateway = HiveGatewayService.getInstance();
    
    // Start the gateway
    await hiveGateway.start(Number(PORT));
    
    logger.info(`🚀 Gateway ready at http://localhost:${PORT}/graphql`);
    logger.info('GraphiQL interface available at http://localhost:${PORT}/graphql');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing Gateway');
      await hiveGateway.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing Gateway');
      await hiveGateway.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start gateway', error);
    
    if (error instanceof Error) {
      if (error.message.includes('HIVE_CDN_ENDPOINT')) {
        logger.error('Hive configuration is missing. Please check your environment variables.');
        logger.info('Run "bun run src/test-env-setup.ts" to check your configuration.');
      }
    }
    
    process.exit(1);
  }
}

// Start the gateway if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startGateway().catch((error) => {
    logger.error('Unhandled error during gateway startup', error);
    process.exit(1);
  });
}