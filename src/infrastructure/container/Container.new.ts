import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceConfig, HealthMonitored, CacheEnabled, MetricsCollected } from '../core/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { performance } from 'perf_hooks';
import { v4 as uuidv4 } from 'uuid';

// Configuration Schema
const ContainerConfigSchema = z.object({
  dependencies: z.object({
    autoWiring: z.boolean().default(true),
    lazyLoading: z.boolean().default(true),
    circularDependencyDetection: z.boolean().default(true),
    enableProxies: z.boolean().default(true),
    maxDependencyDepth: z.number().min(1).max(50).default(10),
  }),
  lifecycle: z.object({
    enableLifecycleHooks: z.boolean().default(true),
    initializationTimeout: z.number().min(1000).max(300000).default(60000), // 1 minute
    enableGracefulShutdown: z.boolean().default(true),
    shutdownTimeout: z.number().min(1000).max(300000).default(30000), // 30 seconds
  }),
  performance: z.object({
    enableOptimizations: z.boolean().default(true),
    enableCaching: z.boolean().default(true),
    cacheSize: z.number().min(100).max(100000).default(10000),
    enableMetrics: z.boolean().default(true),
    enableProfiling: z.boolean().default(false),
  }),
  security: z.object({
    enableSandboxing: z.boolean().default(false),
    allowedModules: z.array(z.string()).default([]),
    enableAuditLogging: z.boolean().default(true),
    securityLevel: z.enum(['basic', 'standard', 'strict']).default('standard'),
  }),
  monitoring: z.object({
    enableHealthChecks: z.boolean().default(true),
    healthCheckInterval: z.number().min(1000).max(300000).default(30000), // 30 seconds
    enableAlerts: z.boolean().default(true),
    alertThresholds: z.object({
      memoryUsage: z.number().min(0).max(1).default(0.8), // 80%
      dependencyResolutionTime: z.number().min(100).max(10000).default(1000), // 1 second
    }),
  }),
});

type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

// Event Map for Container Service
interface ContainerEventMap {
  'container:service-registered': { serviceName: string; serviceType: string; scope: string; timestamp: Date };
  'container:service-resolved': { serviceName: string; resolutionTime: number; fromCache: boolean; timestamp: Date };
  'container:dependency-injected': { targetService: string; dependency: string; injectionType: string; timestamp: Date };
  'container:lifecycle-hook': { serviceName: string; hook: string; duration: number; success: boolean; timestamp: Date };
  'container:circular-dependency': { services: string[]; depth: number; resolved: boolean; timestamp: Date };
  'container:error-occurred': { operation: string; serviceName?: string; error: string; timestamp: Date };
  'container:cache-hit': { serviceName: string; cacheKey: string; timestamp: Date };
  'container:cache-miss': { serviceName: string; cacheKey: string; timestamp: Date };
  'container:security-violation': { operation: string; serviceName: string; violation: string; timestamp: Date };
  'container:performance-warning': { metric: string; value: number; threshold: number; timestamp: Date };
}

// Enhanced data types
export interface ServiceDefinition<T = any> {
  name: string;
  factory: ServiceFactory<T>;
  dependencies: string[];
  scope: ServiceScope;
  tags: string[];
  metadata: ServiceMetadata;
  lifecycle: ServiceLifecycle;
  security: ServiceSecurity;
}

export interface ServiceFactory<T = any> {
  create(dependencies: Record<string, any>, context: ServiceContext): Promise<T> | T;
  dispose?(instance: T): Promise<void> | void;
}

export interface ServiceContext {
  container: Container;
  requestId: string;
  parentServices: string[];
  metadata: Record<string, any>;
  permissions: string[];
}

export interface ServiceMetadata {
  version: string;
  description?: string;
  author?: string;
  tags: string[];
  created: Date;
  modified: Date;
  deprecation?: {
    deprecated: boolean;
    since?: string;
    replacement?: string;
    removeIn?: string;
  };
}

export interface ServiceLifecycle {
  hooks: {
    onInitializing?: (instance: any, context: ServiceContext) => Promise<void> | void;
    onInitialized?: (instance: any, context: ServiceContext) => Promise<void> | void;
    onDestroying?: (instance: any, context: ServiceContext) => Promise<void> | void;
    onDestroyed?: (instance: any, context: ServiceContext) => Promise<void> | void;
  };
  autoStart: boolean;
  singleton: boolean;
  lazyInit: boolean;
}

export interface ServiceSecurity {
  permissions: string[];
  roles: string[];
  sandboxed: boolean;
  allowedResources: string[];
  maxMemory?: number;
  maxExecutionTime?: number;
}

export type ServiceScope = 'singleton' | 'transient' | 'scoped' | 'prototype';

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, string[]>;
  resolved: Set<string>;
  resolving: Set<string>;
}

export interface DependencyNode {
  name: string;
  definition: ServiceDefinition;
  instance?: any;
  dependencies: string[];
  dependents: string[];
  level: number;
  status: 'pending' | 'resolving' | 'resolved' | 'failed';
  resolvedAt?: Date;
  resolutionTime?: number;
}

export interface ContainerMetrics {
  services: {
    registered: number;
    resolved: number;
    failed: number;
    cached: number;
    byScope: Record<ServiceScope, number>;
    byStatus: Record<string, number>;
  };
  performance: {
    averageResolutionTime: number;
    maxResolutionTime: number;
    cacheHitRate: number;
    memoryUsage: number;
    totalRequests: number;
  };
  dependencies: {
    totalDependencies: number;
    circularDependencies: number;
    maxDependencyDepth: number;
    resolutionErrors: number;
  };
  lifecycle: {
    hooksExecuted: number;
    hookFailures: number;
    averageHookTime: number;
  };
  security: {
    securityViolations: number;
    sandboxedServices: number;
    permissionChecks: number;
  };
}

/**
 * Enterprise Dependency Injection Container
 * Advanced service container with comprehensive DI capabilities
 */
@ServiceConfig({
  schema: ContainerConfigSchema,
  prefix: 'container',
  hot: true,
})
@HealthMonitored({
  interval: 30000, // 30 seconds
  timeout: 15000,
})
@CacheEnabled({
  ttl: 3600, // 1 hour
  maxSize: 50000,
})
@MetricsCollected(['service_operations', 'dependency_operations', 'lifecycle_operations', 'security_operations'])
export class Container extends BaseAsyncService<ContainerConfig, ContainerEventMap> {
  private readonly containerId: string;
  private readonly serviceDefinitions: Map<string, ServiceDefinition> = new Map();
  private readonly serviceInstances: Map<string, any> = new Map();
  private readonly serviceCache: Map<string, any> = new Map();
  private readonly dependencyGraph: DependencyGraph = {
    nodes: new Map(),
    edges: new Map(),
    resolved: new Set(),
    resolving: new Set(),
  };
  private readonly scopedInstances: Map<string, Map<string, any>> = new Map();
  private readonly serviceProxies: Map<string, any> = new Map();
  
  private metrics: ContainerMetrics = {
    services: {
      registered: 0,
      resolved: 0,
      failed: 0,
      cached: 0,
      byScope: { singleton: 0, transient: 0, scoped: 0, prototype: 0 },
      byStatus: {},
    },
    performance: {
      averageResolutionTime: 0,
      maxResolutionTime: 0,
      cacheHitRate: 0,
      memoryUsage: 0,
      totalRequests: 0,
    },
    dependencies: {
      totalDependencies: 0,
      circularDependencies: 0,
      maxDependencyDepth: 0,
      resolutionErrors: 0,
    },
    lifecycle: {
      hooksExecuted: 0,
      hookFailures: 0,
      averageHookTime: 0,
    },
    security: {
      securityViolations: 0,
      sandboxedServices: 0,
      permissionChecks: 0,
    },
  };

  private resolutionTimes: number[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor() {
    super();
    this.containerId = uuidv4();
  }

  protected getServiceName(): string {
    return 'container';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Enterprise dependency injection container with advanced service management';
  }

  protected async onInitialize(): Promise<void> {
    this.setupHealthChecks();
    this.registerCoreServices();
    
    // Start monitoring
    if (this.config.monitoring.enableHealthChecks) {
      this.startMonitoring();
    }

    this.isInitialized = true;
  }

  protected async onStart(): Promise<void> {
    // Auto-start services
    await this.initializeAutoStartServices();

    logger.info('Container service started', {
      containerId: this.containerId,
      registeredServices: this.serviceDefinitions.size,
      autoWiring: this.config.dependencies.autoWiring,
    });
  }

  protected async onStop(): Promise<void> {
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Graceful shutdown of all services
    if (this.config.lifecycle.enableGracefulShutdown) {
      await this.gracefulShutdown();
    }
  }

  /**
   * Register a service definition
   */
  register<T>(definition: ServiceDefinition<T>): void {
    if (this.serviceDefinitions.has(definition.name)) {
      throw new Error(`Service ${definition.name} is already registered`);
    }

    // Validate definition
    this.validateServiceDefinition(definition);

    // Apply security checks
    if (this.config.security.enableAuditLogging) {
      this.checkServiceSecurity(definition);
    }

    // Register service
    this.serviceDefinitions.set(definition.name, definition);
    this.updateDependencyGraph(definition);

    // Update metrics
    this.metrics.services.registered++;
    this.metrics.services.byScope[definition.scope]++;

    // Emit event
    this.emit('container:service-registered', {
      serviceName: definition.name,
      serviceType: definition.factory.constructor.name,
      scope: definition.scope,
      timestamp: new Date(),
    });

    // Record metrics
    this.recordMetric('service_operations', 1, {
      operation: 'register',
      serviceName: definition.name,
      scope: definition.scope,
    });

    logger.debug('Service registered', {
      serviceName: definition.name,
      scope: definition.scope,
      dependencies: definition.dependencies,
    });
  }

  /**
   * Resolve a service instance
   */
  async resolve<T>(serviceName: string, context?: Partial<ServiceContext>): Promise<T> {
    const startTime = performance.now();
    this.metrics.performance.totalRequests++;

    try {
      const fullContext: ServiceContext = {
        container: this,
        requestId: uuidv4(),
        parentServices: [],
        metadata: {},
        permissions: [],
        ...context,
      };

      // Check cache first
      if (this.config.performance.enableCaching) {
        const cacheKey = this.generateCacheKey(serviceName, fullContext);
        if (this.serviceCache.has(cacheKey)) {
          this.metrics.services.cached++;
          this.emit('container:cache-hit', {
            serviceName,
            cacheKey,
            timestamp: new Date(),
          });
          return this.serviceCache.get(cacheKey) as T;
        }
        
        this.emit('container:cache-miss', {
          serviceName,
          cacheKey,
          timestamp: new Date(),
        });
      }

      // Resolve service
      const instance = await this.resolveInternal<T>(serviceName, fullContext);

      // Cache if appropriate
      if (this.config.performance.enableCaching && this.shouldCacheService(serviceName)) {
        const cacheKey = this.generateCacheKey(serviceName, fullContext);
        this.serviceCache.set(cacheKey, instance);
      }

      const duration = performance.now() - startTime;
      this.resolutionTimes.push(duration);
      
      // Update metrics
      this.metrics.services.resolved++;
      this.updatePerformanceMetrics(duration);

      // Emit event
      this.emit('container:service-resolved', {
        serviceName,
        resolutionTime: duration,
        fromCache: false,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('service_operations', 1, {
        operation: 'resolve',
        serviceName,
        duration: Math.round(duration).toString(),
      });

      return instance;
    } catch (error) {
      this.metrics.services.failed++;
      this.metrics.dependencies.resolutionErrors++;

      this.emit('container:error-occurred', {
        operation: 'resolve',
        serviceName,
        error: (error as Error).message,
        timestamp: new Date(),
      });

      logger.error('Service resolution failed', error as Error, {
        serviceName,
        containerId: this.containerId,
      });
      throw error;
    }
  }

  /**
   * Check if a service is registered
   */
  isRegistered(serviceName: string): boolean {
    return this.serviceDefinitions.has(serviceName);
  }

  /**
   * Get all registered service names
   */
  getRegisteredServices(): string[] {
    return Array.from(this.serviceDefinitions.keys());
  }

  /**
   * Get service definition
   */
  getServiceDefinition(serviceName: string): ServiceDefinition | undefined {
    return this.serviceDefinitions.get(serviceName);
  }

  /**
   * Create a child container with scoped services
   */
  createScope(scopeId: string): ScopedContainer {
    return new ScopedContainer(this, scopeId);
  }

  /**
   * Get container metrics
   */
  async getMetrics(): Promise<ContainerMetrics> {
    await this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get dependency graph visualization
   */
  getDependencyGraph(): DependencyGraph {
    return {
      nodes: new Map(this.dependencyGraph.nodes),
      edges: new Map(this.dependencyGraph.edges),
      resolved: new Set(this.dependencyGraph.resolved),
      resolving: new Set(this.dependencyGraph.resolving),
    };
  }

  // Private implementation methods

  private setupHealthChecks(): void {
    this.registerHealthCheck({
      name: 'container-services',
      check: async () => ({
        name: 'container-services',
        status: this.metrics.services.failed === 0 ? 'healthy' : 'degraded',
        message: `${this.metrics.services.resolved}/${this.metrics.services.registered} services resolved`,
        timestamp: new Date(),
      }),
      critical: true,
    });

    this.registerHealthCheck({
      name: 'dependency-resolution',
      check: async () => ({
        name: 'dependency-resolution',
        status: this.metrics.dependencies.circularDependencies === 0 ? 'healthy' : 'unhealthy',
        message: `${this.metrics.dependencies.circularDependencies} circular dependencies detected`,
        timestamp: new Date(),
      }),
    });
  }

  private registerCoreServices(): void {
    // Register the container itself
    this.register({
      name: 'container',
      factory: {
        create: () => this,
      },
      dependencies: [],
      scope: 'singleton',
      tags: ['core'],
      metadata: {
        version: this.getServiceVersion(),
        description: 'The container instance itself',
        tags: ['core', 'container'],
        created: new Date(),
        modified: new Date(),
      },
      lifecycle: {
        hooks: {},
        autoStart: false,
        singleton: true,
        lazyInit: false,
      },
      security: {
        permissions: ['container.access'],
        roles: ['system'],
        sandboxed: false,
        allowedResources: ['*'],
      },
    });
  }

  private async resolveInternal<T>(serviceName: string, context: ServiceContext): Promise<T> {
    // Check for circular dependencies
    if (context.parentServices.includes(serviceName)) {
      const cycle = [...context.parentServices, serviceName];
      this.metrics.dependencies.circularDependencies++;
      
      this.emit('container:circular-dependency', {
        services: cycle,
        depth: cycle.length,
        resolved: false,
        timestamp: new Date(),
      });

      if (this.config.dependencies.circularDependencyDetection) {
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }
    }

    // Get service definition
    const definition = this.serviceDefinitions.get(serviceName);
    if (!definition) {
      throw new Error(`Service ${serviceName} is not registered`);
    }

    // Check scope and return existing instance if applicable
    if (definition.scope === 'singleton' && this.serviceInstances.has(serviceName)) {
      return this.serviceInstances.get(serviceName);
    }

    // Security check
    await this.checkServicePermissions(serviceName, context);

    // Mark as resolving
    this.dependencyGraph.resolving.add(serviceName);

    try {
      // Resolve dependencies first
      const dependencies = await this.resolveDependencies(definition, {
        ...context,
        parentServices: [...context.parentServices, serviceName],
      });

      // Execute lifecycle hook - onInitializing
      if (definition.lifecycle.hooks.onInitializing) {
        await this.executeLifecycleHook(
          'onInitializing',
          definition.lifecycle.hooks.onInitializing,
          null,
          context
        );
      }

      // Create instance
      const instance = await this.createServiceInstance(definition, dependencies, context);

      // Execute lifecycle hook - onInitialized
      if (definition.lifecycle.hooks.onInitialized) {
        await this.executeLifecycleHook(
          'onInitialized',
          definition.lifecycle.hooks.onInitialized,
          instance,
          context
        );
      }

      // Store instance based on scope
      this.storeServiceInstance(serviceName, instance, definition.scope, context);

      // Mark as resolved
      this.dependencyGraph.resolved.add(serviceName);
      this.dependencyGraph.resolving.delete(serviceName);

      // Update dependency graph node
      const node = this.dependencyGraph.nodes.get(serviceName);
      if (node) {
        node.instance = instance;
        node.status = 'resolved';
        node.resolvedAt = new Date();
      }

      return instance;
    } catch (error) {
      // Mark as failed
      this.dependencyGraph.resolving.delete(serviceName);
      const node = this.dependencyGraph.nodes.get(serviceName);
      if (node) {
        node.status = 'failed';
      }
      throw error;
    }
  }

  private async resolveDependencies(
    definition: ServiceDefinition,
    context: ServiceContext
  ): Promise<Record<string, any>> {
    const dependencies: Record<string, any> = {};

    for (const depName of definition.dependencies) {
      dependencies[depName] = await this.resolveInternal(depName, context);
      
      this.emit('container:dependency-injected', {
        targetService: definition.name,
        dependency: depName,
        injectionType: 'constructor',
        timestamp: new Date(),
      });
    }

    this.recordMetric('dependency_operations', definition.dependencies.length, {
      targetService: definition.name,
      dependencyCount: definition.dependencies.length.toString(),
    });

    return dependencies;
  }

  private async createServiceInstance(
    definition: ServiceDefinition,
    dependencies: Record<string, any>,
    context: ServiceContext
  ): Promise<any> {
    try {
      const instance = await definition.factory.create(dependencies, context);
      
      // Apply security sandbox if needed
      if (definition.security.sandboxed && this.config.security.enableSandboxing) {
        return this.createSandboxedProxy(instance, definition);
      }

      // Create proxy if enabled
      if (this.config.dependencies.enableProxies) {
        return this.createServiceProxy(instance, definition);
      }

      return instance;
    } catch (error) {
      logger.error('Service instance creation failed', error as Error, {
        serviceName: definition.name,
      });
      throw error;
    }
  }

  private storeServiceInstance(
    serviceName: string,
    instance: any,
    scope: ServiceScope,
    context: ServiceContext
  ): void {
    switch (scope) {
      case 'singleton':
        this.serviceInstances.set(serviceName, instance);
        break;
      case 'scoped':
        // Store in scoped instances (implementation needed)
        break;
      case 'transient':
      case 'prototype':
        // Don't store transient instances
        break;
    }
  }

  private createServiceProxy(instance: any, definition: ServiceDefinition): any {
    return new Proxy(instance, {
      get: (target, prop) => {
        // Add monitoring, logging, etc.
        const value = target[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => {
            const result = value.apply(target, args);
            // Log method calls, measure performance, etc.
            return result;
          };
        }
        return value;
      },
    });
  }

  private createSandboxedProxy(instance: any, definition: ServiceDefinition): any {
    // Simplified sandboxing - in production, use proper isolation
    return new Proxy(instance, {
      get: (target, prop) => {
        // Check permissions for property access
        if (this.isRestrictedProperty(prop, definition)) {
          this.emit('container:security-violation', {
            operation: 'property-access',
            serviceName: definition.name,
            violation: `Restricted property access: ${String(prop)}`,
            timestamp: new Date(),
          });
          throw new Error(`Access denied to property: ${String(prop)}`);
        }
        return target[prop];
      },
    });
  }

  private updateDependencyGraph(definition: ServiceDefinition): void {
    const node: DependencyNode = {
      name: definition.name,
      definition,
      dependencies: definition.dependencies,
      dependents: [],
      level: 0,
      status: 'pending',
    };

    this.dependencyGraph.nodes.set(definition.name, node);
    this.dependencyGraph.edges.set(definition.name, definition.dependencies);

    // Update dependents
    for (const depName of definition.dependencies) {
      const depNode = this.dependencyGraph.nodes.get(depName);
      if (depNode) {
        depNode.dependents.push(definition.name);
      }
    }

    // Calculate dependency levels
    this.calculateDependencyLevels();
  }

  private calculateDependencyLevels(): void {
    // Topological sort to calculate dependency levels
    const visited = new Set<string>();
    const levels = new Map<string, number>();

    const visit = (serviceName: string): number => {
      if (visited.has(serviceName)) {
        return levels.get(serviceName) || 0;
      }

      visited.add(serviceName);
      const dependencies = this.dependencyGraph.edges.get(serviceName) || [];
      
      if (dependencies.length === 0) {
        levels.set(serviceName, 0);
        return 0;
      }

      const maxDepLevel = Math.max(...dependencies.map(dep => visit(dep)));
      const level = maxDepLevel + 1;
      levels.set(serviceName, level);

      const node = this.dependencyGraph.nodes.get(serviceName);
      if (node) {
        node.level = level;
      }

      return level;
    };

    for (const serviceName of this.dependencyGraph.nodes.keys()) {
      visit(serviceName);
    }

    this.metrics.dependencies.maxDependencyDepth = Math.max(...levels.values());
  }

  private async initializeAutoStartServices(): Promise<void> {
    const autoStartServices = Array.from(this.serviceDefinitions.values())
      .filter(def => def.lifecycle.autoStart)
      .sort((a, b) => {
        const nodeA = this.dependencyGraph.nodes.get(a.name);
        const nodeB = this.dependencyGraph.nodes.get(b.name);
        return (nodeA?.level || 0) - (nodeB?.level || 0);
      });

    for (const definition of autoStartServices) {
      try {
        await this.resolve(definition.name);
        logger.debug('Auto-started service', { serviceName: definition.name });
      } catch (error) {
        logger.error('Failed to auto-start service', error as Error, {
          serviceName: definition.name,
        });
      }
    }
  }

  private async gracefulShutdown(): Promise<void> {
    const timeout = this.config.lifecycle.shutdownTimeout;
    const shutdownPromise = this.performShutdown();
    
    await Promise.race([
      shutdownPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), timeout)
      ),
    ]);
  }

  private async performShutdown(): Promise<void> {
    // Shutdown services in reverse dependency order
    const services = Array.from(this.serviceInstances.entries())
      .sort(([nameA], [nameB]) => {
        const nodeA = this.dependencyGraph.nodes.get(nameA);
        const nodeB = this.dependencyGraph.nodes.get(nameB);
        return (nodeB?.level || 0) - (nodeA?.level || 0);
      });

    for (const [serviceName, instance] of services) {
      try {
        const definition = this.serviceDefinitions.get(serviceName);
        if (definition?.lifecycle.hooks.onDestroying) {
          await this.executeLifecycleHook(
            'onDestroying',
            definition.lifecycle.hooks.onDestroying,
            instance,
            { container: this, requestId: uuidv4(), parentServices: [], metadata: {}, permissions: [] }
          );
        }

        if (definition?.factory.dispose) {
          await definition.factory.dispose(instance);
        }

        if (definition?.lifecycle.hooks.onDestroyed) {
          await this.executeLifecycleHook(
            'onDestroyed',
            definition.lifecycle.hooks.onDestroyed,
            instance,
            { container: this, requestId: uuidv4(), parentServices: [], metadata: {}, permissions: [] }
          );
        }

        logger.debug('Service shutdown completed', { serviceName });
      } catch (error) {
        logger.error('Service shutdown failed', error as Error, { serviceName });
      }
    }

    this.serviceInstances.clear();
    this.serviceCache.clear();
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.updateMetrics();
      await this.checkPerformanceThresholds();
    }, this.config.monitoring.healthCheckInterval);
  }

  private async updateMetrics(): Promise<void> {
    // Update performance metrics
    if (this.resolutionTimes.length > 0) {
      this.metrics.performance.averageResolutionTime =
        this.resolutionTimes.reduce((sum, time) => sum + time, 0) / this.resolutionTimes.length;
      this.metrics.performance.maxResolutionTime = Math.max(...this.resolutionTimes);
    }

    // Calculate cache hit rate
    const totalCacheRequests = this.metrics.services.cached + this.metrics.services.resolved;
    this.metrics.performance.cacheHitRate = totalCacheRequests > 0
      ? this.metrics.services.cached / totalCacheRequests
      : 0;

    // Update memory usage (simplified)
    this.metrics.performance.memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB

    // Clean up old resolution times
    if (this.resolutionTimes.length > 1000) {
      this.resolutionTimes = this.resolutionTimes.slice(-500);
    }
  }

  private async checkPerformanceThresholds(): Promise<void> {
    const config = this.config.monitoring.alertThresholds;

    // Check memory usage
    if (this.metrics.performance.memoryUsage > config.memoryUsage * 1024) { // Convert to MB
      this.emit('container:performance-warning', {
        metric: 'memory-usage',
        value: this.metrics.performance.memoryUsage,
        threshold: config.memoryUsage * 1024,
        timestamp: new Date(),
      });
    }

    // Check dependency resolution time
    if (this.metrics.performance.averageResolutionTime > config.dependencyResolutionTime) {
      this.emit('container:performance-warning', {
        metric: 'resolution-time',
        value: this.metrics.performance.averageResolutionTime,
        threshold: config.dependencyResolutionTime,
        timestamp: new Date(),
      });
    }
  }

  // Utility methods

  private validateServiceDefinition(definition: ServiceDefinition): void {
    if (!definition.name) {
      throw new Error('Service definition must have a name');
    }

    if (!definition.factory) {
      throw new Error('Service definition must have a factory');
    }

    if (typeof definition.factory.create !== 'function') {
      throw new Error('Service factory must have a create method');
    }
  }

  private checkServiceSecurity(definition: ServiceDefinition): void {
    if (this.config.security.securityLevel === 'strict') {
      // Additional security checks for strict mode
      if (!definition.security.permissions.length) {
        throw new Error(`Service ${definition.name} must define permissions in strict mode`);
      }
    }
  }

  private async checkServicePermissions(serviceName: string, context: ServiceContext): Promise<void> {
    const definition = this.serviceDefinitions.get(serviceName);
    if (!definition) return;

    this.metrics.security.permissionChecks++;

    if (definition.security.permissions.length > 0) {
      const hasPermission = definition.security.permissions.some(perm =>
        context.permissions.includes(perm)
      );

      if (!hasPermission) {
        this.metrics.security.securityViolations++;
        throw new Error(`Insufficient permissions to resolve service ${serviceName}`);
      }
    }
  }

  private async executeLifecycleHook(
    hookName: string,
    hook: Function,
    instance: any,
    context: ServiceContext
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await hook(instance, context);
      const duration = performance.now() - startTime;
      
      this.metrics.lifecycle.hooksExecuted++;
      this.emit('container:lifecycle-hook', {
        serviceName: context.parentServices[context.parentServices.length - 1] || 'unknown',
        hook: hookName,
        duration,
        success: true,
        timestamp: new Date(),
      });

      this.recordMetric('lifecycle_operations', 1, {
        hook: hookName,
        success: 'true',
        duration: Math.round(duration).toString(),
      });
    } catch (error) {
      this.metrics.lifecycle.hookFailures++;
      
      this.emit('container:lifecycle-hook', {
        serviceName: context.parentServices[context.parentServices.length - 1] || 'unknown',
        hook: hookName,
        duration: performance.now() - startTime,
        success: false,
        timestamp: new Date(),
      });

      logger.error('Lifecycle hook failed', error as Error, { hookName });
      throw error;
    }
  }

  private generateCacheKey(serviceName: string, context: ServiceContext): string {
    return `service:${serviceName}:${JSON.stringify(context.metadata)}`;
  }

  private shouldCacheService(serviceName: string): boolean {
    const definition = this.serviceDefinitions.get(serviceName);
    return definition?.scope === 'singleton' || definition?.scope === 'scoped';
  }

  private updatePerformanceMetrics(duration: number): void {
    this.metrics.performance.maxResolutionTime = Math.max(
      this.metrics.performance.maxResolutionTime,
      duration
    );
  }

  private isRestrictedProperty(prop: string | symbol, definition: ServiceDefinition): boolean {
    // Simplified security check
    const restrictedProps = ['constructor', '__proto__', 'prototype'];
    return restrictedProps.includes(String(prop));
  }
}

/**
 * Scoped container for managing scoped service instances
 */
export class ScopedContainer {
  private readonly scopedInstances: Map<string, any> = new Map();

  constructor(
    private readonly parentContainer: Container,
    private readonly scopeId: string
  ) {}

  async resolve<T>(serviceName: string): Promise<T> {
    // Check if already resolved in this scope
    if (this.scopedInstances.has(serviceName)) {
      return this.scopedInstances.get(serviceName);
    }

    // Resolve using parent container
    const instance = await this.parentContainer.resolve<T>(serviceName, {
      container: this.parentContainer,
      requestId: uuidv4(),
      parentServices: [],
      metadata: { scopeId: this.scopeId },
      permissions: [],
    });

    // Store in scope if it's a scoped service
    const definition = this.parentContainer.getServiceDefinition(serviceName);
    if (definition?.scope === 'scoped') {
      this.scopedInstances.set(serviceName, instance);
    }

    return instance;
  }

  dispose(): void {
    this.scopedInstances.clear();
  }
}