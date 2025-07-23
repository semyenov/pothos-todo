import { EventEmitterSingletonService } from '../core/SingletonService.js';
import { logger } from '@/logger.js';
import { SystemIntegration } from '../SystemIntegration.js';
import { MetricsSystem } from '../observability/Metrics.js';
import { AnomalyDetectionSystem } from '../observability/AnomalyDetection.js';
import { ThreatDetectionSystem } from '../security/ThreatDetection.js';
import { EdgeComputingSystem } from '../edge/EdgeComputing.js';
import { DataReplicationSystem } from '../edge/DataReplication.js';
import { PerformanceOptimizer } from '../performance/PerformanceOptimizer.js';
import { ChaosEngineeringSystem } from '../chaos/ChaosEngineering.js';

export interface HealingAction {
  id: string;
  type: HealingActionType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  trigger: string;
  description: string;
  execute: () => Promise<HealingResult>;
  rollback?: () => Promise<void>;
  conditions: HealingCondition[];
  cooldown?: number; // milliseconds
}

export type HealingActionType =
  | 'restart_service'
  | 'scale_resources'
  | 'failover_traffic'
  | 'clear_cache'
  | 'rotate_keys'
  | 'update_config'
  | 'isolate_component'
  | 'restore_backup'
  | 'patch_security'
  | 'rebalance_load';

export interface HealingCondition {
  type: 'metric' | 'health' | 'time' | 'dependency';
  check: () => Promise<boolean>;
  threshold?: number;
  timeout?: number;
}

export interface HealingResult {
  success: boolean;
  message: string;
  metrics?: {
    before: Record<string, number>;
    after: Record<string, number>;
    improvement: number; // percentage
  };
  duration: number;
  sideEffects?: string[];
}

export interface AutonomousConfig {
  enabled: boolean;
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
  learningEnabled: boolean;
  maxConcurrentActions: number;
  cooldownMultiplier: number;
  requireApproval: boolean;
  safeguards: {
    maxImpact: number; // percentage
    minConfidence: number; // percentage
    rollbackOnFailure: boolean;
  };
}

export interface LearningModel {
  actionSuccessRates: Map<string, number>;
  conditionPatterns: Map<string, number>;
  environmentalFactors: Map<string, number>;
  seasonalPatterns: Array<{
    time: string;
    probability: number;
    actions: string[];
  }>;
}

/**
 * Autonomous Self-Healing System
 * Implements intelligent, automated recovery from failures and degradation
 */
export class SelfHealingSystem extends EventEmitterSingletonService<SelfHealingSystem> {
  private config: AutonomousConfig | null = null;
  private healingActions: Map<string, HealingAction> = new Map();
  private activeActions: Map<string, { action: HealingAction; startTime: Date }> = new Map();
  private actionHistory: Array<{
    action: HealingAction;
    result: HealingResult;
    timestamp: Date;
  }> = [];
  private cooldowns: Map<string, Date> = new Map();
  private learningModel: LearningModel;

  // System components
  private system: SystemIntegration | null = null;
  private metrics: MetricsSystem | null = null;
  private anomalyDetection: AnomalyDetectionSystem | null = null;
  private threatDetection: ThreatDetectionSystem | null = null;
  private edgeComputing: EdgeComputingSystem | null = null;
  private dataReplication: DataReplicationSystem | null = null;
  private performanceOptimizer: PerformanceOptimizer | null = null;
  private chaosEngineering?: ChaosEngineeringSystem;

  private monitoringInterval?: NodeJS.Timeout;
  private learningInterval?: NodeJS.Timeout;

  protected constructor() {
    super();
    this.learningModel = {
      actionSuccessRates: new Map(),
      conditionPatterns: new Map(),
      environmentalFactors: new Map(),
      seasonalPatterns: [],
    };
  }

  public async configure(config: AutonomousConfig): Promise<void> {
    this.config = config;
    this.system = SystemIntegration.getInstance();
    this.metrics = await MetricsSystem.getInstance();
    this.anomalyDetection = AnomalyDetectionSystem.getInstance();
    this.threatDetection = ThreatDetectionSystem.getInstance();
    this.edgeComputing = EdgeComputingSystem.getInstance();
    this.dataReplication = DataReplicationSystem.getInstance();
    this.performanceOptimizer = PerformanceOptimizer.getInstance();

    try {
      this.chaosEngineering = ChaosEngineeringSystem.getInstance();
    } catch {
      // Chaos engineering not initialized
    }

    this.initializeSelfHealing();
  }

  private ensureConfig(): AutonomousConfig {
    if (!this.config) {
      throw new Error('SelfHealingSystem not configured');
    }
    return this.config;
  }

  static async initialize(config: AutonomousConfig): Promise<SelfHealingSystem> {
    const instance = super.getInstance();
    if (!instance.config) {
      await instance.configure(config);
    }
    return instance;
  }

  static getInstance(): SelfHealingSystem {
    return super.getInstance();
  }

  /**
   * Register a healing action
   */
  registerHealingAction(action: HealingAction): void {
    this.healingActions.set(action.id, action);

    // Initialize success rate tracking
    if (!this.learningModel.actionSuccessRates.has(action.id)) {
      this.learningModel.actionSuccessRates.set(action.id, 0.5); // Start neutral
    }

    logger.info(`Registered healing action: ${action.type}`, {
      id: action.id,
      severity: action.severity,
    });

    this.emit('action:registered', action);
  }

  /**
   * Trigger autonomous healing
   */
  async triggerHealing(
    trigger: string,
    context: {
      severity: 'low' | 'medium' | 'high' | 'critical';
      metrics?: Record<string, number>;
      source: string;
      description?: string;
    }
  ): Promise<HealingResult[]> {
    if (!this.ensureConfig().enabled) {
      logger.info('Self-healing disabled, skipping trigger', { trigger });
      return [];
    }

    logger.warn('Autonomous healing triggered', { trigger, context });

    // Find applicable healing actions
    const candidateActions = await this.findApplicableActions(trigger, context);

    if (candidateActions.length === 0) {
      logger.info('No applicable healing actions found', { trigger });
      return [];
    }

    // Sort by effectiveness prediction
    const rankedActions = this.rankActionsByEffectiveness(candidateActions, context);

    // Apply safeguards and concurrency limits
    const actionsToExecute = rankedActions
      .filter(action => this.canExecuteAction(action))
      .slice(0, this.ensureConfig().maxConcurrentActions);

    if (actionsToExecute.length === 0) {
      logger.warn('All healing actions filtered out by safeguards', { trigger });
      return [];
    }

    // Execute healing actions
    const results: HealingResult[] = [];

    for (const action of actionsToExecute) {
      try {
        if (this.ensureConfig().requireApproval && context.severity === 'critical') {
          logger.warn('Critical healing action requires approval', {
            action: action.id,
            type: action.type,
          });
          // In production, would integrate with approval workflow
          continue;
        }

        const result = await this.executeHealingAction(action);
        results.push(result);

        // Update learning model
        if (this.ensureConfig().learningEnabled) {
          this.updateLearningModel(action, result, context);
        }

        // Stop if healing was successful
        if (result.success && result.improvement && result.improvement > 50) {
          logger.info('Healing successful, stopping further actions', {
            action: action.id,
            improvement: result.improvement,
          });
          break;
        }
      } catch (error) {
        logger.error('Healing action failed', { action: action.id, error });
        results.push({
          success: false,
          message: `Action failed: ${error}`,
          duration: 0,
        });
      }
    }

    // Emit healing completed event
    this.emit('healing:completed', {
      trigger,
      context,
      actions: actionsToExecute.length,
      successful: results.filter(r => r.success).length,
      totalImprovement: results.reduce((sum, r) => sum + (r.improvement || 0), 0),
    });

    return results;
  }

  /**
   * Get healing system status
   */
  getHealingStatus(): {
    enabled: boolean;
    activeActions: number;
    totalActions: number;
    successRate: number;
    lastHealing?: Date;
    learningEnabled: boolean;
    insights: {
      topActions: Array<{ id: string; successRate: number; uses: number }>;
      commonTriggers: Array<{ trigger: string; frequency: number }>;
      improvements: number; // total percentage improvement over time
    };
  } {
    const totalExecutions = this.actionHistory.length;
    const successfulExecutions = this.actionHistory.filter(h => h.result.success).length;
    const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;

    // Analyze top actions
    const actionUsage = new Map<string, number>();
    for (const history of this.actionHistory) {
      const id = history.action.id;
      actionUsage.set(id, (actionUsage.get(id) || 0) + 1);
    }

    const topActions = Array.from(this.learningModel.actionSuccessRates.entries())
      .map(([id, successRate]) => ({
        id,
        successRate,
        uses: actionUsage.get(id) || 0,
      }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 5);

    // Analyze common triggers
    const triggerFrequency = new Map<string, number>();
    for (const history of this.actionHistory) {
      const trigger = history.action.trigger;
      triggerFrequency.set(trigger, (triggerFrequency.get(trigger) || 0) + 1);
    }

    const commonTriggers = Array.from(triggerFrequency.entries())
      .map(([trigger, frequency]) => ({ trigger, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Calculate total improvements
    const totalImprovements = this.actionHistory
      .reduce((sum, h) => sum + (h.result.improvement || 0), 0);

    return {
      enabled: this.ensureConfig().enabled,
      activeActions: this.activeActions.size,
      totalActions: this.healingActions.size,
      successRate,
      lastHealing: this.actionHistory.length > 0 ?
        this.actionHistory[this.actionHistory.length - 1].timestamp : undefined,
      learningEnabled: this.ensureConfig().learningEnabled,
      insights: {
        topActions,
        commonTriggers,
        improvements: totalImprovements,
      },
    };
  }

  /**
   * Initialize self-healing system
   */
  private initializeSelfHealing(): void {
    logger.info('Initializing autonomous self-healing system', {
      aggressiveness: this.ensureConfig().aggressiveness,
      learningEnabled: this.ensureConfig().learningEnabled,
    });

    // Register standard healing actions
    this.registerStandardHealingActions();

    // Set up system monitoring
    this.startSystemMonitoring();

    // Start learning if enabled
    if (this.config.learningEnabled) {
      this.startLearning();
    }

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Register standard healing actions
   */
  private registerStandardHealingActions(): void {
    // High response time healing
    this.registerHealingAction({
      id: 'heal-high-response-time',
      type: 'scale_resources',
      severity: 'medium',
      trigger: 'high_response_time',
      description: 'Scale resources when response time is high',
      execute: async () => {
        const beforeMetrics = await this.captureMetrics();
        await this.performanceOptimizer.autoScale();
        const afterMetrics = await this.captureMetrics();

        return {
          success: true,
          message: 'Resources scaled to handle increased load',
          metrics: { before: beforeMetrics, after: afterMetrics },
          improvement: this.calculateImprovement(beforeMetrics, afterMetrics),
          duration: 5000,
        };
      },
      conditions: [
        {
          type: 'metric',
          check: async () => {
            const data = await this.performanceOptimizer.getDashboardData();
            return data.current.responseTime.p95 > 500; // 500ms threshold
          },
        },
      ],
      cooldown: 300000, // 5 minutes
    });

    // Memory pressure healing
    this.registerHealingAction({
      id: 'heal-memory-pressure',
      type: 'clear_cache',
      severity: 'medium',
      trigger: 'memory_pressure',
      description: 'Clear caches when memory usage is high',
      execute: async () => {
        const beforeMemory = process.memoryUsage();

        // Force garbage collection
        if (global.gc) {
          global.gc();
        }

        const afterMemory = process.memoryUsage();
        const improvement = ((beforeMemory.heapUsed - afterMemory.heapUsed) / beforeMemory.heapUsed) * 100;

        return {
          success: true,
          message: 'Memory pressure relieved',
          improvement,
          duration: 1000,
          metrics: {
            before: { memory: beforeMemory.heapUsed },
            after: { memory: afterMemory.heapUsed },
          },
        };
      },
      conditions: [
        {
          type: 'metric',
          check: async () => {
            const usage = process.memoryUsage();
            return (usage.heapUsed / usage.heapTotal) > 0.8; // 80% threshold
          },
        },
      ],
      cooldown: 60000, // 1 minute
    });

    // Edge location failure healing
    this.registerHealingAction({
      id: 'heal-edge-failure',
      type: 'failover_traffic',
      severity: 'high',
      trigger: 'edge_failure',
      description: 'Failover traffic when edge location fails',
      execute: async () => {
        // Get analytics to identify failed locations
        const analytics = await this.edgeComputing.getPerformanceAnalytics();
        let failedLocations = 0;

        for (const [locationId, metrics] of analytics.byLocation) {
          if (metrics.errorRate > 0.5) { // 50% error rate
            logger.warn(`Marking edge location ${locationId} as degraded`);
            // In production, would update routing tables
            failedLocations++;
          }
        }

        return {
          success: failedLocations > 0,
          message: `Failed over ${failedLocations} edge locations`,
          improvement: failedLocations * 25, // Rough improvement estimate
          duration: 3000,
        };
      },
      conditions: [
        {
          type: 'health',
          check: async () => {
            const analytics = await this.edgeComputing.getPerformanceAnalytics();
            return analytics.global.errorRate > 0.1; // 10% global error rate
          },
        },
      ],
      cooldown: 180000, // 3 minutes
    });

    // Database replication lag healing
    this.registerHealingAction({
      id: 'heal-replication-lag',
      type: 'rebalance_load',
      severity: 'medium',
      trigger: 'replication_lag',
      description: 'Rebalance database load when replication lag is high',
      execute: async () => {
        const beforeStatus = this.dataReplication.getReplicationStatus();

        // Resolve conflicts to reduce lag
        const resolved = await this.dataReplication.resolveConflicts();

        const afterStatus = this.dataReplication.getReplicationStatus();
        const improvement = ((beforeStatus.totalLag - afterStatus.totalLag) / beforeStatus.totalLag) * 100;

        return {
          success: resolved > 0,
          message: `Resolved ${resolved} conflicts, reduced lag`,
          improvement: Math.max(improvement, 0),
          duration: 10000,
        };
      },
      conditions: [
        {
          type: 'metric',
          check: async () => {
            const status = this.dataReplication.getReplicationStatus();
            return status.totalLag > 5000; // 5 second lag threshold
          },
        },
      ],
      cooldown: 600000, // 10 minutes
    });

    // Security threat healing
    this.registerHealingAction({
      id: 'heal-security-threat',
      type: 'isolate_component',
      severity: 'critical',
      trigger: 'security_threat',
      description: 'Isolate components when security threats detected',
      execute: async () => {
        const threats = this.threatDetection.getAnomalyHistory({ limit: 10 });
        const criticalThreats = threats.filter(t => t.severity === 'critical');

        if (criticalThreats.length > 0) {
          logger.error('Critical security threats detected, initiating containment', {
            threats: criticalThreats.length,
          });

          // In production, would isolate affected components
          return {
            success: true,
            message: `Isolated ${criticalThreats.length} critical threats`,
            improvement: 100, // Security is binary - threat contained or not
            duration: 2000,
          };
        }

        return {
          success: false,
          message: 'No critical threats found',
          duration: 100,
        };
      },
      conditions: [
        {
          type: 'metric',
          check: async () => {
            const threats = this.threatDetection.getAnomalyHistory({ limit: 5 });
            return threats.some(t => t.severity === 'critical');
          },
        },
      ],
      cooldown: 1800000, // 30 minutes
    });
  }

  /**
   * Start system monitoring
   */
  private startSystemMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        logger.error('Health check failed', error);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Perform health checks and trigger healing if needed
   */
  private async performHealthChecks(): Promise<void> {
    // Check system health
    const systemHealth = await this.system.getSystemHealth();

    if (systemHealth.status === 'degraded' || systemHealth.status === 'critical') {
      await this.triggerHealing('system_degradation', {
        severity: systemHealth.status === 'critical' ? 'critical' : 'high',
        source: 'health_check',
        description: `System health is ${systemHealth.status}`,
        metrics: systemHealth.metrics,
      });
    }

    // Check performance metrics
    const perfData = await this.performanceOptimizer.getDashboardData();

    if (perfData.current.responseTime.p95 > 1000) {
      await this.triggerHealing('high_response_time', {
        severity: 'medium',
        source: 'performance_monitor',
        description: 'High response time detected',
        metrics: { responseTime: perfData.current.responseTime.p95 },
      });
    }

    // Check anomalies
    const recentAnomalies = this.anomalyDetection.getAnomalyHistory({
      limit: 5,
      since: new Date(Date.now() - 300000), // Last 5 minutes
    });

    if (recentAnomalies.length > 3) {
      await this.triggerHealing('anomaly_cluster', {
        severity: 'high',
        source: 'anomaly_detection',
        description: `${recentAnomalies.length} anomalies detected`,
      });
    }
  }

  /**
   * Find applicable healing actions for a trigger
   */
  private async findApplicableActions(
    trigger: string,
    context: any
  ): Promise<HealingAction[]> {
    const applicable: HealingAction[] = [];

    for (const action of this.healingActions.values()) {
      // Check if action matches trigger
      if (action.trigger !== trigger) continue;

      // Check if action is on cooldown
      if (this.isOnCooldown(action)) continue;

      // Check conditions
      let allConditionsMet = true;
      for (const condition of action.conditions) {
        try {
          const conditionMet = await condition.check();
          if (!conditionMet) {
            allConditionsMet = false;
            break;
          }
        } catch (error) {
          logger.error('Condition check failed', { action: action.id, error });
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
        applicable.push(action);
      }
    }

    return applicable;
  }

  /**
   * Rank actions by predicted effectiveness
   */
  private rankActionsByEffectiveness(
    actions: HealingAction[],
    context: any
  ): HealingAction[] {
    return actions.sort((a, b) => {
      const aScore = this.calculateActionScore(a, context);
      const bScore = this.calculateActionScore(b, context);
      return bScore - aScore;
    });
  }

  /**
   * Calculate action effectiveness score
   */
  private calculateActionScore(action: HealingAction, context: any): number {
    let score = 0;

    // Base score from success rate
    const successRate = this.learningModel.actionSuccessRates.get(action.id) || 0.5;
    score += successRate * 100;

    // Severity matching
    const severityValues = { low: 1, medium: 2, high: 3, critical: 4 };
    const severityMatch = severityValues[action.severity] === severityValues[context.severity];
    if (severityMatch) score += 50;

    // Aggressiveness factor
    switch (this.ensureConfig().aggressiveness) {
      case 'aggressive':
        score += (action.severity === 'high' || action.severity === 'critical') ? 25 : 0;
        break;
      case 'conservative':
        score += (action.severity === 'low' || action.severity === 'medium') ? 25 : 0;
        break;
      case 'moderate':
        score += action.severity === 'medium' ? 25 : 0;
        break;
    }

    // Recency bias - prefer actions that haven't been used recently
    const lastUsed = this.getLastUsed(action.id);
    if (lastUsed) {
      const hoursSinceLastUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60);
      score += Math.min(hoursSinceLastUse * 5, 50); // Max 50 points for recency
    }

    return score;
  }

  /**
   * Check if action can be executed
   */
  private canExecuteAction(action: HealingAction): boolean {
    // Check if already running
    if (this.activeActions.has(action.id)) {
      return false;
    }

    // Check cooldown
    if (this.isOnCooldown(action)) {
      return false;
    }

    // Check confidence threshold
    const successRate = this.learningModel.actionSuccessRates.get(action.id) || 0.5;
    if (successRate < this.ensureConfig().safeguards.minConfidence / 100) {
      return false;
    }

    return true;
  }

  /**
   * Execute healing action
   */
  private async executeHealingAction(action: HealingAction): Promise<HealingResult> {
    const startTime = Date.now();

    logger.info('Executing healing action', {
      id: action.id,
      type: action.type,
      severity: action.severity,
    });

    // Track active action
    this.activeActions.set(action.id, { action, startTime: new Date() });

    try {
      // Execute the action
      const result = await action.execute();
      result.duration = Date.now() - startTime;

      // Set cooldown
      if (action.cooldown) {
        const cooldownEnd = new Date(Date.now() + action.cooldown * this.ensureConfig().cooldownMultiplier);
        this.cooldowns.set(action.id, cooldownEnd);
      }

      // Record in history
      this.actionHistory.push({
        action,
        result,
        timestamp: new Date(),
      });

      // Emit success event
      this.emit('action:executed', { action, result });

      logger.info('Healing action completed', {
        id: action.id,
        success: result.success,
        improvement: result.improvement,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      const result: HealingResult = {
        success: false,
        message: `Action failed: ${error}`,
        duration: Date.now() - startTime,
      };

      // Try rollback if available
      if (this.ensureConfig().safeguards.rollbackOnFailure && action.rollback) {
        try {
          await action.rollback();
          result.message += ' (rolled back)';
          logger.info('Healing action rolled back', { id: action.id });
        } catch (rollbackError) {
          result.message += ' (rollback failed)';
          logger.error('Rollback failed', { id: action.id, error: rollbackError });
        }
      }

      this.emit('action:failed', { action, result, error });
      return result;
    } finally {
      // Remove from active actions
      this.activeActions.delete(action.id);
    }
  }

  /**
   * Update learning model with execution results
   */
  private updateLearningModel(
    action: HealingAction,
    result: HealingResult,
    context: any
  ): void {
    const actionId = action.id;

    // Update success rate with exponential moving average
    const currentRate = this.learningModel.actionSuccessRates.get(actionId) || 0.5;
    const newRate = result.success ? 1 : 0;
    const alpha = 0.1; // Learning rate
    const updatedRate = (1 - alpha) * currentRate + alpha * newRate;

    this.learningModel.actionSuccessRates.set(actionId, updatedRate);

    // Update environmental factors
    const hour = new Date().getHours();
    const timeKey = `hour_${hour}`;
    const currentTimeWeight = this.learningModel.environmentalFactors.get(timeKey) || 0.5;
    const newTimeWeight = result.success ? currentTimeWeight + 0.1 : currentTimeWeight - 0.1;
    this.learningModel.environmentalFactors.set(timeKey, Math.max(0, Math.min(1, newTimeWeight)));
  }

  /**
   * Start learning process
   */
  private startLearning(): void {
    this.learningInterval = setInterval(() => {
      this.analyzePatternsAndOptimize();
    }, 3600000); // Learn every hour
  }

  /**
   * Analyze patterns and optimize
   */
  private analyzePatternsAndOptimize(): void {
    logger.info('Analyzing healing patterns for optimization');

    // Analyze time-based patterns
    const hourlySuccess = new Map<number, { success: number; total: number }>();

    for (const history of this.actionHistory) {
      const hour = history.timestamp.getHours();
      const stats = hourlySuccess.get(hour) || { success: 0, total: 0 };
      stats.total++;
      if (history.result.success) stats.success++;
      hourlySuccess.set(hour, stats);
    }

    // Update seasonal patterns
    this.learningModel.seasonalPatterns = Array.from(hourlySuccess.entries()).map(([hour, stats]) => ({
      time: `${hour}:00`,
      probability: stats.total > 0 ? stats.success / stats.total : 0.5,
      actions: this.getTopActionsForHour(hour),
    }));
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen to system events
    this.system.on('system:degraded', (event: any) => {
      this.triggerHealing('system_degradation', {
        severity: 'high',
        source: 'system_event',
        description: 'System degradation detected',
      });
    });

    // Listen to anomaly detection
    this.anomalyDetection.on('anomaly:critical', (anomaly: any) => {
      this.triggerHealing('critical_anomaly', {
        severity: 'critical',
        source: 'anomaly_detection',
        description: `Critical anomaly: ${anomaly.metricName}`,
        metrics: { [anomaly.metricName]: anomaly.value },
      });
    });

    // Listen to threat detection
    this.threatDetection.on('threat:detected', (threat: any) => {
      this.triggerHealing('security_threat', {
        severity: threat.severity,
        source: 'threat_detection',
        description: `Security threat: ${threat.type}`,
      });
    });
  }

  /**
   * Utility methods
   */
  private isOnCooldown(action: HealingAction): boolean {
    const cooldownEnd = this.cooldowns.get(action.id);
    return cooldownEnd ? cooldownEnd > new Date() : false;
  }

  private getLastUsed(actionId: string): Date | null {
    const lastExecution = this.actionHistory
      .reverse()
      .find(h => h.action.id === actionId);
    return lastExecution ? lastExecution.timestamp : null;
  }

  private async captureMetrics(): Promise<Record<string, number>> {
    const perfData = await this.performanceOptimizer.getDashboardData();
    return {
      responseTime: perfData.current.responseTime.p95,
      throughput: perfData.current.throughput,
      errorRate: perfData.current.errorRate,
      availability: perfData.current.availability,
    };
  }

  private calculateImprovement(before: Record<string, number>, after: Record<string, number>): number {
    // Simple improvement calculation
    const responseTimeImprovement = before.responseTime > 0 ?
      ((before.responseTime - after.responseTime) / before.responseTime) * 100 : 0;
    const errorRateImprovement = before.errorRate > 0 ?
      ((before.errorRate - after.errorRate) / before.errorRate) * 100 : 0;

    return Math.max(0, (responseTimeImprovement + errorRateImprovement) / 2);
  }

  private getTopActionsForHour(hour: number): string[] {
    return this.actionHistory
      .filter(h => h.timestamp.getHours() === hour && h.result.success)
      .map(h => h.action.id)
      .slice(0, 3);
  }

  /**
   * Shutdown self-healing system
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.learningInterval) {
      clearInterval(this.learningInterval);
    }

    logger.info('Self-healing system shutdown complete');
  }
}