import { BaseService, BaseAsyncService } from './BaseService.js';
import { ServiceDependencyGraph, ServiceDefinition } from './ServiceDependencyGraph.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';
import type { HealthCheckResult, HealthStatus } from './BaseService.js';

export interface ServiceMetadata {
  name: string;
  version: string;
  description: string;
  status: 'registered' | 'initializing' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  health: HealthStatus;
  capabilities: string[];
  dependencies: {
    required: string[];
    optional: string[];
    satisfied: boolean;
  };
  lifecycle: {
    registeredAt: Date;
    lastStarted?: Date;
    lastStopped?: Date;
    lastHealthCheck?: Date;
    uptime: number; // milliseconds
  };
  resources: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };
  endpoints?: Record<string, string>;
  configuration?: Record<string, any>;
}

export interface ServiceAvailability {
  available: boolean;
  reason?: string;
  lastAvailable?: Date;
  downtime: number; // milliseconds
}

interface RegistryEventMap {
  'service:registered': {
    name: string;
    metadata: ServiceMetadata;
  };
  'service:deregistered': {
    name: string;
    reason: string;
  };
  'service:status-changed': {
    name: string;
    from: ServiceMetadata['status'];
    to: ServiceMetadata['status'];
  };
  'service:health-changed': {
    name: string;
    from: HealthStatus;
    to: HealthStatus;
    checks: HealthCheckResult[];
  };
  'dependencies:satisfied': {
    name: string;
    dependencies: string[];
  };
  'dependencies:unsatisfied': {
    name: string;
    missing: string[];
  };
  'capability:available': {
    capability: string;
    services: string[];
  };
  'capability:unavailable': {
    capability: string;
  };
  'registry:health-check': {
    timestamp: Date;
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
    };
  };
}

/**
 * Enhanced Service Registry with lifecycle management, dependency tracking, and capability discovery
 * Provides comprehensive service management beyond basic registration
 */
export class EnhancedServiceRegistry extends TypedEventEmitter<RegistryEventMap> {
  private static instance: EnhancedServiceRegistry;
  
  private services: Map<string, BaseService<any, any> | BaseAsyncService<any, any>> = new Map();
  private metadata: Map<string, ServiceMetadata> = new Map();
  private availability: Map<string, ServiceAvailability> = new Map();
  private dependencyGraph: ServiceDependencyGraph;
  private healthCheckInterval?: NodeJS.Timeout;
  private capabilityIndex: Map<string, Set<string>> = new Map(); // capability -> services
  
  private constructor() {
    super();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.setupDependencyGraphListeners();
  }

  static getInstance(): EnhancedServiceRegistry {
    if (!EnhancedServiceRegistry.instance) {
      EnhancedServiceRegistry.instance = new EnhancedServiceRegistry();
    }
    return EnhancedServiceRegistry.instance;
  }

  /**
   * Register a service with enhanced metadata
   */
  register(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    definition?: Partial<ServiceDefinition>
  ): void {
    const name = service.metadata.name;
    
    if (this.services.has(name)) {
      logger.warn(`Service ${name} is already registered, updating...`);
    }

    this.services.set(name, service);

    // Create service metadata
    const metadata: ServiceMetadata = {
      name,
      version: service.metadata.version,
      description: service.metadata.description,
      status: 'registered',
      health: 'healthy',
      capabilities: definition?.capabilities || [],
      dependencies: {
        required: definition?.dependencies || [],
        optional: definition?.optionalDependencies || [],
        satisfied: false,
      },
      lifecycle: {
        registeredAt: new Date(),
        uptime: 0,
      },
      resources: definition?.resources || {},
      configuration: service.config,
    };

    this.metadata.set(name, metadata);

    // Initialize availability
    this.availability.set(name, {
      available: false,
      downtime: 0,
    });

    // Add to dependency graph if definition provided
    if (definition) {
      this.dependencyGraph.addService({
        name,
        critical: definition.critical ?? true,
        dependencies: definition.dependencies || [],
        optionalDependencies: definition.optionalDependencies,
        timeout: definition.timeout || 30000,
        retryPolicy: definition.retryPolicy,
        healthChecks: definition.healthChecks,
        resources: definition.resources,
        capabilities: definition.capabilities,
        version: service.metadata.version,
      });
    }

    // Index capabilities
    this.indexCapabilities(name, metadata.capabilities);

    // Set up service event listeners
    this.setupServiceListeners(service, metadata);

    // Check dependencies
    this.checkDependencies(name);

    this.emit('service:registered', { name, metadata });
    logger.info(`Service registered: ${name}`, { 
      version: metadata.version,
      capabilities: metadata.capabilities,
    });
  }

  /**
   * Deregister a service
   */
  deregister(name: string, reason: string = 'manual'): void {
    const service = this.services.get(name);
    const metadata = this.metadata.get(name);
    
    if (!service || !metadata) {
      logger.warn(`Cannot deregister unknown service: ${name}`);
      return;
    }

    // Remove from all indexes
    this.services.delete(name);
    this.metadata.delete(name);
    this.availability.delete(name);
    this.dependencyGraph.removeService(name);

    // Remove capability indexing
    for (const capability of metadata.capabilities) {
      const services = this.capabilityIndex.get(capability);
      if (services) {
        services.delete(name);
        if (services.size === 0) {
          this.capabilityIndex.delete(capability);
          this.emit('capability:unavailable', { capability });
        }
      }
    }

    this.emit('service:deregistered', { name, reason });
    logger.info(`Service deregistered: ${name}`, { reason });
  }

  /**
   * Get a service instance
   */
  get<T extends BaseService<any, any> | BaseAsyncService<any, any>>(name: string): T | undefined {
    return this.services.get(name) as T;
  }

  /**
   * Get service metadata
   */
  getMetadata(name: string): ServiceMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Get all registered services
   */
  getAllServices(): Map<string, BaseService<any, any> | BaseAsyncService<any, any>> {
    return new Map(this.services);
  }

  /**
   * Get all service metadata
   */
  getAllMetadata(): Map<string, ServiceMetadata> {
    return new Map(this.metadata);
  }

  /**
   * Get services by status
   */
  getServicesByStatus(status: ServiceMetadata['status']): ServiceMetadata[] {
    return Array.from(this.metadata.values()).filter(m => m.status === status);
  }

  /**
   * Get services by health status
   */
  getServicesByHealth(health: HealthStatus): ServiceMetadata[] {
    return Array.from(this.metadata.values()).filter(m => m.health === health);
  }

  /**
   * Get services by capability
   */
  getServicesByCapability(capability: string): string[] {
    return Array.from(this.capabilityIndex.get(capability) || new Set());
  }

  /**
   * Get available capabilities
   */
  getAvailableCapabilities(): string[] {
    return Array.from(this.capabilityIndex.keys());
  }

  /**
   * Check if a capability is available
   */
  hasCapability(capability: string): boolean {
    const services = this.capabilityIndex.get(capability);
    if (!services || services.size === 0) {
      return false;
    }

    // Check if at least one service providing this capability is available
    return Array.from(services).some(serviceName => {
      const availability = this.availability.get(serviceName);
      return availability?.available;
    });
  }

  /**
   * Get service availability
   */
  getAvailability(name: string): ServiceAvailability | undefined {
    return this.availability.get(name);
  }

  /**
   * Check if dependencies are satisfied for a service
   */
  checkDependencies(name: string): { satisfied: boolean; missing: string[] } {
    const metadata = this.metadata.get(name);
    if (!metadata) {
      return { satisfied: false, missing: [] };
    }

    const missing: string[] = [];

    // Check required dependencies
    for (const dep of metadata.dependencies.required) {
      const depAvailability = this.availability.get(dep);
      if (!depAvailability?.available) {
        missing.push(dep);
      }
    }

    const satisfied = missing.length === 0;
    
    // Update metadata
    metadata.dependencies.satisfied = satisfied;

    // Emit events
    if (satisfied && missing.length === 0) {
      this.emit('dependencies:satisfied', {
        name,
        dependencies: metadata.dependencies.required,
      });
    } else {
      this.emit('dependencies:unsatisfied', { name, missing });
    }

    return { satisfied, missing };
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): ServiceDependencyGraph {
    return this.dependencyGraph;
  }

  /**
   * Start all services in dependency order
   */
  async startAll(options?: {
    parallel?: boolean;
    skipOptional?: boolean;
    timeout?: number;
  }): Promise<void> {
    const { parallel = true, skipOptional = false, timeout = 300000 } = options || {};

    logger.info('Starting all services in dependency order...');
    
    const groups = this.dependencyGraph.topologicalSort(!skipOptional);
    const startTime = Date.now();

    try {
      for (const group of groups) {
        logger.info(`Starting group: level ${group.level}, services: ${group.services.join(', ')}`);
        
        if (parallel && group.parallel) {
          // Start services in parallel
          await Promise.all(
            group.services.map(serviceName => this.startService(serviceName))
          );
        } else {
          // Start services sequentially
          for (const serviceName of group.services) {
            await this.startService(serviceName);
          }
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          throw new Error(`Startup timeout exceeded: ${timeout}ms`);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`All services started successfully in ${duration}ms`);

    } catch (error) {
      logger.error('Failed to start all services', { error });
      throw error;
    }
  }

  /**
   * Stop all services in reverse dependency order
   */
  async stopAll(reason: string = 'shutdown'): Promise<void> {
    logger.info('Stopping all services...');

    const runningServices = Array.from(this.metadata.entries())
      .filter(([_, metadata]) => metadata.status === 'running')
      .map(([name]) => name);

    // Stop in reverse dependency order
    const groups = this.dependencyGraph.topologicalSort().reverse();
    
    for (const group of groups) {
      const servicesToStop = group.services.filter(name => runningServices.includes(name));
      
      if (servicesToStop.length > 0) {
        await Promise.all(
          servicesToStop.map(serviceName => this.stopService(serviceName, reason))
        );
      }
    }

    logger.info('All services stopped');
  }

  /**
   * Start a specific service
   */
  async startService(name: string): Promise<void> {
    const service = this.services.get(name);
    const metadata = this.metadata.get(name);
    
    if (!service || !metadata) {
      throw new Error(`Service ${name} not found`);
    }

    if (metadata.status === 'running') {
      logger.debug(`Service ${name} is already running`);
      return;
    }

    // Check dependencies
    const { satisfied, missing } = this.checkDependencies(name);
    if (!satisfied) {
      throw new Error(`Cannot start ${name}: missing dependencies: ${missing.join(', ')}`);
    }

    try {
      this.updateServiceStatus(name, 'starting');
      
      const startTime = Date.now();
      await service.start();
      
      metadata.lifecycle.lastStarted = new Date();
      this.updateServiceAvailability(name, true);
      this.updateServiceStatus(name, 'running');

      logger.info(`Service ${name} started in ${Date.now() - startTime}ms`);

    } catch (error) {
      this.updateServiceStatus(name, 'failed');
      this.updateServiceAvailability(name, false, (error as Error).message);
      
      logger.error(`Failed to start service ${name}`, { error });
      throw error;
    }
  }

  /**
   * Stop a specific service
   */
  async stopService(name: string, reason: string = 'manual'): Promise<void> {
    const service = this.services.get(name);
    const metadata = this.metadata.get(name);
    
    if (!service || !metadata) {
      throw new Error(`Service ${name} not found`);
    }

    if (metadata.status !== 'running') {
      logger.debug(`Service ${name} is not running`);
      return;
    }

    try {
      this.updateServiceStatus(name, 'stopping');
      
      await service.stop(reason);
      
      metadata.lifecycle.lastStopped = new Date();
      this.updateServiceAvailability(name, false, reason);
      this.updateServiceStatus(name, 'stopped');

      logger.info(`Service ${name} stopped: ${reason}`);

    } catch (error) {
      this.updateServiceStatus(name, 'failed');
      logger.error(`Failed to stop service ${name}`, { error });
      throw error;
    }
  }

  /**
   * Restart a service
   */
  async restartService(name: string, reason: string = 'restart'): Promise<void> {
    await this.stopService(name, reason);
    await this.startService(name);
  }

  /**
   * Get system health summary
   */
  async getSystemHealth(): Promise<{
    healthy: boolean;
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
    };
    services: Map<string, HealthCheckResult>;
  }> {
    const services = new Map<string, HealthCheckResult>();
    const summary = { total: 0, healthy: 0, degraded: 0, unhealthy: 0 };

    for (const [name, service] of this.services.entries()) {
      try {
        const health = await service.getHealth();
        services.set(name, health);
        summary.total++;

        switch (health.status) {
          case 'healthy':
            summary.healthy++;
            break;
          case 'degraded':
            summary.degraded++;
            break;
          case 'unhealthy':
            summary.unhealthy++;
            break;
        }

        // Update metadata health
        const metadata = this.metadata.get(name);
        if (metadata) {
          const oldHealth = metadata.health;
          metadata.health = health.status;
          metadata.lifecycle.lastHealthCheck = new Date();

          if (oldHealth !== health.status) {
            this.emit('service:health-changed', {
              name,
              from: oldHealth,
              to: health.status,
              checks: health.checks || [],
            });
          }
        }

      } catch (error) {
        logger.error(`Health check failed for ${name}`, { error });
        summary.total++;
        summary.unhealthy++;
      }
    }

    const healthy = summary.unhealthy === 0 && summary.degraded === 0;

    this.emit('registry:health-check', {
      timestamp: new Date(),
      summary,
    });

    return { healthy, summary, services };
  }

  /**
   * Start periodic health checks
   */
  startHealthMonitoring(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.getSystemHealth();
      } catch (error) {
        logger.error('Health monitoring failed', { error });
      }
    }, intervalMs);

    logger.info('Health monitoring started', { interval: intervalMs });
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      logger.info('Health monitoring stopped');
    }
  }

  /**
   * Clear all services (for testing)
   */
  clear(): void {
    this.stopHealthMonitoring();
    this.services.clear();
    this.metadata.clear();
    this.availability.clear();
    this.capabilityIndex.clear();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.setupDependencyGraphListeners();
  }

  private updateServiceStatus(
    name: string, 
    status: ServiceMetadata['status']
  ): void {
    const metadata = this.metadata.get(name);
    if (metadata) {
      const oldStatus = metadata.status;
      metadata.status = status;

      // Update uptime for running services
      if (status === 'running' && metadata.lifecycle.lastStarted) {
        metadata.lifecycle.uptime = Date.now() - metadata.lifecycle.lastStarted.getTime();
      }

      this.emit('service:status-changed', {
        name,
        from: oldStatus,
        to: status,
      });
    }
  }

  private updateServiceAvailability(
    name: string,
    available: boolean,
    reason?: string
  ): void {
    const availability = this.availability.get(name);
    if (availability) {
      const wasAvailable = availability.available;
      availability.available = available;
      availability.reason = reason;

      if (available) {
        availability.lastAvailable = new Date();
        availability.downtime = 0;
      } else if (wasAvailable) {
        // Service just became unavailable
        availability.downtime = Date.now();
      }

      // Check capability availability changes
      const metadata = this.metadata.get(name);
      if (metadata) {
        for (const capability of metadata.capabilities) {
          const hasCapability = this.hasCapability(capability);
          
          if (available && !wasAvailable && hasCapability) {
            this.emit('capability:available', {
              capability,
              services: this.getServicesByCapability(capability),
            });
          } else if (!available && wasAvailable && !hasCapability) {
            this.emit('capability:unavailable', { capability });
          }
        }
      }
    }
  }

  private indexCapabilities(serviceName: string, capabilities: string[]): void {
    for (const capability of capabilities) {
      if (!this.capabilityIndex.has(capability)) {
        this.capabilityIndex.set(capability, new Set());
      }
      this.capabilityIndex.get(capability)!.add(serviceName);
    }
  }

  private setupServiceListeners(
    service: BaseService<any, any> | BaseAsyncService<any, any>,
    metadata: ServiceMetadata
  ): void {
    const name = metadata.name;

    // Listen to service events
    service.on('service:started', () => {
      this.updateServiceStatus(name, 'running');
      this.updateServiceAvailability(name, true);
    });

    service.on('service:stopped', () => {
      this.updateServiceStatus(name, 'stopped');
      this.updateServiceAvailability(name, false, 'stopped');
    });

    service.on('service:error', ({ error }) => {
      this.updateServiceStatus(name, 'failed');
      this.updateServiceAvailability(name, false, error.message);
    });
  }

  private setupDependencyGraphListeners(): void {
    this.dependencyGraph.on('circular:detected', ({ cycle }) => {
      logger.error('Circular dependency detected', { cycle });
    });

    this.dependencyGraph.on('dependency:added', ({ service, dependency, type }) => {
      logger.debug(`Dependency added: ${service} -> ${dependency} (${type})`);
    });
  }
}

// Export singleton instance
export const serviceRegistry = EnhancedServiceRegistry.getInstance();