import { logger } from '@/logger.js';
import { CacheManager } from '../cache/CacheManager.js';
import { prismaService } from '@/lib/prisma.js';
import { SingletonService } from '../core/SingletonService.js';

export interface MetricPoint {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
    heap: {
      used: number;
      total: number;
    };
  };
  database: {
    connectionCount: number;
    queryCount: number;
    errorCount: number;
    avgQueryTime: number;
    poolUtilization: number;
  };
  cache?: {
    hitRate: number;
    missRate: number;
    size: number;
    connections: number;
  };
  graphql: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    complexityAvg: number;
  };
  http: {
    requestCount: number;
    responseTime: {
      p50: number;
      p95: number;
      p99: number;
    };
    statusCodes: Record<string, number>;
  };
}

export class MetricsCollector extends SingletonService {
  private metrics: MetricPoint[] = [];
  private httpMetrics = new Map<string, number[]>();
  private graphqlMetrics = {
    requestCount: 0,
    errorCount: 0,
    responseTimes: [] as number[],
    complexityScores: [] as number[],
  };
  private requestCounts = new Map<string, number>();
  private collectionInterval?: NodeJS.Timeout;
  
  protected constructor() {
    super();
  }
  
  public static getInstance(): MetricsCollector {
    return super.getInstance() as MetricsCollector;
  }
  
  /**
   * Start metrics collection with specified interval
   */
  public start(intervalMs: number = 60000): void {
    if (this.collectionInterval) {
      this.stop();
    }
    
    this.collectionInterval = setInterval(async () => {
      try {
        await this.collectSystemMetrics();
        await this.exportMetrics();
      } catch (error) {
        logger.error('Metrics collection failed', { error });
      }
    }, intervalMs);
    
    logger.info('Metrics collection started', { intervalMs });
  }
  
  /**
   * Stop metrics collection
   */
  public stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
      logger.info('Metrics collection stopped');
    }
  }
  
  /**
   * Record a custom metric
   */
  public recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      tags,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Record HTTP request metrics
   */
  public recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    responseTime: number
  ): void {
    const key = `${method}:${path}:${statusCode}`;
    
    if (!this.httpMetrics.has(key)) {
      this.httpMetrics.set(key, []);
    }
    
    this.httpMetrics.get(key)!.push(responseTime);
    
    // Track request counts by status code
    const statusKey = `status_${statusCode}`;
    this.requestCounts.set(statusKey, (this.requestCounts.get(statusKey) || 0) + 1);
  }
  
  /**
   * Record GraphQL operation metrics
   */
  public recordGraphQLOperation(
    operationName: string,
    responseTime: number,
    complexity?: number,
    hasErrors: boolean = false
  ): void {
    this.graphqlMetrics.requestCount++;
    this.graphqlMetrics.responseTimes.push(responseTime);
    
    if (complexity) {
      this.graphqlMetrics.complexityScores.push(complexity);
    }
    
    if (hasErrors) {
      this.graphqlMetrics.errorCount++;
    }
    
    this.recordMetric('graphql.request', 1, {
      operation: operationName,
      hasErrors: hasErrors.toString(),
    });
    
    this.recordMetric('graphql.response_time', responseTime, {
      operation: operationName,
    });
    
    if (complexity) {
      this.recordMetric('graphql.complexity', complexity, {
        operation: operationName,
      });
    }
  }
  
  /**
   * Get current system metrics
   */
  public async getSystemMetrics(): Promise<SystemMetrics> {
    const memUsage = process.memoryUsage();
    const dbStats = prismaService.getPoolStats();
    
    // Calculate database pool utilization (assuming max 10 connections)
    const maxConnections = 10; // Should come from config
    const poolUtilization = (dbStats.connectionCount / maxConnections) * 100;
    
    const metrics: SystemMetrics = {
      cpu: {
        usage: await this.getCpuUsage(),
        loadAverage: process.loadavg(),
      },
      memory: {
        used: memUsage.rss,
        total: process.memoryUsage().heapTotal,
        percentage: (memUsage.rss / process.memoryUsage().heapTotal) * 100,
        heap: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
        },
      },
      database: {
        connectionCount: dbStats.connectionCount,
        queryCount: dbStats.queryCount,
        errorCount: dbStats.errorCount,
        avgQueryTime: dbStats.avgQueryTime,
        poolUtilization,
      },
      graphql: {
        requestCount: this.graphqlMetrics.requestCount,
        errorCount: this.graphqlMetrics.errorCount,
        avgResponseTime: this.calculateAverage(this.graphqlMetrics.responseTimes),
        complexityAvg: this.calculateAverage(this.graphqlMetrics.complexityScores),
      },
      http: {
        requestCount: Array.from(this.requestCounts.values()).reduce((a, b) => a + b, 0),
        responseTime: this.calculatePercentiles(),
        statusCodes: Object.fromEntries(this.requestCounts.entries()),
      },
    };
    
    // Add cache metrics if cache is enabled
    try {
      const cacheManager = CacheManager.getInstance();
      if (cacheManager.isEnabled()) {
        metrics.cache = await this.getCacheMetrics();
      }
    } catch (error) {
      // Cache not available
    }
    
    return metrics;
  }
  
  /**
   * Get metrics for a specific time range
   */
  public getMetrics(
    startTime: number,
    endTime: number,
    metricName?: string
  ): MetricPoint[] {
    return this.metrics.filter(metric => {
      const timeMatch = metric.timestamp >= startTime && metric.timestamp <= endTime;
      const nameMatch = !metricName || metric.name === metricName;
      return timeMatch && nameMatch;
    });
  }
  
  /**
   * Clear old metrics (cleanup)
   */
  public cleanup(olderThan: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThan;
    this.metrics = this.metrics.filter(metric => metric.timestamp > cutoff);
    
    // Reset GraphQL metrics
    if (this.graphqlMetrics.responseTimes.length > 1000) {
      this.graphqlMetrics.responseTimes = this.graphqlMetrics.responseTimes.slice(-100);
      this.graphqlMetrics.complexityScores = this.graphqlMetrics.complexityScores.slice(-100);
    }
    
    // Reset HTTP metrics
    for (const [key, values] of this.httpMetrics.entries()) {
      if (values.length > 1000) {
        this.httpMetrics.set(key, values.slice(-100));
      }
    }
  }
  
  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    const metrics = await this.getSystemMetrics();
    
    // Record system metrics
    this.recordMetric('system.cpu.usage', metrics.cpu.usage);
    this.recordMetric('system.memory.usage', metrics.memory.percentage);
    this.recordMetric('system.memory.heap.used', metrics.memory.heap.used);
    
    // Record database metrics
    this.recordMetric('database.connections', metrics.database.connectionCount);
    this.recordMetric('database.queries', metrics.database.queryCount);
    this.recordMetric('database.errors', metrics.database.errorCount);
    this.recordMetric('database.pool_utilization', metrics.database.poolUtilization);
    
    // Record cache metrics if available
    if (metrics.cache) {
      this.recordMetric('cache.hit_rate', metrics.cache.hitRate);
      this.recordMetric('cache.miss_rate', metrics.cache.missRate);
      this.recordMetric('cache.size', metrics.cache.size);
    }
    
    // Clean up old metrics
    this.cleanup();
  }
  
  /**
   * Export metrics to external systems
   */
  private async exportMetrics(): Promise<void> {
    // This could export to Prometheus, DataDog, etc.
    // For now, just log summary
    const metrics = await this.getSystemMetrics();
    
    logger.info('System metrics', {
      cpu: `${metrics.cpu.usage.toFixed(1)}%`,
      memory: `${metrics.memory.percentage.toFixed(1)}%`,
      database: {
        connections: metrics.database.connectionCount,
        poolUtilization: `${metrics.database.poolUtilization.toFixed(1)}%`,
      },
      graphql: {
        requests: metrics.graphql.requestCount,
        avgResponseTime: `${metrics.graphql.avgResponseTime.toFixed(1)}ms`,
      },
    });
  }
  
  /**
   * Get CPU usage percentage
   */
  private async getCpuUsage(): Promise<number> {
    const start = process.cpuUsage();
    await new Promise(resolve => setTimeout(resolve, 100));
    const end = process.cpuUsage(start);
    
    const totalUsage = end.user + end.system;
    const cpuPercentage = (totalUsage / 100000) / 100; // Convert to percentage
    
    return Math.min(cpuPercentage * 100, 100); // Cap at 100%
  }
  
  /**
   * Get cache metrics
   */
  private async getCacheMetrics(): Promise<{
    hitRate: number;
    missRate: number;
    size: number;
    connections: number;
  }> {
    // This would typically query Redis INFO command
    // For now, return mock data
    return {
      hitRate: 85.5,
      missRate: 14.5,
      size: 1024,
      connections: 5,
    };
  }
  
  /**
   * Calculate average from array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Calculate response time percentiles
   */
  private calculatePercentiles(): { p50: number; p95: number; p99: number } {
    const allTimes: number[] = [];
    
    for (const times of this.httpMetrics.values()) {
      allTimes.push(...times);
    }
    
    if (allTimes.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }
    
    allTimes.sort((a, b) => a - b);
    
    return {
      p50: this.percentile(allTimes, 0.5),
      p95: this.percentile(allTimes, 0.95),
      p99: this.percentile(allTimes, 0.99),
    };
  }
  
  /**
   * Calculate percentile from sorted array
   */
  private percentile(values: number[], p: number): number {
    const index = Math.ceil(values.length * p) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }
}

/**
 * Express/H3 middleware for HTTP metrics
 */
export function createMetricsMiddleware() {
  const collector = MetricsCollector.getInstance();
  
  return (event: any) => {
    const start = Date.now();
    const method = event.node.req.method;
    const path = event.node.req.url;
    
    // Record metrics on response
    event.node.res.on('finish', () => {
      const responseTime = Date.now() - start;
      const statusCode = event.node.res.statusCode;
      
      collector.recordHttpRequest(method, path, statusCode, responseTime);
    });
  };
}