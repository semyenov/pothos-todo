import { logger } from '@/logger.js';
import { MetricsSystem } from './Metrics.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface SLO {
  id: string;
  name: string;
  description: string;
  target: number; // Target percentage (e.g., 99.9)
  window: SLOWindow;
  sli: SLI;
  enabled: boolean;
  alertThresholds?: {
    warning?: number;
    critical?: number;
  };
}

export interface SLOWindow {
  type: 'rolling' | 'calendar';
  duration: number; // in seconds
  unit: 'hour' | 'day' | 'week' | 'month';
}

export interface SLI {
  type: 'availability' | 'latency' | 'error_rate' | 'throughput' | 'custom';
  metric: string;
  threshold?: number;
  aggregation: 'mean' | 'median' | 'p50' | 'p90' | 'p95' | 'p99';
  goodEvents?: (value: number) => boolean;
  totalEvents?: (value: number) => boolean;
}

export interface SLOStatus {
  sloId: string;
  currentValue: number;
  target: number;
  errorBudget: number;
  errorBudgetRemaining: number;
  burnRate: number;
  isViolated: boolean;
  prediction?: {
    willViolate: boolean;
    timeToViolation?: number; // seconds
  };
}

export interface ErrorBudgetPolicy {
  id: string;
  sloId: string;
  actions: Array<{
    threshold: number; // percentage of error budget consumed
    action: 'alert' | 'freeze_deployments' | 'increase_resources' | 'custom';
    config?: any;
  }>;
}

/**
 * Advanced SLO/SLA Monitoring System
 */
export class SLOMonitoringSystem extends EventEmitterSingletonService<SLOMonitoringSystem> {
  private slos: Map<string, SLO> = new Map();
  private sloData: Map<string, Array<{ timestamp: Date; value: number }>> = new Map();
  private errorBudgetPolicies: Map<string, ErrorBudgetPolicy> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private metricsSystem: MetricsSystem | null = null;

  protected constructor() {
    super();
  }

  private async ensureMetricsSystem(): Promise<MetricsSystem> {
    if (!this.metricsSystem) {
      this.metricsSystem = await MetricsSystem.getInstance();
    }
    return this.metricsSystem;
  }

  static getInstance(): SLOMonitoringSystem {
    return super.getInstance();
  }

  /**
   * Register an SLO
   */
  async registerSLO(slo: SLO): Promise<void> {
    this.slos.set(slo.id, slo);
    this.sloData.set(slo.id, []);
    
    // Create custom metrics for this SLO
    const metricsSystem = await this.ensureMetricsSystem();
    metricsSystem.createCustomMetric(
      `slo_${slo.id}_compliance`,
      'gauge',
      { description: `Compliance rate for SLO: ${slo.name}` }
    );
    
    metricsSystem.createCustomMetric(
      `slo_${slo.id}_error_budget`,
      'gauge',
      { description: `Error budget remaining for SLO: ${slo.name}` }
    );

    logger.info(`Registered SLO: ${slo.name} with target ${slo.target}%`);
  }

  /**
   * Register an error budget policy
   */
  registerErrorBudgetPolicy(policy: ErrorBudgetPolicy): void {
    this.errorBudgetPolicies.set(policy.sloId, policy);
    logger.info(`Registered error budget policy for SLO: ${policy.sloId}`);
  }

  /**
   * Start SLO monitoring
   */
  start(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.evaluateAllSLOs();
    }, intervalMs);

    // Initial evaluation
    this.evaluateAllSLOs();
    
    logger.info('SLO monitoring system started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    logger.info('SLO monitoring system stopped');
  }

  /**
   * Record an SLI measurement
   */
  recordSLI(sloId: string, value: number): void {
    const dataPoints = this.sloData.get(sloId);
    if (!dataPoints) {
      logger.warn(`SLO ${sloId} not found`);
      return;
    }

    dataPoints.push({ timestamp: new Date(), value });
    
    // Keep data within the window
    const slo = this.slos.get(sloId);
    if (slo) {
      const windowDuration = this.getWindowDurationInMs(slo.window);
      const cutoff = new Date(Date.now() - windowDuration);
      const index = dataPoints.findIndex(dp => dp.timestamp >= cutoff);
      if (index > 0) {
        dataPoints.splice(0, index);
      }
    }
  }

  /**
   * Evaluate all SLOs
   */
  private async evaluateAllSLOs(): Promise<void> {
    for (const [sloId, slo] of this.slos) {
      if (slo.enabled) {
        await this.evaluateSLO(sloId);
      }
    }
  }

  /**
   * Evaluate a specific SLO
   */
  async evaluateSLO(sloId: string): Promise<SLOStatus | null> {
    const slo = this.slos.get(sloId);
    const dataPoints = this.sloData.get(sloId);
    
    if (!slo || !dataPoints || dataPoints.length === 0) {
      return null;
    }

    // Calculate SLI compliance
    const compliance = this.calculateCompliance(slo, dataPoints);
    const errorBudget = 100 - slo.target;
    const errorBudgetUsed = (slo.target - compliance) / errorBudget * 100;
    const errorBudgetRemaining = Math.max(0, 100 - errorBudgetUsed);
    
    // Calculate burn rate
    const burnRate = this.calculateBurnRate(slo, dataPoints);
    
    // Predict future violations
    const prediction = this.predictViolation(slo, dataPoints, compliance, burnRate);
    
    const status: SLOStatus = {
      sloId,
      currentValue: compliance,
      target: slo.target,
      errorBudget,
      errorBudgetRemaining,
      burnRate,
      isViolated: compliance < slo.target,
      prediction,
    };

    // Record metrics
    this.metricsSystem.record('apiErrors', status.isViolated ? 1 : 0, {
      type: 'slo_violation',
      slo_id: sloId,
    });

    // Check error budget policies
    await this.checkErrorBudgetPolicies(sloId, errorBudgetUsed);

    // Emit events
    if (status.isViolated) {
      this.emit('slo:violated', { slo, status });
    }
    
    if (prediction?.willViolate) {
      this.emit('slo:prediction', { slo, status, prediction });
    }

    return status;
  }

  /**
   * Calculate SLI compliance percentage
   */
  private calculateCompliance(slo: SLO, dataPoints: Array<{ timestamp: Date; value: number }>): number {
    if (dataPoints.length === 0) return 100;

    let goodEvents = 0;
    let totalEvents = dataPoints.length;

    switch (slo.sli.type) {
      case 'availability':
        goodEvents = dataPoints.filter(dp => dp.value === 1).length;
        break;
        
      case 'latency':
        if (slo.sli.threshold) {
          goodEvents = dataPoints.filter(dp => dp.value < slo.sli.threshold!).length;
        }
        break;
        
      case 'error_rate':
        if (slo.sli.threshold) {
          goodEvents = dataPoints.filter(dp => dp.value < slo.sli.threshold!).length;
        }
        break;
        
      case 'custom':
        if (slo.sli.goodEvents) {
          goodEvents = dataPoints.filter(dp => slo.sli.goodEvents!(dp.value)).length;
        }
        break;
    }

    return (goodEvents / totalEvents) * 100;
  }

  /**
   * Calculate error budget burn rate
   */
  private calculateBurnRate(slo: SLO, dataPoints: Array<{ timestamp: Date; value: number }>): number {
    if (dataPoints.length < 2) return 0;

    // Get recent data (last hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentData = dataPoints.filter(dp => dp.timestamp >= oneHourAgo);
    
    if (recentData.length === 0) return 0;

    const recentCompliance = this.calculateCompliance(slo, recentData);
    const errorRate = 100 - recentCompliance;
    const expectedErrorRate = 100 - slo.target;
    
    return expectedErrorRate > 0 ? errorRate / expectedErrorRate : 0;
  }

  /**
   * Predict future SLO violations
   */
  private predictViolation(
    slo: SLO,
    dataPoints: Array<{ timestamp: Date; value: number }>,
    currentCompliance: number,
    burnRate: number
  ): SLOStatus['prediction'] {
    if (dataPoints.length < 10 || burnRate <= 1) {
      return { willViolate: false };
    }

    // Simple linear prediction
    const windowDuration = this.getWindowDurationInMs(slo.window);
    const remainingTime = windowDuration - (Date.now() - dataPoints[0].timestamp.getTime());
    
    // Project compliance based on burn rate
    const projectedErrorBudgetUsed = burnRate * (remainingTime / windowDuration) * 100;
    const projectedCompliance = slo.target - (projectedErrorBudgetUsed * (100 - slo.target) / 100);
    
    if (projectedCompliance < slo.target) {
      const currentErrorRate = 100 - currentCompliance;
      const timeToViolation = burnRate > 0 ? 
        (slo.target - currentCompliance) / (currentErrorRate * burnRate) * 3600 : 
        undefined;
      
      return {
        willViolate: true,
        timeToViolation,
      };
    }

    return { willViolate: false };
  }

  /**
   * Check and execute error budget policies
   */
  private async checkErrorBudgetPolicies(sloId: string, errorBudgetUsed: number): Promise<void> {
    const policy = this.errorBudgetPolicies.get(sloId);
    if (!policy) return;

    for (const action of policy.actions) {
      if (errorBudgetUsed >= action.threshold) {
        await this.executeErrorBudgetAction(sloId, action);
      }
    }
  }

  /**
   * Execute an error budget policy action
   */
  private async executeErrorBudgetAction(sloId: string, action: any): Promise<void> {
    logger.warn(`Executing error budget action for SLO ${sloId}: ${action.action}`);
    
    switch (action.action) {
      case 'alert':
        this.emit('slo:alert', { sloId, action });
        break;
        
      case 'freeze_deployments':
        this.emit('slo:freeze_deployments', { sloId, action });
        break;
        
      case 'increase_resources':
        this.emit('slo:scale_up', { sloId, action });
        break;
        
      case 'custom':
        this.emit('slo:custom_action', { sloId, action });
        break;
    }
  }

  /**
   * Get window duration in milliseconds
   */
  private getWindowDurationInMs(window: SLOWindow): number {
    const multipliers = {
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2592000000,
    };
    
    return window.duration * multipliers[window.unit];
  }

  /**
   * Get current status of all SLOs
   */
  async getAllSLOStatuses(): Promise<SLOStatus[]> {
    const statuses: SLOStatus[] = [];
    
    for (const sloId of this.slos.keys()) {
      const status = await this.evaluateSLO(sloId);
      if (status) {
        statuses.push(status);
      }
    }
    
    return statuses;
  }

  /**
   * Generate SLO report
   */
  generateReport(sloId: string, period: 'daily' | 'weekly' | 'monthly'): any {
    const slo = this.slos.get(sloId);
    const dataPoints = this.sloData.get(sloId);
    
    if (!slo || !dataPoints) {
      return null;
    }

    const periodMs = {
      daily: 86400000,
      weekly: 604800000,
      monthly: 2592000000,
    };
    
    const cutoff = new Date(Date.now() - periodMs[period]);
    const periodData = dataPoints.filter(dp => dp.timestamp >= cutoff);
    
    const compliance = this.calculateCompliance(slo, periodData);
    const violations = periodData.filter((dp, i) => {
      const windowData = periodData.slice(Math.max(0, i - 100), i + 1);
      return this.calculateCompliance(slo, windowData) < slo.target;
    }).length;
    
    return {
      sloId,
      sloName: slo.name,
      period,
      target: slo.target,
      achieved: compliance,
      violations,
      dataPoints: periodData.length,
      errorBudgetUsed: ((slo.target - compliance) / (100 - slo.target)) * 100,
    };
  }
}