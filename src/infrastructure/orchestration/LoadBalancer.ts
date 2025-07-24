import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { ServiceDiscovery } from './ServiceDiscovery.js';
import { logger } from '@/lib/unjs-utils.js';

export interface LoadBalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'consistent-hash' | 'random';
  healthCheck: boolean;
  stickySessions?: boolean;
  sessionTimeout?: number;
  weights?: Record<string, number>;
  maxRetries?: number;
}

export interface LoadBalancerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  endpointStats: Map<string, {
    requests: number;
    failures: number;
    averageLatency: number;
    weight: number;
    connections: number;
  }>;
}

interface LoadBalancerEventMap {
  'request:routed': { endpoint: string; algorithm: string; timestamp: Date };
  'endpoint:failed': { endpoint: string; error: Error; timestamp: Date };
  'algorithm:changed': { from: string; to: string; reason: string };
  'health:degraded': { service: string; healthyEndpoints: number; totalEndpoints: number };
}

export class LoadBalancer extends TypedEventEmitter<LoadBalancerEventMap> {
  private discovery: ServiceDiscovery;
  private configs = new Map<string, LoadBalancerConfig>();
  private stats = new Map<string, LoadBalancerStats>();
  private roundRobinCounters = new Map<string, number>();
  private sessions = new Map<string, { endpoint: string; lastAccess: Date }>();
  private connections = new Map<string, number>();

  constructor() {
    super();
    this.discovery = ServiceDiscovery.getInstance();
    this.setupCleanupInterval();
  }

  configureService(serviceName: string, config: LoadBalancerConfig): void {
    this.configs.set(serviceName, config);
    
    if (!this.stats.has(serviceName)) {
      this.stats.set(serviceName, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatency: 0,
        endpointStats: new Map(),
      });
    }

    logger.info(`Load balancer configured for ${serviceName}`, {
      algorithm: config.algorithm,
      healthCheck: config.healthCheck,
      stickySessions: config.stickySessions,
    });
  }

  selectEndpoint(serviceName: string, sessionId?: string): string | null {
    const config = this.configs.get(serviceName);
    if (!config) {
      logger.warn(`No load balancer config for service: ${serviceName}`);
      return null;
    }

    // Get available endpoints
    const endpoints = config.healthCheck 
      ? this.discovery.getHealthyEndpoints(serviceName)
      : this.discovery.getEndpoints(serviceName);

    if (endpoints.length === 0) {
      this.emit('health:degraded', {
        service: serviceName,
        healthyEndpoints: 0,
        totalEndpoints: this.discovery.getEndpoints(serviceName).length,
      });
      return null;
    }

    // Check sticky sessions
    if (config.stickySessions && sessionId) {
      const session = this.sessions.get(sessionId);
      if (session && this.isEndpointAvailable(endpoints, session.endpoint)) {
        session.lastAccess = new Date();
        return session.endpoint;
      }
    }

    // Select endpoint based on algorithm
    let selectedEndpoint: string;
    
    switch (config.algorithm) {
      case 'round-robin':
        selectedEndpoint = this.roundRobinSelection(serviceName, endpoints);
        break;
      case 'least-connections':
        selectedEndpoint = this.leastConnectionsSelection(endpoints);
        break;
      case 'weighted':
        selectedEndpoint = this.weightedSelection(serviceName, endpoints);
        break;
      case 'consistent-hash':
        selectedEndpoint = this.consistentHashSelection(serviceName, sessionId || 'default');
        break;
      case 'random':
        selectedEndpoint = this.randomSelection(endpoints);
        break;
      default:
        selectedEndpoint = endpoints[0].id;
    }

    // Update sticky session
    if (config.stickySessions && sessionId) {
      this.sessions.set(sessionId, {
        endpoint: selectedEndpoint,
        lastAccess: new Date(),
      });
    }

    this.emit('request:routed', {
      endpoint: selectedEndpoint,
      algorithm: config.algorithm,
      timestamp: new Date(),
    });

    return selectedEndpoint;
  }

  recordRequest(serviceName: string, endpointId: string, success: boolean, latency: number): void {
    const stats = this.stats.get(serviceName);
    if (!stats) return;

    stats.totalRequests++;
    if (success) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }

    // Update average latency
    stats.averageLatency = (stats.averageLatency * (stats.totalRequests - 1) + latency) / stats.totalRequests;

    // Update endpoint stats
    if (!stats.endpointStats.has(endpointId)) {
      stats.endpointStats.set(endpointId, {
        requests: 0,
        failures: 0,
        averageLatency: 0,
        weight: 1,
        connections: 0,
      });
    }

    const endpointStats = stats.endpointStats.get(endpointId)!;
    endpointStats.requests++;
    if (!success) {
      endpointStats.failures++;
    }
    endpointStats.averageLatency = (endpointStats.averageLatency * (endpointStats.requests - 1) + latency) / endpointStats.requests;
  }

  recordConnection(endpointId: string, connected: boolean): void {
    const current = this.connections.get(endpointId) || 0;
    this.connections.set(endpointId, Math.max(0, current + (connected ? 1 : -1)));
  }

  getStats(serviceName: string): LoadBalancerStats | null {
    return this.stats.get(serviceName) || null;
  }

  getAllStats(): Map<string, LoadBalancerStats> {
    return new Map(this.stats);
  }

  adaptAlgorithm(serviceName: string): void {
    const stats = this.stats.get(serviceName);
    const config = this.configs.get(serviceName);
    
    if (!stats || !config) return;

    const oldAlgorithm = config.algorithm;
    let newAlgorithm = oldAlgorithm;
    let reason = '';

    // Adaptive logic based on performance patterns
    const failureRate = stats.failedRequests / stats.totalRequests;
    const avgLatency = stats.averageLatency;

    if (failureRate > 0.1) { // >10% failure rate
      if (config.algorithm !== 'least-connections') {
        newAlgorithm = 'least-connections';
        reason = 'High failure rate detected';
      }
    } else if (avgLatency > 1000) { // >1s average latency
      if (config.algorithm !== 'weighted') {
        newAlgorithm = 'weighted';
        reason = 'High latency detected';
      }
    } else if (stats.totalRequests > 10000 && config.algorithm === 'round-robin') {
      newAlgorithm = 'consistent-hash';
      reason = 'High volume traffic';
    }

    if (newAlgorithm !== oldAlgorithm) {
      config.algorithm = newAlgorithm;
      
      this.emit('algorithm:changed', {
        from: oldAlgorithm,
        to: newAlgorithm,
        reason,
      });

      logger.info(`Load balancer algorithm adapted for ${serviceName}`, {
        from: oldAlgorithm,
        to: newAlgorithm,
        reason,
      });
    }
  }

  private roundRobinSelection(serviceName: string, endpoints: any[]): string {
    const counter = this.roundRobinCounters.get(serviceName) || 0;
    const selected = endpoints[counter % endpoints.length];
    this.roundRobinCounters.set(serviceName, counter + 1);
    return selected.id;
  }

  private leastConnectionsSelection(endpoints: any[]): string {
    let minConnections = Infinity;
    let selectedEndpoint = endpoints[0];

    for (const endpoint of endpoints) {
      const connections = this.connections.get(endpoint.id) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selectedEndpoint = endpoint;
      }
    }

    return selectedEndpoint.id;
  }

  private weightedSelection(serviceName: string, endpoints: any[]): string {
    const config = this.configs.get(serviceName);
    const weights = config?.weights || {};
    
    const weightedEndpoints: { endpoint: any; weight: number }[] = [];
    let totalWeight = 0;

    for (const endpoint of endpoints) {
      const weight = weights[endpoint.id] || 1;
      weightedEndpoints.push({ endpoint, weight });
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return endpoints[0].id;
    }

    const random = Math.random() * totalWeight;
    let currentWeight = 0;

    for (const { endpoint, weight } of weightedEndpoints) {
      currentWeight += weight;
      if (random <= currentWeight) {
        return endpoint.id;
      }
    }

    return endpoints[endpoints.length - 1].id;
  }

  private consistentHashSelection(serviceName: string, key: string): string {
    const endpoints = this.discovery.getEndpoints(serviceName);
    if (endpoints.length === 0) return '';

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    const index = Math.abs(hash) % endpoints.length;
    return endpoints[index].id;
  }

  private randomSelection(endpoints: any[]): string {
    const index = Math.floor(Math.random() * endpoints.length);
    return endpoints[index].id;
  }

  private isEndpointAvailable(endpoints: any[], endpointId: string): boolean {
    return endpoints.some(e => e.id === endpointId);
  }

  private setupCleanupInterval(): void {
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes

      for (const [sessionId, session] of this.sessions) {
        if (now - session.lastAccess.getTime() > sessionTimeout) {
          this.sessions.delete(sessionId);
        }
      }
    }, 5 * 60 * 1000);
  }
}