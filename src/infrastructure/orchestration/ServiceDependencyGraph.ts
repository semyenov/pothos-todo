import { z } from 'zod';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Retry policy for service startup
 */
export interface RetryPolicy {
  attempts: number;
  delay: number;
  maxDelay: number;
  backoff: 'fixed' | 'exponential' | 'linear';
  retryIf?: (error: Error) => boolean;
}

/**
 * Health requirement for a service
 */
export interface HealthRequirement {
  check: string;
  threshold: 'healthy' | 'degraded' | 'any';
  timeout?: number;
}

/**
 * Service definition with dependencies and metadata
 */
export interface ServiceDefinition {
  name: string;
  critical: boolean;
  dependencies: string[];
  optionalDependencies?: string[];
  startupTimeout?: number;
  retryPolicy?: RetryPolicy;
  healthRequirements?: HealthRequirement[];
  metadata?: Record<string, any>;
}

/**
 * Service node in the dependency graph
 */
interface ServiceNode {
  definition: ServiceDefinition;
  dependents: Set<string>; // Services that depend on this one
  depth: number; // Depth in dependency tree
  visited: boolean; // For cycle detection
  visiting: boolean; // For cycle detection
}

/**
 * Group of services that can be started in parallel
 */
export interface ServiceGroup {
  services: string[];
  depth: number;
  timeout: number;
  critical: boolean;
}

/**
 * Validation result for the dependency graph
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycles: string[][];
  missingDependencies: Map<string, string[]>;
}

/**
 * Service dependency graph for managing service startup order
 * 
 * Features:
 * - Topological sort for dependency resolution
 * - Circular dependency detection
 * - Parallel group identification
 * - Critical path analysis
 * - Dynamic dependency updates
 */
export class ServiceDependencyGraph {
  private graph: Map<string, ServiceNode> = new Map();
  private topologicalOrder: string[] = [];
  private parallelGroups: ServiceGroup[] = [];
  
  /**
   * Add a service to the dependency graph
   */
  addService(service: ServiceDefinition): void {
    if (this.graph.has(service.name)) {
      logger.warn(`Service ${service.name} already exists in dependency graph`);
      return;
    }

    const node: ServiceNode = {
      definition: service,
      dependents: new Set(),
      depth: -1,
      visited: false,
      visiting: false,
    };

    this.graph.set(service.name, node);
    
    // Update dependents for all dependencies
    for (const dep of service.dependencies) {
      const depNode = this.graph.get(dep);
      if (depNode) {
        depNode.dependents.add(service.name);
      }
    }
    
    // Update dependents for optional dependencies
    if (service.optionalDependencies) {
      for (const dep of service.optionalDependencies) {
        const depNode = this.graph.get(dep);
        if (depNode) {
          depNode.dependents.add(service.name);
        }
      }
    }

    // Recalculate topology when adding new service
    this.calculateTopology();
  }

  /**
   * Remove a service from the dependency graph
   */
  removeService(serviceName: string): void {
    const node = this.graph.get(serviceName);
    if (!node) return;

    // Remove from dependents of all dependencies
    for (const dep of node.definition.dependencies) {
      const depNode = this.graph.get(dep);
      if (depNode) {
        depNode.dependents.delete(serviceName);
      }
    }

    // Remove from graph
    this.graph.delete(serviceName);

    // Recalculate topology
    this.calculateTopology();
  }

  /**
   * Update service dependencies
   */
  updateDependencies(serviceName: string, dependencies: string[], optionalDependencies?: string[]): void {
    const node = this.graph.get(serviceName);
    if (!node) {
      throw new Error(`Service ${serviceName} not found in dependency graph`);
    }

    // Remove old dependencies
    for (const dep of node.definition.dependencies) {
      const depNode = this.graph.get(dep);
      if (depNode) {
        depNode.dependents.delete(serviceName);
      }
    }

    // Update dependencies
    node.definition.dependencies = dependencies;
    node.definition.optionalDependencies = optionalDependencies;

    // Add new dependencies
    for (const dep of dependencies) {
      const depNode = this.graph.get(dep);
      if (depNode) {
        depNode.dependents.add(serviceName);
      }
    }

    if (optionalDependencies) {
      for (const dep of optionalDependencies) {
        const depNode = this.graph.get(dep);
        if (depNode) {
          depNode.dependents.add(serviceName);
        }
      }
    }

    // Recalculate topology
    this.calculateTopology();
  }

  /**
   * Get topological sort of services (startup order)
   */
  getStartupOrder(): string[] {
    return [...this.topologicalOrder];
  }

  /**
   * Get services grouped by parallelization opportunity
   */
  getParallelGroups(): ServiceGroup[] {
    return [...this.parallelGroups];
  }

  /**
   * Validate the dependency graph
   */
  validateGraph(): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      cycles: [],
      missingDependencies: new Map(),
    };

    // Reset visited flags
    for (const node of this.graph.values()) {
      node.visited = false;
      node.visiting = false;
    }

    // Check for cycles
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      result.valid = false;
      result.cycles = cycles;
      result.errors.push(`Circular dependencies detected: ${cycles.map(c => c.join(' -> ')).join(', ')}`);
    }

    // Check for missing dependencies
    for (const [serviceName, node] of this.graph.entries()) {
      const missing: string[] = [];
      
      for (const dep of node.definition.dependencies) {
        if (!this.graph.has(dep)) {
          missing.push(dep);
        }
      }
      
      if (missing.length > 0) {
        result.valid = false;
        result.missingDependencies.set(serviceName, missing);
        result.errors.push(`Service ${serviceName} has missing dependencies: ${missing.join(', ')}`);
      }
    }

    // Check for optional missing dependencies (warnings only)
    for (const [serviceName, node] of this.graph.entries()) {
      if (!node.definition.optionalDependencies) continue;
      
      const missingOptional = node.definition.optionalDependencies.filter(dep => !this.graph.has(dep));
      if (missingOptional.length > 0) {
        result.warnings.push(`Service ${serviceName} has missing optional dependencies: ${missingOptional.join(', ')}`);
      }
    }

    // Warn about services with no dependents (leaf services)
    const leafServices = Array.from(this.graph.entries())
      .filter(([_, node]) => node.dependents.size === 0)
      .map(([name]) => name);
    
    if (leafServices.length > 0) {
      result.warnings.push(`Leaf services with no dependents: ${leafServices.join(', ')}`);
    }

    return result;
  }

  /**
   * Get critical path (longest dependency chain)
   */
  getCriticalPath(): string[] {
    const paths: string[][] = [];
    
    // Find all root services (no dependencies)
    const roots = Array.from(this.graph.entries())
      .filter(([_, node]) => node.definition.dependencies.length === 0)
      .map(([name]) => name);

    // DFS from each root to find all paths
    for (const root of roots) {
      this.findPaths(root, [root], paths);
    }

    // Find longest path
    let criticalPath: string[] = [];
    let maxLength = 0;
    
    for (const path of paths) {
      const length = this.calculatePathTime(path);
      if (length > maxLength) {
        maxLength = length;
        criticalPath = path;
      }
    }

    return criticalPath;
  }

  /**
   * Get service depth (distance from root)
   */
  getServiceDepth(serviceName: string): number {
    const node = this.graph.get(serviceName);
    return node?.depth ?? -1;
  }

  /**
   * Get all services at a specific depth
   */
  getServicesAtDepth(depth: number): string[] {
    return Array.from(this.graph.entries())
      .filter(([_, node]) => node.depth === depth)
      .map(([name]) => name);
  }

  /**
   * Calculate topology and parallel groups
   */
  private calculateTopology(): void {
    // Perform topological sort
    this.topologicalOrder = this.topologicalSort();
    
    // Calculate depths
    this.calculateDepths();
    
    // Group by depth for parallel execution
    this.calculateParallelGroups();
  }

  /**
   * Topological sort using DFS
   */
  private topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (serviceName: string): void => {
      if (visited.has(serviceName)) return;
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected involving ${serviceName}`);
      }

      visiting.add(serviceName);
      const node = this.graph.get(serviceName);
      
      if (node) {
        // Visit dependencies first
        for (const dep of node.definition.dependencies) {
          if (this.graph.has(dep)) {
            visit(dep);
          }
        }
        
        // Visit optional dependencies
        if (node.definition.optionalDependencies) {
          for (const dep of node.definition.optionalDependencies) {
            if (this.graph.has(dep)) {
              visit(dep);
            }
          }
        }
      }

      visiting.delete(serviceName);
      visited.add(serviceName);
      result.push(serviceName);
    };

    // Visit all nodes
    for (const serviceName of this.graph.keys()) {
      visit(serviceName);
    }

    return result;
  }

  /**
   * Calculate depth for each service
   */
  private calculateDepths(): void {
    // Reset depths
    for (const node of this.graph.values()) {
      node.depth = -1;
    }

    // BFS to calculate depths
    const queue: string[] = [];
    
    // Start with root services (no dependencies)
    for (const [name, node] of this.graph.entries()) {
      if (node.definition.dependencies.length === 0) {
        node.depth = 0;
        queue.push(name);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = this.graph.get(current)!;
      
      // Update dependents
      for (const dependent of currentNode.dependents) {
        const depNode = this.graph.get(dependent);
        if (depNode) {
          const newDepth = currentNode.depth + 1;
          if (depNode.depth < newDepth) {
            depNode.depth = newDepth;
            queue.push(dependent);
          }
        }
      }
    }
  }

  /**
   * Calculate parallel execution groups
   */
  private calculateParallelGroups(): void {
    this.parallelGroups = [];
    
    // Find max depth
    let maxDepth = 0;
    for (const node of this.graph.values()) {
      if (node.depth > maxDepth) {
        maxDepth = node.depth;
      }
    }

    // Group services by depth
    for (let depth = 0; depth <= maxDepth; depth++) {
      const services = this.getServicesAtDepth(depth);
      
      if (services.length > 0) {
        // Calculate timeout for group (max of all services)
        let groupTimeout = 30000; // Default 30s
        let hasCritical = false;
        
        for (const serviceName of services) {
          const node = this.graph.get(serviceName)!;
          const timeout = node.definition.startupTimeout || 30000;
          if (timeout > groupTimeout) {
            groupTimeout = timeout;
          }
          if (node.definition.critical) {
            hasCritical = true;
          }
        }

        this.parallelGroups.push({
          services,
          depth,
          timeout: groupTimeout,
          critical: hasCritical,
        });
      }
    }
  }

  /**
   * Detect cycles in the graph
   */
  private detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const detectCycleUtil = (serviceName: string): boolean => {
      visited.add(serviceName);
      recStack.add(serviceName);
      path.push(serviceName);

      const node = this.graph.get(serviceName);
      if (!node) return false;

      for (const dep of node.definition.dependencies) {
        if (!visited.has(dep)) {
          if (detectCycleUtil(dep)) {
            return true;
          }
        } else if (recStack.has(dep)) {
          // Found cycle
          const cycleStart = path.indexOf(dep);
          const cycle = path.slice(cycleStart);
          cycle.push(dep); // Complete the cycle
          cycles.push(cycle);
          return true;
        }
      }

      path.pop();
      recStack.delete(serviceName);
      return false;
    };

    // Check each unvisited node
    for (const serviceName of this.graph.keys()) {
      if (!visited.has(serviceName)) {
        detectCycleUtil(serviceName);
      }
    }

    return cycles;
  }

  /**
   * Find all paths from a service to leaf nodes
   */
  private findPaths(serviceName: string, currentPath: string[], allPaths: string[][]): void {
    const node = this.graph.get(serviceName);
    if (!node) return;

    if (node.dependents.size === 0) {
      // Leaf node - add path
      allPaths.push([...currentPath]);
      return;
    }

    for (const dependent of node.dependents) {
      currentPath.push(dependent);
      this.findPaths(dependent, currentPath, allPaths);
      currentPath.pop();
    }
  }

  /**
   * Calculate total time for a path
   */
  private calculatePathTime(path: string[]): number {
    let totalTime = 0;
    
    for (const serviceName of path) {
      const node = this.graph.get(serviceName);
      if (node) {
        totalTime += node.definition.startupTimeout || 30000;
      }
    }
    
    return totalTime;
  }

  /**
   * Export graph as DOT format for visualization
   */
  exportDOT(): string {
    const lines: string[] = ['digraph ServiceDependencies {'];
    lines.push('  rankdir=BT;'); // Bottom to top
    lines.push('  node [shape=box];');
    
    // Add nodes with attributes
    for (const [name, node] of this.graph.entries()) {
      const attrs: string[] = [];
      
      if (node.definition.critical) {
        attrs.push('color=red', 'style=bold');
      }
      
      if (node.depth === 0) {
        attrs.push('shape=ellipse', 'fillcolor=lightblue', 'style=filled');
      }
      
      const label = `${name}\\n(depth: ${node.depth})`;
      attrs.push(`label="${label}"`);
      
      lines.push(`  "${name}" [${attrs.join(', ')}];`);
    }
    
    // Add edges
    for (const [name, node] of this.graph.entries()) {
      for (const dep of node.definition.dependencies) {
        if (this.graph.has(dep)) {
          lines.push(`  "${dep}" -> "${name}";`);
        }
      }
      
      // Optional dependencies with dashed lines
      if (node.definition.optionalDependencies) {
        for (const dep of node.definition.optionalDependencies) {
          if (this.graph.has(dep)) {
            lines.push(`  "${dep}" -> "${name}" [style=dashed];`);
          }
        }
      }
    }
    
    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Get service statistics
   */
  getStatistics(): {
    totalServices: number;
    criticalServices: number;
    maxDepth: number;
    averageDependencies: number;
    rootServices: number;
    leafServices: number;
  } {
    let criticalCount = 0;
    let maxDepth = 0;
    let totalDependencies = 0;
    let rootCount = 0;
    let leafCount = 0;

    for (const node of this.graph.values()) {
      if (node.definition.critical) criticalCount++;
      if (node.depth > maxDepth) maxDepth = node.depth;
      totalDependencies += node.definition.dependencies.length;
      if (node.definition.dependencies.length === 0) rootCount++;
      if (node.dependents.size === 0) leafCount++;
    }

    return {
      totalServices: this.graph.size,
      criticalServices: criticalCount,
      maxDepth,
      averageDependencies: this.graph.size > 0 ? totalDependencies / this.graph.size : 0,
      rootServices: rootCount,
      leafServices: leafCount,
    };
  }
}