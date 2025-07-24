import { z } from 'zod';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import type { ServiceEventMap, HealthStatus, HealthCheckResult } from './TypedEventEmitter.js';
import { loadAppConfig, watchAppConfig } from '@/config/index.js';
import { logger } from '@/lib/unjs-utils.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service state lifecycle
 */
export type ServiceState = 
  | 'uninitialized'
  | 'initializing'
  | 'initialized'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/**
 * Service metadata
 */
export interface ServiceMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
}

/**
 * Service configuration options
 */
export interface ServiceConfigOptions<T = any> {
  schema: z.ZodSchema<T>;
  prefix?: string;
  hot?: boolean; // Enable hot reload
  defaults?: Partial<T>;
  transform?: (config: any) => T;
}

/**
 * Health check definition
 */
export interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
  critical?: boolean;
  interval?: number;
  timeout?: number;
}

/**
 * Disposable resource interface
 */
export interface DisposableResource {
  dispose(): Promise<void> | void;
}

/**
 * Service metrics
 */
export interface ServiceMetrics {
  startTime: Date;
  uptime: number;
  requests?: number;
  errors?: number;
  lastError?: { error: Error; timestamp: Date };
  customMetrics?: Record<string, number>;
}

/**
 * Base service class with automatic configuration, lifecycle management, and health checks
 * 
 * @example
 * ```typescript
 * interface RedisConfig {
 *   host: string;
 *   port: number;
 *   password?: string;
 * }
 * 
 * class RedisService extends BaseService<RedisConfig> {
 *   protected getServiceName() { return 'redis'; }
 *   protected getConfigSchema() { return RedisConfigSchema; }
 *   
 *   protected async onStart() {
 *     // Service-specific startup logic
 *   }
 * }
 * ```
 */
export abstract class BaseService<
  TConfig = any,
  TEventMap extends ServiceEventMap = ServiceEventMap
> extends TypedEventEmitter<TEventMap> {
  // Service metadata
  protected readonly metadata: ServiceMetadata;
  
  // Configuration
  protected config!: TConfig;
  private configOptions?: ServiceConfigOptions<TConfig>;
  private configWatcher?: any;
  
  // Lifecycle state
  protected state: ServiceState = 'uninitialized';
  
  // Health checks
  protected healthChecks: Map<string, HealthCheck> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastHealthStatus: HealthStatus = 'healthy';
  
  // Resources
  protected resources: DisposableResource[] = [];
  
  // Metrics
  protected metrics: ServiceMetrics;
  
  // Dependencies
  protected dependencies: Map<string, BaseService> = new Map();

  constructor() {
    super();
    
    this.metadata = {
      id: uuidv4(),
      name: this.getServiceName(),
      version: this.getServiceVersion(),
      description: this.getServiceDescription(),
      dependencies: this.getServiceDependencies(),
    };
    
    this.metrics = {
      startTime: new Date(),
      uptime: 0,
      requests: 0,
      errors: 0,
    };
    
    // Register default health check
    this.registerHealthCheck({
      name: 'service:alive',
      check: async () => ({
        name: 'service:alive',
        status: this.state === 'running' ? 'healthy' : 'unhealthy',
        message: `Service is ${this.state}`,
        timestamp: new Date(),
      }),
      critical: true,
    });
  }

  /**
   * Get service name (must be implemented by subclasses)
   */
  protected abstract getServiceName(): string;

  /**
   * Get service version (can be overridden)
   */
  protected getServiceVersion(): string {
    return '1.0.0';
  }

  /**
   * Get service description (optional)
   */
  protected getServiceDescription(): string | undefined {
    return undefined;
  }

  /**
   * Get service dependencies (optional)
   */
  protected getServiceDependencies(): string[] | undefined {
    return undefined;
  }

  /**
   * Get configuration schema (must be implemented if using config)
   */
  protected getConfigSchema(): z.ZodSchema<TConfig> | undefined {
    return undefined;
  }

  /**
   * Get configuration prefix for environment variables
   */
  protected getConfigPrefix(): string | undefined {
    return this.metadata.name.toUpperCase().replace(/-/g, '_');
  }

  /**
   * Initialize the service
   */
  async initialize(configOptions?: ServiceConfigOptions<TConfig>): Promise<void> {
    if (this.state !== 'uninitialized') {
      throw new Error(`Service ${this.metadata.name} is already initialized`);
    }

    try {
      this.state = 'initializing';
      logger.info(`Initializing service: ${this.metadata.name}`);

      // Load configuration
      this.configOptions = configOptions || {
        schema: this.getConfigSchema() as z.ZodSchema<TConfig>,
        prefix: this.getConfigPrefix(),
      };

      if (this.configOptions.schema) {
        await this.loadConfiguration();
      }

      // Call service-specific initialization
      await this.onInitialize();

      this.state = 'initialized';
      this.emit('service:initialized' as keyof TEventMap, {
        serviceName: this.metadata.name,
        timestamp: new Date(),
      } as TEventMap[keyof TEventMap]);

      logger.info(`Service initialized: ${this.metadata.name}`);
    } catch (error) {
      this.state = 'error';
      this.handleError(error as Error, 'initialization');
      throw error;
    }
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    if (this.state !== 'initialized' && this.state !== 'stopped') {
      throw new Error(`Service ${this.metadata.name} must be initialized before starting`);
    }

    try {
      this.state = 'starting';
      logger.info(`Starting service: ${this.metadata.name}`);

      // Start health checks
      this.startHealthChecks();

      // Call service-specific startup
      await this.onStart();

      this.state = 'running';
      this.metrics.startTime = new Date();

      this.emit('service:started' as keyof TEventMap, {
        serviceName: this.metadata.name,
        port: (this.config as any)?.port,
      } as TEventMap[keyof TEventMap]);

      logger.info(`Service started: ${this.metadata.name}`);
    } catch (error) {
      this.state = 'error';
      this.handleError(error as Error, 'startup');
      throw error;
    }
  }

  /**
   * Stop the service
   */
  async stop(reason?: string): Promise<void> {
    if (this.state !== 'running') {
      logger.warn(`Service ${this.metadata.name} is not running (state: ${this.state})`);
      return;
    }

    try {
      this.state = 'stopping';
      logger.info(`Stopping service: ${this.metadata.name}`, { reason });

      // Stop health checks
      this.stopHealthChecks();

      // Stop config watcher
      if (this.configWatcher) {
        await this.configWatcher.close();
      }

      // Call service-specific shutdown
      await this.onStop();

      // Cleanup resources
      await this.cleanup();

      this.state = 'stopped';
      this.emit('service:stopped' as keyof TEventMap, {
        serviceName: this.metadata.name,
        reason,
      } as TEventMap[keyof TEventMap]);

      logger.info(`Service stopped: ${this.metadata.name}`);
    } catch (error) {
      this.state = 'error';
      this.handleError(error as Error, 'shutdown');
      throw error;
    }
  }

  /**
   * Restart the service
   */
  async restart(): Promise<void> {
    logger.info(`Restarting service: ${this.metadata.name}`);
    await this.stop('restart');
    await this.start();
  }

  /**
   * Destroy the service (cleanup all resources)
   */
  async destroy(): Promise<void> {
    if (this.state === 'running') {
      await this.stop('destroy');
    }
    
    await this.cleanup();
    this.removeAllListeners();
    this.dependencies.clear();
    this.healthChecks.clear();
  }

  /**
   * Service-specific initialization logic
   */
  protected async onInitialize(): Promise<void> {
    // Override in subclasses
  }

  /**
   * Service-specific startup logic
   */
  protected abstract onStart(): Promise<void>;

  /**
   * Service-specific shutdown logic
   */
  protected async onStop(): Promise<void> {
    // Override in subclasses
  }

  /**
   * Load and validate configuration
   */
  private async loadConfiguration(): Promise<void> {
    if (!this.configOptions?.schema) {
      return;
    }

    const appConfig = await loadAppConfig();
    const prefix = this.configOptions.prefix || this.metadata.name;
    
    // Extract service config from app config
    let serviceConfig = (appConfig as any)[prefix] || {};
    
    // Merge with defaults
    if (this.configOptions.defaults) {
      serviceConfig = { ...this.configOptions.defaults, ...serviceConfig };
    }
    
    // Apply transform if provided
    if (this.configOptions.transform) {
      serviceConfig = this.configOptions.transform(serviceConfig);
    }
    
    // Validate configuration
    const result = this.configOptions.schema.safeParse(serviceConfig);
    if (!result.success) {
      throw new Error(
        `Invalid configuration for service ${this.metadata.name}: ${result.error.message}`
      );
    }
    
    this.config = result.data;
    
    // Setup hot reload if enabled
    if (this.configOptions.hot) {
      this.setupConfigWatcher();
    }
  }

  /**
   * Setup configuration hot reload
   */
  private async setupConfigWatcher(): Promise<void> {
    this.configWatcher = await watchAppConfig({
      onUpdate: async (newConfig) => {
        try {
          const oldConfig = this.config;
          await this.loadConfiguration();
          
          this.emit('config:changed' as keyof TEventMap, {
            oldConfig,
            newConfig: this.config,
          } as TEventMap[keyof TEventMap]);
          
          // Call service-specific config change handler
          await this.onConfigChanged(oldConfig, this.config);
        } catch (error) {
          this.handleError(error as Error, 'config-reload');
        }
      },
    });
  }

  /**
   * Handle configuration changes (override in subclasses)
   */
  protected async onConfigChanged(oldConfig: TConfig, newConfig: TConfig): Promise<void> {
    // Default behavior: restart service
    logger.info(`Configuration changed for ${this.metadata.name}, restarting...`);
    await this.restart();
  }

  /**
   * Register a health check
   */
  protected registerHealthCheck(check: HealthCheck): void {
    this.healthChecks.set(check.name, check);
  }

  /**
   * Run all health checks
   */
  async checkHealth(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    for (const [name, check] of this.healthChecks) {
      try {
        const result = await Promise.race([
          check.check(),
          new Promise<HealthCheckResult>((_, reject) =>
            setTimeout(
              () => reject(new Error('Health check timeout')),
              check.timeout || 5000
            )
          ),
        ]);
        results.push(result);
      } catch (error) {
        results.push({
          name,
          status: 'unhealthy',
          message: (error as Error).message,
          timestamp: new Date(),
        });
      }
    }
    
    // Update overall health status
    const hasUnhealthy = results.some(r => r.status === 'unhealthy');
    const hasDegraded = results.some(r => r.status === 'degraded');
    
    const newStatus: HealthStatus = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';
    
    if (newStatus !== this.lastHealthStatus) {
      this.lastHealthStatus = newStatus;
      this.emit('health:changed' as keyof TEventMap, {
        status: newStatus,
        checks: results,
      } as TEventMap[keyof TEventMap]);
    }
    
    return results;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    for (const [name, check] of this.healthChecks) {
      if (check.interval) {
        const interval = setInterval(
          () => this.runSingleHealthCheck(name, check),
          check.interval
        );
        this.healthCheckIntervals.set(name, interval);
      }
    }
  }

  /**
   * Stop periodic health checks
   */
  private stopHealthChecks(): void {
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();
  }

  /**
   * Run a single health check
   */
  private async runSingleHealthCheck(name: string, check: HealthCheck): Promise<void> {
    try {
      await check.check();
    } catch (error) {
      logger.error(`Health check failed: ${name}`, error);
      if (check.critical) {
        this.handleError(error as Error, `health-check:${name}`);
      }
    }
  }

  /**
   * Create and track a disposable resource
   */
  protected createResource<T extends DisposableResource>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }

  /**
   * Cleanup all resources
   */
  protected async cleanup(): Promise<void> {
    const errors: Error[] = [];
    
    for (const resource of this.resources) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error as Error);
      }
    }
    
    this.resources = [];
    
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to cleanup some resources');
    }
  }

  /**
   * Record a metric
   */
  protected recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.metrics.customMetrics) {
      this.metrics.customMetrics = {};
    }
    this.metrics.customMetrics[name] = value;
    
    this.emit('metric:recorded' as keyof TEventMap, {
      name,
      value,
      tags,
    } as TEventMap[keyof TEventMap]);
  }

  /**
   * Handle errors consistently
   */
  protected handleError(error: Error, context?: string): void {
    this.metrics.errors = (this.metrics.errors || 0) + 1;
    this.metrics.lastError = { error, timestamp: new Date() };
    
    logger.error(`Error in service ${this.metadata.name}`, error, { context });
    
    this.emit('service:error' as keyof TEventMap, {
      serviceName: this.metadata.name,
      error,
      context,
    } as TEventMap[keyof TEventMap]);
  }

  /**
   * Get service metrics
   */
  getMetrics(): ServiceMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime.getTime(),
    };
  }

  /**
   * Get service info
   */
  getInfo() {
    return {
      ...this.metadata,
      state: this.state,
      health: this.lastHealthStatus,
      metrics: this.getMetrics(),
      config: this.configOptions?.hot ? 'hot-reload' : 'static',
    };
  }
}