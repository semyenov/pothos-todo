/**
 * Enhanced Service Registry with Lifecycle Management and Dependency Tracking
 * Extends the existing ServiceRegistry with advanced features for orchestration
 */

import { logger, objectUtils, stringUtils } from '@/lib/unjs-utils.js';
import { ServiceRegistry as BaseServiceRegistry, ServiceDefinition as BaseServiceDefinition } from './ServiceRegistry.js';
import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { ServiceDefinition as OrchestrationServiceDef } from '../orchestration/ServiceDependencyGraph.js';
import { z } from 'zod';

/**
 * Service lifecycle states
 */
export type ServiceLifecycleState = 
  | 'registered'
  | 'initializing'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'stopping'
  | 'stopped'
  | 'failed';

/**
 * Enhanced service definition with lifecycle and dependencies
 */
export interface EnhancedServiceDefinition extends BaseServiceDefinition {
  lifecycle: {
    state: ServiceLifecycleState;
    stateChangedAt: Date;
    stateHistory: Array<{
      state: ServiceLifecycleState;
      timestamp: Date;
      reason?: string;
    }>;
  };
  dependencies: {
    required: string[];
    optional: string[];
    dependents: string[]; // Services that depend on this one
  };
  orchestration: {
    startupTimeout: number;
    shutdownTimeout: number;
    healthCheckInterval: number;
    retryPolicy?: {
      maxAttempts: number;
      backoffMs: number;
    };
  };
  metrics: {
    startupDuration?: number;
    uptimeMs: number;
    restartCount: number;
    lastHealthCheck?: Date;
    healthCheckFailures: number;
  };
}

/**
 * Service lifecycle event
 */
export interface ServiceLifecycleEvent {
  serviceId: string;
  serviceName: string;
  previousState: ServiceLifecycleState;
  newState: ServiceLifecycleState;
  timestamp: Date;
  reason?: string;
  metadata?: any;
}

/**
 * Dependency validation result
 */
export interface DependencyValidation {
  valid: boolean;
  missingDependencies: string[];
  circularDependencies: string[][];
  warnings: string[];
}

/**
 * Registry event map
 */
interface EnhancedRegistryEventMap {
  'service:lifecycle-changed': ServiceLifecycleEvent;
  'service:health-changed': { serviceId: string; previousHealth: string; newHealth: string };
  'service:dependency-updated': { serviceId: string; dependencies: string[] };
  'service:metric-recorded': { serviceId: string; metric: string; value: number };
  'registry:topology-changed': { services: number; topology: any };
}

/**
 * Enhanced Service Registry with comprehensive lifecycle management
 * 
 * Features:
 * - Service lifecycle state management
 * - Dependency tracking and validation
 * - Health state transitions
 * - Startup/shutdown orchestration
 * - Metrics collection
 * - Event-driven state changes
 */
export class EnhancedServiceRegistry extends BaseServiceRegistry {
  private eventEmitter: TypedEventEmitter<EnhancedRegistryEventMap>;
  private enhancedServices: Map<string, EnhancedServiceDefinition> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();
  private lifecycleHandlers: Map<ServiceLifecycleState, Set<(event: ServiceLifecycleEvent) => void>> = new Map();

  constructor() {
    super();
    this.eventEmitter = new TypedEventEmitter();
    this.initializeLifecycleHandlers();
  }

  /**
   * Initialize lifecycle state handlers
   */
  private initializeLifecycleHandlers(): void {
    // Setup default handlers for each state
    const states: ServiceLifecycleState[] = [
      'registered', 'initializing', 'starting', 'healthy',
      'degraded', 'unhealthy', 'stopping', 'stopped', 'failed'
    ];

    for (const state of states) {
      this.lifecycleHandlers.set(state, new Set());
    }
  }

  /**
   * Register an enhanced service with lifecycle and dependencies
   */
  registerEnhancedService(
    baseDefinition: Omit<BaseServiceDefinition, 'id'>,
    orchestrationDef?: OrchestrationServiceDef
  ): string {
    // Register with base registry first
    const serviceId = super.registerService(baseDefinition);

    // Create enhanced definition
    const enhanced: EnhancedServiceDefinition = {
      ...(this.services.get(serviceId)!),
      lifecycle: {
        state: 'registered',
        stateChangedAt: new Date(),
        stateHistory: [{
          state: 'registered',
          timestamp: new Date(),
        }],
      },
      dependencies: {
        required: orchestrationDef?.dependencies || [],
        optional: orchestrationDef?.optionalDependencies || [],
        dependents: [],
      },
      orchestration: {
        startupTimeout: orchestrationDef?.startupTimeout || 30000,
        shutdownTimeout: 30000,
        healthCheckInterval: 30000,
        retryPolicy: orchestrationDef?.retryPolicy ? {
          maxAttempts: orchestrationDef.retryPolicy.attempts,
          backoffMs: orchestrationDef.retryPolicy.delay,
        } : undefined,
      },
      metrics: {
        uptimeMs: 0,
        restartCount: 0,
        healthCheckFailures: 0,
      },
    };

    this.enhancedServices.set(serviceId, enhanced);

    // Update dependency graph
    this.updateDependencyGraph(serviceId, enhanced.dependencies.required);

    // Emit registration event
    this.emitLifecycleEvent(serviceId, 'registered', 'registered', 'Service registered');

    logger.info('Enhanced service registered', {
      serviceId,
      name: baseDefinition.name,
      dependencies: enhanced.dependencies.required,
    });

    return serviceId;
  }

  /**
   * Update service lifecycle state
   */
  updateServiceLifecycle(
    serviceId: string,
    newState: ServiceLifecycleState,
    reason?: string
  ): void {
    const service = this.enhancedServices.get(serviceId);
    if (!service) {
      throw new Error(`Enhanced service not found: ${serviceId}`);
    }

    const previousState = service.lifecycle.state;
    
    // Validate state transition
    if (!this.isValidStateTransition(previousState, newState)) {
      throw new Error(`Invalid state transition: ${previousState} -> ${newState}`);
    }

    // Update state
    service.lifecycle.state = newState;
    service.lifecycle.stateChangedAt = new Date();
    service.lifecycle.stateHistory.push({
      state: newState,
      timestamp: new Date(),
      reason,
    });

    // Update base service status
    const baseStatus = this.mapLifecycleToBaseStatus(newState);
    if (service.status !== baseStatus) {
      service.status = baseStatus;
      super.updateServiceStatus(serviceId, baseStatus);
    }

    // Emit lifecycle event
    this.emitLifecycleEvent(serviceId, previousState, newState, reason);

    // Execute state handlers
    const handlers = this.lifecycleHandlers.get(newState);
    if (handlers) {
      const event: ServiceLifecycleEvent = {
        serviceId,
        serviceName: service.name,
        previousState,
        newState,
        timestamp: new Date(),
        reason,
      };

      handlers.forEach(handler => handler(event));
    }

    // Update metrics
    if (newState === 'healthy' && previousState === 'starting') {
      service.metrics.startupDuration = Date.now() - service.lifecycle.stateHistory
        .find(h => h.state === 'starting')!.timestamp.getTime();
    }

    logger.info('Service lifecycle updated', {
      serviceId,
      name: service.name,
      previousState,
      newState,
      reason,
    });
  }

  /**
   * Update service dependencies
   */
  updateServiceDependencies(
    serviceId: string,
    dependencies: { required?: string[]; optional?: string[] }
  ): void {
    const service = this.enhancedServices.get(serviceId);
    if (!service) {
      throw new Error(`Enhanced service not found: ${serviceId}`);
    }

    // Update dependencies
    if (dependencies.required) {
      service.dependencies.required = dependencies.required;
      this.updateDependencyGraph(serviceId, dependencies.required);
    }

    if (dependencies.optional) {
      service.dependencies.optional = dependencies.optional;
    }

    // Emit event
    this.eventEmitter.emit('service:dependency-updated', {
      serviceId,
      dependencies: service.dependencies.required,
    });

    // Validate dependencies
    this.validateServiceDependencies(serviceId);
  }

  /**
   * Get services by lifecycle state
   */
  getServicesByState(state: ServiceLifecycleState): EnhancedServiceDefinition[] {
    return Array.from(this.enhancedServices.values())
      .filter(service => service.lifecycle.state === state);
  }

  /**
   * Get service dependents
   */
  getServiceDependents(serviceId: string): string[] {
    const service = this.enhancedServices.get(serviceId);
    return service?.dependencies.dependents || [];
  }

  /**
   * Get service dependencies
   */
  getServiceDependencies(serviceId: string): { required: string[]; optional: string[] } {
    const service = this.enhancedServices.get(serviceId);
    return {
      required: service?.dependencies.required || [],
      optional: service?.dependencies.optional || [],
    };
  }

  /**
   * Validate all service dependencies
   */
  validateAllDependencies(): DependencyValidation {
    const validation: DependencyValidation = {
      valid: true,
      missingDependencies: [],
      circularDependencies: [],
      warnings: [],
    };

    // Check for missing dependencies
    for (const [serviceId, service] of this.enhancedServices) {
      for (const dep of service.dependencies.required) {
        if (!this.getServiceByName(dep)) {
          validation.valid = false;
          validation.missingDependencies.push(`${service.name} -> ${dep}`);
        }
      }
    }

    // Check for circular dependencies
    const cycles = this.detectCircularDependencies();
    if (cycles.length > 0) {
      validation.valid = false;
      validation.circularDependencies = cycles;
    }

    // Generate warnings
    for (const [serviceId, service] of this.enhancedServices) {
      if (service.dependencies.dependents.length === 0 && 
          service.type !== 'gateway' && 
          service.type !== 'api') {
        validation.warnings.push(`${service.name} has no dependents`);
      }
    }

    return validation;
  }

  /**
   * Get service topology (for visualization)
   */
  getServiceTopology(): {
    nodes: Array<{ id: string; name: string; state: string; type: string }>;
    edges: Array<{ source: string; target: string; optional: boolean }>;
  } {
    const nodes: Array<{ id: string; name: string; state: string; type: string }> = [];
    const edges: Array<{ source: string; target: string; optional: boolean }> = [];

    for (const [serviceId, service] of this.enhancedServices) {
      nodes.push({
        id: serviceId,
        name: service.name,
        state: service.lifecycle.state,
        type: service.type,
      });

      // Add required dependencies
      for (const dep of service.dependencies.required) {
        const depService = this.getServiceByName(dep);
        if (depService) {
          edges.push({
            source: depService.id,
            target: serviceId,
            optional: false,
          });
        }
      }

      // Add optional dependencies
      for (const dep of service.dependencies.optional) {
        const depService = this.getServiceByName(dep);
        if (depService) {
          edges.push({
            source: depService.id,
            target: serviceId,
            optional: true,
          });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Register lifecycle state handler
   */
  onLifecycleState(
    state: ServiceLifecycleState,
    handler: (event: ServiceLifecycleEvent) => void
  ): () => void {
    const handlers = this.lifecycleHandlers.get(state);
    if (handlers) {
      handlers.add(handler);
    }

    // Return unsubscribe function
    return () => {
      handlers?.delete(handler);
    };
  }

  /**
   * Get service metrics
   */
  getServiceMetrics(serviceId: string): EnhancedServiceDefinition['metrics'] | undefined {
    return this.enhancedServices.get(serviceId)?.metrics;
  }

  /**
   * Record service metric
   */
  recordServiceMetric(serviceId: string, metric: string, value: number): void {
    const service = this.enhancedServices.get(serviceId);
    if (!service) return;

    // Update specific metrics
    switch (metric) {
      case 'health_check_failures':
        service.metrics.healthCheckFailures = value;
        break;
      case 'restart_count':
        service.metrics.restartCount = value;
        break;
      case 'uptime_ms':
        service.metrics.uptimeMs = value;
        break;
    }

    this.eventEmitter.emit('service:metric-recorded', {
      serviceId,
      metric,
      value,
    });
  }

  /**
   * Get lifecycle history for a service
   */
  getServiceLifecycleHistory(serviceId: string): Array<{
    state: ServiceLifecycleState;
    timestamp: Date;
    reason?: string;
  }> {
    return this.enhancedServices.get(serviceId)?.lifecycle.stateHistory || [];
  }

  /**
   * Private helper methods
   */

  private updateDependencyGraph(serviceId: string, dependencies: string[]): void {
    // Update forward dependencies
    this.dependencyGraph.set(serviceId, new Set(dependencies));

    // Update reverse dependencies (dependents)
    for (const [id, service] of this.enhancedServices) {
      service.dependencies.dependents = service.dependencies.dependents
        .filter(d => d !== serviceId);
    }

    for (const dep of dependencies) {
      const depService = this.getServiceByName(dep);
      if (depService) {
        const enhanced = this.enhancedServices.get(depService.id);
        if (enhanced && !enhanced.dependencies.dependents.includes(serviceId)) {
          enhanced.dependencies.dependents.push(serviceId);
        }
      }
    }

    this.eventEmitter.emit('registry:topology-changed', {
      services: this.enhancedServices.size,
      topology: this.getServiceTopology(),
    });
  }

  private validateServiceDependencies(serviceId: string): void {
    const service = this.enhancedServices.get(serviceId);
    if (!service) return;

    const missing: string[] = [];
    
    for (const dep of service.dependencies.required) {
      if (!this.getServiceByName(dep)) {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      logger.warn(`Service ${service.name} has missing dependencies`, { missing });
    }
  }

  private getServiceByName(name: string): BaseServiceDefinition | undefined {
    return Array.from(this.services.values()).find(s => s.name === name);
  }

  private detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (serviceId: string): boolean => {
      visited.add(serviceId);
      recursionStack.add(serviceId);
      path.push(serviceId);

      const dependencies = this.dependencyGraph.get(serviceId) || new Set();
      
      for (const dep of dependencies) {
        const depService = this.getServiceByName(dep);
        if (!depService) continue;

        if (!visited.has(depService.id)) {
          if (dfs(depService.id)) {
            return true;
          }
        } else if (recursionStack.has(depService.id)) {
          // Found cycle
          const cycleStart = path.indexOf(depService.id);
          const cycle = path.slice(cycleStart).map(id => 
            this.enhancedServices.get(id)?.name || id
          );
          cycle.push(depService.name);
          cycles.push(cycle);
          return true;
        }
      }

      path.pop();
      recursionStack.delete(serviceId);
      return false;
    };

    for (const serviceId of this.enhancedServices.keys()) {
      if (!visited.has(serviceId)) {
        dfs(serviceId);
      }
    }

    return cycles;
  }

  private isValidStateTransition(from: ServiceLifecycleState, to: ServiceLifecycleState): boolean {
    const validTransitions: Record<ServiceLifecycleState, ServiceLifecycleState[]> = {
      'registered': ['initializing', 'failed'],
      'initializing': ['starting', 'failed'],
      'starting': ['healthy', 'degraded', 'unhealthy', 'failed'],
      'healthy': ['degraded', 'unhealthy', 'stopping'],
      'degraded': ['healthy', 'unhealthy', 'stopping'],
      'unhealthy': ['healthy', 'degraded', 'stopping', 'failed'],
      'stopping': ['stopped', 'failed'],
      'stopped': ['initializing'],
      'failed': ['initializing'],
    };

    return validTransitions[from]?.includes(to) || false;
  }

  private mapLifecycleToBaseStatus(
    lifecycle: ServiceLifecycleState
  ): 'healthy' | 'unhealthy' | 'starting' | 'stopping' | 'maintenance' {
    switch (lifecycle) {
      case 'healthy':
        return 'healthy';
      case 'degraded':
      case 'unhealthy':
      case 'failed':
        return 'unhealthy';
      case 'initializing':
      case 'starting':
        return 'starting';
      case 'stopping':
      case 'stopped':
        return 'stopping';
      default:
        return 'maintenance';
    }
  }

  private emitLifecycleEvent(
    serviceId: string,
    previousState: ServiceLifecycleState,
    newState: ServiceLifecycleState,
    reason?: string
  ): void {
    const service = this.enhancedServices.get(serviceId);
    if (!service) return;

    const event: ServiceLifecycleEvent = {
      serviceId,
      serviceName: service.name,
      previousState,
      newState,
      timestamp: new Date(),
      reason,
    };

    this.eventEmitter.emit('service:lifecycle-changed', event);
  }

  /**
   * Get event emitter for subscribing to events
   */
  getEventEmitter(): TypedEventEmitter<EnhancedRegistryEventMap> {
    return this.eventEmitter;
  }

  /**
   * Get enhanced service definition
   */
  getEnhancedService(serviceId: string): EnhancedServiceDefinition | undefined {
    return this.enhancedServices.get(serviceId);
  }

  /**
   * Export registry state
   */
  exportState(): {
    services: EnhancedServiceDefinition[];
    topology: ReturnType<typeof this.getServiceTopology>;
    validation: DependencyValidation;
  } {
    return {
      services: Array.from(this.enhancedServices.values()),
      topology: this.getServiceTopology(),
      validation: this.validateAllDependencies(),
    };
  }
}

// Export singleton instance
export const enhancedServiceRegistry = new EnhancedServiceRegistry();