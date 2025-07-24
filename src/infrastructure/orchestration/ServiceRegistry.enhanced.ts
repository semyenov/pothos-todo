import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceRegistryEventMap } from '../core/InfrastructureEventMaps.js';
import { ServiceRegistryConfig, ServiceRegistryConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export interface ServiceDefinition {
  id: string;
  name: string;
  version: string;
  type: 'api' | 'worker' | 'gateway' | 'database' | 'cache' | 'queue';
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopping' | 'maintenance';
  endpoints: {
    health: string;
    metrics: string;
    api?: string;
    admin?: string;
  };
  network: {
    host: string;
    port: number;
    protocol: 'http' | 'https' | 'grpc' | 'tcp';
  };
  metadata: {
    region: string;
    zone: string;
    environment: string;
    tags: string[];
    dependencies: string[];
    capabilities: string[];
  };
  resources: {
    cpu: number;
    memory: number;
    disk: number;
    connections: number;
  };
  scaling: {
    minInstances: number;
    maxInstances: number;
    currentInstances: number;
    autoScale: boolean;
  };
  deployment: {
    strategy: 'rolling' | 'blue-green' | 'canary';
    rollbackOnFailure: boolean;
    healthCheckGracePeriod: number;
  };
  security: {
    authRequired: boolean;
    roles: string[];
    rateLimit: {
      requests: number;
      window: number;
    };
  };
}

export interface ServiceInstance {
  id: string;
  serviceId: string;
  host: string;
  port: number;
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopping';
  lastHeartbeat: Date;
  startTime: Date;
  metadata: Record<string, any>;
  metrics: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    cpuUsage: number;
    memoryUsage: number;
  };
}

export interface LoadBalancingStrategy {
  type: 'round-robin' | 'least-connections' | 'weighted' | 'random' | 'ip-hash';
  weights?: Map<string, number>;
  stickySession?: boolean;
}

const ServiceDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  type: z.enum(['api', 'worker', 'gateway', 'database', 'cache', 'queue']),
  endpoints: z.object({
    health: z.string().url(),
    metrics: z.string().url(),
    api: z.string().url().optional(),
    admin: z.string().url().optional(),
  }),
  network: z.object({
    host: z.string(),
    port: z.number().min(1).max(65535),
    protocol: z.enum(['http', 'https', 'grpc', 'tcp']),
  }),
  metadata: z.object({
    region: z.string(),
    zone: z.string(),
    environment: z.string(),
    tags: z.array(z.string()),
    dependencies: z.array(z.string()),
    capabilities: z.array(z.string()),
  }),
  resources: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
    connections: z.number(),
  }),
  scaling: z.object({
    minInstances: z.number(),
    maxInstances: z.number(),
    currentInstances: z.number(),
    autoScale: z.boolean(),
  }),
  deployment: z.object({
    strategy: z.enum(['rolling', 'blue-green', 'canary']),
    rollbackOnFailure: z.boolean(),
    healthCheckGracePeriod: z.number(),
  }),
  security: z.object({
    authRequired: z.boolean(),
    roles: z.array(z.string()),
    rateLimit: z.object({
      requests: z.number(),
      window: z.number(),
    }),
  }),
});

/**
 * Service Registry and Discovery System
 * Comprehensive microservices registry with health monitoring and load balancing
 * 
 * @example
 * ```typescript
 * const registry = await ServiceRegistry.getInstance();
 * 
 * // Register a service
 * const serviceId = await registry.registerService({
 *   name: 'user-api',
 *   version: '1.0.0',
 *   type: 'api',
 *   network: { host: 'localhost', port: 3001, protocol: 'http' },
 *   // ... other properties
 * });
 * 
 * // Discover services
 * const userApi = await registry.discoverService('user-api');
 * const instance = await registry.getHealthyInstance('user-api');
 * ```
 */
@ServiceConfig({
  schema: ServiceRegistryConfigSchema,
  prefix: 'service_registry',
  hot: true,
})
export class EnhancedServiceRegistry extends BaseAsyncService<ServiceRegistryConfig, ServiceRegistryEventMap> {
  private services: Map<string, ServiceDefinition> = new Map();
  private instances: Map<string, ServiceInstance[]> = new Map();
  private loadBalancers: Map<string, LoadBalancingStrategy> = new Map();
  private roundRobinIndexes: Map<string, number> = new Map();
  
  private circuitBreakers: Map<string, {
    failures: number;
    lastFailure: Date;
    state: 'closed' | 'open' | 'half-open';
    threshold: number;
    timeout: number;
  }> = new Map();

  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<EnhancedServiceRegistry> {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'service-registry';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Microservices registry with health monitoring and load balancing';
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('ServiceRegistry initializing', {
      registryType: this.config.registry.type,
      healthInterval: this.config.health.checkInterval,
      loadBalancing: this.config.loadBalancing.strategy,
    });
  }

  /**
   * Start the service registry
   */
  protected async onStart(): Promise<void> {
    // Start health checking
    this.startHealthChecking();
    
    // Start instance cleanup
    this.startInstanceCleanup();
    
    // Setup default services if needed
    await this.setupDefaultServices();

    logger.info('Service Registry started');
  }

  /**
   * Stop the service registry
   */
  protected async onStop(): Promise<void> {
    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    logger.info('Service Registry stopped');
  }

  /**
   * Check registry health
   */
  @HealthCheck({
    name: 'registry:health',
    critical: true,
    interval: 60000,
  })
  async checkRegistryHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const totalServices = this.services.size;
    const healthyServices = Array.from(this.services.values()).filter(s => s.status === 'healthy').length;
    
    if (totalServices === 0) {
      return { status: 'healthy', message: 'No services registered' };
    }

    const healthPercentage = (healthyServices / totalServices) * 100;

    if (healthPercentage === 100) {
      return { status: 'healthy', message: `All ${totalServices} services are healthy` };
    } else if (healthPercentage >= 80) {
      return { status: 'degraded', message: `${healthyServices}/${totalServices} services are healthy` };
    } else {
      return { status: 'unhealthy', message: `Only ${healthyServices}/${totalServices} services are healthy` };
    }
  }

  /**
   * Register a new service
   */
  @Metric({ name: 'registry.service.registered' })
  @Retry({ attempts: 3, delay: 1000 })
  async registerService(serviceData: Omit<ServiceDefinition, 'id' | 'status'>): Promise<string> {
    // Validate service data
    const validation = ServiceDefinitionSchema.safeParse(serviceData);
    if (!validation.success) {
      throw new Error(`Invalid service definition: ${validation.error.message}`);
    }

    const id = uuidv4();
    const service: ServiceDefinition = {
      ...serviceData,
      id,
      status: 'starting',
    };

    this.services.set(id, service);
    this.instances.set(id, []);

    // Set default load balancing strategy
    this.loadBalancers.set(id, {
      type: this.config.loadBalancing.strategy,
      stickySession: this.config.loadBalancing.stickySession,
    });

    this.emit('service:registered', {
      serviceId: id,
      name: service.name,
      host: service.network.host,
      port: service.network.port,
    });

    logger.info('Service registered', {
      serviceId: id,
      name: service.name,
      version: service.version,
    });

    // Perform initial health check
    await this.checkServiceHealth(id);

    return id;
  }

  /**
   * Deregister a service
   */
  @Metric({ name: 'registry.service.deregistered' })
  async deregisterService(serviceId: string, reason?: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    // Remove all instances
    this.instances.delete(serviceId);
    
    // Remove service
    this.services.delete(serviceId);
    
    // Remove load balancer
    this.loadBalancers.delete(serviceId);
    this.roundRobinIndexes.delete(serviceId);
    
    // Remove circuit breaker
    this.circuitBreakers.delete(serviceId);

    this.emit('service:deregistered', {
      serviceId,
      reason,
    });

    logger.info('Service deregistered', {
      serviceId,
      name: service.name,
      reason,
    });
  }

  /**
   * Register a service instance
   */
  @Metric({ name: 'registry.instance.registered' })
  async registerInstance(serviceId: string, instanceData: Omit<ServiceInstance, 'id' | 'serviceId' | 'startTime' | 'lastHeartbeat'>): Promise<string> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const instanceId = uuidv4();
    const instance: ServiceInstance = {
      ...instanceData,
      id: instanceId,
      serviceId,
      startTime: new Date(),
      lastHeartbeat: new Date(),
    };

    const instances = this.instances.get(serviceId) || [];
    instances.push(instance);
    this.instances.set(serviceId, instances);

    // Update service instance count
    service.scaling.currentInstances = instances.length;

    logger.info('Service instance registered', {
      serviceId,
      instanceId,
      host: instance.host,
      port: instance.port,
    });

    return instanceId;
  }

  /**
   * Update instance heartbeat
   */
  async updateHeartbeat(serviceId: string, instanceId: string, metrics?: Partial<ServiceInstance['metrics']>): Promise<void> {
    const instances = this.instances.get(serviceId);
    if (!instances) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const instance = instances.find(i => i.id === instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    instance.lastHeartbeat = new Date();
    
    if (metrics) {
      Object.assign(instance.metrics, metrics);
    }
  }

  /**
   * Discover a service by name
   */
  @Metric({ name: 'registry.service.discovered' })
  @CircuitBreaker({ threshold: 5, timeout: 30000 })
  async discoverService(serviceName: string): Promise<ServiceDefinition | null> {
    const services = Array.from(this.services.values());
    const service = services.find(s => s.name === serviceName && s.status === 'healthy');

    if (service) {
      this.emit('discovery:refresh', {
        services: 1,
        duration: 0,
      });
    }

    return service || null;
  }

  /**
   * Get a healthy instance using load balancing
   */
  @Metric({ name: 'registry.instance.selected' })
  async getHealthyInstance(serviceId: string): Promise<ServiceInstance | null> {
    const service = this.services.get(serviceId);
    if (!service || service.status !== 'healthy') {
      return null;
    }

    const instances = this.instances.get(serviceId) || [];
    const healthyInstances = instances.filter(i => i.status === 'healthy');

    if (healthyInstances.length === 0) {
      return null;
    }

    const strategy = this.loadBalancers.get(serviceId) || { type: 'round-robin' };
    const instance = this.selectInstance(serviceId, healthyInstances, strategy);

    if (instance) {
      this.emit('loadbalancer:selected', {
        serviceId: instance.id,
        strategy: strategy.type,
      });
    }

    return instance;
  }

  /**
   * Select instance based on load balancing strategy
   */
  private selectInstance(
    serviceId: string,
    instances: ServiceInstance[],
    strategy: LoadBalancingStrategy
  ): ServiceInstance | null {
    if (instances.length === 0) return null;

    switch (strategy.type) {
      case 'round-robin': {
        const index = this.roundRobinIndexes.get(serviceId) || 0;
        const instance = instances[index % instances.length];
        this.roundRobinIndexes.set(serviceId, index + 1);
        return instance;
      }

      case 'least-connections': {
        return instances.reduce((least, current) => 
          current.metrics.connections < least.metrics.connections ? current : least
        );
      }

      case 'weighted': {
        if (!strategy.weights) return instances[0];
        // Simplified weighted selection
        const weights = Array.from(strategy.weights.values());
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        const random = Math.random() * totalWeight;
        
        let accumulated = 0;
        for (let i = 0; i < instances.length; i++) {
          accumulated += weights[i] || 1;
          if (random < accumulated) return instances[i];
        }
        return instances[0];
      }

      case 'random':
        return instances[Math.floor(Math.random() * instances.length)];

      case 'ip-hash':
        // Simplified IP hash - in real implementation would hash client IP
        return instances[0];

      default:
        return instances[0];
    }
  }

  /**
   * Check service health
   */
  private async checkServiceHealth(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) return;

    try {
      const response = await fetch(service.endpoints.health, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.health.timeout),
      });

      const wasHealthy = service.status === 'healthy';
      service.status = response.ok ? 'healthy' : 'unhealthy';

      if (service.status !== wasHealthy) {
        this.emit('health:changed', {
          serviceId,
          from: wasHealthy ? 'healthy' : 'unhealthy',
          to: service.status,
          status: service.status === 'healthy' ? 'healthy' : 'unhealthy',
          checks: [{
            name: 'http-health',
            status: service.status === 'healthy' ? 'healthy' : 'unhealthy',
            message: `Health check ${response.ok ? 'passed' : 'failed'}`,
            timestamp: new Date(),
          }],
        });
      }

      this.emit('health:check', {
        serviceId,
        status: service.status === 'healthy' ? 'healthy' : 'unhealthy',
      });

      // Reset circuit breaker on success
      if (response.ok) {
        this.circuitBreakers.delete(serviceId);
      }

    } catch (error) {
      service.status = 'unhealthy';
      
      // Update circuit breaker
      const breaker = this.circuitBreakers.get(serviceId) || {
        failures: 0,
        lastFailure: new Date(),
        state: 'closed',
        threshold: 5,
        timeout: 60000,
      };

      breaker.failures++;
      breaker.lastFailure = new Date();

      if (breaker.failures >= breaker.threshold) {
        breaker.state = 'open';
      }

      this.circuitBreakers.set(serviceId, breaker);

      this.emit('health:timeout', {
        serviceId,
        timeout: this.config.health.timeout,
      });

      logger.error('Service health check failed', {
        serviceId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start health checking loop
   */
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      const checkPromises = Array.from(this.services.keys()).map(serviceId => 
        this.checkServiceHealth(serviceId).catch(error => {
          logger.error('Health check error', { serviceId, error });
        })
      );

      await Promise.all(checkPromises);
    }, this.config.health.checkInterval);
  }

  /**
   * Start instance cleanup loop
   */
  private startInstanceCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const deregisterAfter = this.config.discovery.deregisterCriticalAfter * 1000;

      for (const [serviceId, instances] of this.instances.entries()) {
        const activeInstances = instances.filter(instance => {
          const timeSinceHeartbeat = now - instance.lastHeartbeat.getTime();
          
          if (timeSinceHeartbeat > deregisterAfter) {
            logger.warn('Deregistering stale instance', {
              serviceId,
              instanceId: instance.id,
              lastHeartbeat: instance.lastHeartbeat,
            });
            return false;
          }

          if (timeSinceHeartbeat > this.config.health.unhealthyThreshold * this.config.health.checkInterval) {
            instance.status = 'unhealthy';
          }

          return true;
        });

        if (activeInstances.length !== instances.length) {
          this.instances.set(serviceId, activeInstances);
          
          const service = this.services.get(serviceId);
          if (service) {
            service.scaling.currentInstances = activeInstances.length;
          }
        }
      }
    }, this.config.health.checkInterval);
  }

  /**
   * Setup default services
   */
  private async setupDefaultServices(): Promise<void> {
    // In a real implementation, this would register core services
    // like API gateway, auth service, etc.
    logger.info('Default services setup completed');
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<{
    totalServices: number;
    healthyServices: number;
    totalInstances: number;
    healthyInstances: number;
    circuitBreakersOpen: number;
  }> {
    const services = Array.from(this.services.values());
    const allInstances = Array.from(this.instances.values()).flat();

    return {
      totalServices: services.length,
      healthyServices: services.filter(s => s.status === 'healthy').length,
      totalInstances: allInstances.length,
      healthyInstances: allInstances.filter(i => i.status === 'healthy').length,
      circuitBreakersOpen: Array.from(this.circuitBreakers.values()).filter(cb => cb.state === 'open').length,
    };
  }

  /**
   * Update service configuration
   */
  @Metric({ name: 'registry.service.updated' })
  async updateService(serviceId: string, updates: Partial<ServiceDefinition>): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    // Merge updates
    Object.assign(service, updates);

    this.emit('service:updated', {
      serviceId,
      updates,
    });

    logger.info('Service updated', {
      serviceId,
      updates: Object.keys(updates),
    });
  }
}