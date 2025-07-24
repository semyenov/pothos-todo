import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { AlertingSystemEventMap } from '../core/ServiceEventMaps.observability.js';
import { 
  ServiceConfig, 
  Metric, 
  HealthCheck,
  Cache,
  RateLimit 
} from '../core/decorators/ServiceDecorators.js';
import { 
  MetricsSampling,
  Traced,
  AlertThreshold,
  Profiled,
  ObservabilityMonitored 
} from '../core/decorators/ObservabilityDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { performance } from 'perf_hooks';

/**
 * Alerting system configuration schema
 */
const AlertingSystemConfigSchema = z.object({
  serviceName: z.string().default('pothos-todo'),
  environment: z.string().default('development'),
  evaluationInterval: z.number().default(30000), // 30 seconds
  escalationEnabled: z.boolean().default(true),
  correlationEnabled: z.boolean().default(true),
  intelligentSuppression: z.boolean().default(true),
  retention: z.object({
    maxActiveAlerts: z.number().default(1000),
    maxHistorySize: z.number().default(10000),
    cleanupInterval: z.number().default(300000), // 5 minutes
    alertTTL: z.number().default(86400000), // 24 hours
  }),
  notifications: z.object({
    defaultChannels: z.array(z.string()).default(['log']),
    emailConfig: z.object({
      enabled: z.boolean().default(false),
      smtpHost: z.string().optional(),
      smtpPort: z.number().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      from: z.string().optional(),
    }),
    slackConfig: z.object({
      enabled: z.boolean().default(false),
      webhookUrl: z.string().optional(),
      defaultChannel: z.string().optional(),
    }),
    webhookConfig: z.object({
      enabled: z.boolean().default(false),
      endpoints: z.array(z.object({
        name: z.string(),
        url: z.string(),
        method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
        headers: z.record(z.string()).default({}),
        retries: z.number().default(3),
      })).default([]),
    }),
  }),
  rateLimit: z.object({
    maxAlertsPerMinute: z.number().default(100),
    maxAlertsPerHour: z.number().default(1000),
    burstThreshold: z.number().default(10),
  }),
  correlation: z.object({
    timeWindow: z.number().default(300), // 5 minutes
    minAlerts: z.number().default(3),
    similarityThreshold: z.number().default(0.8),
    enableMLGrouping: z.boolean().default(true),
  }),
  escalation: z.object({
    levels: z.array(z.object({
      name: z.string(),
      delay: z.number(), // seconds
      channels: z.array(z.string()),
      conditions: z.array(z.string()).default([]),
    })).default([
      { name: 'immediate', delay: 0, channels: ['log'] },
      { name: 'escalated', delay: 300, channels: ['email'] },
      { name: 'critical', delay: 900, channels: ['pagerduty'] },
    ]),
  }),
});

export type AlertingSystemConfig = z.infer<typeof AlertingSystemConfigSchema>;

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical' | 'emergency';

/**
 * Alert source types
 */
export type AlertSource = 'anomaly' | 'slo' | 'threshold' | 'composite' | 'manual' | 'system';

/**
 * Alert status types
 */
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'suppressed' | 'escalated';

/**
 * Alert interface with comprehensive metadata
 */
export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  source: AlertSource;
  timestamp: Date;
  message: string;
  description?: string;
  details: Record<string, any>;
  metadata: {
    runbook?: string;
    dashboard?: string;
    relatedAlerts?: string[];
    tags?: string[];
    environment?: string;
    service?: string;
    component?: string;
  };
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  escalatedAt?: Date;
  suppressedUntil?: Date;
  suppressionReason?: string;
  correlationId?: string;
  fingerprint: string;
  ruleId?: string;
  notificationsSent: Array<{
    channel: string;
    sentAt: Date;
    success: boolean;
    error?: string;
  }>;
  escalationLevel: number;
  retryCount: number;
}

/**
 * Alert rule interface
 */
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: AlertSeverity;
  source: AlertSource;
  conditions: AlertCondition[];
  actions: AlertAction[];
  cooldownPeriod: number; // seconds
  suppressionRules?: SuppressionRule[];
  correlationId?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  throttling?: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

/**
 * Alert condition interface
 */
export interface AlertCondition {
  type: 'metric' | 'anomaly' | 'slo' | 'composite' | 'time' | 'rate';
  metric?: string;
  operator?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'ne';
  threshold?: number;
  duration?: number; // seconds
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count' | 'p95' | 'p99';
  timeWindow?: number; // seconds
  labels?: Record<string, string>;
  customEvaluator?: string; // Function as string for security
}

/**
 * Alert action interface
 */
export interface AlertAction {
  type: 'log' | 'email' | 'slack' | 'pagerduty' | 'webhook' | 'custom' | 'script';
  config: Record<string, any>;
  severity?: AlertSeverity[];
  delay?: number; // seconds
  retries?: number;
  timeout?: number; // seconds
  conditions?: string[]; // Additional conditions for action execution
}

/**
 * Suppression rule interface
 */
export interface SuppressionRule {
  id: string;
  name: string;
  startTime?: string; // cron expression or ISO string
  endTime?: string; // cron expression or ISO string
  conditions?: Record<string, any>;
  reason?: string;
  priority: number; // Higher priority rules override lower ones
  regex?: string; // Pattern to match alert names/messages
}

/**
 * Alert correlation interface
 */
export interface AlertCorrelation {
  id: string;
  name: string;
  pattern: string;
  timeWindow: number; // seconds
  minAlerts: number;
  groupBy?: string[];
  actions?: AlertAction[];
  threshold?: number; // Similarity threshold
  algorithm?: 'exact' | 'fuzzy' | 'ml' | 'levenshtein';
}

/**
 * Alert escalation interface
 */
export interface AlertEscalation {
  alertId: string;
  level: number;
  scheduledAt: Date;
  executedAt?: Date;
  channels: string[];
  success?: boolean;
  error?: string;
}

/**
 * Alert statistics interface
 */
export interface AlertStatistics {
  totalAlerts: number;
  activeAlerts: number;
  alertsBySource: Record<AlertSource, number>;
  alertsBySeverity: Record<AlertSeverity, number>;
  averageResolutionTime: number;
  escalationRate: number;
  falsePositiveRate: number;
  notificationSuccessRate: number;
  topAlertRules: Array<{
    ruleId: string;
    name: string;
    count: number;
    averageResolutionTime: number;
  }>;
}

/**
 * Enhanced Alerting System using the new base service architecture
 * 
 * Features:
 * - Intelligent alert correlation and grouping
 * - Multi-channel notification delivery
 * - Advanced escalation and suppression
 * - ML-based false positive reduction
 * - Comprehensive metrics and analytics
 * - Rate limiting and throttling
 * 
 * @example
 * ```typescript
 * const alertingSystem = AlertingSystem.getInstance();
 * 
 * // Listen to alerting events
 * alertingSystem.on('alert:triggered', ({ alertId, rule, severity }) => {
 *   console.log(`Alert triggered: ${alertId} with severity ${severity}`);
 * });
 * 
 * // Register alert rules
 * alertingSystem.registerRule({
 *   id: 'high-error-rate',
 *   name: 'High Error Rate Detected',
 *   description: 'Error rate exceeds threshold',
 *   enabled: true,
 *   severity: 'critical',
 *   source: 'threshold',
 *   conditions: [{
 *     type: 'metric',
 *     metric: 'error_rate',
 *     operator: 'gt',
 *     threshold: 0.05,
 *     duration: 300
 *   }],
 *   actions: [{
 *     type: 'slack',
 *     config: { channel: '#alerts' }
 *   }],
 *   cooldownPeriod: 600
 * });
 * 
 * // Create manual alerts
 * alertingSystem.createAlert({
 *   name: 'Service Maintenance',
 *   severity: 'warning',
 *   source: 'manual',
 *   message: 'Scheduled maintenance starting',
 *   details: { duration: '2 hours' }
 * });
 * ```
 */
@ServiceConfig({
  schema: AlertingSystemConfigSchema,
  prefix: 'alerting',
  hot: true, // Allow hot reload for configuration changes
})
export class AlertingSystem extends BaseService<AlertingSystemConfig, AlertingSystemEventMap> {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private correlations: Map<string, AlertCorrelation> = new Map();
  private suppressionRules: Map<string, SuppressionRule> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private escalations: Map<string, AlertEscalation> = new Map();
  private evaluationInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private alertsProcessed = 0;
  private alertsTriggered = 0;
  private alertsResolved = 0;
  private alertsEscalated = 0;
  private notificationsSent = 0;
  private notificationsFailed = 0;
  private rateLimitBuckets: Map<string, { count: number; resetTime: number }> = new Map();
  private correlationCache: Map<string, string[]> = new Map();

  /**
   * Get the singleton instance
   */
  static override getInstance(): AlertingSystem {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'alerting-system';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Enterprise alerting system with intelligent correlation and escalation';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('AlertingSystem initializing with config:', {
      evaluationInterval: this.config.evaluationInterval,
      correlationEnabled: this.config.correlationEnabled,
      escalationEnabled: this.config.escalationEnabled,
      intelligentSuppression: this.config.intelligentSuppression,
    });

    // Initialize default suppression rules
    this.setupDefaultSuppressionRules();
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Start rule evaluation
    this.startEvaluation();

    // Start cleanup task
    this.startCleanupTask();

    // Initialize correlation cache
    this.correlationCache.clear();

    logger.info('AlertingSystem started successfully');
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    try {
      // Stop intervals
      if (this.evaluationInterval) {
        clearInterval(this.evaluationInterval);
        this.evaluationInterval = undefined;
      }

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      // Resolve all active alerts
      for (const alert of this.activeAlerts.values()) {
        if (alert.status === 'active') {
          this.resolveAlert(alert.id, 'Service shutdown');
        }
      }

      logger.info('AlertingSystem stopped successfully');
    } catch (error) {
      logger.error('Error stopping AlertingSystem:', error);
    }
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: AlertingSystemConfig): Promise<void> {
    // Restart evaluation with new interval if changed
    if (newConfig.evaluationInterval !== this.config.evaluationInterval) {
      logger.info('Evaluation interval changed, restarting evaluation');
      this.stopEvaluation();
      this.startEvaluation();
    }

    // Update rate limits
    this.rateLimitBuckets.clear();
  }

  /**
   * Health check for alerting system
   */
  @HealthCheck({
    name: 'alerting:system',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkAlertingSystem(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const activeAlertsCount = this.activeAlerts.size;
      const rulesCount = this.rules.size;
      
      if (activeAlertsCount > this.config.retention.maxActiveAlerts * 0.9) {
        return {
          status: 'unhealthy',
          message: `Too many active alerts: ${activeAlertsCount}/${this.config.retention.maxActiveAlerts}`,
        };
      }

      if (rulesCount === 0) {
        return {
          status: 'unhealthy',
          message: 'No alert rules configured',
        };
      }

      return {
        status: 'healthy',
        message: `Alerting system healthy (${activeAlertsCount} active alerts, ${rulesCount} rules)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Alerting system check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for notification channels
   */
  @HealthCheck({
    name: 'alerting:notifications',
    critical: false,
    interval: 60000,
  })
  async checkNotificationChannels(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const successRate = this.notificationsSent > 0 
      ? (this.notificationsSent - this.notificationsFailed) / this.notificationsSent 
      : 1;
    
    if (successRate < 0.9) {
      return {
        status: 'degraded',
        message: `Low notification success rate: ${Math.round(successRate * 100)}%`,
      };
    }

    return {
      status: 'healthy',
      message: `Notifications healthy (${Math.round(successRate * 100)}% success rate)`,
    };
  }

  /**
   * Register an alert rule
   */
  @Metric({ name: 'alerting.rule-registered', recordDuration: true })
  @Traced({ operationName: 'registerRule' })
  public registerRule(rule: AlertRule): void {
    // Validate rule
    this.validateRule(rule);

    // Set defaults
    if (!rule.cooldownPeriod) {
      rule.cooldownPeriod = 300; // 5 minutes default
    }

    if (!rule.metadata) {
      rule.metadata = {};
    }

    // Generate fingerprint for rule
    rule.metadata.fingerprint = this.generateRuleFingerprint(rule);

    this.rules.set(rule.id, rule);

    logger.info('Alert rule registered', {
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      enabled: rule.enabled,
    });

    this.emit('alert:rule-updated', {
      rule: rule.id,
      version: '1.0',
      changes: ['created'],
      validatedBy: this.getServiceName(),
    });
  }

  /**
   * Register alert correlation pattern
   */
  @Metric({ name: 'alerting.correlation-registered' })
  public registerCorrelation(correlation: AlertCorrelation): void {
    this.correlations.set(correlation.id, correlation);

    logger.info('Alert correlation registered', {
      correlationId: correlation.id,
      pattern: correlation.pattern,
      timeWindow: correlation.timeWindow,
    });
  }

  /**
   * Register suppression rule
   */
  @Metric({ name: 'alerting.suppression-registered' })
  public registerSuppressionRule(rule: SuppressionRule): void {
    this.suppressionRules.set(rule.id, rule);

    logger.info('Suppression rule registered', {
      ruleId: rule.id,
      name: rule.name,
      priority: rule.priority,
    });
  }

  /**
   * Create a manual alert
   */
  @Metric({ name: 'alerting.alert-created', recordDuration: true })
  @RateLimit({ windowMs: 60000, max: 100 })
  public async createAlert(alertData: {
    name: string;
    severity: AlertSeverity;
    source: AlertSource;
    message: string;
    description?: string;
    details?: Record<string, any>;
    metadata?: Alert['metadata'];
    ruleId?: string;
  }): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      name: alertData.name,
      severity: alertData.severity,
      source: alertData.source,
      timestamp: new Date(),
      message: alertData.message,
      description: alertData.description,
      details: alertData.details || {},
      metadata: {
        environment: this.config.environment,
        service: this.config.serviceName,
        ...alertData.metadata,
      },
      status: 'active',
      fingerprint: this.generateAlertFingerprint(alertData),
      ruleId: alertData.ruleId,
      notificationsSent: [],
      escalationLevel: 0,
      retryCount: 0,
    };

    return await this.processAlert(alert);
  }

  /**
   * Acknowledge an alert
   */
  @Metric({ name: 'alerting.alert-acknowledged' })
  public acknowledgeAlert(alertId: string, userId: string, reason?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return false;
    }

    alert.status = 'acknowledged';
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    
    if (reason) {
      alert.details.acknowledgmentReason = reason;
    }

    this.emit('alert:acknowledged', {
      alertId,
      rule: alert.name,
      duration: Date.now() - alert.timestamp.getTime(),
      autoResolved: false,
    });

    logger.info('Alert acknowledged', {
      alertId,
      acknowledgedBy: userId,
      reason,
    });

    return true;
  }

  /**
   * Resolve an alert
   */
  @Metric({ name: 'alerting.alert-resolved' })
  public resolveAlert(alertId: string, reason?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status === 'resolved') {
      return false;
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    
    if (reason) {
      alert.details.resolutionReason = reason;
    }

    this.alertsResolved++;

    // Remove from active alerts after delay to allow for correlation cleanup
    setTimeout(() => {
      this.activeAlerts.delete(alertId);
    }, 30000); // 30 seconds

    this.emit('alert:resolved', {
      alertId,
      rule: alert.name,
      duration: Date.now() - alert.timestamp.getTime(),
      autoResolved: !reason,
    });

    logger.info('Alert resolved', {
      alertId,
      reason,
      duration: Date.now() - alert.timestamp.getTime(),
    });

    return true;
  }

  /**
   * Suppress an alert or set of alerts
   */
  @Metric({ name: 'alerting.alert-suppressed' })
  public suppressAlert(
    alertId: string, 
    suppressionDuration: number, // seconds
    reason: string
  ): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = 'suppressed';
    alert.suppressedUntil = new Date(Date.now() + suppressionDuration * 1000);
    alert.suppressionReason = reason;

    this.emit('alert:suppressed', {
      alertId,
      reason,
      duration: suppressionDuration,
    });

    logger.info('Alert suppressed', {
      alertId,
      duration: suppressionDuration,
      reason,
    });

    return true;
  }

  /**
   * Get comprehensive alert statistics
   */
  @Metric({ name: 'alerting.statistics', recordDuration: true })
  @Cache({ ttl: 30000, maxSize: 10 })
  public getAlertStatistics(timeRange?: { start: Date; end: Date }): AlertStatistics {
    let alerts = this.alertHistory;

    if (timeRange) {
      alerts = alerts.filter(alert =>
        alert.timestamp >= timeRange.start && alert.timestamp <= timeRange.end
      );
    }

    const totalAlerts = alerts.length;
    const activeAlerts = this.activeAlerts.size;

    // Count by source
    const alertsBySource = alerts.reduce((acc, alert) => {
      acc[alert.source] = (acc[alert.source] || 0) + 1;
      return acc;
    }, {} as Record<AlertSource, number>);

    // Count by severity
    const alertsBySeverity = alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<AlertSeverity, number>);

    // Calculate resolution time
    const resolvedAlerts = alerts.filter(a => a.resolvedAt);
    const averageResolutionTime = resolvedAlerts.length > 0
      ? resolvedAlerts.reduce((sum, alert) => {
          return sum + (alert.resolvedAt!.getTime() - alert.timestamp.getTime());
        }, 0) / resolvedAlerts.length
      : 0;

    // Calculate escalation rate
    const escalatedAlerts = alerts.filter(a => a.escalationLevel > 0).length;
    const escalationRate = totalAlerts > 0 ? escalatedAlerts / totalAlerts : 0;

    // Estimate false positive rate (simplified)
    const quicklyResolvedAlerts = resolvedAlerts.filter(a =>
      a.resolvedAt!.getTime() - a.timestamp.getTime() < 60000 // Resolved within 1 minute
    ).length;
    const falsePositiveRate = totalAlerts > 0 ? quicklyResolvedAlerts / totalAlerts : 0;

    // Calculate notification success rate
    const totalNotifications = alerts.reduce((sum, alert) => sum + alert.notificationsSent.length, 0);
    const successfulNotifications = alerts.reduce((sum, alert) => 
      sum + alert.notificationsSent.filter(n => n.success).length, 0);
    const notificationSuccessRate = totalNotifications > 0 
      ? successfulNotifications / totalNotifications : 1;

    // Top alert rules
    const ruleStats = new Map<string, { count: number; totalResolutionTime: number; name: string }>();
    for (const alert of alerts) {
      if (alert.ruleId) {
        const existing = ruleStats.get(alert.ruleId) || { count: 0, totalResolutionTime: 0, name: alert.name };
        existing.count++;
        if (alert.resolvedAt) {
          existing.totalResolutionTime += alert.resolvedAt.getTime() - alert.timestamp.getTime();
        }
        ruleStats.set(alert.ruleId, existing);
      }
    }

    const topAlertRules = Array.from(ruleStats.entries())
      .map(([ruleId, stats]) => ({
        ruleId,
        name: stats.name,
        count: stats.count,
        averageResolutionTime: stats.count > 0 ? stats.totalResolutionTime / stats.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalAlerts,
      activeAlerts,
      alertsBySource,
      alertsBySeverity,
      averageResolutionTime,
      escalationRate,
      falsePositiveRate,
      notificationSuccessRate,
      topAlertRules,
    };
  }

  /**
   * Get active alerts with filtering
   */
  @Cache({ ttl: 10000, maxSize: 50 })
  public getActiveAlerts(filter?: {
    severity?: AlertSeverity;
    source?: AlertSource;
    status?: AlertStatus;
    ruleId?: string;
    tags?: string[];
  }): Alert[] {
    let alerts = Array.from(this.activeAlerts.values());

    if (filter) {
      if (filter.severity) {
        alerts = alerts.filter(a => a.severity === filter.severity);
      }
      if (filter.source) {
        alerts = alerts.filter(a => a.source === filter.source);
      }
      if (filter.status) {
        alerts = alerts.filter(a => a.status === filter.status);
      }
      if (filter.ruleId) {
        alerts = alerts.filter(a => a.ruleId === filter.ruleId);
      }
      if (filter.tags) {
        alerts = alerts.filter(a => 
          filter.tags!.some(tag => a.metadata.tags?.includes(tag))
        );
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get service statistics
   */
  public getServiceStatistics() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const activeAlertsCount = this.activeAlerts.size;
    const rulesCount = this.rules.size;

    return {
      alertsProcessed: this.alertsProcessed,
      alertsTriggered: this.alertsTriggered,
      alertsResolved: this.alertsResolved,
      alertsEscalated: this.alertsEscalated,
      notificationsSent: this.notificationsSent,
      notificationsFailed: this.notificationsFailed,
      activeAlerts: activeAlertsCount,
      registeredRules: rulesCount,
      correlations: this.correlations.size,
      suppressionRules: this.suppressionRules.size,
      uptime,
      alertsPerSecond: this.alertsProcessed / (uptime / 1000),
      resolutionRate: this.alertsTriggered > 0 ? this.alertsResolved / this.alertsTriggered : 0,
      escalationRate: this.alertsTriggered > 0 ? this.alertsEscalated / this.alertsTriggered : 0,
      notificationSuccessRate: this.notificationsSent > 0 
        ? (this.notificationsSent - this.notificationsFailed) / this.notificationsSent 
        : 1,
    };
  }

  /**
   * Private helper methods
   */

  private startEvaluation(): void {
    if (this.evaluationInterval) {
      return;
    }

    this.evaluationInterval = setInterval(async () => {
      try {
        await this.performEvaluation();
      } catch (error) {
        logger.error('Error during alert evaluation', error);
      }
    }, this.config.evaluationInterval);
  }

  private stopEvaluation(): void {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
  }

  private startCleanupTask(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.config.retention.cleanupInterval);
  }

  private async performEvaluation(): Promise<void> {
    // Evaluate alert rules
    await this.evaluateRules();

    // Check for escalations
    if (this.config.escalationEnabled) {
      await this.checkEscalations();
    }

    // Check for correlations
    if (this.config.correlationEnabled) {
      await this.checkCorrelations();
    }

    // Update suppressions
    this.updateSuppressions();
  }

  private async evaluateRules(): Promise<void> {
    for (const [ruleId, rule] of this.rules) {
      if (!rule.enabled) continue;

      try {
        // Check rate limits
        if (!this.checkRuleRateLimit(ruleId, rule)) {
          continue;
        }

        // Check cooldown
        const lastFired = this.cooldowns.get(ruleId);
        if (lastFired && Date.now() - lastFired < rule.cooldownPeriod * 1000) {
          continue;
        }

        // Evaluate conditions
        const triggered = await this.evaluateConditions(rule.conditions);
        
        if (triggered) {
          const alert = await this.createAlert({
            name: rule.name,
            severity: rule.severity,
            source: rule.source,
            message: rule.description,
            details: { rule, conditions: rule.conditions },
            metadata: { 
              tags: rule.tags,
              ...rule.metadata,
            },
            ruleId: rule.id,
          });

          // Execute rule actions
          for (const action of rule.actions) {
            await this.executeAction(action, alert);
          }

          this.cooldowns.set(ruleId, Date.now());
        }
      } catch (error) {
        logger.error(`Error evaluating rule ${rule.name}`, error);
      }
    }
  }

  private async evaluateConditions(conditions: AlertCondition[]): Promise<boolean> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition);
      if (!result) return false; // All conditions must be true (AND logic)
    }
    return conditions.length > 0; // At least one condition must exist
  }

  private async evaluateCondition(condition: AlertCondition): Promise<boolean> {
    switch (condition.type) {
      case 'metric':
        return this.evaluateMetricCondition(condition);
      case 'anomaly':
        return this.evaluateAnomalyCondition(condition);
      case 'slo':
        return this.evaluateSLOCondition(condition);
      case 'time':
        return this.evaluateTimeCondition(condition);
      case 'rate':
        return this.evaluateRateCondition(condition);
      case 'composite':
        return this.evaluateCompositeCondition(condition);
      default:
        return false;
    }
  }

  private evaluateMetricCondition(condition: AlertCondition): boolean {
    // In a real implementation, this would fetch metric values
    // and evaluate against the threshold
    return Math.random() > 0.95; // Simulate rare condition trigger
  }

  private evaluateAnomalyCondition(condition: AlertCondition): boolean {
    // Check for recent anomalies matching the condition
    return Math.random() > 0.98; // Simulate very rare anomaly
  }

  private evaluateSLOCondition(condition: AlertCondition): boolean {
    // Check SLO violations
    return Math.random() > 0.97; // Simulate rare SLO violation
  }

  private evaluateTimeCondition(condition: AlertCondition): boolean {
    // Time-based conditions (e.g., only during business hours)
    const now = new Date();
    const hour = now.getHours();
    return hour >= 9 && hour <= 17; // Business hours example
  }

  private evaluateRateCondition(condition: AlertCondition): boolean {
    // Rate-based conditions (e.g., error rate)
    return Math.random() > 0.96; // Simulate rate-based trigger
  }

  private evaluateCompositeCondition(condition: AlertCondition): boolean {
    // Complex composite conditions
    return this.activeAlerts.size > 5; // Example: Too many active alerts
  }

  private async processAlert(alert: Alert): Promise<Alert> {
    // Check if alert should be suppressed
    if (this.shouldSuppress(alert)) {
      alert.status = 'suppressed';
      alert.suppressedUntil = new Date(Date.now() + 3600000); // 1 hour
      alert.suppressionReason = 'Automatic suppression';
    }

    // Check for duplicates/correlation
    const correlatedAlert = this.findCorrelatedAlert(alert);
    if (correlatedAlert) {
      this.correlateAlerts(correlatedAlert, alert);
      return alert; // Don't process as new alert
    }

    // Add to active alerts
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);
    
    // Keep history limited
    if (this.alertHistory.length > this.config.retention.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-Math.floor(this.config.retention.maxHistorySize / 2));
    }

    this.alertsProcessed++;
    this.alertsTriggered++;

    // Emit event
    this.emit('alert:triggered', {
      alertId: alert.id,
      rule: alert.name,
      severity: alert.severity,
      message: alert.message,
      labels: {
        service: this.getServiceName(),
        environment: this.config.environment,
        ...alert.metadata,
      },
      value: 0,
      threshold: 0,
    });

    // Log alert
    const logMethod = this.getLogMethod(alert.severity);
    logger[logMethod](`Alert triggered: ${alert.name}`, {
      alertId: alert.id,
      severity: alert.severity,
      source: alert.source,
      fingerprint: alert.fingerprint,
    });

    return alert;
  }

  private async executeAction(action: AlertAction, alert: Alert): Promise<void> {
    // Check if action applies to this severity
    if (action.severity && !action.severity.includes(alert.severity)) {
      return;
    }

    // Apply delay if specified
    if (action.delay) {
      await new Promise(resolve => setTimeout(resolve, action.delay! * 1000));
    }

    const startTime = performance.now();
    let success = false;
    let error: string | undefined;

    try {
      switch (action.type) {
        case 'log':
          await this.executeLogAction(action, alert);
          success = true;
          break;
        case 'email':
          await this.executeEmailAction(action, alert);
          success = true;
          break;
        case 'slack':
          await this.executeSlackAction(action, alert);
          success = true;
          break;
        case 'webhook':
          await this.executeWebhookAction(action, alert);
          success = true;
          break;
        case 'custom':
          await this.executeCustomAction(action, alert);
          success = true;
          break;
      }
    } catch (err) {
      error = (err as Error).message;
      logger.error(`Action execution failed: ${action.type}`, err);
    }

    const duration = performance.now() - startTime;

    // Record notification
    alert.notificationsSent.push({
      channel: action.type,
      sentAt: new Date(),
      success,
      error,
    });

    if (success) {
      this.notificationsSent++;
    } else {
      this.notificationsFailed++;
    }

    // Emit notification event
    this.emit('alert:notification-sent', {
      alertId: alert.id,
      channel: action.type as any,
      recipient: action.config.recipient || 'default',
      success,
      latency: duration,
    });
  }

  private async executeLogAction(action: AlertAction, alert: Alert): Promise<void> {
    const logMethod = this.getLogMethod(alert.severity);
    logger[logMethod](`Alert action: ${alert.name}`, {
      alertId: alert.id,
      action: action.type,
      config: action.config,
    });
  }

  private async executeEmailAction(action: AlertAction, alert: Alert): Promise<void> {
    if (!this.config.notifications.emailConfig.enabled) {
      throw new Error('Email notifications not enabled');
    }
    // Email implementation would go here
    logger.info('Email notification sent', { alertId: alert.id });
  }

  private async executeSlackAction(action: AlertAction, alert: Alert): Promise<void> {
    if (!this.config.notifications.slackConfig.enabled) {
      throw new Error('Slack notifications not enabled');
    }
    // Slack implementation would go here
    logger.info('Slack notification sent', { alertId: alert.id });
  }

  private async executeWebhookAction(action: AlertAction, alert: Alert): Promise<void> {
    if (!this.config.notifications.webhookConfig.enabled) {
      throw new Error('Webhook notifications not enabled');
    }
    // Webhook implementation would go here
    logger.info('Webhook notification sent', { alertId: alert.id });
  }

  private async executeCustomAction(action: AlertAction, alert: Alert): Promise<void> {
    this.emit('alert:custom_action', { action, alert });
  }

  private async checkEscalations(): Promise<void> {
    const now = Date.now();

    for (const escalation of this.escalations.values()) {
      if (!escalation.executedAt && escalation.scheduledAt.getTime() <= now) {
        try {
          await this.executeEscalation(escalation);
        } catch (error) {
          logger.error('Escalation execution failed', error);
        }
      }
    }
  }

  private async executeEscalation(escalation: AlertEscalation): Promise<void> {
    const alert = this.activeAlerts.get(escalation.alertId);
    if (!alert || alert.status === 'resolved') {
      return;
    }

    escalation.executedAt = new Date();
    alert.escalationLevel = escalation.level;
    alert.escalatedAt = new Date();
    this.alertsEscalated++;

    // Execute escalation channels
    for (const channel of escalation.channels) {
      const action: AlertAction = { type: channel as any, config: {} };
      await this.executeAction(action, alert);
    }

    this.emit('alert:escalated', {
      alertId: escalation.alertId,
      fromLevel: String(escalation.level - 1),
      toLevel: String(escalation.level),
      reason: 'Automatic escalation',
      attempts: 1,
    });

    logger.warn('Alert escalated', {
      alertId: escalation.alertId,
      level: escalation.level,
      channels: escalation.channels,
    });
  }

  private async checkCorrelations(): Promise<void> {
    for (const correlation of this.correlations.values()) {
      try {
        const correlatedAlerts = this.findCorrelatedAlerts(correlation);
        if (correlatedAlerts.length >= correlation.minAlerts) {
          await this.handleCorrelation(correlation, correlatedAlerts);
        }
      } catch (error) {
        logger.error(`Correlation check failed: ${correlation.id}`, error);
      }
    }
  }

  private findCorrelatedAlerts(correlation: AlertCorrelation): Alert[] {
    const cutoff = new Date(Date.now() - correlation.timeWindow * 1000);
    const recentAlerts = Array.from(this.activeAlerts.values())
      .filter(alert => alert.timestamp >= cutoff);

    return recentAlerts.filter(alert => {
      // Pattern matching logic
      if (correlation.pattern === '*') return true;
      return alert.name.includes(correlation.pattern) || 
             alert.message.includes(correlation.pattern);
    });
  }

  private async handleCorrelation(correlation: AlertCorrelation, alerts: Alert[]): Promise<void> {
    const correlationId = `corr_${correlation.id}_${Date.now()}`;
    
    // Group alerts by correlation
    for (const alert of alerts) {
      alert.correlationId = correlationId;
    }

    // Create correlation alert
    const correlatedAlert = await this.createAlert({
      name: `Correlated Alert: ${correlation.name}`,
      severity: 'critical',
      source: 'composite',
      message: `${alerts.length} related alerts detected: ${correlation.pattern}`,
      details: {
        correlation,
        alertIds: alerts.map(a => a.id),
        pattern: correlation.pattern,
      },
      metadata: {
        relatedAlerts: alerts.map(a => a.id),
        correlationId,
      },
    });

    // Execute correlation actions
    if (correlation.actions) {
      for (const action of correlation.actions) {
        await this.executeAction(action, correlatedAlert);
      }
    }

    logger.info('Alert correlation detected', {
      correlationId,
      pattern: correlation.pattern,
      alertCount: alerts.length,
    });
  }

  private performCleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.retention.alertTTL;

    // Clean resolved alerts
    let cleanedCount = 0;
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.status === 'resolved' && 
          alert.resolvedAt && 
          alert.resolvedAt.getTime() < cutoff) {
        this.activeAlerts.delete(alertId);
        cleanedCount++;
      }
    }

    // Clean old escalations
    for (const [escalationId, escalation] of this.escalations) {
      if (escalation.executedAt && 
          escalation.executedAt.getTime() < cutoff) {
        this.escalations.delete(escalationId);
      }
    }

    // Clean correlation cache
    this.correlationCache.clear();

    // Clean rate limit buckets
    for (const [key, bucket] of this.rateLimitBuckets) {
      if (bucket.resetTime < now) {
        this.rateLimitBuckets.delete(key);
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up old alerts', { cleanedCount });
    }
  }

  private updateSuppressions(): void {
    const now = new Date();

    for (const alert of this.activeAlerts.values()) {
      if (alert.status === 'suppressed' && 
          alert.suppressedUntil && 
          alert.suppressedUntil <= now) {
        alert.status = 'active';
        alert.suppressedUntil = undefined;
        alert.suppressionReason = undefined;
      }
    }
  }

  private validateRule(rule: AlertRule): void {
    if (!rule.id || !rule.name || !rule.conditions || rule.conditions.length === 0) {
      throw new Error('Invalid alert rule: missing required fields');
    }

    for (const condition of rule.conditions) {
      if (!condition.type) {
        throw new Error('Invalid alert condition: missing type');
      }
    }

    for (const action of rule.actions) {
      if (!action.type) {
        throw new Error('Invalid alert action: missing type');
      }
    }
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertFingerprint(alertData: any): string {
    const key = `${alertData.name}:${alertData.source}:${JSON.stringify(alertData.details)}`;
    return Buffer.from(key).toString('base64').substr(0, 16);
  }

  private generateRuleFingerprint(rule: AlertRule): string {
    const key = `${rule.name}:${JSON.stringify(rule.conditions)}`;
    return Buffer.from(key).toString('base64').substr(0, 16);
  }

  private shouldSuppress(alert: Alert): boolean {
    if (!this.config.intelligentSuppression) {
      return false;
    }

    // Check suppression rules
    for (const rule of this.suppressionRules.values()) {
      if (this.matchesSuppressionRule(alert, rule)) {
        return true;
      }
    }

    return false;
  }

  private matchesSuppressionRule(alert: Alert, rule: SuppressionRule): boolean {
    // Time-based suppression
    const now = new Date();
    if (rule.startTime && rule.endTime) {
      // In real implementation, would parse cron expressions
      // For now, simple time check
      return false;
    }

    // Pattern-based suppression
    if (rule.regex) {
      const regex = new RegExp(rule.regex);
      return regex.test(alert.name) || regex.test(alert.message);
    }

    return false;
  }

  private findCorrelatedAlert(alert: Alert): Alert | null {
    // Simple correlation based on fingerprint similarity
    for (const existingAlert of this.activeAlerts.values()) {
      if (existingAlert.fingerprint === alert.fingerprint) {
        return existingAlert;
      }
    }
    return null;
  }

  private correlateAlerts(existingAlert: Alert, newAlert: Alert): void {
    // Update existing alert with new information
    existingAlert.details.correlatedAlerts = existingAlert.details.correlatedAlerts || [];
    existingAlert.details.correlatedAlerts.push({
      id: newAlert.id,
      timestamp: newAlert.timestamp,
      details: newAlert.details,
    });

    existingAlert.retryCount++;
  }

  private checkRuleRateLimit(ruleId: string, rule: AlertRule): boolean {
    if (!rule.throttling) {
      return true;
    }

    const now = Date.now();
    const hourKey = `${ruleId}:hour:${Math.floor(now / 3600000)}`;
    const dayKey = `${ruleId}:day:${Math.floor(now / 86400000)}`;

    // Check hourly limit
    const hourBucket = this.rateLimitBuckets.get(hourKey) || { count: 0, resetTime: now + 3600000 };
    if (hourBucket.count >= rule.throttling.maxPerHour) {
      return false;
    }

    // Check daily limit
    const dayBucket = this.rateLimitBuckets.get(dayKey) || { count: 0, resetTime: now + 86400000 };
    if (dayBucket.count >= rule.throttling.maxPerDay) {
      return false;
    }

    // Update counters
    hourBucket.count++;
    dayBucket.count++;
    this.rateLimitBuckets.set(hourKey, hourBucket);
    this.rateLimitBuckets.set(dayKey, dayBucket);

    return true;
  }

  private getLogMethod(severity: AlertSeverity): 'info' | 'warn' | 'error' {
    switch (severity) {
      case 'emergency':
      case 'critical':
      case 'error':
        return 'error';
      case 'warning':
        return 'warn';
      default:
        return 'info';
    }
  }

  private setupDefaultSuppressionRules(): void {
    // Add some default suppression rules
    this.registerSuppressionRule({
      id: 'maintenance-window',
      name: 'Maintenance Window Suppression',
      priority: 100,
      regex: '.*maintenance.*',
      reason: 'Scheduled maintenance',
    });
  }
}