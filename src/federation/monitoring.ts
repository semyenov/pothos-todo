import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { Plugin } from '@envelop/core';
import { usePrometheus } from '@envelop/prometheus';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { createServer } from 'http';
import { Context } from 'graphql-yoga';

// Initialize default metrics collection
collectDefaultMetrics({ prefix: 'federation_' });

// Custom metrics
export const federationMetrics = {
  // Request metrics
  requestsTotal: new Counter({
    name: 'federation_graphql_requests_total',
    help: 'Total number of GraphQL requests',
    labelNames: ['subgraph', 'operation_type', 'operation_name', 'status'],
  }),

  // Latency metrics
  requestDuration: new Histogram({
    name: 'federation_graphql_request_duration_seconds',
    help: 'GraphQL request duration in seconds',
    labelNames: ['subgraph', 'operation_type', 'operation_name'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  }),

  // Field resolution metrics
  fieldResolutionDuration: new Histogram({
    name: 'federation_graphql_field_resolution_duration_seconds',
    help: 'Field resolution duration in seconds',
    labelNames: ['subgraph', 'type', 'field'],
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
  }),

  // Error metrics
  errorsTotal: new Counter({
    name: 'federation_graphql_errors_total',
    help: 'Total number of GraphQL errors',
    labelNames: ['subgraph', 'error_type', 'operation_type'],
  }),

  // Subscription metrics
  activeSubscriptions: new Gauge({
    name: 'federation_graphql_active_subscriptions',
    help: 'Number of active GraphQL subscriptions',
    labelNames: ['subgraph', 'subscription_name'],
  }),

  // Cache metrics
  cacheHits: new Counter({
    name: 'federation_cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['subgraph', 'cache_type'],
  }),

  cacheMisses: new Counter({
    name: 'federation_cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['subgraph', 'cache_type'],
  }),

  // Federation-specific metrics
  subgraphRequests: new Counter({
    name: 'federation_subgraph_requests_total',
    help: 'Total number of requests to subgraphs',
    labelNames: ['from_gateway', 'to_subgraph', 'status'],
  }),

  subgraphLatency: new Summary({
    name: 'federation_subgraph_latency_seconds',
    help: 'Latency of subgraph requests',
    labelNames: ['from_gateway', 'to_subgraph'],
    percentiles: [0.5, 0.9, 0.95, 0.99],
  }),

  // Query complexity metrics
  queryComplexity: new Histogram({
    name: 'federation_graphql_query_complexity',
    help: 'GraphQL query complexity score',
    labelNames: ['subgraph', 'operation_name'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  }),

  // Resource usage metrics
  resolverConcurrency: new Gauge({
    name: 'federation_resolver_concurrency',
    help: 'Current number of concurrent resolver executions',
    labelNames: ['subgraph', 'resolver'],
  }),
};

// OpenTelemetry integration
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

export function initializeOpenTelemetry(serviceName: string) {
  // Create resource
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'pothos-todo-federation',
    })
  );

  // Create trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  });

  // Create metrics exporter
  const metricsExporter = new PrometheusExporter({
    port: parseInt(process.env.METRICS_PORT || '9464'),
  });

  // Create meter provider
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricsExporter],
  });

  // Initialize SDK
  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Disable file system instrumentation
        },
      }),
    ],
    spanProcessor: new BatchSpanProcessor(traceExporter),
  });

  // Start SDK
  sdk.start();

  logger.info(`🔭 OpenTelemetry initialized for ${serviceName}`);

  return { sdk, meterProvider };
}

// Monitoring plugin for GraphQL
export function createMonitoringPlugin(subgraphName: string): Plugin {
  return {
    onExecute({ args }) {
      const startTime = Date.now();
      const operationType = args.document.definitions[0]?.kind === 'OperationDefinition'
        ? args.document.definitions[0].operation
        : 'unknown';
      const operationName = args.operationName || 'anonymous';

      return {
        onExecuteDone({ result }) {
          const duration = (Date.now() - startTime) / 1000;
          const status = result.errors ? 'error' : 'success';

          // Record metrics
          federationMetrics.requestsTotal.inc({
            subgraph: subgraphName,
            operation_type: operationType,
            operation_name: operationName,
            status,
          });

          federationMetrics.requestDuration.observe(
            {
              subgraph: subgraphName,
              operation_type: operationType,
              operation_name: operationName,
            },
            duration
          );

          if (result.errors) {
            result.errors.forEach(error => {
              federationMetrics.errorsTotal.inc({
                subgraph: subgraphName,
                error_type: error.extensions?.code || 'UNKNOWN',
                operation_type: operationType,
              });
            });
          }
        },
      };
    },

    onSubscribe({ args }) {
      const subscriptionName = args.operationName || 'anonymous';
      
      federationMetrics.activeSubscriptions.inc({
        subgraph: subgraphName,
        subscription_name: subscriptionName,
      });

      return {
        onSubscribeResult() {
          return {
            onEnd() {
              federationMetrics.activeSubscriptions.dec({
                subgraph: subgraphName,
                subscription_name: subscriptionName,
              });
            },
          };
        },
      };
    },

    onResolverCalled({ info }) {
      const resolverName = `${info.parentType.name}.${info.fieldName}`;
      const startTime = Date.now();

      federationMetrics.resolverConcurrency.inc({
        subgraph: subgraphName,
        resolver: resolverName,
      });

      return ({ result }) => {
        const duration = (Date.now() - startTime) / 1000;

        federationMetrics.fieldResolutionDuration.observe(
          {
            subgraph: subgraphName,
            type: info.parentType.name,
            field: info.fieldName,
          },
          duration
        );

        federationMetrics.resolverConcurrency.dec({
          subgraph: subgraphName,
          resolver: resolverName,
        });
      };
    },
  };
}

// Health check endpoint with detailed metrics
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  metrics: {
    requestsPerSecond: number;
    averageLatency: number;
    errorRate: number;
    activeConnections: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      external: number;
      rss: number;
    };
    cpuUsage: {
      user: number;
      system: number;
    };
  };
  dependencies: Array<{
    name: string;
    status: 'up' | 'down';
    latency?: number;
    error?: string;
  }>;
}

export async function checkHealth(
  subgraphName: string,
  dependencies: Array<{ name: string; url: string }>
): Promise<HealthCheckResult> {
  const startTime = process.hrtime();
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  // Check dependencies
  const dependencyChecks = await Promise.all(
    dependencies.map(async dep => {
      const depStartTime = Date.now();
      try {
        const response = await fetch(dep.url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        return {
          name: dep.name,
          status: response.ok ? 'up' : 'down' as const,
          latency: Date.now() - depStartTime,
        };
      } catch (error) {
        return {
          name: dep.name,
          status: 'down' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  // Calculate metrics
  const totalRequests = await federationMetrics.requestsTotal.get();
  const totalErrors = await federationMetrics.errorsTotal.get();
  const requestsValue = totalRequests.values.reduce((sum, v) => sum + v.value, 0);
  const errorsValue = totalErrors.values.reduce((sum, v) => sum + v.value, 0);

  const uptime = process.uptime();
  const requestsPerSecond = requestsValue / uptime;
  const errorRate = requestsValue > 0 ? errorsValue / requestsValue : 0;

  // Determine health status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (dependencyChecks.some(d => d.status === 'down')) {
    status = 'degraded';
  }
  if (errorRate > 0.1 || dependencyChecks.filter(d => d.status === 'down').length > 1) {
    status = 'unhealthy';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime,
    metrics: {
      requestsPerSecond,
      averageLatency: 0, // Would need to calculate from histogram
      errorRate,
      activeConnections: 0, // Would need to track
      memoryUsage: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    },
    dependencies: dependencyChecks,
  };
}

// Metrics server
export function startMetricsServer(port: number = 9090) {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      register.metrics().then(metrics => {
        res.end(metrics);
      });
    } else if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    logger.info(chalk.green(`📊 Metrics server listening on port ${port}`));
  });

  return server;
}

// Distributed tracing helpers
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

export const tracer = trace.getTracer('pothos-todo-federation');

export function tracedResolver<T>(
  resolverName: string,
  resolver: (...args: any[]) => Promise<T>
): (...args: any[]) => Promise<T> {
  return async (...args: any[]): Promise<T> => {
    return tracer.startActiveSpan(`resolver.${resolverName}`, async (span) => {
      try {
        span.setAttributes({
          'resolver.name': resolverName,
          'resolver.args': JSON.stringify(args),
        });

        const result = await resolver(...args);
        
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
    });
  };
}

// Custom monitoring dashboard data
export interface DashboardData {
  overview: {
    totalRequests: number;
    errorRate: number;
    averageLatency: number;
    activeSubscriptions: number;
  };
  subgraphs: Array<{
    name: string;
    requests: number;
    errors: number;
    latency: number;
    status: 'healthy' | 'degraded' | 'unhealthy';
  }>;
  recentErrors: Array<{
    timestamp: string;
    subgraph: string;
    error: string;
    operation: string;
  }>;
  performanceTrends: {
    timestamps: string[];
    latencies: number[];
    requestCounts: number[];
    errorCounts: number[];
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  // This would aggregate metrics from Prometheus
  // For now, returning mock data structure
  return {
    overview: {
      totalRequests: 0,
      errorRate: 0,
      averageLatency: 0,
      activeSubscriptions: 0,
    },
    subgraphs: [],
    recentErrors: [],
    performanceTrends: {
      timestamps: [],
      latencies: [],
      requestCounts: [],
      errorCounts: [],
    },
  };
}