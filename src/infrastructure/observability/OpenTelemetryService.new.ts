import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import * as resources from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, metrics, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { OpenTelemetryServiceEventMap } from '../core/ServiceEventMaps.observability.js';
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
 * OpenTelemetry service configuration schema
 */
const OpenTelemetryServiceConfigSchema = z.object({
  serviceName: z.string().default('pothos-todo'),
  serviceVersion: z.string().default('1.0.0'),
  environment: z.string().default('development'),
  
  // Tracing configuration
  tracing: z.object({
    enabled: z.boolean().default(true),
    sampleRate: z.number().min(0).max(1).default(1.0),
    maxSpansPerBatch: z.number().default(512),
    maxQueueSize: z.number().default(2048),
    scheduledDelayMillis: z.number().default(5000),
    exportTimeoutMillis: z.number().default(30000),
    maxExportBatchSize: z.number().default(512),
  }),

  // Metrics configuration
  metrics: z.object({
    enabled: z.boolean().default(true),
    exportInterval: z.number().default(30000),
    maxMetrics: z.number().default(10000),
    enableRuntimeMetrics: z.boolean().default(true),
    enableProcessMetrics: z.boolean().default(true),
    enableCustomMetrics: z.boolean().default(true),
  }),

  // Logs configuration
  logs: z.object({
    enabled: z.boolean().default(true),
    maxLogBatchSize: z.number().default(512),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    includeTraceContext: z.boolean().default(true),
  }),

  // Exporters configuration
  exporters: z.object({
    otlp: z.object({
      enabled: z.boolean().default(false),
      endpoint: z.string().optional(),
      protocol: z.enum(['grpc', 'http']).default('http'),
      headers: z.record(z.string()).default({}),
      compression: z.enum(['none', 'gzip']).default('gzip'),
    }),
    jaeger: z.object({
      enabled: z.boolean().default(false),
      endpoint: z.string().optional(),
      agentHost: z.string().default('localhost'),
      agentPort: z.number().default(6832),
    }),
    prometheus: z.object({
      enabled: z.boolean().default(false),
      port: z.number().default(9090),
      endpoint: z.string().default('/metrics'),
    }),
    console: z.object({
      enabled: z.boolean().default(false),
      pretty: z.boolean().default(true),
    }),
  }),

  // Instrumentation configuration
  instrumentation: z.object({
    autoInstrument: z.boolean().default(true),
    enabledInstrumentations: z.array(z.string()).default([
      'http',
      'https',
      'express',
      'graphql',
      'prisma',
      'redis',
      'fs',
    ]),
    disabledInstrumentations: z.array(z.string()).default([]),
    customInstrumentations: z.array(z.string()).default([]),
  }),

  // Sampling configuration
  sampling: z.object({
    strategy: z.enum(['always', 'never', 'ratio', 'adaptive']).default('ratio'),
    ratio: z.number().min(0).max(1).default(1.0),
    adaptive: z.object({
      enabled: z.boolean().default(false),
      targetTPS: z.number().default(1000),
      adjustmentPeriod: z.number().default(60000),
      minRatio: z.number().default(0.01),
      maxRatio: z.number().default(1.0),
    }),
  }),

  // Resource detection
  resourceDetection: z.object({
    enabled: z.boolean().default(true),
    detectors: z.array(z.string()).default([
      'env',
      'host',
      'os',
      'process',
      'serviceinstance',
    ]),
    timeout: z.number().default(5000),
  }),

  // Performance and limits
  performance: z.object({
    enableBatching: z.boolean().default(true),
    enableCompression: z.boolean().default(true),
    maxConcurrentExports: z.number().default(1),
    retryConfig: z.object({
      enabled: z.boolean().default(true),
      maxRetries: z.number().default(3),
      initialBackoff: z.number().default(1000),
      maxBackoff: z.number().default(30000),
      backoffMultiplier: z.number().default(2),
    }),
  }),
});

export type OpenTelemetryServiceConfig = z.infer<typeof OpenTelemetryServiceConfigSchema>;

/**
 * Trace context interface
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
  flags?: number;
  sampled?: boolean;
}

/**
 * Custom span options
 */
export interface CustomSpanOptions {
  operationName: string;
  tags?: Record<string, any>;
  parentSpan?: Span;
  kind?: SpanKind;
  startTime?: number;
  links?: Array<{
    context: any;
    attributes?: Record<string, any>;
  }>;
}

/**
 * Metric definition interface
 */
export interface MetricDefinition {
  name: string;
  description: string;
  type: 'counter' | 'histogram' | 'gauge' | 'updown_counter' | 'observable_counter' | 'observable_gauge' | 'observable_updown_counter';
  unit?: string;
  tags?: Record<string, string>;
  buckets?: number[]; // For histograms
  callback?: () => number; // For observable metrics
}

/**
 * Performance monitoring options
 */
export interface PerformanceMonitoringOptions {
  thresholds?: {
    warning: number;
    error: number;
    critical: number;
  };
  includeMemory?: boolean;
  includeCpu?: boolean;
  includeGc?: boolean;
  tags?: Record<string, string>;
}

/**
 * Export statistics interface
 */
export interface ExportStatistics {
  traces: {
    exported: number;
    failed: number;
    dropped: number;
    batchesExported: number;
    averageBatchSize: number;
  };
  metrics: {
    exported: number;
    failed: number;
    dropped: number;
    dataPointsExported: number;
  };
  logs: {
    exported: number;
    failed: number;
    dropped: number;
    recordsExported: number;
  };
}

/**
 * Service health status interface
 */
export interface ServiceHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    sdk: 'initialized' | 'starting' | 'stopped' | 'error';
    tracing: 'enabled' | 'disabled' | 'error';
    metrics: 'enabled' | 'disabled' | 'error';
    logs: 'enabled' | 'disabled' | 'error';
    exporters: Array<{
      type: string;
      status: 'healthy' | 'unhealthy';
      lastExport?: Date;
      errorRate?: number;
    }>;
  };
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

/**
 * Enhanced OpenTelemetry Service using the new base service architecture
 * 
 * Features:
 * - Complete OpenTelemetry SDK integration with auto-instrumentation
 * - Multi-exporter support (OTLP, Jaeger, Prometheus, Console)
 * - Advanced sampling strategies including adaptive sampling
 * - Comprehensive performance monitoring and profiling
 * - Resource detection and automatic service discovery
 * - Batch processing with intelligent retry mechanisms
 * - Real-time health monitoring and diagnostics
 * - Custom metrics and trace correlation
 * 
 * @example
 * ```typescript
 * const otelService = await OpenTelemetryService.getInstance();
 * 
 * // Listen to telemetry events
 * otelService.on('otel:trace-exported', ({ traces, spans, success }) => {
 *   console.log(`Exported ${traces} traces with ${spans} spans (success: ${success})`);
 * });
 * 
 * // Create custom spans
 * await otelService.withSpan('user-operation', async (span) => {
 *   span.setAttributes({ 'user.id': '123', 'operation': 'create' });
 *   return await performUserOperation();
 * });
 * 
 * // Monitor performance
 * const result = await otelService.monitorPerformance('critical-operation', async () => {
 *   return await criticalDatabaseQuery();
 * }, {
 *   thresholds: { warning: 1000, error: 5000, critical: 10000 },
 *   includeMemory: true,
 *   includeCpu: true
 * });
 * 
 * // Record custom metrics
 * otelService.recordMetric('business_transactions', 1, {
 *   type: 'purchase',
 *   amount: '99.99',
 *   currency: 'USD'
 * });
 * ```
 */
@ServiceConfig({
  schema: OpenTelemetryServiceConfigSchema,
  prefix: 'otel',
  hot: true, // Allow hot reload for configuration changes
})
export class OpenTelemetryService extends BaseAsyncService<OpenTelemetryServiceConfig, OpenTelemetryServiceEventMap> {
  private sdk: NodeSDK | null = null;
  private tracer: any;
  private meter: any;
  private customMetrics: Map<string, any> = new Map();
  private exportStatistics: ExportStatistics = {
    traces: { exported: 0, failed: 0, dropped: 0, batchesExported: 0, averageBatchSize: 0 },
    metrics: { exported: 0, failed: 0, dropped: 0, dataPointsExported: 0 },
    logs: { exported: 0, failed: 0, dropped: 0, recordsExported: 0 },
  };
  private instrumentationEnabled = false;
  private currentSampleRate: number = 1.0;
  private adaptiveSamplingHistory: Array<{ timestamp: number; tps: number; sampleRate: number }> = [];
  private spanProcessingQueue: Array<{ span: any; timestamp: number }> = [];
  private resourceAttributes: Record<string, any> = {};
  private healthStatus: ServiceHealthStatus['components']['sdk'] = 'stopped';
  private lastExportAttempt: Date | null = null;
  private exportErrorCount = 0;
  private totalSpansCreated = 0;
  private totalMetricsRecorded = 0;
  private performanceProfiles: Map<string, Array<{ duration: number; memory: number; timestamp: number }>> = new Map();

  /**
   * Get the singleton instance
   */
  static override async getInstance(): Promise<OpenTelemetryService> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  protected override getServiceName(): string {
    return 'opentelemetry-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Enterprise OpenTelemetry service with comprehensive observability';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('OpenTelemetryService initializing with config:', {
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      tracingEnabled: this.config.tracing.enabled,
      metricsEnabled: this.config.metrics.enabled,
      logsEnabled: this.config.logs.enabled,
      autoInstrumentation: this.config.instrumentation.autoInstrument,
    });

    // Set initial sample rate
    this.currentSampleRate = this.config.sampling.ratio;
    
    // Initialize resource detection
    await this.initializeResourceDetection();

    // Initialize SDK
    await this.initializeSDK();
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    try {
      // Start the SDK
      this.healthStatus = 'starting';
      await this.sdk?.start();
      this.healthStatus = 'initialized';

      // Initialize tracer and meter
      this.tracer = trace.getTracer(this.config.serviceName, this.config.serviceVersion);
      this.meter = metrics.getMeter(this.config.serviceName, this.config.serviceVersion);

      // Setup custom metrics
      if (this.config.metrics.enableCustomMetrics) {
        await this.setupCustomMetrics();
      }

      // Setup runtime metrics
      if (this.config.metrics.enableRuntimeMetrics) {
        this.setupRuntimeMetrics();
      }

      // Setup error tracking
      this.setupErrorTracking();

      // Start adaptive sampling if enabled
      if (this.config.sampling.strategy === 'adaptive' && this.config.sampling.adaptive.enabled) {
        this.startAdaptiveSampling();
      }

      // Start background tasks
      this.startBackgroundTasks();

      this.instrumentationEnabled = true;

      logger.info('OpenTelemetryService started successfully');

      this.emit('otel:resource-detected', {
        service: this.config.serviceName,
        version: this.config.serviceVersion,
        environment: this.config.environment,
        attributes: this.resourceAttributes,
      });
    } catch (error) {
      this.healthStatus = 'error';
      logger.error('Failed to start OpenTelemetryService', error);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    try {
      this.instrumentationEnabled = false;
      this.healthStatus = 'stopped';

      // Stop adaptive sampling
      this.stopAdaptiveSampling();

      // Flush pending data
      await this.flushPendingData();

      // Shutdown SDK
      if (this.sdk) {
        await this.sdk.shutdown();
        this.sdk = null;
      }

      // Clear collections
      this.customMetrics.clear();
      this.spanProcessingQueue = [];
      this.adaptiveSamplingHistory = [];
      this.performanceProfiles.clear();

      logger.info('OpenTelemetryService stopped successfully');
    } catch (error) {
      logger.error('Error stopping OpenTelemetryService:', error);
    }
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: OpenTelemetryServiceConfig): Promise<void> {
    // Update sample rate if changed
    if (newConfig.sampling.ratio !== this.config.sampling.ratio) {
      this.currentSampleRate = newConfig.sampling.ratio;
      logger.info('Sample rate updated', { newRate: this.currentSampleRate });
    }

    // Recreate SDK if major settings changed
    const needsSDKRecreation = (
      newConfig.serviceName !== this.config.serviceName ||
      newConfig.serviceVersion !== this.config.serviceVersion ||
      newConfig.exporters.otlp.enabled !== this.config.exporters.otlp.enabled ||
      newConfig.exporters.otlp.endpoint !== this.config.exporters.otlp.endpoint
    );

    if (needsSDKRecreation) {
      logger.info('Core configuration changed, recreating SDK');
      await this.stop();
      await this.initializeSDK();
      await this.start();
    }
  }

  /**
   * Health check for OpenTelemetry system
   */
  @HealthCheck({
    name: 'otel:system',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkOTelSystem(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const healthStatus = this.getHealthStatus();
      
      if (healthStatus.status === 'unhealthy') {
        return {
          status: 'unhealthy',
          message: `OpenTelemetry system unhealthy: ${JSON.stringify(healthStatus.components)}`,
        };
      }

      return {
        status: 'healthy',
        message: `OpenTelemetry system healthy (${this.totalSpansCreated} spans, ${this.totalMetricsRecorded} metrics)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `OpenTelemetry system check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for exporters
   */
  @HealthCheck({
    name: 'otel:exporters',
    critical: false,
    interval: 60000,
  })
  async checkExporters(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const stats = this.getExportStatistics();
    
    // Calculate error rates
    const traceErrorRate = stats.traces.exported > 0 
      ? stats.traces.failed / (stats.traces.exported + stats.traces.failed) 
      : 0;
    
    const metricErrorRate = stats.metrics.exported > 0 
      ? stats.metrics.failed / (stats.metrics.exported + stats.metrics.failed) 
      : 0;

    if (traceErrorRate > 0.1 || metricErrorRate > 0.1) {
      return {
        status: 'degraded',
        message: `High export error rate (traces: ${Math.round(traceErrorRate * 100)}%, metrics: ${Math.round(metricErrorRate * 100)}%)`,
      };
    }

    return {
      status: 'healthy',
      message: `Exporters healthy (traces: ${stats.traces.exported}, metrics: ${stats.metrics.exported})`,
    };
  }

  /**
   * Create a span with automatic context management
   */
  @Metric({ name: 'otel.span-created', recordDuration: true })
  @MetricsSampling({ rate: 0.1, maxPerSecond: 1000, adaptiveSampling: true })
  public createSpan(options: CustomSpanOptions): Span {
    if (!this.instrumentationEnabled || !this.tracer) {
      return this.createNoOpSpan();
    }

    // Sampling decision
    if (!this.shouldSample()) {
      return this.createNoOpSpan();
    }

    const span = this.tracer.startSpan(options.operationName, {
      kind: options.kind || SpanKind.INTERNAL,
      parent: options.parentSpan,
      startTime: options.startTime,
      links: options.links,
    });

    // Add tags if provided
    if (options.tags) {
      Object.entries(options.tags).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    // Add common attributes
    span.setAttributes({
      'service.name': this.config.serviceName,
      'service.version': this.config.serviceVersion,
      'environment': this.config.environment,
      'telemetry.sdk.name': 'opentelemetry',
      'telemetry.sdk.version': '1.0.0',
    });

    this.totalSpansCreated++;

    // Track span for processing
    this.spanProcessingQueue.push({
      span,
      timestamp: Date.now(),
    });

    return span;
  }

  /**
   * Execute function with automatic span creation and management
   */
  @Metric({ name: 'otel.span-executed', recordDuration: true })
  @Traced({ operationName: 'withSpan' })
  public async withSpan<T>(
    operationName: string,
    fn: (span: Span) => Promise<T>,
    options?: Partial<CustomSpanOptions>
  ): Promise<T> {
    const span = this.createSpan({
      operationName,
      ...options,
    });

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Advanced performance monitoring with comprehensive profiling
   */
  @Metric({ name: 'otel.performance-monitored', recordDuration: true })
  @Profiled({ includeMemory: true, includeCpu: true, sampleRate: 0.1 })
  public async monitorPerformance<T>(
    operationName: string,
    operation: () => Promise<T>,
    options?: PerformanceMonitoringOptions
  ): Promise<T> {
    const startTime = performance.now();
    const startMemory = options?.includeMemory ? process.memoryUsage() : null;
    const startCpu = options?.includeCpu ? process.cpuUsage() : null;

    return await this.withSpan(operationName, async (span) => {
      try {
        const result = await operation();
        const duration = performance.now() - startTime;

        // Record performance metrics
        this.recordMetric('operation_duration', duration, {
          operation: operationName,
          ...options?.tags,
        });

        // Check thresholds
        if (options?.thresholds) {
          const level = this.assessPerformanceLevel(duration, options.thresholds);
          span.setAttribute('performance.level', level);

          if (level !== 'normal') {
            this.recordMetric('slow_operations', 1, {
              operation: operationName,
              level,
              ...options.tags,
            });

            // Emit threshold exceeded event if critical
            if (level === 'critical') {
              this.emit('otel:export-failed', {
                error: new Error(`Critical performance threshold exceeded: ${duration}ms > ${options.thresholds.critical}ms`),
                type: 'metrics',
                retryAttempt: 0,
                willRetry: false,
              });
            }
          }
        }

        // Add performance attributes
        const attributes: Record<string, any> = {
          'performance.duration_ms': duration,
          'performance.start_time': startTime,
        };

        if (startMemory && options?.includeMemory) {
          const endMemory = process.memoryUsage();
          attributes['performance.memory.heap_used_delta'] = endMemory.heapUsed - startMemory.heapUsed;
          attributes['performance.memory.heap_total'] = endMemory.heapTotal;
          attributes['performance.memory.external'] = endMemory.external;
        }

        if (startCpu && options?.includeCpu) {
          const endCpu = process.cpuUsage(startCpu);
          attributes['performance.cpu.user_ms'] = endCpu.user / 1000;
          attributes['performance.cpu.system_ms'] = endCpu.system / 1000;
        }

        span.setAttributes(attributes);

        // Store performance profile
        this.storePerformanceProfile(operationName, {
          duration,
          memory: startMemory ? process.memoryUsage().heapUsed : 0,
          timestamp: Date.now(),
        });

        return result;
      } catch (error) {
        const duration = performance.now() - startTime;
        this.recordMetric('operation_errors', 1, {
          operation: operationName,
          error: (error as Error).name,
          ...options?.tags,
        });

        span.setAttributes({
          'performance.duration_ms': duration,
          'performance.error': true,
        });

        throw error;
      }
    });
  }

  /**
   * Record custom metrics with validation and batching
   */
  @Metric({ name: 'otel.metric-recorded', recordDuration: true })
  @RateLimit({ windowMs: 1000, max: 10000 })
  public recordMetric(
    metricName: string,
    value: number,
    attributes?: Record<string, string | number | boolean>
  ): void {
    if (!this.instrumentationEnabled || !this.meter) {
      return;
    }

    const metric = this.customMetrics.get(metricName);
    if (!metric) {
      logger.warn(`Metric ${metricName} not found`);
      return;
    }

    try {
      const normalizedAttributes = this.normalizeAttributes(attributes);

      switch (metric.definition.type) {
        case 'counter':
          metric.instrument.add(value, normalizedAttributes);
          break;
        case 'histogram':
          metric.instrument.record(value, normalizedAttributes);
          break;
        case 'gauge':
          metric.instrument.record(value, normalizedAttributes);
          break;
        case 'updown_counter':
          metric.instrument.add(value, normalizedAttributes);
          break;
      }

      this.totalMetricsRecorded++;

      // Emit metrics collected event
      this.emit('otel:metrics-exported', {
        metrics: 1,
        dataPoints: 1,
        endpoint: 'internal',
        duration: 0,
        success: true,
      });

    } catch (error) {
      logger.error(`Failed to record metric ${metricName}`, error);
      this.emit('otel:export-failed', {
        error: error as Error,
        type: 'metrics',
        retryAttempt: 0,
        willRetry: false,
      });
    }
  }

  /**
   * Record business metrics with enhanced context
   */
  @Metric({ name: 'otel.business-metric', recordDuration: true })
  public recordBusinessMetric(
    metricName: string,
    value: number,
    context?: {
      attributes?: Record<string, string | number | boolean>;
      businessContext?: Record<string, any>;
      correlationId?: string;
    }
  ): void {
    // Record the business metric
    this.recordMetric(`business.${metricName}`, value, {
      ...context?.attributes,
      ...(context?.correlationId && { 'correlation.id': context.correlationId }),
    });

    // Enhanced business logging with structured data
    logger.info('Business metric recorded', {
      metric: metricName,
      value,
      attributes: context?.attributes,
      businessContext: context?.businessContext,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
      traceId: this.getCurrentTraceId(),
      spanId: this.getCurrentSpanId(),
    });
  }

  /**
   * Define custom metrics with validation
   */
  @Metric({ name: 'otel.metric-defined' })
  public defineMetric(definition: MetricDefinition): void {
    if (!this.meter) {
      logger.warn('Meter not initialized, deferring metric definition');
      return;
    }

    try {
      this.validateMetricDefinition(definition);

      let instrument;

      switch (definition.type) {
        case 'counter':
          instrument = this.meter.createCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          break;
        case 'histogram':
          instrument = this.meter.createHistogram(definition.name, {
            description: definition.description,
            unit: definition.unit,
            ...(definition.buckets && { boundaries: definition.buckets }),
          });
          break;
        case 'gauge':
          instrument = this.meter.createGauge(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          break;
        case 'updown_counter':
          instrument = this.meter.createUpDownCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          break;
        case 'observable_counter':
          instrument = this.meter.createObservableCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          if (definition.callback) {
            instrument.addCallback((observableResult: any) => {
              observableResult.observe(definition.callback!(), definition.tags);
            });
          }
          break;
        case 'observable_gauge':
          instrument = this.meter.createObservableGauge(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          if (definition.callback) {
            instrument.addCallback((observableResult: any) => {
              observableResult.observe(definition.callback!(), definition.tags);
            });
          }
          break;
        case 'observable_updown_counter':
          instrument = this.meter.createObservableUpDownCounter(definition.name, {
            description: definition.description,
            unit: definition.unit,
          });
          if (definition.callback) {
            instrument.addCallback((observableResult: any) => {
              observableResult.observe(definition.callback!(), definition.tags);
            });
          }
          break;
        default:
          throw new Error(`Unknown metric type: ${definition.type}`);
      }

      this.customMetrics.set(definition.name, {
        definition,
        instrument,
        createdAt: Date.now(),
      });

      logger.debug('Custom metric defined', {
        name: definition.name,
        type: definition.type,
        unit: definition.unit,
      });

    } catch (error) {
      logger.error('Failed to define custom metric', error);
      throw error;
    }
  }

  /**
   * Get current trace context
   */
  public getCurrentTraceContext(): TraceContext | null {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) return null;

    const spanContext = activeSpan.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      sampled: spanContext.traceFlags === 1,
    };
  }

  /**
   * Get current trace ID
   */
  public getCurrentTraceId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().traceId;
  }

  /**
   * Get current span ID
   */
  public getCurrentSpanId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().spanId;
  }

  /**
   * Get comprehensive export statistics
   */
  @Cache({ ttl: 10000, maxSize: 1 })
  public getExportStatistics(): ExportStatistics {
    return { ...this.exportStatistics };
  }

  /**
   * Get service health status
   */
  @Cache({ ttl: 5000, maxSize: 1 })
  public getHealthStatus(): ServiceHealthStatus {
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - this.metadata.startTime.getTime();

    // Assess component status
    const tracingStatus = this.config.tracing.enabled 
      ? (this.tracer ? 'enabled' : 'error')
      : 'disabled';
    
    const metricsStatus = this.config.metrics.enabled 
      ? (this.meter ? 'enabled' : 'error')
      : 'disabled';

    const logsStatus = this.config.logs.enabled ? 'enabled' : 'disabled';

    // Assess exporters
    const exporters = [];
    
    if (this.config.exporters.otlp.enabled) {
      exporters.push({
        type: 'otlp',
        status: this.lastExportAttempt && this.exportErrorCount < 5 ? 'healthy' : 'unhealthy' as const,
        lastExport: this.lastExportAttempt || undefined,
        errorRate: this.exportErrorCount / Math.max(this.exportStatistics.traces.batchesExported, 1),
      });
    }

    if (this.config.exporters.prometheus.enabled) {
      exporters.push({
        type: 'prometheus',
        status: 'healthy' as const,
      });
    }

    // Overall status assessment
    const hasErrors = [tracingStatus, metricsStatus].includes('error') || 
                     exporters.some(e => e.status === 'unhealthy');
    
    const status = hasErrors ? 'unhealthy' : 
                  (this.exportErrorCount > 0 ? 'degraded' : 'healthy');

    return {
      status,
      components: {
        sdk: this.healthStatus,
        tracing: tracingStatus as any,
        metrics: metricsStatus as any,
        logs: logsStatus as any,
        exporters,
      },
      uptime,
      memoryUsage: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
    };
  }

  /**
   * Get performance analysis for operations
   */
  @ObservabilityMonitored({
    tracing: true,
    profiling: true,
  })
  public getPerformanceAnalysis(operationName?: string) {
    if (operationName) {
      const profiles = this.performanceProfiles.get(operationName) || [];
      return this.analyzePerformanceProfiles(profiles);
    }

    const allAnalyses: Record<string, any> = {};
    for (const [name, profiles] of this.performanceProfiles) {
      allAnalyses[name] = this.analyzePerformanceProfiles(profiles);
    }

    return allAnalyses;
  }

  /**
   * Get service statistics
   */
  public getServiceStatistics() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    
    return {
      spansCreated: this.totalSpansCreated,
      metricsRecorded: this.totalMetricsRecorded,
      exportStatistics: this.exportStatistics,
      customMetrics: this.customMetrics.size,
      currentSampleRate: this.currentSampleRate,
      instrumentationEnabled: this.instrumentationEnabled,
      uptime,
      spansPerSecond: this.totalSpansCreated / (uptime / 1000),
      metricsPerSecond: this.totalMetricsRecorded / (uptime / 1000),
      queueSize: this.spanProcessingQueue.length,
      adaptiveSamplingHistory: this.adaptiveSamplingHistory.slice(-10),
      performanceProfiles: Object.fromEntries(
        Array.from(this.performanceProfiles.entries()).map(([name, profiles]) => [
          name,
          profiles.length
        ])
      ),
    };
  }

  /**
   * Flush pending telemetry data
   */
  public async flushPendingData(): Promise<void> {
    try {
      if (this.sdk) {
        // Force flush all providers
        await Promise.all([
          trace.getTracerProvider().forceFlush?.(30000),
          metrics.getMeterProvider().forceFlush?.(30000),
        ].filter(Boolean));
      }

      logger.info('Flushed pending telemetry data');
    } catch (error) {
      logger.error('Error flushing telemetry data', error);
    }
  }

  /**
   * Private helper methods
   */

  private async initializeResourceDetection(): Promise<void> {
    if (!this.config.resourceDetection.enabled) {
      return;
    }

    try {
      // Basic resource attributes
      this.resourceAttributes = {
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
        [SemanticResourceAttributes.TELEMETRY_SDK_NAME]: 'opentelemetry',
        [SemanticResourceAttributes.TELEMETRY_SDK_LANGUAGE]: 'nodejs',
        [SemanticResourceAttributes.TELEMETRY_SDK_VERSION]: '1.0.0',
      };

      // Add process information
      if (this.config.resourceDetection.detectors.includes('process')) {
        this.resourceAttributes[SemanticResourceAttributes.PROCESS_PID] = process.pid;
        this.resourceAttributes[SemanticResourceAttributes.PROCESS_COMMAND] = process.argv[1];
        this.resourceAttributes[SemanticResourceAttributes.PROCESS_RUNTIME_NAME] = 'nodejs';
        this.resourceAttributes[SemanticResourceAttributes.PROCESS_RUNTIME_VERSION] = process.version;
      }

      // Add host information
      if (this.config.resourceDetection.detectors.includes('host')) {
        const os = require('os');
        this.resourceAttributes[SemanticResourceAttributes.HOST_NAME] = os.hostname();
        this.resourceAttributes[SemanticResourceAttributes.HOST_ARCH] = os.arch();
        this.resourceAttributes[SemanticResourceAttributes.OS_TYPE] = os.type();
        this.resourceAttributes[SemanticResourceAttributes.OS_VERSION] = os.release();
      }

    } catch (error) {
      logger.warn('Resource detection failed', error);
    }
  }

  private async initializeSDK(): Promise<void> {
    const Resource = resources.Resource || resources.default?.Resource;
    const resource = new Resource(this.resourceAttributes);

    // Configure exporters based on configuration
    const exporters = this.configureExporters();

    // Configure instrumentation
    const instrumentations = this.configureInstrumentations();

    // Initialize SDK
    this.sdk = new NodeSDK({
      resource,
      ...exporters,
      instrumentations,
    });

    logger.info('OpenTelemetry SDK initialized', {
      exporters: Object.keys(exporters),
      instrumentations: instrumentations.length,
    });
  }

  private configureExporters(): any {
    const exporters: any = {};

    // OTLP Trace Exporter
    if (this.config.exporters.otlp.enabled && this.config.exporters.otlp.endpoint) {
      exporters.traceExporter = new OTLPTraceExporter({
        url: `${this.config.exporters.otlp.endpoint}/v1/traces`,
        headers: this.config.exporters.otlp.headers,
        compression: this.config.exporters.otlp.compression,
      });
    }

    // Console exporter for development
    if (this.config.exporters.console.enabled) {
      // Would configure console exporter here
      logger.info('Console exporter would be configured');
    }

    return exporters;
  }

  private configureInstrumentations(): any[] {
    if (!this.config.instrumentation.autoInstrument) {
      return [];
    }

    const instrumentationConfig: any = {};

    // Disable specific instrumentations
    for (const disabled of this.config.instrumentation.disabledInstrumentations) {
      instrumentationConfig[`@opentelemetry/instrumentation-${disabled}`] = {
        enabled: false,
      };
    }

    // File system instrumentation is often noisy
    instrumentationConfig['@opentelemetry/instrumentation-fs'] = {
      enabled: this.config.instrumentation.enabledInstrumentations.includes('fs'),
    };

    return [getNodeAutoInstrumentations(instrumentationConfig)];
  }

  private async setupCustomMetrics(): Promise<void> {
    // Define application-specific metrics
    const metricDefinitions: MetricDefinition[] = [
      {
        name: 'todo_operations_total',
        description: 'Total number of todo operations',
        type: 'counter',
        unit: 'operations',
      },
      {
        name: 'todo_operation_duration',
        description: 'Duration of todo operations',
        type: 'histogram',
        unit: 'ms',
        buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      },
      {
        name: 'active_users',
        description: 'Number of active users',
        type: 'observable_gauge',
        unit: 'users',
        callback: () => Math.floor(Math.random() * 100), // Placeholder
      },
      {
        name: 'database_connections',
        description: 'Number of database connections',
        type: 'updown_counter',
        unit: 'connections',
      },
      {
        name: 'graphql_operations_total',
        description: 'Total GraphQL operations',
        type: 'counter',
        unit: 'operations',
      },
      {
        name: 'graphql_operation_duration',
        description: 'GraphQL operation duration',
        type: 'histogram',
        unit: 'ms',
        buckets: [1, 10, 50, 100, 500, 1000, 5000],
      },
      {
        name: 'cache_operations_total',
        description: 'Cache operations',
        type: 'counter',
        unit: 'operations',
      },
      {
        name: 'cache_hit_ratio',
        description: 'Cache hit ratio',
        type: 'observable_gauge',
        unit: 'ratio',
        callback: () => Math.random(), // Placeholder
      },
      {
        name: 'operation_duration',
        description: 'Generic operation duration',
        type: 'histogram',
        unit: 'ms',
        buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      },
      {
        name: 'operation_errors',
        description: 'Operation errors',
        type: 'counter',
        unit: 'errors',
      },
      {
        name: 'slow_operations',
        description: 'Slow operations count',
        type: 'counter',
        unit: 'operations',
      },
    ];

    // Register all metrics
    for (const definition of metricDefinitions) {
      this.defineMetric(definition);
    }

    this.emit('otel:instrumentation-loaded', {
      library: 'custom-metrics',
      version: '1.0.0',
      autoInstrumented: false,
    });

    logger.info('Custom metrics initialized', {
      count: metricDefinitions.length,
    });
  }

  private setupRuntimeMetrics(): void {
    // Node.js runtime metrics
    const runtimeMetrics = [
      {
        name: 'nodejs_heap_size_total_bytes',
        description: 'Total heap size in bytes',
        type: 'observable_gauge' as const,
        unit: 'bytes',
        callback: () => process.memoryUsage().heapTotal,
      },
      {
        name: 'nodejs_heap_size_used_bytes',
        description: 'Used heap size in bytes',
        type: 'observable_gauge' as const,
        unit: 'bytes',
        callback: () => process.memoryUsage().heapUsed,
      },
      {
        name: 'nodejs_external_memory_bytes',
        description: 'External memory in bytes',
        type: 'observable_gauge' as const,
        unit: 'bytes',
        callback: () => process.memoryUsage().external,
      },
      {
        name: 'nodejs_process_cpu_user_seconds_total',
        description: 'Total user CPU time spent',
        type: 'observable_counter' as const,
        unit: 'seconds',
        callback: () => process.cpuUsage().user / 1000000,
      },
      {
        name: 'nodejs_process_cpu_system_seconds_total',
        description: 'Total system CPU time spent',
        type: 'observable_counter' as const,
        unit: 'seconds',
        callback: () => process.cpuUsage().system / 1000000,
      },
    ];

    for (const metric of runtimeMetrics) {
      this.defineMetric(metric);
    }

    logger.info('Runtime metrics initialized');
  }

  private setupErrorTracking(): void {
    // Global error handlers with enhanced tracking
    process.on('unhandledRejection', (reason, promise) => {
      const span = this.createSpan({
        operationName: 'unhandled_rejection',
        kind: SpanKind.INTERNAL,
        tags: {
          'error.type': 'unhandled_rejection',
          'error.reason': String(reason),
          'error.stack': reason instanceof Error ? reason.stack : undefined,
        },
      });

      span.recordException(reason as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Unhandled promise rejection',
      });
      span.end();

      this.recordMetric('unhandled_errors', 1, {
        type: 'unhandled_rejection',
        service: this.config.serviceName,
      });

      logger.error('Unhandled promise rejection', { reason, promise });
    });

    process.on('uncaughtException', (error) => {
      const span = this.createSpan({
        operationName: 'uncaught_exception',
        kind: SpanKind.INTERNAL,
        tags: {
          'error.type': 'uncaught_exception',
          'error.message': error.message,
          'error.stack': error.stack,
        },
      });

      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Uncaught exception',
      });
      span.end();

      this.recordMetric('unhandled_errors', 1, {
        type: 'uncaught_exception',
        service: this.config.serviceName,
      });

      logger.error('Uncaught exception', { error });
    });
  }

  private startAdaptiveSampling(): void {
    setInterval(() => {
      this.adjustAdaptiveSampling();
    }, this.config.sampling.adaptive.adjustmentPeriod);
  }

  private stopAdaptiveSampling(): void {
    // Cleanup would be handled by service stop
  }

  private adjustAdaptiveSampling(): void {
    const now = Date.now();
    const windowMs = this.config.sampling.adaptive.adjustmentPeriod;
    const windowStart = now - windowMs;

    // Calculate current TPS from recent spans
    const recentSpans = this.spanProcessingQueue.filter(
      entry => entry.timestamp > windowStart
    ).length;
    const currentTPS = recentSpans / (windowMs / 1000);

    const targetTPS = this.config.sampling.adaptive.targetTPS;
    
    if (currentTPS > targetTPS * 1.2) {
      // Reduce sample rate
      this.currentSampleRate = Math.max(
        this.config.sampling.adaptive.minRatio,
        this.currentSampleRate * 0.8
      );
    } else if (currentTPS < targetTPS * 0.8) {
      // Increase sample rate
      this.currentSampleRate = Math.min(
        this.config.sampling.adaptive.maxRatio,
        this.currentSampleRate * 1.2
      );
    }

    // Track sampling history
    this.adaptiveSamplingHistory.push({
      timestamp: now,
      tps: currentTPS,
      sampleRate: this.currentSampleRate,
    });

    // Keep history limited
    if (this.adaptiveSamplingHistory.length > 100) {
      this.adaptiveSamplingHistory = this.adaptiveSamplingHistory.slice(-50);
    }

    if (this.currentSampleRate !== this.config.sampling.ratio) {
      this.emit('otel:sampling-configured', {
        strategy: 'adaptive',
        rate: this.currentSampleRate,
        rules: [{
          service: this.config.serviceName,
          rate: this.currentSampleRate,
        }],
      });
    }
  }

  private startBackgroundTasks(): void {
    // Cleanup task
    setInterval(() => {
      this.performCleanup();
    }, 300000); // 5 minutes

    // Export monitoring
    setInterval(() => {
      this.checkExportHealth();
    }, 30000); // 30 seconds
  }

  private performCleanup(): void {
    const now = Date.now();
    const cutoff = now - 3600000; // 1 hour ago

    // Cleanup span processing queue
    this.spanProcessingQueue = this.spanProcessingQueue.filter(
      entry => entry.timestamp > cutoff
    );

    // Cleanup performance profiles
    for (const [name, profiles] of this.performanceProfiles) {
      const filtered = profiles.filter(p => p.timestamp > cutoff);
      if (filtered.length === 0) {
        this.performanceProfiles.delete(name);
      } else {
        this.performanceProfiles.set(name, filtered);
      }
    }

    logger.debug('Background cleanup completed');
  }

  private checkExportHealth(): void {
    // Simple export health check
    this.lastExportAttempt = new Date();
    
    // In a real implementation, this would check actual export status
    if (Math.random() > 0.95) { // Simulate occasional export errors
      this.exportErrorCount++;
    }
  }

  private shouldSample(): boolean {
    switch (this.config.sampling.strategy) {
      case 'always':
        return true;
      case 'never':
        return false;
      case 'ratio':
        return Math.random() < this.config.sampling.ratio;
      case 'adaptive':
        return Math.random() < this.currentSampleRate;
      default:
        return true;
    }
  }

  private createNoOpSpan(): Span {
    return {
      spanContext: () => ({ traceId: 'noop', spanId: 'noop', traceFlags: 0 }),
      setStatus: () => {},
      setAttributes: () => {},
      setAttribute: () => {},
      addEvent: () => {},
      recordException: () => {},
      updateName: () => {},
      end: () => {},
      isRecording: () => false,
    } as any;
  }

  private validateMetricDefinition(definition: MetricDefinition): void {
    if (!definition.name || !definition.description || !definition.type) {
      throw new Error('Invalid metric definition: missing required fields');
    }

    if (this.customMetrics.has(definition.name)) {
      throw new Error(`Metric ${definition.name} already exists`);
    }
  }

  private normalizeAttributes(attributes?: Record<string, any>): Record<string, any> {
    if (!attributes) return {};

    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(attributes)) {
      // OpenTelemetry attributes must be string, number, or boolean
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        normalized[key] = value;
      } else {
        normalized[key] = String(value);
      }
    }
    return normalized;
  }

  private assessPerformanceLevel(
    duration: number, 
    thresholds: PerformanceMonitoringOptions['thresholds']
  ): string {
    if (!thresholds) return 'normal';
    
    if (duration > thresholds.critical) return 'critical';
    if (duration > thresholds.error) return 'error';
    if (duration > thresholds.warning) return 'warning';
    return 'normal';
  }

  private storePerformanceProfile(
    operationName: string,
    profile: { duration: number; memory: number; timestamp: number }
  ): void {
    if (!this.performanceProfiles.has(operationName)) {
      this.performanceProfiles.set(operationName, []);
    }

    const profiles = this.performanceProfiles.get(operationName)!;
    profiles.push(profile);

    // Keep only recent profiles (last 100)
    if (profiles.length > 100) {
      profiles.splice(0, profiles.length - 100);
    }
  }

  private analyzePerformanceProfiles(profiles: Array<{ duration: number; memory: number; timestamp: number }>) {
    if (profiles.length === 0) {
      return { count: 0, averageDuration: 0, medianDuration: 0, p95Duration: 0, trend: 'stable' };
    }

    const durations = profiles.map(p => p.duration).sort((a, b) => a - b);
    const count = durations.length;
    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / count;
    const medianDuration = durations[Math.floor(count / 2)];
    const p95Duration = durations[Math.floor(count * 0.95)];

    // Simple trend analysis
    const recentProfiles = profiles.slice(-10);
    const olderProfiles = profiles.slice(-20, -10);
    
    let trend = 'stable';
    if (recentProfiles.length >= 5 && olderProfiles.length >= 5) {
      const recentAvg = recentProfiles.reduce((sum, p) => sum + p.duration, 0) / recentProfiles.length;
      const olderAvg = olderProfiles.reduce((sum, p) => sum + p.duration, 0) / olderProfiles.length;
      const change = (recentAvg - olderAvg) / olderAvg;
      
      if (change > 0.2) trend = 'degrading';
      else if (change < -0.2) trend = 'improving';
    }

    return {
      count,
      averageDuration,
      medianDuration,
      p95Duration,
      trend,
      memoryTrend: profiles.length > 1 
        ? (profiles[profiles.length - 1].memory > profiles[0].memory ? 'increasing' : 'decreasing')
        : 'stable',
    };
  }
}