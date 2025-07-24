import { BaseService, BaseAsyncService } from './BaseService.js';
import { ServiceRegistry } from './ServiceRegistry.js';
import { TypedEventEmitter } from './TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';
import type { HealthCheckResult, HealthStatus } from './BaseService.js';

interface HealthIncident {
  id: string;
  serviceName: string;
  startTime: Date;
  endTime?: Date;
  status: HealthStatus;
  checks: Array<{
    name: string;
    status: HealthStatus;
    message: string;
    timestamp: Date;
  }>;
  resolved: boolean;
}

interface HealthTrend {
  serviceName: string;
  period: 'hour' | 'day' | 'week';
  availability: number;
  incidents: number;
  mttr: number; // Mean Time To Recovery
  healthScores: number[];
}

interface AlertRule {
  id: string;
  name: string;
  condition: (service: string, health: HealthCheckResult) => boolean;
  severity: 'info' | 'warning' | 'critical';
  cooldown: number; // milliseconds
  lastTriggered?: Date;
}

interface HealthMonitorEventMap {
  'health:checked': { timestamp: Date };
  'health:error': { error: Error };
  'health:state-changed': {
    service: string;
    from: HealthStatus;
    to: HealthStatus;
  };
  'incident:created': { incident: HealthIncident };
  'incident:resolved': {
    incident: HealthIncident;
    duration: number;
  };
  'alert:triggered': {
    rule: string;
    service: string;
    severity: 'info' | 'warning' | 'critical';
    health: HealthCheckResult;
  };
  'health:degraded': { unhealthyServices: string[] };
  'health:critical': { services: string[] };
}

/**
 * Advanced Health Monitoring System
 * Provides comprehensive health monitoring, incident tracking, and alerting
 */
export class ServiceHealthMonitor extends TypedEventEmitter<HealthMonitorEventMap> {
  private static instance: ServiceHealthMonitor;
  private incidents: Map<string, HealthIncident[]> = new Map();
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private historyRetention: number = 86400000; // 24 hours
  private isMonitoring = false;

  private constructor() {
    super();
    this.setupDefaultAlertRules();
  }

  static getInstance(): ServiceHealthMonitor {
    if (!ServiceHealthMonitor.instance) {
      ServiceHealthMonitor.instance = new ServiceHealthMonitor();
    }
    return ServiceHealthMonitor.instance;
  }

  /**
   * Start health monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      logger.warn('Health monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting health monitoring', { interval: intervalMs });

    // Initial check
    this.performHealthCheck();

    // Schedule periodic checks
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    logger.info('Health monitoring stopped');
  }

  /**
   * Add custom alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info('Alert rule added', { rule: rule.name });
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
  }

  /**
   * Get current incidents
   */
  getCurrentIncidents(): HealthIncident[] {
    const current: HealthIncident[] = [];
    
    for (const incidents of this.incidents.values()) {
      current.push(...incidents.filter(i => !i.resolved));
    }

    return current;
  }

  /**
   * Get incident history
   */
  getIncidentHistory(
    serviceName?: string,
    startTime?: Date,
    endTime?: Date
  ): HealthIncident[] {
    const results: HealthIncident[] = [];
    
    const services = serviceName 
      ? [serviceName] 
      : Array.from(this.incidents.keys());

    for (const service of services) {
      const incidents = this.incidents.get(service) || [];
      
      const filtered = incidents.filter(incident => {
        const start = incident.startTime.getTime();
        const end = incident.endTime?.getTime() || Date.now();
        
        const afterStart = !startTime || start >= startTime.getTime();
        const beforeEnd = !endTime || end <= endTime.getTime();
        
        return afterStart && beforeEnd;
      });

      results.push(...filtered);
    }

    return results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   * Get health trends
   */
  getHealthTrends(
    serviceName: string,
    period: 'hour' | 'day' | 'week' = 'day'
  ): HealthTrend | null {
    const history = this.healthHistory.get(serviceName);
    if (!history || history.length === 0) {
      return null;
    }

    const periodMs = {
      hour: 3600000,
      day: 86400000,
      week: 604800000,
    }[period];

    const cutoff = Date.now() - periodMs;
    const relevantHistory = history.filter(h => h.timestamp.getTime() > cutoff);

    if (relevantHistory.length === 0) {
      return null;
    }

    // Calculate availability
    const healthyCount = relevantHistory.filter(h => h.status === 'healthy').length;
    const availability = (healthyCount / relevantHistory.length) * 100;

    // Get incidents in period
    const incidents = this.getIncidentHistory(
      serviceName,
      new Date(cutoff),
      new Date()
    );

    // Calculate MTTR
    let totalRecoveryTime = 0;
    let recoveredIncidents = 0;
    
    for (const incident of incidents) {
      if (incident.resolved && incident.endTime) {
        totalRecoveryTime += incident.endTime.getTime() - incident.startTime.getTime();
        recoveredIncidents++;
      }
    }

    const mttr = recoveredIncidents > 0 
      ? totalRecoveryTime / recoveredIncidents 
      : 0;

    // Calculate health scores
    const healthScores = relevantHistory.map(h => {
      if (h.status === 'healthy') return 100;
      if (h.status === 'degraded') return 50;
      return 0;
    });

    return {
      serviceName,
      period,
      availability,
      incidents: incidents.length,
      mttr,
      healthScores,
    };
  }

  /**
   * Generate health report
   */
  generateHealthReport(): {
    summary: {
      totalServices: number;
      healthyServices: number;
      degradedServices: number;
      unhealthyServices: number;
      currentIncidents: number;
    };
    services: Map<string, {
      status: HealthStatus;
      availability: number;
      lastCheck: Date;
      issues: string[];
    }>;
    topIncidents: HealthIncident[];
  } {
    const services = ServiceRegistry.getAll();
    const serviceDetails = new Map<string, any>();
    
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;

    for (const [name, service] of services) {
      const history = this.healthHistory.get(name) || [];
      const latest = history[history.length - 1];
      
      if (!latest) continue;

      const trend = this.getHealthTrends(name, 'day');
      const issues: string[] = [];

      if (latest.status === 'healthy') {
        healthyCount++;
      } else if (latest.status === 'degraded') {
        degradedCount++;
        issues.push(...this.extractIssues(latest));
      } else {
        unhealthyCount++;
        issues.push(...this.extractIssues(latest));
      }

      serviceDetails.set(name, {
        status: latest.status,
        availability: trend?.availability || 0,
        lastCheck: latest.timestamp,
        issues,
      });
    }

    const currentIncidents = this.getCurrentIncidents();
    const topIncidents = currentIncidents
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, 10);

    return {
      summary: {
        totalServices: services.size,
        healthyServices: healthyCount,
        degradedServices: degradedCount,
        unhealthyServices: unhealthyCount,
        currentIncidents: currentIncidents.length,
      },
      services: serviceDetails,
      topIncidents,
    };
  }

  /**
   * Predict potential issues
   */
  predictIssues(serviceName: string): {
    predictions: Array<{
      issue: string;
      probability: number;
      timeframe: string;
      recommendation: string;
    }>;
  } | null {
    const history = this.healthHistory.get(serviceName);
    if (!history || history.length < 10) {
      return null;
    }

    const predictions: any[] = [];

    // Analyze patterns
    const recent = history.slice(-20);
    const degradedCount = recent.filter(h => h.status === 'degraded').length;
    const unhealthyCount = recent.filter(h => h.status === 'unhealthy').length;

    // Pattern: Increasing degradation
    if (degradedCount > recent.length * 0.3) {
      predictions.push({
        issue: 'Service degradation trend',
        probability: Math.min(degradedCount / recent.length, 0.9),
        timeframe: '1-2 hours',
        recommendation: 'Review resource allocation and recent changes',
      });
    }

    // Pattern: Repeated failures
    if (unhealthyCount > 0) {
      const failureRate = unhealthyCount / recent.length;
      if (failureRate > 0.1) {
        predictions.push({
          issue: 'Potential service failure',
          probability: Math.min(failureRate * 2, 0.8),
          timeframe: '30-60 minutes',
          recommendation: 'Check service logs and dependencies',
        });
      }
    }

    // Pattern: Memory issues
    const memoryIssues = recent.filter(h => 
      h.message?.toLowerCase().includes('memory') ||
      h.checks?.some(c => c.message.toLowerCase().includes('memory'))
    );

    if (memoryIssues.length > 2) {
      predictions.push({
        issue: 'Memory leak or exhaustion',
        probability: 0.7,
        timeframe: '2-4 hours',
        recommendation: 'Monitor memory usage and restart if necessary',
      });
    }

    return { predictions };
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const services = ServiceRegistry.getAll();
      
      for (const [name, service] of services) {
        const health = await service.getHealth();
        
        // Store in history
        if (!this.healthHistory.has(name)) {
          this.healthHistory.set(name, []);
        }
        this.healthHistory.get(name)!.push(health);

        // Check for state changes
        this.checkStateChange(name, health);

        // Check alert rules
        this.checkAlertRules(name, health);

        // Clean old history
        this.cleanOldHistory(name);
      }

      this.emit('health:checked', { timestamp: new Date() });

    } catch (error) {
      logger.error('Health check failed', { error });
      this.emit('health:error', { error });
    }
  }

  private checkStateChange(serviceName: string, currentHealth: HealthCheckResult): void {
    const history = this.healthHistory.get(serviceName) || [];
    if (history.length < 2) return;

    const previousHealth = history[history.length - 2];
    
    if (previousHealth.status !== currentHealth.status) {
      // State changed
      const incidents = this.incidents.get(serviceName) || [];
      
      if (currentHealth.status !== 'healthy') {
        // Service became unhealthy - create incident
        const incident: HealthIncident = {
          id: `incident_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          serviceName,
          startTime: currentHealth.timestamp,
          status: currentHealth.status,
          checks: currentHealth.checks || [],
          resolved: false,
        };

        incidents.push(incident);
        this.incidents.set(serviceName, incidents);

        this.emit('incident:created', { incident });
        logger.warn('Health incident created', {
          service: serviceName,
          status: currentHealth.status,
        });

      } else {
        // Service recovered - resolve incident
        const openIncident = incidents.find(i => !i.resolved);
        if (openIncident) {
          openIncident.endTime = currentHealth.timestamp;
          openIncident.resolved = true;

          this.emit('incident:resolved', { 
            incident: openIncident,
            duration: openIncident.endTime.getTime() - openIncident.startTime.getTime(),
          });

          logger.info('Health incident resolved', {
            service: serviceName,
            duration: openIncident.endTime.getTime() - openIncident.startTime.getTime(),
          });
        }
      }

      this.emit('health:state-changed', {
        service: serviceName,
        from: previousHealth.status,
        to: currentHealth.status,
      });
    }
  }

  private checkAlertRules(serviceName: string, health: HealthCheckResult): void {
    for (const rule of this.alertRules.values()) {
      // Check cooldown
      if (rule.lastTriggered) {
        const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
        if (timeSinceLastTrigger < rule.cooldown) {
          continue;
        }
      }

      // Check condition
      if (rule.condition(serviceName, health)) {
        rule.lastTriggered = new Date();

        this.emit('alert:triggered', {
          rule: rule.name,
          service: serviceName,
          severity: rule.severity,
          health,
        });

        logger.warn('Alert triggered', {
          rule: rule.name,
          service: serviceName,
          severity: rule.severity,
        });
      }
    }
  }

  private cleanOldHistory(serviceName: string): void {
    const history = this.healthHistory.get(serviceName);
    if (!history) return;

    const cutoff = Date.now() - this.historyRetention;
    const filtered = history.filter(h => h.timestamp.getTime() > cutoff);
    
    if (filtered.length < history.length) {
      this.healthHistory.set(serviceName, filtered);
    }
  }

  private extractIssues(health: HealthCheckResult): string[] {
    const issues: string[] = [];
    
    if (health.message) {
      issues.push(health.message);
    }

    if (health.checks) {
      for (const check of health.checks) {
        if (check.status !== 'healthy' && check.message) {
          issues.push(`${check.name}: ${check.message}`);
        }
      }
    }

    return issues;
  }

  private setupDefaultAlertRules(): void {
    // Service down alert
    this.addAlertRule({
      id: 'service-down',
      name: 'Service Down',
      condition: (service, health) => health.status === 'unhealthy',
      severity: 'critical',
      cooldown: 300000, // 5 minutes
    });

    // Service degraded alert
    this.addAlertRule({
      id: 'service-degraded',
      name: 'Service Degraded',
      condition: (service, health) => health.status === 'degraded',
      severity: 'warning',
      cooldown: 600000, // 10 minutes
    });

    // High error rate
    this.addAlertRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      condition: (service, health) => {
        const errorCheck = health.checks?.find(c => c.name.includes('error'));
        return errorCheck?.status === 'unhealthy';
      },
      severity: 'warning',
      cooldown: 900000, // 15 minutes
    });

    // Critical dependency failure
    this.addAlertRule({
      id: 'dependency-failure',
      name: 'Critical Dependency Failure',
      condition: (service, health) => {
        const depCheck = health.checks?.find(c => 
          c.name.includes('dependency') && c.critical
        );
        return depCheck?.status === 'unhealthy';
      },
      severity: 'critical',
      cooldown: 300000, // 5 minutes
    });
  }
}

/**
 * Health monitoring middleware for services
 */
export function withHealthMonitoring<T extends BaseService<any, any> | BaseAsyncService<any, any>>(
  ServiceClass: new (...args: any[]) => T
): new (...args: any[]) => T {
  return class extends ServiceClass {
    constructor(...args: any[]) {
      super(...args);
      
      // Register with health monitor on initialization
      this.on('service:initialized', () => {
        const monitor = ServiceHealthMonitor.getInstance();
        
        // Start monitoring if not already started
        if (!monitor['isMonitoring']) {
          monitor.startMonitoring();
        }
      });
    }
  };
}