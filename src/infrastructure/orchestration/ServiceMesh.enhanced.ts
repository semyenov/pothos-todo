import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceMeshEventMap } from '../core/InfrastructureEventMaps.js';
import { ServiceMeshConfig, ServiceMeshConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { v4 as uuidv4 } from 'uuid';
import { EnhancedServiceRegistry } from './ServiceRegistry.enhanced.js';
import { EnhancedMessageBroker } from './MessageBroker.enhanced.js';

export interface TrafficRule {
  id: string;
  name: string;
  source: {
    service?: string;
    version?: string;
    labels?: Record<string, string>;
  };
  destination: {
    service: string;
    subset?: string;
  };
  match: {
    headers?: Record<string, string>;
    uri?: {
      exact?: string;
      prefix?: string;
      regex?: string;
    };
    method?: string[];
  };
  route: {
    destination: string;
    weight?: number;
    subset?: string;
  }[];
  fault?: {
    delay?: {
      percentage: number;
      fixedDelay: number;
    };
    abort?: {
      percentage: number;
      httpStatus: number;
    };
  };
  timeout?: number;
  retries?: {
    attempts: number;
    perTryTimeout: number;
  };
}

export interface SecurityPolicy {
  id: string;
  name: string;
  namespace: string;
  selector: {
    matchLabels: Record<string, string>;
  };
  rules: {
    from?: {
      source: {
        principals?: string[];
        requestPrincipals?: string[];
        namespaces?: string[];
      };
    }[];
    to?: {
      operation: {
        methods?: string[];
        paths?: string[];
      };
    }[];
  }[];
  action: 'ALLOW' | 'DENY';
}

export interface ServiceProxy {
  serviceId: string;
  upstreamUrl: string;
  downstreamUrl: string;
  middleware: ProxyMiddleware[];
  metrics: {
    requestCount: number;
    errorCount: number;
    avgLatency: number;
    p95Latency: number;
    p99Latency: number;
  };
}

export interface ProxyMiddleware {
  name: string;
  order: number;
  config: any;
  handler: (request: any, response: any, next: () => void) => Promise<void>;
}

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure?: Date;
  successCount: number;
  nextHalfOpenTime?: Date;
}

/**
 * Service Mesh Implementation
 * Advanced service-to-service communication with traffic management, security, and observability
 * 
 * @example
 * ```typescript
 * const mesh = await ServiceMesh.getInstance();
 * 
 * // Create traffic rules
 * await mesh.createTrafficRule({
 *   name: 'canary-deployment',
 *   source: { service: 'frontend' },
 *   destination: { service: 'backend' },
 *   route: [
 *     { destination: 'backend-v1', weight: 90 },
 *     { destination: 'backend-v2', weight: 10 }
 *   ]
 * });
 * 
 * // Apply security policy
 * await mesh.createSecurityPolicy({
 *   name: 'frontend-to-backend',
 *   selector: { matchLabels: { app: 'backend' } },
 *   rules: [{
 *     from: [{ source: { principals: ['frontend'] } }],
 *     to: [{ operation: { methods: ['GET', 'POST'] } }]
 *   }],
 *   action: 'ALLOW'
 * });
 * ```
 */
@ServiceConfig({
  schema: ServiceMeshConfigSchema,
  prefix: 'service_mesh',
  hot: true,
})
export class EnhancedServiceMesh extends BaseAsyncService<ServiceMeshConfig, ServiceMeshEventMap> {
  private trafficRules: Map<string, TrafficRule> = new Map();
  private securityPolicies: Map<string, SecurityPolicy> = new Map();
  private proxies: Map<string, ServiceProxy> = new Map();
  private middleware: Map<string, ProxyMiddleware> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  
  // Rate limiting
  private rateLimiters: Map<string, { requests: number; resetTime: number }> = new Map();
  
  // Dependencies
  private serviceRegistry?: EnhancedServiceRegistry;
  private messageBroker?: EnhancedMessageBroker;

  // Request tracking
  private activeRequests: Map<string, { startTime: Date; traceId: string }> = new Map();

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<EnhancedServiceMesh> {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'service-mesh';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Service mesh for advanced microservices communication';
  }

  protected getServiceDependencies(): string[] {
    return ['service-registry', 'message-broker'];
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('ServiceMesh initializing', {
      proxy: this.config.proxy.type,
      mtls: this.config.security.mtls,
      observability: this.config.observability,
    });

    // Initialize dependencies
    this.serviceRegistry = await EnhancedServiceRegistry.getInstance();
    this.messageBroker = await EnhancedMessageBroker.getInstance();

    // Setup default middleware
    this.setupDefaultMiddleware();
  }

  /**
   * Start the service mesh
   */
  protected async onStart(): Promise<void> {
    // Start request tracking
    this.startRequestTracking();

    logger.info('Service Mesh started', {
      traffic: this.config.traffic,
      security: this.config.security,
    });
  }

  /**
   * Stop the service mesh
   */
  protected async onStop(): Promise<void> {
    // Clear active requests
    this.activeRequests.clear();
    
    logger.info('Service Mesh stopped');
  }

  /**
   * Check mesh health
   */
  @HealthCheck({
    name: 'mesh:health',
    critical: true,
    interval: 30000,
  })
  async checkMeshHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const openBreakers = Array.from(this.circuitBreakers.values()).filter(cb => cb.state === 'open').length;
    const totalBreakers = this.circuitBreakers.size;

    if (openBreakers === 0) {
      return { status: 'healthy', message: 'All circuit breakers closed' };
    } else if (openBreakers < totalBreakers * 0.3) {
      return { 
        status: 'degraded', 
        message: `${openBreakers}/${totalBreakers} circuit breakers open` 
      };
    } else {
      return { 
        status: 'unhealthy', 
        message: `Too many circuit breakers open: ${openBreakers}/${totalBreakers}` 
      };
    }
  }

  /**
   * Create a traffic rule
   */
  @Metric({ name: 'mesh.traffic.rule.created' })
  async createTrafficRule(rule: Omit<TrafficRule, 'id'>): Promise<string> {
    const id = uuidv4();
    const fullRule: TrafficRule = { ...rule, id };

    this.trafficRules.set(id, fullRule);

    logger.info('Traffic rule created', {
      ruleId: id,
      name: rule.name,
      destination: rule.destination.service,
    });

    return id;
  }

  /**
   * Create a security policy
   */
  @Metric({ name: 'mesh.security.policy.created' })
  async createSecurityPolicy(policy: Omit<SecurityPolicy, 'id'>): Promise<string> {
    const id = uuidv4();
    const fullPolicy: SecurityPolicy = { ...policy, id };

    this.securityPolicies.set(id, fullPolicy);

    logger.info('Security policy created', {
      policyId: id,
      name: policy.name,
      action: policy.action,
    });

    return id;
  }

  /**
   * Route a request through the mesh
   */
  @Metric({ name: 'mesh.request.routed', recordDuration: true })
  @CircuitBreaker({ threshold: 5, timeout: 30000 })
  @Retry({ attempts: 3, delay: 1000, backoff: 'exponential' })
  async routeRequest(
    from: string,
    to: string,
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: any
  ): Promise<any> {
    const traceId = uuidv4();
    const spanId = uuidv4();

    // Emit trace start
    this.emit('trace:started', {
      traceId,
      spanId,
      operation: `${method} ${path}`,
    });

    // Track request
    this.activeRequests.set(traceId, {
      startTime: new Date(),
      traceId,
    });

    try {
      // Check security policies
      const allowed = await this.checkSecurityPolicies(from, to, method, path);
      if (!allowed) {
        this.emit('security:denied', {
          principal: from,
          resource: to,
          reason: 'Policy denied',
        });
        throw new Error('Access denied by security policy');
      }

      // Apply traffic rules
      const destination = await this.applyTrafficRules(from, to, method, path, headers);

      // Check circuit breaker
      const breaker = this.getCircuitBreaker(destination);
      if (breaker.state === 'open') {
        if (!this.shouldAttemptHalfOpen(breaker)) {
          throw new Error('Circuit breaker is open');
        }
        breaker.state = 'half-open';
        breaker.successCount = 0;
      }

      // Route through middleware
      const response = await this.executeWithMiddleware(
        from,
        destination,
        method,
        path,
        headers,
        body
      );

      // Update circuit breaker on success
      this.recordSuccess(destination);

      // Emit traffic routed event
      this.emit('traffic:routed', {
        from,
        to: destination,
        method,
        path,
      });

      return response;

    } catch (error) {
      // Update circuit breaker on failure
      this.recordFailure(to);

      // Check for retry
      const retryConfig = this.config.traffic.retries;
      if (retryConfig && retryConfig.attempts > 0) {
        this.emit('traffic:retry', {
          target: to,
          attempt: 1,
          maxAttempts: retryConfig.attempts,
        });
      }

      throw error;

    } finally {
      // Complete trace
      const request = this.activeRequests.get(traceId);
      if (request) {
        const duration = Date.now() - request.startTime.getTime();
        this.emit('trace:completed', {
          traceId,
          duration,
        });
        this.activeRequests.delete(traceId);
      }
    }
  }

  /**
   * Check security policies
   */
  private async checkSecurityPolicies(
    from: string,
    to: string,
    method: string,
    path: string
  ): Promise<boolean> {
    if (!this.config.security.rbac) {
      return true;
    }

    const policies = Array.from(this.securityPolicies.values());
    
    // Find applicable policies
    const applicablePolicies = policies.filter(policy => {
      // Check if policy applies to destination
      const labels = { service: to };
      return Object.entries(policy.selector.matchLabels).every(
        ([key, value]) => labels[key as keyof typeof labels] === value
      );
    });

    // If no policies, default to allow
    if (applicablePolicies.length === 0) {
      return true;
    }

    // Check each policy
    for (const policy of applicablePolicies) {
      const allowed = this.evaluatePolicy(policy, from, method, path);
      
      if (policy.action === 'DENY' && allowed) {
        return false;
      }
      
      if (policy.action === 'ALLOW' && allowed) {
        this.emit('security:authorized', {
          principal: from,
          resource: to,
          action: method,
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate a single policy
   */
  private evaluatePolicy(
    policy: SecurityPolicy,
    from: string,
    method: string,
    path: string
  ): boolean {
    for (const rule of policy.rules) {
      // Check source
      if (rule.from) {
        const fromMatches = rule.from.some(f => 
          f.source.principals?.includes(from) ?? true
        );
        if (!fromMatches) continue;
      }

      // Check operation
      if (rule.to) {
        const toMatches = rule.to.some(t => {
          const methodMatch = !t.operation.methods || t.operation.methods.includes(method);
          const pathMatch = !t.operation.paths || t.operation.paths.some(p => path.startsWith(p));
          return methodMatch && pathMatch;
        });
        if (!toMatches) continue;
      }

      return true;
    }

    return false;
  }

  /**
   * Apply traffic rules
   */
  private async applyTrafficRules(
    from: string,
    to: string,
    method: string,
    path: string,
    headers?: Record<string, string>
  ): Promise<string> {
    const rules = Array.from(this.trafficRules.values());
    
    // Find matching rules
    const matchingRules = rules.filter(rule => {
      // Check destination
      if (rule.destination.service !== to) return false;

      // Check source
      if (rule.source.service && rule.source.service !== from) return false;

      // Check match conditions
      if (rule.match.method && !rule.match.method.includes(method)) return false;
      
      if (rule.match.uri) {
        const { exact, prefix, regex } = rule.match.uri;
        if (exact && path !== exact) return false;
        if (prefix && !path.startsWith(prefix)) return false;
        if (regex && !new RegExp(regex).test(path)) return false;
      }

      if (rule.match.headers && headers) {
        const headersMatch = Object.entries(rule.match.headers).every(
          ([key, value]) => headers[key] === value
        );
        if (!headersMatch) return false;
      }

      return true;
    });

    if (matchingRules.length === 0) {
      return to;
    }

    // Apply the first matching rule (in real implementation, would handle priorities)
    const rule = matchingRules[0];

    // Handle weighted routing
    if (rule.route.length > 1) {
      const totalWeight = rule.route.reduce((sum, r) => sum + (r.weight || 1), 0);
      const random = Math.random() * totalWeight;
      
      let accumulated = 0;
      for (const route of rule.route) {
        accumulated += route.weight || 1;
        if (random < accumulated) {
          return route.destination;
        }
      }
    }

    return rule.route[0]?.destination || to;
  }

  /**
   * Execute request with middleware
   */
  private async executeWithMiddleware(
    from: string,
    to: string,
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: any
  ): Promise<any> {
    // Get service details from registry
    const service = await this.serviceRegistry?.discoverService(to);
    if (!service) {
      throw new Error(`Service ${to} not found`);
    }

    // Build middleware chain
    const middlewares = Array.from(this.middleware.values())
      .sort((a, b) => a.order - b.order);

    // Create request context
    const context = {
      from,
      to,
      method,
      path,
      headers: headers || {},
      body,
      service,
    };

    // Execute middleware chain
    let index = 0;
    const next = async (): Promise<any> => {
      if (index >= middlewares.length) {
        // Make actual request
        return this.makeRequest(context);
      }

      const middleware = middlewares[index++];
      return middleware.handler(context, {}, next);
    };

    return next();
  }

  /**
   * Make the actual request
   */
  private async makeRequest(context: any): Promise<any> {
    const { service, method, path, headers, body } = context;
    const url = `${service.network.protocol}://${service.network.host}:${service.network.port}${path}`;

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.traffic.timeout || 30000),
      });

      const duration = Date.now() - startTime;

      // Update metrics
      this.recordMetric('mesh.request.duration', duration, {
        service: service.name,
        method,
        status: response.status.toString(),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response.json();

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.emit('traffic:timeout', {
          target: service.name,
          duration: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  /**
   * Get or create circuit breaker for a service
   */
  private getCircuitBreaker(service: string): CircuitBreakerState {
    let breaker = this.circuitBreakers.get(service);
    
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        successCount: 0,
      };
      this.circuitBreakers.set(service, breaker);
    }

    return breaker;
  }

  /**
   * Record successful request
   */
  private recordSuccess(service: string): void {
    const breaker = this.getCircuitBreaker(service);
    
    if (breaker.state === 'half-open') {
      breaker.successCount++;
      
      if (breaker.successCount >= 3) {
        breaker.state = 'closed';
        breaker.failures = 0;
        breaker.successCount = 0;
        
        this.emit('circuit:close', {
          service,
          successCount: breaker.successCount,
        });
      }
    } else if (breaker.state === 'closed') {
      // Reset failure count on success
      breaker.failures = 0;
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(service: string): void {
    const breaker = this.getCircuitBreaker(service);
    
    breaker.failures++;
    breaker.lastFailure = new Date();

    if (breaker.state === 'half-open') {
      breaker.state = 'open';
      breaker.nextHalfOpenTime = new Date(Date.now() + this.config.traffic.circuitBreaker.resetTimeout);
      
      this.emit('circuit:open', {
        service,
        failures: breaker.failures,
        threshold: this.config.traffic.circuitBreaker.failureThreshold,
      });
    } else if (
      breaker.state === 'closed' && 
      breaker.failures >= this.config.traffic.circuitBreaker.failureThreshold
    ) {
      breaker.state = 'open';
      breaker.nextHalfOpenTime = new Date(Date.now() + this.config.traffic.circuitBreaker.resetTimeout);
      
      this.emit('circuit:open', {
        service,
        failures: breaker.failures,
        threshold: this.config.traffic.circuitBreaker.failureThreshold,
      });
    }
  }

  /**
   * Check if should attempt half-open
   */
  private shouldAttemptHalfOpen(breaker: CircuitBreakerState): boolean {
    if (!breaker.nextHalfOpenTime) return false;
    return new Date() >= breaker.nextHalfOpenTime;
  }

  /**
   * Setup default middleware
   */
  private setupDefaultMiddleware(): void {
    // Authentication middleware
    if (this.config.security.mtls) {
      this.registerMiddleware({
        name: 'mtls-auth',
        order: 10,
        config: {},
        handler: async (req, res, next) => {
          // mTLS validation would go here
          this.emit('security:authenticated', {
            method: 'mtls',
            principal: req.from,
          });
          return next();
        },
      });
    }

    // Rate limiting middleware
    this.registerMiddleware({
      name: 'rate-limiter',
      order: 20,
      config: { window: 60000, limit: 100 },
      handler: async (req, res, next) => {
        const key = `${req.from}:${req.to}`;
        const limiter = this.rateLimiters.get(key) || { requests: 0, resetTime: Date.now() + 60000 };

        if (Date.now() > limiter.resetTime) {
          limiter.requests = 0;
          limiter.resetTime = Date.now() + 60000;
        }

        limiter.requests++;

        if (limiter.requests > 100) {
          throw new Error('Rate limit exceeded');
        }

        this.rateLimiters.set(key, limiter);
        return next();
      },
    });

    // Metrics middleware
    if (this.config.observability.metrics) {
      this.registerMiddleware({
        name: 'metrics',
        order: 30,
        config: {},
        handler: async (req, res, next) => {
          const start = Date.now();
          try {
            const result = await next();
            this.recordMetric('mesh.request.success', 1, {
              from: req.from,
              to: req.to,
              method: req.method,
            });
            return result;
          } catch (error) {
            this.recordMetric('mesh.request.error', 1, {
              from: req.from,
              to: req.to,
              method: req.method,
            });
            throw error;
          }
        },
      });
    }
  }

  /**
   * Register a middleware
   */
  registerMiddleware(middleware: ProxyMiddleware): void {
    this.middleware.set(middleware.name, middleware);
    
    logger.info('Middleware registered', {
      name: middleware.name,
      order: middleware.order,
    });
  }

  /**
   * Start request tracking
   */
  private startRequestTracking(): void {
    // Clean up old requests periodically
    setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [traceId, request] of this.activeRequests.entries()) {
        if (now - request.startTime.getTime() > timeout) {
          this.activeRequests.delete(traceId);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Get mesh statistics
   */
  async getStats(): Promise<{
    trafficRules: number;
    securityPolicies: number;
    activeRequests: number;
    circuitBreakers: {
      total: number;
      open: number;
      halfOpen: number;
      closed: number;
    };
  }> {
    const breakers = Array.from(this.circuitBreakers.values());

    return {
      trafficRules: this.trafficRules.size,
      securityPolicies: this.securityPolicies.size,
      activeRequests: this.activeRequests.size,
      circuitBreakers: {
        total: breakers.length,
        open: breakers.filter(b => b.state === 'open').length,
        halfOpen: breakers.filter(b => b.state === 'half-open').length,
        closed: breakers.filter(b => b.state === 'closed').length,
      },
    };
  }
}