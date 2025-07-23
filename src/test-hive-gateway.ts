import { HiveGatewayService } from './infrastructure/gateway/HiveGatewayService.js';
import { logger } from './lib/unjs-utils.js';

/**
 * Test script for Hive Gateway setup
 * 
 * This script verifies:
 * 1. Hive Gateway service can be initialized
 * 2. Environment variables are properly configured
 * 3. Basic health check passes
 */
async function testHiveGateway() {
  logger.info('Starting Hive Gateway test...');

  // Check environment variables
  const requiredEnvVars = [
    'HIVE_TOKEN',
    'HIVE_CDN_ENDPOINT',
    'HIVE_CDN_KEY',
  ];

  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar] || process.env[envVar] === `your-${envVar.toLowerCase().replace(/_/g, '-')}-here`
  );

  if (missingEnvVars.length > 0) {
    logger.error('Missing or unconfigured environment variables:', {
      missing: missingEnvVars,
    });
    logger.info(`
Please configure the following environment variables in your .env file:
1. Sign up at https://app.graphql-hive.com
2. Create a new project and target
3. Get your access tokens from the dashboard
4. Update your .env file with the actual values
    `);
    return false;
  }

  try {
    // Initialize Hive Gateway service
    const hiveGateway = await HiveGatewayService.getInstance();
    logger.info('Hive Gateway service instance created');

    // Check health
    const isHealthy = await hiveGateway.isHealthy();
    logger.info('Health check result:', { healthy: isHealthy });

    if (!isHealthy) {
      logger.error('Hive Gateway health check failed');
      return false;
    }

    // Get metrics
    const metrics = hiveGateway.getMetrics();
    logger.info('Gateway metrics:', metrics);

    logger.info('✅ Hive Gateway test completed successfully!');
    logger.info(`
Next steps:
1. Ensure your subgraphs are registered in Hive Platform
2. Publish your schemas using: bunx @graphql-hive/cli schema:publish
3. Start the gateway with: bun run gateway:start
4. Start subgraphs with: bun run subgraph:user, etc.
    `);

    return true;
  } catch (error) {
    logger.error('Hive Gateway test failed:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('fetch failed')) {
        logger.error('Unable to connect to Hive CDN. Please check your internet connection and CDN endpoint.');
      } else if (error.message.includes('401') || error.message.includes('403')) {
        logger.error('Authentication failed. Please check your HIVE_CDN_KEY and HIVE_TOKEN.');
      } else if (error.message.includes('404')) {
        logger.error('Schema not found. Please publish your supergraph schema to Hive first.');
      }
    }
    
    return false;
  }
}

// Run the test
testHiveGateway()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    logger.error('Unexpected error:', error);
    process.exit(1);
  });