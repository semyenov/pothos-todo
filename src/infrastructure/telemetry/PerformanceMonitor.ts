import { metrics } from '@opentelemetry/api';
import { logger } from '@/logger';
import { CacheManager } from '../cache/CacheManager.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

interface PerformanceMetrics {
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  slowQueries: Array<{
    query: string;
    duration: number;
    timestamp: Date;
  }>;
  cacheHitRate: number;
  activeConnections: number;
}

interface QueryPerformance {
  query: string;
  operationName?: string;
  duration: number;
  complexity?: number;
  errors?: string[];
}

export class PerformanceMonitor extends EventEmitterSingletonService<PerformanceMonitor> {
  private meter = metrics.getMeter('pothos-todo-performance', '1.0.0');
  private cacheManager?: CacheManager;

  private getCacheManager() {
    if (!this.cacheManager) {
      this.cacheManager = CacheManager.getInstance();
    }
    return this.cacheManager;
  }

  // Metrics instruments
  private requestCounter: any;
  private errorCounter: any;
  private responseTimeHistogram: any;
  private cacheHitCounter: any;
  private cacheMissCounter: any;
  private activeConnectionsGauge: any;
  private queryComplexityHistogram: any;

  // In-memory storage for analysis
  private responseTimes: number[] = [];
  private slowQueryThreshold = 1000; // 1 second
  private metricsWindow = 300000; // 5 minutes

  protected constructor() {
    super();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Initialize metrics
    this.requestCounter = this.meter.createCounter('graphql_requests_total', {
      description: 'Total number of GraphQL requests',
    });

    this.errorCounter = this.meter.createCounter('graphql_errors_total', {
      description: 'Total number of GraphQL errors',
    });

    this.responseTimeHistogram = this.meter.createHistogram('graphql_request_duration_ms', {
      description: 'GraphQL request duration in milliseconds',
    });

    this.cacheHitCounter = this.meter.createCounter('cache_hits_total', {
      description: 'Total number of cache hits',
    });

    this.cacheMissCounter = this.meter.createCounter('cache_misses_total', {
      description: 'Total number of cache misses',
    });

    this.activeConnectionsGauge = this.meter.createUpDownCounter('websocket_active_connections', {
      description: 'Number of active WebSocket connections',
    });

    this.queryComplexityHistogram = this.meter.createHistogram('graphql_query_complexity', {
      description: 'GraphQL query complexity score',
    });

    // Start periodic metrics aggregation
    this.startMetricsAggregation();
  }

  static getInstance(): PerformanceMonitor {
    return super.getInstance();
  }

  /**
   * Record a GraphQL request
   */
  recordRequest(performance: QueryPerformance) {
    const labels = {
      operation_type: this.getOperationType(performance.query),
      operation_name: performance.operationName || 'anonymous',
      has_errors: performance.errors ? 'true' : 'false',
    };

    // Update counters
    this.requestCounter.add(1, labels);
    if (performance.errors) {
      this.errorCounter.add(1, labels);
    }

    // Record response time
    this.responseTimeHistogram.record(performance.duration, labels);
    this.responseTimes.push(performance.duration);

    // Record complexity if available
    if (performance.complexity) {
      this.queryComplexityHistogram.record(performance.complexity, labels);
    }

    // Check for slow queries
    if (performance.duration > this.slowQueryThreshold) {
      this.handleSlowQuery(performance);
    }

    // Emit event for real-time monitoring
    this.emit('request', performance);
  }

  /**
   * Record cache hit/miss
   */
  recordCacheHit(hit: boolean, key: string) {
    const labels = { cache_key_prefix: key.split(':')[0] };

    if (hit) {
      this.cacheHitCounter.add(1, labels);
    } else {
      this.cacheMissCounter.add(1, labels);
    }
  }

  /**
   * Update active connections count
   */
  updateActiveConnections(delta: number) {
    this.activeConnectionsGauge.add(delta);
  }

  /**
   * Get current performance metrics
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    const cacheStats = await this.getCacheStats();
    const responseTimes = this.getRecentResponseTimes();

    return {
      requestCount: await this.getMetricValue('graphql_requests_total'),
      errorCount: await this.getMetricValue('graphql_errors_total'),
      averageResponseTime: this.calculateAverage(responseTimes),
      p95ResponseTime: this.calculatePercentile(responseTimes, 95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 99),
      slowQueries: await this.getSlowQueries(),
      cacheHitRate: cacheStats.hitRate,
      activeConnections: await this.getMetricValue('websocket_active_connections'),
    };
  }

  /**
   * Detect performance anomalies
   */
  async detectAnomalies(): Promise<Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
    value: number;
    threshold: number;
  }>> {
    const anomalies = [];
    const metrics = await this.getMetrics();

    // High error rate
    const errorRate = metrics.errorCount / metrics.requestCount;
    if (errorRate > 0.05) { // 5% error rate
      anomalies.push({
        type: 'high_error_rate',
        severity: (errorRate > 0.1 ? 'high' : 'medium') as 'low' | 'medium' | 'high',
        message: `Error rate is ${(errorRate * 100).toFixed(2)}%`,
        value: errorRate,
        threshold: 0.05,
      });
    }

    // Slow response times
    if (metrics.p95ResponseTime > 2000) { // 2 seconds
      anomalies.push({
        type: 'slow_response_time',
        severity: (metrics.p95ResponseTime > 5000 ? 'high' : 'medium') as 'low' | 'medium' | 'high',
        message: `95th percentile response time is ${metrics.p95ResponseTime}ms`,
        value: metrics.p95ResponseTime,
        threshold: 2000,
      });
    }

    // Low cache hit rate
    if (metrics.cacheHitRate < 0.7) { // 70% hit rate
      anomalies.push({
        type: 'low_cache_hit_rate',
        severity: (metrics.cacheHitRate < 0.5 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
        message: `Cache hit rate is ${(metrics.cacheHitRate * 100).toFixed(2)}%`,
        value: metrics.cacheHitRate,
        threshold: 0.7,
      });
    }

    // Too many slow queries
    if (metrics.slowQueries.length > 10) {
      anomalies.push({
        type: 'many_slow_queries',
        severity: (metrics.slowQueries.length > 20 ? 'high' : 'medium') as 'low' | 'medium' | 'high',
        message: `${metrics.slowQueries.length} slow queries detected`,
        value: metrics.slowQueries.length,
        threshold: 10,
      });
    }

    return anomalies;
  }

  /**
   * Get query complexity analysis
   */
  async getComplexityAnalysis(): Promise<{
    averageComplexity: number;
    maxComplexity: number;
    complexQueries: Array<{
      query: string;
      complexity: number;
      timestamp: Date;
    }>;
  }> {
    const complexities = await this.getRecentComplexities();

    return {
      averageComplexity: this.calculateAverage(complexities),
      maxComplexity: Math.max(...complexities, 0),
      complexQueries: await this.getComplexQueries(),
    };
  }

  private startMetricsAggregation() {
    // Clean up old metrics every minute
    setInterval(() => {
      const cutoff = Date.now() - this.metricsWindow;
      this.responseTimes = this.responseTimes.filter((_, index) => {
        return Date.now() - (index * 1000) < this.metricsWindow;
      });
    }, 60000);
  }

  private async handleSlowQuery(performance: QueryPerformance) {
    const key = `slow_queries:${Date.now()}`;
    await this.getCacheManager().set(key, {
      query: performance.query,
      duration: performance.duration,
      timestamp: new Date(),
      operationName: performance.operationName,
    }, { ttl: 3600 }); // Keep for 1 hour

    logger.warn('Slow query detected', {
      duration: performance.duration,
      operationName: performance.operationName,
    });

    this.emit('slowQuery', performance);
  }

  private getOperationType(query: string): string {
    if (query.trim().startsWith('query')) return 'query';
    if (query.trim().startsWith('mutation')) return 'mutation';
    if (query.trim().startsWith('subscription')) return 'subscription';
    return 'unknown';
  }

  private getRecentResponseTimes(): number[] {
    return this.responseTimes.slice(-1000); // Last 1000 requests
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  private async getMetricValue(name: string): Promise<number> {
    // In a real implementation, this would query the metrics backend
    // For now, return a placeholder
    return 0;
  }

  private async getCacheStats(): Promise<{ hitRate: number }> {
    // Calculate hit rate from counters
    // In a real implementation, this would use the actual counter values
    return { hitRate: 0.85 }; // Placeholder
  }

  private async getSlowQueries(): Promise<Array<{
    query: string;
    duration: number;
    timestamp: Date;
  }>> {
    // In a real implementation, this would query stored slow queries
    // For now, return placeholder data
    return [];
  }

  private async getRecentComplexities(): Promise<number[]> {
    // In a real implementation, this would query stored complexity values
    return [10, 15, 20, 25, 30, 35, 40]; // Placeholder
  }

  private async getComplexQueries(): Promise<Array<{
    query: string;
    complexity: number;
    timestamp: Date;
  }>> {
    // In a real implementation, this would query stored complex queries
    return []; // Placeholder
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();