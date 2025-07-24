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
        bottleneckFrequency.set(\n          bottleneck.service,\n          (bottleneckFrequency.get(bottleneck.service) || 0) + 1\n        );\n        totalBottleneckTime += bottleneck.duration;\n      }\n    }\n\n    // Identify chronic bottlenecks\n    const chronicBottlenecks = Array.from(bottleneckFrequency.entries())\n      .filter(([_, count]) => count > profiles.length * 0.5)\n      .map(([service]) => service);\n\n    if (chronicBottlenecks.length > 0) {\n      recommendations.push(\n        `Chronic bottlenecks detected: ${chronicBottlenecks.join(', ')}. Consider increasing timeouts or optimizing these services.`\n      );\n    }\n\n    // Analyze parallel efficiency\n    const avgParallelEfficiency = profiles.reduce((sum, p) => sum + p.parallelEfficiency, 0) / profiles.length;\n    \n    if (avgParallelEfficiency < 60) {\n      recommendations.push(\n        `Low parallel efficiency (${avgParallelEfficiency.toFixed(1)}%). Consider restructuring dependency graph to enable more parallelism.`\n      );\n    }\n\n    // Analyze stage durations\n    const stageStats = new Map<string, { totalTime: number; count: number; failures: number }>();\n    \n    for (const profile of profiles) {\n      for (const stage of profile.stages) {\n        if (!stageStats.has(stage.name)) {\n          stageStats.set(stage.name, { totalTime: 0, count: 0, failures: 0 });\n        }\n        \n        const stats = stageStats.get(stage.name)!;\n        stats.totalTime += stage.duration;\n        stats.count++;\n        if (!stage.success) stats.failures++;\n      }\n    }\n\n    // Generate optimized stages based on analysis\n    const dependencies = this.dependencyGraph.topologicalSort();\n    \n    // Group services by dependency level for better parallelism\n    const levelGroups = new Map<number, string[]>();\n    for (const group of dependencies) {\n      levelGroups.set(group.level, group.services);\n    }\n\n    for (const [level, services] of levelGroups) {\n      // Create stage for this dependency level\n      const stageName = `auto-level-${level}`;\n      const stageServices = services.filter(s => this.registry.get(s));\n      \n      if (stageServices.length > 0) {\n        optimizedStages.push({\n          name: stageName,\n          services: stageServices,\n          healthGate: {\n            required: stageServices.filter(s => {\n              const def = this.getServiceDefinition(s);\n              return def?.critical;\n            }),\n            optional: stageServices.filter(s => {\n              const def = this.getServiceDefinition(s);\n              return !def?.critical;\n            }),\n            timeout: 30000,\n          },\n          timeout: Math.max(...stageServices.map(s => {\n            const def = this.getServiceDefinition(s);\n            return def?.timeout || 30000;\n          })) + 10000, // Add buffer\n          retryPolicy: {\n            attempts: 2,\n            delay: 5000,\n            backoff: 'exponential',\n          },\n        });\n      }\n    }\n\n    // Calculate expected improvement\n    const avgCurrentDuration = profiles.reduce((sum, p) => sum + p.totalDuration, 0) / profiles.length;\n    const criticalPath = this.dependencyGraph.calculateCriticalPath();\n    const expectedImprovement = Math.max(0, ((avgCurrentDuration - criticalPath.totalTime) / avgCurrentDuration) * 100);\n\n    recommendations.push(\n      `Estimated startup time improvement: ${expectedImprovement.toFixed(1)}% (from ${avgCurrentDuration}ms to ~${criticalPath.totalTime}ms)`\n    );\n\n    return {\n      recommendations,\n      optimizedStages,\n      expectedImprovement,\n    };\n  }\n\n  private async executeStage(\n    stage: StartupStage,\n    options: { parallel: boolean; skipOptional: boolean }\n  ): Promise<void> {\n    const { parallel, skipOptional } = options;\n    const stageServices = stage.services.filter(name => this.registry.get(name));\n    \n    if (stageServices.length === 0) {\n      logger.warn(`No services found for stage: ${stage.name}`);\n      return;\n    }\n\n    // Determine execution strategy based on dependencies\n    const groups = this.getServiceGroups(stageServices);\n    \n    for (const group of groups) {\n      if (parallel && group.length > 1) {\n        // Start services in parallel\n        await Promise.all(\n          group.map(serviceName => this.startServiceWithRetry(serviceName, stage))\n        );\n      } else {\n        // Start services sequentially\n        for (const serviceName of group) {\n          await this.startServiceWithRetry(serviceName, stage);\n        }\n      }\n    }\n  }\n\n  private async startServiceWithRetry(\n    serviceName: string,\n    stage: StartupStage\n  ): Promise<void> {\n    const startTime = Date.now();\n    const retryPolicy = stage.retryPolicy || { attempts: 1, delay: 0, backoff: 'linear' };\n    \n    this.emit('service:startup-started', {\n      service: serviceName,\n      stage: stage.name,\n    });\n\n    let lastError: Error | null = null;\n    \n    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {\n      try {\n        // Add artificial delay for retry attempts\n        if (attempt > 1) {\n          const delay = retryPolicy.backoff === 'exponential'\n            ? retryPolicy.delay * Math.pow(2, attempt - 2)\n            : retryPolicy.delay * (attempt - 1);\n          \n          logger.info(`Retrying ${serviceName} (attempt ${attempt}/${retryPolicy.attempts}) after ${delay}ms`);\n          await new Promise(resolve => setTimeout(resolve, delay));\n        }\n\n        await this.registry.startService(serviceName);\n        \n        const duration = Date.now() - startTime;\n        \n        this.emit('service:startup-completed', {\n          service: serviceName,\n          stage: stage.name,\n          duration,\n        });\n\n        logger.info(`✅ Service started: ${serviceName} (${duration}ms, attempt ${attempt})`);\n        return;\n\n      } catch (error) {\n        lastError = error as Error;\n        logger.warn(`Failed to start ${serviceName} (attempt ${attempt}/${retryPolicy.attempts})`, { error });\n      }\n    }\n\n    const duration = Date.now() - startTime;\n    \n    this.emit('service:startup-failed', {\n      service: serviceName,\n      stage: stage.name,\n      duration,\n      error: lastError!,\n    });\n\n    throw new Error(`Failed to start ${serviceName} after ${retryPolicy.attempts} attempts: ${lastError?.message}`);\n  }\n\n  private async checkHealthGate(stage: StartupStage): Promise<void> {\n    const { required, optional = [], timeout = 30000 } = stage.healthGate;\n    const startTime = Date.now();\n    \n    this.emit('health-gate:checking', {\n      stage: stage.name,\n      required,\n      optional,\n    });\n\n    logger.info(`🔍 Checking health gate for stage: ${stage.name}`, { required, optional });\n\n    const checkHealth = async (): Promise<{ healthy: string[]; unhealthy: string[] }> => {\n      const healthy: string[] = [];\n      const unhealthy: string[] = [];\n      \n      const allServices = [...required, ...optional];\n      \n      for (const serviceName of allServices) {\n        try {\n          const service = this.registry.get(serviceName);\n          if (service) {\n            const health = await service.getHealth();\n            if (health.status === 'healthy') {\n              healthy.push(serviceName);\n            } else {\n              unhealthy.push(serviceName);\n            }\n          } else {\n            unhealthy.push(serviceName);\n          }\n        } catch (error) {\n          unhealthy.push(serviceName);\n        }\n      }\n      \n      return { healthy, unhealthy };\n    };\n\n    // Poll health status until timeout\n    while (Date.now() - startTime < timeout) {\n      const { healthy, unhealthy } = await checkHealth();\n      \n      // Check if all required services are healthy\n      const requiredHealthy = required.every(service => healthy.includes(service));\n      \n      if (requiredHealthy) {\n        const duration = Date.now() - startTime;\n        \n        this.emit('health-gate:passed', {\n          stage: stage.name,\n          duration,\n        });\n\n        logger.info(`✅ Health gate passed for stage: ${stage.name} (${duration}ms)`);\n        return;\n      }\n      \n      // Wait before next check\n      await new Promise(resolve => setTimeout(resolve, 1000));\n    }\n\n    // Health gate failed\n    const { healthy, unhealthy } = await checkHealth();\n    const duration = Date.now() - startTime;\n    \n    this.emit('health-gate:failed', {\n      stage: stage.name,\n      duration,\n      unhealthy,\n    });\n\n    const unhealthyRequired = required.filter(service => unhealthy.includes(service));\n    \n    if (unhealthyRequired.length > 0) {\n      throw new Error(\n        `Health gate failed for stage ${stage.name}: unhealthy required services: ${unhealthyRequired.join(', ')}`\n      );\n    }\n  }\n\n  private getServiceGroups(services: string[]): string[][] {\n    // Group services that can be started in parallel\n    const groups: string[][] = [];\n    const remaining = new Set(services);\n    \n    while (remaining.size > 0) {\n      const group: string[] = [];\n      \n      for (const service of remaining) {\n        const deps = this.dependencyGraph.getDependencies(service);\n        const hasUnstartedDeps = deps.required.some(dep => remaining.has(dep));\n        \n        if (!hasUnstartedDeps) {\n          group.push(service);\n        }\n      }\n      \n      if (group.length === 0) {\n        // Break circular dependency or missing service\n        group.push(Array.from(remaining)[0]);\n      }\n      \n      groups.push(group);\n      group.forEach(service => remaining.delete(service));\n    }\n    \n    return groups;\n  }\n\n  private async generateProfile(totalDuration: number, success: boolean): Promise<StartupProfile> {\n    // Analyze bottlenecks\n    const bottlenecks: StartupProfile['bottlenecks'] = [];\n    const serviceTimings = new Map<string, { duration: number; stage: string }>();\n    \n    for (const stage of this.profile.stages || []) {\n      for (const service of stage.services) {\n        if (service.duration > 10000) { // Services taking more than 10s\n          bottlenecks.push({\n            service: service.name,\n            duration: service.duration,\n            stage: stage.name,\n          });\n        }\n        serviceTimings.set(service.name, {\n          duration: service.duration,\n          stage: stage.name,\n        });\n      }\n    }\n\n    // Calculate parallel efficiency\n    const criticalPath = this.dependencyGraph.calculateCriticalPath();\n    const parallelEfficiency = criticalPath.totalTime > 0\n      ? (criticalPath.totalTime / totalDuration) * 100\n      : 0;\n\n    // Generate recommendations\n    const recommendations: string[] = [];\n    \n    if (parallelEfficiency < 50) {\n      recommendations.push('Consider restructuring dependencies to enable more parallel execution');\n    }\n    \n    if (bottlenecks.length > 0) {\n      recommendations.push(`Optimize slow services: ${bottlenecks.map(b => b.service).join(', ')}`);\n    }\n    \n    if (totalDuration > 120000) { // More than 2 minutes\n      recommendations.push('Overall startup time is high. Consider lazy loading non-critical services');\n    }\n\n    return {\n      totalDuration,\n      stages: this.profile.stages || [],\n      bottlenecks,\n      parallelEfficiency,\n      recommendations,\n    };\n  }\n\n  private initializeDefaultServices(): void {\n    // Add default service definitions to dependency graph\n    for (const definition of DEFAULT_SERVICE_DEFINITIONS) {\n      this.dependencyGraph.addService(definition);\n    }\n  }\n\n  private getServiceDefinition(name: string): ServiceDefinition | undefined {\n    return this.dependencyGraph.getService(name);\n  }\n}\n\n/**\n * Default startup stages configuration\n */\nexport const DEFAULT_STARTUP_STAGES: StartupStage[] = [\n  {\n    name: 'core-infrastructure',\n    services: ['prisma-service', 'cache-manager', 'message-broker'],\n    healthGate: {\n      required: ['prisma-service'],\n      optional: ['cache-manager', 'message-broker'],\n      timeout: 60000,\n    },\n    timeout: 60000,\n    retryPolicy: {\n      attempts: 3,\n      delay: 5000,\n      backoff: 'exponential',\n    },\n  },\n  {\n    name: 'event-system',\n    services: ['event-store', 'cqrs-coordinator', 'read-model-manager'],\n    healthGate: {\n      required: ['event-store', 'cqrs-coordinator'],\n      optional: ['read-model-manager'],\n      timeout: 45000,\n    },\n    timeout: 45000,\n    retryPolicy: {\n      attempts: 2,\n      delay: 3000,\n      backoff: 'exponential',\n    },\n  },\n  {\n    name: 'microservices-infrastructure',\n    services: ['service-registry', 'service-mesh', 'api-gateway'],\n    healthGate: {\n      required: ['service-registry', 'service-mesh'],\n      optional: ['api-gateway'],\n      timeout: 30000,\n    },\n    timeout: 30000,\n    retryPolicy: {\n      attempts: 2,\n      delay: 2000,\n      backoff: 'linear',\n    },\n  },\n  {\n    name: 'optional-features',\n    services: ['vector-store', 'embedding-service', 'nlp-service', 'rag-service'],\n    healthGate: {\n      required: [],\n      optional: ['vector-store', 'embedding-service', 'nlp-service', 'rag-service'],\n      timeout: 60000,\n    },\n    timeout: 60000,\n    skipOnTimeout: true,\n    retryPolicy: {\n      attempts: 1,\n      delay: 0,\n      backoff: 'linear',\n    },\n  },\n  {\n    name: 'monitoring-and-management',\n    services: ['service-dashboard', 'chaos-engineering'],\n    healthGate: {\n      required: [],\n      optional: ['service-dashboard', 'chaos-engineering'],\n      timeout: 30000,\n    },\n    timeout: 30000,\n    skipOnTimeout: true,\n    retryPolicy: {\n      attempts: 1,\n      delay: 0,\n      backoff: 'linear',\n    },\n  },\n];