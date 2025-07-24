import { metrics, ValueType } from '@opentelemetry/api';
import * as resources from '@opentelemetry/resources';
const Resource = resources.Resource || resources.default?.Resource;
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { MetricsCollectorEventMap } from '../core/ServiceEventMaps.observability.js';
import { 
  ServiceConfig, 
  Metric, 
  HealthCheck,
  Cache 
} from '../core/decorators/ServiceDecorators.js';
import { 
  MetricsSampling,
  Traced,
  AlertThreshold,
  Profiled,
  ObservabilityMonitored 
} from '../core/decorators/ObservabilityDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { performance } from 'perf_hooks';

/**
 * Metrics collector configuration schema
 */
const MetricsCollectorConfigSchema = z.object({
  serviceName: z.string().default('pothos-todo'),
  serviceVersion: z.string().default('1.0.0'),
  environment: z.string().default('development'),
  prometheusPort: z.number().default(9090),
  exportInterval: z.number().default(30000),
  enablePrometheus: z.boolean().default(true),
  enableOTLP: z.boolean().default(false),
  otlpEndpoint: z.string().optional(),
  retention: z.object({
    maxHistorySize: z.number().default(10000),
    maxAge: z.number().default(86400000), // 24 hours
    cleanupInterval: z.number().default(3600000), // 1 hour
  }),
  sampling: z.object({
    defaultRate: z.number().default(1.0),
    adaptiveSampling: z.boolean().default(true),
    maxPerSecond: z.number().default(1000),
  }),
  alerting: z.object({
    enabled: z.boolean().default(true),
    defaultRules: z.boolean().default(true),
    evaluationInterval: z.number().default(60000), // 1 minute
  }),
  businessMetrics: z.object({
    enabled: z.boolean().default(true),
    categories: z.array(z.string()).default(['revenue', 'usage', 'performance', 'engagement']),
  }),
});

export type MetricsCollectorConfig = z.infer<typeof MetricsCollectorConfigSchema>;

/**
 * Metric definition interface
 */
export interface MetricDefinition {
  name: string;
  description: string;
  type: 'counter' | 'histogram' | 'gauge' | 'up_down_counter';
  unit?: string;
  labels?: string[];
}

/**
 * Business metric interface
 */
export interface BusinessMetric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
  type: 'revenue' | 'usage' | 'performance' | 'engagement';
}

/**
 * Alert rule interface
 */
export interface AlertRule {
  id: string;
  metricName: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  duration: number; // seconds
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
}

/**
 * Metric snapshot interface
 */
export interface MetricSnapshot {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

/**
 * Enhanced Metrics Collector Service using the new base service architecture
 * 
 * Features:
 * - OpenTelemetry metrics collection with Prometheus export
 * - Business metrics tracking and analysis
 * - Alert rule management and evaluation
 * - Metric history and statistical analysis
 * - Sampling and performance optimization
 * - Comprehensive health monitoring
 * 
 * @example
 * ```typescript
 * const metricsCollector = MetricsCollector.getInstance();
 * 
 * // Listen to metrics events
 * metricsCollector.on('metrics:collected', ({ name, value, labels }) => {
 *   console.log(`Collected metric ${name}: ${value}`);
 * });
 * 
 * // Record custom metrics
 * metricsCollector.recordMetric('api.requests', 1, { method: 'POST', endpoint: '/todos' });
 * 
 * // Record business metrics
 * metricsCollector.recordBusinessMetric({
 *   name: 'user_signup',
 *   value: 1,
 *   type: 'engagement',
 *   labels: { source: 'web' }
 * });
 * ```
 */
@ServiceConfig({
  schema: MetricsCollectorConfigSchema,
  prefix: 'metrics',
  hot: true, // Allow hot reload for configuration changes
})
export class MetricsCollector extends BaseService<MetricsCollectorConfig, MetricsCollectorEventMap> {
  private meter: any;
  private meterProvider!: MeterProvider;
  private instruments: Map<string, any> = new Map();
  private businessMetrics: BusinessMetric[] = [];
  private metricHistory: Map<string, MetricSnapshot[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private alertStates: Map<string, { triggered: boolean; since: number }> = new Map();
  private metricsCollected = 0;
  private businessMetricsCollected = 0;
  private alertsTriggered = 0;

  /**
   * Get the singleton instance
   */
  static override getInstance(): MetricsCollector {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'metrics-collector';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Comprehensive metrics collection and monitoring service';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('MetricsCollector initializing with config:', {
      serviceName: this.config.serviceName,
      prometheusEnabled: this.config.enablePrometheus,
      otlpEnabled: this.config.enableOTLP,
      alertingEnabled: this.config.alerting.enabled,
    });

    // Setup meter provider
    this.setupMeterProvider();
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Get meter instance
    this.meter = this.meterProvider.getMeter(
      this.config.serviceName,
      this.config.serviceVersion
    );

    // Setup standard metrics
    await this.setupStandardMetrics();

    // Setup business metrics tracking
    this.setupBusinessMetricsTracking();

    // Setup alerting if enabled
    if (this.config.alerting.enabled) {
      this.setupAlerting();
    }

    // Start background tasks
    this.startBackgroundTasks();

    logger.info('MetricsCollector started successfully');
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    try {
      await this.meterProvider.shutdown();
      this.instruments.clear();
      this.metricHistory.clear();
      this.businessMetrics = [];
      this.alertRules.clear();
      this.alertStates.clear();
      logger.info('MetricsCollector stopped successfully');
    } catch (error) {
      logger.error('Error stopping MetricsCollector:', error);
    }
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: MetricsCollectorConfig): Promise<void> {
    // Recreate meter provider if core settings changed
    if (
      newConfig.serviceName !== this.config.serviceName ||
      newConfig.serviceVersion !== this.config.serviceVersion ||
      newConfig.enablePrometheus !== this.config.enablePrometheus ||
      newConfig.prometheusPort !== this.config.prometheusPort
    ) {
      logger.info('Core metrics configuration changed, recreating meter provider');
      await this.meterProvider.shutdown();
      this.setupMeterProvider();
      
      // Recreate meter
      this.meter = this.meterProvider.getMeter(
        newConfig.serviceName,
        newConfig.serviceVersion
      );
    }
  }

  /**
   * Health check for metrics collection
   */
  @HealthCheck({
    name: 'metrics:collection',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkMetricsCollection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const recentMetrics = this.getRecentMetricsCount(60000); // Last minute
      
      if (recentMetrics === 0) {
        return {
          status: 'unhealthy',
          message: 'No metrics collected in the last minute',
        };
      }

      return {
        status: 'healthy',
        message: `Metrics collection healthy (${recentMetrics} metrics/min)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Metrics collection check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for alerting system
   */
  @HealthCheck({
    name: 'metrics:alerting',
    critical: false,
    interval: 60000,
  })
  async checkAlerting(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    if (!this.config.alerting.enabled) {
      return { status: 'healthy', message: 'Alerting disabled' };
    }

    const activeAlerts = Array.from(this.alertStates.values())
      .filter(state => state.triggered).length;

    if (activeAlerts > 10) {
      return {
        status: 'degraded',
        message: `High number of active alerts: ${activeAlerts}`,
      };
    }

    return {
      status: 'healthy',
      message: `Alerting system healthy (${activeAlerts} active alerts)`,
    };
  }

  /**
   * Create and register a custom metric
   */
  @Metric({ name: 'metrics.metric-created', recordDuration: true })
  @Traced({ operationName: 'createMetric' })
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
  @Metric({ name: 'metrics.record-metric', recordDuration: true })
  @MetricsSampling({ 
    rate: 1.0,
    maxPerSecond: 1000,
    adaptiveSampling: true
  })
  @AlertThreshold({
    metric: 'record_metric_duration',
    warning: 100,
    critical: 500,
    comparison: 'gt',
  })
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
      const timestamp = Date.now();

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

      this.metricsCollected++;

      // Store in history for analysis
      this.storeMetricSnapshot(metricName, value, labels || {});

      // Check alerts
      this.checkAlerts(metricName, value, labels || {});

      // Emit event
      this.emit('metrics:collected', {
        name: metricName,
        value,
        labels: labels || {},
        timestamp,
        source: this.getServiceName(),
      });

    } catch (error) {
      logger.error(`Failed to record metric ${metricName}`, error);
      this.emit('metrics:error', {
        error: error as Error,
        operation: 'recordMetric',
        metric: metricName,
      });
    }
  }

  /**
   * Record business metric with rich metadata
   */
  @Metric({ name: 'metrics.business-metric', recordDuration: true })
  @Profiled({ includeMemory: false, sampleRate: 0.1 })
  public recordBusinessMetric(metric: Omit<BusinessMetric, 'timestamp'>): void {
    if (!this.config.businessMetrics.enabled) {
      return;
    }

    const businessMetric: BusinessMetric = {
      ...metric,
      timestamp: Date.now(),
    };

    this.businessMetrics.push(businessMetric);
    this.businessMetricsCollected++;

    // Keep only recent business metrics
    if (this.businessMetrics.length > this.config.retention.maxHistorySize) {
      this.businessMetrics = this.businessMetrics.slice(-Math.floor(this.config.retention.maxHistorySize / 2));
    }

    // Also record as regular metric
    this.recordMetric(`business.${metric.name}`, metric.value, {
      type: metric.type,
      ...metric.labels,
    });

    logger.info('Business metric recorded', businessMetric);
    this.emit('metrics:collected', {
      name: `business.${metric.name}`,
      value: metric.value,
      labels: { type: metric.type, ...metric.labels },
      timestamp: businessMetric.timestamp,
      source: 'business',
    });
  }

  /**
   * Time operation and record duration
   */
  @Metric({ name: 'metrics.time-operation', recordDuration: true })
  public async timeOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      
      this.recordMetric(`${operationName}_duration`, duration, labels);
      this.recordMetric(`${operationName}_total`, 1, { ...labels, status: 'success' });
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.recordMetric(`${operationName}_duration`, duration, labels);
      this.recordMetric(`${operationName}_total`, 1, { ...labels, status: 'error' });
      
      throw error;
    }
  }

  /**
   * Create alert rule for metric monitoring
   */
  @Metric({ name: 'metrics.alert-rule-created' })
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
  @Metric({ name: 'metrics.get-stats', recordDuration: true })
  @Cache({ ttl: 30000, maxSize: 100 })
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
  @Metric({ name: 'metrics.business-analysis', recordDuration: true })
  public getBusinessMetricsAnalysis(type?: BusinessMetric['type']) {
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

    // Calculate trends
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
  @ObservabilityMonitored({
    tracing: true,
    profiling: true,
  })
  public exportMetrics() {
    const metricsData: Record<string, MetricSnapshot[]> = {};

    for (const [name, snapshots] of this.metricHistory) {
      metricsData[name] = [...snapshots];
    }

    const allSnapshots = Array.from(this.metricHistory.values()).flat();
    const timeRange = allSnapshots.length > 0 ? {
      start: Math.min(...allSnapshots.map(s => s.timestamp)),
      end: Math.max(...allSnapshots.map(s => s.timestamp)),
    } : { start: 0, end: 0 };

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

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const activeAlerts = Array.from(this.alertStates.values())
      .filter(state => state.triggered).length;

    return {
      metricsCollected: this.metricsCollected,
      businessMetricsCollected: this.businessMetricsCollected,
      alertsTriggered: this.alertsTriggered,
      totalInstruments: this.instruments.size,
      activeAlerts,
      historySize: Array.from(this.metricHistory.values())
        .reduce((sum, snapshots) => sum + snapshots.length, 0),
      uptime,
      metricsPerSecond: this.metricsCollected / (uptime / 1000),
    };
  }

  /**
   * Private helper methods
   */

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
        port: this.config.prometheusPort,
      });
      readers.push(prometheusExporter);
    }

    // OTLP exporter (if configured)
    if (this.config.enableOTLP && this.config.otlpEndpoint) {
      // Add OTLP metric reader configuration here
      logger.info('OTLP exporter would be configured', { endpoint: this.config.otlpEndpoint });
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
      const cpuUsage = process.cpuUsage();
      const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000) * 100; // Convert to percentage
      this.recordMetric('cpu_usage', cpuPercent);
    }, this.config.exportInterval);
  }

  private setupAlerting(): void {
    if (!this.config.alerting.defaultRules) {
      return;
    }

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

  private startBackgroundTasks(): void {
    // Start periodic metric analysis
    setInterval(() => {
      this.performMetricAnalysis();
    }, this.config.alerting.evaluationInterval);

    // Cleanup old metrics
    setInterval(() => {
      this.cleanupOldMetrics();
    }, this.config.retention.cleanupInterval);
  }

  private performMetricAnalysis(): void {
    // Analyze metric trends and patterns
    for (const [metricName, snapshots] of this.metricHistory) {
      if (snapshots.length >= 10) {
        const recentValues = snapshots.slice(-10).map(s => s.value);
        const variance = this.calculateVariance(recentValues);

        if (variance > 100) { // High variance threshold
          this.emit('metrics:threshold-exceeded', {
            metric: metricName,
            value: variance,
            threshold: 100,
            severity: 'warning',
          });
        }
      }
    }
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - this.config.retention.maxAge;

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
        this.alertsTriggered++;

        this.emit('alert:triggered', {
          alertId,
          rule: rule.metricName,
          severity: rule.severity,
          message: `${rule.metricName} ${rule.condition} ${rule.threshold}`,
          labels: {
            service: this.getServiceName(),
            metric: metricName,
            ...labels,
          },
          value,
          threshold: rule.threshold,
        });

        logger.warn('Alert triggered', {
          alertId,
          metric: metricName,
          value,
          threshold: rule.threshold,
        });
      } else if (!conditionMet && alertState.triggered) {
        alertState.triggered = false;

        this.emit('alert:resolved', {
          alertId,
          rule: rule.metricName,
          duration: Date.now() - alertState.since,
          autoResolved: true,
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

  private getRecentMetricsCount(timeWindow: number): number {
    const cutoff = Date.now() - timeWindow;
    return Array.from(this.metricHistory.values())
      .flat()
      .filter(snapshot => snapshot.timestamp > cutoff)
      .length;
  }
}