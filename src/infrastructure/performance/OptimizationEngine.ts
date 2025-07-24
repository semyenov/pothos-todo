import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { PerformanceBenchmark, BenchmarkResult, BenchmarkConfig } from './PerformanceBenchmark.js';
import { ServiceMetrics } from '../core/ServiceMetrics.js';
import { EnhancedServiceRegistry } from '../core/ServiceRegistry.enhanced.js';
import { logger } from '@/lib/unjs-utils.js';

export interface OptimizationStrategy {
  id: string;
  name: string;
  description: string;
  type: 'configuration' | 'algorithm' | 'resource' | 'architecture';
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedImpact: number; // % improvement expected
  effort: 'low' | 'medium' | 'high';
  implementation: {
    service: string;
    changes: Record<string, any>;
    rollback?: Record<string, any>;
  };
  conditions?: {
    minThroughput?: number;
    maxLatency?: number;
    maxErrorRate?: number;
  };
}

export interface OptimizationResult {
  strategy: OptimizationStrategy;
  beforeMetrics: BenchmarkResult;
  afterMetrics: BenchmarkResult;
  actualImpact: number;
  success: boolean;
  appliedAt: Date;
  rollbackAt?: Date;
}

export interface OptimizationPlan {
  id: string;
  name: string;
  target: {
    service: string;
    metric: 'throughput' | 'latency' | 'errorRate' | 'memoryUsage';
    improvementGoal: number; // % improvement target
  };
  strategies: OptimizationStrategy[];
  schedule: {
    strategy: string;
    order: number;
    conditions?: string[];
  }[];
  estimated: {
    totalImpact: number;
    duration: number; // minutes
    risk: 'low' | 'medium' | 'high';
  };
}

interface OptimizationEventMap {
  'optimization:started': { plan: OptimizationPlan; timestamp: Date };
  'optimization:completed': { plan: OptimizationPlan; results: OptimizationResult[]; timestamp: Date };
  'strategy:applied': { strategy: OptimizationStrategy; result: OptimizationResult };
  'strategy:rolled-back': { strategy: OptimizationStrategy; reason: string };
  'goal:achieved': { plan: OptimizationPlan; finalImprovement: number };
  'optimization:failed': { plan: OptimizationPlan; error: Error };
}

export class OptimizationEngine extends TypedEventEmitter<OptimizationEventMap> {
  private static instance: OptimizationEngine;
  private benchmark: PerformanceBenchmark;
  private metrics: ServiceMetrics;
  private registry: EnhancedServiceRegistry;
  
  private strategies = new Map<string, OptimizationStrategy>();
  private appliedOptimizations = new Map<string, OptimizationResult>();
  private optimizationHistory: OptimizationResult[] = [];

  private constructor() {
    super();
    this.benchmark = PerformanceBenchmark.getInstance();
    this.metrics = ServiceMetrics.getInstance();
    this.registry = EnhancedServiceRegistry.getInstance();
    
    this.initializeBuiltInStrategies();
  }

  static getInstance(): OptimizationEngine {
    if (!OptimizationEngine.instance) {
      OptimizationEngine.instance = new OptimizationEngine();
    }
    return OptimizationEngine.instance;
  }

  registerStrategy(strategy: OptimizationStrategy): void {
    this.strategies.set(strategy.id, strategy);
    logger.info(`🔧 Optimization strategy registered: ${strategy.name}`, {
      type: strategy.type,
      priority: strategy.priority,
      estimatedImpact: `${strategy.estimatedImpact}%`,
    });
  }

  async createOptimizationPlan(config: {
    service: string;
    metric: OptimizationPlan['target']['metric'];
    improvementGoal: number;
    maxStrategies?: number;
    allowedTypes?: OptimizationStrategy['type'][];
    riskTolerance?: 'low' | 'medium' | 'high';
  }): Promise<OptimizationPlan> {
    logger.info(`📋 Creating optimization plan for ${config.service}`, {
      metric: config.metric,
      goal: `${config.improvementGoal}%`,
    });

    // Get current performance baseline
    const baseline = await this.getCurrentBaseline(config.service);

    // Find applicable strategies
    const applicableStrategies = this.findApplicableStrategies(config);

    // Sort by priority and estimated impact
    applicableStrategies.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.estimatedImpact - a.estimatedImpact;
    });

    // Select strategies up to the goal or max limit
    const selectedStrategies: OptimizationStrategy[] = [];
    let totalEstimatedImpact = 0;
    const maxStrategies = config.maxStrategies || 5;

    for (const strategy of applicableStrategies) {
      if (selectedStrategies.length >= maxStrategies) break;
      if (totalEstimatedImpact >= config.improvementGoal) break;
      
      selectedStrategies.push(strategy);
      totalEstimatedImpact += strategy.estimatedImpact;
    }

    // Create execution schedule
    const schedule = selectedStrategies.map((strategy, index) => ({
      strategy: strategy.id,
      order: index + 1,
      conditions: this.getExecutionConditions(strategy),
    }));

    const plan: OptimizationPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `${config.service} ${config.metric} optimization`,
      target: {
        service: config.service,
        metric: config.metric,
        improvementGoal: config.improvementGoal,
      },
      strategies: selectedStrategies,
      schedule,
      estimated: {
        totalImpact: Math.min(totalEstimatedImpact, config.improvementGoal * 1.2), // Cap at 120% of goal
        duration: selectedStrategies.length * 5, // 5 minutes per strategy
        risk: this.calculatePlanRisk(selectedStrategies),
      },
    };

    logger.info(`📋 Optimization plan created`, {
      strategies: selectedStrategies.length,
      estimatedImpact: `${plan.estimated.totalImpact.toFixed(1)}%`,
      duration: `${plan.estimated.duration} minutes`,
      risk: plan.estimated.risk,
    });

    return plan;
  }

  async executeOptimizationPlan(plan: OptimizationPlan): Promise<OptimizationResult[]> {
    logger.info(`🚀 Executing optimization plan: ${plan.name}`);
    
    this.emit('optimization:started', { plan, timestamp: new Date() });

    const results: OptimizationResult[] = [];
    let cumulativeImpact = 0;

    try {
      for (const scheduleItem of plan.schedule) {
        const strategy = plan.strategies.find(s => s.id === scheduleItem.strategy);
        if (!strategy) continue;

        // Check execution conditions
        if (scheduleItem.conditions && !await this.checkConditions(scheduleItem.conditions)) {
          logger.warn(`Skipping strategy ${strategy.name}: conditions not met`);
          continue;
        }

        // Execute strategy
        const result = await this.executeStrategy(strategy);
        results.push(result);

        if (result.success) {
          cumulativeImpact += result.actualImpact;
          
          // Check if we've achieved the goal
          if (cumulativeImpact >= plan.target.improvementGoal) {
            this.emit('goal:achieved', { plan, finalImprovement: cumulativeImpact });
            logger.info(`🎯 Optimization goal achieved: ${cumulativeImpact.toFixed(1)}% improvement`);
            break;
          }
        } else {
          logger.warn(`Strategy failed: ${strategy.name}, continuing with plan...`);
        }

        // Brief pause between strategies
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      this.emit('optimization:completed', { plan, results, timestamp: new Date() });

      logger.info(`✅ Optimization plan completed`, {
        appliedStrategies: results.filter(r => r.success).length,
        totalImpact: `${cumulativeImpact.toFixed(1)}%`,
        goalAchieved: cumulativeImpact >= plan.target.improvementGoal,
      });

      return results;

    } catch (error) {
      this.emit('optimization:failed', { plan, error: error as Error });
      logger.error(`❌ Optimization plan failed: ${plan.name}`, { error });
      
      // Rollback applied strategies
      await this.rollbackStrategies(results.filter(r => r.success));
      
      throw error;
    }
  }

  async executeStrategy(strategy: OptimizationStrategy): Promise<OptimizationResult> {
    logger.info(`🔧 Applying optimization strategy: ${strategy.name}`);

    // Get baseline metrics
    const beforeMetrics = await this.runPerformanceTest(strategy.implementation.service);

    try {
      // Apply the optimization
      await this.applyStrategyChanges(strategy);

      // Wait for changes to take effect
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Measure performance after optimization
      const afterMetrics = await this.runPerformanceTest(strategy.implementation.service);

      // Calculate actual impact
      const actualImpact = this.calculateImpact(beforeMetrics, afterMetrics, strategy);

      const result: OptimizationResult = {
        strategy,
        beforeMetrics,
        afterMetrics,
        actualImpact,
        success: actualImpact > 0,
        appliedAt: new Date(),
      };

      if (result.success) {
        this.appliedOptimizations.set(strategy.id, result);
        this.optimizationHistory.push(result);
        
        logger.info(`✅ Strategy applied successfully: ${strategy.name}`, {
          expectedImpact: `${strategy.estimatedImpact}%`,
          actualImpact: `${actualImpact.toFixed(1)}%`,
        });
      } else {
        logger.warn(`⚠️ Strategy had negative impact: ${strategy.name}`, {
          impact: `${actualImpact.toFixed(1)}%`,
        });
        
        // Rollback if negative impact
        await this.rollbackStrategy(strategy);
        result.rollbackAt = new Date();
      }

      this.emit('strategy:applied', { strategy, result });
      return result;

    } catch (error) {
      logger.error(`❌ Failed to apply strategy: ${strategy.name}`, { error });
      
      // Attempt rollback
      try {
        await this.rollbackStrategy(strategy);
      } catch (rollbackError) {
        logger.error(`Failed to rollback strategy: ${strategy.name}`, { error: rollbackError });
      }

      const result: OptimizationResult = {
        strategy,
        beforeMetrics,
        afterMetrics: beforeMetrics, // Use baseline as fallback
        actualImpact: 0,
        success: false,
        appliedAt: new Date(),
        rollbackAt: new Date(),
      };

      return result;
    }
  }

  async rollbackStrategy(strategy: OptimizationStrategy): Promise<void> {
    logger.info(`↩️ Rolling back strategy: ${strategy.name}`);

    try {
      if (strategy.implementation.rollback) {
        await this.applyConfigurationChanges(
          strategy.implementation.service,
          strategy.implementation.rollback
        );
      } else {
        // Automatic rollback by reversing the changes
        const reverseChanges = this.createReverseChanges(strategy.implementation.changes);
        await this.applyConfigurationChanges(strategy.implementation.service, reverseChanges);
      }

      this.appliedOptimizations.delete(strategy.id);
      
      this.emit('strategy:rolled-back', { 
        strategy, 
        reason: 'Manual rollback or negative impact' 
      });

      logger.info(`✅ Strategy rolled back: ${strategy.name}`);

    } catch (error) {
      logger.error(`❌ Failed to rollback strategy: ${strategy.name}`, { error });
      throw error;
    }
  }

  getOptimizationHistory(): OptimizationResult[] {
    return [...this.optimizationHistory];
  }

  getAppliedOptimizations(): OptimizationResult[] {
    return Array.from(this.appliedOptimizations.values());
  }

  async analyzePerformanceBottlenecks(service: string): Promise<{
    bottlenecks: Array<{
      area: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      recommendedStrategies: string[];
    }>;
    opportunities: Array<{
      type: string;
      impact: number;
      effort: string;
      description: string;
    }>;
  }> {
    logger.info(`🔍 Analyzing performance bottlenecks for ${service}`);

    const metrics = await this.runPerformanceTest(service);
    const bottlenecks: any[] = [];
    const opportunities: any[] = [];

    // Analyze latency
    if (metrics.metrics.averageLatency > 1000) {
      bottlenecks.push({
        area: 'Latency',
        severity: metrics.metrics.averageLatency > 5000 ? 'critical' : 'high',
        description: `High average latency: ${metrics.metrics.averageLatency.toFixed(2)}ms`,
        recommendedStrategies: ['caching-optimization', 'database-optimization', 'connection-pooling'],
      });
    }

    // Analyze throughput
    if (metrics.metrics.throughput < 100) {
      bottlenecks.push({
        area: 'Throughput',
        severity: metrics.metrics.throughput < 10 ? 'critical' : 'medium',
        description: `Low throughput: ${metrics.metrics.throughput.toFixed(1)} ops/sec`,
        recommendedStrategies: ['concurrency-optimization', 'resource-scaling', 'algorithm-optimization'],
      });
    }

    // Analyze error rate
    if (metrics.metrics.errorRate > 1) {
      bottlenecks.push({
        area: 'Reliability',
        severity: metrics.metrics.errorRate > 5 ? 'critical' : 'high',
        description: `High error rate: ${metrics.metrics.errorRate.toFixed(2)}%`,
        recommendedStrategies: ['error-handling-optimization', 'retry-optimization', 'circuit-breaker-tuning'],
      });
    }

    // Analyze memory usage
    if (metrics.metrics.memoryUsage > 512) {
      bottlenecks.push({
        area: 'Memory',
        severity: metrics.metrics.memoryUsage > 1024 ? 'high' : 'medium',
        description: `High memory usage: ${metrics.metrics.memoryUsage.toFixed(1)}MB`,
        recommendedStrategies: ['memory-optimization', 'garbage-collection-tuning', 'object-pooling'],
      });
    }

    // Identify optimization opportunities
    const applicableStrategies = Array.from(this.strategies.values())
      .filter(s => s.implementation.service === service || s.implementation.service === '*');

    for (const strategy of applicableStrategies) {
      opportunities.push({
        type: strategy.type,
        impact: strategy.estimatedImpact,
        effort: strategy.effort,
        description: strategy.description,
      });
    }

    return { bottlenecks, opportunities };
  }

  private initializeBuiltInStrategies(): void {
    const strategies: OptimizationStrategy[] = [
      {
        id: 'caching-optimization',
        name: 'Enable Aggressive Caching',
        description: 'Increase cache TTL and enable more caching layers',
        type: 'configuration',
        priority: 'high',
        estimatedImpact: 25,
        effort: 'low',
        implementation: {
          service: '*',
          changes: { cacheTTL: 3600, enableL2Cache: true, cacheStrategy: 'aggressive' },
          rollback: { cacheTTL: 300, enableL2Cache: false, cacheStrategy: 'conservative' },
        },
        conditions: { maxLatency: 500 },
      },
      {
        id: 'connection-pooling',
        name: 'Optimize Connection Pooling',
        description: 'Increase connection pool size and optimize timeouts',
        type: 'configuration',
        priority: 'medium',
        estimatedImpact: 15,
        effort: 'low',
        implementation: {
          service: '*',
          changes: { maxConnections: 100, connectionTimeout: 30000, idleTimeout: 300000 },
          rollback: { maxConnections: 10, connectionTimeout: 5000, idleTimeout: 60000 },
        },
      },
      {
        id: 'concurrency-optimization',
        name: 'Increase Concurrency Limits',
        description: 'Allow more concurrent operations and requests',
        type: 'configuration',
        priority: 'medium',
        estimatedImpact: 20,
        effort: 'medium',
        implementation: {
          service: '*',
          changes: { maxConcurrency: 50, queueSize: 1000, workerThreads: 8 },
          rollback: { maxConcurrency: 10, queueSize: 100, workerThreads: 4 },
        },
      },
      {
        id: 'garbage-collection-tuning',
        name: 'Optimize Garbage Collection',
        description: 'Tune GC parameters for better performance',
        type: 'resource',
        priority: 'low',
        estimatedImpact: 10,
        effort: 'high',
        implementation: {
          service: '*',
          changes: { gcInterval: 60000, heapSize: '512m', gcAlgorithm: 'g1' },
          rollback: { gcInterval: 30000, heapSize: '256m', gcAlgorithm: 'default' },
        },
      },
      {
        id: 'algorithm-optimization',
        name: 'Algorithmic Improvements',
        description: 'Switch to more efficient algorithms and data structures',
        type: 'algorithm',
        priority: 'high',
        estimatedImpact: 35,
        effort: 'high',
        implementation: {
          service: '*',
          changes: { algorithm: 'optimized', dataStructure: 'efficient', indexing: 'advanced' },
          rollback: { algorithm: 'standard', dataStructure: 'standard', indexing: 'basic' },
        },
      },
    ];

    for (const strategy of strategies) {
      this.registerStrategy(strategy);
    }
  }

  private async getCurrentBaseline(service: string): Promise<BenchmarkResult> {
    const baseline = this.benchmark.getBaseline(`${service}-performance`);
    if (baseline) {
      return baseline;
    }

    // Create a quick baseline benchmark
    return await this.runPerformanceTest(service);
  }

  private findApplicableStrategies(config: {
    service: string;
    allowedTypes?: OptimizationStrategy['type'][];
    riskTolerance?: 'low' | 'medium' | 'high';
  }): OptimizationStrategy[] {
    const strategies = Array.from(this.strategies.values());
    
    return strategies.filter(strategy => {
      // Check service match
      if (strategy.implementation.service !== '*' && strategy.implementation.service !== config.service) {
        return false;
      }
      
      // Check allowed types
      if (config.allowedTypes && !config.allowedTypes.includes(strategy.type)) {
        return false;
      }
      
      // Check risk tolerance
      if (config.riskTolerance) {
        const riskLevels = { low: 1, medium: 2, high: 3 };
        const strategyRisk = strategy.effort === 'high' ? 3 : strategy.effort === 'medium' ? 2 : 1;
        if (strategyRisk > riskLevels[config.riskTolerance]) {
          return false;
        }
      }
      
      return true;
    });
  }

  private getExecutionConditions(strategy: OptimizationStrategy): string[] {
    const conditions: string[] = [];
    
    if (strategy.conditions?.minThroughput) {
      conditions.push(`throughput >= ${strategy.conditions.minThroughput}`);
    }
    
    if (strategy.conditions?.maxLatency) {
      conditions.push(`latency <= ${strategy.conditions.maxLatency}`);
    }
    
    if (strategy.conditions?.maxErrorRate) {
      conditions.push(`errorRate <= ${strategy.conditions.maxErrorRate}`);
    }
    
    return conditions;
  }

  private calculatePlanRisk(strategies: OptimizationStrategy[]): 'low' | 'medium' | 'high' {
    const riskScores = strategies.map(s => {
      return s.effort === 'high' ? 3 : s.effort === 'medium' ? 2 : 1;
    });
    
    const averageRisk = riskScores.reduce((sum, risk) => sum + risk, 0) / riskScores.length;
    
    if (averageRisk <= 1.5) return 'low';
    if (averageRisk <= 2.5) return 'medium';
    return 'high';
  }

  private async checkConditions(conditions: string[]): Promise<boolean> {
    // Simple condition checking - in a real implementation, this would
    // evaluate the conditions against current metrics
    return true;
  }

  private async runPerformanceTest(service: string): Promise<BenchmarkResult> {
    const config: BenchmarkConfig = {
      name: `${service}-optimization-test`,
      iterations: 100,
      warmupIterations: 10,
      target: {
        service,
        method: 'getHealth', // Use health check as a simple test method
      },
    };

    return await this.benchmark.runBenchmark(config);
  }

  private async applyStrategyChanges(strategy: OptimizationStrategy): Promise<void> {
    await this.applyConfigurationChanges(
      strategy.implementation.service,
      strategy.implementation.changes
    );
  }

  private async applyConfigurationChanges(service: string, changes: Record<string, any>): Promise<void> {
    logger.debug(`Applying configuration changes to ${service}`, changes);
    
    // In a real implementation, this would:
    // 1. Get the service instance
    // 2. Apply the configuration changes
    // 3. Restart or reconfigure the service as needed
    
    const serviceInstance = this.registry.get(service);
    if (serviceInstance && typeof serviceInstance.configure === 'function') {
      await serviceInstance.configure(changes);
    }
  }

  private calculateImpact(
    before: BenchmarkResult,
    after: BenchmarkResult,
    strategy: OptimizationStrategy
  ): number {
    // Calculate improvement based on the strategy type
    switch (strategy.type) {
      case 'configuration':
      case 'resource':
        // Focus on throughput improvement
        return ((after.metrics.throughput - before.metrics.throughput) / before.metrics.throughput) * 100;
      
      case 'algorithm':
        // Focus on latency improvement (lower is better)
        return ((before.metrics.averageLatency - after.metrics.averageLatency) / before.metrics.averageLatency) * 100;
      
      default:
        // General improvement score
        const throughputImprovement = ((after.metrics.throughput - before.metrics.throughput) / before.metrics.throughput) * 100;
        const latencyImprovement = ((before.metrics.averageLatency - after.metrics.averageLatency) / before.metrics.averageLatency) * 100;
        return (throughputImprovement + latencyImprovement) / 2;
    }
  }

  private createReverseChanges(changes: Record<string, any>): Record<string, any> {
    // Create reverse changes by assuming default values
    const reverse: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(changes)) {
      if (typeof value === 'boolean') {
        reverse[key] = !value;
      } else if (typeof value === 'number') {
        reverse[key] = Math.max(1, Math.floor(value / 2)); // Halve numeric values
      } else if (typeof value === 'string') {
        reverse[key] = 'default';
      }
    }
    
    return reverse;
  }

  private async rollbackStrategies(results: OptimizationResult[]): Promise<void> {
    logger.info(`↩️ Rolling back ${results.length} applied strategies`);
    
    for (const result of results.reverse()) { // Rollback in reverse order
      try {
        await this.rollbackStrategy(result.strategy);
      } catch (error) {
        logger.error(`Failed to rollback strategy: ${result.strategy.name}`, { error });
      }
    }
  }
}