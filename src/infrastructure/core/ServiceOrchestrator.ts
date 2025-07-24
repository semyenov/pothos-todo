import { BaseService, BaseAsyncService } from './BaseService.js';
import { ServiceRegistry } from './ServiceRegistry.js';
import { logger } from '@/lib/unjs-utils.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';

interface ServiceGroup {
  name: string;
  services: string[];
  parallel: boolean;
  critical: boolean;
}

interface OrchestratorConfig {
  groups: ServiceGroup[];
  healthCheckInterval: number;
  startupTimeout: number;
  shutdownTimeout: number;
}

interface OrchestratorEventMap {
  'group:started': { group: string };
  'group:stopped': { group: string };
  'orchestrator:started': { duration: number };
  'orchestrator:stopped': Record<string, never>;
  'service:started': {
    service: string;
    group: string;
  };
  'service:stopped': {
    service: string;
    group: string;
  };
  'service:failed': {
    service: string;
    group: string;
    error: Error;
  };
  'health:degraded': { unhealthyServices: string[] };
  'health:critical': { services: string[] };
}

/**
 * Service Orchestrator for complex startup/shutdown sequences
 * Manages service groups with dependencies and parallel execution
 */
export class ServiceOrchestrator extends TypedEventEmitter<OrchestratorEventMap> {
  private config: OrchestratorConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private isStarting = false;
  private isStopping = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
  }

  /**
   * Start all services according to group configuration
   */
  async startServices(): Promise<void> {
    if (this.isStarting) {
      throw new Error('Services are already starting');
    }

    this.isStarting = true;
    const startTime = Date.now();

    try {
      logger.info('🚀 Starting services with orchestrator...');

      for (const group of this.config.groups) {
        logger.info(`Starting group: ${group.name}`);
        
        if (group.parallel) {
          await this.startGroupParallel(group);
        } else {
          await this.startGroupSequential(group);
        }

        this.emit('group:started', { group: group.name });
      }

      const duration = Date.now() - startTime;
      logger.info(`✅ All services started in ${duration}ms`);

      // Start health monitoring
      this.startHealthMonitoring();

      this.emit('orchestrator:started', { duration });

    } catch (error) {
      logger.error('❌ Service startup failed', { error });
      
      // Attempt to stop any started services
      await this.stopServices();
      
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop all services in reverse order
   */
  async stopServices(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;

    try {
      logger.info('📤 Stopping services with orchestrator...');

      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      // Stop groups in reverse order
      const reversedGroups = [...this.config.groups].reverse();
      
      for (const group of reversedGroups) {
        logger.info(`Stopping group: ${group.name}`);
        
        if (group.parallel) {
          await this.stopGroupParallel(group);
        } else {
          await this.stopGroupSequential(group);
        }

        this.emit('group:stopped', { group: group.name });
      }

      logger.info('✅ All services stopped');
      this.emit('orchestrator:stopped');

    } catch (error) {
      logger.error('❌ Error during service shutdown', { error });
      throw error;
    } finally {
      this.isStopping = false;
    }
  }

  /**
   * Start a group of services in parallel
   */
  private async startGroupParallel(group: ServiceGroup): Promise<void> {
    const startPromises = group.services.map(async (serviceName) => {
      try {
        const service = ServiceRegistry.get(serviceName);
        if (!service) {
          throw new Error(`Service ${serviceName} not found in registry`);
        }

        if (service.state !== 'running') {
          await Promise.race([
            service.start(),
            this.timeout(this.config.startupTimeout, `Service ${serviceName} startup timeout`),
          ]);
        }

        logger.info(`✓ Started ${serviceName}`);
        this.emit('service:started', { service: serviceName, group: group.name });

      } catch (error) {
        if (group.critical) {
          throw new Error(`Critical service ${serviceName} failed to start: ${error}`);
        } else {
          logger.warn(`Non-critical service ${serviceName} failed to start`, { error });
          this.emit('service:failed', { service: serviceName, group: group.name, error });
        }
      }
    });

    await Promise.all(startPromises);
  }

  /**
   * Start a group of services sequentially
   */
  private async startGroupSequential(group: ServiceGroup): Promise<void> {
    for (const serviceName of group.services) {
      try {
        const service = ServiceRegistry.get(serviceName);
        if (!service) {
          throw new Error(`Service ${serviceName} not found in registry`);
        }

        if (service.state !== 'running') {
          await Promise.race([
            service.start(),
            this.timeout(this.config.startupTimeout, `Service ${serviceName} startup timeout`),
          ]);
        }

        logger.info(`✓ Started ${serviceName}`);
        this.emit('service:started', { service: serviceName, group: group.name });

      } catch (error) {
        if (group.critical) {
          throw new Error(`Critical service ${serviceName} failed to start: ${error}`);
        } else {
          logger.warn(`Non-critical service ${serviceName} failed to start`, { error });
          this.emit('service:failed', { service: serviceName, group: group.name, error });
        }
      }
    }
  }

  /**
   * Stop a group of services in parallel
   */
  private async stopGroupParallel(group: ServiceGroup): Promise<void> {
    const stopPromises = group.services.map(async (serviceName) => {
      try {
        const service = ServiceRegistry.get(serviceName);
        if (service && service.state === 'running') {
          await Promise.race([
            service.stop('orchestrator shutdown'),
            this.timeout(this.config.shutdownTimeout, `Service ${serviceName} shutdown timeout`),
          ]);
          
          logger.info(`✓ Stopped ${serviceName}`);
          this.emit('service:stopped', { service: serviceName, group: group.name });
        }
      } catch (error) {
        logger.error(`Failed to stop service ${serviceName}`, { error });
      }
    });

    await Promise.all(stopPromises);
  }

  /**
   * Stop a group of services sequentially
   */
  private async stopGroupSequential(group: ServiceGroup): Promise<void> {
    // Stop in reverse order within the group
    const reversedServices = [...group.services].reverse();
    
    for (const serviceName of reversedServices) {
      try {
        const service = ServiceRegistry.get(serviceName);
        if (service && service.state === 'running') {
          await Promise.race([
            service.stop('orchestrator shutdown'),
            this.timeout(this.config.shutdownTimeout, `Service ${serviceName} shutdown timeout`),
          ]);
          
          logger.info(`✓ Stopped ${serviceName}`);
          this.emit('service:stopped', { service: serviceName, group: group.name });
        }
      } catch (error) {
        logger.error(`Failed to stop service ${serviceName}`, { error });
      }
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await ServiceRegistry.getSystemHealth();
        
        if (!health.healthy) {
          const unhealthyServices = Array.from(health.services.entries())
            .filter(([_, status]) => status.health === 'unhealthy')
            .map(([name]) => name);

          logger.warn('System health degraded', { unhealthyServices });
          this.emit('health:degraded', { unhealthyServices });

          // Check if any critical services are unhealthy
          for (const group of this.config.groups) {
            if (group.critical) {
              const criticalUnhealthy = group.services.filter(s => unhealthyServices.includes(s));
              if (criticalUnhealthy.length > 0) {
                logger.error('Critical services unhealthy', { services: criticalUnhealthy });
                this.emit('health:critical', { services: criticalUnhealthy });
              }
            }
          }
        }
      } catch (error) {
        logger.error('Health check failed', { error });
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Create a timeout promise
   */
  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    isStarting: boolean;
    isStopping: boolean;
    groups: Array<{
      name: string;
      services: Array<{
        name: string;
        state: string;
        health: string;
      }>;
    }>;
  } {
    const groups = this.config.groups.map(group => ({
      name: group.name,
      services: group.services.map(serviceName => {
        const service = ServiceRegistry.get(serviceName);
        return {
          name: serviceName,
          state: service?.state || 'not found',
          health: 'unknown', // Would need to be async to get actual health
        };
      }),
    }));

    return {
      isStarting: this.isStarting,
      isStopping: this.isStopping,
      groups,
    };
  }
}

/**
 * Default orchestrator configuration for the application
 */
export const defaultOrchestratorConfig: OrchestratorConfig = {
  groups: [
    {
      name: 'core',
      services: ['prisma-service', 'cache-manager'],
      parallel: true,
      critical: true,
    },
    {
      name: 'infrastructure',
      services: ['service-registry', 'message-broker'],
      parallel: true,
      critical: true,
    },
    {
      name: 'application',
      services: ['service-mesh', 'cqrs-coordinator', 'read-model-manager'],
      parallel: false,
      critical: true,
    },
    {
      name: 'monitoring',
      services: ['service-dashboard', 'chaos-engineering'],
      parallel: true,
      critical: false,
    },
  ],
  healthCheckInterval: 30000,
  startupTimeout: 60000,
  shutdownTimeout: 30000,
};