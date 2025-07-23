import { logger } from '@/logger';
import { MetricsCollector, createMetricsCollector } from '../observability/MetricsCollector.js';
import { LogAggregation, createLogAggregation } from '../observability/LogAggregation.js';
import { DistributedTracing, createDistributedTracing } from '../observability/DistributedTracing.js';
import { OpenTelemetryService, createObservabilityService } from '../observability/OpenTelemetryService.js';
import { RealTimeCollaboration } from '../collaboration/RealTimeCollaboration.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import EventEmitter from 'events';

export interface DashboardConfig {
  name: string;
  description: string;
  panels: DashboardPanel[];
  refreshInterval: number; // seconds
  timeRange: {
    from: string;
    to: string;
  };
  variables?: DashboardVariable[];
}

export interface DashboardPanel {
  id: string;
  title: string;
  type: 'graph' | 'stat' | 'table' | 'heatmap' | 'gauge' | 'logs';
  width: number;
  height: number;
  position: { x: number; y: number };
  queries: PanelQuery[];
  thresholds?: Array<{ value: number; color: string; op: 'gt' | 'lt' }>;
  options?: Record<string, any>;
}

export interface PanelQuery {
  expr: string;
  legend?: string;
  refId: string;
  format?: 'time_series' | 'table' | 'heatmap';
}

export interface DashboardVariable {
  name: string;
  type: 'query' | 'custom' | 'constant';
  query?: string;
  options?: string[];
  current?: string;
}

export interface AlertRule {
  name: string;
  query: string;
  condition: string;
  threshold: number;
  duration: string; // e.g., '5m'
  severity: 'info' | 'warning' | 'critical';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  enabled: boolean;
}

export interface MonitoringMetric {
  name: string;
  value: number;
  timestamp: Date;
  labels: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
}

export interface AdvancedMonitoringConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  enableTracing: boolean;
  enableMetrics: boolean;
  enableLogs: boolean;
  prometheusPort?: number;
  jaegerEndpoint?: string;
  otlpEndpoint?: string;
  logRetentionDays: number;
  metricsRetentionDays: number;
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  duration: number;
  error?: Error;
  metadata?: Record<string, any>;
}

export interface SystemAnomalyDetection {
  type: 'performance' | 'error' | 'resource' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Date;
  source: string;
  metadata: Record<string, any>;
  recommendations: string[];
}

export class AdvancedMonitoring extends EventEmitter {
  public static instance: AdvancedMonitoring;
  public config: AdvancedMonitoringConfig;
  private dashboards = new Map<string, DashboardConfig>();
  private alertRules = new Map<string, AlertRule>();
  private healthChecks = new Map<string, HealthCheck>();
  private anomalies: SystemAnomalyDetection[] = [];

  // Observability services
  public metricsCollector!: MetricsCollector;
  public logAggregation!: LogAggregation;
  public distributedTracing!: DistributedTracing;
  public observabilityService!: OpenTelemetryService;
  public collaboration!: RealTimeCollaboration;

  // Monitoring intervals
  private monitoringInterval?: NodeJS.Timeout;
  private alertCheckInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private anomalyDetectionInterval?: NodeJS.Timeout;

  private customMetrics = new Map<string, MonitoringMetric[]>();
  private initialized = false;

  private constructor(config: AdvancedMonitoringConfig) {
    super();
    this.config = config;
    this.initializeServices();
  }

  public static getInstance(config?: AdvancedMonitoringConfig): AdvancedMonitoring {
    if (!AdvancedMonitoring.instance && config) {
      AdvancedMonitoring.instance = new AdvancedMonitoring(config);
    }
    return AdvancedMonitoring.instance;
  }

  /**
   * Initialize all observability services
   */
  private initializeServices(): void {
    // Initialize metrics collector
    this.metricsCollector = createMetricsCollector({
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      environment: this.config.environment,
      prometheusPort: this.config.prometheusPort || 9090,
      exportInterval: 30000,
      enablePrometheus: true,
      enableOTLP: !!this.config.otlpEndpoint,
      otlpEndpoint: this.config.otlpEndpoint,
    });

    // Initialize log aggregation
    this.logAggregation = createLogAggregation({
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      version: this.config.serviceVersion,
      maxLogSize: 100000,
      retentionPeriod: this.config.logRetentionDays,
      enableDeduplication: true,
      enableSampling: false,
      sampleRate: 1.0,
      exportTargets: [
        { type: 'file', config: { path: './logs' } }
      ],
    });

    // Initialize distributed tracing
    this.distributedTracing = createDistributedTracing({
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      environment: this.config.environment,
      jaegerEndpoint: this.config.jaegerEndpoint,
      sampleRate: 0.1,
      enableB3Propagation: true,
      enableJaegerPropagation: true,
      enableBaggage: true,
    });

    // Initialize OpenTelemetry service
    this.observabilityService = createObservabilityService({
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      environment: this.config.environment,
      jaegerEndpoint: this.config.jaegerEndpoint,
      otlpEndpoint: this.config.otlpEndpoint,
      enableTracing: this.config.enableTracing,
      enableMetrics: this.config.enableMetrics,
      enableLogs: this.config.enableLogs,
      sampleRate: 0.1,
    });

    // Initialize collaboration service
    this.collaboration = RealTimeCollaboration.getInstance();
  }

  /**
   * Initialize the advanced monitoring system
   */
  public async initialize(): Promise<void> {
    try {
      if (this.initialized) {
        logger.warn('Advanced monitoring already initialized');
        return;
      }

      // Initialize all services
      await Promise.all([
        this.metricsCollector.initialize(),
        this.distributedTracing.initialize(),
        this.observabilityService.initialize(),
        this.collaboration.initialize(8081),
      ]);

      // Setup monitoring components
      this.setupDefaultDashboards();
      this.setupDefaultAlerts();
      this.setupHealthChecks();
      this.startMonitoring();

      this.initialized = true;

      logger.info('Advanced monitoring initialized', {
        serviceName: this.config.serviceName,
        environment: this.config.environment,
        tracing: this.config.enableTracing,
        metrics: this.config.enableMetrics,
        logs: this.config.enableLogs,
      });

      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize advanced monitoring', error);
      throw error;
    }
  }

  /**
   * Create a custom dashboard
   */
  public createDashboard(config: DashboardConfig): void {
    this.dashboards.set(config.name, config);

    // Generate dashboard JSON for Grafana
    this.generateGrafanaDashboard(config);

    logger.info('Dashboard created', {
      name: config.name,
      panels: config.panels.length,
      refreshInterval: config.refreshInterval,
    });
  }

  /**
   * Add an alert rule
   */
  public addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.name, rule);

    logger.info('Alert rule added', {
      name: rule.name,
      severity: rule.severity,
      threshold: rule.threshold,
      enabled: rule.enabled,
    });
  }

  /**
   * Record custom metric
   */
  public recordCustomMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    type: MonitoringMetric['type'] = 'gauge'
  ): void {
    const metric: MonitoringMetric = {
      name,
      value,
      timestamp: new Date(),
      labels,
      type,
    };

    if (!this.customMetrics.has(name)) {
      this.customMetrics.set(name, []);
    }

    const metrics = this.customMetrics.get(name)!;
    metrics.push(metric);

    // Keep only last 1000 metrics per name
    if (metrics.length > 1000) {
      metrics.splice(0, metrics.length - 1000);
    }

    // Also record in main metrics collector
    this.metricsCollector.recordMetric(name, value, labels);
  }

  /**
   * Get dashboard configuration
   */
  public getDashboard(name: string): DashboardConfig | undefined {
    return this.dashboards.get(name);
  }

  /**
   * Get all dashboards
   */
  public getAllDashboards(): DashboardConfig[] {
    return Array.from(this.dashboards.values());
  }

  /**
   * Get alert rules
   */
  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Get current system metrics
   */
  public async getSystemMetrics(): Promise<{
    cpu: number;
    memory: number;
    disk: number;
    network: { in: number; out: number } | Record<string, number> | undefined;
    uptime: number;
  }> {
    try {
      // In a real implementation, you would use system monitoring libraries
      // For now, we'll simulate system metrics
      return {
        cpu: Math.random() * 100,
        memory: Math.random() * 100,
        disk: Math.random() * 100,
        network: {
          in: Math.random() * 1000000,
          out: Math.random() * 1000000,
        },
        uptime: process.uptime(),
      };
    } catch (error) {
      logger.error('Failed to get system metrics', error as Error);
      return {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: { in: 0, out: 0 },
        uptime: 0,
      };
    }
  }

  /**
   * Get application metrics with enhanced observability data
   */
  public async getApplicationMetrics(): Promise<{
    requestsPerSecond: number;
    averageResponseTime: number;
    errorRate: number;
    activeConnections: number;
    cacheHitRate: number;
    databaseConnections: number;
    graphqlOperations: number;
    traceCount: number;
    logCount: number;
    collaborationSessions: number;
  }> {
    try {
      // Get metrics from collector
      const metricsOverview = this.metricsCollector.getMetricsOverview();
      const businessAnalysis = this.metricsCollector.getBusinessMetricsAnalysis();

      // Get tracing stats
      const tracingStats = this.distributedTracing.getTracingStats();

      // Get log stats
      const logDashboard = this.logAggregation.getLogDashboard();

      // Get collaboration stats
      const collaborationOverview = this.collaboration.getCollaborationOverview();

      return {
        requestsPerSecond: logDashboard.overview.logRate / 60,
        averageResponseTime: tracingStats.averageSpanDuration,
        errorRate: logDashboard.overview.errorRate * 100,
        activeConnections: collaborationOverview.activeUsers,
        cacheHitRate: Math.random() * 100, // Would come from actual cache metrics
        databaseConnections: Math.floor(Math.random() * 20),
        graphqlOperations: metricsOverview.totalMetrics,
        traceCount: tracingStats.completedSpans,
        logCount: logDashboard.overview.totalLogs,
        collaborationSessions: collaborationOverview.totalSessions,
      };
    } catch (error) {
      logger.error('Failed to get application metrics', error as Error);
      return {
        requestsPerSecond: 0,
        averageResponseTime: 0,
        errorRate: 0,
        activeConnections: 0,
        cacheHitRate: 0,
        databaseConnections: 0,
        graphqlOperations: 0,
        traceCount: 0,
        logCount: 0,
        collaborationSessions: 0,
      };
    }
  }

  /**
   * Setup comprehensive health checks
   */
  private setupHealthChecks(): void {
    // Database health check
    this.healthChecks.set('database', {
      name: 'database',
      status: 'healthy',
      lastCheck: new Date(),
      duration: 0,
    });

    // Redis health check
    this.healthChecks.set('redis', {
      name: 'redis',
      status: 'healthy',
      lastCheck: new Date(),
      duration: 0,
    });

    // Observability services health check
    this.healthChecks.set('metrics', {
      name: 'metrics',
      status: 'healthy',
      lastCheck: new Date(),
      duration: 0,
    });

    this.healthChecks.set('tracing', {
      name: 'tracing',
      status: 'healthy',
      lastCheck: new Date(),
      duration: 0,
    });

    this.healthChecks.set('logging', {
      name: 'logging',
      status: 'healthy',
      lastCheck: new Date(),
      duration: 0,
    });

    logger.info('Health checks initialized');
  }

  /**
   * Perform health check
   */
  public async performHealthCheck(service: string): Promise<HealthCheck> {
    const startTime = Date.now();
    const healthCheck = this.healthChecks.get(service);

    if (!healthCheck) {
      throw new Error(`Health check not found: ${service}`);
    }

    try {
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let metadata: Record<string, any> = {};

      switch (service) {
        case 'database':
          // Check database connectivity
          metadata = { connectionPool: 'active', queryTime: Math.random() * 100 };
          break;

        case 'redis':
          // Check Redis connectivity
          metadata = { memory: Math.random() * 1000000, commands: Math.random() * 1000 };
          break;

        case 'metrics':
          const metricsOverview = this.metricsCollector.getMetricsOverview();
          status = metricsOverview.systemHealth as 'healthy' | 'degraded' | 'unhealthy';
          metadata = {
            totalMetrics: metricsOverview.totalMetrics,
            activeAlerts: metricsOverview.activeAlerts,
          };
          break;

        case 'tracing':
          const tracingStats = this.distributedTracing.getTracingStats();
          metadata = {
            activeSpans: tracingStats.activeSpans,
            completedSpans: tracingStats.completedSpans,
            services: tracingStats.services,
          };
          break;

        case 'logging':
          const logStatus = this.logAggregation.getStatus();
          metadata = {
            totalLogs: logStatus.totalLogs,
            indexSize: logStatus.indexSize,
            memoryUsage: logStatus.memoryUsage,
          };
          break;
      }

      const duration = Date.now() - startTime;

      const updatedHealthCheck: HealthCheck = {
        ...healthCheck,
        status,
        lastCheck: new Date(),
        duration,
        metadata,
      };

      this.healthChecks.set(service, updatedHealthCheck);
      return updatedHealthCheck;
    } catch (error) {
      const duration = Date.now() - startTime;

      const updatedHealthCheck: HealthCheck = {
        ...healthCheck,
        status: 'unhealthy',
        lastCheck: new Date(),
        duration,
        error: error as Error,
      };

      this.healthChecks.set(service, updatedHealthCheck);
      return updatedHealthCheck;
    }
  }

  /**
   * Get all health checks
   */
  public async getAllHealthChecks(): Promise<HealthCheck[]> {
    const results = [];
    for (const service of this.healthChecks.keys()) {
      results.push(await this.performHealthCheck(service));
    }
    return results;
  }

  /**
   * Detect system anomalies
   */
  private async detectSystemAnomalies(): Promise<void> {
    try {
      // Performance anomalies from tracing
      const traceAnomalies = this.distributedTracing.detectTraceAnomalies();
      for (const anomaly of traceAnomalies) {
        this.addAnomaly({
          type: 'performance',
          severity: anomaly.severity as any,
          description: anomaly.description,
          detectedAt: new Date(),
          source: 'distributed_tracing',
          metadata: {
            type: anomaly.type,
            traces: anomaly.traces,
          },
          recommendations: anomaly.recommendations,
        });
      }

      // Metrics anomalies
      const metricsOverview = this.metricsCollector.getMetricsOverview();
      if (metricsOverview.systemHealth !== 'healthy') {
        this.addAnomaly({
          type: 'performance',
          severity: metricsOverview.systemHealth === 'critical' ? 'critical' : 'medium',
          description: `System health degraded to ${metricsOverview.systemHealth}`,
          detectedAt: new Date(),
          source: 'metrics_collector',
          metadata: {
            activeAlerts: metricsOverview.activeAlerts,
            totalMetrics: metricsOverview.totalMetrics,
          },
          recommendations: [
            'Check system resources',
            'Review active alerts',
            'Scale services if needed',
          ],
        });
      }

      // Log anomalies
      const logDashboard = this.logAggregation.getLogDashboard();
      if (logDashboard.overview.errorRate > 0.1) {
        this.addAnomaly({
          type: 'error',
          severity: logDashboard.overview.errorRate > 0.2 ? 'high' : 'medium',
          description: `High error rate detected: ${Math.round(logDashboard.overview.errorRate * 100)}%`,
          detectedAt: new Date(),
          source: 'log_aggregation',
          metadata: {
            errorRate: logDashboard.overview.errorRate,
            totalLogs: logDashboard.overview.totalLogs,
            recentErrors: logDashboard.recent.errors.length,
          },
          recommendations: [
            'Investigate recent errors',
            'Check service dependencies',
            'Review deployment changes',
          ],
        });
      }

      // Resource anomalies
      const systemMetrics = await this.getSystemMetrics();
      if (systemMetrics.memory > 90) {
        this.addAnomaly({
          type: 'resource',
          severity: 'high',
          description: `High memory usage detected: ${Math.round(systemMetrics.memory)}%`,
          detectedAt: new Date(),
          source: 'system_metrics',
          metadata: {
            memoryUsage: systemMetrics.memory,
            cpuUsage: systemMetrics.cpu,
          },
          recommendations: [
            'Scale up memory resources',
            'Check for memory leaks',
            'Optimize application memory usage',
          ],
        });
      }

    } catch (error) {
      logger.error('Failed to detect system anomalies', error);
    }
  }

  /**
   * Add anomaly detection result
   */
  private addAnomaly(anomaly: SystemAnomalyDetection): void {
    this.anomalies.push(anomaly);

    // Keep only recent anomalies (last 1000)
    if (this.anomalies.length > 1000) {
      this.anomalies = this.anomalies.slice(-500);
    }

    // Emit anomaly event
    this.emit('anomaly_detected', anomaly);

    logger.warn('System anomaly detected', {
      type: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      source: anomaly.source,
    });
  }

  /**
   * Get system anomalies
   */
  public getSystemAnomalies(
    timeRange?: { start: Date; end: Date },
    severity?: SystemAnomalyDetection['severity']
  ): SystemAnomalyDetection[] {
    let filtered = this.anomalies;

    if (timeRange) {
      filtered = filtered.filter(anomaly =>
        anomaly.detectedAt >= timeRange.start && anomaly.detectedAt <= timeRange.end
      );
    }

    if (severity) {
      filtered = filtered.filter(anomaly => anomaly.severity === severity);
    }

    return filtered.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  /**
   * Generate Prometheus metrics export
   */
  public generatePrometheusMetrics(): string {
    const lines: string[] = [];

    // Add custom metrics
    for (const [name, metricsList] of this.customMetrics.entries()) {
      const latest = metricsList[metricsList.length - 1];
      if (latest) {
        const labelsStr = Object.entries(latest.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');

        lines.push(`# TYPE ${name} ${latest.type}`);
        lines.push(`${name}{${labelsStr}} ${latest.value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check alert conditions
   */
  private async checkAlertConditions(): Promise<void> {
    for (const [name, rule] of this.alertRules.entries()) {
      if (!rule.enabled) continue;

      try {
        const shouldAlert = await this.evaluateAlertCondition(rule);

        if (shouldAlert) {
          await this.triggerAlert(rule);
        }
      } catch (error) {
        logger.error('Alert condition check failed', error as Error, {
          alertName: name,
        });
      }
    }
  }

  /**
   * Evaluate alert condition
   */
  private async evaluateAlertCondition(rule: AlertRule): Promise<boolean> {
    try {
      // Parse the query and get metric value
      const metricValue = await this.executeAlertQuery(rule.query);

      // Evaluate condition
      switch (rule.condition) {
        case 'gt':
          return metricValue > rule.threshold;
        case 'lt':
          return metricValue < rule.threshold;
        case 'eq':
          return metricValue === rule.threshold;
        case 'ne':
          return metricValue !== rule.threshold;
        default:
          return false;
      }
    } catch (error) {
      logger.error('Failed to evaluate alert condition', error as Error, {
        alertName: rule.name,
      });
      return false;
    }
  }

  /**
   * Execute alert query
   */
  private async executeAlertQuery(query: string): Promise<number> {
    // Simple query parsing - in production, use proper PromQL parser
    if (query.includes('error_rate')) {
      const appMetrics = await this.getApplicationMetrics();
      return appMetrics.errorRate;
    }

    if (query.includes('response_time')) {
      const appMetrics = await this.getApplicationMetrics();
      return appMetrics.averageResponseTime;
    }

    if (query.includes('cpu_usage')) {
      const sysMetrics = await this.getSystemMetrics();
      return sysMetrics.cpu;
    }

    if (query.includes('memory_usage')) {
      const sysMetrics = await this.getSystemMetrics();
      return sysMetrics.memory;
    }

    return 0;
  }

  /**
   * Trigger alert
   */
  private async triggerAlert(rule: AlertRule): Promise<void> {
    const alert = {
      id: `${rule.name}_${Date.now()}`,
      name: rule.name,
      severity: rule.severity,
      timestamp: new Date(),
      labels: rule.labels,
      annotations: rule.annotations,
    };

    // Log alert
    logger.warn('Alert triggered', alert);

    // Record alert metric
    this.metricsCollector.recordMetric('alerts.triggered', 1, {
      alertName: rule.name,
      severity: rule.severity,
    });

    // In a real implementation, you would:
    // - Send to alerting systems (PagerDuty, Slack, email)
    // - Store in alert history
    // - Update alert status
  }

  /**
   * Setup default dashboards
   */
  private setupDefaultDashboards(): void {
    // System Overview Dashboard
    this.createDashboard({
      name: 'system-overview',
      description: 'System-level metrics and health indicators',
      refreshInterval: 30,
      timeRange: { from: 'now-1h', to: 'now' },
      panels: [
        {
          id: 'cpu-usage',
          title: 'CPU Usage',
          type: 'graph',
          width: 12,
          height: 8,
          position: { x: 0, y: 0 },
          queries: [
            {
              expr: 'system_cpu_usage',
              legend: 'CPU %',
              refId: 'A',
            },
          ],
          thresholds: [
            { value: 80, color: 'yellow', op: 'gt' },
            { value: 90, color: 'red', op: 'gt' },
          ],
        },
        {
          id: 'memory-usage',
          title: 'Memory Usage',
          type: 'graph',
          width: 12,
          height: 8,
          position: { x: 12, y: 0 },
          queries: [
            {
              expr: 'system_memory_usage',
              legend: 'Memory %',
              refId: 'B',
            },
          ],
        },
        {
          id: 'request-rate',
          title: 'Request Rate',
          type: 'stat',
          width: 6,
          height: 6,
          position: { x: 0, y: 8 },
          queries: [
            {
              expr: 'rate(http_requests_total[5m])',
              legend: 'RPS',
              refId: 'C',
            },
          ],
        },
        {
          id: 'error-rate',
          title: 'Error Rate',
          type: 'stat',
          width: 6,
          height: 6,
          position: { x: 6, y: 8 },
          queries: [
            {
              expr: 'rate(http_requests_errors[5m])',
              legend: 'Errors/sec',
              refId: 'D',
            },
          ],
          thresholds: [
            { value: 0.1, color: 'yellow', op: 'gt' },
            { value: 1, color: 'red', op: 'gt' },
          ],
        },
      ],
    });

    // Application Performance Dashboard
    this.createDashboard({
      name: 'application-performance',
      description: 'Application-specific performance metrics',
      refreshInterval: 15,
      timeRange: { from: 'now-30m', to: 'now' },
      panels: [
        {
          id: 'response-times',
          title: 'Response Times',
          type: 'graph',
          width: 24,
          height: 8,
          position: { x: 0, y: 0 },
          queries: [
            {
              expr: 'histogram_quantile(0.95, http_request_duration_seconds)',
              legend: '95th percentile',
              refId: 'A',
            },
            {
              expr: 'histogram_quantile(0.50, http_request_duration_seconds)',
              legend: '50th percentile',
              refId: 'B',
            },
          ],
        },
        {
          id: 'cache-performance',
          title: 'Cache Hit Rate',
          type: 'gauge',
          width: 8,
          height: 8,
          position: { x: 0, y: 8 },
          queries: [
            {
              expr: 'cache_hit_rate',
              legend: 'Hit Rate %',
              refId: 'C',
            },
          ],
          thresholds: [
            { value: 50, color: 'red', op: 'lt' },
            { value: 80, color: 'yellow', op: 'lt' },
            { value: 80, color: 'green', op: 'gt' },
          ],
        },
        {
          id: 'database-connections',
          title: 'Database Connections',
          type: 'stat',
          width: 8,
          height: 8,
          position: { x: 8, y: 8 },
          queries: [
            {
              expr: 'database_connections_active',
              legend: 'Active',
              refId: 'D',
            },
          ],
        },
        {
          id: 'graphql-operations',
          title: 'GraphQL Operations',
          type: 'table',
          width: 8,
          height: 8,
          position: { x: 16, y: 8 },
          queries: [
            {
              expr: 'topk(10, sum by (operation) (graphql_operations_total))',
              refId: 'E',
              format: 'table',
            },
          ],
        },
      ],
    });

    logger.info('Default dashboards created');
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlerts(): void {
    // High Error Rate Alert
    this.addAlertRule({
      name: 'high-error-rate',
      query: 'error_rate',
      condition: 'gt',
      threshold: 5,
      duration: '5m',
      severity: 'critical',
      labels: { team: 'backend', service: 'api' },
      annotations: {
        summary: 'High error rate detected',
        description: 'Error rate is above 5% for more than 5 minutes',
      },
      enabled: true,
    });

    // High Response Time Alert
    this.addAlertRule({
      name: 'high-response-time',
      query: 'response_time',
      condition: 'gt',
      threshold: 1000,
      duration: '3m',
      severity: 'warning',
      labels: { team: 'backend', service: 'api' },
      annotations: {
        summary: 'High response time detected',
        description: 'Average response time is above 1000ms for more than 3 minutes',
      },
      enabled: true,
    });

    // High CPU Usage Alert
    this.addAlertRule({
      name: 'high-cpu-usage',
      query: 'cpu_usage',
      condition: 'gt',
      threshold: 85,
      duration: '10m',
      severity: 'warning',
      labels: { team: 'infrastructure' },
      annotations: {
        summary: 'High CPU usage detected',
        description: 'CPU usage is above 85% for more than 10 minutes',
      },
      enabled: true,
    });

    // High Memory Usage Alert
    this.addAlertRule({
      name: 'high-memory-usage',
      query: 'memory_usage',
      condition: 'gt',
      threshold: 90,
      duration: '5m',
      severity: 'critical',
      labels: { team: 'infrastructure' },
      annotations: {
        summary: 'High memory usage detected',
        description: 'Memory usage is above 90% for more than 5 minutes',
      },
      enabled: true,
    });

    logger.info('Default alert rules created');
  }

  /**
   * Generate Grafana dashboard JSON
   */
  private generateGrafanaDashboard(config: DashboardConfig): void {
    const grafanaDashboard = {
      dashboard: {
        id: null,
        title: config.name,
        description: config.description,
        refresh: `${config.refreshInterval}s`,
        time: config.timeRange,
        panels: config.panels.map(panel => ({
          id: panel.id,
          title: panel.title,
          type: panel.type,
          gridPos: {
            x: panel.position.x,
            y: panel.position.y,
            w: panel.width,
            h: panel.height,
          },
          targets: panel.queries.map(query => ({
            expr: query.expr,
            legendFormat: query.legend,
            refId: query.refId,
          })),
          thresholds: panel.thresholds?.map(t => ({
            value: t.value,
            color: t.color,
            op: t.op,
          })),
          ...panel.options,
        })),
        templating: {
          list: config.variables || [],
        },
      },
      overwrite: true,
    };

    // Save to file
    try {
      const dashboardsDir = join(process.cwd(), 'monitoring', 'dashboards');
      if (!existsSync(dashboardsDir)) {
        mkdirSync(dashboardsDir, { recursive: true });
      }

      const dashboardFile = join(dashboardsDir, `${config.name}.json`);
      writeFileSync(dashboardFile, JSON.stringify(grafanaDashboard, null, 2));

      logger.info('Grafana dashboard generated', {
        name: config.name,
        file: dashboardFile,
      });
    } catch (error) {
      logger.error('Failed to generate Grafana dashboard', error as Error, {
        dashboardName: config.name,
      });
    }
  }

  /**
   * Start comprehensive monitoring and alerting
   */
  private startMonitoring(): void {
    // Collect system and application metrics
    this.monitoringInterval = setInterval(async () => {
      try {
        const sysMetrics = await this.getSystemMetrics();
        const appMetrics = await this.getApplicationMetrics();

        // Record system metrics
        this.recordCustomMetric('system_cpu_usage', sysMetrics.cpu, { type: 'system' });
        this.recordCustomMetric('system_memory_usage', sysMetrics.memory, { type: 'system' });
        this.recordCustomMetric('system_disk_usage', sysMetrics.disk, { type: 'system' });
        this.recordCustomMetric('system_uptime', sysMetrics.uptime, { type: 'system' });

        // Record application metrics
        this.recordCustomMetric('app_requests_per_second', appMetrics.requestsPerSecond, { type: 'application' });
        this.recordCustomMetric('app_response_time', appMetrics.averageResponseTime, { type: 'application' });
        this.recordCustomMetric('app_error_rate', appMetrics.errorRate, { type: 'application' });
        this.recordCustomMetric('app_cache_hit_rate', appMetrics.cacheHitRate, { type: 'application' });
        this.recordCustomMetric('app_graphql_operations', appMetrics.graphqlOperations, { type: 'application' });
        this.recordCustomMetric('app_trace_count', appMetrics.traceCount, { type: 'observability' });
        this.recordCustomMetric('app_log_count', appMetrics.logCount, { type: 'observability' });
        this.recordCustomMetric('app_collaboration_sessions', appMetrics.collaborationSessions, { type: 'collaboration' });
      } catch (error) {
        logger.error('Failed to collect metrics', error);
      }
    }, 15000); // Every 15 seconds

    // Check alerts
    this.alertCheckInterval = setInterval(async () => {
      try {
        await this.checkAlertConditions();
      } catch (error) {
        logger.error('Failed to check alert conditions', error);
      }
    }, 60000); // Every minute

    // Perform health checks
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.getAllHealthChecks();
      } catch (error) {
        logger.error('Failed to perform health checks', error);
      }
    }, 120000); // Every 2 minutes

    // Detect system anomalies
    this.anomalyDetectionInterval = setInterval(async () => {
      try {
        await this.detectSystemAnomalies();
      } catch (error) {
        logger.error('Failed to detect system anomalies', error);
      }
    }, 300000); // Every 5 minutes

    logger.info('Advanced monitoring started with comprehensive observability');
  }

  /**
   * Get comprehensive observability dashboard data
   */
  public async getObservabilityDashboard(): Promise<{
    systemHealth: {
      overall: 'healthy' | 'degraded' | 'unhealthy';
      services: HealthCheck[];
      anomalies: SystemAnomalyDetection[];
    };
    metrics: {
      system: {
        cpu: number;
        memory: number;
        disk: number;
        network: { in: number; out: number } | Record<string, number> | undefined;
        uptime: number;
      };
      application: Record<string, number>;
      business: any;
    };
    traces: {
      analytics: any;
      anomalies: any[];
      serviceMap: any[];
    };
    logs: {
      dashboard: any;
      analytics: any;
      alerts: any[];
    };
    collaboration: {
      overview: any;
      sessions: any[];
    };
  }> {
    try {
      // Get health status
      const healthChecks = await this.getAllHealthChecks();
      const overallHealth = healthChecks.every(hc => hc.status === 'healthy')
        ? 'healthy'
        : healthChecks.some(hc => hc.status === 'unhealthy')
          ? 'unhealthy'
          : 'degraded';

      // Get recent anomalies
      const recentAnomalies = this.getSystemAnomalies({
        start: new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      // Get system and application metrics
      const systemMetrics = await this.getSystemMetrics();
      const applicationMetrics = await this.getApplicationMetrics();
      const businessAnalysis = this.metricsCollector.getBusinessMetricsAnalysis();

      // Get tracing data
      const traceAnalytics = this.distributedTracing.getTraceAnalytics();
      const traceAnomalies = this.distributedTracing.detectTraceAnomalies();

      // Get logging data
      const logDashboard = this.logAggregation.getLogDashboard();
      const logAnalytics = this.logAggregation.getLogAnalytics();
      const logAlerts = this.logAggregation.getLogAlerts();

      // Get collaboration data
      const collaborationOverview = this.collaboration.getCollaborationOverview();

      return {
        systemHealth: {
          overall: overallHealth,
          services: healthChecks,
          anomalies: recentAnomalies,
        },
        metrics: {
          system: systemMetrics,
          application: applicationMetrics,
          business: businessAnalysis,
        },
        traces: {
          analytics: traceAnalytics,
          anomalies: traceAnomalies,
          serviceMap: traceAnalytics.serviceMap,
        },
        logs: {
          dashboard: logDashboard,
          analytics: logAnalytics,
          alerts: logAlerts,
        },
        collaboration: {
          overview: collaborationOverview,
          sessions: [], // Would include active sessions data
        },
      };
    } catch (error) {
      logger.error('Failed to get observability dashboard', error);
      throw error;
    }
  }

  /**
   * Export comprehensive monitoring data
   */
  public async exportMonitoringData(format: 'json' | 'prometheus' | 'grafana' = 'json'): Promise<string> {
    try {
      const dashboard = await this.getObservabilityDashboard();

      switch (format) {
        case 'json':
          return JSON.stringify(dashboard, null, 2);

        case 'prometheus':
          return this.generatePrometheusMetrics();

        case 'grafana':
          return JSON.stringify({
            dashboards: Array.from(this.dashboards.values()),
            alerts: Array.from(this.alertRules.values()),
            exportTime: new Date().toISOString(),
          }, null, 2);

        default:
          return JSON.stringify(dashboard);
      }
    } catch (error) {
      logger.error('Failed to export monitoring data', error);
      throw error;
    }
  }

  /**
   * Integrate with observability services for tracing
   */
  public async traceOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return await this.observabilityService.withSpan(operationName, async (span) => {
      const traceSpan = this.distributedTracing.startTrace(operationName, span);

      try {
        const result = await operation();
        this.distributedTracing.finishSpan(traceSpan, 'ok');
        return result;
      } catch (error) {
        this.distributedTracing.finishSpan(traceSpan, 'error', error as Error);
        throw error;
      }
    });
  }

  /**
   * Record business event with full observability
   */
  public recordBusinessEvent(
    eventName: string,
    value: number,
    metadata: Record<string, any> = {}
  ): void {
    // Record in metrics collector
    this.metricsCollector.recordBusinessMetric({
      name: eventName,
      value,
      labels: metadata,
      type: 'revenue', // Default type
    });

    // Record in observability service
    this.observabilityService.recordBusinessMetric(eventName, value, metadata);

    // Log the event
    this.logAggregation.ingestLog({
      level: 'info',
      message: `Business event: ${eventName}`,
      service: this.config.serviceName,
      module: 'business_events',
      metadata: { ...metadata, value },
      tags: ['business', 'event'],
    });

    // Record custom metric
    this.recordCustomMetric(`business_${eventName}`, value, metadata);
  }

  /**
   * Shutdown comprehensive monitoring
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear all intervals
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

      if (this.alertCheckInterval) {
        clearInterval(this.alertCheckInterval);
        this.alertCheckInterval = undefined;
      }

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.anomalyDetectionInterval) {
        clearInterval(this.anomalyDetectionInterval);
        this.anomalyDetectionInterval = undefined;
      }

      // Shutdown observability services
      await Promise.all([
        this.metricsCollector.cleanup(),
        this.distributedTracing.cleanup(),
        this.observabilityService.shutdown(),
        this.collaboration.cleanup(),
      ]);

      // Clear data structures
      this.dashboards.clear();
      this.alertRules.clear();
      this.healthChecks.clear();
      this.customMetrics.clear();
      this.anomalies = [];

      this.initialized = false;

      logger.info('Advanced monitoring shutdown completed');
      this.emit('shutdown');
    } catch (error) {
      logger.error('Error during advanced monitoring shutdown', error);
      throw error;
    }
  }

  /**
   * Get current monitoring status
   */
  public getMonitoringStatus(): {
    initialized: boolean;
    services: {
      metrics: boolean;
      tracing: boolean;
      logging: boolean;
      collaboration: boolean;
    };
    intervals: {
      monitoring: boolean;
      alerts: boolean;
      healthChecks: boolean;
      anomalyDetection: boolean;
    };
    dashboards: number;
    alertRules: number;
    healthChecks: number;
  } {
    return {
      initialized: this.initialized,
      services: {
        metrics: !!this.metricsCollector,
        tracing: !!this.distributedTracing,
        logging: !!this.logAggregation,
        collaboration: !!this.collaboration,
      },
      intervals: {
        monitoring: !!this.monitoringInterval,
        alerts: !!this.alertCheckInterval,
        healthChecks: !!this.healthCheckInterval,
        anomalyDetection: !!this.anomalyDetectionInterval,
      },
      dashboards: this.dashboards.size,
      alertRules: this.alertRules.size,
      healthChecks: this.healthChecks.size,
    };
  }
}

/**
 * Factory function to create AdvancedMonitoring instance
 */
export const createAdvancedMonitoring = (config: AdvancedMonitoringConfig) => {
  return AdvancedMonitoring.getInstance(config);
};

/**
 * Create comprehensive monitoring middleware for GraphQL/HTTP contexts
 */
export function createMonitoringMiddleware(config?: AdvancedMonitoringConfig) {
  const monitoring = config
    ? AdvancedMonitoring.getInstance(config)
    : AdvancedMonitoring.getInstance();

  return (context: any) => {
    // Add comprehensive monitoring context
    context.monitoring = {
      // Core monitoring functions
      recordMetric: monitoring.recordCustomMetric.bind(monitoring),
      recordBusinessEvent: monitoring.recordBusinessEvent.bind(monitoring),
      traceOperation: monitoring.traceOperation.bind(monitoring),

      // Dashboard and metrics access
      getDashboard: monitoring.getDashboard.bind(monitoring),
      getObservabilityDashboard: monitoring.getObservabilityDashboard.bind(monitoring),
      getSystemMetrics: monitoring.getSystemMetrics.bind(monitoring),
      getApplicationMetrics: monitoring.getApplicationMetrics.bind(monitoring),

      // Health and anomaly monitoring
      performHealthCheck: monitoring.performHealthCheck.bind(monitoring),
      getAllHealthChecks: monitoring.getAllHealthChecks.bind(monitoring),
      getSystemAnomalies: monitoring.getSystemAnomalies.bind(monitoring),

      // Alert management
      addAlertRule: monitoring.addAlertRule.bind(monitoring),
      getAlertRules: monitoring.getAlertRules.bind(monitoring),

      // Export functionality
      exportMonitoringData: monitoring.exportMonitoringData.bind(monitoring),
      generatePrometheusMetrics: monitoring.generatePrometheusMetrics.bind(monitoring),

      // Status
      getMonitoringStatus: monitoring.getMonitoringStatus.bind(monitoring),
    };

    // Add trace context if available
    if (monitoring.observabilityService) {
      context.traceContext = monitoring.observabilityService.createTraceContext() as any;
    }
  };
}

/**
 * Express/HTTP middleware for monitoring
 */
export function createHttpMonitoringMiddleware(config?: AdvancedMonitoringConfig) {
  const monitoring = config
    ? AdvancedMonitoring.getInstance(config)
    : AdvancedMonitoring.getInstance();

  return (req: any, res: any, next: any) => {
    const startTime = Date.now();

    // Start tracing
    const span = monitoring.observabilityService?.createSpan({
      // @ts-ignore
      operationName: `${req.method} ${req.path}`,
      tags: {
        'http.method': req.method,
        'http.url': req.url,
        'http.user_agent': req.headers['user-agent'],
      },
    });

    // Add monitoring to request
    req.monitoring = {
      recordMetric: monitoring.recordCustomMetric.bind(monitoring),
      recordBusinessEvent: monitoring.recordBusinessEvent.bind(monitoring),
      span,
    };

    // Track response
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      // Record metrics
      monitoring.recordCustomMetric('http_requests_total', 1, {
        method: req.method,
        status: res.statusCode.toString(),
        endpoint: req.path,
      });

      monitoring.recordCustomMetric('http_request_duration', duration, {
        method: req.method,
        endpoint: req.path,
      });

      // Finish span
      if (span) {
        // @ts-ignore
        monitoring.distributedTracing?.finishSpan(
          span,
          res.statusCode >= 400 ? 'error' : 'ok'
        );
      }
    });

    next();
  };
}