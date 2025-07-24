import { BaseService, BaseAsyncService } from './BaseService.js';
import { ServiceRegistry } from './ServiceRegistry.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';

interface MetricValue {
  name: string;
  value: number;
  timestamp: Date;
  labels?: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
}

interface MetricAggregation {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface MetricsEventMap {
  'metric:recorded': {
    service: string;
    metric: string;
    value: number;
    type: MetricValue['type'];
    labels?: Record<string, string>;
  };
  'aggregation:completed': {
    timestamp: Date;
  };
}

/**
 * Advanced Service Metrics Collector
 * Provides comprehensive metrics collection and aggregation for all BaseService instances
 */
export class ServiceMetrics extends TypedEventEmitter<MetricsEventMap> {
  private static instance: ServiceMetrics;
  private metrics: Map<string, MetricValue[]> = new Map();
  private aggregations: Map<string, MetricAggregation> = new Map();
  private retentionPeriod: number = 3600000; // 1 hour default
  private aggregationInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.startAggregation();
    this.startCleanup();
  }

  static getInstance(): ServiceMetrics {
    if (!ServiceMetrics.instance) {
      ServiceMetrics.instance = new ServiceMetrics();
    }
    return ServiceMetrics.instance;
  }

  /**
   * Record a metric value
   */
  record(
    serviceName: string,
    metricName: string,
    value: number,
    type: MetricValue['type'] = 'gauge',
    labels?: Record<string, string>
  ): void {
    const key = this.getMetricKey(serviceName, metricName, labels);
    const metric: MetricValue = {
      name: metricName,
      value,
      timestamp: new Date(),
      labels,
      type,
    };

    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    this.metrics.get(key)!.push(metric);

    // Emit metric event
    this.emit('metric:recorded', {
      service: serviceName,
      metric: metricName,
      value,
      type,
      labels,
    });

    // Update counter/gauge immediately
    if (type === 'counter' || type === 'gauge') {
      this.updateImmediateValue(key, value, type);
    }
  }

  /**
   * Get metrics for a service
   */
  getServiceMetrics(
    serviceName: string,
    metricName?: string,
    startTime?: Date,
    endTime?: Date
  ): MetricValue[] {
    const results: MetricValue[] = [];
    const pattern = metricName 
      ? `${serviceName}:${metricName}`
      : `${serviceName}:`;

    for (const [key, values] of this.metrics.entries()) {
      if (key.startsWith(pattern)) {
        const filtered = this.filterByTime(values, startTime, endTime);
        results.push(...filtered);
      }
    }

    return results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get aggregated metrics
   */
  getAggregation(
    serviceName: string,
    metricName: string,
    labels?: Record<string, string>
  ): MetricAggregation | null {
    const key = this.getMetricKey(serviceName, metricName, labels);
    return this.aggregations.get(key) || null;
  }

  /**
   * Get all service metrics summary
   */
  getAllServicesSummary(): Map<string, {
    totalMetrics: number;
    metrics: Map<string, {
      type: string;
      latest: number;
      aggregation?: MetricAggregation;
    }>;
  }> {
    const summary = new Map<string, any>();

    // Group metrics by service
    for (const [key, values] of this.metrics.entries()) {
      const [serviceName, metricName] = key.split(':');
      
      if (!summary.has(serviceName)) {
        summary.set(serviceName, {
          totalMetrics: 0,
          metrics: new Map(),
        });
      }

      const service = summary.get(serviceName)!;
      const latest = values[values.length - 1];
      
      if (latest) {
        service.metrics.set(metricName, {
          type: latest.type,
          latest: latest.value,
          aggregation: this.aggregations.get(key),
        });
        service.totalMetrics++;
      }
    }

    return summary;
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const processedMetrics = new Set<string>();

    for (const [key, values] of this.metrics.entries()) {
      if (values.length === 0) continue;

      const [serviceName, metricName] = key.split(':');
      const latest = values[values.length - 1];
      const metricFullName = `${serviceName}_${metricName}`.replace(/-/g, '_');

      // Skip if already processed (for multi-label metrics)
      if (processedMetrics.has(metricFullName)) continue;
      processedMetrics.add(metricFullName);

      // Add metric type
      lines.push(`# TYPE ${metricFullName} ${latest.type}`);
      
      // Add metric help
      lines.push(`# HELP ${metricFullName} ${metricName} for ${serviceName}`);

      // Add metric values
      if (latest.type === 'counter' || latest.type === 'gauge') {
        const labelStr = this.formatPrometheusLabels(latest.labels);
        lines.push(`${metricFullName}${labelStr} ${latest.value}`);
      } else if (latest.type === 'histogram' || latest.type === 'summary') {
        const agg = this.aggregations.get(key);
        if (agg) {
          const labelStr = this.formatPrometheusLabels(latest.labels);
          lines.push(`${metricFullName}_count${labelStr} ${agg.count}`);
          lines.push(`${metricFullName}_sum${labelStr} ${agg.sum}`);
          
          if (latest.type === 'summary') {
            lines.push(`${metricFullName}{quantile="0.5"${labelStr}} ${agg.p50}`);
            lines.push(`${metricFullName}{quantile="0.95"${labelStr}} ${agg.p95}`);
            lines.push(`${metricFullName}{quantile="0.99"${labelStr}} ${agg.p99}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Set retention period for metrics
   */
  setRetentionPeriod(milliseconds: number): void {
    this.retentionPeriod = milliseconds;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.aggregations.clear();
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Create histogram buckets
   */
  createHistogramBuckets(values: number[]): Map<number, number> {
    const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    const counts = new Map<number, number>();

    for (const bucket of buckets) {
      counts.set(bucket, 0);
    }

    for (const value of values) {
      for (const bucket of buckets) {
        if (value <= bucket) {
          counts.set(bucket, counts.get(bucket)! + 1);
        }
      }
    }

    return counts;
  }

  private getMetricKey(
    serviceName: string,
    metricName: string,
    labels?: Record<string, string>
  ): string {
    let key = `${serviceName}:${metricName}`;
    
    if (labels) {
      const labelStr = Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      key += `:${labelStr}`;
    }

    return key;
  }

  private filterByTime(
    values: MetricValue[],
    startTime?: Date,
    endTime?: Date
  ): MetricValue[] {
    return values.filter(v => {
      const time = v.timestamp.getTime();
      const start = startTime?.getTime() || 0;
      const end = endTime?.getTime() || Date.now();
      return time >= start && time <= end;
    });
  }

  private updateImmediateValue(key: string, value: number, type: string): void {
    if (type === 'counter') {
      // Counters always increase
      const current = this.aggregations.get(key);
      if (current) {
        current.sum = value;
        current.max = Math.max(current.max, value);
      }
    }
  }

  private startAggregation(): void {
    this.aggregationInterval = setInterval(() => {
      this.performAggregation();
    }, 60000); // Aggregate every minute
  }

  private performAggregation(): void {
    for (const [key, values] of this.metrics.entries()) {
      if (values.length === 0) continue;

      const numbers = values.map(v => v.value).sort((a, b) => a - b);
      
      this.aggregations.set(key, {
        count: numbers.length,
        sum: numbers.reduce((sum, n) => sum + n, 0),
        min: numbers[0],
        max: numbers[numbers.length - 1],
        avg: numbers.reduce((sum, n) => sum + n, 0) / numbers.length,
        p50: this.percentile(numbers, 0.5),
        p95: this.percentile(numbers, 0.95),
        p99: this.percentile(numbers, 0.99),
      });
    }

    this.emit('aggregation:completed', { timestamp: new Date() });
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, 300000); // Clean up every 5 minutes
  }

  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.retentionPeriod;
    let cleaned = 0;

    for (const [key, values] of this.metrics.entries()) {
      const filtered = values.filter(v => v.timestamp.getTime() > cutoff);
      
      if (filtered.length === 0) {
        this.metrics.delete(key);
        this.aggregations.delete(key);
        cleaned++;
      } else if (filtered.length < values.length) {
        this.metrics.set(key, filtered);
        cleaned += values.length - filtered.length;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old metric values`);
    }
  }

  private formatPrometheusLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    const pairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    
    return `{${pairs}}`;
  }

  /**
   * Analyze service performance
   */
  analyzeServicePerformance(serviceName: string): {
    responseTime: {
      avg: number;
      p95: number;
      p99: number;
    };
    errorRate: number;
    throughput: number;
    availability: number;
  } | null {
    // Get response time metrics
    const responseTimeAgg = this.getAggregation(serviceName, 'request_duration_ms');
    
    // Get error metrics
    const errorCount = this.getServiceMetrics(serviceName, 'errors_total')
      .reduce((sum, m) => sum + m.value, 0);
    
    // Get request count
    const requestCount = this.getServiceMetrics(serviceName, 'requests_total')
      .reduce((sum, m) => sum + m.value, 0);
    
    // Get uptime
    const uptimeMetrics = this.getServiceMetrics(serviceName, 'uptime_seconds');
    const totalTime = uptimeMetrics.length > 0 
      ? uptimeMetrics[uptimeMetrics.length - 1].value 
      : 0;

    if (!responseTimeAgg || requestCount === 0) {
      return null;
    }

    return {
      responseTime: {
        avg: responseTimeAgg.avg,
        p95: responseTimeAgg.p95,
        p99: responseTimeAgg.p99,
      },
      errorRate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
      throughput: totalTime > 0 ? requestCount / (totalTime / 60) : 0, // requests per minute
      availability: totalTime > 0 ? (totalTime / this.retentionPeriod) * 100 : 0,
    };
  }
}

/**
 * Metrics decorator for automatic method timing
 */
export function TimedMetric(metricName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    descriptor.value = isAsync
      ? async function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const start = performance.now();
          const name = metricName || `${propertyKey}_duration_ms`;
          
          try {
            const result = await originalMethod.apply(this, args);
            const duration = performance.now() - start;
            
            ServiceMetrics.getInstance().record(
              this.metadata.name,
              name,
              duration,
              'histogram'
            );
            
            return result;
          } catch (error) {
            const duration = performance.now() - start;
            
            ServiceMetrics.getInstance().record(
              this.metadata.name,
              name,
              duration,
              'histogram',
              { status: 'error' }
            );
            
            throw error;
          }
        }
      : function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const start = performance.now();
          const name = metricName || `${propertyKey}_duration_ms`;
          
          try {
            const result = originalMethod.apply(this, args);
            const duration = performance.now() - start;
            
            ServiceMetrics.getInstance().record(
              this.metadata.name,
              name,
              duration,
              'histogram'
            );
            
            return result;
          } catch (error) {
            const duration = performance.now() - start;
            
            ServiceMetrics.getInstance().record(
              this.metadata.name,
              name,
              duration,
              'histogram',
              { status: 'error' }
            );
            
            throw error;
          }
        };

    return descriptor;
  };
}

/**
 * Counter decorator for tracking method calls
 */
export function CounterMetric(metricName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    descriptor.value = isAsync
      ? async function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const name = metricName || `${propertyKey}_total`;
          
          ServiceMetrics.getInstance().record(
            this.metadata.name,
            name,
            1,
            'counter'
          );
          
          return originalMethod.apply(this, args);
        }
      : function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const name = metricName || `${propertyKey}_total`;
          
          ServiceMetrics.getInstance().record(
            this.metadata.name,
            name,
            1,
            'counter'
          );
          
          return originalMethod.apply(this, args);
        };

    return descriptor;
  };
}