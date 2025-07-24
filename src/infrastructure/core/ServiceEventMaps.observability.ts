/**
 * Observability Service Event Maps
 * 
 * Type-safe event definitions for all observability and monitoring services.
 * These event maps provide compile-time type safety for event-driven
 * observability operations.
 */

/**
 * Metrics collector events for system and business metrics
 */
export interface MetricsCollectorEventMap {
  'metrics:collected': { 
    name: string; 
    value: number; 
    labels: Record<string, string>;
    timestamp: number;
    source: string;
  };
  'metrics:batch-collected': { 
    count: number; 
    duration: number; 
    errors: number;
    batchId: string;
  };
  'metrics:threshold-exceeded': { 
    metric: string; 
    value: number; 
    threshold: number;
    severity: 'warning' | 'critical';
  };
  'metrics:aggregated': { 
    metric: string; 
    aggregation: 'sum' | 'avg' | 'max' | 'min' | 'count';
    value: number; 
    period: string;
  };
  'metrics:export-completed': { 
    format: 'prometheus' | 'influxdb' | 'json';
    metrics: number; 
    destination: string;
    duration: number;
  };
  'metrics:storage-full': { 
    used: number; 
    capacity: number; 
    cleanup: boolean;
  };
  'metrics:error': { 
    error: Error; 
    operation: string; 
    metric?: string;
  };
}

/**
 * Distributed tracing events for request correlation
 */
export interface DistributedTracingEventMap {
  'trace:span-started': { 
    traceId: string; 
    spanId: string; 
    operation: string;
    parentSpanId?: string;
    tags: Record<string, any>;
  };
  'trace:span-finished': { 
    traceId: string; 
    spanId: string; 
    duration: number;
    status: 'success' | 'error' | 'timeout';
    logs?: Array<{ timestamp: number; message: string; level: string }>;
  };
  'trace:context-propagated': { 
    traceId: string; 
    fromService: string; 
    toService: string;
    method: 'http' | 'message' | 'rpc';
  };
  'trace:sampling-decision': { 
    traceId: string; 
    sampled: boolean; 
    reason: string;
    samplingRate: number;
  };
  'trace:export-batch': { 
    spans: number; 
    traceIds: string[];
    exporter: string; 
    duration: number;
  };
  'trace:correlation-found': { 
    traceId: string; 
    correlatedServices: string[];
    totalSpans: number;
  };
  'trace:error': { 
    error: Error; 
    traceId?: string; 
    spanId?: string;
    operation: string;
  };
}

/**
 * Alerting system events for notifications and escalations
 */
export interface AlertingSystemEventMap {
  'alert:triggered': { 
    alertId: string; 
    rule: string; 
    severity: 'info' | 'warning' | 'critical' | 'emergency';
    message: string; 
    labels: Record<string, string>;
    value?: number;
    threshold?: number;
  };
  'alert:resolved': { 
    alertId: string; 
    rule: string; 
    duration: number;
    autoResolved: boolean;
  };
  'alert:escalated': { 
    alertId: string; 
    fromLevel: string; 
    toLevel: string;
    reason: string;
    attempts: number;
  };
  'alert:notification-sent': { 
    alertId: string; 
    channel: 'email' | 'slack' | 'webhook' | 'sms';
    recipient: string; 
    success: boolean;
    latency: number;
  };
  'alert:suppressed': { 
    alertId: string; 
    reason: 'maintenance' | 'duplicate' | 'rate-limit';
    duration: number;
  };
  'alert:rule-updated': { 
    rule: string; 
    version: string; 
    changes: string[];
    validatedBy: string;
  };
  'alert:error': { 
    error: Error; 
    alertId?: string; 
    operation: string;
  };
}

/**
 * Anomaly detection events for pattern recognition
 */
export interface AnomalyDetectionEventMap {
  'anomaly:detected': { 
    metric: string; 
    value: number; 
    expectedRange: [number, number];
    anomalyScore: number; 
    confidence: number;
    algorithm: string;
  };
  'anomaly:pattern-learned': { 
    metric: string; 
    pattern: string; 
    samples: number;
    confidence: number;
  };
  'anomaly:threshold-updated': { 
    metric: string; 
    oldThreshold: number; 
    newThreshold: number;
    reason: 'drift' | 'seasonality' | 'manual';
  };
  'anomaly:model-retrained': { 
    metric: string; 
    algorithm: string; 
    samples: number;
    accuracy: number; 
    duration: number;
  };
  'anomaly:false-positive': { 
    metric: string; 
    value: number; 
    correctedBy: string;
    reason: string;
  };
  'anomaly:baseline-established': { 
    metric: string; 
    baseline: number; 
    variance: number;
    samplingPeriod: string;
  };
  'anomaly:error': { 
    error: Error; 
    metric?: string; 
    operation: string;
  };
}

/**
 * SLO monitoring events for service level objectives
 */
export interface SLOMonitoringEventMap {
  'slo:measurement': { 
    sloId: string; 
    service: string; 
    indicator: string;
    value: number; 
    target: number; 
    budget: number;
    timestamp: number;
  };
  'slo:budget-consumed': { 
    sloId: string; 
    service: string; 
    budgetUsed: number;
    budgetRemaining: number; 
    burnRate: number;
    projectedExhaustion?: number;
  };
  'slo:violation': { 
    sloId: string; 
    service: string; 
    indicator: string;
    actual: number; 
    target: number; 
    duration: number;
    severity: 'minor' | 'major' | 'critical';
  };
  'slo:budget-exhausted': { 
    sloId: string; 
    service: string; 
    timeRemaining: number;
    suggestedActions: string[];
  };
  'slo:compliance-report': { 
    period: string; 
    slos: Array<{
      id: string; 
      service: string; 
      compliance: number; 
      status: 'met' | 'at-risk' | 'violated';
    }>;
  };
  'slo:target-updated': { 
    sloId: string; 
    service: string; 
    oldTarget: number;
    newTarget: number; 
    reason: string;
  };
  'slo:error': { 
    error: Error; 
    sloId?: string; 
    operation: string;
  };
}

/**
 * OpenTelemetry service events for telemetry data
 */
export interface OpenTelemetryServiceEventMap {
  'otel:trace-exported': { 
    traces: number; 
    spans: number; 
    endpoint: string;
    duration: number; 
    success: boolean;
  };
  'otel:metrics-exported': { 
    metrics: number; 
    dataPoints: number; 
    endpoint: string;
    duration: number; 
    success: boolean;
  };
  'otel:logs-exported': { 
    logs: number; 
    endpoint: string; 
    duration: number;
    success: boolean;
  };
  'otel:sampling-configured': { 
    strategy: string; 
    rate: number; 
    rules: Array<{
      service: string; 
      operation?: string; 
      rate: number;
    }>;
  };
  'otel:resource-detected': { 
    service: string; 
    version: string; 
    environment: string;
    attributes: Record<string, string>;
  };
  'otel:instrumentation-loaded': { 
    library: string; 
    version: string; 
    autoInstrumented: boolean;
  };
  'otel:batch-timeout': { 
    type: 'traces' | 'metrics' | 'logs'; 
    pending: number;
    maxWaitTime: number;
  };
  'otel:export-failed': { 
    error: Error; 
    type: 'traces' | 'metrics' | 'logs';
    retryAttempt: number; 
    willRetry: boolean;
  };
}

/**
 * Performance monitor events for system performance
 */
export interface PerformanceMonitorEventMap {
  'perf:measurement': { 
    category: string; 
    operation: string; 
    duration: number;
    cpu: number; 
    memory: number; 
    timestamp: number;
  };
  'perf:bottleneck-detected': { 
    resource: 'cpu' | 'memory' | 'disk' | 'network';
    utilization: number; 
    threshold: number; 
    impact: string[];
  };
  'perf:optimization-applied': { 
    optimization: string; 
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>; 
    improvement: number;
  };
  'perf:degradation-detected': { 
    metric: string; 
    currentValue: number; 
    baseline: number;
    degradationPercent: number; 
    possibleCauses: string[];
  };
  'perf:benchmark-completed': { 
    suite: string; 
    operations: number; 
    duration: number;
    results: Record<string, { ops: number; margin: number }>;
  };
  'perf:profiling-started': { 
    target: string; 
    duration: number; 
    type: 'cpu' | 'memory' | 'heap';
  };
  'perf:profiling-completed': { 
    target: string; 
    duration: number; 
    reportPath: string;
    insights: string[];
  };
  'perf:error': { 
    error: Error; 
    operation: string; 
    context?: Record<string, any>;
  };
}

/**
 * Log aggregation events for centralized logging
 */
export interface LogAggregationEventMap {
  'logs:ingested': { 
    source: string; 
    count: number; 
    level: string;
    timestamp: number; 
    batchId: string;
  };
  'logs:indexed': { 
    count: number; 
    index: string; 
    duration: number;
    errors: number;
  };
  'logs:query-executed': { 
    query: string; 
    results: number; 
    duration: number;
    user?: string;
  };
  'logs:retention-applied': { 
    policy: string; 
    deleted: number; 
    retained: number;
    savedSpace: number;
  };
  'logs:correlation-found': { 
    correlationId: string; 
    relatedLogs: number;
    services: string[]; 
    timespan: number;
  };
  'logs:pattern-detected': { 
    pattern: string; 
    frequency: number; 
    severity: string;
    firstSeen: number; 
    lastSeen: number;
  };
  'logs:alert-triggered': { 
    rule: string; 
    matches: number; 
    threshold: number;
    timeWindow: number;
  };
  'logs:error': { 
    error: Error; 
    operation: string; 
    source?: string;
  };
}

/**
 * Aggregate type for all observability service event maps
 */
export type ObservabilityServiceEventMap = 
  | MetricsCollectorEventMap
  | DistributedTracingEventMap
  | AlertingSystemEventMap
  | AnomalyDetectionEventMap
  | SLOMonitoringEventMap
  | OpenTelemetryServiceEventMap
  | PerformanceMonitorEventMap
  | LogAggregationEventMap;

/**
 * Helper type to get event map for a specific observability service
 */
export type GetObservabilityServiceEventMap<T extends string> = 
  T extends 'metrics-collector' ? MetricsCollectorEventMap :
  T extends 'distributed-tracing' ? DistributedTracingEventMap :
  T extends 'alerting-system' ? AlertingSystemEventMap :
  T extends 'anomaly-detection' ? AnomalyDetectionEventMap :
  T extends 'slo-monitoring' ? SLOMonitoringEventMap :
  T extends 'opentelemetry' ? OpenTelemetryServiceEventMap :
  T extends 'performance-monitor' ? PerformanceMonitorEventMap :
  T extends 'log-aggregation' ? LogAggregationEventMap :
  never;