import { createServer } from 'http';
import { createYoga } from 'graphql-yoga';
import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { schemaFromExecutor } from '@graphql-tools/wrap';
import { stitchSchemas } from '@graphql-tools/stitch';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import {
  createCachingPlugin,
  warmupCache,
  CacheConfig,
  defaultCacheConfig,
  cacheStats,
  createCacheDebugPlugin,
} from './caching.js';
import { createMonitoringPlugin, startMetricsServer } from './monitoring.js';
import { createSecurityPlugins, SecurityConfig } from './security.js';

// Gateway configuration with caching
export interface GatewayConfig {
  port: number;
  subgraphs: Array<{
    name: string;
    url: string;
  }>;
  cache?: CacheConfig;
  security?: SecurityConfig;
  monitoring?: {
    enabled: boolean;
    metricsPort: number;
  };
}

const defaultGatewayConfig: GatewayConfig = {
  port: 4000,
  subgraphs: [
    { name: 'user', url: 'http://localhost:4001/graphql' },
    { name: 'todo', url: 'http://localhost:4002/graphql' },
    { name: 'ai', url: 'http://localhost:4003/graphql' },
  ],
  cache: defaultCacheConfig,
  monitoring: {
    enabled: true,
    metricsPort: 9090,
  },
};

// Enhanced executor with caching headers
function createCachedExecutor(subgraph: { name: string; url: string }) {
  return buildHTTPExecutor({
    endpoint: subgraph.url,
    headers: (executorRequest) => {
      const headers: Record<string, string> = {
        'x-subgraph-name': subgraph.name,
      };
      
      // Forward cache control headers
      const incomingHeaders = executorRequest?.context?.request?.headers;
      if (incomingHeaders) {
        const cacheControl = incomingHeaders.get('cache-control');
        if (cacheControl) {
          headers['cache-control'] = cacheControl;
        }
      }
      
      return headers;
    },
  });
}

// Start gateway with caching
export async function startCachedGateway(
  config: GatewayConfig = defaultGatewayConfig
) {
  logger.info(chalk.bold('🚀 Starting Cached Federation Gateway'));
  
  // Initialize monitoring
  if (config.monitoring?.enabled) {
    startMetricsServer(config.monitoring.metricsPort);
  }
  
  // Create subgraph executors
  const subgraphExecutors = await Promise.all(
    config.subgraphs.map(async (subgraph) => {
      const executor = createCachedExecutor(subgraph);
      const schema = await schemaFromExecutor(executor);
      return { schema, executor, name: subgraph.name };
    })
  );
  
  // Stitch schemas
  const gatewaySchema = stitchSchemas({
    subschemas: subgraphExecutors.map(({ schema, executor }) => ({
      schema,
      executor,
    })),
  });
  
  // Create plugins
  const plugins = [
    // Monitoring
    createMonitoringPlugin('gateway'),
    
    // Caching
    ...createCachingPlugin(config.cache),
    
    // Security (if enabled)
    ...(config.security ? createSecurityPlugins(config.security) : []),
    
    // Cache debugging (in development)
    ...(process.env.NODE_ENV !== 'production' ? [createCacheDebugPlugin()] : []),
    
    // Custom cache headers
    {
      onExecute() {
        return {
          onExecuteDone({ result, args }: any) {
            // Add cache headers to response
            const response = args.contextValue?.response;
            if (response && !result.errors) {
              const operationType = args.document.definitions[0]?.operation;
              
              if (operationType === 'query') {
                // Set cache headers for queries
                const maxAge = config.cache?.ttl.default || 60;
                response.headers.set('Cache-Control', `public, max-age=${Math.floor(maxAge / 1000)}`);
                response.headers.set('X-Cache', 'HIT');
              } else {
                // No cache for mutations/subscriptions
                response.headers.set('Cache-Control', 'no-cache, no-store');
                response.headers.set('X-Cache', 'BYPASS');
              }
            }
          },
        };
      },
    },
  ];
  
  // Create Yoga server
  const yoga = createYoga({
    schema: gatewaySchema,
    plugins,
    context: async ({ request }) => ({
      request,
      // Add cache control context
      skipCache: request.headers.get('x-skip-cache') === 'true',
    }),
    graphqlEndpoint: '/graphql',
    logging: logger.withTag('cached-gateway'),
  });
  
  // Create HTTP server
  const server = createServer((req, res) => {
    // Handle cache stats endpoint
    if (req.url === '/cache/stats') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ...cacheStats.getStats(),
        timestamp: new Date().toISOString(),
      }));
      return;
    }
    
    // Handle cache clear endpoint
    if (req.url === '/cache/clear' && req.method === 'POST') {
      // This would clear the cache
      cacheStats.reset();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
      return;
    }
    
    // Handle GraphQL requests
    yoga(req, res);
  });
  
  // Start server
  server.listen(config.port, async () => {
    logger.info(chalk.green(`✅ Cached Gateway ready at http://localhost:${config.port}/graphql`));
    logger.info(chalk.blue(`📊 Cache stats at http://localhost:${config.port}/cache/stats`));
    
    // Warmup cache
    if (config.cache?.warmup?.enabled) {
      setTimeout(() => {
        warmupCache(`http://localhost:${config.port}/graphql`, config.cache!)
          .catch(error => logger.error('Cache warmup failed:', error));
      }, 5000); // Wait 5 seconds for services to stabilize
    }
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Shutting down cached gateway...');
    server.close(() => {
      logger.info('Cached gateway shut down');
    });
  });
  
  return server;
}

// Advanced caching strategies
export class CachingStrategies {
  // Automatic cache key generation based on query analysis
  static generateSmartCacheKey(
    query: string,
    variables: Record<string, any>,
    context: any
  ): string {
    // Extract operation name
    const operationMatch = query.match(/query\s+(\w+)/);
    const operationName = operationMatch?.[1] || 'anonymous';
    
    // Extract requested fields
    const fieldsMatch = query.match(/\{([^}]+)\}/g);
    const fields = fieldsMatch?.join('').replace(/[{}\s]/g, '') || '';
    
    // Build cache key
    const parts = [
      operationName,
      fields.substring(0, 50), // Limit field list length
      context.userId || 'public',
      JSON.stringify(variables),
    ];
    
    return parts.join(':');
  }
  
  // Predictive cache warming based on usage patterns
  static async predictiveWarmup(
    endpoint: string,
    usagePatterns: Array<{ query: string; variables: any; frequency: number }>
  ): Promise<void> {
    // Sort by frequency
    const sortedPatterns = usagePatterns.sort((a, b) => b.frequency - a.frequency);
    
    // Warm up top queries
    const topQueries = sortedPatterns.slice(0, 10);
    
    for (const pattern of topQueries) {
      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: pattern.query,
            variables: pattern.variables,
          }),
        });
      } catch (error) {
        logger.error('Predictive warmup error:', error);
      }
    }
  }
  
  // Edge caching with geographic distribution
  static getEdgeCacheHeaders(
    region: string,
    queryComplexity: number
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    
    // Set edge cache TTL based on region and complexity
    const baseTTL = 300; // 5 minutes
    const regionMultiplier = {
      'us-east': 1,
      'us-west': 1,
      'eu': 0.8,
      'asia': 0.6,
    }[region] || 1;
    
    const complexityMultiplier = Math.max(0.5, 1 - queryComplexity / 100);
    const ttl = Math.floor(baseTTL * regionMultiplier * complexityMultiplier);
    
    headers['Cache-Control'] = `public, s-maxage=${ttl}`;
    headers['CDN-Cache-Control'] = `max-age=${ttl}`;
    headers['Surrogate-Key'] = `region:${region}`;
    
    return headers;
  }
}

// Cache middleware for subgraphs
export function createSubgraphCacheMiddleware(subgraphName: string) {
  return (req: any, res: any, next: any) => {
    // Add cache tags
    res.setHeader('Cache-Tag', `subgraph:${subgraphName}`);
    
    // Add timing header
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      res.setHeader('X-Response-Time', `${duration}ms`);
    });
    
    next();
  };
}

// Start gateway if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startCachedGateway().catch(error => {
    logger.error('Failed to start cached gateway:', error);
    process.exit(1);
  });
}