/**
 * Observability-Specific Decorators
 * 
 * Specialized decorators for observability services that extend the base decorators
 * with monitoring-specific functionality like metrics collection, tracing,
 * alerting, and performance monitoring.
 */

import { z } from 'zod';
import { BaseService } from '../BaseService.js';
import { BaseAsyncService } from '../BaseAsyncService.js';
import { Metric } from './ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Metrics sampling decorator
 * Controls sampling rate for high-frequency metrics
 */
export interface MetricsSamplingOptions {
  rate: number; // 0.0 to 1.0
  maxPerSecond?: number;
  adaptiveSampling?: boolean;
}

export function MetricsSampling(options: MetricsSamplingOptions) {
  let lastSample = 0;
  let sampleCount = 0;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const now = Date.now();
      
      // Adaptive sampling based on load
      let currentRate = options.rate;
      if (options.adaptiveSampling) {
        const secondsSinceLastSample = (now - lastSample) / 1000;
        const currentRatePerSecond = sampleCount / Math.max(secondsSinceLastSample, 1);
        
        if (options.maxPerSecond && currentRatePerSecond > options.maxPerSecond) {
          currentRate = Math.max(0.1, options.rate * 0.5); // Reduce sampling
        }
      }

      // Sample decision
      if (Math.random() > currentRate) {
        return; // Skip this sample
      }

      // Reset counters every second
      if (now - lastSample > 1000) {
        lastSample = now;
        sampleCount = 0;
      }
      
      sampleCount++;

      const result = await originalMethod.apply(this, args);
      
      this.recordMetric('observability.samples.collected', 1, {
        method: propertyKey,
        samplingRate: currentRate,
      });

      return result;
    };

    return descriptor;
  };
}

/**
 * Distributed tracing decorator
 * Automatically creates spans for traced operations
 */
export interface TracingOptions {
  operationName?: string;
  tags?: Record<string, any>;
  baggage?: Record<string, string>;
  followsFrom?: boolean;
}

export function Traced(options: TracingOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const operationName = options.operationName || `${target.constructor.name}.${propertyKey}`;
      const traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const spanId = `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const span = {
        traceId,
        spanId,
        operationName,
        startTime: Date.now(),
        tags: {
          service: this.getServiceName(),
          method: propertyKey,
          ...options.tags,
        },
        baggage: options.baggage || {},
      };

      this.emit('trace:span-started' as any, {
        traceId: span.traceId,
        spanId: span.spanId,
        operation: span.operationName,
        tags: span.tags,
      });

      try {
        const result = await originalMethod.apply(this, args);
        
        this.emit('trace:span-finished' as any, {
          traceId: span.traceId,
          spanId: span.spanId,
          duration: Date.now() - span.startTime,
          status: 'success',
        });

        return result;
      } catch (error) {
        this.emit('trace:span-finished' as any, {
          traceId: span.traceId,
          spanId: span.spanId,
          duration: Date.now() - span.startTime,
          status: 'error',
          logs: [{
            timestamp: Date.now(),
            message: (error as Error).message,
            level: 'error',
          }],
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Alert threshold decorator
 * Automatically triggers alerts when thresholds are exceeded
 */
export interface AlertThresholdOptions {
  metric: string;
  warning: number;
  critical: number;
  comparison?: 'gt' | 'lt' | 'eq';
  windowSize?: number; // seconds
  evaluationFrequency?: number; // seconds
}

export function AlertThreshold(options: AlertThresholdOptions) {
  const metricHistory: number[] = [];
  let lastEvaluation = 0;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const result = await originalMethod.apply(this, args);
      
      // Extract metric value from result or use result as value
      const metricValue = typeof result === 'number' ? result : 
                         (result && typeof result.value === 'number') ? result.value : 0;

      metricHistory.push(metricValue);
      
      // Keep only recent history based on window size
      const windowMs = (options.windowSize || 60) * 1000;
      const cutoff = Date.now() - windowMs;
      while (metricHistory.length > 0 && metricHistory.length > 100) {
        metricHistory.shift();
      }

      // Evaluate thresholds
      const now = Date.now();
      const evaluationInterval = (options.evaluationFrequency || 10) * 1000;
      
      if (now - lastEvaluation > evaluationInterval) {
        lastEvaluation = now;
        this.evaluateAlert(options, metricValue, metricHistory);
      }

      return result;
    };

    return descriptor;
  };

  // Helper method to evaluate alert conditions
  function evaluateAlert(this: BaseService<any>, options: AlertThresholdOptions, value: number, history: number[]) {
    const comparison = options.comparison || 'gt';
    let triggered = false;
    let severity: 'warning' | 'critical' = 'warning';

    // Check critical threshold
    if (compareValue(value, options.critical, comparison)) {
      triggered = true;
      severity = 'critical';
    }
    // Check warning threshold
    else if (compareValue(value, options.warning, comparison)) {
      triggered = true;
      severity = 'warning';
    }

    if (triggered) {
      const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.emit('alert:triggered' as any, {
        alertId,
        rule: `${options.metric}_threshold`,
        severity,
        message: `${options.metric} ${comparison} ${severity === 'critical' ? options.critical : options.warning}`,
        labels: {
          service: this.getServiceName(),
          metric: options.metric,
        },
        value,
        threshold: severity === 'critical' ? options.critical : options.warning,
      });
    }
  }

  function compareValue(value: number, threshold: number, comparison: string): boolean {
    switch (comparison) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      default: return value > threshold;
    }
  }
}

/**
 * Performance profiling decorator
 * Profiles method execution for performance analysis
 */
export interface ProfilingOptions {
  includeMemory?: boolean;
  includeCpu?: boolean;
  sampleRate?: number;
  reportThreshold?: number; // ms
}

export function Profiled(options: ProfilingOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      // Sampling decision
      if (options.sampleRate && Math.random() > options.sampleRate) {
        return originalMethod.apply(this, args);
      }

      const startTime = Date.now();
      const startMemory = options.includeMemory ? process.memoryUsage() : null;
      const startCpu = options.includeCpu ? process.cpuUsage() : null;

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        // Only report if duration exceeds threshold
        if (!options.reportThreshold || duration > options.reportThreshold) {
          const endMemory = options.includeMemory ? process.memoryUsage() : null;
          const endCpu = options.includeCpu ? process.cpuUsage(startCpu || undefined) : null;

          const performanceData: any = {
            category: 'method_execution',
            operation: `${target.constructor.name}.${propertyKey}`,
            duration,
            timestamp: startTime,
          };

          if (endCpu) {
            performanceData.cpu = (endCpu.user + endCpu.system) / 1000; // Convert to ms
          }

          if (startMemory && endMemory) {
            performanceData.memory = endMemory.heapUsed - startMemory.heapUsed;
          }

          this.emit('perf:measurement' as any, performanceData);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.emit('perf:error' as any, {
          error: error as Error,
          operation: `${target.constructor.name}.${propertyKey}`,
          context: { duration, args: args.length },
        });

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * SLO monitoring decorator
 * Tracks Service Level Objectives compliance
 */
export interface SLOOptions {
  sloId: string;
  indicator: 'latency' | 'availability' | 'throughput' | 'error_rate';
  target: number;
  budgetPeriod: 'hour' | 'day' | 'week' | 'month';
}

export function SLOMonitored(options: SLOOptions) {
  const measurements: Array<{ timestamp: number; value: number; success: boolean }> = [];

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const startTime = Date.now();
      let success = true;
      let value = 0;

      try {
        const result = await originalMethod.apply(this, args);
        
        // Calculate SLI value based on indicator type
        switch (options.indicator) {
          case 'latency':
            value = Date.now() - startTime;
            success = value <= options.target;
            break;
          case 'availability':
            value = 1; // Available
            success = true;
            break;
          case 'throughput':
            value = 1; // One operation completed
            success = true;
            break;
          case 'error_rate':
            value = 0; // No error
            success = true;
            break;
        }

        return result;
      } catch (error) {
        success = false;
        
        switch (options.indicator) {
          case 'latency':
            value = Date.now() - startTime;
            break;
          case 'availability':
            value = 0; // Not available
            break;
          case 'error_rate':
            value = 1; // Error occurred
            break;
        }

        throw error;
      } finally {
        measurements.push({
          timestamp: startTime,
          value,
          success,
        });

        // Calculate budget consumption
        const budget = this.calculateErrorBudget(measurements, options);

        this.emit('slo:measurement' as any, {
          sloId: options.sloId,
          service: this.getServiceName(),
          indicator: options.indicator,
          value,
          target: options.target,
          budget: budget.remaining,
          timestamp: startTime,
        });

        // Check for violations
        if (!success) {
          this.emit('slo:violation' as any, {
            sloId: options.sloId,
            service: this.getServiceName(),
            indicator: options.indicator,
            actual: value,
            target: options.target,
            duration: Date.now() - startTime,
            severity: this.assessViolationSeverity(budget.burnRate),
          });
        }
      }
    };

    return descriptor;
  };

  function calculateErrorBudget(this: BaseService<any>, measurements: any[], options: SLOOptions) {
    // Simple budget calculation - can be enhanced
    const recentMeasurements = measurements.slice(-100); // Last 100 measurements
    const failures = recentMeasurements.filter(m => !m.success).length;
    const total = recentMeasurements.length;
    
    const errorRate = total > 0 ? failures / total : 0;
    const allowedErrorRate = 1 - (options.target / 100); // Assuming target is percentage
    
    return {
      remaining: Math.max(0, allowedErrorRate - errorRate),
      burnRate: errorRate / allowedErrorRate,
    };
  }

  function assessViolationSeverity(this: BaseService<any>, burnRate: number): 'minor' | 'major' | 'critical' {
    if (burnRate > 10) return 'critical';
    if (burnRate > 5) return 'major';
    return 'minor';
  }
}

/**
 * Anomaly detection decorator
 * Detects anomalies in method behavior
 */
export interface AnomalyDetectionOptions {
  metric: 'latency' | 'memory' | 'cpu' | 'return_value';
  algorithm: 'statistical' | 'ml' | 'threshold';
  sensitivity: 'low' | 'medium' | 'high';
  learningPeriod?: number; // number of samples
}

export function AnomalyDetected(options: AnomalyDetectionOptions) {
  const baseline: number[] = [];
  let learningSamples = 0;
  const maxBaseline = options.learningPeriod || 100;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const startTime = Date.now();
      const startMemory = process.memoryUsage();

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        const endMemory = process.memoryUsage();

        let metricValue: number;
        switch (options.metric) {
          case 'latency':
            metricValue = duration;
            break;
          case 'memory':
            metricValue = endMemory.heapUsed - startMemory.heapUsed;
            break;
          case 'return_value':
            metricValue = typeof result === 'number' ? result : 0;
            break;
          default:
            metricValue = duration;
        }

        // Learning phase
        if (learningSamples < maxBaseline) {
          baseline.push(metricValue);
          learningSamples++;
          
          if (learningSamples === maxBaseline) {
            this.emit('anomaly:baseline-established' as any, {
              metric: `${target.constructor.name}.${propertyKey}.${options.metric}`,
              baseline: this.calculateBaseline(baseline),
              variance: this.calculateVariance(baseline),
              samplingPeriod: `${maxBaseline} samples`,
            });
          }
        } else {
          // Detection phase
          const anomaly = this.detectAnomaly(metricValue, baseline, options);
          
          if (anomaly.isAnomaly) {
            this.emit('anomaly:detected' as any, {
              metric: `${target.constructor.name}.${propertyKey}.${options.metric}`,
              value: metricValue,
              expectedRange: anomaly.expectedRange,
              anomalyScore: anomaly.score,
              confidence: anomaly.confidence,
              algorithm: options.algorithm,
            });
          }

          // Update baseline with new sample
          baseline.shift();
          baseline.push(metricValue);
        }

        return result;
      } catch (error) {
        throw error;
      }
    };

    return descriptor;
  };

  function calculateBaseline(this: BaseService<any>, values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  function calculateVariance(this: BaseService<any>, values: number[]): number {
    const mean = this.calculateBaseline(values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  function detectAnomaly(this: BaseService<any>, value: number, baseline: number[], options: AnomalyDetectionOptions) {
    const mean = this.calculateBaseline(baseline);
    const stdDev = this.calculateVariance(baseline);
    
    // Sensitivity mapping
    const sensitivityMap = { low: 3, medium: 2, high: 1.5 };
    const threshold = sensitivityMap[options.sensitivity];
    
    const zScore = Math.abs((value - mean) / stdDev);
    const isAnomaly = zScore > threshold;
    
    return {
      isAnomaly,
      score: zScore,
      confidence: Math.min(zScore / threshold, 1),
      expectedRange: [mean - threshold * stdDev, mean + threshold * stdDev] as [number, number],
    };
  }
}

/**
 * Combined observability monitoring decorator
 * Applies multiple observability capabilities
 */
export function ObservabilityMonitored(options: {
  tracing?: boolean;
  profiling?: boolean;
  slo?: Omit<SLOOptions, 'sloId'>;
  alerting?: Omit<AlertThresholdOptions, 'metric'>;
}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Apply base metric decorator
    Metric({ 
      name: `observability.${target.constructor.name.toLowerCase()}.${propertyKey}`, 
      recordDuration: true 
    })(target, propertyKey, descriptor);

    // Apply tracing if enabled
    if (options.tracing) {
      Traced({
        operationName: `${target.constructor.name}.${propertyKey}`,
      })(target, propertyKey, descriptor);
    }

    // Apply profiling if enabled
    if (options.profiling) {
      Profiled({
        includeMemory: true,
        includeCpu: true,
        sampleRate: 0.1, // 10% sampling
      })(target, propertyKey, descriptor);
    }

    // Apply SLO monitoring if configured
    if (options.slo) {
      SLOMonitored({
        sloId: `${target.constructor.name}.${propertyKey}`,
        ...options.slo,
      })(target, propertyKey, descriptor);
    }

    // Apply alerting if configured
    if (options.alerting) {
      AlertThreshold({
        metric: `${target.constructor.name}.${propertyKey}`,
        ...options.alerting,
      })(target, propertyKey, descriptor);
    }

    return descriptor;
  };
}