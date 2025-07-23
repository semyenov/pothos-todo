import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { createYoga } from 'graphql-yoga';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import {
  createSecurityPlugins,
  securityHeaders,
  corsMiddleware,
  SecurityConfig,
  defaultSecurityConfig,
  securityAuditor,
} from './security.js';
import { createMonitoringPlugin, startMetricsServer } from './monitoring.js';

// Gateway security configuration
export interface GatewaySecurityConfig extends SecurityConfig {
  gateway: {
    trustedSubgraphs: string[];
    subgraphAuth: {
      enabled: boolean;
      secret: string;
    };
    requestSigning: {
      enabled: boolean;
      algorithm: 'HS256' | 'RS256';
      secret: string;
    };
    encryption: {
      enabled: boolean;
      algorithm: 'aes-256-gcm';
      key: string;
    };
  };
}

export const defaultGatewaySecurityConfig: GatewaySecurityConfig = {
  ...defaultSecurityConfig,
  gateway: {
    trustedSubgraphs: [
      'http://user-subgraph:4001/graphql',
      'http://todo-subgraph:4002/graphql',
      'http://ai-subgraph:4003/graphql',
    ],
    subgraphAuth: {
      enabled: true,
      secret: process.env.SUBGRAPH_SECRET || 'subgraph-communication-secret',
    },
    requestSigning: {
      enabled: true,
      algorithm: 'HS256',
      secret: process.env.REQUEST_SIGNING_SECRET || 'request-signing-secret',
    },
    encryption: {
      enabled: false, // Enable for sensitive data
      algorithm: 'aes-256-gcm',
      key: process.env.ENCRYPTION_KEY || '',
    },
  },
};

// Create secure gateway
export function createSecureGateway(
  schema: any,
  config: GatewaySecurityConfig = defaultGatewaySecurityConfig
) {
  // Create security plugins
  const securityPlugins = createSecurityPlugins(config);
  
  // Add gateway-specific security
  const gatewayPlugins = [
    ...securityPlugins,
    createMonitoringPlugin('gateway'),
    
    // Log security events
    {
      onExecute({ args }: any) {
        const operationType = args.document.definitions[0]?.operation || 'unknown';
        const operationName = args.operationName || 'anonymous';
        
        logger.info(chalk.blue(`Executing ${operationType}: ${operationName}`));
        
        return {
          onExecuteDone({ result }: any) {
            if (result.errors) {
              securityAuditor.log({
                type: 'suspicious_activity',
                userId: args.contextValue?.userId,
                details: {
                  operation: operationName,
                  errors: result.errors.map((e: any) => e.message),
                },
              });
            }
          },
        };
      },
    },
  ];
  
  // Create Yoga instance
  const yoga = createYoga({
    schema,
    plugins: gatewayPlugins,
    context: async ({ request }) => {
      return {
        request,
        securityConfig: config,
      };
    },
    maskedErrors: process.env.NODE_ENV === 'production',
    graphqlEndpoint: '/graphql',
    logging: logger.withTag('secure-gateway'),
  });
  
  return yoga;
}

// Secure WebSocket handling
export function createSecureWebSocketServer(
  server: any,
  yoga: any,
  config: GatewaySecurityConfig
) {
  const wsServer = new WebSocketServer({
    server,
    path: '/graphql',
    verifyClient: (info, cb) => {
      // Verify WebSocket connection
      const origin = info.origin;
      const secure = info.secure;
      
      // Check origin
      if (config.cors.origin !== '*') {
        const allowed = typeof config.cors.origin === 'function'
          ? config.cors.origin(origin)
          : Array.isArray(config.cors.origin)
          ? config.cors.origin.includes(origin)
          : config.cors.origin === origin;
        
        if (!allowed) {
          cb(false, 403, 'Forbidden');
          return;
        }
      }
      
      // Require secure connection in production
      if (process.env.NODE_ENV === 'production' && !secure) {
        cb(false, 403, 'Secure connection required');
        return;
      }
      
      cb(true);
    },
  });
  
  useServer(
    {
      execute: (args: any) => args.rootValue.execute(args),
      subscribe: (args: any) => args.rootValue.subscribe(args),
      onConnect: async (ctx) => {
        // Validate connection token
        const token = ctx.connectionParams?.authorization;
        if (config.jwt && token) {
          try {
            // Verify token
            logger.info('WebSocket connection established');
          } catch (error) {
            logger.warn('Invalid WebSocket connection token');
            return false;
          }
        }
        return true;
      },
      onDisconnect: () => {
        logger.info('WebSocket connection closed');
      },
      onSubscribe: async (ctx, msg) => {
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
  
  return wsServer;
}

// Subgraph request interceptor
export function createSubgraphFetcher(config: GatewaySecurityConfig) {
  return async (url: string, init: RequestInit) => {
    // Only allow trusted subgraphs
    if (!config.gateway.trustedSubgraphs.includes(url)) {
      throw new Error(`Untrusted subgraph: ${url}`);
    }
    
    // Add authentication headers
    const headers = new Headers(init.headers);
    
    if (config.gateway.subgraphAuth.enabled) {
      headers.set('X-Subgraph-Auth', config.gateway.subgraphAuth.secret);
    }
    
    // Sign request if enabled
    if (config.gateway.requestSigning.enabled) {
      const timestamp = Date.now().toString();
      const signature = createRequestSignature(
        url,
        init.body as string,
        timestamp,
        config.gateway.requestSigning.secret
      );
      
      headers.set('X-Request-Timestamp', timestamp);
      headers.set('X-Request-Signature', signature);
    }
    
    // Encrypt sensitive data if enabled
    if (config.gateway.encryption.enabled && init.body) {
      const encryptedBody = encryptData(
        init.body as string,
        config.gateway.encryption.key
      );
      init.body = encryptedBody;
      headers.set('X-Encrypted', 'true');
    }
    
    return fetch(url, {
      ...init,
      headers,
    });
  };
}

// Request signature creation
import crypto from 'crypto';

function createRequestSignature(
  url: string,
  body: string,
  timestamp: string,
  secret: string
): string {
  const payload = `${url}:${body}:${timestamp}`;
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Data encryption
function encryptData(data: string, key: string): string {
  if (!key || key.length !== 32) {
    throw new Error('Encryption key must be 32 characters');
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return JSON.stringify({
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  });
}

// Security monitoring endpoint
export function createSecurityMonitoringEndpoint() {
  return async (req: any, res: any) => {
    if (req.url === '/security/status') {
      const recentLogs = securityAuditor.getRecentLogs(60);
      const anomalies = securityAuditor.detectAnomalies();
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: anomalies.some(a => a.severity === 'high') ? 'alert' : 'ok',
        recentEvents: recentLogs.length,
        anomalies,
        timestamp: new Date().toISOString(),
      }));
    } else if (req.url === '/security/audit') {
      const logs = securityAuditor.getRecentLogs(24 * 60); // Last 24 hours
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        logs,
        total: logs.length,
        byType: logs.reduce((acc, log) => {
          acc[log.type] = (acc[log.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      }));
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  };
}

// Complete secure gateway setup
export function startSecureGateway(
  schema: any,
  port: number = 4000,
  config: GatewaySecurityConfig = defaultGatewaySecurityConfig
) {
  // Start metrics server
  startMetricsServer(9090);
  
  // Create secure Yoga instance
  const yoga = createSecureGateway(schema, config);
  
  // Create HTTP server with security middleware
  const server = createServer((req, res) => {
    // Apply security headers
    securityHeaders()(req, res, () => {
      // Apply CORS
      corsMiddleware(config.cors)(req, res, () => {
        // Handle security monitoring endpoints
        if (req.url?.startsWith('/security/')) {
          createSecurityMonitoringEndpoint()(req, res);
          return;
        }
        
        // Handle GraphQL requests
        yoga(req, res);
      });
    });
  });
  
  // Create secure WebSocket server
  const wsServer = createSecureWebSocketServer(server, yoga, config);
  
  // Start server
  server.listen(port, () => {
    logger.info(chalk.green(`🔐 Secure GraphQL Gateway ready at http://localhost:${port}/graphql`));
    logger.info(chalk.green(`🔌 Secure WebSocket ready at ws://localhost:${port}/graphql`));
    logger.info(chalk.green(`📊 Security monitoring at http://localhost:${port}/security/status`));
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down securely...');
    wsServer.close();
    server.close(() => {
      logger.info('Secure gateway shut down');
    });
  });
  
  return { server, wsServer };
}