import { EnhancedServiceRegistry } from './ServiceRegistry.enhanced.js';
import { ServiceDependencyGraph, ServiceDefinition, DEFAULT_SERVICE_DEFINITIONS } from './ServiceDependencyGraph.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';
import type { HealthStatus } from './BaseService.js';

export interface StartupStage {
  name: string;
  services: string[];
  healthGate: {
    required: string[];
    optional?: string[];
    timeout?: number;
  };
  timeout: number;
  skipOnTimeout?: boolean;
  retryPolicy?: {
    attempts: number;
    delay: number;
    backoff: 'linear' | 'exponential';
  };
}

export interface StartupProfile {
  totalDuration: number;
  stages: Array<{
    name: string;
    duration: number;
    success: boolean;
    services: Array<{
      name: string;
      duration: number;
      status: 'success' | 'failed' | 'timeout' | 'skipped';
      error?: string;
    }>;
  }>;
  bottlenecks: Array<{
    service: string;
    duration: number;
    stage: string;
  }>;
  parallelEfficiency: number; // percentage
  recommendations: string[];
}

interface StartupOrchestratorEventMap {
  'startup:started': {
    timestamp: Date;
    stages: number;
    services: number;
  };
  'startup:completed': {
    timestamp: Date;
    duration: number;
    profile: StartupProfile;
  };
  'startup:failed': {
    timestamp: Date;
    duration: number;
    error: Error;
    partialProfile: Partial<StartupProfile>;
  };
  'stage:started': {
    stage: string;
    services: string[];
  };
  'stage:completed': {
    stage: string;
    duration: number;
    success: boolean;
  };
  'stage:failed': {
    stage: string;
    duration: number;
    error: Error;
  };
  'service:startup-started': {
    service: string;
    stage: string;
  };
  'service:startup-completed': {
    service: string;
    stage: string;
    duration: number;
  };
  'service:startup-failed': {
    service: string;
    stage: string;
    duration: number;
    error: Error;
  };
  'health-gate:checking': {
    stage: string;
    required: string[];
    optional: string[];
  };
  'health-gate:passed': {
    stage: string;
    duration: number;
  };
  'health-gate:failed': {
    stage: string;
    duration: number;
    unhealthy: string[];
  };
  'optimization:recommendation': {
    type: 'parallel' | 'dependency' | 'timeout' | 'resource';
    message: string;
    impact: 'low' | 'medium' | 'high';
  };
}

/**
 * Startup Orchestrator for progressive service initialization
 * Provides dependency-based startup with health gates and performance profiling
 */
export class StartupOrchestrator extends TypedEventEmitter<StartupOrchestratorEventMap> {
  private registry: EnhancedServiceRegistry;
  private dependencyGraph: ServiceDependencyGraph;
  private profile: Partial<StartupProfile> = {};
  private startTime: number = 0;

  constructor() {
    super();
    this.registry = EnhancedServiceRegistry.getInstance();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.initializeDefaultServices();
  }

  /**
   * Start all services using configured stages
   */
  async startup(stages: StartupStage[], options?: {
    parallel?: boolean;
    skipOptional?: boolean;
    abortOnFailure?: boolean;
  }): Promise<StartupProfile> {
    const { parallel = true, skipOptional = false, abortOnFailure = false } = options || {};
    
    this.startTime = Date.now();
    this.profile = {
      stages: [],
      bottlenecks: [],
      recommendations: [],
    };

    logger.info('🚀 Starting service orchestration...', {
      stages: stages.length,
      services: this.registry.getAllServices().size,
      parallel,
      skipOptional,
    });

    this.emit('startup:started', {
      timestamp: new Date(),
      stages: stages.length,
      services: this.registry.getAllServices().size,
    });

    try {
      // Execute stages sequentially
      for (const stage of stages) {
        const stageStartTime = Date.now();
        
        this.emit('stage:started', {
          stage: stage.name,
          services: stage.services,
        });

        try {
          await this.executeStage(stage, { parallel, skipOptional });
          
          // Health gate check
          await this.checkHealthGate(stage);
          
          const stageDuration = Date.now() - stageStartTime;
          
          this.profile.stages!.push({
            name: stage.name,
            duration: stageDuration,
            success: true,
            services: [], // Will be populated by service events
          });

          this.emit('stage:completed', {
            stage: stage.name,
            duration: stageDuration,
            success: true,
          });

          logger.info(`✅ Stage completed: ${stage.name} (${stageDuration}ms)`);

        } catch (error) {
          const stageDuration = Date.now() - stageStartTime;
          
          this.profile.stages!.push({
            name: stage.name,
            duration: stageDuration,
            success: false,
            services: [],
          });

          this.emit('stage:failed', {
            stage: stage.name,
            duration: stageDuration,
            error: error as Error,
          });

          if (abortOnFailure || (!stage.skipOnTimeout && error instanceof Error)) {
            throw error;
          } else {
            logger.warn(`⚠️ Stage failed but continuing: ${stage.name}`, { error });
          }
        }
      }

      // Finalize profile
      const totalDuration = Date.now() - this.startTime;
      const finalProfile = await this.generateProfile(totalDuration, true);

      this.emit('startup:completed', {
        timestamp: new Date(),
        duration: totalDuration,
        profile: finalProfile,
      });

      logger.info(`🎉 Startup completed successfully in ${totalDuration}ms`);
      return finalProfile;

    } catch (error) {
      const totalDuration = Date.now() - this.startTime;
      const partialProfile = await this.generateProfile(totalDuration, false);

      this.emit('startup:failed', {
        timestamp: new Date(),
        duration: totalDuration,
        error: error as Error,
        partialProfile,
      });

      logger.error(`❌ Startup failed after ${totalDuration}ms`, { error });
      throw error;
    }
  }

  /**
   * Restart the entire system
   */
  async restart(stages: StartupStage[], reason: string = 'restart'): Promise<StartupProfile> {
    logger.info('♻️ Restarting system...', { reason });

    // Stop all services first
    await this.registry.stopAll(reason);

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start up again
    return this.startup(stages);
  }

  /**
   * Perform rolling restart of specific services
   */
  async rollingRestart(serviceNames: string[], options?: {
    batchSize?: number;
    delay?: number;
  }): Promise<void> {
    const { batchSize = 3, delay = 5000 } = options || {};
    
    logger.info('🔄 Performing rolling restart...', {
      services: serviceNames,
      batchSize,
      delay,
    });

    // Process services in batches
    for (let i = 0; i < serviceNames.length; i += batchSize) {
      const batch = serviceNames.slice(i, i + batchSize);
      
      logger.info(`Restarting batch: ${batch.join(', ')}`);
      
      // Restart batch in parallel
      await Promise.all(
        batch.map(serviceName => this.registry.restartService(serviceName, 'rolling-restart'))
      );

      // Wait between batches (except for the last one)
      if (i + batchSize < serviceNames.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.info('✅ Rolling restart completed');
  }

  /**
   * Optimize startup configuration based on profiling data
   */
  optimizeStartup(profiles: StartupProfile[]): {
    recommendations: string[];
    optimizedStages: StartupStage[];
    expectedImprovement: number; // percentage
  } {
    const recommendations: string[] = [];
    const optimizedStages: StartupStage[] = [];
    
    // Analyze bottlenecks across profiles
    const bottleneckFrequency = new Map<string, number>();
    let totalBottleneckTime = 0;
    
    for (const profile of profiles) {
      for (const bottleneck of profile.bottlenecks) {
        bottleneckFrequency.set(
          bottleneck.service,
          (bottleneckFrequency.get(bottleneck.service) || 0) + 1
        );
        totalBottleneckTime += bottleneck.duration;
      }
    }

    // Identify chronic bottlenecks
    const chronicBottlenecks = Array.from(bottleneckFrequency.entries())
      .filter(([_, count]) => count > profiles.length * 0.5)
      .map(([service]) => service);

    if (chronicBottlenecks.length > 0) {
      recommendations.push(
        `Chronic bottlenecks detected: ${chronicBottlenecks.join(', ')}. Consider increasing timeouts or optimizing these services.`
      );
    }

    // Analyze parallel efficiency
    const avgParallelEfficiency = profiles.reduce((sum, p) => sum + p.parallelEfficiency, 0) / profiles.length;
    
    if (avgParallelEfficiency < 60) {
      recommendations.push(
        `Low parallel efficiency (${avgParallelEfficiency.toFixed(1)}%). Consider restructuring dependency graph to enable more parallelism.`
      );
    }

    // Analyze stage durations
    const stageStats = new Map<string, { totalTime: number; count: number; failures: number }>();
    
    for (const profile of profiles) {
      for (const stage of profile.stages) {
        if (!stageStats.has(stage.name)) {
          stageStats.set(stage.name, { totalTime: 0, count: 0, failures: 0 });
        }
        
        const stats = stageStats.get(stage.name)!;
        stats.totalTime += stage.duration;
        stats.count++;
        if (!stage.success) stats.failures++;
      }
    }

    // Generate optimized stages based on analysis
    const dependencies = this.dependencyGraph.topologicalSort();
    
    // Group services by dependency level for better parallelism
    const levelGroups = new Map<number, string[]>();
    for (const group of dependencies) {
      levelGroups.set(group.level, group.services);
    }

    for (const [level, services] of levelGroups) {
      // Create stage for this dependency level
      const stageName = `auto-level-${level}`;
      const stageServices = services.filter(s => this.registry.get(s));
      
      if (stageServices.length > 0) {
        optimizedStages.push({
          name: stageName,
          services: stageServices,
          healthGate: {
            required: stageServices.filter(s => {
              const def = this.getServiceDefinition(s);
              return def?.critical;
            }),
            optional: stageServices.filter(s => {
              const def = this.getServiceDefinition(s);
              return !def?.critical;
            }),
            timeout: 30000,
          },
          timeout: Math.max(...stageServices.map(s => {
            const def = this.getServiceDefinition(s);
            return def?.timeout || 30000;
          })) + 10000, // Add buffer
          retryPolicy: {
            attempts: 2,
            delay: 5000,
            backoff: 'exponential',
          },
        });
      }
    }

    // Calculate expected improvement
    const avgCurrentDuration = profiles.reduce((sum, p) => sum + p.totalDuration, 0) / profiles.length;
    const criticalPath = this.dependencyGraph.calculateCriticalPath();
    const expectedImprovement = Math.max(0, ((avgCurrentDuration - criticalPath.totalTime) / avgCurrentDuration) * 100);

    recommendations.push(
      `Estimated startup time improvement: ${expectedImprovement.toFixed(1)}% (from ${avgCurrentDuration}ms to ~${criticalPath.totalTime}ms)`
    );

    return {
      recommendations,
      optimizedStages,
      expectedImprovement,
    };
  }

  private async executeStage(
    stage: StartupStage,
    options: { parallel: boolean; skipOptional: boolean }
  ): Promise<void> {
    const { parallel, skipOptional } = options;
    const stageServices = stage.services.filter(name => this.registry.get(name));
    
    if (stageServices.length === 0) {
      logger.warn(`No services found for stage: ${stage.name}`);
      return;
    }

    // Determine execution strategy based on dependencies
    const groups = this.getServiceGroups(stageServices);
    
    for (const group of groups) {
      if (parallel && group.length > 1) {
        // Start services in parallel
        await Promise.all(
          group.map(serviceName => this.startServiceWithRetry(serviceName, stage))
        );
      } else {
        // Start services sequentially
        for (const serviceName of group) {
          await this.startServiceWithRetry(serviceName, stage);
        }
      }
    }
  }

  private async startServiceWithRetry(
    serviceName: string,
    stage: StartupStage
  ): Promise<void> {
    const startTime = Date.now();
    const retryPolicy = stage.retryPolicy || { attempts: 1, delay: 0, backoff: 'linear' };
    
    this.emit('service:startup-started', {
      service: serviceName,
      stage: stage.name,
    });

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
      try {
        // Add artificial delay for retry attempts
        if (attempt > 1) {
          const delay = retryPolicy.backoff === 'exponential'
            ? retryPolicy.delay * Math.pow(2, attempt - 2)
            : retryPolicy.delay * (attempt - 1);
          
          logger.info(`Retrying ${serviceName} (attempt ${attempt}/${retryPolicy.attempts}) after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        await this.registry.startService(serviceName);
        
        const duration = Date.now() - startTime;
        
        this.emit('service:startup-completed', {
          service: serviceName,
          stage: stage.name,
          duration,
        });

        logger.info(`✅ Service started: ${serviceName} (${duration}ms, attempt ${attempt})`);
        return;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Failed to start ${serviceName} (attempt ${attempt}/${retryPolicy.attempts})`, { error });
      }
    }

    const duration = Date.now() - startTime;
    
    this.emit('service:startup-failed', {
      service: serviceName,
      stage: stage.name,
      duration,
      error: lastError!,
    });

    throw new Error(`Failed to start ${serviceName} after ${retryPolicy.attempts} attempts: ${lastError?.message}`);
  }

  private async checkHealthGate(stage: StartupStage): Promise<void> {
    const { required, optional = [], timeout = 30000 } = stage.healthGate;
    const startTime = Date.now();
    
    this.emit('health-gate:checking', {
      stage: stage.name,
      required,
      optional,
    });

    logger.info(`🔍 Checking health gate for stage: ${stage.name}`, { required, optional });

    const checkHealth = async (): Promise<{ healthy: string[]; unhealthy: string[] }> => {
      const healthy: string[] = [];
      const unhealthy: string[] = [];
      
      const allServices = [...required, ...optional];
      
      for (const serviceName of allServices) {
        try {
          const service = this.registry.get(serviceName);
          if (service) {
            const health = await service.getHealth();
            if (health.status === 'healthy') {
              healthy.push(serviceName);
            } else {
              unhealthy.push(serviceName);
            }
          } else {
            unhealthy.push(serviceName);
          }
        } catch (error) {
          unhealthy.push(serviceName);
        }
      }
      
      return { healthy, unhealthy };
    };

    // Poll health status until timeout
    while (Date.now() - startTime < timeout) {
      const { healthy, unhealthy } = await checkHealth();
      
      // Check if all required services are healthy
      const requiredHealthy = required.every(service => healthy.includes(service));
      
      if (requiredHealthy) {
        const duration = Date.now() - startTime;
        
        this.emit('health-gate:passed', {
          stage: stage.name,
          duration,
        });

        logger.info(`✅ Health gate passed for stage: ${stage.name} (${duration}ms)`);
        return;
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Health gate failed
    const { healthy, unhealthy } = await checkHealth();
    const duration = Date.now() - startTime;
    
    this.emit('health-gate:failed', {
      stage: stage.name,
      duration,
      unhealthy,
    });

    const unhealthyRequired = required.filter(service => unhealthy.includes(service));
    
    if (unhealthyRequired.length > 0) {
      throw new Error(
        `Health gate failed for stage ${stage.name}: unhealthy required services: ${unhealthyRequired.join(', ')}`
      );
    }
  }

  private getServiceGroups(services: string[]): string[][] {
    // Group services that can be started in parallel
    const groups: string[][] = [];
    const remaining = new Set(services);
    
    while (remaining.size > 0) {
      const group: string[] = [];
      
      for (const service of remaining) {
        const deps = this.dependencyGraph.getDependencies(service);
        const hasUnstartedDeps = deps.required.some(dep => remaining.has(dep));
        
        if (!hasUnstartedDeps) {
          group.push(service);
        }
      }
      
      if (group.length === 0) {
        // Break circular dependency or missing service
        group.push(Array.from(remaining)[0]);
      }
      
      groups.push(group);
      group.forEach(service => remaining.delete(service));
    }
    
    return groups;
  }

  private async generateProfile(totalDuration: number, success: boolean): Promise<StartupProfile> {
    // Analyze bottlenecks
    const bottlenecks: StartupProfile['bottlenecks'] = [];
    const serviceTimings = new Map<string, { duration: number; stage: string }>();
    
    for (const stage of this.profile.stages || []) {
      for (const service of stage.services) {
        if (service.duration > 10000) { // Services taking more than 10s
          bottlenecks.push({
            service: service.name,
            duration: service.duration,
            stage: stage.name,
          });
        }
        serviceTimings.set(service.name, {
          duration: service.duration,
          stage: stage.name,
        });
      }
    }

    // Calculate parallel efficiency
    const criticalPath = this.dependencyGraph.calculateCriticalPath();
    const parallelEfficiency = criticalPath.totalTime > 0
      ? (criticalPath.totalTime / totalDuration) * 100
      : 0;

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (parallelEfficiency < 50) {
      recommendations.push('Consider restructuring dependencies to enable more parallel execution');
    }
    
    if (bottlenecks.length > 0) {
      recommendations.push(`Optimize slow services: ${bottlenecks.map(b => b.service).join(', ')}`);
    }
    
    if (totalDuration > 120000) { // More than 2 minutes
      recommendations.push('Overall startup time is high. Consider lazy loading non-critical services');
    }

    return {
      totalDuration,
      stages: this.profile.stages || [],
      bottlenecks,
      parallelEfficiency,
      recommendations,
    };
  }

  private initializeDefaultServices(): void {
    // Add default service definitions to dependency graph
    for (const definition of DEFAULT_SERVICE_DEFINITIONS) {
      this.dependencyGraph.addService(definition);
    }
  }

  private getServiceDefinition(name: string): ServiceDefinition | undefined {
    return this.dependencyGraph.getService(name);
  }
}

/**
 * Default startup stages configuration
 */
export const DEFAULT_STARTUP_STAGES: StartupStage[] = [
  {
    name: 'core-infrastructure',
    services: ['prisma-service', 'cache-manager', 'message-broker'],
    healthGate: {
      required: ['prisma-service'],
      optional: ['cache-manager', 'message-broker'],
      timeout: 60000,
    },
    timeout: 60000,
    retryPolicy: {
      attempts: 3,
      delay: 5000,
      backoff: 'exponential',
    },
  },
  {
    name: 'event-system',
    services: ['event-store', 'cqrs-coordinator', 'read-model-manager'],
    healthGate: {
      required: ['event-store', 'cqrs-coordinator'],
      optional: ['read-model-manager'],
      timeout: 45000,
    },
    timeout: 45000,
    retryPolicy: {
      attempts: 2,
      delay: 3000,
      backoff: 'exponential',
    },
  },
  {
    name: 'microservices-infrastructure',
    services: ['service-registry', 'service-mesh', 'api-gateway'],
    healthGate: {
      required: ['service-registry', 'service-mesh'],
      optional: ['api-gateway'],
      timeout: 30000,
    },
    timeout: 30000,
    retryPolicy: {
      attempts: 2,
      delay: 2000,
      backoff: 'linear',
    },
  },
  {
    name: 'optional-features',
    services: ['vector-store', 'embedding-service', 'nlp-service', 'rag-service'],
    healthGate: {
      required: [],
      optional: ['vector-store', 'embedding-service', 'nlp-service', 'rag-service'],
      timeout: 60000,
    },
    timeout: 60000,
    skipOnTimeout: true,
    retryPolicy: {
      attempts: 1,
      delay: 0,
      backoff: 'linear',
    },
  },
  {
    name: 'monitoring-and-management',
    services: ['service-dashboard', 'chaos-engineering'],
    healthGate: {
      required: [],
      optional: ['service-dashboard', 'chaos-engineering'],
      timeout: 30000,
    },
    timeout: 30000,
    skipOnTimeout: true,
    retryPolicy: {
      attempts: 1,
      delay: 0,
      backoff: 'linear',
    },
  },
];