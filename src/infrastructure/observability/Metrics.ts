import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
  View,
  Aggregation,
} from '@opentelemetry/sdk-metrics';
import {
  metrics,
  ValueType,
  Counter,
  Histogram,
  ObservableGauge,
  Meter,
} from '@opentelemetry/api';
import * as resources from '@opentelemetry/resources';
const Resource = resources.Resource || resources.default?.Resource;
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { logger } from '@/logger.js';
import { SingletonService } from '../core/SingletonService.js';

export interface MetricsConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  exportInterval?: number;
  enablePrometheus?: boolean;
  prometheusPort?: number;
}

export interface BusinessMetrics {
  todosCreated: Counter;
  todosCompleted: Counter;
  todosDeleted: Counter;
  activeTodos: ObservableGauge;
  todoCompletionTime: Histogram;
  userActivity: Histogram;
  apiLatency: Histogram;
  apiErrors: Counter;
  cacheHits: Counter;
  cacheMisses: Counter;
}

/**
 * Advanced Metrics System with custom business metrics
 */
export class MetricsSystem extends SingletonService<MetricsSystem> {
  private meterProvider: MeterProvider | null = null;
  private meter: Meter | null = null;
  private config: MetricsConfig | null = null;
  private businessMetrics: BusinessMetrics | null = null;
  private customMetrics: Map<string, any> = new Map();

  protected constructor() {
    super();
  }

  public configure(config: MetricsConfig): void {
    this.config = {
      exportInterval: 10000, // 10 seconds
      enablePrometheus: true,
      prometheusPort: 9090,
      ...config,
    };

    this.meterProvider = this.initializeMeterProvider();
    this.meter = metrics.getMeter(
      this.config.serviceName,
      this.config.serviceVersion
    );
    this.businessMetrics = this.createBusinessMetrics();
  }

  static initialize(config: MetricsConfig): MetricsSystem {
    const instance = super.getInstance();
    instance.configure(config);
    return instance;
  }

  static async getInstance(): Promise<MetricsSystem> {
    return super.getInstance();
  }

  private ensureConfig(): MetricsConfig {
    if (!this.config) {
      throw new Error('MetricsSystem not configured');
    }
    return this.config;
  }

  private ensureMeter(): Meter {
    if (!this.meter) {
      throw new Error('MetricsSystem meter not initialized');
    }
    return this.meter;
  }

  private ensureBusinessMetrics(): BusinessMetrics {
    if (!this.businessMetrics) {
      throw new Error('MetricsSystem business metrics not initialized');
    }
    return this.businessMetrics;
  }

  private initializeMeterProvider(): MeterProvider {
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: this.config!.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: this.config!.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config!.environment,
    });

    const meterProvider = new MeterProvider({
      resource,
      views: [
        // Custom view for histogram buckets
        new View({
          instrumentName: 'todo_completion_time',
          aggregation: Aggregation.ExplicitBucketHistogram([
            0, 1, 5, 10, 30, 60, 300, 600, 1800, 3600,
          ]),
        }),
        new View({
          instrumentName: 'api_latency',
          aggregation: Aggregation.ExplicitBucketHistogram([
            0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5,
          ]),
        }),
      ],
    });

    // Add Prometheus exporter
    if (this.config!.enablePrometheus) {
      const prometheusExporter = new PrometheusExporter(
        {
          port: this.config!.prometheusPort,
          endpoint: '/metrics',
        },
        () => {
          logger.info(`Prometheus metrics server started on port ${this.config!.prometheusPort}`);
        }
      );
      meterProvider.addMetricReader(prometheusExporter);
    }

    // Add console exporter for debugging
    if (process.env.NODE_ENV === 'development') {
      meterProvider.addMetricReader(
        new PeriodicExportingMetricReader({
          exporter: new ConsoleMetricExporter(),
          exportIntervalMillis: this.config!.exportInterval,
        })
      );
    }

    metrics.setGlobalMeterProvider(meterProvider);
    return meterProvider;
  }

  private createBusinessMetrics(): BusinessMetrics {
    const meter = this.ensureMeter();
    return {
      todosCreated: meter.createCounter('todos_created_total', {
        description: 'Total number of todos created',
        valueType: ValueType.INT,
      }),

      todosCompleted: meter.createCounter('todos_completed_total', {
        description: 'Total number of todos completed',
        valueType: ValueType.INT,
      }),

      todosDeleted: meter.createCounter('todos_deleted_total', {
        description: 'Total number of todos deleted',
        valueType: ValueType.INT,
      }),

      activeTodos: meter.createObservableGauge('active_todos', {
        description: 'Current number of active todos',
        valueType: ValueType.INT,
      }),

      todoCompletionTime: meter.createHistogram('todo_completion_time', {
        description: 'Time taken to complete todos in seconds',
        unit: 's',
        valueType: ValueType.DOUBLE,
      }),

      userActivity: meter.createHistogram('user_activity_score', {
        description: 'User activity score based on actions',
        valueType: ValueType.DOUBLE,
      }),

      apiLatency: meter.createHistogram('api_latency', {
        description: 'API request latency in seconds',
        unit: 's',
        valueType: ValueType.DOUBLE,
      }),

      apiErrors: meter.createCounter('api_errors_total', {
        description: 'Total number of API errors',
        valueType: ValueType.INT,
      }),

      cacheHits: meter.createCounter('cache_hits_total', {
        description: 'Total number of cache hits',
        valueType: ValueType.INT,
      }),

      cacheMisses: meter.createCounter('cache_misses_total', {
        description: 'Total number of cache misses',
        valueType: ValueType.INT,
      }),
    };
  }

  /**
   * Register a callback for observable metrics
   */
  registerObservableCallback(
    metricName: keyof BusinessMetrics,
    callback: () => number | Promise<number>
  ): void {
    const businessMetrics = this.ensureBusinessMetrics();
    const metric = businessMetrics[metricName];
    if (metric && 'addCallback' in metric) {
      metric.addCallback(async (observableResult) => {
        const value = await callback();
        observableResult.observe(value);
      });
    }
  }

  /**
   * Record a metric value
   */
  record(
    metricName: keyof BusinessMetrics,
    value: number,
    attributes?: Record<string, any>
  ): void {
    const businessMetrics = this.ensureBusinessMetrics();
    const metric = businessMetrics[metricName];
    if (!metric) {
      logger.warn(`Metric ${metricName} not found`);
      return;
    }

    if ('add' in metric) {
      metric.add(value, attributes);
    } else if ('record' in metric) {
      metric.record(value, attributes);
    }
  }

  /**
   * Create a custom metric
   */
  createCustomMetric(
    name: string,
    type: 'counter' | 'histogram' | 'gauge',
    options: {
      description?: string;
      unit?: string;
      valueType?: ValueType;
    } = {}
  ) {
    let metric;

    switch (type) {
      case 'counter':
        metric = this.ensureMeter().createCounter(name, options);
        break;
      case 'histogram':
        metric = this.ensureMeter().createHistogram(name, options);
        break;
      case 'gauge':
        metric = this.ensureMeter().createObservableGauge(name, options);
        break;
    }

    this.customMetrics.set(name, metric);
    return metric;
  }

  /**
   * Get business metrics
   */
  getBusinessMetrics(): BusinessMetrics {
    return this.ensureBusinessMetrics();
  }

  /**
   * Calculate and record SLI metrics
   */
  recordSLI(sliType: 'availability' | 'latency' | 'error_rate', value: number): void {
    const sliMetric = this.customMetrics.get(`sli_${sliType}`) ||
      this.createCustomMetric(`sli_${sliType}`, 'histogram', {
        description: `Service Level Indicator for ${sliType}`,
        valueType: ValueType.DOUBLE,
      });

    if ('record' in sliMetric) {
      sliMetric.record(value, { sli_type: sliType });
    }
  }

  /**
   * Export metrics snapshot
   */
  async exportSnapshot(): Promise<any> {
    // Implementation for exporting current metric values
    return {
      timestamp: new Date(),
      metrics: {
        // Collect current metric values
      },
    };
  }

  /**
   * Shutdown metrics system
   */
  async shutdown(): Promise<void> {
    await this.meterProvider.shutdown();
    logger.info('Metrics system shut down');
  }
}

/**
 * Decorator for method metrics
 */
export function Metric(metricName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = metricName || `${target.constructor.name}_${propertyKey}_duration`;

    descriptor.value = async function (...args: any[]) {
      const metrics = MetricsSystem.getInstance();
      const histogram = metrics.createCustomMetric(name, 'histogram', {
        description: `Duration of ${propertyKey} method`,
        unit: 's',
      });

      const startTime = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = (Date.now() - startTime) / 1000;

        if ('record' in histogram) {
          histogram.record(duration, {
            method: propertyKey,
            success: true,
          });
        }

        return result;
      } catch (error) {
        const duration = (Date.now() - startTime) / 1000;

        if ('record' in histogram) {
          histogram.record(duration, {
            method: propertyKey,
            success: false,
            error: error instanceof Error ? error.name : 'unknown',
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}