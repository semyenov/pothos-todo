import { BaseService, BaseAsyncService } from './BaseService.js';
import { ServiceEventMap } from './TypedEventEmitter.js';

/**
 * Central registry for all infrastructure services
 * Provides service discovery and dependency management
 */
export class ServiceRegistryManager {
  private static services = new Map<string, BaseService<any, any> | BaseAsyncService<any, any>>();
  private static dependencies = new Map<string, Set<string>>();

  /**
   * Register a service
   */
  static register(service: BaseService<any, any> | BaseAsyncService<any, any>): void {
    const name = service.metadata.name;
    this.services.set(name, service);

    // Register dependencies
    const deps = service.metadata.dependencies || [];
    this.dependencies.set(name, new Set(deps));
  }

  /**
   * Get a service by name
   */
  static get<T extends BaseService<any, any> | BaseAsyncService<any, any>>(
    name: string
  ): T | undefined {
    return this.services.get(name) as T;
  }

  /**
   * Get all services
   */
  static getAll(): Map<string, BaseService<any, any> | BaseAsyncService<any, any>> {
    return new Map(this.services);
  }

  /**
   * Check if all dependencies are satisfied
   */
  static checkDependencies(serviceName: string): {
    satisfied: boolean;
    missing: string[];
  } {
    const deps = this.dependencies.get(serviceName) || new Set();
    const missing: string[] = [];

    for (const dep of deps) {
      if (!this.services.has(dep)) {
        missing.push(dep);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * Get service dependency graph
   */
  static getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const [service, deps] of this.dependencies) {
      graph.set(service, Array.from(deps));
    }

    return graph;
  }

  /**
   * Start all services in dependency order
   */
  static async startAll(): Promise<void> {
    const started = new Set<string>();
    const starting = new Set<string>();

    const startService = async (name: string): Promise<void> => {
      if (started.has(name) || starting.has(name)) {
        return;
      }

      starting.add(name);

      // Start dependencies first
      const deps = this.dependencies.get(name) || new Set();
      for (const dep of deps) {
        await startService(dep);
      }

      // Start the service
      const service = this.services.get(name);
      if (service && service.state !== 'running') {
        await service.start();
      }

      starting.delete(name);
      started.add(name);
    };

    // Start all services
    for (const [name] of this.services) {
      await startService(name);
    }
  }

  /**
   * Stop all services in reverse dependency order
   */
  static async stopAll(): Promise<void> {
    const services = Array.from(this.services.entries());
    
    // Reverse order to stop dependents before dependencies
    services.reverse();

    for (const [_, service] of services) {
      if (service.state === 'running') {
        await service.stop('system shutdown');
      }
    }
  }

  /**
   * Get system health status
   */
  static async getSystemHealth(): Promise<{
    healthy: boolean;
    services: Map<string, {
      state: string;
      health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
      uptime: number;
    }>;
  }> {
    const serviceHealth = new Map<string, any>();
    let allHealthy = true;

    for (const [name, service] of this.services) {
      const health = await service.getHealth();
      const uptime = Date.now() - service.metadata.startTime.getTime();

      serviceHealth.set(name, {
        state: service.state,
        health: health.status,
        uptime,
      });

      if (health.status !== 'healthy') {
        allHealthy = false;
      }
    }

    return {
      healthy: allHealthy,
      services: serviceHealth,
    };
  }

  /**
   * Clear all services (for testing)
   */
  static clear(): void {
    this.services.clear();
    this.dependencies.clear();
  }
}

// Export singleton instance
export const ServiceRegistry = ServiceRegistryManager;