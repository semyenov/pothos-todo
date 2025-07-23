import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { ServiceDependencyGraph, ServiceDefinition, ServiceGroup, RetryPolicy } from './ServiceDependencyGraph.js';
import { ServiceRegistry } from '../microservices/ServiceRegistry.js';
import { logger } from '@/lib/unjs-utils.js';
import type { SystemConfig } from '../SystemIntegration.new.js';

/**
 * Startup orchestrator configuration schema
 */
const OrchestratorConfigSchema = z.object({
  maxStartupTime: z.number().default(300000), // 5 minutes
  parallelism: z.union([z.literal('auto'), z.number()]).default('auto'),
  healthCheckInterval: z.number().default(1000), // 1 second
  startupRetryDelay: z.number().default(2000), // 2 seconds
  progressiveStages: z.boolean().default(true),
  profileStartup: z.boolean().default(true),
  gracefulDegradation: z.boolean().default(true),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

/**
 * Startup options for a service or group
 */
export interface StartupOptions {
  parallel?: boolean;
  healthCheck?: boolean;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  skipOnFailure?: boolean;
}

/**
 * Startup result for a service
 */
export interface ServiceStartupResult {
  serviceName: string;
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  duration: number;
  attempts: number;
  error?: Error;
  health?: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * Group startup result
 */
export interface GroupStartupResult {
  groupDepth: number;
  services: ServiceStartupResult[];
  duration: number;
  parallelEfficiency: number;
}

/**
 * Overall startup result
 */
export interface StartupResult {
  success: boolean;
  totalDuration: number;
  groups: GroupStartupResult[];
  failedServices: string[];
  skippedServices: string[];
  degradedServices: string[];
  startupProfile?: StartupProfile;
}

/**
 * Startup profile for performance analysis
 */
export interface StartupProfile {
  timeline: Array<{
    timestamp: number;
    service: string;
    event: 'start' | 'health-check' | 'complete' | 'failed';
    duration?: number;
  }>;
  bottlenecks: Array<{
    service: string;
    duration: number;
    reason: string;
  }>;
  parallelizationMetrics: {
    theoreticalMinTime: number;
    actualTime: number;
    efficiency: number;
  };
}

/**
 * Health gate configuration
 */
export interface HealthGate {
  required: string[];
  optional?: string[];
  timeout?: number;
}

/**
 * Startup stage configuration
 */
export interface StartupStage {
  name: string;
  services: string[];
  healthGate?: HealthGate;
  rollbackOnFailure?: boolean;
  skipOnTimeout?: boolean;
  timeout?: number;
}

/**
 * Service instance factory function
 */
export type ServiceFactory<T = any> = () => Promise<T> | T;

/**
 * Orchestrator event map
 */
interface OrchestratorEventMap {
  'orchestrator:service-starting': { service: string; attempt: number };
  'orchestrator:service-started': { service: string; duration: number };
  'orchestrator:service-failed': { service: string; error: Error; attempts: number };
  'orchestrator:group-starting': { depth: number; services: string[] };
  'orchestrator:group-completed': { depth: number; results: GroupStartupResult };
  'orchestrator:stage-starting': { stage: string };
  'orchestrator:stage-completed': { stage: string; success: boolean };
  'orchestrator:health-check': { service: string; status: string };
  'orchestrator:startup-complete': { result: StartupResult };
}

/**
 * Startup orchestrator for managing service initialization order and dependencies
 * 
 * Features:
 * - Dependency-based startup order
 * - Parallel service initialization
 * - Health verification between stages
 * - Retry mechanisms with exponential backoff
 * - Graceful degradation for non-critical services
 * - Startup performance profiling
 * - Progressive stages with rollback
 */
@ServiceConfig({
  schema: OrchestratorConfigSchema,
  prefix: 'orchestrator',
  hot: true,
})
export class StartupOrchestrator extends BaseService<OrchestratorConfig, OrchestratorEventMap> {
  private dependencyGraph: ServiceDependencyGraph;
  private registry: ServiceRegistry;
  private serviceFactories: Map<string, ServiceFactory> = new Map();
  private startupMetrics: Map<string, ServiceStartupResult> = new Map();
  private startupProfile?: StartupProfile;
  private startTime: number = 0;
  private serviceInstances: Map<string, any> = new Map();

  constructor() {
    super();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.registry = ServiceRegistry.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): StartupOrchestrator {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'startup-orchestrator';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Orchestrates service startup with dependency resolution and parallel execution';
  }

  /**
   * Register a service with its factory
   */
  registerService(definition: ServiceDefinition, factory: ServiceFactory): void {
    this.dependencyGraph.addService(definition);
    this.serviceFactories.set(definition.name, factory);
    
    logger.info(`Service registered with orchestrator: ${definition.name}`, {
      dependencies: definition.dependencies,
      critical: definition.critical,
    });
  }

  /**
   * Register multiple services
   */
  registerServices(services: Array<{ definition: ServiceDefinition; factory: ServiceFactory }>): void {
    for (const { definition, factory } of services) {
      this.registerService(definition, factory);
    }
  }

  /**
   * Orchestrate system startup
   */
  async orchestrateStartup(systemConfig?: SystemConfig): Promise<StartupResult> {
    this.startTime = Date.now();
    this.startupMetrics.clear();
    
    if (this.config.profileStartup) {
      this.startupProfile = {
        timeline: [],
        bottlenecks: [],
        parallelizationMetrics: {
          theoreticalMinTime: 0,
          actualTime: 0,
          efficiency: 0,
        },
      };
    }

    // Validate dependency graph
    const validation = this.dependencyGraph.validateGraph();
    if (!validation.valid) {
      throw new Error(`Invalid dependency graph: ${validation.errors.join(', ')}`);
    }

    // Log warnings
    for (const warning of validation.warnings) {
      logger.warn(`Dependency warning: ${warning}`);
    }

    // Get parallel groups
    const groups = this.dependencyGraph.getParallelGroups();
    const groupResults: GroupStartupResult[] = [];

    this.emit('orchestrator:startup-complete', {
      result: {
        success: false,
        totalDuration: 0,
        groups: [],
        failedServices: [],
        skippedServices: [],
        degradedServices: [],
      },
    });

    try {
      // Start services group by group
      for (const group of groups) {
        const groupResult = await this.startServiceGroup(group, {
          parallel: true,
          healthCheck: true,
          timeout: group.timeout,
        });

        groupResults.push(groupResult);

        // Check if critical services failed
        if (group.critical) {
          const criticalFailures = groupResult.services.filter(
            s => s.status === 'failed' && 
            this.dependencyGraph['graph'].get(s.serviceName)?.definition.critical
          );

          if (criticalFailures.length > 0 && !this.config.gracefulDegradation) {
            throw new Error(`Critical services failed: ${criticalFailures.map(s => s.serviceName).join(', ')}`);
          }
        }
      }

      // Calculate final metrics
      const totalDuration = Date.now() - this.startTime;
      const failedServices = Array.from(this.startupMetrics.values())
        .filter(m => m.status === 'failed')
        .map(m => m.serviceName);
      
      const skippedServices = Array.from(this.startupMetrics.values())
        .filter(m => m.status === 'skipped')
        .map(m => m.serviceName);
      
      const degradedServices = Array.from(this.startupMetrics.values())
        .filter(m => m.health === 'degraded')
        .map(m => m.serviceName);

      // Calculate parallelization metrics
      if (this.startupProfile) {
        const theoreticalMinTime = this.calculateTheoreticalMinTime();
        this.startupProfile.parallelizationMetrics = {
          theoreticalMinTime,
          actualTime: totalDuration,
          efficiency: theoreticalMinTime / totalDuration,
        };

        // Identify bottlenecks
        this.identifyBottlenecks();
      }

      const result: StartupResult = {
        success: failedServices.length === 0 || this.config.gracefulDegradation,
        totalDuration,
        groups: groupResults,
        failedServices,
        skippedServices,
        degradedServices,
        startupProfile: this.startupProfile,
      };

      this.emit('orchestrator:startup-complete', { result });

      logger.info('System startup complete', {
        duration: totalDuration,
        failedServices: failedServices.length,
        skippedServices: skippedServices.length,
        degradedServices: degradedServices.length,
        efficiency: this.startupProfile?.parallelizationMetrics.efficiency,
      });

      return result;

    } catch (error) {
      const result: StartupResult = {
        success: false,
        totalDuration: Date.now() - this.startTime,
        groups: groupResults,
        failedServices: Array.from(this.startupMetrics.values())
          .filter(m => m.status === 'failed')
          .map(m => m.serviceName),
        skippedServices: [],
        degradedServices: [],
        startupProfile: this.startupProfile,
      };

      this.emit('orchestrator:startup-complete', { result });
      throw error;
    }
  }

  /**
   * Start a group of services
   */
  @Metric({ name: 'orchestrator.group.startup', recordDuration: true })
  private async startServiceGroup(
    group: ServiceGroup,
    options: StartupOptions
  ): Promise<GroupStartupResult> {
    const groupStartTime = Date.now();
    
    this.emit('orchestrator:group-starting', {
      depth: group.depth,
      services: group.services,
    });

    logger.info(`Starting service group at depth ${group.depth}`, {
      services: group.services,
      parallel: options.parallel,
      timeout: options.timeout,
    });

    const results: ServiceStartupResult[] = [];

    if (options.parallel && this.getParallelismLimit() > 1) {
      // Start services in parallel
      const promises = group.services.map(serviceName =>
        this.startService(serviceName, options)
      );

      const serviceResults = await Promise.allSettled(promises);
      
      for (let i = 0; i < serviceResults.length; i++) {
        const result = serviceResults[i];
        const serviceName = group.services[i];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            serviceName,
            status: 'failed',
            duration: Date.now() - groupStartTime,
            attempts: 1,
            error: result.reason,
          });
        }
      }
    } else {
      // Start services sequentially
      for (const serviceName of group.services) {
        try {
          const result = await this.startService(serviceName, options);
          results.push(result);
        } catch (error) {
          results.push({
            serviceName,
            status: 'failed',
            duration: Date.now() - groupStartTime,
            attempts: 1,
            error: error as Error,
          });

          // Stop on first failure if not graceful degradation
          if (!this.config.gracefulDegradation) {
            break;
          }
        }
      }
    }

    const groupDuration = Date.now() - groupStartTime;
    const parallelEfficiency = this.calculateParallelEfficiency(results, groupDuration);

    const groupResult: GroupStartupResult = {
      groupDepth: group.depth,
      services: results,
      duration: groupDuration,
      parallelEfficiency,
    };

    this.emit('orchestrator:group-completed', {
      depth: group.depth,
      results: groupResult,
    });

    return groupResult;
  }

  /**
   * Start a single service
   */
  private async startService(
    serviceName: string,
    options: StartupOptions
  ): Promise<ServiceStartupResult> {
    const startTime = Date.now();
    const serviceNode = this.dependencyGraph['graph'].get(serviceName);
    
    if (!serviceNode) {
      throw new Error(`Service ${serviceName} not found in dependency graph`);
    }

    const factory = this.serviceFactories.get(serviceName);
    if (!factory) {
      throw new Error(`No factory registered for service ${serviceName}`);
    }

    const retryPolicy = options.retryPolicy || serviceNode.definition.retryPolicy || {
      attempts: 3,
      delay: 2000,
      maxDelay: 10000,
      backoff: 'exponential' as const,
    };

    let lastError: Error | undefined;
    let attempts = 0;

    // Record startup event
    if (this.startupProfile) {
      this.startupProfile.timeline.push({
        timestamp: Date.now() - this.startTime,
        service: serviceName,
        event: 'start',
      });
    }

    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
      attempts = attempt;
      
      this.emit('orchestrator:service-starting', {
        service: serviceName,
        attempt,
      });

      try {
        // Create service instance
        const instance = await Promise.race([
          factory(),
          this.createTimeout(options.timeout || 30000, `Service ${serviceName} startup timeout`),
        ]);

        this.serviceInstances.set(serviceName, instance);

        // Register with service registry if applicable
        if (instance && typeof instance === 'object' && 'getServiceMetadata' in instance) {
          // Service implements metadata interface
          const metadata = (instance as any).getServiceMetadata();
          this.registry.registerService({
            name: serviceName,
            version: metadata.version || '1.0.0',
            type: 'api', // Default type
            status: 'starting',
            endpoints: {
              health: '/health',
              metrics: '/metrics',
            },
            network: {
              host: 'localhost',
              port: 4000 + this.serviceInstances.size, // Incremental port
              protocol: 'http',
            },
            metadata: {
              region: 'local',
              zone: 'local',
              environment: 'development',
              tags: [],
              dependencies: serviceNode.definition.dependencies,
              capabilities: [],
            },
            resources: {
              cpu: 100,
              memory: 256,
              disk: 100,
              connections: 100,
            },
            scaling: {
              minInstances: 1,
              maxInstances: 1,
              currentInstances: 1,
              autoScale: false,
            },
            deployment: {
              strategy: 'rolling',
              rollbackOnFailure: true,
              healthCheckGracePeriod: 5000,
            },
            security: {
              authRequired: false,
              roles: [],
              rateLimit: {
                requests: 1000,
                window: 60000,
              },
            },
          });
        }

        // Perform health check if required
        let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        if (options.healthCheck) {
          health = await this.checkServiceHealth(serviceName, instance);
          
          this.emit('orchestrator:health-check', {
            service: serviceName,
            status: health,
          });
        }

        const duration = Date.now() - startTime;
        
        // Record completion
        if (this.startupProfile) {
          this.startupProfile.timeline.push({
            timestamp: Date.now() - this.startTime,
            service: serviceName,
            event: 'complete',
            duration,
          });
        }

        this.emit('orchestrator:service-started', {
          service: serviceName,
          duration,
        });

        const result: ServiceStartupResult = {
          serviceName,
          status: 'success',
          duration,
          attempts,
          health,
        };

        this.startupMetrics.set(serviceName, result);
        return result;

      } catch (error) {
        lastError = error as Error;
        
        logger.warn(`Service ${serviceName} startup failed (attempt ${attempt}/${retryPolicy.attempts})`, {
          error: lastError.message,
        });

        // Check if we should retry
        if (attempt < retryPolicy.attempts) {
          const shouldRetry = !retryPolicy.retryIf || retryPolicy.retryIf(lastError);
          
          if (shouldRetry) {
            // Calculate delay
            let delay = retryPolicy.delay;
            if (retryPolicy.backoff === 'exponential') {
              delay = Math.min(retryPolicy.delay * Math.pow(2, attempt - 1), retryPolicy.maxDelay);
            } else if (retryPolicy.backoff === 'linear') {
              delay = Math.min(retryPolicy.delay * attempt, retryPolicy.maxDelay);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        // Record failure
        if (this.startupProfile) {
          this.startupProfile.timeline.push({
            timestamp: Date.now() - this.startTime,
            service: serviceName,
            event: 'failed',
          });
        }

        break;
      }
    }

    // All attempts failed
    this.emit('orchestrator:service-failed', {
      service: serviceName,
      error: lastError!,
      attempts,
    });

    const result: ServiceStartupResult = {
      serviceName,
      status: 'failed',
      duration: Date.now() - startTime,
      attempts,
      error: lastError,
    };

    this.startupMetrics.set(serviceName, result);

    // Throw if critical and not graceful degradation
    if (serviceNode.definition.critical && !this.config.gracefulDegradation) {
      throw lastError;
    }

    return result;
  }

  /**
   * Check service health
   */
  private async checkServiceHealth(
    serviceName: string,
    instance: any
  ): Promise<'healthy' | 'degraded' | 'unhealthy'> {
    if (!instance || typeof instance !== 'object') {
      return 'unhealthy';
    }

    // Check if service implements health check
    if ('getHealth' in instance && typeof instance.getHealth === 'function') {
      try {
        const health = await instance.getHealth();
        return health.status;
      } catch (error) {
        logger.warn(`Health check failed for ${serviceName}`, { error });
        return 'unhealthy';
      }
    }

    // Default to healthy if no health check
    return 'healthy';
  }

  /**
   * Get parallelism limit
   */
  private getParallelismLimit(): number {
    if (this.config.parallelism === 'auto') {
      // Use number of CPU cores
      return navigator.hardwareConcurrency || 4;
    }
    return this.config.parallelism;
  }

  /**
   * Calculate parallel efficiency
   */
  private calculateParallelEfficiency(
    results: ServiceStartupResult[],
    groupDuration: number
  ): number {
    if (results.length === 0) return 1;

    const sequentialTime = results.reduce((sum, r) => sum + r.duration, 0);
    return sequentialTime / groupDuration / results.length;
  }

  /**
   * Create timeout promise
   */
  private createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Calculate theoretical minimum startup time
   */
  private calculateTheoreticalMinTime(): number {
    const groups = this.dependencyGraph.getParallelGroups();
    let totalTime = 0;

    for (const group of groups) {
      // Max time in each group (since they run in parallel)
      let maxGroupTime = 0;
      
      for (const serviceName of group.services) {
        const node = this.dependencyGraph['graph'].get(serviceName);
        if (node) {
          const serviceTime = node.definition.startupTimeout || 30000;
          maxGroupTime = Math.max(maxGroupTime, serviceTime);
        }
      }
      
      totalTime += maxGroupTime;
    }

    return totalTime;
  }

  /**
   * Identify startup bottlenecks
   */
  private identifyBottlenecks(): void {
    if (!this.startupProfile) return;

    const bottlenecks: Array<{ service: string; duration: number; reason: string }> = [];

    // Find services that took longer than expected
    for (const [serviceName, result] of this.startupMetrics.entries()) {
      const node = this.dependencyGraph['graph'].get(serviceName);
      if (!node) continue;

      const expectedTime = node.definition.startupTimeout || 30000;
      
      if (result.duration > expectedTime * 1.2) {
        bottlenecks.push({
          service: serviceName,
          duration: result.duration,
          reason: 'Exceeded expected startup time',
        });
      }

      if (result.attempts > 1) {
        bottlenecks.push({
          service: serviceName,
          duration: result.duration,
          reason: `Required ${result.attempts} attempts`,
        });
      }
    }

    // Find critical path services
    const criticalPath = this.dependencyGraph.getCriticalPath();
    for (const serviceName of criticalPath) {
      const result = this.startupMetrics.get(serviceName);
      if (result && result.duration > 10000) {
        bottlenecks.push({
          service: serviceName,
          duration: result.duration,
          reason: 'On critical path',
        });
      }
    }

    this.startupProfile.bottlenecks = bottlenecks;
  }

  /**
   * Get service instance
   */
  getServiceInstance<T = any>(serviceName: string): T | undefined {
    return this.serviceInstances.get(serviceName);
  }

  /**
   * Get all service instances
   */
  getAllServiceInstances(): Map<string, any> {
    return new Map(this.serviceInstances);
  }

  /**
   * Execute progressive startup with stages
   */
  async executeProgressiveStartup(stages: StartupStage[]): Promise<StartupResult> {
    const stageResults: GroupStartupResult[] = [];
    let overallSuccess = true;

    for (const stage of stages) {
      this.emit('orchestrator:stage-starting', { stage: stage.name });

      try {
        // Create temporary group for stage
        const group: ServiceGroup = {
          services: stage.services,
          depth: stageResults.length,
          timeout: stage.timeout || 60000,
          critical: !stage.skipOnTimeout,
        };

        const result = await this.startServiceGroup(group, {
          parallel: true,
          healthCheck: true,
          timeout: group.timeout,
        });

        stageResults.push(result);

        // Check health gate if defined
        if (stage.healthGate) {
          const gateResult = await this.checkHealthGate(stage.healthGate);
          
          if (!gateResult.passed) {
            if (stage.rollbackOnFailure) {
              // TODO: Implement rollback
              logger.error(`Health gate failed for stage ${stage.name}, rollback not yet implemented`);
            }
            
            if (!stage.skipOnTimeout) {
              throw new Error(`Health gate failed for stage ${stage.name}`);
            }
          }
        }

        this.emit('orchestrator:stage-completed', {
          stage: stage.name,
          success: true,
        });

      } catch (error) {
        logger.error(`Stage ${stage.name} failed`, { error });
        
        this.emit('orchestrator:stage-completed', {
          stage: stage.name,
          success: false,
        });

        if (!stage.skipOnTimeout) {
          overallSuccess = false;
          break;
        }
      }
    }

    // Return aggregated results
    return {
      success: overallSuccess,
      totalDuration: Date.now() - this.startTime,
      groups: stageResults,
      failedServices: Array.from(this.startupMetrics.values())
        .filter(m => m.status === 'failed')
        .map(m => m.serviceName),
      skippedServices: Array.from(this.startupMetrics.values())
        .filter(m => m.status === 'skipped')
        .map(m => m.serviceName),
      degradedServices: Array.from(this.startupMetrics.values())
        .filter(m => m.health === 'degraded')
        .map(m => m.serviceName),
      startupProfile: this.startupProfile,
    };
  }

  /**
   * Check health gate
   */
  private async checkHealthGate(gate: HealthGate): Promise<{ passed: boolean; failures: string[] }> {
    const failures: string[] = [];

    // Check required services
    for (const serviceName of gate.required) {
      const instance = this.serviceInstances.get(serviceName);
      const health = await this.checkServiceHealth(serviceName, instance);
      
      if (health === 'unhealthy') {
        failures.push(serviceName);
      }
    }

    // Check optional services (just log warnings)
    if (gate.optional) {
      for (const serviceName of gate.optional) {
        const instance = this.serviceInstances.get(serviceName);
        const health = await this.checkServiceHealth(serviceName, instance);
        
        if (health === 'unhealthy') {
          logger.warn(`Optional service ${serviceName} is unhealthy`);
        }
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }

  /**
   * Health check for orchestrator
   */
  @HealthCheck({
    name: 'orchestrator:status',
    critical: false,
    interval: 60000,
  })
  async checkOrchestratorHealth(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const stats = this.dependencyGraph.getStatistics();
    const validation = this.dependencyGraph.validateGraph();

    if (!validation.valid) {
      return {
        status: 'degraded',
        message: `Dependency graph invalid: ${validation.errors.join(', ')}`,
      };
    }

    return {
      status: 'healthy',
      message: `Managing ${stats.totalServices} services with ${stats.criticalServices} critical`,
    };
  }
}