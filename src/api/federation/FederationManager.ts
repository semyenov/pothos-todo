import { GraphQLSchema, printSchema } from 'graphql';
import { logger } from '../../lib/unjs-utils.js';
import { MetricsCollector } from '../../infrastructure/monitoring/MetricsCollector.js';
import { HiveGatewayService } from '../../infrastructure/gateway/HiveGatewayService.js';
import type { DocumentNode } from 'graphql';

export interface ServiceDefinition {
  name: string;
  url: string;
  schema?: GraphQLSchema;
  typeDefs?: DocumentNode;
  resolvers?: any;
  healthCheckEndpoint?: string;
  version: string;
  metadata?: Record<string, any>;
}

export interface FederationConfig {
  services: ServiceDefinition[];
  gateway: {
    port: number;
    introspectionEnabled: boolean;
    playgroundEnabled: boolean;
    subscriptions?: {
      enabled: boolean;
      transport: 'ws' | 'sse';
    };
  };
  monitoring: {
    enableTracing: boolean;
    enableMetrics: boolean;
    logQueries: boolean;
  };
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  lastCheck: Date;
  version: string;
  errorRate: number;
}

export class FederationManager {
  private static instance: FederationManager;
  private services = new Map<string, ServiceDefinition>();
  private serviceHealth = new Map<string, ServiceHealth>();
  private metrics: MetricsCollector;
  private healthCheckInterval?: NodeJS.Timeout;
  private config?: FederationConfig;

  private constructor() {
    this.metrics = MetricsCollector.getInstance();
  }

  public static getInstance(): FederationManager {
    if (!FederationManager.instance) {
      FederationManager.instance = new FederationManager();
    }
    return FederationManager.instance;
  }

  /**
   * Initialize federation with configuration
   */
  public async initialize(config: FederationConfig): Promise<void> {
    this.config = config;

    // Register services
    for (const service of config.services) {
      await this.registerService(service);
    }

    // Start health monitoring
    this.startHealthMonitoring();

    logger.info('Federation manager initialized', {
      services: config.services.length,
      gateway: config.gateway,
    });
  }

  /**
   * Register a microservice
   */
  public async registerService(service: ServiceDefinition): Promise<void> {
    try {
      // Validate service schema if provided
      if (service.schema || service.typeDefs) {
        await this.validateServiceSchema(service);
      }

      // Store service definition
      this.services.set(service.name, service);

      // Initialize health status
      this.serviceHealth.set(service.name, {
        name: service.name,
        status: 'healthy',
        latency: 0,
        lastCheck: new Date(),
        version: service.version,
        errorRate: 0,
      });

      // Perform initial health check
      await this.checkServiceHealth(service.name);

      logger.info('Service registered', {
        name: service.name,
        url: service.url,
        version: service.version,
      });

      this.metrics.recordMetric('federation.service.registered', 1, {
        serviceName: service.name,
        version: service.version,
      });

    } catch (error) {
      logger.error('Failed to register service', error as Error, {
        serviceName: service.name,
      });
      throw error;
    }
  }

  /**
   * Unregister a microservice
   */
  public async unregisterService(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`);
    }

    this.services.delete(serviceName);
    this.serviceHealth.delete(serviceName);

    logger.info('Service unregistered', { serviceName });

    this.metrics.recordMetric('federation.service.unregistered', 1, {
      serviceName,
    });
  }

  /**
   * Build federated schema
   */
  public async buildFederatedSchema(): Promise<GraphQLSchema> {
    const subgraphs: Array<{ name: string; typeDefs: DocumentNode; resolvers?: any }> = [];

    for (const [name, service] of this.services.entries()) {
      if (service.typeDefs) {
        subgraphs.push({
          name,
          typeDefs: service.typeDefs,
          resolvers: service.resolvers,
        });
      }
    }

    if (subgraphs.length === 0) {
      throw new Error('No subgraphs available to build federated schema');
    }

    try {
      // In a real implementation, you would use Apollo Federation's buildSupergraphSchema
      // For now, we'll create a simple combined schema
      const federatedSchema = await this.createCombinedSchema(subgraphs);

      logger.info('Federated schema built successfully', {
        subgraphs: subgraphs.length,
      });

      return federatedSchema;

    } catch (error) {
      logger.error('Failed to build federated schema', error as Error);
      throw error;
    }
  }

  /**
   * Get service health status
   */
  public getServiceHealth(serviceName?: string): ServiceHealth | ServiceHealth[] {
    if (serviceName) {
      const health = this.serviceHealth.get(serviceName);
      if (!health) {
        throw new Error(`Service '${serviceName}' not found`);
      }
      return health;
    }

    return Array.from(this.serviceHealth.values());
  }

  /**
   * Get federation metrics
   */
  public async getFederationMetrics(): Promise<{
    totalServices: number;
    healthyServices: number;
    degradedServices: number;
    unhealthyServices: number;
    averageLatency: number;
    totalRequests: number;
    errorRate: number;
  }> {
    const allHealth = Array.from(this.serviceHealth.values());
    
    const totalServices = allHealth.length;
    const healthyServices = allHealth.filter(h => h.status === 'healthy').length;
    const degradedServices = allHealth.filter(h => h.status === 'degraded').length;
    const unhealthyServices = allHealth.filter(h => h.status === 'unhealthy').length;
    
    const averageLatency = totalServices > 0 ? 
      allHealth.reduce((sum, h) => sum + h.latency, 0) / totalServices : 0;
    
    const allMetrics = await this.metrics.getMetrics(Date.now() - 3600000, Date.now());
    const totalRequests = allMetrics.find(m => m.name === 'federation.request.total')?.value || 0;
    const totalErrors = allMetrics.find(m => m.name === 'federation.request.error')?.value || 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    return {
      totalServices,
      healthyServices,
      degradedServices,
      unhealthyServices,
      averageLatency,
      totalRequests,
      errorRate,
    };
  }

  /**
   * Route query to appropriate service
   */
  public async routeQuery(
    query: string,
    variables?: Record<string, any>,
    context?: any
  ): Promise<{
    serviceName: string;
    result: any;
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      // Analyze query to determine target service
      const targetService = await this.analyzeQueryTarget(query);
      
      if (!targetService) {
        throw new Error('Unable to determine target service for query');
      }

      // Check service health
      const health = this.serviceHealth.get(targetService);
      if (!health || health.status === 'unhealthy') {
        throw new Error(`Service '${targetService}' is unhealthy`);
      }

      // Execute query against target service
      const result = await this.executeQueryOnService(targetService, query, variables, context);
      
      const duration = Date.now() - startTime;

      // Record metrics
      this.metrics.recordMetric('federation.query.success', 1, {
        serviceName: targetService,
        duration: duration.toString(),
      });

      return {
        serviceName: targetService,
        result,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Query routing failed', error as Error, {
        query: query.substring(0, 200),
        duration: duration.toString(),
      });

      this.metrics.recordMetric('federation.query.error', 1, {
        duration: duration.toString(),
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Validate service schema
   */
  private async validateServiceSchema(service: ServiceDefinition): Promise<void> {
    try {
      if (service.schema) {
        // Validate GraphQL schema
        printSchema(service.schema);
      }

      if (service.typeDefs && service.resolvers) {
        // TODO: Add proper schema validation when federation is fully implemented
        // const { buildSubgraphSchema } = await import('@apollo/subgraph');
        // buildSubgraphSchema([{
        //   typeDefs: service.typeDefs,
        //   resolvers: service.resolvers,
        // }]);
        logger.debug('Schema validation skipped - federation in development mode');
      }

      logger.debug('Service schema validated', { serviceName: service.name });

    } catch (error) {
      logger.error('Service schema validation failed', error as Error, {
        serviceName: service.name,
      });
      throw new Error(`Invalid schema for service '${service.name}': ${(error as Error).message}`);
    }
  }

  /**
   * Check health of a specific service
   */
  private async checkServiceHealth(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName);
    if (!service) return;

    const health = this.serviceHealth.get(serviceName)!;
    const startTime = Date.now();

    try {
      // Perform health check (simplified)
      const healthEndpoint = service.healthCheckEndpoint || `${service.url}/health`;
      
      // In a real implementation, you would make an HTTP request
      // For now, we'll simulate the health check
      const isHealthy = await this.simulateHealthCheck(service);
      
      const latency = Date.now() - startTime;

      // Update health status
      health.status = isHealthy ? 'healthy' : 'unhealthy';
      health.latency = latency;
      health.lastCheck = new Date();

      // Update error rate (simplified exponential moving average)
      if (!isHealthy) {
        health.errorRate = health.errorRate * 0.9 + 10; // Increase error rate
      } else {
        health.errorRate = health.errorRate * 0.9; // Decrease error rate
      }

      // Determine degradation
      if (health.errorRate > 5 && health.errorRate <= 20) {
        health.status = 'degraded';
      }

      this.metrics.recordMetric('federation.health_check', 1, {
        serviceName,
        status: health.status,
        latency: latency.toString(),
      });

    } catch (error) {
      health.status = 'unhealthy';
      health.lastCheck = new Date();
      health.errorRate = Math.min(100, health.errorRate + 20);

      logger.error('Service health check failed', error as Error, {
        serviceName,
      });
    }
  }

  /**
   * Start health monitoring for all services
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      const promises = Array.from(this.services.keys()).map(serviceName =>
        this.checkServiceHealth(serviceName)
      );

      await Promise.allSettled(promises);

      // Log overall health status
      const metrics = await this.getFederationMetrics();
      logger.debug('Federation health check completed', metrics);

    }, 30000); // Check every 30 seconds
  }

  /**
   * Create combined schema from subgraphs
   */
  private async createCombinedSchema(subgraphs: Array<{
    name: string;
    typeDefs: DocumentNode;
    resolvers?: any;
  }>): Promise<GraphQLSchema> {
    // In a real implementation, this would use Apollo Federation composition
    // For now, return a placeholder schema
    
    const { buildSchema } = await import('graphql');
    
    // Create a simple combined schema
    const combinedTypeDefs = `
      type Query {
        _service: _Service
        _entities(representations: [_Any!]!): [_Entity]!
      }
      
      type _Service {
        sdl: String
      }
      
      scalar _Any
      union _Entity
    `;

    return buildSchema(combinedTypeDefs);
  }

  /**
   * Analyze query to determine target service
   */
  private async analyzeQueryTarget(query: string): Promise<string | null> {
    // Simple query analysis - in production, use proper GraphQL parsing
    if (query.includes('user') || query.includes('User')) {
      return 'user-service';
    }
    
    if (query.includes('todo') || query.includes('Todo')) {
      return 'todo-service';
    }
    
    if (query.includes('ai') || query.includes('search')) {
      return 'ai-service';
    }

    // Default to the first available service
    const firstService = Array.from(this.services.keys())[0];
    return firstService || null;
  }

  /**
   * Execute query on specific service
   */
  private async executeQueryOnService(
    serviceName: string,
    query: string,
    variables?: Record<string, any>,
    context?: any
  ): Promise<any> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`);
    }

    // In a real implementation, you would:
    // 1. Make HTTP request to service endpoint
    // 2. Handle authentication/authorization
    // 3. Parse and return response
    
    // For now, return a mock response
    return {
      data: {
        mock: true,
        service: serviceName,
        query: query.substring(0, 100),
      },
    };
  }

  /**
   * Simulate health check
   */
  private async simulateHealthCheck(service: ServiceDefinition): Promise<boolean> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    // Simulate 95% uptime
    return Math.random() > 0.05;
  }

  /**
   * Shutdown federation manager
   */
  public shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.services.clear();
    this.serviceHealth.clear();

    logger.info('Federation manager shutdown completed');
  }
}

/**
 * Create federation middleware
 */
export function createFederationMiddleware(config: FederationConfig) {
  const federationManager = FederationManager.getInstance();
  
  return async (context: any) => {
    // Initialize federation if not already done
    if (!federationManager['config']) {
      await federationManager.initialize(config);
    }

    // Add federation context
    context.federation = {
      manager: federationManager,
      routeQuery: federationManager.routeQuery.bind(federationManager),
      getHealth: federationManager.getServiceHealth.bind(federationManager),
    };
  };
}

/**
 * Default federation configuration
 */
export const defaultFederationConfig: FederationConfig = {
  services: [
    {
      name: 'user-service',
      url: 'http://localhost:4001/graphql',
      version: '1.0.0',
      healthCheckEndpoint: 'http://localhost:4001/health',
    },
    {
      name: 'todo-service',
      url: 'http://localhost:4002/graphql',
      version: '1.0.0',
      healthCheckEndpoint: 'http://localhost:4002/health',
    },
    {
      name: 'ai-service',
      url: 'http://localhost:4003/graphql',
      version: '1.0.0',
      healthCheckEndpoint: 'http://localhost:4003/health',
    },
  ],
  gateway: {
    port: 4000,
    introspectionEnabled: true,
    playgroundEnabled: true,
    subscriptions: {
      enabled: true,
      transport: 'ws',
    },
  },
  monitoring: {
    enableTracing: true,
    enableMetrics: true,
    logQueries: true,
  },
};