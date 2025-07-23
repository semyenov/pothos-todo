import { EventEmitter } from 'events';
import { logger } from '@/logger.js';
import { MetricsSystem } from '../observability/Metrics.js';
import { TelemetrySystem } from '../observability/Telemetry.js';
import { EdgeComputingSystem, type EdgeLocation } from '../edge/EdgeComputing.js';
import { IntelligentCDN } from '../edge/IntelligentCDN.js';
import { DataReplicationSystem } from '../edge/DataReplication.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface PerformanceConfig {
  optimizationLevel: 'aggressive' | 'balanced' | 'conservative';
  enableAutoScaling: boolean;
  enableQueryOptimization: boolean;
  enableResourcePooling: boolean;
  enablePredictiveScaling: boolean;
  targetResponseTime: number; // milliseconds
  targetAvailability: number; // percentage
}

export interface PerformanceMetrics {
  responseTime: { p50: number; p95: number; p99: number };
  throughput: number; // requests per second
  errorRate: number;
  availability: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    network: number;
    storage: number;
  };
  optimizationScore: number;
}

export interface OptimizationRecommendation {
  id: string;
  type: OptimizationType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  impact: {
    performance: number; // percentage improvement
    cost: number; // percentage change
    complexity: 'low' | 'medium' | 'high';
  };
  actions: OptimizationAction[];
}

export type OptimizationType = 
  | 'query_optimization'
  | 'caching_improvement'
  | 'resource_scaling'
  | 'data_distribution'
  | 'connection_pooling'
  | 'index_optimization'
  | 'compression'
  | 'code_optimization';

export interface OptimizationAction {
  type: string;
  target: string;
  parameters: Record<string, any>;
  estimatedDuration: number; // milliseconds
}

export interface QueryProfile {
  query: string;
  executionTime: number;
  rowsExamined: number;
  rowsReturned: number;
  indexesUsed: string[];
  optimizationHints: string[];
}

export interface ResourcePool {
  id: string;
  type: 'connection' | 'thread' | 'memory';
  capacity: number;
  inUse: number;
  available: number;
  waitQueue: number;
  metrics: {
    utilizationRate: number;
    avgWaitTime: number;
    throughput: number;
  };
}

/**
 * Performance Optimization System
 * Provides intelligent performance optimization across the infrastructure
 */
export class PerformanceOptimizer extends EventEmitterSingletonService<PerformanceOptimizer> {
  private config: PerformanceConfig | null = null;
  private metrics: MetricsSystem;
  private telemetry: TelemetrySystem;
  private edgeSystem: EdgeComputingSystem;
  private cdn: IntelligentCDN;
  private replication: DataReplicationSystem;
  
  private resourcePools: Map<string, ResourcePool> = new Map();
  private queryProfiles: Map<string, QueryProfile> = new Map();
  private performanceHistory: PerformanceMetrics[] = [];
  private mlOptimizer?: PerformanceMLModel;

  protected constructor() {
    super();
    this.metrics = MetricsSystem.getInstance();
    this.telemetry = TelemetrySystem.getInstance();
    this.edgeSystem = EdgeComputingSystem.getInstance();
    this.cdn = IntelligentCDN.getInstance();
    this.replication = DataReplicationSystem.getInstance();
  }

  static initialize(config: PerformanceConfig): PerformanceOptimizer {
    const instance = super.getInstance();
    instance.configure(config);
    return instance;
  }

  static getInstance(): PerformanceOptimizer {
    const instance = super.getInstance();
    if (!instance.config) {
      throw new Error('PerformanceOptimizer not initialized - call initialize() first');
    }
    return instance;
  }

  /**
   * Configure the PerformanceOptimizer with settings
   */
  public configure(config: PerformanceConfig): void {
    this.config = config;
    
    if (config.enablePredictiveScaling) {
      this.mlOptimizer = new PerformanceMLModel();
    }
    
    this.initializeOptimization();
  }

  /**
   * Analyze system performance and generate recommendations
   */
  async analyzePerformance(): Promise<{
    currentMetrics: PerformanceMetrics;
    recommendations: OptimizationRecommendation[];
    projectedImprovement: number;
  }> {
    const currentMetrics = await this.collectPerformanceMetrics();
    this.performanceHistory.push(currentMetrics);

    const recommendations = await this.generateRecommendations(currentMetrics);
    const projectedImprovement = this.calculateProjectedImprovement(recommendations);

    logger.info('Performance analysis completed', {
      optimizationScore: currentMetrics.optimizationScore,
      recommendationCount: recommendations.length,
      projectedImprovement,
    });

    return { currentMetrics, recommendations, projectedImprovement };
  }

  /**
   * Apply optimization recommendations
   */
  async applyOptimizations(
    recommendations: OptimizationRecommendation[],
    options: {
      autoApply?: boolean;
      maxRisk?: 'low' | 'medium' | 'high';
      dryRun?: boolean;
    } = {}
  ): Promise<{
    applied: string[];
    skipped: string[];
    results: Map<string, { success: boolean; improvement?: number; error?: string }>;
  }> {
    const applied: string[] = [];
    const skipped: string[] = [];
    const results = new Map<string, { success: boolean; improvement?: number; error?: string }>();

    for (const recommendation of recommendations) {
      // Check risk level
      if (options.maxRisk && this.getRiskLevel(recommendation) > this.parseRiskLevel(options.maxRisk)) {
        skipped.push(recommendation.id);
        continue;
      }

      // Check if auto-apply is enabled for this type
      if (!options.autoApply && recommendation.priority !== 'critical') {
        skipped.push(recommendation.id);
        continue;
      }

      try {
        if (!options.dryRun) {
          const result = await this.applyRecommendation(recommendation);
          results.set(recommendation.id, result);
          applied.push(recommendation.id);
          
          this.emit('optimization:applied', {
            recommendation,
            result,
          });
        } else {
          // Simulate application
          results.set(recommendation.id, {
            success: true,
            improvement: recommendation.impact.performance,
          });
          applied.push(recommendation.id);
        }
      } catch (error) {
        logger.error(`Failed to apply optimization ${recommendation.id}`, error);
        results.set(recommendation.id, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        skipped.push(recommendation.id);
      }
    }

    return { applied, skipped, results };
  }

  /**
   * Optimize GraphQL query
   */
  async optimizeQuery(
    query: string,
    variables?: Record<string, any>
  ): Promise<{
    optimizedQuery: string;
    executionPlan: string;
    estimatedImprovement: number;
    suggestions: string[];
  }> {
    return this.telemetry.traceAsync('performance.optimize_query', async () => {
      // Parse and analyze query
      const analysis = this.analyzeGraphQLQuery(query);
      
      // Generate optimized version
      const optimizedQuery = this.generateOptimizedQuery(analysis);
      
      // Create execution plan
      const executionPlan = this.createExecutionPlan(optimizedQuery, variables);
      
      // Estimate improvement
      const estimatedImprovement = this.estimateQueryImprovement(
        analysis,
        optimizedQuery
      );

      // Generate suggestions
      const suggestions = this.generateQuerySuggestions(analysis);

      return {
        optimizedQuery,
        executionPlan,
        estimatedImprovement,
        suggestions,
      };
    });
  }

  /**
   * Auto-scale resources based on demand
   */
  async autoScale(): Promise<{
    scaled: Array<{ resource: string; from: number; to: number }>;
    predictions: Array<{ time: Date; expectedLoad: number }>;
  }> {
    if (!this.config.enableAutoScaling) {
      return { scaled: [], predictions: [] };
    }

    const currentMetrics = await this.collectPerformanceMetrics();
    const predictions = this.mlOptimizer ? 
      await this.mlOptimizer.predictLoad() : [];

    const scaled: Array<{ resource: string; from: number; to: number }> = [];

    // Scale edge locations
    if (currentMetrics.responseTime.p95 > this.config.targetResponseTime) {
      const scaleResult = await this.scaleEdgeCapacity(1.2); // 20% increase
      scaled.push(...scaleResult);
    }

    // Scale resource pools
    for (const [poolId, pool] of this.resourcePools) {
      if (pool.metrics.utilizationRate > 0.8) {
        const newCapacity = Math.ceil(pool.capacity * 1.5);
        await this.scaleResourcePool(poolId, newCapacity);
        scaled.push({
          resource: `pool:${poolId}`,
          from: pool.capacity,
          to: newCapacity,
        });
      }
    }

    // Predictive scaling
    if (predictions.length > 0) {
      const maxPredictedLoad = Math.max(...predictions.map(p => p.expectedLoad));
      if (maxPredictedLoad > currentMetrics.throughput * 1.5) {
        // Pre-scale for predicted load
        const preScaleResult = await this.preScaleForLoad(maxPredictedLoad);
        scaled.push(...preScaleResult);
      }
    }

    this.emit('autoscale:completed', { scaled, predictions });
    return { scaled, predictions };
  }

  /**
   * Get performance dashboard data
   */
  async getDashboardData(): Promise<{
    current: PerformanceMetrics;
    history: Array<{ timestamp: Date; metrics: PerformanceMetrics }>;
    resourcePools: Array<{ id: string; utilization: number; health: string }>;
    topSlowQueries: QueryProfile[];
    optimizationOpportunities: number;
  }> {
    const current = await this.collectPerformanceMetrics();
    
    const history = this.performanceHistory.slice(-100).map((metrics, index) => ({
      timestamp: new Date(Date.now() - (100 - index) * 60000), // 1-minute intervals
      metrics,
    }));

    const resourcePools = Array.from(this.resourcePools.values()).map(pool => ({
      id: pool.id,
      utilization: pool.metrics.utilizationRate,
      health: pool.metrics.utilizationRate > 0.9 ? 'critical' : 
              pool.metrics.utilizationRate > 0.7 ? 'warning' : 'healthy',
    }));

    const topSlowQueries = Array.from(this.queryProfiles.values())
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    const recommendations = await this.generateRecommendations(current);
    const optimizationOpportunities = recommendations.length;

    return {
      current,
      history,
      resourcePools,
      topSlowQueries,
      optimizationOpportunities,
    };
  }

  /**
   * Initialize optimization systems
   */
  private initializeOptimization(): void {
    // Initialize resource pools
    if (this.config.enableResourcePooling) {
      this.initializeResourcePools();
    }

    // Start performance monitoring
    this.startPerformanceMonitoring();

    // Setup optimization triggers
    this.setupOptimizationTriggers();
  }

  /**
   * Initialize resource pools
   */
  private initializeResourcePools(): void {
    // Connection pool
    this.resourcePools.set('db-connections', {
      id: 'db-connections',
      type: 'connection',
      capacity: 100,
      inUse: 0,
      available: 100,
      waitQueue: 0,
      metrics: {
        utilizationRate: 0,
        avgWaitTime: 0,
        throughput: 0,
      },
    });

    // Thread pool
    this.resourcePools.set('worker-threads', {
      id: 'worker-threads',
      type: 'thread',
      capacity: 50,
      inUse: 0,
      available: 50,
      waitQueue: 0,
      metrics: {
        utilizationRate: 0,
        avgWaitTime: 0,
        throughput: 0,
      },
    });

    // Memory pool
    this.resourcePools.set('memory-cache', {
      id: 'memory-cache',
      type: 'memory',
      capacity: 1024, // MB
      inUse: 0,
      available: 1024,
      waitQueue: 0,
      metrics: {
        utilizationRate: 0,
        avgWaitTime: 0,
        throughput: 0,
      },
    });
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    setInterval(async () => {
      try {
        const metrics = await this.collectPerformanceMetrics();
        
        // Check against targets
        if (metrics.responseTime.p95 > this.config.targetResponseTime) {
          this.emit('performance:degraded', {
            metric: 'responseTime',
            current: metrics.responseTime.p95,
            target: this.config.targetResponseTime,
          });
        }

        if (metrics.availability < this.config.targetAvailability) {
          this.emit('performance:degraded', {
            metric: 'availability',
            current: metrics.availability,
            target: this.config.targetAvailability,
          });
        }

        // Auto-optimize if needed
        if (this.config.optimizationLevel === 'aggressive') {
          const recommendations = await this.generateRecommendations(metrics);
          const critical = recommendations.filter(r => r.priority === 'critical');
          
          if (critical.length > 0) {
            await this.applyOptimizations(critical, { autoApply: true });
          }
        }
      } catch (error) {
        logger.error('Performance monitoring error', error);
      }
    }, 60000); // Every minute
  }

  /**
   * Setup optimization triggers
   */
  private setupOptimizationTriggers(): void {
    // Query optimization trigger
    this.metrics.on('slowQuery', async ({ query, duration }: any) => {
      if (this.config.enableQueryOptimization) {
        const optimized = await this.optimizeQuery(query);
        if (optimized.estimatedImprovement > 20) {
          this.emit('optimization:suggested', {
            type: 'query',
            original: query,
            optimized: optimized.optimizedQuery,
            improvement: optimized.estimatedImprovement,
          });
        }
      }
    });

    // Auto-scaling trigger
    this.metrics.on('highLoad', async () => {
      if (this.config.enableAutoScaling) {
        await this.autoScale();
      }
    });
  }

  /**
   * Collect performance metrics
   */
  private async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    // Get response times from edge analytics
    const edgeAnalytics = await this.edgeSystem.getPerformanceAnalytics();
    
    // Calculate percentiles
    const responseTimes = Array.from(edgeAnalytics.byLocation.values())
      .map(m => m.latency.p50);
    
    const p50 = this.percentile(responseTimes, 0.5);
    const p95 = this.percentile(responseTimes, 0.95);
    const p99 = this.percentile(responseTimes, 0.99);

    // Calculate throughput
    const throughput = edgeAnalytics.global.totalRequests / 60; // per second

    // Calculate error rate
    const errorRate = edgeAnalytics.global.errorRate;

    // Calculate availability
    const activeLocations = Array.from(edgeAnalytics.byLocation.values())
      .filter(m => m.errorRate < 0.1).length;
    const totalLocations = edgeAnalytics.byLocation.size;
    const availability = (activeLocations / totalLocations) * 100;

    // Get resource utilization
    const resourceUtilization = await this.getResourceUtilization();

    // Calculate optimization score
    const optimizationScore = this.calculateOptimizationScore({
      responseTime: { p50, p95, p99 },
      throughput,
      errorRate,
      availability,
      resourceUtilization,
    });

    return {
      responseTime: { p50, p95, p99 },
      throughput,
      errorRate,
      availability,
      resourceUtilization,
      optimizationScore,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private async generateRecommendations(
    metrics: PerformanceMetrics
  ): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];

    // Check response time
    if (metrics.responseTime.p95 > this.config.targetResponseTime) {
      recommendations.push({
        id: 'opt_response_time',
        type: 'caching_improvement',
        priority: 'high',
        description: 'Enable aggressive caching to reduce response times',
        impact: {
          performance: 30,
          cost: -10,
          complexity: 'low',
        },
        actions: [{
          type: 'configure_cache',
          target: 'cdn',
          parameters: { ttl: 3600, staleWhileRevalidate: 86400 },
          estimatedDuration: 1000,
        }],
      });
    }

    // Check resource utilization
    if (metrics.resourceUtilization.cpu > 80) {
      recommendations.push({
        id: 'opt_cpu_usage',
        type: 'resource_scaling',
        priority: 'critical',
        description: 'Scale compute resources to handle CPU load',
        impact: {
          performance: 40,
          cost: 20,
          complexity: 'medium',
        },
        actions: [{
          type: 'scale_compute',
          target: 'edge_locations',
          parameters: { scaleFactor: 1.5 },
          estimatedDuration: 5000,
        }],
      });
    }

    // Check slow queries
    const slowQueries = Array.from(this.queryProfiles.values())
      .filter(q => q.executionTime > 1000);
    
    if (slowQueries.length > 0) {
      recommendations.push({
        id: 'opt_slow_queries',
        type: 'query_optimization',
        priority: 'high',
        description: 'Optimize slow GraphQL queries',
        impact: {
          performance: 50,
          cost: 0,
          complexity: 'high',
        },
        actions: slowQueries.map(q => ({
          type: 'optimize_query',
          target: q.query,
          parameters: { hints: q.optimizationHints },
          estimatedDuration: 2000,
        })),
      });
    }

    // Check connection pool utilization
    const dbPool = this.resourcePools.get('db-connections');
    if (dbPool && dbPool.metrics.utilizationRate > 0.8) {
      recommendations.push({
        id: 'opt_connection_pool',
        type: 'connection_pooling',
        priority: 'medium',
        description: 'Increase database connection pool size',
        impact: {
          performance: 20,
          cost: 5,
          complexity: 'low',
        },
        actions: [{
          type: 'resize_pool',
          target: 'db-connections',
          parameters: { newSize: dbPool.capacity * 1.5 },
          estimatedDuration: 500,
        }],
      });
    }

    return recommendations;
  }

  /**
   * Apply optimization recommendation
   */
  private async applyRecommendation(
    recommendation: OptimizationRecommendation
  ): Promise<{ success: boolean; improvement?: number; error?: string }> {
    logger.info(`Applying optimization: ${recommendation.id}`);

    try {
      for (const action of recommendation.actions) {
        await this.executeOptimizationAction(action);
      }

      // Measure improvement
      const beforeMetrics = this.performanceHistory[this.performanceHistory.length - 1];
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for changes to take effect
      const afterMetrics = await this.collectPerformanceMetrics();

      const improvement = this.measureImprovement(beforeMetrics, afterMetrics);

      return { success: true, improvement };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute optimization action
   */
  private async executeOptimizationAction(action: OptimizationAction): Promise<void> {
    switch (action.type) {
      case 'configure_cache':
        // Update CDN cache configuration
        await this.cdn.updateCacheStrategy({
          pattern: '*',
          ttl: action.parameters.ttl,
          staleWhileRevalidate: action.parameters.staleWhileRevalidate,
        });
        break;

      case 'scale_compute':
        // Scale edge compute resources
        await this.scaleEdgeCapacity(action.parameters.scaleFactor);
        break;

      case 'optimize_query':
        // Store optimized query for future use
        // In real implementation, would update query execution plan
        break;

      case 'resize_pool':
        // Resize resource pool
        await this.scaleResourcePool(action.target, action.parameters.newSize);
        break;

      default:
        logger.warn(`Unknown optimization action: ${action.type}`);
    }
  }

  /**
   * Analyze GraphQL query
   */
  private analyzeGraphQLQuery(query: string): any {
    // Simplified analysis
    return {
      query,
      complexity: query.length,
      depth: (query.match(/{/g) || []).length,
      fields: (query.match(/\w+\s*{/g) || []).length,
    };
  }

  /**
   * Generate optimized query
   */
  private generateOptimizedQuery(analysis: any): string {
    // In real implementation, would use query AST transformation
    return analysis.query;
  }

  /**
   * Create execution plan
   */
  private createExecutionPlan(query: string, variables?: Record<string, any>): string {
    return `
EXECUTION PLAN:
1. Parse GraphQL query
2. Validate against schema
3. Check edge cache (key: ${this.generateQueryKey(query, variables)})
4. If cache miss:
   a. Route to nearest edge location
   b. Execute resolver functions
   c. Apply field-level permissions
   d. Cache results with TTL
5. Return response
    `.trim();
  }

  /**
   * Generate query key
   */
  private generateQueryKey(query: string, variables?: Record<string, any>): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(query);
    if (variables) {
      hash.update(JSON.stringify(variables));
    }
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Estimate query improvement
   */
  private estimateQueryImprovement(original: any, optimized: string): number {
    // Simplified estimation based on complexity reduction
    const originalComplexity = original.complexity;
    const optimizedComplexity = optimized.length;
    
    return Math.max(0, ((originalComplexity - optimizedComplexity) / originalComplexity) * 100);
  }

  /**
   * Generate query suggestions
   */
  private generateQuerySuggestions(analysis: any): string[] {
    const suggestions: string[] = [];

    if (analysis.depth > 5) {
      suggestions.push('Consider reducing query depth to improve performance');
    }

    if (analysis.fields > 20) {
      suggestions.push('Query requests many fields - consider pagination');
    }

    suggestions.push('Enable @defer directive for non-critical fields');
    suggestions.push('Use field aliases to batch similar queries');

    return suggestions;
  }

  /**
   * Get resource utilization
   */
  private async getResourceUtilization(): Promise<PerformanceMetrics['resourceUtilization']> {
    const edgeAnalytics = await this.edgeSystem.getPerformanceAnalytics();
    
    let totalCpu = 0;
    let totalMemory = 0;
    let count = 0;

    for (const metrics of edgeAnalytics.byLocation.values()) {
      totalCpu += metrics.cpuUsage || 0;
      totalMemory += metrics.memoryUsage || 0;
      count++;
    }

    return {
      cpu: count > 0 ? totalCpu / count : 0,
      memory: count > 0 ? totalMemory / count : 0,
      network: 50, // Placeholder
      storage: 30, // Placeholder
    };
  }

  /**
   * Calculate optimization score
   */
  private calculateOptimizationScore(metrics: Omit<PerformanceMetrics, 'optimizationScore'>): number {
    let score = 100;

    // Response time impact
    if (metrics.responseTime.p95 > this.config.targetResponseTime) {
      score -= 20;
    }
    if (metrics.responseTime.p99 > this.config.targetResponseTime * 2) {
      score -= 10;
    }

    // Availability impact
    if (metrics.availability < this.config.targetAvailability) {
      score -= 30;
    }

    // Error rate impact
    if (metrics.errorRate > 0.01) score -= 10;
    if (metrics.errorRate > 0.05) score -= 20;

    // Resource utilization impact
    if (metrics.resourceUtilization.cpu > 80) score -= 10;
    if (metrics.resourceUtilization.memory > 80) score -= 10;

    return Math.max(0, score);
  }

  /**
   * Calculate projected improvement
   */
  private calculateProjectedImprovement(
    recommendations: OptimizationRecommendation[]
  ): number {
    if (recommendations.length === 0) return 0;

    const totalImpact = recommendations.reduce((sum, rec) => 
      sum + rec.impact.performance, 0
    );

    return Math.min(totalImpact, 100); // Cap at 100%
  }

  /**
   * Get risk level
   */
  private getRiskLevel(recommendation: OptimizationRecommendation): number {
    const complexity = recommendation.impact.complexity;
    const priority = recommendation.priority;

    if (complexity === 'high' && priority !== 'critical') return 3;
    if (complexity === 'medium') return 2;
    return 1;
  }

  /**
   * Parse risk level
   */
  private parseRiskLevel(level: 'low' | 'medium' | 'high'): number {
    switch (level) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 1;
    }
  }

  /**
   * Scale edge capacity
   */
  private async scaleEdgeCapacity(factor: number): Promise<Array<{ resource: string; from: number; to: number }>> {
    const scaled: Array<{ resource: string; from: number; to: number }> = [];
    
    // In real implementation, would scale actual edge resources
    logger.info(`Scaling edge capacity by factor ${factor}`);
    
    return scaled;
  }

  /**
   * Scale resource pool
   */
  private async scaleResourcePool(poolId: string, newCapacity: number): Promise<void> {
    const pool = this.resourcePools.get(poolId);
    if (!pool) return;

    const oldCapacity = pool.capacity;
    pool.capacity = newCapacity;
    pool.available = newCapacity - pool.inUse;

    logger.info(`Scaled resource pool ${poolId} from ${oldCapacity} to ${newCapacity}`);
  }

  /**
   * Pre-scale for predicted load
   */
  private async preScaleForLoad(
    predictedLoad: number
  ): Promise<Array<{ resource: string; from: number; to: number }>> {
    const currentMetrics = await this.collectPerformanceMetrics();
    const scaleFactor = predictedLoad / currentMetrics.throughput;
    
    if (scaleFactor > 1.2) {
      return this.scaleEdgeCapacity(scaleFactor);
    }

    return [];
  }

  /**
   * Measure improvement
   */
  private measureImprovement(
    before: PerformanceMetrics,
    after: PerformanceMetrics
  ): number {
    const responseTimeImprovement = 
      (before.responseTime.p95 - after.responseTime.p95) / before.responseTime.p95;
    
    const throughputImprovement = 
      (after.throughput - before.throughput) / before.throughput;
    
    const errorRateImprovement = 
      (before.errorRate - after.errorRate) / (before.errorRate || 0.01);

    const avgImprovement = 
      (responseTimeImprovement + throughputImprovement + errorRateImprovement) / 3;

    return Math.max(0, avgImprovement * 100);
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    
    return sorted[index] || 0;
  }
}

/**
 * ML model for performance prediction
 */
class PerformanceMLModel {
  async predictLoad(): Promise<Array<{ time: Date; expectedLoad: number }>> {
    // Simplified prediction
    const predictions: Array<{ time: Date; expectedLoad: number }> = [];
    
    for (let i = 1; i <= 6; i++) {
      predictions.push({
        time: new Date(Date.now() + i * 3600000), // Next 6 hours
        expectedLoad: 1000 + Math.random() * 500,
      });
    }

    return predictions;
  }

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('PerformanceOptimizer not configured - call initialize() first');
    }
  }
}