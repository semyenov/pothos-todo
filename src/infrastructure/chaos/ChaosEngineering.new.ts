import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ChaosEngineeringEventMap } from '../core/InfrastructureEventMaps.js';
import { ChaosEngineeringConfig, ChaosEngineeringConfigSchema } from '@/config/schemas/infrastructure.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
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

/**
 * Chaos Engineering System
 * Implements controlled failure injection for resilience testing
 * 
 * @example
 * ```typescript
 * const chaos = await ChaosEngineeringSystem.getInstance();
 * 
 * // Listen to experiment events
 * chaos.on('experiment:started', ({ experimentId }) => {
 *   console.log(`Chaos experiment ${experimentId} started`);
 * });
 * 
 * // Create and run an experiment
 * const experiment = await chaos.createExperiment({
 *   name: 'Network Latency Test',
 *   type: 'network_latency',
 *   target: { type: 'service', selector: { id: 'api-gateway' } },
 *   parameters: { latency: 500 },
 *   duration: 60000
 * });
 * 
 * await chaos.runExperiment(experiment.id);
 * ```
 */
@ServiceConfig({
  schema: ChaosEngineeringConfigSchema,
  prefix: 'chaos',
  hot: true,
})
export class ChaosEngineeringSystem extends BaseAsyncService<ChaosEngineeringConfig, ChaosEngineeringEventMap> {
  private experiments: Map<string, ChaosExperiment> = new Map();
  private activeExperiments: Map<string, ExperimentResult> = new Map();
  private experimentHistory: ExperimentResult[] = [];
  private injectedFailures: Map<string, () => void> = new Map();

  // Dependencies
  private system!: SystemIntegration;
  private edgeComputing!: EdgeComputingSystem;
  private dataReplication!: DataReplicationSystem;
  private metrics!: MetricsSystem;
  private alerting!: AlertingSystem;

  private monitoringInterval?: NodeJS.Timeout;

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<ChaosEngineeringSystem> {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'chaos-engineering';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Controlled failure injection system for resilience testing';
  }

  protected getServiceDependencies(): string[] {
    return ['system-integration', 'edge-computing', 'data-replication', 'metrics', 'alerting'];
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('ChaosEngineeringSystem initializing', {
      enabled: this.config.enabled,
      dryRun: this.config.dryRun,
      maxConcurrent: this.config.maxConcurrentExperiments,
    });

    // Initialize dependencies
    this.system = SystemIntegration.getInstance();
    this.edgeComputing = EdgeComputingSystem.getInstance();
    this.dataReplication = DataReplicationSystem.getInstance();
    this.metrics = MetricsSystem.getInstance();
    this.alerting = AlertingSystem.getInstance();
  }

  /**
   * Start the chaos engineering system
   */
  protected async onStart(): Promise<void> {
    if (!this.config.enabled) {
      logger.warn('Chaos Engineering is disabled by configuration');
      return;
    }

    // Start monitoring
    this.startMonitoring();

    logger.info('Chaos Engineering System started', {
      mode: this.config.dryRun ? 'dry-run' : 'active',
      safeguards: this.config.safeguards,
    });
  }

  /**
   * Stop the chaos engineering system
   */
  protected async onStop(): Promise<void> {
    // Stop all active experiments
    for (const [experimentId] of this.activeExperiments) {
      await this.stopExperiment(experimentId, 'system_shutdown');
    }

    // Clear monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Chaos Engineering System stopped');
  }

  /**
   * Handle configuration changes
   */
  protected async onConfigChanged(oldConfig: ChaosEngineeringConfig, newConfig: ChaosEngineeringConfig): Promise<void> {
    // If enabling/disabling chaos, restart the service
    if (oldConfig.enabled !== newConfig.enabled) {
      await this.restart();
      return;
    }

    // Update safeguards immediately
    logger.info('Chaos configuration updated', {
      safeguards: newConfig.safeguards,
      maxConcurrent: newConfig.maxConcurrentExperiments,
    });
  }

  /**
   * Check system health for chaos experiments
   */
  @HealthCheck({
    name: 'chaos:safety',
    critical: true,
    interval: 30000,
  })
  async checkSafety(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    if (!this.config.enabled) {
      return { status: 'healthy', message: 'Chaos engineering is disabled' };
    }

    const activeCount = this.activeExperiments.size;
    const systemHealth = await this.checkSystemHealth();

    if (systemHealth.availability < this.config.safeguards.minAvailability) {
      return {
        status: 'unhealthy',
        message: `System availability (${systemHealth.availability}%) below minimum (${this.config.safeguards.minAvailability}%)`,
      };
    }

    if (activeCount >= this.config.maxConcurrentExperiments) {
      return {
        status: 'degraded',
        message: `Maximum concurrent experiments (${this.config.maxConcurrentExperiments}) reached`,
      };
    }

    return {
      status: 'healthy',
      message: `${activeCount} active experiments, system healthy`,
    };
  }

  /**
   * Create a new chaos experiment
   */
  @Metric({ name: 'chaos.experiment.created' })
  async createExperiment(experiment: Omit<ChaosExperiment, 'id'>): Promise<ChaosExperiment> {
    const id = `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullExperiment: ChaosExperiment = { ...experiment, id };

    // Validate experiment
    this.validateExperiment(fullExperiment);

    this.experiments.set(id, fullExperiment);
    
    this.emit('experiment:created', {
      experiment: {
        id: fullExperiment.id,
        name: fullExperiment.name,
        type: fullExperiment.type,
      },
    });

    logger.info('Chaos experiment created', {
      experimentId: id,
      name: experiment.name,
      type: experiment.type,
    });

    return fullExperiment;
  }

  /**
   * Run a chaos experiment
   */
  @Retry({ attempts: 2, delay: 5000 })
  @CircuitBreaker({ threshold: 3, timeout: 60000 })
  @Metric({ name: 'chaos.experiment.run', recordDuration: true })
  async runExperiment(experimentId: string): Promise<ExperimentResult> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // Check if we can run more experiments
    if (this.activeExperiments.size >= this.config.maxConcurrentExperiments) {
      throw new Error('Maximum concurrent experiments reached');
    }

    // Check system health
    const health = await this.checkSystemHealth();
    if (health.availability < this.config.safeguards.minAvailability) {
      throw new Error('System health below minimum threshold');
    }

    // Create experiment result
    const result: ExperimentResult = {
      id: `result_${Date.now()}`,
      experimentId,
      startTime: new Date(),
      status: 'running',
      impact: { availability: 100, performance: 100, errors: 0 },
      findings: [],
      recommendations: [],
    };

    this.activeExperiments.set(experimentId, result);

    this.emit('experiment:started', {
      experimentId,
      targets: this.getTargetIds(experiment.target),
    });

    try {
      // Inject chaos
      if (!this.config.dryRun) {
        await this.injectChaos(experiment);
      } else {
        logger.info('DRY RUN: Would inject chaos', {
          type: experiment.type,
          target: experiment.target,
        });
      }

      // Monitor for duration
      await this.monitorExperiment(experiment, result);

      // Complete experiment
      result.status = 'completed';
      result.endTime = new Date();

      this.emit('experiment:completed', {
        experimentId,
        result: 'success',
      });

    } catch (error) {
      result.status = 'failed';
      result.endTime = new Date();
      result.findings.push(`Experiment failed: ${(error as Error).message}`);

      this.emit('experiment:failed', {
        experimentId,
        error: error as Error,
      });

      throw error;
    } finally {
      // Clean up chaos
      await this.clearChaos(experiment);
      
      // Move to history
      this.activeExperiments.delete(experimentId);
      this.experimentHistory.push(result);
      
      // Keep only recent history
      if (this.experimentHistory.length > 100) {
        this.experimentHistory = this.experimentHistory.slice(-100);
      }
    }

    return result;
  }

  /**
   * Stop a running experiment
   */
  @Metric({ name: 'chaos.experiment.stopped' })
  async stopExperiment(experimentId: string, reason: string): Promise<void> {
    const result = this.activeExperiments.get(experimentId);
    if (!result) {
      return;
    }

    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      return;
    }

    // Clear chaos
    await this.clearChaos(experiment);

    // Update result
    result.status = 'rolled_back';
    result.endTime = new Date();
    result.findings.push(`Experiment stopped: ${reason}`);

    // Move to history
    this.activeExperiments.delete(experimentId);
    this.experimentHistory.push(result);

    this.emit('experiment:rollback', {
      experimentId,
      reason,
    });

    logger.info('Chaos experiment stopped', {
      experimentId,
      reason,
    });
  }

  /**
   * Inject chaos based on experiment type
   */
  private async injectChaos(experiment: ChaosExperiment): Promise<void> {
    const { type, target, parameters } = experiment;

    this.emit('chaos:injected', {
      type,
      target: JSON.stringify(target),
      parameters,
    });

    switch (type) {
      case 'network_latency':
        await this.injectNetworkLatency(target, parameters);
        break;
      case 'network_partition':
        await this.injectNetworkPartition(target, parameters);
        break;
      case 'service_failure':
        await this.injectServiceFailure(target, parameters);
        break;
      case 'resource_exhaustion':
        await this.injectResourceExhaustion(target, parameters);
        break;
      case 'data_corruption':
        await this.injectDataCorruption(target, parameters);
        break;
      case 'clock_skew':
        await this.injectClockSkew(target, parameters);
        break;
      case 'dependency_failure':
        await this.injectDependencyFailure(target, parameters);
        break;
      case 'security_breach':
        await this.injectSecurityBreach(target, parameters);
        break;
      default:
        throw new Error(`Unknown chaos type: ${type}`);
    }
  }

  /**
   * Clear injected chaos
   */
  private async clearChaos(experiment: ChaosExperiment): Promise<void> {
    const clearFn = this.injectedFailures.get(experiment.id);
    if (clearFn) {
      clearFn();
      this.injectedFailures.delete(experiment.id);
    }

    this.emit('chaos:cleared', {
      type: experiment.type,
      target: JSON.stringify(experiment.target),
    });
  }

  /**
   * Monitor experiment and check for rollback conditions
   */
  private async monitorExperiment(experiment: ChaosExperiment, result: ExperimentResult): Promise<void> {
    const startTime = Date.now();
    const checkInterval = this.config.monitoring.checkInterval;

    while (Date.now() - startTime < experiment.duration) {
      // Check system health
      const health = await this.checkSystemHealth();
      
      // Update impact metrics
      result.impact.availability = health.availability;
      result.impact.performance = health.performance;
      result.impact.errors = health.errorRate;

      // Check rollback conditions
      for (const condition of experiment.rollbackOn) {
        if (this.checkRollbackCondition(condition, health)) {
          this.emit('safeguard:triggered', {
            type: 'rollback',
            action: 'stop_experiment',
            reason: `Rollback condition met: ${condition.metric} ${condition.operator} ${condition.threshold}`,
          });

          if (this.config.safeguards.autoRollback) {
            await this.stopExperiment(experiment.id, 'rollback_condition_met');
            return;
          }
        }
      }

      // Emit metrics
      this.emit('metrics:collected', {
        experimentId: experiment.id,
        metrics: {
          availability: health.availability,
          performance: health.performance,
          errorRate: health.errorRate,
        },
      });

      // Record metrics
      this.recordMetric('chaos.impact.availability', health.availability, { experiment: experiment.name });
      this.recordMetric('chaos.impact.performance', health.performance, { experiment: experiment.name });
      this.recordMetric('chaos.impact.errors', health.errorRate, { experiment: experiment.name });

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * Validate experiment configuration
   */
  private validateExperiment(experiment: ChaosExperiment): void {
    if (!this.config.experiments.allowedTypes.includes(experiment.type)) {
      throw new Error(`Chaos type '${experiment.type}' is not allowed`);
    }

    if (experiment.duration < 1000) {
      throw new Error('Experiment duration must be at least 1 second');
    }

    if (experiment.duration > 3600000) {
      throw new Error('Experiment duration cannot exceed 1 hour');
    }
  }

  /**
   * Check system health metrics
   */
  private async checkSystemHealth(): Promise<{
    availability: number;
    performance: number;
    errorRate: number;
  }> {
    // Get metrics from monitoring systems
    const edgeHealth = await this.edgeComputing.getSystemStatus();
    const metricsData = await this.metrics.getRealtimeMetrics(['error_rate', 'response_time', 'uptime']);

    // Calculate availability (simplified)
    const availability = (edgeHealth.healthy / edgeHealth.total) * 100;

    // Calculate performance (based on response time)
    const avgResponseTime = metricsData.find(m => m.name === 'response_time')?.value || 100;
    const performance = Math.max(0, 100 - (avgResponseTime - 100) / 10);

    // Get error rate
    const errorRate = metricsData.find(m => m.name === 'error_rate')?.value || 0;

    return { availability, performance, errorRate };
  }

  /**
   * Check if rollback condition is met
   */
  private checkRollbackCondition(
    condition: RollbackCondition,
    health: { availability: number; performance: number; errorRate: number }
  ): boolean {
    const value = health[condition.metric as keyof typeof health] || 0;

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
   * Get target IDs from chaos target
   */
  private getTargetIds(target: ChaosTarget): string[] {
    const ids: string[] = [];
    
    if (target.selector.id) {
      ids.push(target.selector.id);
    }
    
    // In a real implementation, this would query the service registry
    // or other systems to find matching targets
    
    return ids;
  }

  /**
   * Start monitoring active experiments
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      // Check active experiments
      for (const [experimentId, result] of this.activeExperiments) {
        if (result.status === 'running') {
          const duration = Date.now() - result.startTime.getTime();
          
          this.emit('impact:detected', {
            metric: 'experiment_duration',
            value: duration,
            threshold: this.config.experiments.defaultDuration,
          });
        }
      }

      // Clean up old history
      const retentionTime = this.config.monitoring.metricsRetention * 1000;
      const cutoffTime = Date.now() - retentionTime;
      
      this.experimentHistory = this.experimentHistory.filter(
        result => result.endTime && result.endTime.getTime() > cutoffTime
      );
    }, this.config.monitoring.checkInterval);
  }

  // Chaos injection methods (simplified implementations)
  private async injectNetworkLatency(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting network latency', { target, latency: params.latency });
    // Implementation would add network delays
  }

  private async injectNetworkPartition(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting network partition', { target, params });
    // Implementation would block network traffic
  }

  private async injectServiceFailure(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting service failure', { target, params });
    // Implementation would make services return errors
  }

  private async injectResourceExhaustion(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting resource exhaustion', { target, params });
    // Implementation would consume resources
  }

  private async injectDataCorruption(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting data corruption', { target, params });
    // Implementation would corrupt data in controlled way
  }

  private async injectClockSkew(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting clock skew', { target, params });
    // Implementation would adjust system clocks
  }

  private async injectDependencyFailure(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Injecting dependency failure', { target, params });
    // Implementation would fail dependencies
  }

  private async injectSecurityBreach(target: ChaosTarget, params: any): Promise<void> {
    logger.info('Simulating security breach', { target, params });
    // Implementation would simulate security issues
  }

  /**
   * Get experiment statistics
   */
  async getStats(): Promise<{
    totalExperiments: number;
    activeExperiments: number;
    completedExperiments: number;
    failedExperiments: number;
    averageImpact: {
      availability: number;
      performance: number;
      errors: number;
    };
  }> {
    const completed = this.experimentHistory.filter(r => r.status === 'completed').length;
    const failed = this.experimentHistory.filter(r => r.status === 'failed').length;
    
    // Calculate average impact
    const impacts = this.experimentHistory.map(r => r.impact);
    const avgImpact = impacts.length > 0 ? {
      availability: impacts.reduce((sum, i) => sum + i.availability, 0) / impacts.length,
      performance: impacts.reduce((sum, i) => sum + i.performance, 0) / impacts.length,
      errors: impacts.reduce((sum, i) => sum + i.errors, 0) / impacts.length,
    } : { availability: 100, performance: 100, errors: 0 };

    return {
      totalExperiments: this.experiments.size,
      activeExperiments: this.activeExperiments.size,
      completedExperiments: completed,
      failedExperiments: failed,
      averageImpact: avgImpact,
    };
  }
}