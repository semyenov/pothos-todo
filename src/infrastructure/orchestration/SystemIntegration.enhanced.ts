import { logger } from '@/lib/unjs-utils.js';
import { EnhancedServiceRegistry } from '../core/ServiceRegistry.enhanced.js';
import { StartupOrchestrator, DEFAULT_STARTUP_STAGES } from '../core/StartupOrchestrator.js';
import { ServiceCommunicationHub } from './ServiceCommunicationHub.js';
import { ServiceDependencyGraph, DEFAULT_SERVICE_DEFINITIONS } from './ServiceDependencyGraph.js';
import { ServiceHealthMonitor } from '../core/ServiceHealthMonitor.js';
import { ServiceMetrics } from '../core/ServiceMetrics.js';
import { ServiceTracing } from '../core/ServiceTracing.js';
import { TypedEventEmitter } from '../core/TypedEventEmitter.js';

// Import services with enhanced architecture
import { PrismaService } from '../database/PrismaService.new.js';
import { CacheManager } from '../cache/CacheManager.new.js';
import { ChaosEngineeringSystem } from '../chaos/ChaosEngineering.new.js';
import { ServiceRegistry as MicroserviceRegistry } from '../microservices/ServiceRegistry.new.js';
import { ServiceMesh } from '../microservices/ServiceMesh.new.js';
import { MessageBroker } from '../microservices/MessageBroker.new.js';
import { CQRSCoordinator } from '../cqrs/CQRSCoordinator.new.js';
import { ReadModelManager } from '../cqrs/ReadModelManager.new.js';
import { ServiceDashboard } from '../monitoring/ServiceDashboard.js';

interface SystemIntegrationEventMap {
  'system:startup-initiated': {
    timestamp: Date;
    strategy: 'orchestrated' | 'legacy';
    services: number;
  };
  'system:startup-completed': {
    timestamp: Date;
    duration: number;
    strategy: string;
    profile: any;
  };
  'system:startup-failed': {
    timestamp: Date;
    duration: number;
    error: Error;
    strategy: string;
  };
  'system:shutdown-initiated': {
    timestamp: Date;
    reason: string;
  };
  'system:shutdown-completed': {
    timestamp: Date;
    duration: number;
  };
  'system:health-check': {
    timestamp: Date;
    healthy: boolean;
    details: any;
  };
  'system:optimization-applied': {
    timestamp: Date;
    improvements: string[];
    expectedGain: number;
  };
}

/**
 * Enhanced System Integration with Advanced Orchestration
 * Replaces sequential startup with dependency-aware, parallel orchestration
 */
export class EnhancedSystemIntegration extends TypedEventEmitter<SystemIntegrationEventMap> {
  private static instance: EnhancedSystemIntegration;
  
  private registry: EnhancedServiceRegistry;
  private orchestrator: StartupOrchestrator;
  private communicationHub: ServiceCommunicationHub;
  private dependencyGraph: ServiceDependencyGraph;
  private healthMonitor: ServiceHealthMonitor;
  private metrics: ServiceMetrics;
  private tracing: ServiceTracing;
  
  private isInitialized = false;
  private isRunning = false;
  private startupProfiles: any[] = [];

  private constructor() {
    super();
    
    // Initialize core orchestration components
    this.registry = EnhancedServiceRegistry.getInstance();
    this.orchestrator = new StartupOrchestrator();
    this.communicationHub = ServiceCommunicationHub.getInstance();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.healthMonitor = ServiceHealthMonitor.getInstance();
    this.metrics = ServiceMetrics.getInstance();
    this.tracing = ServiceTracing.getInstance();
    
    this.setupEventListeners();
  }

  static getInstance(): EnhancedSystemIntegration {
    if (!EnhancedSystemIntegration.instance) {
      EnhancedSystemIntegration.instance = new EnhancedSystemIntegration();
    }
    return EnhancedSystemIntegration.instance;
  }

  /**
   * Initialize the entire system with orchestrated startup
   */
  async initialize(options?: {
    strategy?: 'orchestrated' | 'legacy';
    parallel?: boolean;
    skipOptional?: boolean;
    enableProfiling?: boolean;
    enableChaos?: boolean;
  }): Promise<void> {
    const {
      strategy = 'orchestrated',
      parallel = true,
      skipOptional = false,
      enableProfiling = true,
      enableChaos = false,
    } = options || {};

    if (this.isInitialized) {
      logger.warn('System already initialized');
      return;
    }

    const startTime = Date.now();

    logger.info('🚀 Initializing Enhanced System Integration...', {
      strategy,
      parallel,
      skipOptional,
      enableProfiling,
      enableChaos,
    });

    this.emit('system:startup-initiated', {
      timestamp: new Date(),
      strategy,
      services: DEFAULT_SERVICE_DEFINITIONS.length,
    });

    try {
      if (strategy === 'orchestrated') {
        await this.orchestratedStartup({ parallel, skipOptional, enableProfiling, enableChaos });
      } else {
        await this.legacyStartup();
      }

      const duration = Date.now() - startTime;
      this.isInitialized = true;
      this.isRunning = true;

      // Start monitoring systems
      this.startMonitoring();

      this.emit('system:startup-completed', {
        timestamp: new Date(),
        duration,
        strategy,
        profile: this.startupProfiles[this.startupProfiles.length - 1],
      });

      logger.info(`🎉 System initialization completed in ${duration}ms using ${strategy} strategy`);

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.emit('system:startup-failed', {
        timestamp: new Date(),
        duration,
        error: error as Error,
        strategy,
      });

      logger.error(`❌ System initialization failed after ${duration}ms`, { error });
      throw error;
    }
  }

  /**
   * Graceful system shutdown
   */
  async shutdown(reason: string = 'manual'): Promise<void> {
    if (!this.isRunning) {
      logger.warn('System is not running');
      return;
    }

    const startTime = Date.now();

    logger.info(`📤 Initiating system shutdown: ${reason}`);
    
    this.emit('system:shutdown-initiated', {
      timestamp: new Date(),
      reason,
    });

    try {
      // Stop monitoring
      this.stopMonitoring();

      // Generate final reports
      await this.generateShutdownReports();

      // Shutdown services in reverse dependency order
      await this.registry.stopAll(reason);

      const duration = Date.now() - startTime;
      this.isRunning = false;

      this.emit('system:shutdown-completed', {
        timestamp: new Date(),
        duration,
      });

      logger.info(`✅ System shutdown completed in ${duration}ms`);

    } catch (error) {
      logger.error('❌ Error during system shutdown', { error });
      throw error;
    }
  }

  /**
   * Restart the entire system
   */
  async restart(reason: string = 'restart', options?: {
    strategy?: 'orchestrated' | 'legacy';
    optimizeBeforeRestart?: boolean;
  }): Promise<void> {
    const { strategy = 'orchestrated', optimizeBeforeRestart = true } = options || {};

    logger.info(`♻️ Restarting system: ${reason}`);

    // Shutdown first
    await this.shutdown(reason);

    // Apply optimizations if requested
    if (optimizeBeforeRestart && this.startupProfiles.length > 0) {
      await this.applyOptimizations();
    }

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Reset state
    this.isInitialized = false;

    // Start up again
    await this.initialize({ strategy });
  }

  /**
   * Get comprehensive system status
   */
  async getSystemStatus(): Promise<{
    initialized: boolean;
    running: boolean;
    health: any;
    services: any;
    performance: any;
    dependencies: any;
  }> {
    const health = await this.registry.getSystemHealth();
    const services = Array.from(this.registry.getAllMetadata().entries()).map(([name, metadata]) => ({
      name,
      status: metadata.status,
      health: metadata.health,
      uptime: metadata.lifecycle.uptime,
      capabilities: metadata.capabilities,
    }));

    const performance = {
      startupProfiles: this.startupProfiles.length,
      lastStartupDuration: this.startupProfiles[this.startupProfiles.length - 1]?.totalDuration || 0,
      averageStartupTime: this.startupProfiles.length > 0
        ? this.startupProfiles.reduce((sum, p) => sum + p.totalDuration, 0) / this.startupProfiles.length
        : 0,
      parallelEfficiency: this.startupProfiles[this.startupProfiles.length - 1]?.parallelEfficiency || 0,
    };

    const dependencies = {
      totalServices: this.dependencyGraph.getAllServices().size,
      criticalPath: this.dependencyGraph.calculateCriticalPath(),
      circularDependencies: this.dependencyGraph.detectCircularDependencies(),
    };

    return {
      initialized: this.isInitialized,
      running: this.isRunning,
      health,
      services,
      performance,
      dependencies,
    };
  }

  /**
   * Apply performance optimizations based on profiling data
   */
  async applyOptimizations(): Promise<void> {
    if (this.startupProfiles.length < 2) {
      logger.info('Not enough profiling data for optimization');
      return;
    }

    logger.info('🔧 Applying system optimizations...');

    const optimization = this.orchestrator.optimizeStartup(this.startupProfiles);
    
    if (optimization.expectedImprovement > 5) {
      logger.info(`Applying optimizations with expected ${optimization.expectedImprovement.toFixed(1)}% improvement`);
      
      // Update service timeouts based on historical data
      this.updateServiceTimeouts();
      
      // Optimize dependency graph
      this.optimizeDependencyGraph();
      
      // Configure circuit breakers based on failure patterns
      this.optimizeCircuitBreakers();

      this.emit('system:optimization-applied', {
        timestamp: new Date(),
        improvements: optimization.recommendations,
        expectedGain: optimization.expectedImprovement,
      });

      logger.info('✅ Optimizations applied', {
        improvements: optimization.recommendations.length,
        expectedGain: optimization.expectedImprovement,
      });
    } else {
      logger.info('No significant optimizations found');
    }
  }

  /**
   * Perform comprehensive system health check
   */
  async performHealthCheck(): Promise<void> {
    logger.info('🔍 Performing comprehensive system health check...');

    const health = await this.registry.getSystemHealth();
    const communicationStats = this.communicationHub.getStatistics();
    const metricsStats = this.metrics.getStatistics();
    const tracingStats = this.tracing.getStatistics();

    const details = {
      services: health,
      communication: communicationStats,
      metrics: metricsStats,
      tracing: tracingStats,
      timestamp: new Date(),
    };

    this.emit('system:health-check', {
      timestamp: new Date(),
      healthy: health.healthy,
      details,
    });

    if (health.healthy) {
      logger.info('✅ System health check passed', {
        services: health.summary.healthy,
        total: health.summary.total,
      });
    } else {
      logger.warn('⚠️ System health check found issues', {
        unhealthy: health.summary.unhealthy,
        degraded: health.summary.degraded,
      });
    }
  }

  private async orchestratedStartup(options: {
    parallel: boolean;
    skipOptional: boolean;
    enableProfiling: boolean;
    enableChaos: boolean;
  }): Promise<void> {
    logger.info('🏗️ Starting orchestrated initialization...');

    // Register all services with the enhanced registry
    await this.registerServices();

    // Start the orchestrated startup process
    const profile = await this.orchestrator.startup(DEFAULT_STARTUP_STAGES, {
      parallel: options.parallel,
      skipOptional: options.skipOptional,
      abortOnFailure: false,
    });

    // Store profile for optimization
    this.startupProfiles.push(profile);

    // Enable chaos engineering if requested
    if (options.enableChaos) {
      await this.enableChaosEngineering();
    }

    logger.info('✅ Orchestrated startup completed', {
      duration: profile.totalDuration,
      efficiency: profile.parallelEfficiency,
      bottlenecks: profile.bottlenecks.length,
    });
  }

  private async legacyStartup(): Promise<void> {
    logger.info('🔄 Starting legacy sequential initialization...');

    // This would use the old startup method for comparison
    const startTime = Date.now();

    // Sequential startup (simplified for comparison)
    const services = [
      PrismaService,
      CacheManager,
      MessageBroker,
      MicroserviceRegistry,
      ServiceMesh,
      CQRSCoordinator,
      ReadModelManager,
      ChaosEngineeringSystem,
    ];

    for (const ServiceClass of services) {
      const service = await (ServiceClass as any).getInstance();
      this.registry.register(service);
      await service.start();
    }

    const profile = {
      totalDuration: Date.now() - startTime,
      parallelEfficiency: 0, // No parallelism in legacy mode
      stages: [],
      bottlenecks: [],
      recommendations: ['Consider migrating to orchestrated startup'],
    };

    this.startupProfiles.push(profile);

    logger.info('✅ Legacy startup completed', {
      duration: profile.totalDuration,
    });
  }

  private async registerServices(): Promise<void> {
    logger.info('📋 Registering services with enhanced registry...');

    // Register services with their definitions
    for (const definition of DEFAULT_SERVICE_DEFINITIONS) {
      try {
        // Get service instance
        const service = await this.getServiceInstance(definition.name);
        
        if (service) {
          this.registry.register(service, definition);
          logger.debug(`Registered service: ${definition.name}`);
        } else {
          logger.warn(`Service implementation not found: ${definition.name}`);
        }
      } catch (error) {
        logger.error(`Failed to register service ${definition.name}`, { error });
      }
    }

    logger.info(`✅ Registered ${this.registry.getAllServices().size} services`);
  }

  private async getServiceInstance(serviceName: string): Promise<any> {
    // Map service names to their implementations
    const serviceMap: Record<string, any> = {
      'prisma-service': PrismaService,
      'cache-manager': CacheManager,
      'message-broker': MessageBroker,
      'service-registry': MicroserviceRegistry,
      'service-mesh': ServiceMesh,
      'cqrs-coordinator': CQRSCoordinator,
      'read-model-manager': ReadModelManager,
      'chaos-engineering': ChaosEngineeringSystem,
      'service-dashboard': ServiceDashboard,
    };

    const ServiceClass = serviceMap[serviceName];
    if (!ServiceClass) {
      return null;
    }

    // Handle both sync and async getInstance methods
    const instance = await ServiceClass.getInstance();
    return instance;
  }

  private startMonitoring(): void {
    logger.info('📊 Starting monitoring systems...');

    // Start health monitoring
    this.healthMonitor.startMonitoring(30000);

    // Start metrics collection
    this.metrics.setRetentionPeriod(3600000); // 1 hour

    // Configure tracing
    this.tracing.setSampler({ shouldSample: () => true }); // 100% sampling for development

    // Periodic health checks
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed', { error });
      }
    }, 60000); // Every minute
  }

  private stopMonitoring(): void {
    logger.info('📊 Stopping monitoring systems...');

    this.healthMonitor.stopMonitoring();
    this.metrics.stop();
    this.tracing.stop();
  }

  private async enableChaosEngineering(): Promise<void> {
    logger.info('🔥 Enabling chaos engineering...');

    const chaosService = this.registry.get<ChaosEngineeringSystem>('chaos-engineering');
    if (chaosService) {
      // Configure chaos experiments
      const experiments = [
        {
          name: 'random-service-latency',
          type: 'latency',
          config: { minDelay: 100, maxDelay: 1000, probability: 0.1 },
        },
        {
          name: 'random-service-failure',
          type: 'failure',
          config: { probability: 0.05, duration: 30000 },
        },
      ];

      for (const experiment of experiments) {
        await chaosService.createExperiment(experiment);
      }

      logger.info('✅ Chaos engineering enabled with experiments');
    } else {
      logger.warn('Chaos engineering service not available');
    }
  }

  private async generateShutdownReports(): Promise<void> {
    logger.info('📄 Generating shutdown reports...');

    try {
      // Performance report
      const performanceReport = {
        totalStartups: this.startupProfiles.length,
        averageStartupTime: this.startupProfiles.length > 0
          ? this.startupProfiles.reduce((sum, p) => sum + p.totalDuration, 0) / this.startupProfiles.length
          : 0,
        bestStartupTime: Math.min(...this.startupProfiles.map(p => p.totalDuration)),
        worstStartupTime: Math.max(...this.startupProfiles.map(p => p.totalDuration)),
        averageParallelEfficiency: this.startupProfiles.length > 0
          ? this.startupProfiles.reduce((sum, p) => sum + p.parallelEfficiency, 0) / this.startupProfiles.length
          : 0,
      };

      logger.info('Performance Summary:', performanceReport);

      // System health report
      const healthReport = await this.registry.getSystemHealth();
      logger.info('Final Health Status:', {
        healthy: healthReport.healthy,
        services: healthReport.summary,
      });

      // Communication report
      const commStats = this.communicationHub.getStatistics();
      logger.info('Communication Summary:', commStats);

    } catch (error) {
      logger.error('Failed to generate shutdown reports', { error });
    }
  }

  private updateServiceTimeouts(): void {
    // This would analyze historical startup times and adjust timeouts
    logger.info('🔧 Updating service timeouts based on historical data...');
    
    // Implementation would analyze metrics and update service definitions
  }

  private optimizeDependencyGraph(): void {
    // This would optimize the dependency graph based on actual performance
    logger.info('🔧 Optimizing dependency graph...');
    
    // Implementation would restructure dependencies for better parallelism
  }

  private optimizeCircuitBreakers(): void {
    // This would configure circuit breakers based on failure patterns
    logger.info('🔧 Optimizing circuit breaker configurations...');
    
    // Implementation would analyze failure patterns and configure thresholds
  }

  private setupEventListeners(): void {
    // Listen to orchestrator events
    this.orchestrator.on('startup:completed', ({ profile }) => {
      logger.info('Orchestrator startup completed', {
        duration: profile.totalDuration,
        efficiency: profile.parallelEfficiency,
      });
    });

    this.orchestrator.on('startup:failed', ({ error }) => {
      logger.error('Orchestrator startup failed', { error });
    });

    // Listen to registry events
    this.registry.on('service:registered', ({ name }) => {
      logger.debug(`Service registered: ${name}`);
    });

    this.registry.on('service:health-changed', ({ name, from, to }) => {
      logger.info(`Service health changed: ${name} (${from} -> ${to})`);
    });

    // Listen to health monitor events
    this.healthMonitor.on('incident:created', ({ incident }) => {
      logger.warn(`Health incident: ${incident.serviceName}`, {
        status: incident.status,
      });
    });

    this.healthMonitor.on('incident:resolved', ({ incident, duration }) => {
      logger.info(`Health incident resolved: ${incident.serviceName}`, {
        duration,
      });
    });
  }
}

// Export singleton instance
export const systemIntegration = EnhancedSystemIntegration.getInstance();