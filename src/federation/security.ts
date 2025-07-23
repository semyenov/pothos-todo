import { Plugin } from '@envelop/core';
import { RateLimitError, useRateLimiter } from '@envelop/rate-limiter';
import { useDepthLimit } from '@envelop/depth-limit';
import { useCostLimit } from '@envelop/cost-limit';
import { useResponseCache } from '@envelop/response-cache';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Security configuration
export interface SecurityConfig {
  rateLimit: {
    window: number; // in milliseconds
    max: number; // max requests per window
    identifier?: (context: any) => string;
  };
  depthLimit: number;
  costLimit: {
    maxCost: number;
    scalarCost?: number;
    objectCost?: number;
    listFactor?: number;
  };
  jwt: {
    secret: string;
    algorithms: jwt.Algorithm[];
    issuer?: string;
    audience?: string;
  };
  cors: {
    origin: string | string[] | ((origin: string) => boolean);
    credentials: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  };
  introspection: boolean;
  csrfProtection: boolean;
  queryWhitelisting?: {
    enabled: boolean;
    whitelist: Map<string, string>;
  };
}

// Default security configuration
export const defaultSecurityConfig: SecurityConfig = {
  rateLimit: {
    window: 60000, // 1 minute
    max: 100, // 100 requests per minute
    identifier: (context) => {
      // Try to identify by user ID, then by IP
      return context.userId || 
             context.request?.headers?.['x-forwarded-for'] || 
             context.request?.socket?.remoteAddress || 
             'anonymous';
    },
  },
  depthLimit: 10,
  costLimit: {
    maxCost: 1000,
    scalarCost: 1,
    objectCost: 2,
    listFactor: 10,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    algorithms: ['HS256'],
    issuer: 'pothos-todo-federation',
    audience: 'pothos-todo-api',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  introspection: process.env.NODE_ENV !== 'production',
  csrfProtection: true,
  queryWhitelisting: {
    enabled: false,
    whitelist: new Map(),
  },
};

// Security headers middleware
export function securityHeaders() {
  return (req: any, res: any, next: any) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Content Security Policy
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    
    res.setHeader('Content-Security-Policy', csp);
    
    // Strict Transport Security (only for HTTPS)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    next();
  };
}

// CORS middleware
export function corsMiddleware(config: SecurityConfig['cors']) {
  return (req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    
    // Check if origin is allowed
    let isAllowed = false;
    if (typeof config.origin === 'string') {
      isAllowed = config.origin === '*' || config.origin === origin;
    } else if (Array.isArray(config.origin)) {
      isAllowed = config.origin.includes(origin);
    } else if (typeof config.origin === 'function') {
      isAllowed = config.origin(origin);
    }
    
    if (isAllowed || config.origin === '*') {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    
    if (config.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    if (config.methods) {
      res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
    }
    
    if (config.allowedHeaders) {
      res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
    }
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    
    next();
  };
}

// JWT authentication plugin
export function createAuthPlugin(config: SecurityConfig['jwt']): Plugin {
  return {
    onContextBuilding({ context, extendContext }) {
      const request = context.request;
      const authHeader = request.headers.get('authorization');
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        
        try {
          const decoded = jwt.verify(token, config.secret, {
            algorithms: config.algorithms,
            issuer: config.issuer,
            audience: config.audience,
          }) as any;
          
          extendContext({
            userId: decoded.sub,
            userRoles: decoded.roles || [],
            tokenData: decoded,
          });
        } catch (error) {
          logger.warn('Invalid JWT token:', error);
          // Don't throw here - let resolvers handle authorization
        }
      }
    },
  };
}

// Query whitelisting plugin
export function createQueryWhitelistPlugin(
  config: SecurityConfig['queryWhitelisting']
): Plugin | null {
  if (!config?.enabled) return null;
  
  return {
    onParse({ params, setParsedDocument }) {
      const query = params.source.toString();
      const queryHash = crypto.createHash('sha256').update(query).digest('hex');
      
      if (!config.whitelist.has(queryHash)) {
        throw new Error('Query not whitelisted. Please use pre-approved queries only.');
      }
      
      // Optionally, you could cache the parsed document here
      const cachedDocument = config.whitelist.get(queryHash);
      if (cachedDocument) {
        // setParsedDocument(cachedDocument);
      }
    },
  };
}

// CSRF protection plugin
export function createCSRFPlugin(enabled: boolean): Plugin | null {
  if (!enabled) return null;
  
  return {
    onContextBuilding({ context }) {
      const request = context.request;
      
      // Skip CSRF for GET requests and GraphQL introspection
      if (request.method === 'GET') return;
      
      const csrfToken = request.headers.get('x-csrf-token');
      const cookie = request.headers.get('cookie');
      
      // Extract CSRF token from cookie
      const cookieToken = cookie
        ?.split(';')
        .find(c => c.trim().startsWith('csrf-token='))
        ?.split('=')[1];
      
      if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
        throw new Error('Invalid CSRF token');
      }
    },
  };
}

// Input validation and sanitization
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove potential XSS vectors
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  } else if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  } else if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
}

// Create security plugin stack
export function createSecurityPlugins(config: SecurityConfig = defaultSecurityConfig): Plugin[] {
  const plugins: Plugin[] = [];
  
  // Rate limiting
  plugins.push(
    useRateLimiter({
      identifyFn: config.rateLimit.identifier || ((context) => context.userId || 'anonymous'),
      window: config.rateLimit.window,
      max: config.rateLimit.max,
      onRateLimitError: (context, error) => {
        logger.warn(chalk.yellow(`Rate limit exceeded for ${error.userId}`));
        return new RateLimitError('Too many requests. Please try again later.');
      },
    })
  );
  
  // Depth limiting
  plugins.push(
    useDepthLimit({
      maxDepth: config.depthLimit,
    })
  );
  
  // Cost limiting
  plugins.push(
    useCostLimit({
      maxCost: config.costLimit.maxCost,
      scalarCost: config.costLimit.scalarCost || 1,
      objectCost: config.costLimit.objectCost || 2,
      listFactor: config.costLimit.listFactor || 10,
      introspectionCost: config.costLimit.maxCost * 10, // Make introspection expensive
      onCostLimitError: (context, cost) => {
        logger.warn(chalk.yellow(`Query cost limit exceeded: ${cost}`));
        return new Error('Query too complex. Please simplify your request.');
      },
    })
  );
  
  // Response caching
  plugins.push(
    useResponseCache({
      session: (context) => context.userId || 'anonymous',
      ttl: 60000, // 1 minute default
      ignoredTypes: ['Mutation', 'Subscription'],
    })
  );
  
  // Authentication
  plugins.push(createAuthPlugin(config.jwt));
  
  // Query whitelisting
  const whitelistPlugin = createQueryWhitelistPlugin(config.queryWhitelisting);
  if (whitelistPlugin) {
    plugins.push(whitelistPlugin);
  }
  
  // CSRF protection
  const csrfPlugin = createCSRFPlugin(config.csrfProtection);
  if (csrfPlugin) {
    plugins.push(csrfPlugin);
  }
  
  // Input sanitization
  plugins.push({
    onParse({ params }) {
      if (params.variables) {
        params.variables = sanitizeInput(params.variables);
      }
    },
  });
  
  // Disable introspection in production
  if (!config.introspection) {
    plugins.push({
      onExecute({ args }) {
        const query = args.document.definitions[0];
        if (
          query &&
          'name' in query &&
          (query.name?.value === '__schema' || query.name?.value === '__type')
        ) {
          throw new Error('GraphQL introspection is disabled');
        }
      },
    });
  }
  
  return plugins;
}

// Authorization helpers
export interface AuthorizationContext {
  userId?: string;
  userRoles?: string[];
  tokenData?: any;
}

export function requireAuth(context: AuthorizationContext, message = 'Authentication required') {
  if (!context.userId) {
    throw new Error(message);
  }
}

export function requireRole(
  context: AuthorizationContext, 
  requiredRole: string, 
  message = 'Insufficient permissions'
) {
  requireAuth(context);
  if (!context.userRoles?.includes(requiredRole)) {
    throw new Error(message);
  }
}

export function requireAnyRole(
  context: AuthorizationContext, 
  requiredRoles: string[], 
  message = 'Insufficient permissions'
) {
  requireAuth(context);
  if (!requiredRoles.some(role => context.userRoles?.includes(role))) {
    throw new Error(message);
  }
}

// Security audit logging
export interface SecurityAuditLog {
  timestamp: Date;
  type: 'auth_failure' | 'rate_limit' | 'intrusion_attempt' | 'suspicious_activity';
  userId?: string;
  ip?: string;
  details: any;
}

export class SecurityAuditor {
  private logs: SecurityAuditLog[] = [];
  
  log(event: Omit<SecurityAuditLog, 'timestamp'>) {
    const log: SecurityAuditLog = {
      ...event,
      timestamp: new Date(),
    };
    
    this.logs.push(log);
    
    // Log to console in development
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(chalk.red(`Security Event: ${event.type}`), event.details);
    }
    
    // In production, you'd send this to a security monitoring service
    if (process.env.SECURITY_WEBHOOK) {
      fetch(process.env.SECURITY_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      }).catch(error => {
        logger.error('Failed to send security audit log:', error);
      });
    }
  }
  
  getRecentLogs(minutes: number = 60): SecurityAuditLog[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.logs.filter(log => log.timestamp > cutoff);
  }
  
  detectAnomalies(): Array<{ type: string; severity: 'low' | 'medium' | 'high'; details: any }> {
    const anomalies = [];
    const recentLogs = this.getRecentLogs(5);
    
    // Check for repeated auth failures
    const authFailures = recentLogs.filter(log => log.type === 'auth_failure');
    const failuresByIp = new Map<string, number>();
    
    authFailures.forEach(log => {
      const ip = log.ip || 'unknown';
      failuresByIp.set(ip, (failuresByIp.get(ip) || 0) + 1);
    });
    
    failuresByIp.forEach((count, ip) => {
      if (count >= 5) {
        anomalies.push({
          type: 'brute_force_attempt',
          severity: 'high',
          details: { ip, attempts: count },
        });
      }
    });
    
    return anomalies;
  }
}

// Export singleton auditor
export const securityAuditor = new SecurityAuditor();