import { logger } from '@/lib/unjs-utils.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';

export interface ServiceDefinition {
  name: string;
  critical: boolean;
  dependencies: string[];
  optionalDependencies?: string[];
  timeout: number;
  retryPolicy?: {
    attempts: number;
    delay: number;
    backoff: 'linear' | 'exponential';
  };
  healthChecks?: {
    startup?: string;
    runtime?: string[];
  };
  resources?: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };
  capabilities?: string[];
  version?: string;
}

export interface DependencyGroup {
  level: number;
  services: string[];
  parallel: boolean;
  critical: boolean;
}

export interface CriticalPath {
  services: string[];
  totalTime: number;
  bottleneck?: string;
}

interface DependencyGraphEventMap {
  'dependency:added': {
    service: string;
    dependency: string;
    type: 'required' | 'optional';
  };
  'dependency:removed': {
    service: string;
    dependency: string;
  };
  'circular:detected': {
    cycle: string[];
  };
  'graph:updated': {
    timestamp: Date;
  };
}

/**
 * Service Dependency Graph for orchestration
 * Provides topological sorting, parallel group identification, and critical path analysis
 */
export class ServiceDependencyGraph extends TypedEventEmitter<DependencyGraphEventMap> {
  private services: Map<string, ServiceDefinition> = new Map();
  private dependencyMatrix: Map<string, Set<string>> = new Map();
  private reverseDependencyMatrix: Map<string, Set<string>> = new Map();
  private lastSortedGroups: DependencyGroup[] = [];

  /**
   * Add a service definition to the graph
   */
  addService(definition: ServiceDefinition): void {
    const existingService = this.services.get(definition.name);
    this.services.set(definition.name, definition);

    // Update dependency matrices
    this.updateDependencyMatrix(definition.name, definition.dependencies, definition.optionalDependencies || []);

    // Emit events for new dependencies
    if (!existingService) {
      for (const dep of definition.dependencies) {
        this.emit('dependency:added', {
          service: definition.name,
          dependency: dep,
          type: 'required',
        });
      }
      
      for (const dep of definition.optionalDependencies || []) {
        this.emit('dependency:added', {
          service: definition.name,
          dependency: dep,
          type: 'optional',
        });
      }
    }

    this.emit('graph:updated', { timestamp: new Date() });
  }

  /**
   * Remove a service from the graph
   */
  removeService(serviceName: string): void {
    const service = this.services.get(serviceName);
    if (!service) return;

    // Remove from services
    this.services.delete(serviceName);

    // Clean up dependency matrices
    this.dependencyMatrix.delete(serviceName);
    this.reverseDependencyMatrix.delete(serviceName);

    // Remove references from other services
    for (const [name, deps] of this.dependencyMatrix.entries()) {
      if (deps.has(serviceName)) {
        deps.delete(serviceName);
        this.emit('dependency:removed', {
          service: name,
          dependency: serviceName,
        });
      }
    }

    for (const [name, deps] of this.reverseDependencyMatrix.entries()) {
      deps.delete(serviceName);
    }

    this.emit('graph:updated', { timestamp: new Date() });
  }

  /**
   * Add a dependency between services
   */
  addDependency(serviceName: string, dependencyName: string, optional: boolean = false): void {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    // Update service definition
    if (optional) {
      service.optionalDependencies = service.optionalDependencies || [];
      if (!service.optionalDependencies.includes(dependencyName)) {
        service.optionalDependencies.push(dependencyName);
      }
    } else {
      if (!service.dependencies.includes(dependencyName)) {
        service.dependencies.push(dependencyName);
      }
    }

    // Update matrices
    this.updateDependencyMatrix(serviceName, service.dependencies, service.optionalDependencies || []);

    this.emit('dependency:added', {
      service: serviceName,
      dependency: dependencyName,
      type: optional ? 'optional' : 'required',
    });

    this.emit('graph:updated', { timestamp: new Date() });
  }

  /**
   * Remove a dependency
   */
  removeDependency(serviceName: string, dependencyName: string): void {
    const service = this.services.get(serviceName);
    if (!service) return;

    // Remove from required dependencies
    const reqIndex = service.dependencies.indexOf(dependencyName);
    if (reqIndex !== -1) {
      service.dependencies.splice(reqIndex, 1);
    }

    // Remove from optional dependencies
    if (service.optionalDependencies) {
      const optIndex = service.optionalDependencies.indexOf(dependencyName);
      if (optIndex !== -1) {
        service.optionalDependencies.splice(optIndex, 1);
      }
    }

    // Update matrices
    this.updateDependencyMatrix(serviceName, service.dependencies, service.optionalDependencies || []);

    this.emit('dependency:removed', {
      service: serviceName,
      dependency: dependencyName,
    });

    this.emit('graph:updated', { timestamp: new Date() });
  }

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (serviceName: string, path: string[]): void => {
      if (recursionStack.has(serviceName)) {
        // Found a cycle
        const cycleStart = path.indexOf(serviceName);
        const cycle = path.slice(cycleStart).concat([serviceName]);
        cycles.push(cycle);
        
        this.emit('circular:detected', { cycle });
        return;
      }

      if (visited.has(serviceName)) {
        return;
      }

      visited.add(serviceName);
      recursionStack.add(serviceName);

      const dependencies = this.dependencyMatrix.get(serviceName) || new Set();
      for (const dep of dependencies) {
        dfs(dep, [...path, serviceName]);
      }

      recursionStack.delete(serviceName);
    };

    for (const serviceName of this.services.keys()) {
      if (!visited.has(serviceName)) {
        dfs(serviceName, []);
      }
    }

    return cycles;
  }

  /**
   * Perform topological sort to determine startup order
   */
  topologicalSort(includeOptional: boolean = false): DependencyGroup[] {
    const cycles = this.detectCircularDependencies();
    if (cycles.length > 0) {
      throw new Error(`Circular dependencies detected: ${cycles.map(c => c.join(' -> ')).join(', ')}`);
    }

    const inDegree = new Map<string, number>();
    const groups: DependencyGroup[] = [];
    const visited = new Set<string>();

    // Initialize in-degree count
    for (const serviceName of this.services.keys()) {
      inDegree.set(serviceName, 0);
    }

    // Calculate in-degrees
    for (const [serviceName, deps] of this.dependencyMatrix.entries()) {
      for (const dep of deps) {
        if (this.services.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
      }

      // Include optional dependencies if requested
      if (includeOptional) {
        const service = this.services.get(serviceName);
        if (service?.optionalDependencies) {
          for (const dep of service.optionalDependencies) {
            if (this.services.has(dep)) {
              inDegree.set(dep, (inDegree.get(dep) || 0) + 0.5); // Weight optional deps less
            }
          }
        }
      }
    }

    let level = 0;
    while (visited.size < this.services.size) {
      // Find services with no dependencies
      const readyServices: string[] = [];
      
      for (const [serviceName, degree] of inDegree.entries()) {
        if (!visited.has(serviceName) && degree === 0) {
          readyServices.push(serviceName);
        }
      }

      if (readyServices.length === 0) {
        // Handle remaining services with circular or missing dependencies
        const remaining = Array.from(this.services.keys()).filter(s => !visited.has(s));
        logger.warn('Breaking dependency deadlock for services:', remaining);
        readyServices.push(...remaining);
      }

      // Determine if services in this group can run in parallel
      const canRunParallel = this.canRunInParallel(readyServices);
      const hasCriticalService = readyServices.some(s => this.services.get(s)?.critical);

      groups.push({
        level,
        services: readyServices,
        parallel: canRunParallel,
        critical: hasCriticalService,
      });

      // Mark as visited and update in-degrees
      for (const serviceName of readyServices) {
        visited.add(serviceName);
        
        const reverseDeps = this.reverseDependencyMatrix.get(serviceName) || new Set();
        for (const dependent of reverseDeps) {
          if (!visited.has(dependent)) {
            inDegree.set(dependent, Math.max(0, (inDegree.get(dependent) || 0) - 1));
          }
        }
      }

      level++;
    }

    this.lastSortedGroups = groups;
    return groups;
  }

  /**
   * Calculate the critical path through the dependency graph
   */
  calculateCriticalPath(): CriticalPath {
    const groups = this.lastSortedGroups.length > 0 
      ? this.lastSortedGroups 
      : this.topologicalSort();

    let totalTime = 0;
    let bottleneck: string | undefined;
    let maxServiceTime = 0;
    const criticalServices: string[] = [];

    for (const group of groups) {
      if (group.parallel) {
        // For parallel groups, time is determined by the slowest service
        let groupMaxTime = 0;
        let groupBottleneck: string | undefined;

        for (const serviceName of group.services) {
          const service = this.services.get(serviceName);
          const serviceTime = service?.timeout || 30000;
          
          if (serviceTime > groupMaxTime) {
            groupMaxTime = serviceTime;
            groupBottleneck = serviceName;
          }
        }

        totalTime += groupMaxTime;
        if (groupMaxTime > maxServiceTime) {
          maxServiceTime = groupMaxTime;
          bottleneck = groupBottleneck;
        }

        if (groupBottleneck) {
          criticalServices.push(groupBottleneck);
        }
      } else {
        // For sequential groups, add all service times
        for (const serviceName of group.services) {
          const service = this.services.get(serviceName);
          const serviceTime = service?.timeout || 30000;
          
          totalTime += serviceTime;
          criticalServices.push(serviceName);

          if (serviceTime > maxServiceTime) {
            maxServiceTime = serviceTime;
            bottleneck = serviceName;
          }
        }
      }
    }

    return {
      services: criticalServices,
      totalTime,
      bottleneck,
    };
  }

  /**
   * Get parallel groups for optimized startup
   */
  getParallelGroups(): DependencyGroup[] {
    return this.topologicalSort().filter(group => group.parallel);
  }

  /**
   * Get services that can be skipped without affecting critical services
   */
  getNonCriticalServices(): string[] {
    const nonCritical: string[] = [];
    
    for (const [name, service] of this.services.entries()) {
      if (!service.critical) {
        // Check if any critical service depends on this
        const dependents = this.reverseDependencyMatrix.get(name) || new Set();
        const hasCriticalDependents = Array.from(dependents).some(dep => 
          this.services.get(dep)?.critical
        );
        
        if (!hasCriticalDependents) {
          nonCritical.push(name);
        }
      }
    }

    return nonCritical;
  }

  /**
   * Validate the dependency graph
   */
  validate(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for missing dependencies
    for (const [serviceName, service] of this.services.entries()) {
      for (const dep of service.dependencies) {
        if (!this.services.has(dep)) {
          errors.push(`Service ${serviceName} depends on missing service: ${dep}`);
        }
      }

      for (const dep of service.optionalDependencies || []) {
        if (!this.services.has(dep)) {
          warnings.push(`Service ${serviceName} has optional dependency on missing service: ${dep}`);
        }
      }
    }

    // Check for circular dependencies
    const cycles = this.detectCircularDependencies();
    for (const cycle of cycles) {
      errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
    }

    // Check for isolated services
    for (const serviceName of this.services.keys()) {
      const hasDependencies = (this.dependencyMatrix.get(serviceName)?.size || 0) > 0;
      const hasDependents = (this.reverseDependencyMatrix.get(serviceName)?.size || 0) > 0;
      
      if (!hasDependencies && !hasDependents) {
        warnings.push(`Service ${serviceName} has no dependencies or dependents (isolated)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get service definition
   */
  getService(name: string): ServiceDefinition | undefined {
    return this.services.get(name);
  }

  /**
   * Get all services
   */
  getAllServices(): Map<string, ServiceDefinition> {
    return new Map(this.services);
  }

  /**
   * Get dependencies for a service
   */
  getDependencies(serviceName: string): {
    required: string[];
    optional: string[];
  } {
    const service = this.services.get(serviceName);
    return {
      required: service?.dependencies || [],
      optional: service?.optionalDependencies || [],
    };
  }

  /**
   * Get services that depend on a given service
   */
  getDependents(serviceName: string): string[] {
    return Array.from(this.reverseDependencyMatrix.get(serviceName) || new Set());
  }

  /**
   * Export graph for visualization
   */
  exportGraph(): {
    nodes: Array<{
      id: string;
      label: string;
      critical: boolean;
      timeout: number;
      level?: number;
    }>;
    edges: Array<{
      from: string;
      to: string;
      type: 'required' | 'optional';
    }>;
  } {
    const nodes = Array.from(this.services.entries()).map(([name, service]) => ({
      id: name,
      label: name,
      critical: service.critical,
      timeout: service.timeout,
    }));

    const edges: Array<{
      from: string;
      to: string;
      type: 'required' | 'optional';
    }> = [];

    for (const [serviceName, service] of this.services.entries()) {
      for (const dep of service.dependencies) {
        edges.push({
          from: serviceName,
          to: dep,
          type: 'required',
        });
      }

      for (const dep of service.optionalDependencies || []) {
        edges.push({
          from: serviceName,
          to: dep,
          type: 'optional',
        });
      }
    }

    return { nodes, edges };
  }

  private updateDependencyMatrix(serviceName: string, required: string[], optional: string[]): void {
    // Update forward dependencies
    this.dependencyMatrix.set(serviceName, new Set([...required, ...optional]));

    // Update reverse dependencies
    for (const dep of [...required, ...optional]) {
      if (!this.reverseDependencyMatrix.has(dep)) {
        this.reverseDependencyMatrix.set(dep, new Set());
      }
      this.reverseDependencyMatrix.get(dep)!.add(serviceName);
    }
  }

  private canRunInParallel(services: string[]): boolean {
    // Services can run in parallel if they don't have inter-dependencies
    for (let i = 0; i < services.length; i++) {
      for (let j = i + 1; j < services.length; j++) {
        const service1 = services[i];
        const service2 = services[j];
        
        // Check if service1 depends on service2 or vice versa
        const deps1 = this.dependencyMatrix.get(service1) || new Set();
        const deps2 = this.dependencyMatrix.get(service2) || new Set();
        
        if (deps1.has(service2) || deps2.has(service1)) {
          return false;
        }
      }
    }
    
    return true;
  }
}

/**
 * Default service definitions for the Todo application
 */
export const DEFAULT_SERVICE_DEFINITIONS: ServiceDefinition[] = [
  // Core infrastructure (no dependencies)
  {
    name: 'prisma-service',
    critical: true,
    dependencies: [],
    timeout: 30000,
    retryPolicy: { attempts: 3, delay: 5000, backoff: 'exponential' },
    healthChecks: { startup: 'database:connection', runtime: ['database:health'] },
    resources: { memory: '256Mi', cpu: '100m' },
  },
  {
    name: 'cache-manager',
    critical: false,
    dependencies: [],
    timeout: 10000,
    retryPolicy: { attempts: 2, delay: 2000, backoff: 'linear' },
    healthChecks: { startup: 'cache:connection', runtime: ['cache:health'] },
    resources: { memory: '128Mi', cpu: '50m' },
  },
  {
    name: 'message-broker',
    critical: true,
    dependencies: [],
    timeout: 20000,
    retryPolicy: { attempts: 3, delay: 3000, backoff: 'exponential' },
    healthChecks: { startup: 'broker:connection', runtime: ['broker:health'] },
    resources: { memory: '256Mi', cpu: '100m' },
  },

  // Event system (depends on database and message broker)
  {
    name: 'event-store',
    critical: true,
    dependencies: ['prisma-service'],
    timeout: 20000,
    retryPolicy: { attempts: 2, delay: 3000, backoff: 'exponential' },
    healthChecks: { startup: 'eventstore:ready', runtime: ['eventstore:health'] },
  },
  {
    name: 'cqrs-coordinator',
    critical: true,
    dependencies: ['prisma-service', 'event-store', 'message-broker'],
    timeout: 30000,
    retryPolicy: { attempts: 2, delay: 5000, backoff: 'exponential' },
  },
  {
    name: 'read-model-manager',
    critical: true,
    dependencies: ['prisma-service', 'cqrs-coordinator'],
    optionalDependencies: ['cache-manager'],
    timeout: 25000,
  },

  // Microservices infrastructure
  {
    name: 'service-registry',
    critical: true,
    dependencies: [],
    timeout: 15000,
    capabilities: ['service-discovery', 'health-monitoring'],
  },
  {
    name: 'service-mesh',
    critical: true,
    dependencies: ['service-registry'],
    timeout: 20000,
    capabilities: ['traffic-management', 'security-policies'],
  },
  {
    name: 'api-gateway',
    critical: true,
    dependencies: ['service-mesh', 'cache-manager'],
    timeout: 30000,
    capabilities: ['routing', 'rate-limiting', 'authentication'],
  },

  // AI services (optional)
  {
    name: 'vector-store',
    critical: false,
    dependencies: [],
    timeout: 15000,
    capabilities: ['vector-search', 'embeddings'],
  },
  {
    name: 'embedding-service',
    critical: false,
    dependencies: ['vector-store'],
    timeout: 25000,
    capabilities: ['text-embedding', 'similarity-search'],
  },
  {
    name: 'nlp-service',
    critical: false,
    dependencies: [],
    timeout: 30000,
    capabilities: ['text-processing', 'command-parsing'],
  },
  {
    name: 'rag-service',
    critical: false,
    dependencies: ['embedding-service', 'vector-store'],
    optionalDependencies: ['nlp-service'],
    timeout: 35000,
    capabilities: ['knowledge-retrieval', 'context-generation'],
  },

  // Monitoring and management
  {
    name: 'service-dashboard',
    critical: false,
    dependencies: ['service-registry'],
    optionalDependencies: ['cache-manager'],
    timeout: 15000,
    capabilities: ['monitoring', 'alerting'],
  },
  {
    name: 'chaos-engineering',
    critical: false,
    dependencies: ['service-registry'],
    timeout: 10000,
    capabilities: ['fault-injection', 'resilience-testing'],
  },
];