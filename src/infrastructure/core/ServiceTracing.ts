import { BaseService, BaseAsyncService } from './BaseService.js';
import { logger } from '@/lib/unjs-utils.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';

interface TraceSpan {
  id: string;
  traceId: string;
  parentId?: string;
  serviceName: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'error';
  tags: Record<string, any>;
  logs: Array<{
    timestamp: number;
    message: string;
    level: 'debug' | 'info' | 'warn' | 'error';
  }>;
  error?: Error;
}

interface Trace {
  id: string;
  rootSpan: TraceSpan;
  spans: Map<string, TraceSpan>;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'error';
  metadata: Record<string, any>;
}

interface TraceSampler {
  shouldSample(trace: Partial<Trace>): boolean;
}

interface TracingEventMap {
  'trace:started': {
    traceId: string;
    serviceName: string;
    operationName: string;
  };
  'trace:completed': {
    traceId: string;
    duration: number;
    status: 'completed' | 'error';
  };
  'span:started': {
    traceId: string;
    spanId: string;
    serviceName: string;
    operationName: string;
  };
  'span:ended': {
    spanId: string;
    duration?: number;
    status: 'completed' | 'error';
  };
}

/**
 * Distributed Tracing System for BaseService
 * Provides comprehensive tracing capabilities across service boundaries
 */
export class ServiceTracing extends TypedEventEmitter<TracingEventMap> {
  private static instance: ServiceTracing;
  private traces: Map<string, Trace> = new Map();
  private activeSpans: Map<string, TraceSpan> = new Map();
  private sampler: TraceSampler;
  private retention: number = 3600000; // 1 hour
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.sampler = new DefaultSampler(1.0); // 100% sampling by default
    this.startCleanup();
  }

  static getInstance(): ServiceTracing {
    if (!ServiceTracing.instance) {
      ServiceTracing.instance = new ServiceTracing();
    }
    return ServiceTracing.instance;
  }

  /**
   * Set trace sampler
   */
  setSampler(sampler: TraceSampler): void {
    this.sampler = sampler;
  }

  /**
   * Start a new trace
   */
  startTrace(
    serviceName: string,
    operationName: string,
    metadata?: Record<string, any>
  ): TraceContext | null {
    const trace: Partial<Trace> = {
      metadata: metadata || {},
    };

    if (!this.sampler.shouldSample(trace)) {
      return null;
    }

    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();

    const rootSpan: TraceSpan = {
      id: spanId,
      traceId,
      serviceName,
      operationName,
      startTime: Date.now(),
      status: 'running',
      tags: {},
      logs: [],
    };

    const fullTrace: Trace = {
      id: traceId,
      rootSpan,
      spans: new Map([[spanId, rootSpan]]),
      startTime: Date.now(),
      status: 'running',
      metadata: metadata || {},
    };

    this.traces.set(traceId, fullTrace);
    this.activeSpans.set(spanId, rootSpan);

    this.emit('trace:started', { traceId, serviceName, operationName });

    return new TraceContext(traceId, spanId, this);
  }

  /**
   * Start a child span
   */
  startSpan(
    traceId: string,
    parentSpanId: string,
    serviceName: string,
    operationName: string,
    tags?: Record<string, any>
  ): TraceContext | null {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return null;
    }

    const spanId = this.generateSpanId();
    const span: TraceSpan = {
      id: spanId,
      traceId,
      parentId: parentSpanId,
      serviceName,
      operationName,
      startTime: Date.now(),
      status: 'running',
      tags: tags || {},
      logs: [],
    };

    trace.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);

    this.emit('span:started', { traceId, spanId, serviceName, operationName });

    return new TraceContext(traceId, spanId, this);
  }

  /**
   * End a span
   */
  endSpan(spanId: string, error?: Error): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = error ? 'error' : 'completed';
    span.error = error;

    this.activeSpans.delete(spanId);

    // Check if trace is complete
    const trace = this.traces.get(span.traceId);
    if (trace) {
      const hasActiveSpans = Array.from(trace.spans.values())
        .some(s => s.status === 'running');
      
      if (!hasActiveSpans) {
        trace.endTime = Date.now();
        trace.status = Array.from(trace.spans.values())
          .some(s => s.status === 'error') ? 'error' : 'completed';
        
        this.emit('trace:completed', { 
          traceId: trace.id,
          duration: trace.endTime - trace.startTime,
          status: trace.status,
        });
      }
    }

    this.emit('span:ended', { 
      spanId,
      duration: span.duration,
      status: span.status,
    });
  }

  /**
   * Add tag to span
   */
  addTag(spanId: string, key: string, value: any): void {
    const span = this.activeSpans.get(spanId) || 
                 this.findSpan(spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  /**
   * Add log to span
   */
  addLog(
    spanId: string, 
    message: string, 
    level: 'debug' | 'info' | 'warn' | 'error' = 'info'
  ): void {
    const span = this.activeSpans.get(spanId) || 
                 this.findSpan(spanId);
    if (span) {
      span.logs.push({
        timestamp: Date.now(),
        message,
        level,
      });
    }
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get recent traces
   */
  getRecentTraces(
    limit: number = 100,
    filter?: {
      serviceName?: string;
      status?: 'running' | 'completed' | 'error';
      minDuration?: number;
      maxDuration?: number;
    }
  ): Trace[] {
    const traces = Array.from(this.traces.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

    let filtered = traces;

    if (filter) {
      filtered = traces.filter(trace => {
        if (filter.serviceName && 
            trace.rootSpan.serviceName !== filter.serviceName) {
          return false;
        }
        
        if (filter.status && trace.status !== filter.status) {
          return false;
        }
        
        if (filter.minDuration && trace.endTime) {
          const duration = trace.endTime - trace.startTime;
          if (duration < filter.minDuration) {
            return false;
          }
        }
        
        if (filter.maxDuration && trace.endTime) {
          const duration = trace.endTime - trace.startTime;
          if (duration > filter.maxDuration) {
            return false;
          }
        }
        
        return true;
      });
    }

    return filtered.slice(0, limit);
  }

  /**
   * Export trace for analysis
   */
  exportTrace(traceId: string): object | null {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return null;
    }

    const spans = Array.from(trace.spans.values())
      .sort((a, b) => a.startTime - b.startTime);

    return {
      traceId: trace.id,
      startTime: new Date(trace.startTime).toISOString(),
      endTime: trace.endTime ? new Date(trace.endTime).toISOString() : null,
      duration: trace.endTime ? trace.endTime - trace.startTime : null,
      status: trace.status,
      metadata: trace.metadata,
      spans: spans.map(span => ({
        spanId: span.id,
        parentId: span.parentId,
        serviceName: span.serviceName,
        operationName: span.operationName,
        startTime: new Date(span.startTime).toISOString(),
        endTime: span.endTime ? new Date(span.endTime).toISOString() : null,
        duration: span.duration,
        status: span.status,
        tags: span.tags,
        logs: span.logs.map(log => ({
          timestamp: new Date(log.timestamp).toISOString(),
          message: log.message,
          level: log.level,
        })),
        error: span.error ? {
          message: span.error.message,
          stack: span.error.stack,
        } : null,
      })),
    };
  }

  /**
   * Get trace statistics
   */
  getStatistics(): {
    totalTraces: number;
    activeTraces: number;
    completedTraces: number;
    errorTraces: number;
    avgDuration: number;
    serviceStats: Map<string, {
      count: number;
      avgDuration: number;
      errorRate: number;
    }>;
  } {
    const stats = {
      totalTraces: this.traces.size,
      activeTraces: 0,
      completedTraces: 0,
      errorTraces: 0,
      totalDuration: 0,
      serviceStats: new Map<string, any>(),
    };

    for (const trace of this.traces.values()) {
      if (trace.status === 'running') {
        stats.activeTraces++;
      } else if (trace.status === 'completed') {
        stats.completedTraces++;
      } else if (trace.status === 'error') {
        stats.errorTraces++;
      }

      if (trace.endTime) {
        stats.totalDuration += trace.endTime - trace.startTime;
      }

      // Service-specific stats
      for (const span of trace.spans.values()) {
        if (!stats.serviceStats.has(span.serviceName)) {
          stats.serviceStats.set(span.serviceName, {
            count: 0,
            totalDuration: 0,
            errorCount: 0,
          });
        }

        const serviceStat = stats.serviceStats.get(span.serviceName)!;
        serviceStat.count++;
        
        if (span.duration) {
          serviceStat.totalDuration += span.duration;
        }
        
        if (span.status === 'error') {
          serviceStat.errorCount++;
        }
      }
    }

    // Calculate averages
    const avgDuration = stats.completedTraces > 0
      ? stats.totalDuration / stats.completedTraces
      : 0;

    // Format service stats
    const formattedServiceStats = new Map();
    for (const [service, stat] of stats.serviceStats.entries()) {
      formattedServiceStats.set(service, {
        count: stat.count,
        avgDuration: stat.count > 0 ? stat.totalDuration / stat.count : 0,
        errorRate: stat.count > 0 ? (stat.errorCount / stat.count) * 100 : 0,
      });
    }

    return {
      totalTraces: stats.totalTraces,
      activeTraces: stats.activeTraces,
      completedTraces: stats.completedTraces,
      errorTraces: stats.errorTraces,
      avgDuration,
      serviceStats: formattedServiceStats,
    };
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private findSpan(spanId: string): TraceSpan | null {
    for (const trace of this.traces.values()) {
      const span = trace.spans.get(spanId);
      if (span) {
        return span;
      }
    }
    return null;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTraces();
    }, 300000); // Every 5 minutes
  }

  private cleanupOldTraces(): void {
    const cutoff = Date.now() - this.retention;
    let cleaned = 0;

    for (const [traceId, trace] of this.traces.entries()) {
      if (trace.status !== 'running' && trace.startTime < cutoff) {
        this.traces.delete(traceId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old traces`);
    }
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Trace context for managing current trace/span
 */
export class TraceContext {
  constructor(
    private traceId: string,
    private spanId: string,
    private tracing: ServiceTracing
  ) {}

  /**
   * Start a child span
   */
  startSpan(
    serviceName: string,
    operationName: string,
    tags?: Record<string, any>
  ): TraceContext | null {
    return this.tracing.startSpan(
      this.traceId,
      this.spanId,
      serviceName,
      operationName,
      tags
    );
  }

  /**
   * Add tag to current span
   */
  addTag(key: string, value: any): void {
    this.tracing.addTag(this.spanId, key, value);
  }

  /**
   * Add log to current span
   */
  log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    this.tracing.addLog(this.spanId, message, level);
  }

  /**
   * End current span
   */
  end(error?: Error): void {
    this.tracing.endSpan(this.spanId, error);
  }

  /**
   * Get trace ID
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Get span ID
   */
  getSpanId(): string {
    return this.spanId;
  }
}

/**
 * Default trace sampler
 */
class DefaultSampler implements TraceSampler {
  constructor(private sampleRate: number) {}

  shouldSample(trace: Partial<Trace>): boolean {
    return Math.random() < this.sampleRate;
  }
}

/**
 * Tracing decorator for automatic span creation
 */
export function Traced(
  operationName?: string,
  tags?: Record<string, any>
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    descriptor.value = isAsync
      ? async function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const tracing = ServiceTracing.getInstance();
          const operation = operationName || propertyKey;
          
          // Try to get existing trace context from first argument
          let context: TraceContext | null = null;
          if (args[0] && args[0] instanceof TraceContext) {
            context = args[0].startSpan(this.metadata.name, operation, tags);
          } else {
            context = tracing.startTrace(this.metadata.name, operation, tags);
          }

          if (!context) {
            return originalMethod.apply(this, args);
          }

          try {
            const result = await originalMethod.apply(this, args);
            context.end();
            return result;
          } catch (error) {
            context.log(`Error: ${(error as Error).message}`, 'error');
            context.end(error as Error);
            throw error;
          }
        }
      : function (this: BaseService<any, any> | BaseAsyncService<any, any>, ...args: any[]) {
          const tracing = ServiceTracing.getInstance();
          const operation = operationName || propertyKey;
          
          let context: TraceContext | null = null;
          if (args[0] && args[0] instanceof TraceContext) {
            context = args[0].startSpan(this.metadata.name, operation, tags);
          } else {
            context = tracing.startTrace(this.metadata.name, operation, tags);
          }

          if (!context) {
            return originalMethod.apply(this, args);
          }

          try {
            const result = originalMethod.apply(this, args);
            context.end();
            return result;
          } catch (error) {
            context.log(`Error: ${(error as Error).message}`, 'error');
            context.end(error as Error);
            throw error;
          }
        };

    return descriptor;
  };
}

/**
 * Rate-based sampler
 */
export class RateSampler implements TraceSampler {
  private requestCount = 0;
  
  constructor(
    private targetRate: number, // traces per second
    private window: number = 1000 // milliseconds
  ) {}

  shouldSample(trace: Partial<Trace>): boolean {
    this.requestCount++;
    const currentRate = this.requestCount / (this.window / 1000);
    
    if (currentRate > this.targetRate) {
      // Sample proportionally to maintain target rate
      return Math.random() < (this.targetRate / currentRate);
    }
    
    return true;
  }
}

/**
 * Priority-based sampler
 */
export class PrioritySampler implements TraceSampler {
  constructor(
    private priorities: Map<string, number> // operation name -> sample rate
  ) {}

  shouldSample(trace: Partial<Trace>): boolean {
    const operation = trace.metadata?.operationName;
    if (!operation) return true;

    const rate = this.priorities.get(operation) || 0.1;
    return Math.random() < rate;
  }
}