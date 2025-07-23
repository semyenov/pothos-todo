import { z } from 'zod';
import { BaseService } from './core/BaseService.js';
import { CombinedEventMap } from './core/ServiceEventMaps.js';
import { ServiceConfig, Metric, HealthCheck } from './core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

// Orchestration imports
import { StartupOrchestrator } from './orchestration/StartupOrchestrator.js';
import { ServiceCommunicationHub } from './orchestration/ServiceCommunicationHub.js';
import { getAllServiceDefinitions, STARTUP_STAGES } from './orchestration/ServiceDefinitions.js';
import { ServiceFactory } from './orchestration/StartupOrchestrator.js';

// Service imports (keeping existing)
import { EventBus } from './events/EventBus.js';
import { CommandBus } from './cqrs/CommandBus.js';
import { QueryBus } from './cqrs/QueryBus.js';
import { ProjectionEngine } from './cqrs/ProjectionEngine.js';
import { SagaOrchestrator } from './sagas/SagaOrchestrator.js';
import { TelemetrySystem } from './observability/Telemetry.js';
import { MetricsSystem } from './observability/Metrics.js';
import { AnomalyDetectionSystem } from './observability/AnomalyDetection.js';
import { SLOMonitoring } from './observability/SLOMonitoring.js';
import { AlertingSystem } from './observability/AlertingSystem.js';
import { CacheManager } from './cache/CacheManager.js';
import { RateLimiter } from './ratelimit/RateLimiter.js';
import { QueueManager } from './queue/QueueManager.js';
import { PrismaService } from './database/PrismaService.new.js';
import { VectorStore } from './ai/VectorStore.js';
import { EmbeddingService } from './ai/EmbeddingService.js';
import { NLPService } from './ai/NLPService.js';
import { RAGService } from './ai/RAGService.js';
import { MLPredictionService } from './ai/MLPredictionService.js';
import { AIInsightService } from './ai/AIInsightService.js';

/**
 * Enhanced system configuration schema
 */
const EnhancedSystemConfigSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']),
  features: z.object({
    eventSourcing: z.boolean().default(true),
    cqrs: z.boolean().default(true),
    sagas: z.boolean().default(true),
    ai: z.boolean().default(true),
    ml: z.boolean().default(true),
    realtime: z.boolean().default(true),
    collaboration: z.boolean().default(true),
    edge: z.boolean().default(true),
    security: z.boolean().default(true),
    compliance: z.boolean().default(true),
    observability: z.boolean().default(true),
  }),
  performance: z.object({
    targetResponseTime: z.number().default(100),
    targetAvailability: z.number().default(99.9),
    optimizationLevel: z.enum(['aggressive', 'balanced', 'conservative']).default('balanced'),
  }),
  startup: z.object({
    parallelism: z.union([z.literal('auto'), z.number()]).default('auto'),
    gracefulDegradation: z.boolean().default(true),
    profileStartup: z.boolean().default(true),
    maxStartupTime: z.number().default(300000), // 5 minutes
    useProgressiveStages: z.boolean().default(true),
  }),
  monitoring: z.object({
    metricsInterval: z.number().default(60000),
    healthCheckInterval: z.number().default(30000),
  }),
});

export type SystemConfig = z.infer<typeof EnhancedSystemConfigSchema>;

/**
 * Enhanced system integration event map
 */
interface SystemIntegrationEventMap extends CombinedEventMap {
  'system:initialized': { timestamp: Date; components: string[]; duration: number };
  'system:health-check': { status: 'healthy' | 'degraded' | 'critical'; components: Record<string, any> };
  'system:shutdown': { timestamp: Date; reason?: string };
  'system:component-failed': { component: string; error: Error };
  'system:startup-progress': { stage: string; progress: number; message: string };
  'system:performance-report': { metrics: any; bottlenecks: any[] };
}

/**
 * Enhanced System Integration with advanced orchestration
 * 
 * Features:
 * - Dependency-based startup orchestration
 * - Parallel service initialization
 * - Progressive startup stages
 * - Health-based progression
 * - Startup performance profiling
 * - Graceful degradation
 * - Service discovery integration
 * - Inter-service communication hub
 */
@ServiceConfig({
  schema: EnhancedSystemConfigSchema,
  prefix: 'system',
  hot: true,
})
export class SystemIntegration extends BaseService<SystemConfig, SystemIntegrationEventMap> {
  private orchestrator!: StartupOrchestrator;
  private communicationHub!: ServiceCommunicationHub;
  private serviceFactories: Map<string, ServiceFactory> = new Map();
  private startupResult?: any;

  /**
   * Get singleton instance
   */
  static getInstance(): SystemIntegration {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'system-integration';
  }

  protected getServiceVersion(): string {
    return '3.0.0'; // Version bump for orchestrator
  }

  protected getServiceDescription(): string {
    return 'Enhanced system integration with advanced service orchestration';
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('SystemIntegration initializing with enhanced orchestration', {
      environment: this.config.environment,
      features: Object.entries(this.config.features)
        .filter(([_, enabled]) => enabled)
        .map(([feature]) => feature),
      startup: this.config.startup,
    });

    // Initialize orchestrator and communication hub
    this.orchestrator = StartupOrchestrator.getInstance();
    this.communicationHub = ServiceCommunicationHub.getInstance();

    // Register service factories
    this.registerServiceFactories();
  }

  /**
   * Start all system components using orchestrator
   */
  protected async onStart(): Promise<void> {
    const startTime = Date.now();

    this.emit('system:startup-progress', {
      stage: 'initialization',
      progress: 0,
      message: 'Starting system initialization',
    });

    try {
      // Register all service definitions with orchestrator
      const serviceDefinitions = getAllServiceDefinitions();
      
      // Filter services based on enabled features
      const enabledServices = serviceDefinitions.filter(service => {
        const serviceType = service.metadata?.type;
        
        // Check feature flags
        if (serviceType === 'ai' && !this.config.features.ai) return false;
        if (serviceType === 'security' && !this.config.features.security) return false;
        if (serviceType === 'observability' && !this.config.features.observability) return false;
        if (serviceType === 'event-sourcing' && !this.config.features.eventSourcing) return false;
        if (serviceType === 'cqrs' && !this.config.features.cqrs) return false;
        if (serviceType === 'saga' && !this.config.features.sagas) return false;
        
        return true;
      });

      logger.info(`Registering ${enabledServices.length} services with orchestrator`);

      // Register services with their factories
      for (const definition of enabledServices) {
        const factory = this.serviceFactories.get(definition.name);
        if (factory) {
          this.orchestrator.registerService(definition, factory);
        } else {
          logger.warn(`No factory found for service: ${definition.name}`);
        }
      }

      // Execute startup based on configuration
      if (this.config.startup.useProgressiveStages) {
        // Use progressive stages
        this.startupResult = await this.orchestrator.executeProgressiveStartup(STARTUP_STAGES);
      } else {
        // Use dependency-based orchestration
        this.startupResult = await this.orchestrator.orchestrateStartup(this.config);
      }

      const duration = Date.now() - startTime;

      // Emit completion event
      this.emit('system:initialized', {
        timestamp: new Date(),
        components: this.startupResult.groups.flatMap(g => g.services.map(s => s.serviceName)),
        duration,
      });

      // Log startup summary
      logger.info('System initialization complete', {
        duration,
        totalServices: enabledServices.length,
        failedServices: this.startupResult.failedServices.length,
        degradedServices: this.startupResult.degradedServices.length,
        efficiency: this.startupResult.startupProfile?.parallelizationMetrics.efficiency,
      });

      // Emit performance report if profiling enabled
      if (this.config.startup.profileStartup && this.startupResult.startupProfile) {
        this.emit('system:performance-report', {
          metrics: this.startupResult.startupProfile.parallelizationMetrics,
          bottlenecks: this.startupResult.startupProfile.bottlenecks,
        });
      }

      // Setup inter-service communication
      await this.setupServiceCommunication();

      // Start monitoring
      this.startMonitoring();

    } catch (error) {
      logger.error('System initialization failed', { error });
      
      this.emit('system:component-failed', {
        component: 'initialization',
        error: error as Error,
      });

      // Rethrow if not graceful degradation
      if (!this.config.startup.gracefulDegradation) {
        throw error;
      }
    }
  }

  /**
   * Stop all system components
   */
  protected async onStop(): Promise<void> {
    logger.info('Shutting down system...');

    // Get all service instances
    const services = this.orchestrator.getAllServiceInstances();

    // Shutdown in reverse order
    const shutdownOrder = Array.from(services.keys()).reverse();
    
    for (const serviceName of shutdownOrder) {
      try {
        const service = services.get(serviceName);
        
        // Check if service has shutdown method
        if (service && typeof service === 'object' && 'shutdown' in service) {
          await (service as any).shutdown();
        }
      } catch (error) {
        logger.error(`Error shutting down service ${serviceName}`, { error });
      }
    }

    this.emit('system:shutdown', {
      timestamp: new Date(),
    });

    logger.info('System shutdown complete');
  }

  /**
   * Register service factories
   */
  private registerServiceFactories(): void {
    // Core infrastructure
    this.serviceFactories.set('database', async () => {
      return PrismaService.getInstance();
    });

    this.serviceFactories.set('cache', async () => {
      return CacheManager.getInstance();
    });

    this.serviceFactories.set('message-queue', () => {
      return QueueManager.getInstance();
    });

    // Event system
    this.serviceFactories.set('event-bus', () => {
      return EventBus.getInstance();
    });

    this.serviceFactories.set('command-bus', () => {
      return CommandBus.getInstance();
    });

    this.serviceFactories.set('query-bus', () => {
      return QueryBus.getInstance();
    });

    this.serviceFactories.set('projection-engine', () => {
      return ProjectionEngine.getInstance();
    });

    this.serviceFactories.set('saga-orchestrator', () => {
      return SagaOrchestrator.getInstance();
    });

    // AI services
    this.serviceFactories.set('vector-store', async () => {
      const store = VectorStore.getInstance();
      await store.connect(process.env.QDRANT_URL || 'http://localhost:6333');
      return store;
    });

    this.serviceFactories.set('embedding-service', () => {
      const prisma = this.orchestrator.getServiceInstance<PrismaService>('database');
      return EmbeddingService.getInstance(prisma?.getClient());
    });

    this.serviceFactories.set('nlp-service', () => {
      return NLPService.getInstance();
    });

    this.serviceFactories.set('rag-service', () => {
      const embeddingService = this.orchestrator.getServiceInstance('embedding-service');
      const vectorStore = this.orchestrator.getServiceInstance('vector-store');
      return RAGService.getInstance(embeddingService, vectorStore);
    });

    this.serviceFactories.set('ml-prediction-service', () => {
      const prisma = this.orchestrator.getServiceInstance<PrismaService>('database');
      return MLPredictionService.getInstance(prisma?.getClient());
    });

    this.serviceFactories.set('ai-insight-service', () => {
      const prisma = this.orchestrator.getServiceInstance<PrismaService>('database');
      return AIInsightService.getInstance(prisma?.getClient());
    });

    // Security services
    this.serviceFactories.set('auth', () => {
      // Placeholder for auth service
      return { name: 'auth', getHealth: () => ({ status: 'healthy' }) };
    });

    this.serviceFactories.set('rate-limiter', async () => {
      return RateLimiter.initialize({
        defaultLimit: 100,
        defaultWindow: 60000,
      });
    });

    // Observability services
    this.serviceFactories.set('metrics-collector', () => {
      return MetricsSystem.getInstance();
    });

    this.serviceFactories.set('distributed-tracing', async () => {
      return TelemetrySystem.initialize({
        serviceName: 'pothos-todo',
        environment: this.config.environment,
        jaegerEndpoint: process.env.JAEGER_ENDPOINT,
      });
    });

    this.serviceFactories.set('anomaly-detection', () => {
      return AnomalyDetectionSystem.getInstance();
    });

    this.serviceFactories.set('alerting-system', () => {
      return AlertingSystem.getInstance();
    });

    // Add placeholder factories for services not yet implemented
    const placeholderServices = [
      'event-store', 'api-key-manager', 'security-audit', 'threat-detection',
      'api-gateway', 'graphql-server', 'websocket-server', 'log-aggregation',
      'notification-system', 'search-engine', 'workflow-engine', 'integration-hub'
    ];

    for (const serviceName of placeholderServices) {
      this.serviceFactories.set(serviceName, () => ({
        name: serviceName,
        getHealth: () => ({ status: 'healthy' }),
      }));
    }
  }

  /**
   * Setup inter-service communication
   */
  private async setupServiceCommunication(): void {
    // Create service proxies for common services
    this.communicationHub.createServiceProxy<{
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<void>;
      find: (query: any) => Promise<any[]>;
    }>('todo-service', {
      create: { timeout: 5000 },
      update: { timeout: 5000 },
      delete: { timeout: 3000 },
      find: { timeout: 10000 },
    });

    // Subscribe to system events
    this.communicationHub.subscribe<{ service: string; status: string }>(
      '*',
      'service:status-changed',
      async (event) => {
        logger.info('Service status changed', event);
      }
    );

    // Subscribe to error events
    this.communicationHub.subscribe<{ service: string; error: Error }>(
      '*',
      'service:error',
      async (event) => {
        logger.error('Service error reported', event);
        
        this.emit('system:component-failed', {
          component: event.service,
          error: event.error,
        });
      }
    );
  }

  /**
   * Start system monitoring
   */
  private startMonitoring(): void {
    // Health check interval
    setInterval(async () => {
      const health = await this.getSystemHealth();
      
      this.emit('system:health-check', {
        status: health.status,
        components: health.components,
      });
    }, this.config.monitoring.healthCheckInterval);

    // Metrics collection interval
    setInterval(async () => {
      await this.collectSystemMetrics();
    }, this.config.monitoring.metricsInterval);
  }

  /**
   * Collect system metrics
   */
  @Metric({ name: 'system.metrics.collect', recordDuration: true })
  private async collectSystemMetrics(): Promise<void> {
    const services = this.orchestrator.getAllServiceInstances();
    
    for (const [serviceName, instance] of services.entries()) {
      // Collect metrics if service supports it
      if (instance && typeof instance === 'object' && 'getMetrics' in instance) {
        try {
          const metrics = await (instance as any).getMetrics();
          
          // Record metrics
          for (const [key, value] of Object.entries(metrics)) {
            if (typeof value === 'number') {
              this.recordMetric(`service.${serviceName}.${key}`, value);
            }
          }
        } catch (error) {
          logger.warn(`Failed to collect metrics from ${serviceName}`, { error });
        }
      }
    }
  }

  /**
   * Get system health
   */
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    components: Record<string, { status: string; message?: string }>;
    metrics: any;
  }> {
    const components: Record<string, { status: string; message?: string }> = {};
    
    // Check orchestrator health
    const orchestratorHealth = await this.orchestrator.getHealth();
    components.orchestrator = {
      status: orchestratorHealth.status,
      message: orchestratorHealth.checks[0]?.message,
    };

    // Check communication hub
    const hubStats = this.communicationHub.getStatistics();
    components.communicationHub = {
      status: 'healthy',
      message: `${hubStats.activeSubscriptions} active subscriptions, ${hubStats.serviceProxies} proxies`,
    };

    // Check individual services
    const services = this.orchestrator.getAllServiceInstances();
    
    for (const [serviceName, instance] of services.entries()) {
      if (instance && typeof instance === 'object' && 'getHealth' in instance) {
        try {
          const health = await (instance as any).getHealth();
          components[serviceName] = {
            status: health.status,
            message: health.message,
          };
        } catch (error) {
          components[serviceName] = {
            status: 'unhealthy',
            message: `Health check failed: ${error}`,
          };
        }
      }
    }

    // Determine overall status
    const statuses = Object.values(components).map(c => c.status);
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    const unhealthyCount = statuses.filter(s => s === 'unhealthy').length;
    const degradedCount = statuses.filter(s => s === 'degraded').length;
    
    if (unhealthyCount > 0) {
      overallStatus = unhealthyCount > 3 ? 'critical' : 'degraded';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      components,
      metrics: {
        totalServices: services.size,
        healthyServices: statuses.filter(s => s === 'healthy').length,
        degradedServices: degradedCount,
        unhealthyServices: unhealthyCount,
        startupDuration: this.startupResult?.totalDuration,
        startupEfficiency: this.startupResult?.startupProfile?.parallelizationMetrics.efficiency,
      },
    };
  }

  /**
   * Health check for system
   */
  @HealthCheck({
    name: 'system:overall',
    critical: true,
    interval: 60000,
  })
  async checkSystemHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const health = await this.getSystemHealth();
    
    return {
      status: health.status === 'critical' ? 'unhealthy' : health.status,
      message: `System is ${health.status}. ${health.metrics.healthyServices}/${health.metrics.totalServices} services healthy`,
    };
  }

  /**
   * Get startup profile
   */
  getStartupProfile(): any {
    return this.startupResult?.startupProfile;
  }

  /**
   * Get service instance by name
   */
  getService<T = any>(serviceName: string): T | undefined {
    return this.orchestrator.getServiceInstance<T>(serviceName);
  }

  /**
   * Send command to a service
   */
  async sendCommand<TRequest, TResponse>(
    service: string,
    command: string,
    data: TRequest
  ): Promise<TResponse> {
    return this.communicationHub.call<TRequest, TResponse>(
      service,
      command,
      data,
      { timeout: 10000 }
    );
  }

  /**
   * Broadcast event to all services
   */
  broadcastEvent<TEvent>(eventType: string, payload: TEvent): void {
    this.communicationHub.broadcast('*', eventType, payload);
  }
}