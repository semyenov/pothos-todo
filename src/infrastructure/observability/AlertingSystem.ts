import { EventEmitter } from 'events';
import { logger } from '@/logger.js';
import { AnomalyDetectionSystem, type Anomaly } from './AnomalyDetection.js';
import { SLOMonitoringSystem, type SLOStatus } from './SLOMonitoring.js';
import { MetricsSystem } from './Metrics.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface Alert {
  id: string;
  name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: 'anomaly' | 'slo' | 'threshold' | 'composite';
  timestamp: Date;
  message: string;
  details: Record<string, any>;
  metadata?: {
    runbook?: string;
    dashboard?: string;
    relatedAlerts?: string[];
  };
  status: 'active' | 'acknowledged' | 'resolved' | 'suppressed';
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: AlertCondition[];
  actions: AlertAction[];
  cooldownPeriod?: number; // seconds
  suppressionRules?: SuppressionRule[];
  correlationId?: string;
}

export interface AlertCondition {
  type: 'metric' | 'anomaly' | 'slo' | 'composite';
  metric?: string;
  operator?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold?: number;
  duration?: number; // seconds
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
  customEvaluator?: (context: any) => boolean;
}

export interface AlertAction {
  type: 'log' | 'email' | 'slack' | 'pagerduty' | 'webhook' | 'custom';
  config: Record<string, any>;
  severity?: string[];
  delay?: number; // seconds
}

export interface SuppressionRule {
  startTime?: string; // cron expression
  endTime?: string;
  conditions?: Record<string, any>;
  reason?: string;
}

export interface AlertCorrelation {
  id: string;
  pattern: string;
  timeWindow: number; // seconds
  minAlerts: number;
  groupBy?: string[];
  actions?: AlertAction[];
}

/**
 * Intelligent Alerting System with ML-based correlation
 */
export class AlertingSystem extends EventEmitterSingletonService<AlertingSystem> {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private correlations: Map<string, AlertCorrelation> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private evaluationInterval?: NodeJS.Timeout;
  
  private anomalySystem: AnomalyDetectionSystem;
  private sloSystem: SLOMonitoringSystem;
  private metricsSystem: MetricsSystem;

  protected constructor() {
    super();
    this.anomalySystem = AnomalyDetectionSystem.getInstance();
    this.sloSystem = SLOMonitoringSystem.getInstance();
    this.metricsSystem = MetricsSystem.getInstance();
    
    this.setupEventListeners();
  }

  static getInstance(): AlertingSystem {
    return super.getInstance();
  }

  /**
   * Setup listeners for various event sources
   */
  private setupEventListeners(): void {
    // Listen for anomalies
    this.anomalySystem.on('anomaly', (anomaly: Anomaly) => {
      this.handleAnomaly(anomaly);
    });

    // Listen for SLO violations
    this.sloSystem.on('slo:violated', ({ slo, status }: any) => {
      this.handleSLOViolation(slo, status);
    });

    // Listen for SLO predictions
    this.sloSystem.on('slo:prediction', ({ slo, prediction }: any) => {
      this.handleSLOPrediction(slo, prediction);
    });
  }

  /**
   * Register an alert rule
   */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.info(`Registered alert rule: ${rule.name}`);
  }

  /**
   * Register an alert correlation pattern
   */
  registerCorrelation(correlation: AlertCorrelation): void {
    this.correlations.set(correlation.id, correlation);
    logger.info(`Registered alert correlation: ${correlation.id}`);
  }

  /**
   * Start alert evaluation
   */
  start(intervalMs: number = 30000): void {
    if (this.evaluationInterval) {
      return;
    }

    this.evaluationInterval = setInterval(() => {
      this.evaluateRules();
      this.checkCorrelations();
      this.cleanupOldAlerts();
    }, intervalMs);

    logger.info('Alerting system started');
  }

  /**
   * Stop alert evaluation
   */
  stop(): void {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
    logger.info('Alerting system stopped');
  }

  /**
   * Handle anomaly detection
   */
  private handleAnomaly(anomaly: Anomaly): void {
    const alert: Alert = {
      id: `anomaly_${anomaly.id}`,
      name: `Anomaly detected in ${anomaly.metric}`,
      severity: anomaly.severity as Alert['severity'],
      source: 'anomaly',
      timestamp: anomaly.timestamp,
      message: `Anomaly detected: ${anomaly.metric} value ${anomaly.value} outside expected range`,
      details: {
        anomaly,
        metric: anomaly.metric,
        value: anomaly.value,
        expectedRange: anomaly.expectedRange,
        confidence: anomaly.confidence,
      },
      metadata: {
        runbook: this.getRunbookUrl('anomaly', anomaly.metric),
        dashboard: this.getDashboardUrl('anomaly', anomaly.metric),
      },
      status: 'active',
    };

    this.triggerAlert(alert);
  }

  /**
   * Handle SLO violation
   */
  private handleSLOViolation(slo: any, status: SLOStatus): void {
    const alert: Alert = {
      id: `slo_${slo.id}_${Date.now()}`,
      name: `SLO Violation: ${slo.name}`,
      severity: 'critical',
      source: 'slo',
      timestamp: new Date(),
      message: `SLO ${slo.name} violated: ${status.currentValue.toFixed(2)}% < ${slo.target}%`,
      details: {
        slo,
        status,
        errorBudgetRemaining: status.errorBudgetRemaining,
        burnRate: status.burnRate,
      },
      metadata: {
        runbook: this.getRunbookUrl('slo', slo.id),
        dashboard: this.getDashboardUrl('slo', slo.id),
      },
      status: 'active',
    };

    this.triggerAlert(alert);
  }

  /**
   * Handle SLO prediction
   */
  private handleSLOPrediction(slo: any, prediction: any): void {
    if (!prediction.willViolate) return;

    const alert: Alert = {
      id: `slo_predict_${slo.id}_${Date.now()}`,
      name: `SLO Prediction: ${slo.name} will violate`,
      severity: 'warning',
      source: 'slo',
      timestamp: new Date(),
      message: `SLO ${slo.name} predicted to violate in ${Math.round((prediction.timeToViolation || 0) / 3600)} hours`,
      details: {
        slo,
        prediction,
      },
      metadata: {
        runbook: this.getRunbookUrl('slo_prediction', slo.id),
      },
      status: 'active',
    };

    this.triggerAlert(alert);
  }

  /**
   * Evaluate all alert rules
   */
  private async evaluateRules(): Promise<void> {
    for (const [ruleId, rule] of this.rules) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastFired = this.cooldowns.get(ruleId);
      if (lastFired && Date.now() - lastFired < (rule.cooldownPeriod || 0) * 1000) {
        continue;
      }

      // Check suppression rules
      if (this.isSuppressed(rule)) {
        continue;
      }

      // Evaluate conditions
      const triggered = await this.evaluateConditions(rule.conditions);
      
      if (triggered) {
        const alert: Alert = {
          id: `rule_${ruleId}_${Date.now()}`,
          name: rule.name,
          severity: 'warning',
          source: 'threshold',
          timestamp: new Date(),
          message: rule.description,
          details: {
            rule,
            conditions: rule.conditions,
          },
          status: 'active',
        };

        this.triggerAlert(alert, rule);
        this.cooldowns.set(ruleId, Date.now());
      }
    }
  }

  /**
   * Evaluate alert conditions
   */
  private async evaluateConditions(conditions: AlertCondition[]): Promise<boolean> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition);
      if (!result) return false; // All conditions must be true
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(condition: AlertCondition): Promise<boolean> {
    switch (condition.type) {
      case 'metric':
        return this.evaluateMetricCondition(condition);
      
      case 'anomaly':
        return this.evaluateAnomalyCondition(condition);
      
      case 'slo':
        return this.evaluateSLOCondition(condition);
      
      case 'composite':
        return condition.customEvaluator ? condition.customEvaluator({
          alerts: this.activeAlerts,
          metrics: this.metricsSystem,
        }) : false;
      
      default:
        return false;
    }
  }

  /**
   * Evaluate metric-based condition
   */
  private evaluateMetricCondition(condition: AlertCondition): boolean {
    // Implementation would fetch metric value and compare
    // This is a simplified version
    return false;
  }

  /**
   * Evaluate anomaly-based condition
   */
  private evaluateAnomalyCondition(condition: AlertCondition): boolean {
    const recentAnomalies = this.anomalySystem.getAnomalyHistory({
      metric: condition.metric,
      since: new Date(Date.now() - (condition.duration || 300) * 1000),
    });
    
    return recentAnomalies.length > 0;
  }

  /**
   * Evaluate SLO-based condition
   */
  private async evaluateSLOCondition(condition: AlertCondition): Promise<boolean> {
    const statuses = await this.sloSystem.getAllSLOStatuses();
    const relevantStatus = statuses.find(s => s.sloId === condition.metric);
    
    if (!relevantStatus) return false;
    
    switch (condition.operator) {
      case 'lt':
        return relevantStatus.currentValue < (condition.threshold || 0);
      case 'gt':
        return relevantStatus.currentValue > (condition.threshold || 0);
      default:
        return false;
    }
  }

  /**
   * Check if rule is suppressed
   */
  private isSuppressed(rule: AlertRule): boolean {
    if (!rule.suppressionRules) return false;
    
    const now = new Date();
    // Implementation would check cron expressions and conditions
    return false;
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(alert: Alert, rule?: AlertRule): Promise<void> {
    // Add to active alerts
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);
    
    // Keep history limited
    if (this.alertHistory.length > 10000) {
      this.alertHistory = this.alertHistory.slice(-5000);
    }

    // Emit event
    this.emit('alert:triggered', alert);
    
    // Execute actions
    const actions = rule?.actions || this.getDefaultActions(alert.severity);
    for (const action of actions) {
      await this.executeAction(action, alert);
    }

    // Log alert
    const logMethod = alert.severity === 'critical' ? 'error' : 
                     alert.severity === 'error' ? 'error' :
                     alert.severity === 'warning' ? 'warn' : 'info';
    
    logger[logMethod](`Alert triggered: ${alert.name}`, {
      alertId: alert.id,
      severity: alert.severity,
      details: alert.details,
    });
  }

  /**
   * Execute alert action
   */
  private async executeAction(action: AlertAction, alert: Alert): Promise<void> {
    // Check if action applies to this severity
    if (action.severity && !action.severity.includes(alert.severity)) {
      return;
    }

    // Apply delay if specified
    if (action.delay) {
      await new Promise(resolve => setTimeout(resolve, action.delay! * 1000));
    }

    switch (action.type) {
      case 'log':
        logger.info(`Alert action: ${alert.name}`, alert);
        break;
        
      case 'webhook':
        // Implementation would send webhook
        break;
        
      case 'email':
        // Implementation would send email
        break;
        
      case 'slack':
        // Implementation would send Slack message
        break;
        
      case 'pagerduty':
        // Implementation would create PagerDuty incident
        break;
        
      case 'custom':
        this.emit('alert:custom_action', { action, alert });
        break;
    }
  }

  /**
   * Check for alert correlations
   */
  private checkCorrelations(): void {
    for (const correlation of this.correlations.values()) {
      const relevantAlerts = this.getRecentAlerts(correlation.timeWindow);
      
      if (relevantAlerts.length >= correlation.minAlerts) {
        // Check if alerts match the pattern
        const matches = this.matchCorrelationPattern(relevantAlerts, correlation);
        
        if (matches.length >= correlation.minAlerts) {
          this.handleCorrelation(correlation, matches);
        }
      }
    }
  }

  /**
   * Handle correlated alerts
   */
  private handleCorrelation(correlation: AlertCorrelation, alerts: Alert[]): void {
    const correlatedAlert: Alert = {
      id: `corr_${correlation.id}_${Date.now()}`,
      name: `Correlated Alert: ${correlation.id}`,
      severity: 'critical',
      source: 'composite',
      timestamp: new Date(),
      message: `${alerts.length} related alerts detected`,
      details: {
        correlation,
        alerts: alerts.map(a => ({ id: a.id, name: a.name })),
      },
      metadata: {
        relatedAlerts: alerts.map(a => a.id),
      },
      status: 'active',
    };

    this.triggerAlert(correlatedAlert);
  }

  /**
   * Get recent alerts
   */
  private getRecentAlerts(timeWindowSeconds: number): Alert[] {
    const cutoff = new Date(Date.now() - timeWindowSeconds * 1000);
    return Array.from(this.activeAlerts.values()).filter(
      alert => alert.timestamp >= cutoff
    );
  }

  /**
   * Match correlation pattern
   */
  private matchCorrelationPattern(alerts: Alert[], correlation: AlertCorrelation): Alert[] {
    // Simple pattern matching - could be enhanced with regex or more complex logic
    return alerts.filter(alert => {
      if (correlation.pattern === '*') return true;
      return alert.name.includes(correlation.pattern) || 
             alert.message.includes(correlation.pattern);
    });
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoff = new Date(Date.now() - 86400000); // 24 hours
    
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.status === 'resolved' && alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.activeAlerts.delete(alertId);
      }
    }
  }

  /**
   * Get default actions based on severity
   */
  private getDefaultActions(severity: Alert['severity']): AlertAction[] {
    const actions: AlertAction[] = [
      { type: 'log', config: {} },
    ];

    if (severity === 'critical') {
      actions.push({ type: 'pagerduty', config: {} });
    }

    return actions;
  }

  /**
   * Get runbook URL
   */
  private getRunbookUrl(type: string, identifier: string): string {
    return `https://runbooks.example.com/${type}/${identifier}`;
  }

  /**
   * Get dashboard URL
   */
  private getDashboardUrl(type: string, identifier: string): string {
    return `https://dashboards.example.com/${type}/${identifier}`;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, userId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert && alert.status === 'active') {
      alert.status = 'acknowledged';
      alert.acknowledgedBy = userId;
      alert.acknowledgedAt = new Date();
      this.emit('alert:acknowledged', alert);
    }
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert && alert.status !== 'resolved') {
      alert.status = 'resolved';
      alert.resolvedAt = new Date();
      this.emit('alert:resolved', alert);
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(filter?: {
    severity?: Alert['severity'];
    source?: Alert['source'];
  }): Alert[] {
    let alerts = Array.from(this.activeAlerts.values());
    
    if (filter?.severity) {
      alerts = alerts.filter(a => a.severity === filter.severity);
    }
    if (filter?.source) {
      alerts = alerts.filter(a => a.source === filter.source);
    }
    
    return alerts;
  }
}