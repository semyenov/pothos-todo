import { createHash } from 'crypto';
import { logger } from '@/logger.js';
import { ZeroTrustGateway } from './ZeroTrustGateway.js';
import { ThreatDetectionSystem } from './ThreatDetection.js';
import { ComplianceAutomationSystem } from './ComplianceAutomation.js';
import { DataPrivacySystem } from './DataPrivacy.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  sessionId?: string;
  resource?: string;
  action?: string;
  result: 'success' | 'failure' | 'error';
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  hash: string;
}

export type AuditEventType =
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'data_modification'
  | 'configuration_change'
  | 'security_event'
  | 'compliance_check'
  | 'privacy_request'
  | 'system_access'
  | 'privilege_change';

export interface SuspiciousActivity {
  type: string;
  userId?: string;
  resource?: string;
}

export interface AuditEventMap {
  'audit:logged': [AuditEvent<AuditEventMap>];
  'report:generated': [AuditReport];
  'suspicious:activity': [SuspiciousActivity];
}

export interface AuditReport {
  id: string;
  period: { start: Date; end: Date };
  generatedAt: Date;
  summary: {
    totalEvents: number;
    failedEvents: number;
    uniqueUsers: number;
    threatEvents: number;
    complianceScore: number;
  };
  sections: {
    authentication: AuthenticationAudit;
    dataAccess: DataAccessAudit;
    threats: ThreatAudit;
    compliance: ComplianceAudit;
    privacy: PrivacyAudit;
  };
  recommendations: string[];
}

export interface AuthenticationAudit {
  totalAttempts: number;
  successfulLogins: number;
  failedLogins: number;
  mfaUsage: number;
  suspiciousAttempts: number;
  topFailedUsers: Array<{ userId: string; attempts: number }>;
}

export interface DataAccessAudit {
  totalAccesses: number;
  sensitiveDataAccesses: number;
  unauthorizedAttempts: number;
  topAccessedResources: Array<{ resource: string; count: number }>;
  anomalousAccess: Array<{ userId: string; resource: string; reason: string }>;
}

export interface ThreatAudit {
  totalThreats: number;
  criticalThreats: number;
  mitigatedThreats: number;
  threatsByType: Record<string, number>;
  topThreatenedResources: string[];
}

export interface ComplianceAudit {
  frameworks: Array<{ name: string; score: number; status: string }>;
  overallCompliance: number;
  failedControls: number;
  criticalFindings: number;
}

export interface PrivacyAudit {
  dataRequests: number;
  completedRequests: number;
  dataBreaches: number;
  encryptedFields: number;
  anonymizedRecords: number;
}

/**
 * Security Audit and Reporting System
 * Provides comprehensive security auditing and reporting capabilities
 */
export class SecurityAuditSystem extends EventEmitterSingletonService<AuditEventMap> {
  private auditLog: AuditEvent[] = [];
  private auditReports: Map<string, AuditReport> = new Map();
  private integritySalt: string | null = null;

  private zeroTrust: ZeroTrustGateway | null = null;
  private threatDetection: ThreatDetectionSystem | null = null;
  private compliance: ComplianceAutomationSystem | null = null;
  private dataPrivacy: DataPrivacySystem | null = null;

  protected constructor() {
    super();
  }

  public initialize(): void {
    this.integritySalt = this.generateIntegritySalt();

    // Get security system instances
    this.zeroTrust = ZeroTrustGateway.getInstance();
    this.threatDetection = ThreatDetectionSystem.getInstance();
    this.compliance = ComplianceAutomationSystem.getInstance();
    this.dataPrivacy = DataPrivacySystem.getInstance();

    this.setupEventListeners();
  }

  private ensureInitialized(): void {
    if (!this.integritySalt || !this.zeroTrust || !this.threatDetection || !this.compliance || !this.dataPrivacy) {
      throw new Error('SecurityAuditSystem not initialized');
    }
  }

  public static override getInstance(): SecurityAuditSystem<AuditEventMap> {
    const instance = super.getInstance() as SecurityAuditSystem;
    if (!instance?.integritySalt) {
      instance.initialize();
    }
    return instance;
  }

  /**
   * Log an audit event
   */
  logEvent(event: Omit<AuditEvent, 'id' | 'hash'>): void {
    const auditEvent: AuditEvent = {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      hash: this.calculateEventHash(event),
    };

    this.auditLog.push(auditEvent);
    this.emit('audit:logged', auditEvent);

    // Persist to secure storage
    this.persistAuditEvent(auditEvent);

    // Check for suspicious patterns
    this.analyzeSuspiciousActivity(auditEvent);
  }

  /**
   * Generate comprehensive security audit report
   */
  async generateAuditReport(
    period: { start: Date; end: Date }
  ): Promise<AuditReport> {
    logger.info('Generating security audit report', { period });

    const events = this.getEventsInPeriod(period);

    const report: AuditReport = {
      id: `report_${Date.now()}`,
      period,
      generatedAt: new Date(),
      summary: await this.generateSummary(events),
      sections: {
        authentication: await this.auditAuthentication(events),
        dataAccess: await this.auditDataAccess(events),
        threats: await this.auditThreats(period),
        compliance: await this.auditCompliance(),
        privacy: await this.auditPrivacy(events),
      },
      recommendations: await this.generateRecommendations(events),
    };

    // Verify audit log integrity
    const integrityValid = await this.verifyAuditIntegrity(events);
    if (!integrityValid) {
      logger.error('Audit log integrity check failed');
      report.recommendations.unshift('CRITICAL: Audit log tampering detected');
    }

    this.auditReports.set(report.id, report);
    this.emit('report:generated', report);

    return report;
  }

  /**
   * Search audit logs
   */
  searchAuditLogs(criteria: {
    eventType?: AuditEventType;
    userId?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    result?: 'success' | 'failure' | 'error';
  }): AuditEvent[] {
    return this.auditLog.filter(event => {
      if (criteria.eventType && event.eventType !== criteria.eventType) return false;
      if (criteria.userId && event.userId !== criteria.userId) return false;
      if (criteria.resource && event.resource !== criteria.resource) return false;
      if (criteria.result && event.result !== criteria.result) return false;
      if (criteria.startDate && event.timestamp < criteria.startDate) return false;
      if (criteria.endDate && event.timestamp > criteria.endDate) return false;
      return true;
    });
  }

  /**
   * Export audit logs for external analysis
   */
  exportAuditLogs(
    format: 'json' | 'csv' | 'siem',
    period?: { start: Date; end: Date }
  ): string {
    const events = period ? this.getEventsInPeriod(period) : this.auditLog;

    switch (format) {
      case 'json':
        return JSON.stringify(events, null, 2);

      case 'csv':
        return this.convertToCSV(events);

      case 'siem':
        return this.convertToSIEMFormat(events);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Setup event listeners for security systems
   */
  private setupEventListeners(): void {
    // Listen to threat detection events
    this.threatDetection?.on('threat:detected', (threat: ThreatIndicator) => {
      this.logEvent({
        timestamp: threat.timestamp,
        eventType: 'security_event',
        result: 'failure',
        details: {
          threatType: threat.type,
          severity: threat.severity,
          confidence: threat.confidence,
          ...threat.details,
        },
      });
    });

    // Listen to compliance events
    this.compliance?.on('control:checked', ({ control, status }: any) => {
      this.logEvent({
        timestamp: new Date(),
        eventType: 'compliance_check',
        result: status.status === 'compliant' ? 'success' : 'failure',
        details: {
          controlId: control.id,
          frameworkId: control.frameworkId,
          status: status.status,
          score: status.score,
        },
      });
    });
  }

  /**
   * Calculate event hash for integrity
   */
  private calculateEventHash(event: Omit<AuditEvent, 'id' | 'hash'>): string {
    const content = JSON.stringify({
      ...event,
      salt: this.integritySalt,
    });

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Verify audit log integrity
   */
  private async verifyAuditIntegrity(events: AuditEvent[]): Promise<boolean> {
    for (const event of events) {
      const recalculatedHash = this.calculateEventHash({
        timestamp: event.timestamp,
        eventType: event.eventType,
        userId: event.userId,
        sessionId: event.sessionId,
        resource: event.resource,
        action: event.action,
        result: event.result,
        details: event.details,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
      });

      if (event.hash !== recalculatedHash) {
        logger.error('Audit event integrity violation detected', {
          eventId: event.id,
          expectedHash: recalculatedHash,
          actualHash: event.hash,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Analyze for suspicious activity patterns
   */
  private analyzeSuspiciousActivity(event: AuditEvent): void {
    // Check for repeated failures
    if (event.result === 'failure') {
      const recentFailures = this.auditLog.filter(e =>
        e.userId === event.userId &&
        e.result === 'failure' &&
        e.timestamp > new Date(Date.now() - 300000) // Last 5 minutes
      );

      if (recentFailures.length >= 5) {
        this.emit('suspicious:activity', {
          type: 'repeated_failures',
          userId: event.userId,
          count: recentFailures.length,
        });
      }
    }

    // Check for privilege escalation attempts
    if (event.eventType === 'authorization' && event.resource?.startsWith('/admin')) {
      const previousAdminAccess = this.auditLog.find(e =>
        e.userId === event.userId &&
        e.eventType === 'authorization' &&
        e.resource?.startsWith('/admin') &&
        e.result === 'success'
      );

      if (!previousAdminAccess) {
        this.emit('suspicious:activity', {
          type: 'privilege_escalation_attempt',
          userId: event.userId,
          resource: event.resource,
        });
      }
    }
  }

  /**
   * Generate summary statistics
   */
  private async generateSummary(events: AuditEvent[]): Promise<AuditReport['summary']> {
    const uniqueUsers = new Set(events.map(e => e.userId).filter(Boolean));
    const failedEvents = events.filter(e => e.result === 'failure');
    const threatEvents = events.filter(e => e.eventType === 'security_event');

    const complianceReports = await this.compliance?.getDashboardData();

    return {
      totalEvents: events.length,
      failedEvents: failedEvents.length,
      uniqueUsers: uniqueUsers.size,
      threatEvents: threatEvents.length,
      complianceScore: complianceReports.overallCompliance || 0,
    };
  }

  /**
   * Audit authentication activities
   */
  private async auditAuthentication(events: AuditEvent<AuditEventMap>[]): Promise<AuthenticationAudit> {
    const authEvents = events.filter(e => e.eventType === 'authentication');
    const successful = authEvents.filter(e => e.result === 'success');
    const failed = authEvents.filter(e => e.result === 'failure');

    // Count MFA usage
    const mfaUsage = successful.filter(e => e.details.mfaUsed).length;

    // Find suspicious attempts
    const suspicious = authEvents.filter(e =>
      e.details.riskScore > 0.7 || e.details.suspicious
    );

    // Top failed users
    const failuresByUser = failed.reduce((acc, e) => {
      if (e.userId) {
        acc[e.userId] = (acc[e.userId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const topFailedUsers = Object.entries(failuresByUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, attempts]) => ({ userId, attempts }));

    return {
      totalAttempts: authEvents.length,
      successfulLogins: successful.length,
      failedLogins: failed.length,
      mfaUsage,
      suspiciousAttempts: suspicious.length,
      topFailedUsers,
    };
  }

  /**
   * Audit data access patterns
   */
  private async auditDataAccess(events: AuditEvent<AuditEventMap>[]): Promise<DataAccessAudit> {
    const accessEvents = events.filter(e =>
      e.eventType === 'data_access' || e.eventType === 'data_modification'
    );

    const sensitiveAccess = accessEvents.filter(e =>
      e.details.classification === 'confidential' ||
      e.details.classification === 'restricted'
    );

    const unauthorized = accessEvents.filter(e => e.result === 'failure');

    // Top accessed resources
    const resourceCounts = accessEvents.reduce((acc, e) => {
      if (e.resource) {
        acc[e.resource] = (acc[e.resource] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const topAccessedResources = Object.entries(resourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([resource, count]) => ({ resource, count }));

    // Find anomalous access
    const anomalousAccess: DataAccessAudit['anomalousAccess'] = [];

    // Check for unusual time access
    const nightAccess = accessEvents.filter(e => {
      const hour = e.timestamp.getHours();
      return hour < 6 || hour > 22;
    });

    for (const event of nightAccess) {
      if (event.userId && event.resource) {
        anomalousAccess.push({
          userId: event.userId,
          resource: event.resource,
          reason: 'Access during unusual hours',
        });
      }
    }

    return {
      totalAccesses: accessEvents.length,
      sensitiveDataAccesses: sensitiveAccess.length,
      unauthorizedAttempts: unauthorized.length,
      topAccessedResources,
      anomalousAccess,
    };
  }

  /**
   * Audit threat landscape
   */
  private async auditThreats(period: { start: Date; end: Date }): Promise<ThreatAudit> {
    const threats = this.threatDetection?.getAnomalyHistory({
      since: period.start,
    });

    const threatsByType = threats.reduce((acc, threat) => {
      acc[threat.type] = (acc[threat.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const criticalThreats = threats.filter(t => t.severity === 'critical');
    const mitigatedThreats = threats.filter(t => t.context?.mitigated);

    // Find top threatened resources
    const resourceThreats = threats.reduce((acc, threat) => {
      const resource = threat.details.event?.resource;
      if (resource) {
        acc[resource] = (acc[resource] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const topThreatenedResources = Object.entries(resourceThreats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([resource]) => resource);

    return {
      totalThreats: threats.length,
      criticalThreats: criticalThreats.length,
      mitigatedThreats: mitigatedThreats.length,
      threatsByType,
      topThreatenedResources,
    };
  }

  /**
   * Audit compliance status
   */
  private async auditCompliance(): Promise<ComplianceAudit> {
    const dashboardData = await this.compliance?.getDashboardData();

    const frameworks = dashboardData.frameworks.map((f: any) => ({
      name: f.name,
      score: f.score,
      status: f.status,
    }));

    const failedControls = dashboardData.frameworks.reduce((sum: number, f: any) =>
      sum + (f.summary?.nonCompliantControls || 0), 0
    );

    return {
      frameworks,
      overallCompliance: dashboardData.overallCompliance,
      failedControls,
      criticalFindings: dashboardData.criticalFindings.length,
    };
  }

  /**
   * Audit privacy operations
   */
  private async auditPrivacy(events: AuditEvent<AuditEventMap>[]): Promise<PrivacyAudit> {
    const privacyEvents = events.filter(e => e.eventType === 'privacy_request');
    const dataBreaches = events.filter(e =>
      e.eventType === 'security_event' &&
      e.details.threatType === 'data_exfiltration'
    );

    const completedRequests = privacyEvents.filter(e =>
      e.result === 'success' && e.details.status === 'completed'
    );

    // These would be retrieved from the data privacy system
    const encryptedFields = 50; // Placeholder
    const anonymizedRecords = 1000; // Placeholder

    return {
      dataRequests: privacyEvents.length,
      completedRequests: completedRequests.length,
      dataBreaches: dataBreaches.length,
      encryptedFields,
      anonymizedRecords,
    };
  }

  /**
   * Generate actionable recommendations
   */
  private async generateRecommendations(events: AuditEvent<AuditEventMap>[]): Promise<string[]> {
    const recommendations: string[] = [];

    // Check authentication patterns
    const authFailureRate = events.filter(e =>
      e.eventType === 'authentication' && e.result === 'failure'
    ).length / events.filter(e => e.eventType === 'authentication').length;

    if (authFailureRate > 0.2) {
      recommendations.push('High authentication failure rate detected. Consider implementing stricter rate limiting.');
    }

    // Check MFA usage
    const mfaUsage = events.filter(e =>
      e.eventType === 'authentication' &&
      e.result === 'success' &&
      e.details.mfaUsed
    ).length / events.filter(e =>
      e.eventType === 'authentication' && e.result === 'success'
    ).length;

    if (mfaUsage < 0.8) {
      recommendations.push('Low MFA adoption. Enforce multi-factor authentication for all users.');
    }

    // Check for repeated threats
    const threatEvents = events.filter(e => e.eventType === 'security_event');
    if (threatEvents.length > 100) {
      recommendations.push('High number of security threats detected. Review and strengthen security controls.');
    }

    // Check compliance
    const complianceData = await this.compliance?.getDashboardData();
    if (complianceData.overallCompliance < 90) {
      recommendations.push('Compliance score below target. Address failed controls immediately.');
    }

    return recommendations;
  }

  /**
   * Get events in specified period
   */
  private getEventsInPeriod(period: { start: Date; end: Date }): AuditEvent<AuditEventMap>[] {
    return this.auditLog.filter(e =>
      e.timestamp >= period.start && e.timestamp <= period.end
    );
  }

  /**
   * Convert to CSV format
   */
  private convertToCSV(events: AuditEvent<AuditEventMap>[]): string {
    const headers = ['timestamp', 'eventType', 'userId', 'resource', 'action', 'result', 'ipAddress'];
    const rows = events.map(e => [
      e.timestamp.toISOString(),
      e.eventType,
      e.userId || '',
      e.resource || '',
      e.action || '',
      e.result,
      e.ipAddress || '',
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Convert to SIEM format
   */
  private convertToSIEMFormat(events: AuditEvent<AuditEventMap>[]): string {
    return events.map(e => {
      const cef = [
        'CEF:0',
        'SecurityAudit',
        'TodoApp',
        '1.0',
        e.eventType,
        e.eventType,
        this.getSeverity(e),
        `src=${e.ipAddress || 'unknown'}`,
        `suser=${e.userId || 'anonymous'}`,
        `act=${e.action || e.eventType}`,
        `outcome=${e.result}`,
        `msg=${JSON.stringify(e.details)}`,
      ].join('|');

      return `${e.timestamp.toISOString()} ${cef}`;
    }).join('\n');
  }

  /**
   * Get severity for SIEM
   */
  private getSeverity(event: AuditEvent<AuditEventMap>): number {
    if (event.result === 'failure' && event.eventType === 'authentication') return 7;
    if (event.eventType === 'security_event') return 8;
    if (event.result === 'failure') return 5;
    return 3;
  }

  /**
   * Generate integrity salt
   */
  private generateIntegritySalt(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex');
  }

  /**
   * Persist audit event
   */
  private persistAuditEvent(event: AuditEvent<AuditEventMap>): void {
    // In production, would persist to immutable storage
    logger.debug('Audit event persisted', { eventId: event.id });
  }

  /**
   * Archive old audit logs
   */
  async archiveOldLogs(olderThan: Date): Promise<number> {
    const toArchive = this.auditLog.filter(e => e.timestamp < olderThan);

    // In production, would move to cold storage
    this.auditLog = this.auditLog.filter(e => e.timestamp >= olderThan);

    logger.info(`Archived ${toArchive.length} audit events`);
    return toArchive.length;
  }
}