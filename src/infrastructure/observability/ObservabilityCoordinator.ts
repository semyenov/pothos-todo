import { TelemetrySystem, type TelemetryConfig } from './Telemetry.js';
import { MetricsSystem, type MetricsConfig, type BusinessMetrics } from './Metrics.js';
import { AnomalyDetectionSystem, type AnomalyDetectorConfig } from './AnomalyDetection.js';
import { SLOMonitoringSystem, type SLO, type ErrorBudgetPolicy } from './SLOMonitoring.js';
import { AlertingSystem, type AlertRule, type AlertCorrelation } from './AlertingSystem.js';
import { logger } from '@/logger.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface ObservabilityConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  telemetry?: Partial<TelemetryConfig>;
  metrics?: Partial<MetricsConfig>;
  anomalyDetection?: Partial<AnomalyDetectorConfig>;
  sloMonitoring?: {
    enabled: boolean;
    evaluationInterval?: number;
  };
  alerting?: {
    enabled: boolean;
    evaluationInterval?: number;
  };
}

/**
 * Central coordinator for all observability components
 */
export class ObservabilityCoordinator extends EventEmitterSingletonService<ObservabilityCoordinator> {
  private telemetry: TelemetrySystem | null = null;
  private metrics: MetricsSystem | null = null;
  private anomalyDetection: AnomalyDetectionSystem | null = null;
  private sloMonitoring: SLOMonitoringSystem | null = null;
  private alerting: AlertingSystem | null = null;
  private config: ObservabilityConfig | null = null;
  private initialized = false;

  protected constructor() {
    super();
  }

  public async configure(config: ObservabilityConfig): Promise<void> {
    this.config = config;
    
    // Initialize systems
    this.telemetry = TelemetrySystem.initialize({
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      environment: config.environment,
      ...config.telemetry,
    });

    this.metrics = MetricsSystem.initialize({
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      environment: config.environment,
      ...config.metrics,
    });

    this.anomalyDetection = AnomalyDetectionSystem.initialize(config.anomalyDetection);
    this.sloMonitoring = SLOMonitoringSystem.getInstance();
    this.alerting = AlertingSystem.getInstance();
  }

  private ensureConfig(): ObservabilityConfig {
    if (!this.config) {
      throw new Error('ObservabilityCoordinator not configured');
    }
    return this.config;
  }

  static async initialize(config: ObservabilityConfig): Promise<ObservabilityCoordinator> {
    const instance = super.getInstance();
    if (!instance.config) {
      await instance.configure(config);
    }
    return instance;
  }

  static getInstance(): ObservabilityCoordinator {
    return super.getInstance();
  }

  /**
   * Start all observability systems
   */
  async start(): Promise<void> {
    if (this.initialized) {
      logger.warn('Observability already initialized');
      return;
    }

    logger.info('Starting observability systems...');

    // Setup default business metrics
    this.setupBusinessMetrics();

    // Setup default anomaly detection
    this.setupAnomalyDetection();

    // Setup default SLOs
    this.setupDefaultSLOs();

    // Setup default alerts
    this.setupDefaultAlerts();

    // Start monitoring systems
    this.anomalyDetection.start();
    
    if (this.config.sloMonitoring?.enabled !== false) {
      this.sloMonitoring.start(this.config.sloMonitoring?.evaluationInterval);
    }
    
    if (this.config.alerting?.enabled !== false) {
      this.alerting.start(this.config.alerting?.evaluationInterval);
    }

    this.initialized = true;
    logger.info('Observability systems started successfully');
  }

  /**
   * Setup business metrics collection
   */
  private setupBusinessMetrics(): void {
    const businessMetrics = this.metrics.getBusinessMetrics();

    // Register observable callbacks
    this.metrics.registerObservableCallback('activeTodos', async () => {
      // In real implementation, would query database
      return 0;
    });

    // Setup metric collection decorators
    logger.info('Business metrics configured');
  }

  /**
   * Setup anomaly detection for key metrics
   */
  private setupAnomalyDetection(): void {
    // API latency anomaly detection
    this.anomalyDetection.registerMetric('api_latency', {
      expectedRange: { min: 0, max: 1 }, // 1 second max
      seasonality: 'hourly',
    });

    // Error rate anomaly detection
    this.anomalyDetection.registerMetric('error_rate', {
      expectedRange: { min: 0, max: 0.01 }, // 1% error rate max
    });

    // Todo completion rate
    this.anomalyDetection.registerMetric('todo_completion_rate', {
      seasonality: 'daily',
    });

    // User activity
    this.anomalyDetection.registerMetric('user_activity', {
      seasonality: 'weekly',
    });

    logger.info('Anomaly detection configured');
  }

  /**
   * Setup default SLOs
   */
  private setupDefaultSLOs(): void {
    // API availability SLO
    const availabilitySLO: SLO = {
      id: 'api_availability',
      name: 'API Availability',
      description: 'GraphQL API should be available 99.9% of the time',
      target: 99.9,
      window: {
        type: 'rolling',
        duration: 30,
        unit: 'day',
      },
      sli: {
        type: 'availability',
        metric: 'api_health_check',
        aggregation: 'mean',
      },
      enabled: true,
      alertThresholds: {
        warning: 99.95,
        critical: 99.9,
      },
    };

    // API latency SLO
    const latencySLO: SLO = {
      id: 'api_latency',
      name: 'API Latency',
      description: '95% of requests should complete within 500ms',
      target: 95,
      window: {
        type: 'rolling',
        duration: 1,
        unit: 'hour',
      },
      sli: {
        type: 'latency',
        metric: 'api_latency',
        threshold: 0.5, // 500ms
        aggregation: 'p95',
      },
      enabled: true,
    };

    // Error rate SLO
    const errorRateSLO: SLO = {
      id: 'error_rate',
      name: 'Error Rate',
      description: 'Error rate should be below 1%',
      target: 99,
      window: {
        type: 'rolling',
        duration: 1,
        unit: 'day',
      },
      sli: {
        type: 'error_rate',
        metric: 'api_errors',
        threshold: 0.01,
        aggregation: 'mean',
      },
      enabled: true,
    };

    this.sloMonitoring.registerSLO(availabilitySLO);
    this.sloMonitoring.registerSLO(latencySLO);
    this.sloMonitoring.registerSLO(errorRateSLO);

    // Error budget policies
    const errorBudgetPolicy: ErrorBudgetPolicy = {
      id: 'api_availability_policy',
      sloId: 'api_availability',
      actions: [
        {
          threshold: 50, // 50% of error budget consumed
          action: 'alert',
          config: { severity: 'warning' },
        },
        {
          threshold: 80, // 80% of error budget consumed
          action: 'freeze_deployments',
          config: { duration: 3600 }, // 1 hour
        },
        {
          threshold: 90, // 90% of error budget consumed
          action: 'alert',
          config: { severity: 'critical' },
        },
      ],
    };

    this.sloMonitoring.registerErrorBudgetPolicy(errorBudgetPolicy);
    
    logger.info('SLOs configured');
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlerts(): void {
    // High error rate alert
    const highErrorRateAlert: AlertRule = {
      id: 'high_error_rate',
      name: 'High Error Rate',
      description: 'Error rate exceeds 5% for 5 minutes',
      enabled: true,
      conditions: [
        {
          type: 'metric',
          metric: 'api_errors',
          operator: 'gt',
          threshold: 0.05,
          duration: 300, // 5 minutes
          aggregation: 'avg',
        },
      ],
      actions: [
        { type: 'log', config: {} },
        { type: 'slack', config: { channel: '#alerts' }, severity: ['warning', 'critical'] },
      ],
      cooldownPeriod: 1800, // 30 minutes
    };

    // Anomaly correlation alert
    const anomalyCorrelation: AlertCorrelation = {
      id: 'multi_anomaly',
      pattern: 'anomaly',
      timeWindow: 300, // 5 minutes
      minAlerts: 3,
      actions: [
        { type: 'pagerduty', config: { severity: 'high' } },
      ],
    };

    this.alerting.registerRule(highErrorRateAlert);
    this.alerting.registerCorrelation(anomalyCorrelation);

    logger.info('Alert rules configured');
  }

  /**
   * Get all systems
   */
  getSystems() {
    return {
      telemetry: this.telemetry,
      metrics: this.metrics,
      anomalyDetection: this.anomalyDetection,
      sloMonitoring: this.sloMonitoring,
      alerting: this.alerting,
    };
  }

  /**
   * Create a traced function
   */
  trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.telemetry.traceAsync(name, fn);
  }

  /**
   * Record a business metric
   */
  recordMetric(
    metricName: keyof BusinessMetrics,
    value: number,
    attributes?: Record<string, any>
  ): void {
    this.metrics.record(metricName, value, attributes);
  }

  /**
   * Add data point for anomaly detection
   */
  addAnomalyDataPoint(
    metricName: string,
    value: number,
    metadata?: Record<string, any>
  ): void {
    this.anomalyDetection.addDataPoint(metricName, value, metadata);
  }

  /**
   * Record SLI measurement
   */
  recordSLI(sloId: string, value: number): void {
    this.sloMonitoring.recordSLI(sloId, value);
  }

  /**
   * Get observability dashboard data
   */
  async getDashboardData(): Promise<any> {
    const [sloStatuses, activeAlerts, anomalies] = await Promise.all([
      this.sloMonitoring.getAllSLOStatuses(),
      this.alerting.getActiveAlerts(),
      this.anomalyDetection.getAnomalyHistory({ since: new Date(Date.now() - 3600000) }),
    ]);

    return {
      slos: sloStatuses,
      alerts: {
        active: activeAlerts.length,
        bySeverity: activeAlerts.reduce((acc, alert) => {
          acc[alert.severity] = (acc[alert.severity] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      anomalies: {
        recent: anomalies.length,
        byMetric: anomalies.reduce((acc, anomaly) => {
          acc[anomaly.metric] = (acc[anomaly.metric] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      health: {
        telemetry: true,
        metrics: true,
        anomalyDetection: true,
        sloMonitoring: this.config.sloMonitoring?.enabled !== false,
        alerting: this.config.alerting?.enabled !== false,
      },
    };
  }

  /**
   * Shutdown all systems
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down observability systems...');

    this.anomalyDetection.stop();
    this.sloMonitoring.stop();
    this.alerting.stop();

    await Promise.all([
      this.telemetry.shutdown(),
      this.metrics.shutdown(),
    ]);

    this.initialized = false;
    logger.info('Observability systems shut down');
  }
}

/**
 * Express/GraphQL middleware for automatic instrumentation
 */
export function observabilityMiddleware() {
  const observability = ObservabilityCoordinator.getInstance();
  const metrics = observability.getSystems().metrics;

  return async (req: any, res: any, next: any) => {
    const startTime = Date.now();
    const span = observability.getSystems().telemetry.startSpan('http.request', {
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.target': req.path,
      },
    });

    // Instrument response
    const originalSend = res.send;
    res.send = function(data: any) {
      const duration = (Date.now() - startTime) / 1000;
      
      // Record metrics
      metrics.record('apiLatency', duration, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
      });

      if (res.statusCode >= 400) {
        metrics.record('apiErrors', 1, {
          method: req.method,
          path: req.path,
          status: res.statusCode,
        });
      }

      // Complete span
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response.size': Buffer.byteLength(data),
      });
      span.end();

      return originalSend.call(this, data);
    };

    next();
  };
}