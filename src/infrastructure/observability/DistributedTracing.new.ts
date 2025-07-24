import { trace, context, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { DistributedTracingEventMap } from '../core/ServiceEventMaps.observability.js';
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
 * Distributed tracing configuration schema
 */
const DistributedTracingConfigSchema = z.object({
  serviceName: z.string().default('pothos-todo'),
  serviceVersion: z.string().default('1.0.0'),
  environment: z.string().default('development'),
  jaegerEndpoint: z.string().optional(),
  zipkinEndpoint: z.string().optional(),
  sampleRate: z.number().min(0).max(1).default(1.0),
  enableB3Propagation: z.boolean().default(true),
  enableJaegerPropagation: z.boolean().default(false),
  enableBaggage: z.boolean().default(true),
  retention: z.object({
    maxActiveSpans: z.number().default(1000),
    maxCompletedSpans: z.number().default(10000),
    cleanupInterval: z.number().default(300000), // 5 minutes
  }),
  performance: z.object({
    enableSlowTraceDetection: z.boolean().default(true),
    slowTraceThreshold: z.number().default(5000), // 5 seconds
    enableAnomalyDetection: z.boolean().default(true),
    errorRateThreshold: z.number().default(0.05), // 5%
  }),
  sampling: z.object({
    enableAdaptiveSampling: z.boolean().default(true),
    minSampleRate: z.number().default(0.1),
    maxSampleRate: z.number().default(1.0),
    targetThroughput: z.number().default(1000), // spans per second
  }),
  export: z.object({
    enableBatching: z.boolean().default(true),
    batchSize: z.number().default(100),
    batchTimeout: z.number().default(5000), // 5 seconds
    enableCompression: z.boolean().default(true),
    retryAttempts: z.number().default(3),
  }),
});

export type DistributedTracingConfig = z.infer<typeof DistributedTracingConfigSchema>;

/**
 * Trace context interface
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
  flags?: number;
}

/**
 * Span options interface
 */
export interface SpanOptions {
  name: string;
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parent?: Span;
  startTime?: number;
}

/**
 * Database span options
 */
export interface DatabaseSpanOptions extends SpanOptions {
  operation: string;
  table?: string;
  query?: string;
  connectionPool?: string;
}

/**
 * HTTP span options
 */
export interface HttpSpanOptions extends SpanOptions {
  method: string;
  url: string;
  statusCode?: number;
  userAgent?: string;
  clientIP?: string;
}

/**
 * GraphQL span options
 */
export interface GraphQLSpanOptions extends SpanOptions {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName?: string;
  complexity?: number;
  variables?: Record<string, any>;
  depth?: number;
}

/**
 * AI operation span options
 */
export interface AISpanOptions extends SpanOptions {
  operationType: string;
  model: string;
  provider: string;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
}

/**
 * Span information for analytics
 */
export interface SpanInfo {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  duration?: number;
  tags: Record<string, any>;
  logs: Array<{
    timestamp: number;
    fields: Record<string, any>;
  }>;
  status: 'ok' | 'error' | 'timeout';
  errorCount: number;
  childSpanCount: number;
}

/**
 * Trace analytics interface
 */
export interface TraceAnalytics {
  totalSpans: number;
  errorRate: number;
  averageDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  serviceMap: Array<{
    from: string;
    to: string;
    callCount: number;
    errorCount: number;
    avgDuration: number;
    throughput: number;
  }>;
  criticalPath: string[];
  bottlenecks: Array<{
    operation: string;
    avgDuration: number;
    frequency: number;
    impact: number;
  }>;
}

/**
 * Trace anomaly interface
 */
export interface TraceAnomaly {
  type: 'slow_trace' | 'error_spike' | 'memory_leak' | 'dependency_issue' | 'throughput_drop';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  traces: string[];
  recommendations: string[];
  detectedAt: number;
  confidence: number;
}

/**
 * Enhanced Distributed Tracing Service using the new base service architecture
 * 
 * Features:
 * - OpenTelemetry integration with multiple exporters
 * - Adaptive sampling and performance optimization
 * - Trace analytics and anomaly detection
 * - Service map generation and dependency tracking
 * - Context propagation across service boundaries
 * - Comprehensive health monitoring and metrics
 * 
 * @example
 * ```typescript
 * const distributedTracing = await DistributedTracing.getInstance();
 * 
 * // Listen to tracing events
 * distributedTracing.on('trace:span-started', ({ traceId, spanId, operation }) => {
 *   console.log(`Started span ${operation} (${spanId})`);
 * });
 * 
 * // Create traced operations
 * await distributedTracing.startSpan({
 *   name: 'user-service.create-user',
 *   kind: SpanKind.SERVER,
 *   attributes: { 'user.id': '123' }
 * }, async (span) => {
 *   // Your operation here
 *   return await createUser(userData);
 * });
 * 
 * // Trace database operations
 * await distributedTracing.traceDatabaseOperation({
 *   name: 'user-query',
 *   operation: 'SELECT',
 *   table: 'users',
 *   query: 'SELECT * FROM users WHERE id = ?'
 * }, async (span) => {
 *   return await db.query('SELECT * FROM users WHERE id = ?', [userId]);
 * });
 * ```
 */
@ServiceConfig({
  schema: DistributedTracingConfigSchema,
  prefix: 'tracing',
  hot: true, // Allow hot reload for configuration changes
})
export class DistributedTracing extends BaseAsyncService<DistributedTracingConfig, DistributedTracingEventMap> {
  private tracer: any;
  private traceStorage = new AsyncLocalStorage<TraceContext>();
  private activeSpans: Map<string, SpanInfo> = new Map();
  private completedSpans: SpanInfo[] = [];
  private serviceMap: Map<string, Map<string, any>> = new Map();
  private spansProcessed = 0;
  private tracesStarted = 0;
  private tracesCompleted = 0;
  private anomaliesDetected = 0;
  private exportBatches = 0;
  private lastCleanup = 0;
  private currentSampleRate: number = 1.0;
  private throughputTracker: Array<{ timestamp: number; count: number }> = [];

  /**
   * Get the singleton instance
   */
  static override async getInstance(): Promise<DistributedTracing> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  protected override getServiceName(): string {
    return 'distributed-tracing';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Advanced distributed tracing with OpenTelemetry integration and analytics';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('DistributedTracing initializing with config:', {
      serviceName: this.config.serviceName,
      sampleRate: this.config.sampleRate,
      jaegerEnabled: !!this.config.jaegerEndpoint,
      zipkinEnabled: !!this.config.zipkinEndpoint,
      adaptiveSampling: this.config.sampling.enableAdaptiveSampling,
    });

    // Initialize tracer
    this.setupTracer();
    
    // Set initial sample rate
    this.currentSampleRate = this.config.sampleRate;
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Start background tasks
    this.startBackgroundTasks();

    // Setup adaptive sampling if enabled
    if (this.config.sampling.enableAdaptiveSampling) {
      this.setupAdaptiveSampling();
    }

    logger.info('DistributedTracing started successfully');
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    try {
      // Export any remaining spans
      await this.flushPendingSpans();

      // Clear collections
      this.activeSpans.clear();
      this.completedSpans = [];
      this.serviceMap.clear();
      this.throughputTracker = [];

      logger.info('DistributedTracing stopped successfully');
    } catch (error) {
      logger.error('Error stopping DistributedTracing:', error);
    }
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: DistributedTracingConfig): Promise<void> {
    // Update sample rate if changed
    if (newConfig.sampleRate !== this.config.sampleRate) {
      this.currentSampleRate = newConfig.sampleRate;
      logger.info('Sample rate updated', { newRate: this.currentSampleRate });
    }

    // Recreate tracer if export settings changed
    if (
      newConfig.jaegerEndpoint !== this.config.jaegerEndpoint ||
      newConfig.zipkinEndpoint !== this.config.zipkinEndpoint ||
      newConfig.serviceName !== this.config.serviceName
    ) {
      logger.info('Tracer configuration changed, recreating tracer');
      this.setupTracer();
    }
  }

  /**
   * Health check for tracing system
   */
  @HealthCheck({
    name: 'tracing:system',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkTracingSystem(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const recentSpans = this.getRecentSpansCount(60000); // Last minute
      const activeSpansCount = this.activeSpans.size;
      
      if (activeSpansCount > this.config.retention.maxActiveSpans * 0.9) {
        return {
          status: 'unhealthy',
          message: `Too many active spans: ${activeSpansCount}/${this.config.retention.maxActiveSpans}`,
        };
      }

      if (recentSpans === 0) {
        return {
          status: 'unhealthy',
          message: 'No spans processed in the last minute',
        };
      }

      return {
        status: 'healthy',
        message: `Tracing system healthy (${recentSpans} spans/min, ${activeSpansCount} active)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Tracing system check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for sampling system
   */
  @HealthCheck({
    name: 'tracing:sampling',
    critical: false,
    interval: 60000,
  })
  async checkSampling(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const currentThroughput = this.getCurrentThroughput();
    const targetThroughput = this.config.sampling.targetThroughput;
    
    if (currentThroughput > targetThroughput * 1.5) {
      return {
        status: 'degraded',
        message: `High throughput detected: ${currentThroughput}/s (target: ${targetThroughput}/s)`,
      };
    }

    if (this.currentSampleRate < this.config.sampling.minSampleRate) {
      return {
        status: 'degraded',
        message: `Sample rate below minimum: ${this.currentSampleRate} (min: ${this.config.sampling.minSampleRate})`,
      };
    }

    return {
      status: 'healthy',
      message: `Sampling healthy (rate: ${this.currentSampleRate}, throughput: ${currentThroughput}/s)`,
    };
  }

  /**
   * Start a traced operation
   */
  @Metric({ name: 'tracing.span-started', recordDuration: true })
  @MetricsSampling({ rate: 0.1, maxPerSecond: 100, adaptiveSampling: true })
  @Traced({ operationName: 'startSpan' })
  public async startSpan<T>(
    options: SpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    // Sampling decision
    if (!this.shouldSample()) {
      // Execute without tracing
      return await fn(this.createNoOpSpan());
    }

    const span = this.tracer.startSpan(options.name, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes,
      startTime: options.startTime,
    }, options.parent ? trace.setSpan(context.active(), options.parent) : undefined);

    const traceContext: TraceContext = {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: this.getCurrentSpanId(),
    };

    // Track span start
    this.trackSpanStart(span, options);

    try {
      return await this.traceStorage.run(traceContext, async () => {
        return await trace.getTracer(this.config.serviceName).startActiveSpan(
          options.name,
          {
            kind: options.kind || SpanKind.INTERNAL,
            attributes: options.attributes,
            startTime: options.startTime,
          },
          async (activeSpan) => {
            try {
              const result = await fn(activeSpan);
              this.finishSpan(activeSpan, 'ok');
              return result;
            } catch (error) {
              this.finishSpan(activeSpan, 'error', error as Error);
              throw error;
            }
          }
        );
      });
    } catch (error) {
      this.finishSpan(span, 'error', error as Error);
      throw error;
    }
  }

  /**
   * Trace database operations with enhanced metadata
   */
  @Metric({ name: 'tracing.db-operation', recordDuration: true })
  @AlertThreshold({
    metric: 'db_operation_duration',
    warning: 1000,
    critical: 5000,
    comparison: 'gt',
  })
  public async traceDatabaseOperation<T>(
    options: DatabaseSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'db.operation': options.operation,
      'db.system': 'postgresql',
      'db.connection_string': 'postgresql://***',
      ...(options.table && { 'db.table': options.table }),
      ...(options.query && { 'db.statement': this.sanitizeQuery(options.query) }),
      ...(options.connectionPool && { 'db.connection_pool': options.connectionPool }),
      ...options.attributes,
    };

    return this.startSpan({
      name: `db.${options.operation}${options.table ? ` ${options.table}` : ''}`,
      kind: SpanKind.CLIENT,
      attributes,
    }, async (span) => {
      const start = performance.now();

      try {
        const result = await fn(span);
        const duration = performance.now() - start;

        span.setAttributes({
          'db.duration': duration,
          'db.rows_affected': this.extractRowsAffected(result),
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'success',
        });

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        
        span.setAttributes({
          'db.duration': duration,
          'db.error': (error as Error).message,
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'error',
          logs: [{
            timestamp: Date.now(),
            message: (error as Error).message,
            level: 'error',
          }],
        });

        throw error;
      }
    });
  }

  /**
   * Trace HTTP requests with comprehensive metadata
   */
  @Metric({ name: 'tracing.http-request', recordDuration: true })
  @Profiled({ includeMemory: false, sampleRate: 0.1 })
  public async traceHttpRequest<T>(
    options: HttpSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const url = new URL(options.url);
    const attributes = {
      'http.method': options.method,
      'http.url': options.url,
      'http.scheme': url.protocol.replace(':', ''),
      'http.host': url.host,
      'http.target': url.pathname + url.search,
      ...(options.userAgent && { 'http.user_agent': options.userAgent }),
      ...(options.clientIP && { 'http.client_ip': options.clientIP }),
      ...options.attributes,
    };

    return this.startSpan({
      name: `HTTP ${options.method} ${url.pathname}`,
      kind: SpanKind.CLIENT,
      attributes,
    }, async (span) => {
      const start = performance.now();

      try {
        const result = await fn(span);
        const duration = performance.now() - start;

        span.setAttributes({
          'http.status_code': options.statusCode || 200,
          'http.response_time': duration,
          'http.response_size': this.extractResponseSize(result),
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'success',
        });

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        
        span.setAttributes({
          'http.status_code': 500,
          'http.response_time': duration,
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'error',
          logs: [{
            timestamp: Date.now(),
            message: (error as Error).message,
            level: 'error',
          }],
        });

        throw error;
      }
    });
  }

  /**
   * Trace GraphQL operations with query analysis
   */
  @Metric({ name: 'tracing.graphql-operation', recordDuration: true })
  public async traceGraphQLOperation<T>(
    options: GraphQLSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'graphql.operation.type': options.operationType,
      ...(options.operationName && { 'graphql.operation.name': options.operationName }),
      ...(options.complexity && { 'graphql.query.complexity': options.complexity }),
      ...(options.depth && { 'graphql.query.depth': options.depth }),
      ...options.attributes,
    };

    // Add sanitized variables
    if (options.variables) {
      const sanitizedVars = this.sanitizeVariables(options.variables);
      Object.entries(sanitizedVars).forEach(([key, value]) => {
        (attributes as any)[`graphql.variable.${key}`] = String(value);
      });
    }

    return this.startSpan({
      name: `GraphQL ${options.operationType}${options.operationName ? ` ${options.operationName}` : ''}`,
      kind: SpanKind.SERVER,
      attributes,
    }, async (span) => {
      const start = performance.now();

      try {
        const result = await fn(span);
        const duration = performance.now() - start;

        span.setAttributes({
          'graphql.execution.duration': duration,
          'graphql.resolver.count': this.extractResolverCount(result),
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'success',
        });

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        
        span.setAttributes({
          'graphql.execution.duration': duration,
          'graphql.error': (error as Error).message,
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'error',
          logs: [{
            timestamp: Date.now(),
            message: (error as Error).message,
            level: 'error',
          }],
        });

        throw error;
      }
    });
  }

  /**
   * Trace AI operations with cost and token tracking
   */
  @Metric({ name: 'tracing.ai-operation', recordDuration: true })
  public async traceAIOperation<T>(
    options: AISpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'ai.operation': options.operationType,
      'ai.model': options.model,
      'ai.provider': options.provider,
      ...(options.tokens && {
        'ai.tokens.input': options.tokens.input,
        'ai.tokens.output': options.tokens.output,
        'ai.tokens.total': options.tokens.total,
      }),
      ...(options.cost && { 'ai.cost': options.cost }),
      ...options.attributes,
    };

    return this.startSpan({
      name: `AI ${options.operationType} ${options.model}`,
      kind: SpanKind.CLIENT,
      attributes,
    }, async (span) => {
      const start = performance.now();

      try {
        const result = await fn(span);
        const duration = performance.now() - start;

        span.setAttributes({
          'ai.duration': duration,
          'ai.success': true,
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'success',
        });

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        
        span.setAttributes({
          'ai.duration': duration,
          'ai.success': false,
          'ai.error': (error as Error).message,
        });

        this.emit('trace:span-finished', {
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          duration,
          status: 'error',
          logs: [{
            timestamp: Date.now(),
            message: (error as Error).message,
            level: 'error',
          }],
        });

        throw error;
      }
    });
  }

  /**
   * Get comprehensive trace analytics
   */
  @Metric({ name: 'tracing.analytics', recordDuration: true })
  @Cache({ ttl: 30000, maxSize: 10 })
  public getTraceAnalytics(timeRange?: { start: number; end: number }): TraceAnalytics {
    let spans = this.completedSpans;

    if (timeRange) {
      spans = spans.filter(span => 
        span.startTime >= timeRange.start && span.startTime <= timeRange.end
      );
    }

    if (spans.length === 0) {
      return this.getEmptyAnalytics();
    }

    // Calculate basic metrics
    const totalSpans = spans.length;
    const errorSpans = spans.filter(span => span.status === 'error').length;
    const errorRate = errorSpans / totalSpans;

    const durations = spans
      .filter(span => span.duration !== undefined)
      .map(span => span.duration!)
      .sort((a, b) => a - b);

    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const p50Duration = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95Duration = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99Duration = durations[Math.floor(durations.length * 0.99)] || 0;

    // Generate enhanced service map
    const serviceMap = this.generateEnhancedServiceMap(spans);

    // Find critical path and bottlenecks
    const criticalPath = this.findCriticalPath(spans);
    const bottlenecks = this.identifyBottlenecks(spans);

    return {
      totalSpans,
      errorRate,
      averageDuration,
      p50Duration,
      p95Duration,
      p99Duration,
      serviceMap,
      criticalPath,
      bottlenecks,
    };
  }

  /**
   * Detect trace anomalies with ML-like patterns
   */
  @Metric({ name: 'tracing.anomaly-detection', recordDuration: true })
  public detectTraceAnomalies(): TraceAnomaly[] {
    const anomalies: TraceAnomaly[] = [];
    const recentSpans = this.completedSpans.slice(-1000);
    const now = Date.now();

    if (recentSpans.length < 100) {
      return anomalies; // Not enough data
    }

    // Detect slow traces
    const slowTraceAnomaly = this.detectSlowTraces(recentSpans);
    if (slowTraceAnomaly) {
      anomalies.push(slowTraceAnomaly);
    }

    // Detect error spikes
    const errorSpikeAnomaly = this.detectErrorSpikes(recentSpans);
    if (errorSpikeAnomaly) {
      anomalies.push(errorSpikeAnomaly);
    }

    // Detect throughput drops
    const throughputAnomaly = this.detectThroughputAnomalies();
    if (throughputAnomaly) {
      anomalies.push(throughputAnomaly);
    }

    // Detect dependency issues
    const dependencyAnomaly = this.detectDependencyIssues(recentSpans);
    if (dependencyAnomaly) {
      anomalies.push(dependencyAnomaly);
    }

    this.anomaliesDetected += anomalies.length;

    return anomalies;
  }

  /**
   * Export tracing statistics
   */
  @ObservabilityMonitored({
    tracing: true,
    profiling: true,
  })
  public getTracingStatistics() {
    const completedWithDuration = this.completedSpans.filter(s => s.duration !== undefined);
    const avgDuration = completedWithDuration.length > 0
      ? completedWithDuration.reduce((sum, s) => sum + s.duration!, 0) / completedWithDuration.length
      : 0;

    const uptime = Date.now() - this.metadata.startTime.getTime();
    const throughput = this.getCurrentThroughput();

    return {
      activeSpans: this.activeSpans.size,
      completedSpans: this.completedSpans.length,
      services: this.serviceMap.size,
      averageSpanDuration: avgDuration,
      spansProcessed: this.spansProcessed,
      tracesStarted: this.tracesStarted,
      tracesCompleted: this.tracesCompleted,
      anomaliesDetected: this.anomaliesDetected,
      exportBatches: this.exportBatches,
      currentSampleRate: this.currentSampleRate,
      throughput,
      uptime,
      spansPerSecond: this.spansProcessed / (uptime / 1000),
      errorRate: this.calculateRecentErrorRate(),
    };
  }

  /**
   * Get current trace context
   */
  public getCurrentTraceContext(): TraceContext | undefined {
    return this.traceStorage.getStore();
  }

  /**
   * Get current span ID
   */
  public getCurrentSpanId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().spanId;
  }

  /**
   * Get current trace ID
   */
  public getCurrentTraceId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    return activeSpan?.spanContext().traceId;
  }

  /**
   * Create trace headers for propagation
   */
  public getTraceHeaders(): Record<string, string> {
    const traceId = this.getCurrentTraceId();
    const spanId = this.getCurrentSpanId();

    if (!traceId || !spanId) {
      return {};
    }

    const headers: Record<string, string> = {
      'X-Trace-Id': traceId,
      'X-Span-Id': spanId,
    };

    // W3C Trace Context
    headers['traceparent'] = `00-${traceId}-${spanId}-01`;

    // B3 propagation if enabled
    if (this.config.enableB3Propagation) {
      headers['X-B3-TraceId'] = traceId;
      headers['X-B3-SpanId'] = spanId;
      headers['X-B3-Sampled'] = '1';
    }

    // Jaeger propagation if enabled
    if (this.config.enableJaegerPropagation) {
      headers['uber-trace-id'] = `${traceId}:${spanId}:0:1`;
    }

    return headers;
  }

  /**
   * Extract trace context from headers
   */
  public extractTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    // Try W3C Trace Context first
    const traceparent = headers['traceparent'] as string;
    if (traceparent) {
      const match = traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-(.*)$/);
      if (match) {
        return {
          traceId: match[1],
          spanId: match[2],
          flags: parseInt(match[3], 16),
        };
      }
    }

    // Try custom headers
    const traceId = headers['x-trace-id'] as string;
    const spanId = headers['x-span-id'] as string;
    if (traceId && spanId) {
      return { traceId, spanId };
    }

    // Try B3 propagation
    if (this.config.enableB3Propagation) {
      const b3TraceId = headers['x-b3-traceid'] as string;
      const b3SpanId = headers['x-b3-spanid'] as string;
      if (b3TraceId && b3SpanId) {
        return {
          traceId: b3TraceId,
          spanId: b3SpanId,
        };
      }
    }

    return null;
  }

  /**
   * Private helper methods
   */

  private setupTracer(): void {
    this.tracer = trace.getTracer(
      this.config.serviceName,
      this.config.serviceVersion
    );
  }

  private startBackgroundTasks(): void {
    // Cleanup task
    setInterval(() => {
      this.performCleanup();
    }, this.config.retention.cleanupInterval);

    // Analytics and anomaly detection
    setInterval(() => {
      this.performAnalyticsAndDetection();
    }, 60000); // Every minute

    // Export batching
    if (this.config.export.enableBatching) {
      setInterval(() => {
        this.flushPendingSpans();
      }, this.config.export.batchTimeout);
    }
  }

  private setupAdaptiveSampling(): void {
    setInterval(() => {
      this.adjustSampleRate();
    }, 10000); // Every 10 seconds
  }

  private shouldSample(): boolean {
    return Math.random() < this.currentSampleRate;
  }

  private createNoOpSpan(): Span {
    // Return a no-op span for non-sampled traces
    return {
      spanContext: () => ({ traceId: 'noop', spanId: 'noop' }),
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

  private trackSpanStart(span: Span, options: SpanOptions): void {
    const spanInfo: SpanInfo = {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: this.getCurrentSpanId(),
      operationName: options.name,
      startTime: Date.now(),
      tags: options.attributes || {},
      logs: [],
      status: 'ok',
      errorCount: 0,
      childSpanCount: 0,
    };

    this.activeSpans.set(spanInfo.spanId, spanInfo);
    this.tracesStarted++;

    this.emit('trace:span-started', {
      traceId: spanInfo.traceId,
      spanId: spanInfo.spanId,
      operation: spanInfo.operationName,
      parentSpanId: spanInfo.parentSpanId,
      tags: spanInfo.tags,
    });
  }

  private finishSpan(span: Span, status: 'ok' | 'error' | 'timeout', error?: Error): void {
    const spanContext = span.spanContext();
    const spanInfo = this.activeSpans.get(spanContext.spanId);

    if (spanInfo) {
      spanInfo.duration = Date.now() - spanInfo.startTime;
      spanInfo.status = status;

      if (error) {
        spanInfo.errorCount++;
        span.recordException(error);
      }

      // Move to completed spans
      this.activeSpans.delete(spanContext.spanId);
      this.completedSpans.push(spanInfo);
      this.spansProcessed++;
      this.tracesCompleted++;

      // Update service map
      this.updateServiceMap(spanInfo);

      // Update throughput tracking
      this.updateThroughputTracking();

      // Emit completion event handled by decorator
    }

    // Set OpenTelemetry span status
    if (status === 'error') {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message || 'Operation failed',
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  private updateThroughputTracking(): void {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    // Remove old entries
    this.throughputTracker = this.throughputTracker.filter(
      entry => entry.timestamp > windowStart
    );

    // Add current entry
    this.throughputTracker.push({ timestamp: now, count: 1 });
  }

  private getCurrentThroughput(): number {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    const recentEntries = this.throughputTracker.filter(
      entry => entry.timestamp > windowStart
    );

    return recentEntries.reduce((sum, entry) => sum + entry.count, 0);
  }

  private adjustSampleRate(): void {
    if (!this.config.sampling.enableAdaptiveSampling) {
      return;
    }

    const currentThroughput = this.getCurrentThroughput();
    const targetThroughput = this.config.sampling.targetThroughput;

    if (currentThroughput > targetThroughput * 1.2) {
      // Reduce sample rate
      this.currentSampleRate = Math.max(
        this.config.sampling.minSampleRate,
        this.currentSampleRate * 0.9
      );
    } else if (currentThroughput < targetThroughput * 0.8) {
      // Increase sample rate
      this.currentSampleRate = Math.min(
        this.config.sampling.maxSampleRate,
        this.currentSampleRate * 1.1
      );
    }

    if (this.currentSampleRate !== this.config.sampleRate) {
      this.emit('trace:sampling-decision', {
        traceId: 'adaptive',
        sampled: true,
        reason: 'adaptive-adjustment',
        samplingRate: this.currentSampleRate,
      });
    }
  }

  private performCleanup(): void {
    const now = Date.now();
    const cutoffTime = now - this.config.retention.cleanupInterval * 2;

    // Clean completed spans
    const beforeCount = this.completedSpans.length;
    this.completedSpans = this.completedSpans.filter(
      span => span.startTime > cutoffTime
    );

    // Keep only max number of spans
    if (this.completedSpans.length > this.config.retention.maxCompletedSpans) {
      this.completedSpans = this.completedSpans.slice(-this.config.retention.maxCompletedSpans);
    }

    // Clean up old throughput data
    this.throughputTracker = this.throughputTracker.filter(
      entry => entry.timestamp > now - 300000 // 5 minutes
    );

    this.lastCleanup = now;

    const cleanedCount = beforeCount - this.completedSpans.length;
    if (cleanedCount > 0) {
      logger.debug('Cleaned up trace data', { cleanedSpans: cleanedCount });
    }
  }

  private async performAnalyticsAndDetection(): Promise<void> {
    try {
      // Detect anomalies
      const anomalies = this.detectTraceAnomalies();
      
      for (const anomaly of anomalies) {
        logger.warn('Trace anomaly detected', anomaly);
        // Emit anomaly events would be handled here
      }

      // Update service map
      this.generateEnhancedServiceMap(this.completedSpans.slice(-1000));

    } catch (error) {
      logger.error('Error in analytics and detection', error);
    }
  }

  private async flushPendingSpans(): Promise<void> {
    // In real implementation, this would export spans to configured backends
    if (this.completedSpans.length > 0) {
      this.exportBatches++;
      
      this.emit('trace:export-batch', {
        spans: this.completedSpans.length,
        traceIds: [...new Set(this.completedSpans.map(s => s.traceId))],
        exporter: 'batch',
        duration: 0,
      });
    }
  }

  private sanitizeQuery(query: string): string {
    return query
      .replace(/password\s*=\s*['"][^'"]*['"]/gi, "password='***'")
      .replace(/token\s*=\s*['"][^'"]*['"]/gi, "token='***'")
      .replace(/secret\s*=\s*['"][^'"]*['"]/gi, "secret='***'")
      .substring(0, 1000);
  }

  private sanitizeVariables(variables: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(variables)) {
      const isSensitive = sensitiveKeys.some(sensitive =>
        key.toLowerCase().includes(sensitive)
      );

      if (isSensitive) {
        sanitized[key] = '***';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = '[Object]';
      } else if (Array.isArray(value)) {
        sanitized[key] = `[Array(${value.length})]`;
      } else {
        sanitized[key] = String(value).substring(0, 100);
      }
    }

    return sanitized;
  }

  private updateServiceMap(spanInfo: SpanInfo): void {
    const serviceName = this.config.serviceName;
    const remoteService = spanInfo.tags['service.remote'] as string || 'unknown';

    if (!this.serviceMap.has(serviceName)) {
      this.serviceMap.set(serviceName, new Map());
    }

    const serviceConnections = this.serviceMap.get(serviceName)!;
    const existing = serviceConnections.get(remoteService) || {
      callCount: 0,
      errorCount: 0,
      totalDuration: 0,
      lastCall: 0,
    };

    existing.callCount++;
    if (spanInfo.status === 'error') {
      existing.errorCount++;
    }
    existing.totalDuration += spanInfo.duration || 0;
    existing.lastCall = Date.now();

    serviceConnections.set(remoteService, existing);
  }

  private generateEnhancedServiceMap(spans: SpanInfo[]) {
    const serviceMap = [];
    const now = Date.now();

    for (const [fromService, connections] of this.serviceMap) {
      for (const [toService, stats] of connections) {
        const recentCalls = spans.filter(span => 
          span.tags['service.remote'] === toService &&
          span.startTime > now - 300000 // Last 5 minutes
        );

        serviceMap.push({
          from: fromService,
          to: toService,
          callCount: stats.callCount,
          errorCount: stats.errorCount,
          avgDuration: stats.totalDuration / stats.callCount,
          throughput: recentCalls.length / 5, // Per minute
        });
      }
    }

    return serviceMap;
  }

  private findCriticalPath(spans: SpanInfo[]): string[] {
    const sortedByDuration = spans
      .filter(span => span.duration !== undefined)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0));

    return sortedByDuration.slice(0, 5).map(span => span.operationName);
  }

  private identifyBottlenecks(spans: SpanInfo[]) {
    const operationStats = new Map<string, { totalDuration: number; count: number }>();

    for (const span of spans) {
      if (span.duration) {
        const existing = operationStats.get(span.operationName) || { totalDuration: 0, count: 0 };
        existing.totalDuration += span.duration;
        existing.count++;
        operationStats.set(span.operationName, existing);
      }
    }

    const bottlenecks = [];
    for (const [operation, stats] of operationStats) {
      const avgDuration = stats.totalDuration / stats.count;
      if (avgDuration > 1000 && stats.count >= 5) { // Over 1 second average with at least 5 calls
        bottlenecks.push({
          operation,
          avgDuration,
          frequency: stats.count,
          impact: avgDuration * stats.count,
        });
      }
    }

    return bottlenecks.sort((a, b) => b.impact - a.impact).slice(0, 10);
  }

  private detectSlowTraces(spans: SpanInfo[]): TraceAnomaly | null {
    if (!this.config.performance.enableSlowTraceDetection) {
      return null;
    }

    const avgDuration = spans.reduce((sum, span) => sum + (span.duration || 0), 0) / spans.length;
    const slowTraces = spans.filter(span => 
      (span.duration || 0) > Math.max(avgDuration * 3, this.config.performance.slowTraceThreshold)
    );

    if (slowTraces.length > 10) {
      return {
        type: 'slow_trace',
        description: `${slowTraces.length} traces are significantly slower than average (${Math.round(avgDuration)}ms)`,
        severity: slowTraces.length > 50 ? 'critical' : 'high',
        traces: slowTraces.map(s => s.traceId).slice(0, 5),
        recommendations: [
          'Check for database performance issues',
          'Review external service dependencies',
          'Consider adding caching or optimization',
          'Investigate memory or CPU bottlenecks',
        ],
        detectedAt: Date.now(),
        confidence: Math.min(slowTraces.length / 50, 1),
      };
    }

    return null;
  }

  private detectErrorSpikes(spans: SpanInfo[]): TraceAnomaly | null {
    if (!this.config.performance.enableAnomalyDetection) {
      return null;
    }

    const errorSpans = spans.filter(span => span.status === 'error');
    const errorRate = errorSpans.length / spans.length;

    if (errorRate > this.config.performance.errorRateThreshold) {
      return {
        type: 'error_spike',
        description: `Error rate is ${Math.round(errorRate * 100)}%, above normal threshold of ${this.config.performance.errorRateThreshold * 100}%`,
        severity: errorRate > 0.15 ? 'critical' : 'high',
        traces: errorSpans.map(s => s.traceId).slice(0, 5),
        recommendations: [
          'Check service health and dependencies',
          'Review recent deployments or configuration changes',
          'Monitor system resources (CPU, memory, disk)',
          'Investigate error patterns and root causes',
        ],
        detectedAt: Date.now(),
        confidence: Math.min(errorRate / 0.2, 1),
      };
    }

    return null;
  }

  private detectThroughputAnomalies(): TraceAnomaly | null {
    const currentThroughput = this.getCurrentThroughput();
    const recentThroughput = this.throughputTracker.slice(-5); // Last 5 measurements
    
    if (recentThroughput.length < 3) {
      return null;
    }

    const avgRecentThroughput = recentThroughput.reduce((sum, entry) => sum + entry.count, 0) / recentThroughput.length;
    
    if (currentThroughput < avgRecentThroughput * 0.5) {
      return {
        type: 'throughput_drop',
        description: `Throughput dropped to ${currentThroughput}/min, down from average ${Math.round(avgRecentThroughput)}/min`,
        severity: 'high',
        traces: [],
        recommendations: [
          'Check for upstream service issues',
          'Verify load balancer configuration',
          'Monitor system resources',
          'Review rate limiting settings',
        ],
        detectedAt: Date.now(),
        confidence: 0.8,
      };
    }

    return null;
  }

  private detectDependencyIssues(spans: SpanInfo[]): TraceAnomaly | null {
    const dependencyErrors = new Map<string, number>();
    
    for (const span of spans) {
      if (span.status === 'error' && span.tags['service.remote']) {
        const service = span.tags['service.remote'] as string;
        dependencyErrors.set(service, (dependencyErrors.get(service) || 0) + 1);
      }
    }

    for (const [service, errorCount] of dependencyErrors) {
      const serviceSpans = spans.filter(s => s.tags['service.remote'] === service);
      const errorRate = errorCount / serviceSpans.length;
      
      if (errorRate > 0.2 && errorCount >= 5) { // 20% error rate with at least 5 errors
        return {
          type: 'dependency_issue',
          description: `High error rate (${Math.round(errorRate * 100)}%) detected for dependency: ${service}`,
          severity: errorRate > 0.5 ? 'critical' : 'high',
          traces: spans.filter(s => s.tags['service.remote'] === service && s.status === 'error')
                      .map(s => s.traceId).slice(0, 5),
          recommendations: [
            `Check health of ${service} service`,
            'Verify network connectivity',
            'Review service configuration',
            'Consider implementing circuit breaker',
          ],
          detectedAt: Date.now(),
          confidence: Math.min(errorRate / 0.5, 1),
        };
      }
    }

    return null;
  }

  private getRecentSpansCount(timeWindow: number): number {
    const cutoff = Date.now() - timeWindow;
    return this.completedSpans.filter(span => span.startTime > cutoff).length;
  }

  private calculateRecentErrorRate(): number {
    const recentSpans = this.completedSpans.slice(-100);
    if (recentSpans.length === 0) return 0;
    
    const errorCount = recentSpans.filter(span => span.status === 'error').length;
    return errorCount / recentSpans.length;
  }

  private getEmptyAnalytics(): TraceAnalytics {
    return {
      totalSpans: 0,
      errorRate: 0,
      averageDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      serviceMap: [],
      criticalPath: [],
      bottlenecks: [],
    };
  }

  private extractRowsAffected(result: any): number {
    if (result && typeof result.rowCount === 'number') {
      return result.rowCount;
    }
    if (result && typeof result.changes === 'number') {
      return result.changes;
    }
    return 0;
  }

  private extractResponseSize(result: any): number {
    if (result && typeof result === 'string') {
      return result.length;
    }
    if (result && typeof result === 'object') {
      return JSON.stringify(result).length;
    }
    return 0;
  }

  private extractResolverCount(result: any): number {
    // In a real GraphQL implementation, this would count the number of resolvers executed
    return 1;
  }
}