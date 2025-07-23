import { metrics, ValueType } from '@opentelemetry/api';
import * as resources from '@opentelemetry/resources';
const Resource = resources.Resource || resources.default?.Resource;
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { logger } from '@/logger';
import { EventEmitterSingletonService } from '../core/SingletonService.js';
import { performance } from 'perf_hooks';

export interface MetricsConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  prometheusPort?: number;
  exportInterval: number;
  enablePrometheus: boolean;
  enableOTLP: boolean;
  otlpEndpoint?: string;
}

export interface MetricDefinition {
  name: string;
  description: string;
  type: 'counter' | 'histogram' | 'gauge' | 'up_down_counter';
  unit?: string;
  labels?: string[];
}

export interface BusinessMetric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
  type: 'revenue' | 'usage' | 'performance' | 'engagement';
}

export interface AlertRule {
  id: string;
  metricName: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  duration: number; // seconds
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
}

export interface MetricSnapshot {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

const defaultConfig: MetricsConfig = {
  serviceName: 'pothos-todo',
  serviceVersion: '1.0.0',
  environment: 'development',
  exportInterval: 30000,
  enablePrometheus: true,
  enableOTLP: false
};
export class MetricsCollector extends EventEmitterSingletonService {
  private config: MetricsConfig;
  private meter: any;
  private meterProvider: MeterProvider = new MeterProvider();
  private instruments: Map<string, any> = new Map();
  private businessMetrics: BusinessMetric[] = [];
  private metricHistory: Map<string, MetricSnapshot[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private alertStates: Map<string, { triggered: boolean; since: number }> = new Map();
  private initialized: boolean = false;

  constructor(config?: MetricsConfig) {
    super();
    // Default config - can be configured later
    this.config = config || defaultConfig;
    this.setupMeterProvider();
  }

  // public static override getInstance(config?: MetricsConfig): MetricsCollector {
  //   const metricsCollector = super.getInstance() as MetricsCollector;
  //   if (metricsCollector && config) {
  //     metricsCollector.configure(config);
  //   }
  //   return metricsCollector;
  // }

  // Configure metrics collection
  public configure(config: MetricsConfig): void {
    this.config = { ...this.config, ...config };
    this.setupMeterProvider();
  }

  /**
   * Initialize metrics collection with comprehensive setup
   */
  public async initialize(): Promise<void> {
    try {
      if (this.initialized) {
        logger.warn('Metrics collector already initialized');
        return;
      }

      // Get meter instance
      this.meter = this.meterProvider.getMeter(
        this.config.serviceName,
        this.config.serviceVersion
      );

      // Setup standard metrics
      await this.setupStandardMetrics();

      // Setup business metrics tracking
      this.setupBusinessMetricsTracking();

      // Setup alerting
      this.setupAlerting();

      // Start background tasks
      this.startMetricCollection();

      this.initialized = true;

      logger.info('Metrics collector initialized', {
        serviceName: this.config.serviceName,
        prometheusEnabled: this.config.enablePrometheus,
        otlpEnabled: this.config.enableOTLP,
      });

      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize metrics collector', error);
      throw error;
    }
  }

  /**
   * Create and register a custom metric
   */
  public createMetric(definition: MetricDefinition): void {
    try {
      let instrument;

      switch (definition.type) {
        case 'counter':
          instrument = this.meter.createCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
            valueType: ValueType.INT,
          });
          break;

        case 'histogram':
          instrument = this.meter.createHistogram(definition.name, {
            description: definition.description,
            unit: definition.unit,
            valueType: ValueType.DOUBLE,
          });
          break;

        case 'gauge':
          instrument = this.meter.createObservableGauge(definition.name, {
            description: definition.description,
            unit: definition.unit,
            valueType: ValueType.DOUBLE,
          });
          break;

        case 'up_down_counter':
          instrument = this.meter.createUpDownCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
            valueType: ValueType.INT,
          });
          break;

        default:
          throw new Error(`Unknown metric type: ${definition.type}`);
      }

      this.instruments.set(definition.name, {
        instrument,
        definition,
      });

      logger.debug('Custom metric created', {
        name: definition.name,
        type: definition.type,
      });
    } catch (error) {
      logger.error('Failed to create custom metric', error);
      throw error;
    }
  }

  /**
   * Record metric value with labels
   */
  public recordMetric(
    metricName: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    const metricInfo = this.instruments.get(metricName);
    if (!metricInfo) {
      logger.warn(`Metric ${metricName} not found`);
      return;
    }

    try {
      const { instrument, definition } = metricInfo;

      switch (definition.type) {
        case 'counter':
          instrument.add(value, labels);
          break;
        case 'histogram':
          instrument.record(value, labels);
          break;
        case 'up_down_counter':
          instrument.add(value, labels);
          break;
        // Gauge is handled differently as it's observable
      }

      // Store in history for analysis
      this.storeMetricSnapshot(metricName, value, labels || {});

      // Check alerts
      this.checkAlerts(metricName, value, labels || {});
    } catch (error) {
      logger.error(`Failed to record metric ${metricName}`, error);
    }
  }

  /**
   * Record business metric with rich metadata
   */
  public recordBusinessMetric(metric: Omit<BusinessMetric, 'timestamp'>): void {
    const businessMetric: BusinessMetric = {
      ...metric,
      timestamp: Date.now(),
    };

    this.businessMetrics.push(businessMetric);

    // Keep only recent business metrics
    if (this.businessMetrics.length > 10000) {
      this.businessMetrics = this.businessMetrics.slice(-5000);
    }

    // Also record as regular metric
    this.recordMetric(`business.${metric.name}`, metric.value, {
      type: metric.type,
      ...metric.labels,
    });

    logger.info('Business metric recorded', businessMetric);
    this.emit('business_metric', businessMetric);
  }

  /**
   * Time operation and record duration
   */
  public timeOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const startTime = performance.now();

    return operation()
      .then(result => {
        const duration = performance.now() - startTime;
        this.recordMetric(`${operationName}_duration`, duration, labels);
        this.recordMetric(`${operationName}_total`, 1, { ...labels, status: 'success' });
        return result;
      })
      .catch(error => {
        const duration = performance.now() - startTime;
        this.recordMetric(`${operationName}_duration`, duration, labels);
        this.recordMetric(`${operationName}_total`, 1, { ...labels, status: 'error' });
        throw error;
      });
  }

  /**
   * Create alert rule for metric monitoring
   */
  public createAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.alertStates.set(rule.id, { triggered: false, since: 0 });

    logger.info('Alert rule created', {
      id: rule.id,
      metric: rule.metricName,
      condition: rule.condition,
      threshold: rule.threshold,
    });
  }

  /**
   * Get metric statistics for analysis
   */
  public getMetricStats(
    metricName: string,
    timeRange?: { start: number; end: number }
  ): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    percentiles: { p50: number; p95: number; p99: number };
  } {
    const history = this.metricHistory.get(metricName) || [];
    let filteredHistory = history;

    if (timeRange) {
      filteredHistory = history.filter(
        snapshot => snapshot.timestamp >= timeRange.start && snapshot.timestamp <= timeRange.end
      );
    }

    if (filteredHistory.length === 0) {
      return {
        count: 0,
        sum: 0,
        avg: 0,
        min: 0,
        max: 0,
        percentiles: { p50: 0, p95: 0, p99: 0 },
      };
    }

    const values = filteredHistory.map(s => s.value).sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);

    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: values[0] || 0,
      max: values[values.length - 1] || 0,
      percentiles: {
        p50: values[Math.floor(values.length * 0.5)] || 0,
        p95: values[Math.floor(values.length * 0.95)] || 0,
        p99: values[Math.floor(values.length * 0.99)] || 0,
      },
    };
  }

  /**
   * Get business metrics analysis
   */
  public getBusinessMetricsAnalysis(type?: BusinessMetric['type']): {
    totalRevenue?: number;
    totalUsage?: number;
    averagePerformance?: number;
    engagementScore?: number;
    trends: Array<{
      metric: string;
      trend: 'up' | 'down' | 'stable';
      change: number;
    }>;
  } {
    let metrics = this.businessMetrics;
    if (type) {
      metrics = metrics.filter(m => m.type === type);
    }

    const analysis: any = { trends: [] };

    // Calculate aggregates by type
    const revenueMetrics = metrics.filter(m => m.type === 'revenue');
    const usageMetrics = metrics.filter(m => m.type === 'usage');
    const performanceMetrics = metrics.filter(m => m.type === 'performance');
    const engagementMetrics = metrics.filter(m => m.type === 'engagement');

    if (revenueMetrics.length > 0) {
      analysis.totalRevenue = revenueMetrics.reduce((sum, m) => sum + m.value, 0);
    }

    if (usageMetrics.length > 0) {
      analysis.totalUsage = usageMetrics.reduce((sum, m) => sum + m.value, 0);
    }

    if (performanceMetrics.length > 0) {
      analysis.averagePerformance = performanceMetrics.reduce((sum, m) => sum + m.value, 0) / performanceMetrics.length;
    }

    if (engagementMetrics.length > 0) {
      analysis.engagementScore = engagementMetrics.reduce((sum, m) => sum + m.value, 0) / engagementMetrics.length;
    }

    // Calculate trends (simplified)
    const metricNames = [...new Set(metrics.map(m => m.name))];
    for (const metricName of metricNames) {
      const metricData = metrics.filter(m => m.name === metricName);
      if (metricData.length >= 2) {
        const recent = metricData.slice(-10);
        const older = metricData.slice(-20, -10);

        const recentAvg = recent.reduce((sum, m) => sum + m.value, 0) / recent.length;
        const olderAvg = older.length > 0 ? older.reduce((sum, m) => sum + m.value, 0) / older.length : recentAvg;

        const change = ((recentAvg - olderAvg) / olderAvg) * 100;

        analysis.trends.push({
          metric: metricName,
          trend: Math.abs(change) < 5 ? 'stable' : change > 0 ? 'up' : 'down',
          change,
        });
      }
    }

    return analysis;
  }

  /**
   * Export metrics data for external analysis
   */
  public exportMetrics(): {
    metrics: Record<string, MetricSnapshot[]>;
    businessMetrics: BusinessMetric[];
    alerts: AlertRule[];
    summary: {
      totalMetrics: number;
      timeRange: { start: number; end: number };
      exportTime: number;
    };
  } {
    const metricsData: Record<string, MetricSnapshot[]> = {};

    for (const [name, snapshots] of this.metricHistory) {
      metricsData[name] = [...snapshots];
    }

    const timeRange = {
      start: Math.min(...Array.from(this.metricHistory.values()).flat().map(s => s.timestamp)),
      end: Math.max(...Array.from(this.metricHistory.values()).flat().map(s => s.timestamp)),
    };

    return {
      metrics: metricsData,
      businessMetrics: [...this.businessMetrics],
      alerts: Array.from(this.alertRules.values()),
      summary: {
        totalMetrics: this.instruments.size,
        timeRange,
        exportTime: Date.now(),
      },
    };
  }

  // Private helper methods

  private setupMeterProvider(): void {
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
    });

    const readers = [];

    // Prometheus exporter
    if (this.config.enablePrometheus) {
      const prometheusExporter = new PrometheusExporter({
        port: this.config.prometheusPort || 9090,
      });
      readers.push(prometheusExporter);
    }

    // OTLP exporter (if configured)
    if (this.config.enableOTLP && this.config.otlpEndpoint) {
      // Add OTLP metric reader configuration here
    }

    this.meterProvider = new MeterProvider({
      resource,
      readers,
    });

    // Register global meter provider
    metrics.setGlobalMeterProvider(this.meterProvider);
  }

  private async setupStandardMetrics(): Promise<void> {
    // HTTP request metrics
    this.createMetric({
      name: 'http_requests_total',
      description: 'Total number of HTTP requests',
      type: 'counter',
      unit: 'requests',
      labels: ['method', 'status', 'endpoint'],
    });

    this.createMetric({
      name: 'http_request_duration',
      description: 'HTTP request duration',
      type: 'histogram',
      unit: 'ms',
      labels: ['method', 'endpoint'],
    });

    // GraphQL metrics
    this.createMetric({
      name: 'graphql_operations_total',
      description: 'Total GraphQL operations',
      type: 'counter',
      unit: 'operations',
      labels: ['operation_type', 'operation_name'],
    });

    this.createMetric({
      name: 'graphql_operation_duration',
      description: 'GraphQL operation duration',
      type: 'histogram',
      unit: 'ms',
      labels: ['operation_type', 'operation_name'],
    });

    // Database metrics
    this.createMetric({
      name: 'database_operations_total',
      description: 'Total database operations',
      type: 'counter',
      unit: 'operations',
      labels: ['operation', 'table'],
    });

    this.createMetric({
      name: 'database_operation_duration',
      description: 'Database operation duration',
      type: 'histogram',
      unit: 'ms',
      labels: ['operation', 'table'],
    });

    // System metrics
    this.createMetric({
      name: 'memory_usage',
      description: 'Memory usage',
      type: 'gauge',
      unit: 'bytes',
    });

    this.createMetric({
      name: 'cpu_usage',
      description: 'CPU usage percentage',
      type: 'gauge',
      unit: 'percent',
    });

    // Business metrics
    this.createMetric({
      name: 'active_users',
      description: 'Number of active users',
      type: 'gauge',
      unit: 'users',
    });

    this.createMetric({
      name: 'todos_created_total',
      description: 'Total todos created',
      type: 'counter',
      unit: 'todos',
    });

    this.createMetric({
      name: 'todos_completed_total',
      description: 'Total todos completed',
      type: 'counter',
      unit: 'todos',
    });
  }

  private setupBusinessMetricsTracking(): void {
    // Periodically record system metrics
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.recordMetric('memory_usage', memUsage.heapUsed, { type: 'heap' });
      this.recordMetric('memory_usage', memUsage.external, { type: 'external' });

      // CPU usage would require additional monitoring
      this.recordMetric('cpu_usage', Math.random() * 100); // Simulated
    }, 30000); // Every 30 seconds
  }

  private setupAlerting(): void {
    // Create default alert rules
    this.createAlertRule({
      id: 'high_error_rate',
      metricName: 'http_requests_total',
      condition: 'greater_than',
      threshold: 0.05, // 5% error rate
      duration: 300, // 5 minutes
      severity: 'critical',
      enabled: true,
    });

    this.createAlertRule({
      id: 'high_response_time',
      metricName: 'http_request_duration',
      condition: 'greater_than',
      threshold: 1000, // 1 second
      duration: 180, // 3 minutes
      severity: 'warning',
      enabled: true,
    });

    this.createAlertRule({
      id: 'high_memory_usage',
      metricName: 'memory_usage',
      condition: 'greater_than',
      threshold: 1000000000, // 1GB
      duration: 600, // 10 minutes
      severity: 'warning',
      enabled: true,
    });
  }

  private startMetricCollection(): void {
    // Start periodic metric collection and analysis
    setInterval(() => {
      this.performMetricAnalysis();
    }, 60000); // Every minute

    // Cleanup old metrics
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000); // Every hour
  }

  private performMetricAnalysis(): void {
    // Analyze metric trends and patterns
    for (const [metricName, snapshots] of this.metricHistory) {
      if (snapshots.length >= 10) {
        const recentValues = snapshots.slice(-10).map(s => s.value);
        const variance = this.calculateVariance(recentValues);

        if (variance > 100) { // High variance threshold
          this.emit('metric_anomaly', {
            metric: metricName,
            type: 'high_variance',
            variance,
            recent_values: recentValues,
          });
        }
      }
    }
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

    for (const [metricName, snapshots] of this.metricHistory) {
      const filtered = snapshots.filter(s => s.timestamp > cutoffTime);
      this.metricHistory.set(metricName, filtered);
    }

    // Cleanup business metrics
    this.businessMetrics = this.businessMetrics.filter(m => m.timestamp > cutoffTime);
  }

  private storeMetricSnapshot(
    name: string,
    value: number,
    labels: Record<string, string>
  ): void {
    if (!this.metricHistory.has(name)) {
      this.metricHistory.set(name, []);
    }

    const snapshots = this.metricHistory.get(name)!;
    snapshots.push({
      name,
      value,
      timestamp: Date.now(),
      labels,
    });

    // Keep only recent snapshots
    if (snapshots.length > 1000) {
      snapshots.splice(0, snapshots.length - 500);
    }
  }

  private checkAlerts(
    metricName: string,
    value: number,
    labels: Record<string, string>
  ): void {
    for (const [alertId, rule] of this.alertRules) {
      if (!rule.enabled || rule.metricName !== metricName) {
        continue;
      }

      const conditionMet = this.evaluateAlertCondition(rule, value);
      const alertState = this.alertStates.get(alertId)!;

      if (conditionMet && !alertState.triggered) {
        alertState.triggered = true;
        alertState.since = Date.now();

        this.emit('alert_triggered', {
          rule,
          value,
          labels,
          triggeredAt: alertState.since,
        });

        logger.warn('Alert triggered', {
          alertId,
          metric: metricName,
          value,
          threshold: rule.threshold,
        });
      } else if (!conditionMet && alertState.triggered) {
        alertState.triggered = false;

        this.emit('alert_resolved', {
          rule,
          value,
          labels,
          resolvedAt: Date.now(),
          duration: Date.now() - alertState.since,
        });

        logger.info('Alert resolved', {
          alertId,
          metric: metricName,
          value,
        });
      }
    }
  }

  private evaluateAlertCondition(rule: AlertRule, value: number): boolean {
    switch (rule.condition) {
      case 'greater_than':
        return value > rule.threshold;
      case 'less_than':
        return value < rule.threshold;
      case 'equals':
        return value === rule.threshold;
      case 'not_equals':
        return value !== rule.threshold;
      default:
        return false;
    }
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  /**
   * Get current metrics overview
   */
  public getMetricsOverview(): {
    totalMetrics: number;
    businessMetrics: number;
    activeAlerts: number;
    systemHealth: 'healthy' | 'warning' | 'critical';
  } {
    const activeAlerts = Array.from(this.alertStates.values()).filter(
      state => state.triggered
    ).length;

    let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (activeAlerts > 0) {
      const criticalAlerts = Array.from(this.alertRules.values()).filter(
        rule => rule.severity === 'critical' && this.alertStates.get(rule.id)?.triggered
      ).length;

      systemHealth = criticalAlerts > 0 ? 'critical' : 'warning';
    }

    return {
      totalMetrics: this.instruments.size,
      businessMetrics: this.businessMetrics.length,
      activeAlerts,
      systemHealth,
    };
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    try {
      await this.meterProvider.shutdown();
      this.instruments.clear();
      this.metricHistory.clear();
      this.businessMetrics = [];
      this.alertRules.clear();
      this.alertStates.clear();

      logger.info('Metrics collector cleaned up');
    } catch (error) {
      logger.error('Error during metrics collector cleanup', error);
    }
  }
}

// Export singleton factory
export const createMetricsCollector = (config: MetricsConfig) => {
  const metricsCollector = new MetricsCollector(config);
  metricsCollector.configure(config);
  return metricsCollector;
};