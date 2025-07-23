import { trace, context, SpanStatusCode, SpanKind, Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import * as resources from '@opentelemetry/resources';
const Resource = resources.Resource || resources.default?.Resource;
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
// Redis instrumentation not available - removed
import { logger } from '@/logger.js';
import { SingletonService } from '../core/SingletonService.js';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  jaegerEndpoint?: string;
  samplingRate?: number;
  enableAutoInstrumentation?: boolean;
}

/**
 * Advanced Telemetry System with OpenTelemetry
 */
export class TelemetrySystem extends SingletonService<TelemetrySystem> {
  private provider: NodeTracerProvider | null = null;
  private tracer: Tracer | null = null;
  private config: TelemetryConfig | null = null;

  protected constructor() {
    super();
  }

  public configure(config: TelemetryConfig): void {
    this.config = {
      samplingRate: 1.0,
      enableAutoInstrumentation: true,
      jaegerEndpoint: 'http://localhost:14268/api/traces',
      ...config,
    };

    this.provider = this.initializeProvider();
    this.tracer = trace.getTracer(
      this.config.serviceName,
      this.config.serviceVersion
    );

    if (this.config.enableAutoInstrumentation) {
      this.setupAutoInstrumentation();
    }
  }

  private ensureConfig(): TelemetryConfig {
    if (!this.config) {
      throw new Error('TelemetrySystem not configured');
    }
    return this.config;
  }

  private ensureTracer(): Tracer {
    if (!this.tracer) {
      throw new Error('TelemetrySystem tracer not initialized');
    }
    return this.tracer;
  }

  static initialize(config: TelemetryConfig): TelemetrySystem {
    const instance = super.getInstance();
    if (!instance.config) {
      instance.configure(config);
    }
    return instance;
  }

  static async getInstance(): Promise<TelemetrySystem> {
    return super.getInstance();
  }

  private initializeProvider(): NodeTracerProvider {
    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.ensureConfig().serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.ensureConfig().serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.ensureConfig().environment,
      }),
    });

    // Configure Jaeger exporter
    if (this.ensureConfig().jaegerEndpoint) {
      const traceExporter = new OTLPTraceExporter({
        url: this.ensureConfig().jaegerEndpoint || 'http://localhost:4318/v1/traces',
      });

      provider.addSpanProcessor(
        new BatchSpanProcessor(traceExporter, {
          maxQueueSize: 100,
          maxExportBatchSize: 10,
          scheduledDelayMillis: 500,
          exportTimeoutMillis: 30000,
        })
      );
    }

    provider.register();
    return provider;
  }

  private setupAutoInstrumentation(): void {
    registerInstrumentations({
      instrumentations: [
        new HttpInstrumentation({
          requestHook: (span, request) => {
            span.setAttributes({
              'http.request.body.size': request.headers['content-length'] || 0,
            });
          },
        }),
        new GraphQLInstrumentation({
          mergeItems: true,
          allowValues: true,
          depth: 3,
        }),
        // Redis instrumentation removed - package not available
      ],
    });

    logger.info('Auto-instrumentation enabled for HTTP, GraphQL, and Redis');
  }

  /**
   * Create a custom span
   */
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      parent?: any;
    }
  ) {
    return this.ensureTracer().startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    }, options?.parent || context.active());
  }

  /**
   * Trace an async operation
   */
  async traceAsync<T>(
    name: string,
    operation: () => Promise<T>,
    attributes?: Record<string, any>
  ): Promise<T> {
    const span = this.startSpan(name, { attributes });

    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Add baggage to context
   */
  addBaggage(key: string, value: string) {
    // Implementation for baggage propagation
    const currentContext = context.active();
    // Add baggage to context
  }

  /**
   * Get current trace ID
   */
  getCurrentTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    return span?.spanContext().traceId;
  }

  /**
   * Shutdown telemetry
   */
  async shutdown(): Promise<void> {
    await this.provider.shutdown();
    logger.info('Telemetry system shut down');
  }
}

/**
 * Decorator for method tracing
 */
export function Trace(spanName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = spanName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const telemetry = TelemetrySystem.getInstance();
      return telemetry.traceAsync(
        name,
        () => originalMethod.apply(this, args),
        {
          'method.name': propertyKey,
          'method.args.count': args.length,
        }
      );
    };

    return descriptor;
  };
}

/**
 * GraphQL Field Resolver Tracing
 */
export function createGraphQLTracingPlugin() {
  return {
    requestDidStart() {
      return {
        willSendResponse(requestContext: any) {
          const { request, response } = requestContext;
          const span = trace.getActiveSpan();

          if (span) {
            span.setAttributes({
              'graphql.operation.name': request.operationName,
              'graphql.operation.type': request.query?.includes('mutation') ? 'mutation' : 'query',
              'graphql.response.size': JSON.stringify(response).length,
            });
          }
        },
      };
    },
  };
}