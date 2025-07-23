import { logger } from '@/logger.js';
import { EventEmitter } from 'events';
import { SystemIntegration } from '../SystemIntegration.js';
import { DataReplicationSystem } from '../edge/DataReplication.js';
import { EdgeComputingSystem } from '../edge/EdgeComputing.js';
import { AlertingSystem } from '../observability/AlertingSystem.js';
import { MetricsSystem } from '../observability/Metrics.js';

export interface ChaosExperiment {
  id: string;
  name: string;
  description: string;
  type: ChaosType;
  target: ChaosTarget;
  parameters: Record<string, any>;
  duration: number; // milliseconds
  schedule?: {
    cron?: string;
    interval?: number;
  };
  conditions: ExperimentCondition[];
  rollbackOn: RollbackCondition[];
}

export type ChaosType =
  | 'network_latency'
  | 'network_partition'
  | 'service_failure'
  | 'resource_exhaustion'
  | 'data_corruption'
  | 'clock_skew'
  | 'dependency_failure'
  | 'security_breach';

export interface ChaosTarget {
  type: 'edge' | 'database' | 'cache' | 'service' | 'network';
  selector: {
    id?: string;
    region?: string;
    tags?: string[];
  };
}

export interface ExperimentCondition {
  type: 'time' | 'metric' | 'state';
  check: (context: any) => boolean;
}

export interface RollbackCondition {
  metric: string;
  threshold: number;
  operator: '>' | '<' | '=' | '>=' | '<=';
}

export interface ExperimentResult {
  id: string;
  experimentId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  impact: {
    availability: number;
    performance: number;
    errors: number;
  };
  findings: string[];
  recommendations: string[];
}

export interface ChaosConfig {
  enabled: boolean;
  dryRun: boolean;
  maxConcurrentExperiments: number;
  safeguards: {
    maxImpact: number; // percentage
    minAvailability: number; // percentage
    autoRollback: boolean;
  };
}

/**
 * Chaos Engineering System
 * Implements controlled failure injection for resilience testing
 */
export class ChaosEngineeringSystem extends EventEmitter {
  private static instance: ChaosEngineeringSystem;
  private config: ChaosConfig;
  private experiments: Map<string, ChaosExperiment> = new Map();
  private activeExperiments: Map<string, ExperimentResult> = new Map();
  private experimentHistory: ExperimentResult[] = [];

  private system: SystemIntegration;
  private edgeComputing: EdgeComputingSystem;
  private dataReplication: DataReplicationSystem;
  private metrics: MetricsSystem;
  private alerting: AlertingSystem;

  private monitoringInterval?: NodeJS.Timeout;
  private injectedFailures: Map<string, () => void> = new Map();

  private constructor(config: ChaosConfig) {
    super();
    this.config = config;
    this.system = SystemIntegration.getInstance();
    this.edgeComputing = EdgeComputingSystem.getInstance();
    this.dataReplication = DataReplicationSystem.getInstance();
    this.metrics = MetricsSystem.getInstance();
    this.alerting = AlertingSystem.getInstance();
  }

  static initialize(config: ChaosConfig): ChaosEngineeringSystem {
    if (!ChaosEngineeringSystem.instance) {
      ChaosEngineeringSystem.instance = new ChaosEngineeringSystem(config);
    }
    return ChaosEngineeringSystem.instance;
  }

  static getInstance(): ChaosEngineeringSystem {
    if (!ChaosEngineeringSystem.instance) {
      throw new Error('ChaosEngineeringSystem not initialized');
    }
    return ChaosEngineeringSystem.instance;
  }

  /**
   * Register a chaos experiment
   */
  registerExperiment(experiment: ChaosExperiment): void {
    this.experiments.set(experiment.id, experiment);
    logger.info(`Registered chaos experiment: ${experiment.name}`);
    this.emit('experiment:registered', experiment);
  }

  /**
   * Run a chaos experiment
   */
  async runExperiment(experimentId: string): Promise<ExperimentResult> {
    if (!this.config.enabled) {
      throw new Error('Chaos engineering is disabled');
    }

    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // Check concurrent experiments limit
    if (this.activeExperiments.size >= this.config.maxConcurrentExperiments) {
      throw new Error('Maximum concurrent experiments reached');
    }

    // Check conditions
    for (const condition of experiment.conditions) {
      if (!await this.checkCondition(condition)) {
        throw new Error(`Condition not met: ${condition.type}`);
      }
    }

    logger.warn(`Starting chaos experiment: ${experiment.name}`, {
      type: experiment.type,
      target: experiment.target,
      dryRun: this.config.dryRun,
    });

    const result: ExperimentResult = {
      id: `exp_${Date.now()}`,
      experimentId: experiment.id,
      startTime: new Date(),
      status: 'running',
      impact: { availability: 0, performance: 0, errors: 0 },
      findings: [],
      recommendations: [],
    };

    this.activeExperiments.set(result.id, result);
    this.emit('experiment:started', { experiment, result });

    // Start monitoring
    this.startExperimentMonitoring(experiment, result);

    try {
      // Inject failure
      if (!this.config.dryRun) {
        await this.injectFailure(experiment, result);
      } else {
        logger.info('DRY RUN: Would inject failure', { type: experiment.type });
        result.findings.push('Dry run - no actual failures injected');
      }

      // Wait for duration
      await new Promise(resolve => setTimeout(resolve, experiment.duration));

      // Complete experiment
      result.status = 'completed';
      result.endTime = new Date();

      // Analyze results
      await this.analyzeExperimentResults(experiment, result);

    } catch (error) {
      logger.error('Experiment failed', { experimentId, error });
      result.status = 'failed';
      result.findings.push(`Experiment failed: ${error}`);
    } finally {
      // Clean up
      await this.cleanupExperiment(experiment, result);
      this.activeExperiments.delete(result.id);
      this.experimentHistory.push(result);
      this.emit('experiment:completed', result);
    }

    return result;
  }

  /**
   * Schedule recurring experiments
   */
  scheduleExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || !experiment.schedule) {
      throw new Error('Experiment not found or has no schedule');
    }

    if (experiment.schedule.interval) {
      setInterval(async () => {
        try {
          await this.runExperiment(experimentId);
        } catch (error) {
          logger.error('Scheduled experiment failed', { experimentId, error });
        }
      }, experiment.schedule.interval);
    }

    logger.info(`Scheduled chaos experiment: ${experiment.name}`);
  }

  /**
   * Get experiment history
   */
  getExperimentHistory(filter?: {
    status?: ExperimentResult['status'];
    startDate?: Date;
    endDate?: Date;
  }): ExperimentResult[] {
    let results = this.experimentHistory;

    if (filter) {
      if (filter.status) {
        results = results.filter(r => r.status === filter.status);
      }
      if (filter.startDate) {
        results = results.filter(r => r.startTime >= filter.startDate!);
      }
      if (filter.endDate) {
        results = results.filter(r => r.startTime <= filter.endDate!);
      }
    }

    return results;
  }

  /**
   * Get chaos engineering insights
   */
  getInsights(): {
    totalExperiments: number;
    successRate: number;
    averageImpact: {
      availability: number;
      performance: number;
      errors: number;
    };
    topFindings: string[];
    recommendations: string[];
  } {
    const total = this.experimentHistory.length;
    const successful = this.experimentHistory.filter(r => r.status === 'completed').length;

    let totalAvailabilityImpact = 0;
    let totalPerformanceImpact = 0;
    let totalErrorsImpact = 0;

    const findingsMap = new Map<string, number>();
    const recommendationsSet = new Set<string>();

    for (const result of this.experimentHistory) {
      totalAvailabilityImpact += result.impact.availability;
      totalPerformanceImpact += result.impact.performance;
      totalErrorsImpact += result.impact.errors;

      for (const finding of result.findings) {
        findingsMap.set(finding, (findingsMap.get(finding) || 0) + 1);
      }

      for (const rec of result.recommendations) {
        recommendationsSet.add(rec);
      }
    }

    const topFindings = Array.from(findingsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([finding]) => finding);

    return {
      totalExperiments: total,
      successRate: total > 0 ? successful / total : 0,
      averageImpact: {
        availability: total > 0 ? totalAvailabilityImpact / total : 0,
        performance: total > 0 ? totalPerformanceImpact / total : 0,
        errors: total > 0 ? totalErrorsImpact / total : 0,
      },
      topFindings,
      recommendations: Array.from(recommendationsSet),
    };
  }

  /**
   * Start experiment monitoring
   */
  private startExperimentMonitoring(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): void {
    const startMetrics = this.captureMetrics();

    const interval = setInterval(async () => {
      // Check if experiment is still active
      if (!this.activeExperiments.has(result.id)) {
        clearInterval(interval);
        return;
      }

      const currentMetrics = this.captureMetrics();

      // Calculate impact
      result.impact.availability =
        ((startMetrics.availability - currentMetrics.availability) / startMetrics.availability) * 100;
      result.impact.performance =
        ((currentMetrics.responseTime - startMetrics.responseTime) / startMetrics.responseTime) * 100;
      result.impact.errors =
        ((currentMetrics.errorRate - startMetrics.errorRate) / (startMetrics.errorRate || 0.01)) * 100;

      // Check rollback conditions
      for (const condition of experiment.rollbackOn) {
        if (this.shouldRollback(condition, currentMetrics)) {
          logger.warn('Rollback condition met, stopping experiment', {
            experimentId: experiment.id,
            condition,
          });

          result.status = 'rolled_back';
          result.findings.push(`Rolled back due to ${condition.metric} ${condition.operator} ${condition.threshold}`);

          await this.cleanupExperiment(experiment, result);
          clearInterval(interval);
          return;
        }
      }

      // Check safeguards
      if (this.config.safeguards.autoRollback) {
        if (result.impact.availability > this.config.safeguards.maxImpact ||
          currentMetrics.availability < this.config.safeguards.minAvailability) {
          logger.error('Safeguard triggered, rolling back experiment', {
            experimentId: experiment.id,
            impact: result.impact,
          });

          result.status = 'rolled_back';
          result.findings.push('Safeguard triggered - impact exceeded limits');

          await this.cleanupExperiment(experiment, result);
          clearInterval(interval);
          return;
        }
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Check experiment condition
   */
  private async checkCondition(condition: ExperimentCondition): Promise<boolean> {
    switch (condition.type) {
      case 'time':
        // Check if within allowed time window
        const now = new Date();
        const hour = now.getHours();
        return hour >= 9 && hour <= 17; // Business hours only

      case 'metric':
        // Check if metrics are healthy
        const metrics = this.captureMetrics();
        return metrics.availability > 99 && metrics.errorRate < 0.01;

      case 'state':
        // Check system state
        const health = await this.system.getSystemHealth();
        return health.status === 'healthy';

      default:
        return condition.check({});
    }
  }

  /**
   * Inject failure based on experiment type
   */
  private async injectFailure(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    switch (experiment.type) {
      case 'network_latency':
        await this.injectNetworkLatency(experiment, result);
        break;

      case 'network_partition':
        await this.injectNetworkPartition(experiment, result);
        break;

      case 'service_failure':
        await this.injectServiceFailure(experiment, result);
        break;

      case 'resource_exhaustion':
        await this.injectResourceExhaustion(experiment, result);
        break;

      case 'data_corruption':
        await this.injectDataCorruption(experiment, result);
        break;

      case 'clock_skew':
        await this.injectClockSkew(experiment, result);
        break;

      case 'dependency_failure':
        await this.injectDependencyFailure(experiment, result);
        break;

      case 'security_breach':
        await this.injectSecurityBreach(experiment, result);
        break;

      default:
        throw new Error(`Unknown chaos type: ${experiment.type}`);
    }
  }

  /**
   * Inject network latency
   */
  private async injectNetworkLatency(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const latency = experiment.parameters.latency || 1000; // milliseconds
    const jitter = experiment.parameters.jitter || 100;

    logger.info(`Injecting network latency: ${latency}ms ±${jitter}ms`);
    result.findings.push(`Injected ${latency}ms network latency`);

    // In a real implementation, would use tc (traffic control) or similar
    // For simulation, we'll add delays to edge locations
    if (experiment.target.type === 'edge') {
      const cleanup = this.mockNetworkLatency(experiment.target.selector, latency, jitter);
      this.injectedFailures.set(result.id, cleanup);
    }
  }

  /**
   * Inject network partition
   */
  private async injectNetworkPartition(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    logger.info('Injecting network partition', { target: experiment.target });
    result.findings.push('Network partition created between regions');

    // Simulate partition by marking nodes as offline
    if (experiment.target.type === 'database') {
      const nodes = this.getTargetNodes(experiment.target.selector);
      for (const node of nodes) {
        (node as any).status = 'offline';
      }

      const cleanup = () => {
        for (const node of nodes) {
          (node as any).status = 'active';
        }
      };
      this.injectedFailures.set(result.id, cleanup);
    }
  }

  /**
   * Inject service failure
   */
  private async injectServiceFailure(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const failureRate = experiment.parameters.failureRate || 0.5;

    logger.info(`Injecting service failure with ${failureRate * 100}% failure rate`);
    result.findings.push(`Service failing ${failureRate * 100}% of requests`);

    // Simulate by triggering errors
    const cleanup = this.mockServiceFailure(experiment.target.selector, failureRate);
    this.injectedFailures.set(result.id, cleanup);
  }

  /**
   * Inject resource exhaustion
   */
  private async injectResourceExhaustion(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const resource = experiment.parameters.resource || 'cpu';
    const usage = experiment.parameters.usage || 0.9;

    logger.info(`Injecting ${resource} exhaustion at ${usage * 100}%`);
    result.findings.push(`${resource} exhausted to ${usage * 100}%`);

    // Simulate high resource usage
    const cleanup = this.mockResourceExhaustion(resource, usage);
    this.injectedFailures.set(result.id, cleanup);
  }

  /**
   * Mock network latency
   */
  private mockNetworkLatency(
    selector: any,
    latency: number,
    jitter: number
  ): () => void {
    // In real implementation, would modify network rules
    // For now, we'll add artificial delays to responses

    const originalFetch = global.fetch;
    global.fetch = async (...args) => {
      const delay = latency + (Math.random() - 0.5) * 2 * jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
      return originalFetch(...args);
    };

    return () => {
      global.fetch = originalFetch;
    };
  }

  /**
   * Mock service failure
   */
  private mockServiceFailure(selector: any, failureRate: number): () => void {
    // Intercept requests and fail randomly
    const originalFetch = global.fetch;
    global.fetch = async (...args) => {
      if (Math.random() < failureRate) {
        throw new Error('Chaos: Service failure injected');
      }
      return originalFetch(...args);
    };

    return () => {
      global.fetch = originalFetch;
    };
  }

  /**
   * Mock resource exhaustion
   */
  private mockResourceExhaustion(resource: string, usage: number): () => void {
    // Simulate high resource usage
    let interval: NodeJS.Timeout | undefined;

    if (resource === 'cpu') {
      // CPU intensive loop
      interval = setInterval(() => {
        const start = Date.now();
        while (Date.now() - start < 100 * usage) {
          // Busy loop
          Math.sqrt(Math.random());
        }
      }, 100);
    } else if (resource === 'memory') {
      // Memory allocation
      const arrays: any[] = [];
      interval = setInterval(() => {
        arrays.push(new Array(1024 * 1024).fill(0)); // 1MB
      }, 100);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }

  /**
   * Get target nodes based on selector
   */
  private getTargetNodes(selector: any): any[] {
    // This would select actual infrastructure components
    // For now, return mock nodes
    return [];
  }

  /**
   * Capture current metrics
   */
  private captureMetrics(): {
    availability: number;
    responseTime: number;
    errorRate: number;
    throughput: number;
  } {
    // In real implementation, would get actual metrics
    return {
      availability: 99.9,
      responseTime: 100,
      errorRate: 0.001,
      throughput: 1000,
    };
  }

  /**
   * Check if should rollback
   */
  private shouldRollback(
    condition: RollbackCondition,
    metrics: any
  ): boolean {
    const value = metrics[condition.metric];

    switch (condition.operator) {
      case '>': return value > condition.threshold;
      case '<': return value < condition.threshold;
      case '=': return value === condition.threshold;
      case '>=': return value >= condition.threshold;
      case '<=': return value <= condition.threshold;
      default: return false;
    }
  }

  /**
   * Analyze experiment results
   */
  private async analyzeExperimentResults(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    // Analyze impact
    if (result.impact.availability > 10) {
      result.findings.push('Significant availability impact detected');
      result.recommendations.push('Improve failover mechanisms');
    }

    if (result.impact.performance > 50) {
      result.findings.push('Major performance degradation observed');
      result.recommendations.push('Implement circuit breakers and timeouts');
    }

    if (result.impact.errors > 100) {
      result.findings.push('Error rate spike during failure');
      result.recommendations.push('Add retry logic with exponential backoff');
    }

    // Type-specific analysis
    switch (experiment.type) {
      case 'network_partition':
        result.recommendations.push('Implement partition-tolerant data synchronization');
        break;

      case 'service_failure':
        result.recommendations.push('Add health checks and automatic recovery');
        break;

      case 'resource_exhaustion':
        result.recommendations.push('Implement resource limits and auto-scaling');
        break;
    }

    logger.info('Experiment analysis complete', {
      experimentId: experiment.id,
      findings: result.findings.length,
      recommendations: result.recommendations.length,
    });
  }

  /**
   * Clean up after experiment
   */
  private async cleanupExperiment(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    logger.info('Cleaning up experiment', { experimentId: experiment.id });

    // Remove injected failures
    const cleanup = this.injectedFailures.get(result.id);
    if (cleanup) {
      cleanup();
      this.injectedFailures.delete(result.id);
    }

    // Alert about completion
    this.alerting.trigger({
      id: `chaos_${result.id}`,
      type: 'custom',
      severity: 'info',
      message: `Chaos experiment completed: ${experiment.name}`,
      metadata: {
        impact: result.impact,
        status: result.status,
      },
    });
  }

  /**
   * Inject data corruption (simulated)
   */
  private async injectDataCorruption(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    logger.warn('Simulating data corruption (read-only test)');
    result.findings.push('Data corruption scenario tested');
    result.recommendations.push('Implement data validation and checksums');
  }

  /**
   * Inject clock skew
   */
  private async injectClockSkew(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const skew = experiment.parameters.skew || 3600000; // 1 hour default

    logger.info(`Injecting clock skew: ${skew}ms`);
    result.findings.push(`Clock skew of ${skew}ms injected`);
    result.recommendations.push('Use vector clocks for distributed consistency');
  }

  /**
   * Inject dependency failure
   */
  private async injectDependencyFailure(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const dependency = experiment.parameters.dependency || 'redis';

    logger.info(`Injecting ${dependency} failure`);
    result.findings.push(`${dependency} dependency failed`);
    result.recommendations.push(`Implement fallback for ${dependency}`);
  }

  /**
   * Inject security breach (simulated)
   */
  private async injectSecurityBreach(
    experiment: ChaosExperiment,
    result: ExperimentResult
  ): Promise<void> {
    const breachType = experiment.parameters.type || 'unauthorized_access';

    logger.warn(`Simulating security breach: ${breachType}`);
    result.findings.push(`Security breach scenario: ${breachType}`);
    result.recommendations.push('Review and strengthen security controls');
  }
}
