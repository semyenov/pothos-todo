import { trace, context, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';
import { logger } from '@/logger.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { CompositePropagator } from '@opentelemetry/core';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
}

export interface SpanOptions {
  name: string;
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parent?: Span;
}

export interface DatabaseSpanOptions extends SpanOptions {
  operation: string;
  table?: string;
  query?: string;
}

export interface HttpSpanOptions extends SpanOptions {
  method: string;
  url: string;
  statusCode?: number;
}

export interface GraphQLSpanOptions extends SpanOptions {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName?: string;
  complexity?: number;
  variables?: Record<string, any>;
}

import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  jaegerEndpoint?: string;
  zipkinEndpoint?: string;
  sampleRate: number;
  enableB3Propagation: boolean;
  enableJaegerPropagation: boolean;
  enableBaggage: boolean;
}

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
}

export interface TraceAnalytics {
  totalSpans: number;
  errorRate: number;
  averageDuration: number;
  p95Duration: number;
  p99Duration: number;
  serviceMap: Array<{
    from: string;
    to: string;
    callCount: number;
    errorCount: number;
    avgDuration: number;
  }>;
  criticalPath: string[];
}
type DistributedTracingEventMap = {
  initialized: [];
}
export class DistributedTracing extends EventEmitterSingletonService<DistributedTracingEventMap> {
  private tracer = trace.getTracer('pothos-todo-api');
  private traceStorage = new AsyncLocalStorage<TraceContext>();
  private metrics: MetricsCollector | null = null;
  private config: TracingConfig | null = null;
  private activeSpans: Map<string, SpanInfo> = new Map();
  private completedSpans: SpanInfo[] = [];
  private serviceMap: Map<string, Map<string, any>> = new Map();
  private initialized: boolean = false;

  public configure(config: TracingConfig): void {
    this.config = config;
    this.metrics = MetricsCollector.getInstance();
  }

  private ensureConfig(): TracingConfig {
    if (!this.config) {
      throw new Error('DistributedTracing not configured');
    }
    return this.config;
  }

  private ensureMetrics(): MetricsCollector {
    if (!this.metrics) {
      throw new Error('DistributedTracing metrics not initialized');
    }
    return this.metrics;
  }

  public static override getInstance(config?: TracingConfig): DistributedTracing {
    const instance = super.getInstance() as DistributedTracing;
    if (config && !instance.config) {
      instance.configure(config);
    }
    return instance;
  }

  /**
   * Initialize distributed tracing with comprehensive configuration
   */
  public async initialize(): Promise<void> {
    try {
      if (this.initialized) {
        logger.warn('Distributed tracing already initialized');
        return;
      }

      // Setup span collection
      this.setupSpanCollection();

      this.initialized = true;

      logger.info('Distributed tracing initialized', {
        serviceName: this.ensureConfig().serviceName,
        sampleRate: this.ensureConfig().sampleRate,
      });

      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize distributed tracing', error);
      throw error;
    }
  }

  /**
   * Start a new span with automatic context management
   */
  public async startSpan<T>(
    options: SpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(options.name, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes,
    }, options.parent ? trace.setSpan(context.active(), options.parent) : undefined);

    const traceContext: TraceContext = {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: this.getCurrentSpanId(),
    };

    try {
      return await this.traceStorage.run(traceContext, async () => {
        const result = await trace.getTracer('pothos-todo-api').startActiveSpan(
          options.name,
          {
            kind: options.kind || SpanKind.INTERNAL,
            attributes: options.attributes
          },
          async (activeSpan) => {
            try {
              const result = await fn(activeSpan);
              activeSpan.setStatus({ code: SpanStatusCode.OK });
              return result;
            } catch (error) {
              activeSpan.recordException(error as Error);
              activeSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: (error as Error).message,
              });
              throw error;
            } finally {
              activeSpan.end();
            }
          }
        );
        return result;
      });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Create a database operation span
   */
  public async traceDatabaseOperation<T>(
    options: DatabaseSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'db.operation': options.operation,
      'db.system': 'postgresql',
      ...(options.table && { 'db.name': options.table }),
      ...(options.query && { 'db.statement': this.sanitizeQuery(options.query) }),
      ...options.attributes,
    };

    return this.startSpan({
      name: `db.${options.operation}${options.table ? ` ${options.table}` : ''}`,
      kind: SpanKind.CLIENT,
      attributes,
    }, async (span) => {
      const start = Date.now();

      try {
        const result = await fn(span);
        const duration = Date.now() - start;

        span.setAttributes({
          'db.duration': duration,
        });

        this.ensureMetrics().recordMetric('db.operation.duration', duration, {
          operation: options.operation,
          table: options.table || 'unknown',
        });

        return result;
      } catch (error) {
        this.ensureMetrics().recordMetric('db.operation.error', 1, {
          operation: options.operation,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Create an HTTP request span
   */
  public async traceHttpRequest<T>(
    options: HttpSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'http.method': options.method,
      'http.url': options.url,
      'http.scheme': new URL(options.url).protocol.replace(':', ''),
      'http.host': new URL(options.url).host,
      ...options.attributes,
    };

    return this.startSpan({
      name: `HTTP ${options.method}`,
      kind: SpanKind.CLIENT,
      attributes,
    }, async (span) => {
      const start = Date.now();

      try {
        const result = await fn(span);
        const duration = Date.now() - start;

        span.setAttributes({
          'http.status_code': options.statusCode || 200,
          'http.response_time': duration,
        });

        this.ensureMetrics().recordMetric('http.request.duration', duration, {
          method: options.method,
          status: String(options.statusCode || 200),
        });

        return result;
      } catch (error) {
        span.setAttributes({
          'http.status_code': 500,
        });

        this.ensureMetrics().recordMetric('http.request.error', 1, {
          method: options.method,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Create a GraphQL operation span
   */
  public async traceGraphQLOperation<T>(
    options: GraphQLSpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const attributes = {
      'graphql.operation.type': options.operationType,
      ...(options.operationName && { 'graphql.operation.name': options.operationName }),
      ...(options.complexity && { 'graphql.query.complexity': options.complexity }),
      ...options.attributes,
    };

    // Add sanitized variables as attributes (without sensitive data)
    if (options.variables) {
      const sanitizedVars = this.sanitizeVariables(options.variables);
      Object.entries(sanitizedVars).forEach(([key, value]) => {
        (attributes as Record<string, string | number | boolean | undefined | null | object>)[`graphql.variable.${key}`] = String(value);
      });
    }

    return this.startSpan({
      name: `GraphQL ${options.operationType}${options.operationName ? ` ${options.operationName}` : ''}`,
      kind: SpanKind.SERVER,
      attributes,
    }, async (span) => {
      const start = Date.now();

      try {
        const result = await fn(span);
        const duration = Date.now() - start;

        span.setAttributes({
          'graphql.execution.duration': duration,
        });

        this.ensureMetrics().recordMetric('graphql.operation.duration', duration, {
          operationType: options.operationType,
          operationName: options.operationName || 'unknown',
        });

        return result;
      } catch (error) {
        this.ensureMetrics().recordMetric('graphql.operation.error', 1, {
          operationType: options.operationType,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Create a span for AI operations
   */
  public async traceAIOperation<T>(
    operationType: string,
    model: string,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    return this.startSpan({
      name: `AI ${operationType}`,
      kind: SpanKind.CLIENT,
      attributes: {
        'ai.operation': operationType,
        'ai.model': model,
        'ai.provider': 'openai',
      },
    }, async (span) => {
      const start = Date.now();

      try {
        const result = await fn(span);
        const duration = Date.now() - start;

        span.setAttributes({
          'ai.duration': duration,
        });

        this.ensureMetrics().recordMetric('ai.operation.duration', duration, {
          operation: operationType,
          model,
        });

        return result;
      } catch (error) {
        this.ensureMetrics().recordMetric('ai.operation.error', 1, {
          operation: operationType,
          error: (error as Error).message,
        });
        throw error;
      }
    });
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
   * Add baggage to current trace context
   */
  public setBaggage(key: string, value: string): void {
    const currentContext = this.getCurrentTraceContext();
    if (currentContext) {
      currentContext.baggage = {
        ...currentContext.baggage,
        [key]: value,
      };
    }
  }

  /**
   * Get baggage from current trace context
   */
  public getBaggage(key: string): string | undefined {
    const currentContext = this.getCurrentTraceContext();
    return currentContext?.baggage?.[key];
  }

  /**
   * Create a child span from current context
   */
  public createChildSpan(name: string, attributes?: Record<string, any>): Span {
    return this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes,
    });
  }

  /**
   * Sanitize database query for tracing (remove sensitive data)
   */
  private sanitizeQuery(query: string): string {
    // Remove potential sensitive data from queries
    return query
      .replace(/password\s*=\s*['"][^'"]*['"]/gi, "password='***'")
      .replace(/token\s*=\s*['"][^'"]*['"]/gi, "token='***'")
      .replace(/secret\s*=\s*['"][^'"]*['"]/gi, "secret='***'")
      .substring(0, 500); // Limit query length
  }

  /**
   * Sanitize GraphQL variables for tracing
   */
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

  /**
   * Create trace headers for outgoing requests
   */
  public getTraceHeaders(): Record<string, string> {
    const traceId = this.getCurrentTraceId();
    const spanId = this.getCurrentSpanId();

    if (!traceId || !spanId) {
      return {};
    }

    return {
      'X-Trace-Id': traceId,
      'X-Span-Id': spanId,
      'traceparent': `00-${traceId}-${spanId}-01`,
    };
  }

  /**
   * Extract trace context from incoming headers
   */
  public extractTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    const traceId = headers['x-trace-id'] as string;
    const spanId = headers['x-span-id'] as string;
    const traceparent = headers['traceparent'] as string;

    if (traceparent) {
      // Parse W3C traceparent header: version-traceid-spanid-flags
      const parts = traceparent.split('-');
      if (parts.length === 4) {
        return {
          traceId: parts[1] || '',
          spanId: parts[2] || '',
          parentSpanId: spanId,
        };
      }
    }

    if (traceId && spanId) {
      return {
        traceId,
        spanId,
      };
    }

    return null;
  }

  /**
   * Log with trace context
   */
  public logWithTrace(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: any): void {
    const traceContext = this.getCurrentTraceContext();

    const logMeta = {
      ...meta,
      ...(traceContext && {
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
      }),
    };

    logger[level](message, logMeta);
  }

  /**
   * Start a new distributed trace
   */
  public startTrace(
    operationName: string,
    parentContext?: any,
    tags?: Record<string, any>
  ): Span {
    const span = this.tracer.startSpan(operationName, {
      kind: SpanKind.SERVER,
      attributes: {
        'service.name': this.ensureConfig().serviceName,
        'service.version': this.ensureConfig().serviceVersion,
        'environment': this.ensureConfig().environment,
      },
    });

    // Add standard tags
    span.setAttributes({
      'service.name': this.ensureConfig().serviceName,
      'service.version': this.ensureConfig().serviceVersion,
      'environment': this.ensureConfig().environment,
    });

    // Add custom tags
    if (tags) {
      Object.entries(tags).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    // Track span
    const spanInfo: SpanInfo = {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: parentContext?.spanId,
      operationName,
      startTime: Date.now(),
      tags: tags || {},
      logs: [],
      status: 'ok',
    };

    this.activeSpans.set(spanInfo.spanId, spanInfo);

    logger.debug('Trace started', {
      traceId: spanInfo.traceId,
      spanId: spanInfo.spanId,
      operationName,
    });

    return span;
  }

  /**
   * Add structured logging to span
   */
  public addSpanLog(
    span: Span,
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    fields?: Record<string, any>
  ): void {
    const spanContext = span.spanContext();
    const spanInfo = this.activeSpans.get(spanContext.spanId);

    if (spanInfo) {
      spanInfo.logs.push({
        timestamp: Date.now(),
        fields: {
          level,
          message,
          ...fields,
        },
      });
    }

    // Also add as span event
    span.addEvent(message, {
      level,
      ...fields,
    });
  }

  /**
   * Set span status and finish
   */
  public finishSpan(
    span: Span,
    status: 'ok' | 'error' | 'timeout' = 'ok',
    error?: Error
  ): void {
    const spanContext = span.spanContext();
    const spanInfo = this.activeSpans.get(spanContext.spanId);

    if (spanInfo) {
      spanInfo.duration = Date.now() - spanInfo.startTime;
      spanInfo.status = status;

      // Move to completed spans
      this.activeSpans.delete(spanContext.spanId);
      this.completedSpans.push(spanInfo);

      // Update service map
      this.updateServiceMap(spanInfo);

      // Keep only recent completed spans
      if (this.completedSpans.length > 10000) {
        this.completedSpans = this.completedSpans.slice(-5000);
      }
    }

    // Set OpenTelemetry span status
    if (status === 'error') {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message || 'Operation failed',
      });
      if (error) {
        span.recordException(error);
      }
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();

    logger.debug('Span finished', {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      status,
      duration: spanInfo?.duration,
    });
  }

  /**
   * Generate comprehensive trace analytics
   */
  public getTraceAnalytics(timeRange?: { start: Date; end: Date }): TraceAnalytics {
    let spans = this.completedSpans;

    // Filter by time range if provided
    if (timeRange) {
      spans = spans.filter(span => {
        const spanTime = new Date(span.startTime);
        return spanTime >= timeRange.start && spanTime <= timeRange.end;
      });
    }

    if (spans.length === 0) {
      return {
        totalSpans: 0,
        errorRate: 0,
        averageDuration: 0,
        p95Duration: 0,
        p99Duration: 0,
        serviceMap: [],
        criticalPath: [],
      };
    }

    // Calculate metrics
    const totalSpans = spans.length;
    const errorSpans = spans.filter(span => span.status === 'error').length;
    const errorRate = errorSpans / totalSpans;

    const durations = spans
      .filter(span => span.duration !== undefined)
      .map(span => span.duration!)
      .sort((a, b) => a - b);

    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const p95Duration = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99Duration = durations[Math.floor(durations.length * 0.99)] || 0;

    // Generate service map
    const serviceMap = this.generateServiceMap();

    // Find critical path (simplified)
    const criticalPath = this.findCriticalPath(spans);

    return {
      totalSpans,
      errorRate,
      averageDuration,
      p95Duration,
      p99Duration,
      serviceMap,
      criticalPath,
    };
  }

  /**
   * Get trace timeline for specific trace ID
   */
  public getTraceTimeline(traceId: string): Array<{
    spanId: string;
    operationName: string;
    startTime: number;
    duration: number;
    level: number;
    status: string;
  }> {
    const traceSpans = this.completedSpans.filter(span => span.traceId === traceId);

    // Build hierarchy
    const timeline = traceSpans.map(span => ({
      spanId: span.spanId,
      operationName: span.operationName,
      startTime: span.startTime,
      duration: span.duration || 0,
      level: this.calculateSpanLevel(span, traceSpans),
      status: span.status,
    }));

    // Sort by start time
    return timeline.sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Monitor trace performance and detect anomalies
   */
  public detectTraceAnomalies(): Array<{
    type: 'slow_trace' | 'error_spike' | 'memory_leak' | 'dependency_issue';
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    traces: string[];
    recommendations: string[];
  }> {
    const anomalies = [];
    const recentSpans = this.completedSpans.slice(-1000); // Last 1000 spans

    // Detect slow traces
    const avgDuration = recentSpans.reduce((sum, span) => sum + (span.duration || 0), 0) / recentSpans.length;
    const slowTraces = recentSpans.filter(span => (span.duration || 0) > avgDuration * 3);

    if (slowTraces.length > 10) {
      anomalies.push({
        type: 'slow_trace' as const,
        description: `${slowTraces.length} traces are significantly slower than average`,
        severity: 'high' as const,
        traces: slowTraces.map(s => s.traceId).slice(0, 5),
        recommendations: [
          'Check for database performance issues',
          'Review external service dependencies',
          'Consider adding caching',
        ],
      });
    }

    // Detect error spikes
    const errorSpans = recentSpans.filter(span => span.status === 'error');
    const errorRate = errorSpans.length / recentSpans.length;

    if (errorRate > 0.05) { // More than 5% error rate
      anomalies.push({
        type: 'error_spike' as const,
        description: `Error rate is ${Math.round(errorRate * 100)}%, above normal threshold`,
        severity: errorRate > 0.15 ? 'critical' as const : 'high' as const,
        traces: errorSpans.map(s => s.traceId).slice(0, 5),
        recommendations: [
          'Check service health and dependencies',
          'Review recent deployments',
          'Monitor system resources',
        ],
      });
    }

    return anomalies;
  }

  /**
   * Export trace data for external analysis
   */
  public exportTraceData(_format: 'jaeger' | 'zipkin' | 'json' = 'json') {
    const exportData = {
      traces: this.completedSpans.map(span => ({
        traceID: span.traceId,
        spanID: span.spanId,
        parentSpanID: span.parentSpanId,
        operationName: span.operationName,
        startTime: span.startTime * 1000, // Convert to microseconds
        duration: (span.duration || 0) * 1000,
        tags: Object.entries(span.tags).map(([key, value]) => ({
          key,
          value: String(value),
        })),
        logs: span.logs.map(log => ({
          timestamp: log.timestamp * 1000,
          fields: Object.entries(log.fields).map(([key, value]) => ({
            key,
            value: String(value),
          })),
        })),
        process: {
          serviceName: this.ensureConfig().serviceName,
          tags: [
            { key: 'service.version', value: this.ensureConfig().serviceVersion },
            { key: 'environment', value: this.ensureConfig().environment },
          ],
        },
      })),
      serviceMap: this.generateServiceMap(),
      analytics: this.getTraceAnalytics(),
    };

    return exportData;
  }

  /**
   * Get current tracing statistics
   */
  public getTracingStats(): {
    activeSpans: number;
    completedSpans: number;
    services: number;
    averageSpanDuration: number;
  } {
    const completedWithDuration = this.completedSpans.filter(s => s.duration !== undefined);
    const avgDuration = completedWithDuration.length > 0
      ? completedWithDuration.reduce((sum, s) => sum + s.duration!, 0) / completedWithDuration.length
      : 0;

    return {
      activeSpans: this.activeSpans.size,
      completedSpans: this.completedSpans.length,
      services: this.serviceMap.size,
      averageSpanDuration: avgDuration,
    };
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    this.activeSpans.clear();
    this.completedSpans = [];
    this.serviceMap.clear();
    logger.info('Distributed tracing cleaned up');
  }

  // Private helper methods

  private setupSpanCollection(): void {
    // In a real implementation, you would setup span processors
    // to collect and forward spans to your tracing backend
    logger.debug('Span collection setup completed');
  }

  private updateServiceMap(spanInfo: SpanInfo): void {
    const serviceName = this.ensureConfig().serviceName;
    const remoteService = spanInfo.tags['service.remote'] as string;

    if (remoteService) {
      if (!this.serviceMap.has(serviceName)) {
        this.serviceMap.set(serviceName, new Map());
      }

      const serviceConnections = this.serviceMap.get(serviceName)!;
      const existing = serviceConnections.get(remoteService) || {
        callCount: 0,
        errorCount: 0,
        totalDuration: 0,
      };

      existing.callCount++;
      if (spanInfo.status === 'error') {
        existing.errorCount++;
      }
      existing.totalDuration += spanInfo.duration || 0;

      serviceConnections.set(remoteService, existing);
    }
  }

  private generateServiceMap(): Array<{
    from: string;
    to: string;
    callCount: number;
    errorCount: number;
    avgDuration: number;
  }> {
    const serviceMap = [];

    for (const [fromService, connections] of this.serviceMap) {
      for (const [toService, stats] of connections) {
        serviceMap.push({
          from: fromService,
          to: toService,
          callCount: stats.callCount,
          errorCount: stats.errorCount,
          avgDuration: stats.totalDuration / stats.callCount,
        });
      }
    }

    return serviceMap;
  }

  private findCriticalPath(spans: SpanInfo[]): string[] {
    // Simplified critical path detection
    // In reality, this would involve more complex graph analysis
    const sortedSpans = spans
      .filter(span => span.duration !== undefined)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0));

    return sortedSpans.slice(0, 5).map(span => span.operationName);
  }

  private calculateSpanLevel(span: SpanInfo, allSpans: SpanInfo[]): number {
    let level = 0;
    let currentParent = span.parentSpanId;

    while (currentParent) {
      level++;
      const parentSpan = allSpans.find(s => s.spanId === currentParent);
      currentParent = parentSpan?.parentSpanId;
    }

    return level;
  }
}

/**
 * Decorators for automatic tracing
 */
export function TraceMethod(spanName?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const tracing = DistributedTracing.getInstance();

    descriptor.value = async function (...args: any[]) {
      const name = spanName || `${target.constructor.name}.${propertyKey}`;

      return tracing.startSpan({
        name,
        attributes: {
          'method.class': target.constructor.name,
          'method.name': propertyKey,
        },
      }, async () => {
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

export function TraceDatabase(operation: string, table?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const tracing = DistributedTracing.getInstance();

    descriptor.value = async function (...args: any[]) {
      return tracing.traceDatabaseOperation({
        name: `${operation} ${table || 'unknown'}`,
        operation,
        table,
      }, async () => {
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

export function TraceAI(operationType: string, model: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const tracing = DistributedTracing.getInstance();

    descriptor.value = async function (...args: any[]) {
      return tracing.traceAIOperation(operationType, model, async () => {
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

// Export singleton factory
export const createDistributedTracing = (config: TracingConfig) => {
  return DistributedTracing.getInstance(config);
};