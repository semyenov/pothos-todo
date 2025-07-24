import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';

interface ServiceEndpoint {
  id: string;
  service: string;
  address: string;
  port: number;
  metadata: Record<string, string>;
  health: 'healthy' | 'unhealthy' | 'unknown';
  lastSeen: Date;
}

interface DiscoveryEventMap {
  'service:discovered': { endpoint: ServiceEndpoint };
  'service:updated': { endpoint: ServiceEndpoint };
  'service:lost': { endpointId: string };
  'health:changed': { endpointId: string; oldHealth: string; newHealth: string };
}

export class ServiceDiscovery extends TypedEventEmitter<DiscoveryEventMap> {
  private static instance: ServiceDiscovery;
  private endpoints = new Map<string, ServiceEndpoint>();
  private healthCheckInterval?: NodeJS.Timeout;

  private constructor() {
    super();
  }

  static getInstance(): ServiceDiscovery {
    if (!ServiceDiscovery.instance) {
      ServiceDiscovery.instance = new ServiceDiscovery();
    }
    return ServiceDiscovery.instance;
  }

  registerEndpoint(endpoint: Omit<ServiceEndpoint, 'id' | 'lastSeen'>): string {
    const id = `${endpoint.service}-${endpoint.address}-${endpoint.port}`;
    const fullEndpoint: ServiceEndpoint = { ...endpoint, id, lastSeen: new Date() };
    
    if (this.endpoints.has(id)) {
      this.emit('service:updated', { endpoint: fullEndpoint });
    } else {
      this.emit('service:discovered', { endpoint: fullEndpoint });
    }
    
    this.endpoints.set(id, fullEndpoint);
    logger.debug(`Service endpoint registered: ${endpoint.service} at ${endpoint.address}:${endpoint.port}`);
    return id;
  }

  getEndpoints(serviceName?: string): ServiceEndpoint[] {
    const endpoints = Array.from(this.endpoints.values());
    return serviceName ? endpoints.filter(e => e.service === serviceName) : endpoints;
  }

  getHealthyEndpoints(serviceName: string): ServiceEndpoint[] {
    return this.getEndpoints(serviceName).filter(e => e.health === 'healthy');
  }

  updateHealth(endpointId: string, health: ServiceEndpoint['health']): void {
    const endpoint = this.endpoints.get(endpointId);
    if (endpoint && endpoint.health !== health) {
      const oldHealth = endpoint.health;
      endpoint.health = health;
      endpoint.lastSeen = new Date();
      this.emit('health:changed', { endpointId, oldHealth, newHealth: health });
    }
  }

  startHealthChecks(intervalMs = 30000): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 60000; // 60 seconds

    for (const [id, endpoint] of this.endpoints) {
      // Check if endpoint is stale
      if (now - endpoint.lastSeen.getTime() > staleThreshold) {
        this.endpoints.delete(id);
        this.emit('service:lost', { endpointId: id });
        continue;
      }

      // Perform actual health check
      try {
        const healthy = await this.checkEndpointHealth(endpoint);
        this.updateHealth(id, healthy ? 'healthy' : 'unhealthy');
      } catch (error) {
        this.updateHealth(id, 'unknown');
      }
    }
  }

  private async checkEndpointHealth(endpoint: ServiceEndpoint): Promise<boolean> {
    // Mock health check - in real implementation, would make HTTP/gRPC call
    return Math.random() > 0.1; // 90% healthy
  }
}