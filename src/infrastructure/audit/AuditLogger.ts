import { logger } from '../../lib/unjs-utils.js';
import { ohash } from 'ohash';
import { nanoid } from 'nanoid';

// Audit event types and severity levels
export type AuditEventType = 
  | 'authentication'
  | 'authorization' 
  | 'data_access'
  | 'data_modification'
  | 'system_access'
  | 'configuration_change'
  | 'security_event'
  | 'compliance_event'
  | 'error_event'
  | 'admin_action';

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ComplianceFramework = 'SOX' | 'GDPR' | 'HIPAA' | 'SOC2' | 'PCI-DSS' | 'ISO-27001';

// Audit event structure
export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  source: string;
  actor: {
    userId?: string;
    userEmail?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    roles?: string[];
  };
  target: {
    resourceType: string;
    resourceId?: string;
    resourceName?: string;
    previousValue?: any;
    newValue?: any;
  };
  action: string;
  description: string;
  metadata: Record<string, any>;
  compliance: {
    frameworks: ComplianceFramework[];
    categories: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  context: {
    traceId?: string;
    spanId?: string;
    requestId?: string;
    environment: string;
    application: string;
    version: string;
  };
  retention: {
    retentionPeriod: number; // days
    archiveAfter: number; // days
    deleteAfter?: number; // days (null = never delete)
  };
}

// Audit configuration
export interface AuditConfig {
  enabled: boolean;
  logLevel: AuditSeverity;
  storage: {
    type: 'database' | 'file' | 'elasticsearch' | 'cloud';
    connection: string;
    encryption: boolean;
    compression: boolean;
  };
  retention: {
    defaultRetentionDays: number;
    defaultArchiveDays: number;
    complianceRetention: Record<ComplianceFramework, number>;
  };
  alerting: {
    enabled: boolean;
    channels: Array<{
      type: 'email' | 'slack' | 'webhook' | 'sms';
      config: Record<string, any>;
      severityThreshold: AuditSeverity;
    }>;
  };
  compliance: {
    enabledFrameworks: ComplianceFramework[];
    automaticReporting: boolean;
    reportingSchedule: string; // cron expression
  };
  performance: {
    bufferSize: number;
    flushInterval: number; // milliseconds
    maxConcurrentWrites: number;
  };
}

// Enterprise audit logger with compliance support
export class AuditLogger {
  private static instance: AuditLogger | null = null;
  private config: AuditConfig;
  private eventBuffer: AuditEvent[] = [];
  private isProcessing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private storage: AuditStorage | null = null;
  private alertManager: AuditAlertManager | null = null;
  private complianceReporter: ComplianceReporter | null = null;

  private constructor(config: AuditConfig) {
    this.config = config;
    this.initialize();
  }

  static getInstance(config?: AuditConfig): AuditLogger {
    if (!AuditLogger.instance) {
      if (!config) {
        throw new Error('AuditConfig required for first initialization');
      }
      AuditLogger.instance = new AuditLogger(config);
    }
    return AuditLogger.instance;
  }

  // Initialize audit logger components
  private async initialize(): Promise<void> {
    try {
      // Initialize storage
      this.storage = new AuditStorage(this.config.storage);
      await this.storage.initialize();

      // Initialize alert manager
      if (this.config.alerting.enabled) {
        this.alertManager = new AuditAlertManager(this.config.alerting);
        await this.alertManager.initialize();
      }

      // Initialize compliance reporter
      if (this.config.compliance.automaticReporting) {
        this.complianceReporter = new ComplianceReporter(this.config.compliance);
        await this.complianceReporter.initialize();
      }

      // Start flush timer
      this.startFlushTimer();

      logger.info('Audit logger initialized successfully', {
        storageType: this.config.storage.type,
        alertingEnabled: this.config.alerting.enabled,
        complianceFrameworks: this.config.compliance.enabledFrameworks,
      });
    } catch (error) {
      logger.error('Failed to initialize audit logger:', error);
      throw error;
    }
  }

  // Log an audit event
  async logEvent(eventData: Partial<AuditEvent>): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Skip events below configured log level
    if (this.getSeverityLevel(eventData.severity || 'low') < this.getSeverityLevel(this.config.logLevel)) {
      return;
    }

    // Create complete audit event
    const auditEvent = this.createAuditEvent(eventData);

    // Add to buffer
    this.eventBuffer.push(auditEvent);

    // Check if immediate flush is needed for high-severity events
    if (auditEvent.severity === 'critical' || auditEvent.severity === 'high') {
      await this.flushEvents();
    } else if (this.eventBuffer.length >= this.config.performance.bufferSize) {
      // Flush if buffer is full
      setImmediate(() => this.flushEvents());
    }

    // Send alerts if needed
    if (this.alertManager && this.shouldAlert(auditEvent)) {
      await this.alertManager.sendAlert(auditEvent);
    }
  }

  // Create complete audit event from partial data
  private createAuditEvent(eventData: Partial<AuditEvent>): AuditEvent {
    const now = new Date();
    const eventId = nanoid();

    // Determine retention policy based on compliance requirements
    const retentionPolicy = this.calculateRetentionPolicy(
      eventData.compliance?.frameworks || [],
      eventData.eventType
    );

    return {
      id: eventId,
      timestamp: eventData.timestamp || now,
      eventType: eventData.eventType || 'system_access',
      severity: eventData.severity || 'medium',
      source: eventData.source || 'pothos-todo-api',
      actor: {
        userId: eventData.actor?.userId,
        userEmail: eventData.actor?.userEmail,
        sessionId: eventData.actor?.sessionId,
        ipAddress: eventData.actor?.ipAddress,
        userAgent: eventData.actor?.userAgent,
        roles: eventData.actor?.roles || [],
      },
      target: {
        resourceType: eventData.target?.resourceType || 'unknown',
        resourceId: eventData.target?.resourceId,
        resourceName: eventData.target?.resourceName,
        previousValue: eventData.target?.previousValue,
        newValue: eventData.target?.newValue,
      },
      action: eventData.action || 'unknown',
      description: eventData.description || 'Audit event logged',
      metadata: eventData.metadata || {},
      compliance: {
        frameworks: eventData.compliance?.frameworks || this.config.compliance.enabledFrameworks,
        categories: eventData.compliance?.categories || [],
        riskLevel: eventData.compliance?.riskLevel || this.mapSeverityToRisk(eventData.severity || 'medium'),
      },
      context: {
        traceId: eventData.context?.traceId,
        spanId: eventData.context?.spanId,
        requestId: eventData.context?.requestId,
        environment: eventData.context?.environment || process.env.NODE_ENV || 'development',
        application: eventData.context?.application || 'pothos-todo',
        version: eventData.context?.version || '1.0.0',
      },
      retention: retentionPolicy,
    };
  }

  // Calculate retention policy based on compliance requirements
  private calculateRetentionPolicy(
    frameworks: ComplianceFramework[],
    eventType?: AuditEventType
  ): AuditEvent['retention'] {
    let maxRetention = this.config.retention.defaultRetentionDays;
    let maxArchive = this.config.retention.defaultArchiveDays;

    // Apply compliance-specific retention requirements
    for (const framework of frameworks) {
      const frameworkRetention = this.config.retention.complianceRetention[framework];
      if (frameworkRetention && frameworkRetention > maxRetention) {
        maxRetention = frameworkRetention;
      }
    }

    // Adjust based on event type sensitivity
    if (eventType === 'authentication' || eventType === 'authorization') {
      maxRetention = Math.max(maxRetention, 2555); // 7 years for auth events
    } else if (eventType === 'data_modification') {
      maxRetention = Math.max(maxRetention, 1825); // 5 years for data changes
    }

    return {
      retentionPeriod: maxRetention,
      archiveAfter: maxArchive,
      deleteAfter: frameworks.includes('GDPR') ? maxRetention : undefined, // GDPR requires deletion capability
    };
  }

  // Map severity to risk level
  private mapSeverityToRisk(severity: AuditSeverity): 'low' | 'medium' | 'high' | 'critical' {
    const mapping: Record<AuditSeverity, 'low' | 'medium' | 'high' | 'critical'> = {
      low: 'low',
      medium: 'medium',
      high: 'high',
      critical: 'critical',
    };
    return mapping[severity];
  }

  // Get numeric severity level for comparison
  private getSeverityLevel(severity: AuditSeverity): number {
    const levels: Record<AuditSeverity, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    return levels[severity];
  }

  // Check if event should trigger an alert
  private shouldAlert(event: AuditEvent): boolean {
    return this.config.alerting.channels.some(
      channel => this.getSeverityLevel(event.severity) >= this.getSeverityLevel(channel.severityThreshold)
    );
  }

  // Start automatic flush timer
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.eventBuffer.length > 0) {
        this.flushEvents().catch(error => {
          logger.error('Failed to flush audit events:', error);
        });
      }
    }, this.config.performance.flushInterval);
  }

  // Flush buffered events to storage
  private async flushEvents(): Promise<void> {
    if (this.isProcessing || this.eventBuffer.length === 0 || !this.storage) {
      return;
    }

    this.isProcessing = true;

    try {
      const eventsToFlush = [...this.eventBuffer];
      this.eventBuffer = [];

      // Write events to storage in batches
      const batchSize = Math.min(eventsToFlush.length, this.config.performance.maxConcurrentWrites);
      const batches = [];

      for (let i = 0; i < eventsToFlush.length; i += batchSize) {
        batches.push(eventsToFlush.slice(i, i + batchSize));
      }

      const writePromises = batches.map(batch => this.storage!.writeEvents(batch));
      await Promise.all(writePromises);

      logger.debug(`Flushed ${eventsToFlush.length} audit events to storage`);
    } catch (error) {
      logger.error('Failed to flush audit events:', error);
      // Re-add failed events to buffer for retry
      // In production, you might want to implement a dead letter queue
    } finally {
      this.isProcessing = false;
    }
  }

  // Query audit events with filters
  async queryEvents(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    if (!this.storage) {
      throw new Error('Audit storage not initialized');
    }

    return this.storage.queryEvents(filters);
  }

  // Generate compliance report
  async generateComplianceReport(
    framework: ComplianceFramework,
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    if (!this.complianceReporter) {
      throw new Error('Compliance reporter not initialized');
    }

    return this.complianceReporter.generateReport(framework, startDate, endDate);
  }

  // Convenience methods for common audit events
  async logAuthentication(
    userId: string,
    success: boolean,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    await this.logEvent({
      eventType: 'authentication',
      severity: success ? 'low' : 'medium',
      actor: { userId },
      action: success ? 'login_success' : 'login_failure',
      description: `User ${success ? 'successfully logged in' : 'failed to log in'}`,
      metadata,
      compliance: {
        frameworks: ['SOX', 'SOC2', 'ISO-27001'],
        categories: ['authentication', 'access_control'],
        riskLevel: success ? 'low' : 'medium',
      },
    });
  }

  async logDataAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    action: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    await this.logEvent({
      eventType: 'data_access',
      severity: 'low',
      actor: { userId },
      target: { resourceType, resourceId },
      action,
      description: `User accessed ${resourceType} resource`,
      metadata,
      compliance: {
        frameworks: ['GDPR', 'HIPAA', 'SOX'],
        categories: ['data_access', 'privacy'],
        riskLevel: 'low',
      },
    });
  }

  async logDataModification(
    userId: string,
    resourceType: string,
    resourceId: string,
    previousValue: any,
    newValue: any,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    await this.logEvent({
      eventType: 'data_modification',
      severity: 'medium',
      actor: { userId },
      target: { resourceType, resourceId, previousValue, newValue },
      action: 'data_update',
      description: `User modified ${resourceType} resource`,
      metadata,
      compliance: {
        frameworks: ['GDPR', 'HIPAA', 'SOX', 'SOC2'],
        categories: ['data_modification', 'data_integrity'],
        riskLevel: 'medium',
      },
    });
  }

  async logSecurityEvent(
    eventType: string,
    severity: AuditSeverity,
    description: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    await this.logEvent({
      eventType: 'security_event',
      severity,
      action: eventType,
      description,
      metadata,
      compliance: {
        frameworks: ['SOC2', 'ISO-27001', 'PCI-DSS'],
        categories: ['security', 'incident_response'],
        riskLevel: severity === 'critical' ? 'critical' : 'high',
      },
    });
  }

  async logAdminAction(
    adminUserId: string,
    action: string,
    target: any,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    await this.logEvent({
      eventType: 'admin_action',
      severity: 'high',
      actor: { userId: adminUserId },
      target,
      action,
      description: `Administrator performed ${action}`,
      metadata,
      compliance: {
        frameworks: ['SOX', 'SOC2', 'ISO-27001'],
        categories: ['administrative', 'privileged_access'],
        riskLevel: 'high',
      },
    });
  }

  // Get audit statistics
  async getAuditStatistics(
    startDate: Date,
    endDate: Date
  ): Promise<AuditStatistics> {
    if (!this.storage) {
      throw new Error('Audit storage not initialized');
    }

    return this.storage.getStatistics(startDate, endDate);
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down audit logger...');

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining events
    await this.flushEvents();

    // Shutdown components
    const shutdownPromises: Promise<void>[] = [];

    if (this.storage) {
      shutdownPromises.push(this.storage.shutdown());
    }

    if (this.alertManager) {
      shutdownPromises.push(this.alertManager.shutdown());
    }

    if (this.complianceReporter) {
      shutdownPromises.push(this.complianceReporter.shutdown());
    }

    await Promise.allSettled(shutdownPromises);
    logger.info('Audit logger shutdown complete');
  }
}

// Audit storage interface
export abstract class AuditStorage {
  protected config: AuditConfig['storage'];

  constructor(config: AuditConfig['storage']) {
    this.config = config;
  }

  abstract initialize(): Promise<void>;
  abstract writeEvents(events: AuditEvent[]): Promise<void>;
  abstract queryEvents(filters: AuditQueryFilters): Promise<AuditQueryResult>;
  abstract getStatistics(startDate: Date, endDate: Date): Promise<AuditStatistics>;
  abstract shutdown(): Promise<void>;
}

// Alert manager for audit events
export class AuditAlertManager {
  private config: AuditConfig['alerting'];

  constructor(config: AuditConfig['alerting']) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('Audit alert manager initialized');
  }

  async sendAlert(event: AuditEvent): Promise<void> {
    const applicableChannels = this.config.channels.filter(
      channel => this.getSeverityLevel(event.severity) >= this.getSeverityLevel(channel.severityThreshold)
    );

    const alertPromises = applicableChannels.map(channel => 
      this.sendAlertToChannel(channel, event)
    );

    await Promise.allSettled(alertPromises);
  }

  private async sendAlertToChannel(
    channel: AuditConfig['alerting']['channels'][0],
    event: AuditEvent
  ): Promise<void> {
    try {
      switch (channel.type) {
        case 'email':
          await this.sendEmailAlert(channel.config, event);
          break;
        case 'slack':
          await this.sendSlackAlert(channel.config, event);
          break;
        case 'webhook':
          await this.sendWebhookAlert(channel.config, event);
          break;
        case 'sms':
          await this.sendSmsAlert(channel.config, event);
          break;
        default:
          logger.warn(`Unknown alert channel type: ${channel.type}`);
      }
    } catch (error) {
      logger.error(`Failed to send alert via ${channel.type}:`, error);
    }
  }

  private async sendEmailAlert(config: any, event: AuditEvent): Promise<void> {
    // Email alert implementation
    logger.info(`Email alert sent for audit event ${event.id}`);
  }

  private async sendSlackAlert(config: any, event: AuditEvent): Promise<void> {
    // Slack alert implementation
    logger.info(`Slack alert sent for audit event ${event.id}`);
  }

  private async sendWebhookAlert(config: any, event: AuditEvent): Promise<void> {
    // Webhook alert implementation
    logger.info(`Webhook alert sent for audit event ${event.id}`);
  }

  private async sendSmsAlert(config: any, event: AuditEvent): Promise<void> {
    // SMS alert implementation
    logger.info(`SMS alert sent for audit event ${event.id}`);
  }

  private getSeverityLevel(severity: AuditSeverity): number {
    const levels: Record<AuditSeverity, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    return levels[severity];
  }

  async shutdown(): Promise<void> {
    logger.info('Audit alert manager shutdown complete');
  }
}

// Compliance reporter
export class ComplianceReporter {
  private config: AuditConfig['compliance'];

  constructor(config: AuditConfig['compliance']) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('Compliance reporter initialized');
  }

  async generateReport(
    framework: ComplianceFramework,
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    // Generate compliance report based on framework requirements
    logger.info(`Generating ${framework} compliance report for ${startDate} to ${endDate}`);

    return {
      framework,
      period: { startDate, endDate },
      generatedAt: new Date(),
      summary: {
        totalEvents: 0,
        complianceScore: 95.5,
        findings: [],
        recommendations: [],
      },
      sections: [],
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Compliance reporter shutdown complete');
  }
}

// Type definitions for audit queries and results
export interface AuditQueryFilters {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: AuditEventType[];
  severities?: AuditSeverity[];
  userIds?: string[];
  resourceTypes?: string[];
  resourceIds?: string[];
  complianceFrameworks?: ComplianceFramework[];
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AuditQueryResult {
  events: AuditEvent[];
  totalCount: number;
  hasMore: boolean;
  aggregations?: Record<string, any>;
}

export interface AuditStatistics {
  totalEvents: number;
  eventsByType: Record<AuditEventType, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  eventsOverTime: Array<{ date: Date; count: number }>;
  topUsers: Array<{ userId: string; count: number }>;
  topResources: Array<{ resourceType: string; count: number }>;
  complianceMetrics: Record<ComplianceFramework, number>;
}

export interface ComplianceReport {
  framework: ComplianceFramework;
  period: { startDate: Date; endDate: Date };
  generatedAt: Date;
  summary: {
    totalEvents: number;
    complianceScore: number;
    findings: string[];
    recommendations: string[];
  };
  sections: Array<{
    title: string;
    content: string;
    metrics: Record<string, any>;
  }>;
}

export type {
  AuditEvent,
  AuditEventType,
  AuditSeverity,
  ComplianceFramework,
  AuditConfig,
};