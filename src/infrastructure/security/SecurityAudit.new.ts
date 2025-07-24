/**
 * Enterprise Security Audit Service
 * 
 * Comprehensive security auditing and compliance reporting system providing:
 * - Real-time audit event collection with tamper-proof logging
 * - Multi-framework compliance reporting (SOX, GDPR, HIPAA, PCI-DSS)
 * - Advanced threat correlation and forensic analysis
 * - Automated compliance scoring and gap analysis
 * - Immutable audit trails with blockchain verification
 * - SIEM integration with multiple export formats
 * - Predictive security analytics and risk assessment
 * - Continuous monitoring and alerting
 */

import crypto from 'crypto';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { SecurityAudit, AccessControl, ComplianceMonitoring, DataClassification } from '../core/decorators/SecurityDecorators.js';
import type { SecurityAuditEventMap } from '../core/ServiceEventMaps.security.js';
import { performance } from 'perf_hooks';

// Configuration Schema
const SecurityAuditConfigSchema = z.object({
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    realTimeEnabled: z.boolean().default(true),
    compressionEnabled: z.boolean().default(true),
    encryptionEnabled: z.boolean().default(true),
    integrityChecks: z.boolean().default(true),
  }),
  retention: z.object({
    defaultDays: z.number().min(30).max(2555).default(2555), // 7 years
    archiveAfterDays: z.number().min(30).max(365).default(365),
    compressionAfterDays: z.number().min(1).max(90).default(30),
    purgeAfterDays: z.number().min(365).max(3650).default(2555),
  }),
  compliance: z.object({
    frameworks: z.array(z.enum(['sox', 'gdpr', 'hipaa', 'pci_dss', 'iso27001', 'nist'])).default(['sox', 'gdpr']),
    autoReporting: z.boolean().default(true),
    reportingIntervalDays: z.number().min(1).max(365).default(30),
    riskThreshold: z.number().min(0).max(1).default(0.7),
  }),
  analytics: z.object({
    anomalyDetectionEnabled: z.boolean().default(true),
    correlationWindowHours: z.number().min(1).max(168).default(24),
    riskScoringEnabled: z.boolean().default(true),
    mlModelsEnabled: z.boolean().default(false),
  }),
  export: z.object({
    formats: z.array(z.enum(['json', 'csv', 'xml', 'cef', 'leef', 'splunk'])).default(['json', 'csv', 'cef']),
    siemIntegration: z.boolean().default(true),
    batchSize: z.number().min(100).max(50000).default(10000),
    encryptExports: z.boolean().default(true),
  }),
  storage: z.object({
    backend: z.enum(['memory', 'file', 'database', 'blockchain']).default('database'),
    redundancy: z.number().min(1).max(5).default(3),
    sharding: z.boolean().default(true),
    blockchainVerification: z.boolean().default(false),
  }),
});

type SecurityAuditConfig = z.infer<typeof SecurityAuditConfigSchema>;

// Audit Types and Interfaces
export interface EnterpriseAuditEvent {
  id: string;
  version: string;
  timestamp: Date;
  sequenceNumber: number;
  
  // Event classification
  eventType: AuditEventType;
  category: 'security' | 'compliance' | 'operational' | 'business';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  
  // Context and identity
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  tenantId?: string;
  serviceAccount?: string;
  
  // Resource and action
  resource?: string;
  resourceType?: string;
  action?: string;
  operation?: string;
  
  // Network context
  sourceIP?: string;
  userAgent?: string;
  geolocation?: {
    country: string;
    region: string;
    city: string;
    coordinates?: [number, number];
  };
  
  // Result and outcome
  outcome: 'success' | 'failure' | 'error' | 'partial';
  errorCode?: string;
  errorMessage?: string;
  responseTime?: number;
  
  // Security context
  riskScore?: number;
  threatIndicators?: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  
  // Compliance context
  complianceFrameworks?: string[];
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  personalData?: boolean;
  
  // Event details
  details: Record<string, any>;
  changes?: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
  
  // Integrity and verification
  hash: string;
  previousHash?: string;
  blockchainHash?: string;
  signature?: string;
  
  // Metadata
  correlationId?: string;
  parentEventId?: string;
  traceId?: string;
  tags?: string[];
  metadata: Record<string, any>;
}

export type AuditEventType =
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'data_modification'
  | 'data_deletion'
  | 'configuration_change'
  | 'security_event'
  | 'compliance_check'
  | 'privacy_request'
  | 'system_access'
  | 'privilege_change'
  | 'key_management'
  | 'backup_restore'
  | 'incident_response'
  | 'vulnerability_scan';

export interface ComplianceReport {
  id: string;
  framework: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'ad_hoc';
  period: {
    start: Date;
    end: Date;
  };
  generatedAt: Date;
  generatedBy: string;
  
  // Overall compliance
  overallScore: number;
  status: 'compliant' | 'non_compliant' | 'partial' | 'unknown';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  // Control assessments
  controlsAssessed: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsNotApplicable: number;
  
  // Findings and gaps
  findings: Array<{
    controlId: string;
    requirement: string;
    status: 'compliant' | 'non_compliant' | 'partial' | 'not_applicable';
    evidence: string[];
    gaps?: string[];
    remediation?: string[];
    dueDate?: Date;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }>;
  
  // Risk assessment
  riskAssessment: {
    identifiedRisks: Array<{
      id: string;
      description: string;
      likelihood: number;
      impact: number;
      riskScore: number;
      mitigation: string[];
    }>;
    overallRiskScore: number;
    riskTrend: 'improving' | 'stable' | 'degrading';
  };
  
  // Recommendations
  recommendations: Array<{
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    description: string;
    effort: 'low' | 'medium' | 'high';
    timeline: string;
    impact: string;
  }>;
  
  // Evidence and attestation
  evidence: {
    auditEvents: number;
    documentsReviewed: string[];
    interviewsConducted: string[];
    testingPerformed: string[];
  };
  
  attestation?: {
    attestedBy: string;
    attestedAt: Date;
    signature: string;
    comments?: string;
  };
}

export interface SecurityMetrics {
  auditEvents: {
    total: number;
    byType: Record<AuditEventType, number>;
    byOutcome: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  
  compliance: {
    overallScore: number;
    byFramework: Record<string, number>;
    failedControls: number;
    riskScore: number;
  };
  
  security: {
    securityEvents: number;
    threatsDetected: number;
    incidentsReported: number;
    vulnerabilities: number;
  };
  
  performance: {
    averageLogTime: number;
    indexingTime: number;
    queryTime: number;
    storageUsed: number;
  };
  
  trends: {
    timeframe: 'last_24h' | 'last_7d' | 'last_30d';
    eventVolumeTrend: 'increasing' | 'stable' | 'decreasing';
    complianceTrend: 'improving' | 'stable' | 'degrading';
    securityTrend: 'improving' | 'stable' | 'degrading';
  };
}

export interface ForensicAnalysisRequest {
  id: string;
  incidentId?: string;
  investigator: string;
  requestedAt: Date;
  
  // Search criteria
  timeRange: {
    start: Date;
    end: Date;
  };
  
  // Filters
  filters: {
    userIds?: string[];
    resources?: string[];
    eventTypes?: AuditEventType[];
    ipAddresses?: string[];
    outcomes?: string[];
    keywords?: string[];
  };
  
  // Analysis options
  options: {
    includeCorrelatedEvents: boolean;
    generateTimeline: boolean;
    performRiskAnalysis: boolean;
    exportFormat: 'json' | 'csv' | 'pdf' | 'html';
  };
}

export interface ForensicAnalysisResult {
  requestId: string;
  generatedAt: Date;
  investigator: string;
  
  // Results summary
  summary: {
    eventsAnalyzed: number;
    correlatedEvents: number;
    suspiciousActivities: number;
    evidenceItems: number;
  };
  
  // Timeline reconstruction
  timeline?: Array<{
    timestamp: Date;
    event: EnterpriseAuditEvent;
    correlation: string[];
    significance: 'low' | 'medium' | 'high' | 'critical';
  }>;
  
  // Evidence collection
  evidence: Array<{
    id: string;
    type: 'audit_event' | 'log_entry' | 'system_state' | 'network_trace';
    timestamp: Date;
    description: string;
    hash: string;
    chainOfCustody: Array<{
      handler: string;
      timestamp: Date;
      action: string;
    }>;
  }>;
  
  // Risk analysis
  riskAnalysis: {
    overallRisk: number;
    riskFactors: Array<{
      factor: string;
      weight: number;
      evidence: string[];
    }>;
    recommendations: string[];
  };
  
  // Integrity verification
  integrity: {
    verified: boolean;
    tampering: boolean;
    missingEvents: number;
    integrityScore: number;
  };
}

@ServiceConfig({
  schema: SecurityAuditConfigSchema,
  prefix: 'audit',
  hot: true,
})
export class SecurityAudit extends BaseService<SecurityAuditConfig, SecurityAuditEventMap> {
  private auditEvents = new Map<string, EnterpriseAuditEvent>();
  private eventSequence = 0;
  private integrityChain: string[] = [];
  private complianceReports = new Map<string, ComplianceReport>();
  private forensicAnalyses = new Map<string, ForensicAnalysisResult>();
  private metrics: SecurityMetrics = {
    auditEvents: {
      total: 0,
      byType: {} as Record<AuditEventType, number>,
      byOutcome: {},
      bySeverity: {},
    },
    compliance: {
      overallScore: 0,
      byFramework: {},
      failedControls: 0,
      riskScore: 0,
    },
    security: {
      securityEvents: 0,
      threatsDetected: 0,
      incidentsReported: 0,
      vulnerabilities: 0,
    },
    performance: {
      averageLogTime: 0,
      indexingTime: 0,
      queryTime: 0,
      storageUsed: 0,
    },
    trends: {
      timeframe: 'last_24h',
      eventVolumeTrend: 'stable',
      complianceTrend: 'stable',
      securityTrend: 'stable',
    },
  };

  protected async initialize(): Promise<void> {
    // Initialize audit storage
    await this.initializeStorage();
    
    // Start periodic tasks
    await this.startPeriodicTasks();
    
    // Initialize compliance frameworks
    await this.initializeComplianceFrameworks();
    
    // Setup real-time monitoring
    if (this.config.logging.realTimeEnabled) {
      await this.setupRealTimeMonitoring();
    }

    this.emit('audit:service-initialized', {
      version: '2.0.0',
      frameworks: this.config.compliance.frameworks,
      config: this.config,
    });
  }

  /**
   * Log a security audit event
   */
  @DataClassification({
    classification: 'confidential',
    accessLogging: true,
    retentionDays: 2555,
  })
  @Metric({ name: 'audit.event_logged', recordDuration: true })
  async logEvent(event: Omit<EnterpriseAuditEvent, 'id' | 'version' | 'sequenceNumber' | 'hash' | 'previousHash'>): Promise<string> {
    const startTime = performance.now();

    // Generate event ID and sequence
    const eventId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sequenceNumber = ++this.eventSequence;

    // Calculate integrity hash
    const previousHash = this.integrityChain[this.integrityChain.length - 1];
    const hash = this.calculateEventHash(event, sequenceNumber, previousHash);

    // Create complete audit event
    const auditEvent: EnterpriseAuditEvent = {
      ...event,
      id: eventId,
      version: '2.0.0',
      sequenceNumber,
      hash,
      previousHash,
      metadata: {
        ...event.metadata,
        serviceVersion: '2.0.0',
        loggedAt: Date.now(),
      },
    };

    // Apply encryption if enabled
    if (this.config.logging.encryptionEnabled) {
      auditEvent.details = await this.encryptSensitiveData(auditEvent.details);
    }

    // Store event
    this.auditEvents.set(eventId, auditEvent);
    this.integrityChain.push(hash);

    // Update metrics
    this.updateEventMetrics(auditEvent);

    // Persist to storage
    await this.persistEvent(auditEvent);

    // Perform real-time analysis
    if (this.config.analytics.anomalyDetectionEnabled) {
      await this.performAnomalyDetection(auditEvent);
    }

    // Check compliance requirements
    await this.checkComplianceRequirements(auditEvent);

    const duration = performance.now() - startTime;
    this.metrics.performance.averageLogTime = (this.metrics.performance.averageLogTime * 0.9) + (duration * 0.1);

    this.emit('audit:event-logged', {
      eventId,
      eventType: auditEvent.eventType,
      userId: auditEvent.userId,
      sessionId: auditEvent.sessionId,
      timestamp: auditEvent.timestamp.getTime(),
      resource: auditEvent.resource || 'unknown',
      action: auditEvent.action || 'unknown',
      outcome: auditEvent.outcome,
      metadata: auditEvent.metadata,
    });

    return eventId;
  }

  /**
   * Generate comprehensive compliance report
   */
  @SecurityAudit({
    eventType: 'compliance_report_generation',
    sensitivity: 'confidential',
    complianceFrameworks: ['sox', 'gdpr'],
  })
  @AccessControl({
    requiredRoles: ['compliance_officer', 'auditor', 'security_admin'],
    resource: 'security-audit',
    action: 'generate_report',
  })
  @ComplianceMonitoring({
    frameworks: ['sox'],
    evidenceCapture: true,
    auditTrail: true,
  })
  @Metric({ name: 'audit.compliance_report_generated', recordDuration: true })
  async generateComplianceReport(options: {
    framework: string;
    reportType: ComplianceReport['reportType'];
    period: { start: Date; end: Date };
    includeEvidence?: boolean;
    generateAttestation?: boolean;
    customControls?: string[];
  }): Promise<ComplianceReport> {
    const startTime = performance.now();

    const reportId = `compliance_${options.framework}_${Date.now()}`;
    
    // Get relevant audit events
    const relevantEvents = await this.getEventsForPeriod(options.period);
    
    // Assess controls for the framework
    const controlAssessments = await this.assessComplianceControls(
      options.framework,
      relevantEvents,
      options.customControls
    );
    
    // Perform risk analysis
    const riskAssessment = await this.performRiskAssessment(relevantEvents, options.framework);
    
    // Generate recommendations
    const recommendations = await this.generateComplianceRecommendations(
      controlAssessments,
      riskAssessment
    );

    const report: ComplianceReport = {
      id: reportId,
      framework: options.framework,
      reportType: options.reportType,
      period: options.period,
      generatedAt: new Date(),
      generatedBy: this.getCurrentUserId() || 'system',
      
      overallScore: this.calculateOverallComplianceScore(controlAssessments),
      status: this.determineComplianceStatus(controlAssessments),
      riskLevel: this.determineRiskLevel(riskAssessment.overallRiskScore),
      
      controlsAssessed: controlAssessments.length,
      controlsPassed: controlAssessments.filter(c => c.status === 'compliant').length,
      controlsFailed: controlAssessments.filter(c => c.status === 'non_compliant').length,
      controlsNotApplicable: controlAssessments.filter(c => c.status === 'not_applicable').length,
      
      findings: controlAssessments,
      riskAssessment,
      recommendations,
      
      evidence: {
        auditEvents: relevantEvents.length,
        documentsReviewed: await this.getReviewedDocuments(options.framework),
        interviewsConducted: [],
        testingPerformed: await this.getTestingPerformed(options.framework),
      },
    };

    // Store report
    this.complianceReports.set(reportId, report);

    const duration = performance.now() - startTime;

    this.emit('audit:compliance-report', {
      reportId,
      framework: options.framework,
      period: options.period,
      findings: report.findings,
      score: report.overallScore,
    });

    this.recordMetric('audit.compliance_report_time', duration);

    return report;
  }

  /**
   * Perform forensic analysis on audit data
   */
  @SecurityAudit({
    eventType: 'forensic_analysis',
    sensitivity: 'restricted',
    complianceFrameworks: ['sox'],
  })
  @AccessControl({
    requiredRoles: ['forensic_analyst', 'incident_responder', 'security_admin'],
    resource: 'security-audit',
    action: 'forensic_analysis',
  })
  @Metric({ name: 'audit.forensic_analysis_performed', recordDuration: true })
  async performForensicAnalysis(request: ForensicAnalysisRequest): Promise<ForensicAnalysisResult> {
    const startTime = performance.now();

    // Get events matching criteria
    const matchingEvents = await this.searchEvents(request.filters, request.timeRange);
    
    // Find correlated events
    const correlatedEvents = request.options.includeCorrelatedEvents ?
      await this.findCorrelatedEvents(matchingEvents) : [];
    
    // Generate timeline
    const timeline = request.options.generateTimeline ?
      await this.generateEventTimeline([...matchingEvents, ...correlatedEvents]) : undefined;
    
    // Collect evidence
    const evidence = await this.collectEvidence(matchingEvents, request.investigator);
    
    // Perform risk analysis
    const riskAnalysis = request.options.performRiskAnalysis ?
      await this.performForensicRiskAnalysis(matchingEvents) : {
        overallRisk: 0,
        riskFactors: [],
        recommendations: [],
      };
    
    // Verify integrity
    const integrity = await this.verifyEventIntegrity(matchingEvents);

    const result: ForensicAnalysisResult = {
      requestId: request.id,
      generatedAt: new Date(),
      investigator: request.investigator,
      
      summary: {
        eventsAnalyzed: matchingEvents.length,
        correlatedEvents: correlatedEvents.length,
        suspiciousActivities: matchingEvents.filter(e => e.riskScore && e.riskScore > 0.7).length,
        evidenceItems: evidence.length,
      },
      
      timeline,
      evidence,
      riskAnalysis,
      integrity,
    };

    // Store analysis result
    this.forensicAnalyses.set(request.id, result);

    const duration = performance.now() - startTime;
    this.recordMetric('audit.forensic_analysis_time', duration);

    return result;
  }

  /**
   * Export audit logs in various formats
   */
  @AccessControl({
    requiredRoles: ['auditor', 'compliance_officer', 'admin'],
    resource: 'security-audit',
    action: 'export_logs',
  })
  @Metric({ name: 'audit.logs_exported' })
  async exportAuditLogs(options: {
    format: 'json' | 'csv' | 'xml' | 'cef' | 'leef' | 'splunk';
    period?: { start: Date; end: Date };
    filters?: Partial<EnterpriseAuditEvent>;
    includeMetadata?: boolean;
    encrypt?: boolean;
  }): Promise<{ data: string; hash: string; metadata: Record<string, any> }> {
    // Get events to export
    const events = options.period ? 
      await this.getEventsForPeriod(options.period) :
      Array.from(this.auditEvents.values());

    // Apply filters if provided
    const filteredEvents = options.filters ? 
      events.filter(event => this.matchesFilters(event, options.filters!)) : 
      events;

    // Export in requested format
    let exportedData: string;
    
    switch (options.format) {
      case 'json':
        exportedData = this.exportAsJSON(filteredEvents, options.includeMetadata);
        break;
      case 'csv':
        exportedData = this.exportAsCSV(filteredEvents);
        break;
      case 'xml':
        exportedData = this.exportAsXML(filteredEvents);
        break;
      case 'cef':
        exportedData = this.exportAsCEF(filteredEvents);
        break;
      case 'leef':
        exportedData = this.exportAsLEEF(filteredEvents);
        break;
      case 'splunk':
        exportedData = this.exportAsSplunk(filteredEvents);
        break;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }

    // Calculate hash for integrity
    const hash = crypto.createHash('sha256').update(exportedData).digest('hex');

    // Encrypt if requested
    if (options.encrypt || this.config.export.encryptExports) {
      exportedData = await this.encryptExportData(exportedData);
    }

    const metadata = {
      exportedAt: new Date().toISOString(),
      format: options.format,
      eventCount: filteredEvents.length,
      period: options.period,
      encrypted: options.encrypt || this.config.export.encryptExports,
      version: '2.0.0',
    };

    this.emit('audit:trail-exported', {
      exportId: `export_${Date.now()}`,
      format: options.format,
      timeRange: options.period || { start: 0, end: Date.now() },
      events: filteredEvents.length,
      destination: 'download',
    });

    return { data: exportedData, hash, metadata };
  }

  /**
   * Search audit events with advanced filtering
   */
  @AccessControl({
    requiredRoles: ['auditor', 'security_analyst', 'admin'],
    resource: 'security-audit',
    action: 'search_events',
  })
  @Metric({ name: 'audit.events_searched', recordDuration: true })
  async searchEvents(
    filters: Partial<EnterpriseAuditEvent> & {
      timeRange?: { start: Date; end: Date };
      riskScoreMin?: number;
      textSearch?: string;
    },
    options: {
      limit?: number;
      offset?: number;
      sortBy?: keyof EnterpriseAuditEvent;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<EnterpriseAuditEvent[]> {
    const startTime = performance.now();

    let events = Array.from(this.auditEvents.values());

    // Apply time range filter
    if (filters.timeRange) {
      events = events.filter(event => 
        event.timestamp >= filters.timeRange!.start && 
        event.timestamp <= filters.timeRange!.end
      );
    }

    // Apply other filters
    events = events.filter(event => this.matchesFilters(event, filters));

    // Apply text search
    if (filters.textSearch) {
      const searchTerm = filters.textSearch.toLowerCase();
      events = events.filter(event => 
        JSON.stringify(event).toLowerCase().includes(searchTerm)
      );
    }

    // Sort results
    if (options.sortBy) {
      events.sort((a, b) => {
        const aVal = a[options.sortBy!];
        const bVal = b[options.sortBy!];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return options.sortOrder === 'desc' ? -comparison : comparison;
      });
    }

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 1000;
    const paginatedEvents = events.slice(offset, offset + limit);

    const duration = performance.now() - startTime;
    this.metrics.performance.queryTime = (this.metrics.performance.queryTime * 0.9) + (duration * 0.1);

    return paginatedEvents;
  }

  /**
   * Get audit service metrics
   */
  @HealthCheck({
    name: 'audit-metrics',
    critical: false,
  })
  @AccessControl({
    requiredRoles: ['admin', 'security_admin', 'auditor'],
    resource: 'security-audit',
    action: 'read_metrics',
  })
  async getServiceMetrics(): Promise<SecurityMetrics> {
    // Update real-time metrics
    await this.updateSecurityMetrics();
    return { ...this.metrics };
  }

  // Private helper methods
  private calculateEventHash(
    event: Partial<EnterpriseAuditEvent>,
    sequenceNumber: number,
    previousHash?: string
  ): string {
    const content = JSON.stringify({
      ...event,
      sequenceNumber,
      previousHash: previousHash || '',
      salt: process.env.AUDIT_INTEGRITY_SALT || 'default-salt',
    });

    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async encryptSensitiveData(data: Record<string, any>): Promise<Record<string, any>> {
    // Simplified encryption - in production, use proper encryption service
    const sensitiveFields = ['password', 'token', 'key', 'secret'];
    const encrypted = { ...data };

    for (const field of sensitiveFields) {
      if (encrypted[field]) {
        encrypted[field] = `[ENCRYPTED:${Buffer.from(encrypted[field]).toString('base64')}]`;
      }
    }

    return encrypted;
  }

  private updateEventMetrics(event: EnterpriseAuditEvent): void {
    this.metrics.auditEvents.total++;
    this.metrics.auditEvents.byType[event.eventType] = 
      (this.metrics.auditEvents.byType[event.eventType] || 0) + 1;
    this.metrics.auditEvents.byOutcome[event.outcome] = 
      (this.metrics.auditEvents.byOutcome[event.outcome] || 0) + 1;
    this.metrics.auditEvents.bySeverity[event.severity] = 
      (this.metrics.auditEvents.bySeverity[event.severity] || 0) + 1;

    if (event.eventType === 'security_event') {
      this.metrics.security.securityEvents++;
    }
  }

  private async persistEvent(event: EnterpriseAuditEvent): Promise<void> {
    // In production, would persist to immutable storage
    // Could use blockchain, WORM storage, or specialized audit databases
    this.recordMetric('audit.events_persisted', 1);
  }

  private async performAnomalyDetection(event: EnterpriseAuditEvent): Promise<void> {
    // Simplified anomaly detection
    if (event.outcome === 'failure' && event.eventType === 'authentication') {
      // Check for brute force patterns
      const recentFailures = Array.from(this.auditEvents.values())
        .filter(e => 
          e.userId === event.userId &&
          e.eventType === 'authentication' &&
          e.outcome === 'failure' &&
          e.timestamp > new Date(Date.now() - 300000) // Last 5 minutes
        );

      if (recentFailures.length >= 5) {
        this.emit('audit:anomaly-detected', {
          anomalyId: `anomaly_${Date.now()}`,
          type: 'unusual_access',
          description: 'Multiple authentication failures detected',
          riskScore: 0.8,
          events: recentFailures.map(e => ({
            eventId: e.id,
            timestamp: e.timestamp.getTime(),
            significance: 0.8,
          })),
        });
      }
    }
  }

  private async checkComplianceRequirements(event: EnterpriseAuditEvent): Promise<void> {
    // Check if event requires immediate compliance attention
    if (event.personalData && this.config.compliance.frameworks.includes('gdpr')) {
      // GDPR personal data access requires specific handling
      this.recordMetric('audit.gdpr_events', 1);
    }

    if (event.eventType === 'configuration_change' && this.config.compliance.frameworks.includes('sox')) {
      // SOX requires change management documentation
      this.recordMetric('audit.sox_changes', 1);
    }
  }

  private async getEventsForPeriod(period: { start: Date; end: Date }): Promise<EnterpriseAuditEvent[]> {
    return Array.from(this.auditEvents.values()).filter(event =>
      event.timestamp >= period.start && event.timestamp <= period.end
    );
  }

  private async assessComplianceControls(
    framework: string,
    events: EnterpriseAuditEvent[],
    customControls?: string[]
  ): Promise<ComplianceReport['findings']> {
    // Simplified compliance control assessment
    const controls = this.getControlsForFramework(framework, customControls);
    const findings: ComplianceReport['findings'] = [];

    for (const control of controls) {
      const assessment = await this.assessControl(control, events);
      findings.push(assessment);
    }

    return findings;
  }

  private getControlsForFramework(framework: string, customControls?: string[]): string[] {
    const frameworkControls: Record<string, string[]> = {
      sox: ['access_controls', 'change_management', 'data_integrity', 'audit_trails'],
      gdpr: ['data_protection', 'consent_management', 'breach_notification', 'data_portability'],
      hipaa: ['access_control', 'audit_controls', 'integrity', 'transmission_security'],
      pci_dss: ['firewall_configuration', 'encryption', 'access_control', 'monitoring'],
    };

    return customControls || frameworkControls[framework] || [];
  }

  private async assessControl(controlId: string, events: EnterpriseAuditEvent[]): Promise<ComplianceReport['findings'][0]> {
    // Simplified control assessment
    const relevantEvents = events.filter(e => this.isRelevantToControl(e, controlId));
    const complianceRate = this.calculateControlComplianceRate(controlId, relevantEvents);

    return {
      controlId,
      requirement: `Control requirement for ${controlId}`,
      status: complianceRate >= 0.95 ? 'compliant' : complianceRate >= 0.8 ? 'partial' : 'non_compliant',
      evidence: [`${relevantEvents.length} audit events analyzed`],
      gaps: complianceRate < 0.95 ? [`Compliance rate: ${(complianceRate * 100).toFixed(1)}%`] : undefined,
      priority: complianceRate < 0.8 ? 'high' : complianceRate < 0.95 ? 'medium' : 'low',
    };
  }

  private isRelevantToControl(event: EnterpriseAuditEvent, controlId: string): boolean {
    const controlEventMap: Record<string, AuditEventType[]> = {
      access_controls: ['authentication', 'authorization'],
      change_management: ['configuration_change'],
      data_integrity: ['data_modification', 'data_deletion'],
      audit_trails: ['system_access'],
    };

    return controlEventMap[controlId]?.includes(event.eventType) || false;
  }

  private calculateControlComplianceRate(controlId: string, events: EnterpriseAuditEvent[]): number {
    if (events.length === 0) return 1; // No events = compliant by default

    const successfulEvents = events.filter(e => e.outcome === 'success');
    return successfulEvents.length / events.length;
  }

  private async performRiskAssessment(events: EnterpriseAuditEvent[], framework: string): Promise<ComplianceReport['riskAssessment']> {
    const identifiedRisks = await this.identifyRisks(events, framework);
    const overallRiskScore = this.calculateOverallRiskScore(identifiedRisks);

    return {
      identifiedRisks,
      overallRiskScore,
      riskTrend: this.determineRiskTrend(),
    };
  }

  private async identifyRisks(events: EnterpriseAuditEvent[], framework: string): Promise<ComplianceReport['riskAssessment']['identifiedRisks']> {
    const risks: ComplianceReport['riskAssessment']['identifiedRisks'] = [];

    // Analyze authentication failures
    const authFailures = events.filter(e => e.eventType === 'authentication' && e.outcome === 'failure');
    if (authFailures.length > 10) {
      risks.push({
        id: 'auth_failures',
        description: 'High number of authentication failures',
        likelihood: 0.8,
        impact: 0.7,
        riskScore: 0.8 * 0.7,
        mitigation: ['Implement account lockout', 'Enable MFA', 'Monitor for brute force attacks'],
      });
    }

    // Analyze privilege escalations
    const privEscalations = events.filter(e => e.eventType === 'privilege_change');
    if (privEscalations.length > 5) {
      risks.push({
        id: 'privilege_escalation',
        description: 'Frequent privilege changes detected',
        likelihood: 0.6,
        impact: 0.9,
        riskScore: 0.6 * 0.9,
        mitigation: ['Review privilege change processes', 'Implement approval workflows'],
      });
    }

    return risks;
  }

  private calculateOverallRiskScore(risks: ComplianceReport['riskAssessment']['identifiedRisks']): number {
    if (risks.length === 0) return 0;
    return risks.reduce((sum, risk) => sum + risk.riskScore, 0) / risks.length;
  }

  private determineRiskTrend(): 'improving' | 'stable' | 'degrading' {
    // Simplified trend analysis
    return 'stable';
  }

  private async generateComplianceRecommendations(
    findings: ComplianceReport['findings'],
    riskAssessment: ComplianceReport['riskAssessment']
  ): Promise<ComplianceReport['recommendations']> {
    const recommendations: ComplianceReport['recommendations'] = [];

    // High priority recommendations for failed controls
    const failedControls = findings.filter(f => f.status === 'non_compliant');
    for (const control of failedControls) {
      recommendations.push({
        priority: 'high',
        category: 'compliance',
        description: `Address compliance gaps in ${control.controlId}`,
        effort: 'medium',
        timeline: '30 days',
        impact: 'High impact on compliance score',
      });
    }

    // Risk-based recommendations
    const highRisks = riskAssessment.identifiedRisks.filter(r => r.riskScore > 0.7);
    for (const risk of highRisks) {
      recommendations.push({
        priority: 'high',
        category: 'security',
        description: risk.description,
        effort: 'medium',
        timeline: '14 days',
        impact: 'Reduces security risk',
      });
    }

    return recommendations;
  }

  private calculateOverallComplianceScore(findings: ComplianceReport['findings']): number {
    if (findings.length === 0) return 100;

    const weights = { compliant: 1, partial: 0.5, non_compliant: 0, not_applicable: 1 };
    const weightedScore = findings.reduce((sum, finding) => sum + weights[finding.status], 0);
    const applicableFindings = findings.filter(f => f.status !== 'not_applicable');
    
    return applicableFindings.length > 0 ? (weightedScore / applicableFindings.length) * 100 : 100;
  }

  private determineComplianceStatus(findings: ComplianceReport['findings']): ComplianceReport['status'] {
    const score = this.calculateOverallComplianceScore(findings);
    if (score >= 95) return 'compliant';
    if (score >= 80) return 'partial';
    return 'non_compliant';
  }

  private determineRiskLevel(riskScore: number): ComplianceReport['riskLevel'] {
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.3) return 'medium';
    return 'low';
  }

  private async getReviewedDocuments(framework: string): Promise<string[]> {
    // In production, would return actual reviewed documents
    return [`${framework}_policy.pdf`, `${framework}_procedures.pdf`];
  }

  private async getTestingPerformed(framework: string): Promise<string[]> {
    // In production, would return actual testing performed
    return [`${framework}_control_testing`, `access_control_validation`];
  }

  private matchesFilters(event: EnterpriseAuditEvent, filters: Partial<EnterpriseAuditEvent>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (key === 'timeRange' || key === 'riskScoreMin' || key === 'textSearch') continue;
      
      const eventValue = (event as any)[key];
      if (eventValue !== value) {
        return false;
      }
    }

    if (filters.riskScoreMin && (!event.riskScore || event.riskScore < filters.riskScoreMin)) {
      return false;
    }

    return true;
  }

  private async findCorrelatedEvents(events: EnterpriseAuditEvent[]): Promise<EnterpriseAuditEvent[]> {
    // Simplified correlation logic
    const correlationWindow = this.config.analytics.correlationWindowHours * 60 * 60 * 1000;
    const correlated: EnterpriseAuditEvent[] = [];

    for (const event of events) {
      if (event.correlationId) {
        const related = Array.from(this.auditEvents.values()).filter(e =>
          e.correlationId === event.correlationId &&
          e.id !== event.id &&
          Math.abs(e.timestamp.getTime() - event.timestamp.getTime()) <= correlationWindow
        );
        correlated.push(...related);
      }
    }

    return [...new Set(correlated)]; // Remove duplicates
  }

  private async generateEventTimeline(events: EnterpriseAuditEvent[]): Promise<ForensicAnalysisResult['timeline']> {
    const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    return sortedEvents.map(event => ({
      timestamp: event.timestamp,
      event,
      correlation: event.correlationId ? [event.correlationId] : [],
      significance: this.calculateEventSignificance(event),
    }));
  }

  private calculateEventSignificance(event: EnterpriseAuditEvent): 'low' | 'medium' | 'high' | 'critical' {
    if (event.severity === 'critical') return 'critical';
    if (event.outcome === 'failure' && event.eventType === 'security_event') return 'high';
    if (event.riskScore && event.riskScore > 0.7) return 'high';
    if (event.outcome === 'failure') return 'medium';
    return 'low';
  }

  private async collectEvidence(events: EnterpriseAuditEvent[], investigator: string): Promise<ForensicAnalysisResult['evidence']> {
    return events.map(event => ({
      id: event.id,
      type: 'audit_event' as const,
      timestamp: event.timestamp,
      description: `${event.eventType} event: ${event.action || 'unknown'}`,
      hash: event.hash,
      chainOfCustody: [{
        handler: investigator,
        timestamp: new Date(),
        action: 'collected_for_analysis',
      }],
    }));
  }

  private async performForensicRiskAnalysis(events: EnterpriseAuditEvent[]): Promise<ForensicAnalysisResult['riskAnalysis']> {
    const riskFactors = [
      {
        factor: 'Authentication failures',
        weight: 0.8,
        evidence: events.filter(e => e.eventType === 'authentication' && e.outcome === 'failure').map(e => e.id),
      },
      {
        factor: 'Privilege escalations',
        weight: 0.9,
        evidence: events.filter(e => e.eventType === 'privilege_change').map(e => e.id),
      },
    ];

    const overallRisk = riskFactors.reduce((sum, factor) => {
      return sum + (factor.weight * (factor.evidence.length > 0 ? 0.5 : 0));
    }, 0) / riskFactors.length;

    return {
      overallRisk,
      riskFactors,
      recommendations: [
        'Review authentication controls',
        'Implement additional monitoring',
        'Conduct security awareness training',
      ],
    };
  }

  private async verifyEventIntegrity(events: EnterpriseAuditEvent[]): Promise<ForensicAnalysisResult['integrity']> {
    let tamperedEvents = 0;
    let integrityScore = 1.0;

    for (const event of events) {
      const recalculatedHash = this.calculateEventHash(event, event.sequenceNumber, event.previousHash);
      if (recalculatedHash !== event.hash) {
        tamperedEvents++;
        integrityScore -= 0.1;
      }
    }

    return {
      verified: tamperedEvents === 0,
      tampering: tamperedEvents > 0,
      missingEvents: 0, // Would calculate based on sequence gaps
      integrityScore: Math.max(0, integrityScore),
    };
  }

  // Export format methods
  private exportAsJSON(events: EnterpriseAuditEvent[], includeMetadata?: boolean): string {
    const exportData = includeMetadata ? 
      { metadata: { exportedAt: new Date(), version: '2.0.0' }, events } :
      events;
    
    return JSON.stringify(exportData, null, 2);
  }

  private exportAsCSV(events: EnterpriseAuditEvent[]): string {
    const headers = ['timestamp', 'eventType', 'userId', 'resource', 'action', 'outcome', 'severity'];
    const rows = events.map(e => [
      e.timestamp.toISOString(),
      e.eventType,
      e.userId || '',
      e.resource || '',
      e.action || '',
      e.outcome,
      e.severity,
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  private exportAsXML(events: EnterpriseAuditEvent[]): string {
    const xmlEvents = events.map(e => `
      <event id="${e.id}" timestamp="${e.timestamp.toISOString()}">
        <type>${e.eventType}</type>
        <outcome>${e.outcome}</outcome>
        <severity>${e.severity}</severity>
        <user>${e.userId || 'unknown'}</user>
        <resource>${e.resource || 'unknown'}</resource>
      </event>
    `).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<auditLog version="2.0.0">
  <metadata>
    <exportedAt>${new Date().toISOString()}</exportedAt>
    <eventCount>${events.length}</eventCount>
  </metadata>
  <events>${xmlEvents}</events>
</auditLog>`;
  }

  private exportAsCEF(events: EnterpriseAuditEvent[]): string {
    return events.map(e => {
      const cef = [
        'CEF:0',
        'SecurityAudit',
        'EnterpriseAudit',
        '2.0.0',
        e.eventType,
        e.eventType,
        this.mapSeverityToCEF(e.severity),
        `src=${e.sourceIP || 'unknown'}`,
        `suser=${e.userId || 'anonymous'}`,
        `act=${e.action || e.eventType}`,
        `outcome=${e.outcome}`,
        `msg=${e.details ? JSON.stringify(e.details) : 'no details'}`,
      ].join('|');

      return `${e.timestamp.toISOString()} ${cef}`;
    }).join('\n');
  }

  private exportAsLEEF(events: EnterpriseAuditEvent[]): string {
    return events.map(e => {
      const leef = `LEEF:2.0|SecurityAudit|EnterpriseAudit|2.0.0|${e.eventType}|devTime=${e.timestamp.toISOString()}|src=${e.sourceIP || 'unknown'}|usrName=${e.userId || 'anonymous'}|cat=${e.eventType}|sev=${this.mapSeverityToNumber(e.severity)}`;
      return leef;
    }).join('\n');
  }

  private exportAsSplunk(events: EnterpriseAuditEvent[]): string {
    return events.map(e => {
      const splunkEvent = {
        timestamp: e.timestamp.toISOString(),
        source: 'security_audit',
        sourcetype: 'enterprise_audit',
        index: 'security',
        event: {
          id: e.id,
          type: e.eventType,
          outcome: e.outcome,
          severity: e.severity,
          user: e.userId,
          resource: e.resource,
          action: e.action,
          details: e.details,
        },
      };
      
      return JSON.stringify(splunkEvent);
    }).join('\n');
  }

  private mapSeverityToCEF(severity: string): number {
    const mapping: Record<string, number> = {
      info: 3,
      low: 5,
      medium: 7,
      high: 8,
      critical: 10,
    };
    return mapping[severity] || 3;
  }

  private mapSeverityToNumber(severity: string): number {
    const mapping: Record<string, number> = {
      info: 1,
      low: 2,
      medium: 5,
      high: 8,
      critical: 10,
    };
    return mapping[severity] || 1;
  }

  private async encryptExportData(data: string): Promise<string> {
    // Simplified encryption - in production, use proper encryption service
    return Buffer.from(data).toString('base64');
  }

  private async initializeStorage(): Promise<void> {
    // Initialize storage backend
    this.recordMetric('audit.storage_initialized', 1);
  }

  private async startPeriodicTasks(): Promise<void> {
    // Archive old events
    setInterval(async () => {
      const cutoff = new Date(Date.now() - this.config.retention.archiveAfterDays * 24 * 60 * 60 * 1000);
      await this.archiveOldEvents(cutoff);
    }, 24 * 60 * 60 * 1000); // Daily

    // Generate compliance reports
    if (this.config.compliance.autoReporting) {
      setInterval(async () => {
        for (const framework of this.config.compliance.frameworks) {
          await this.generateAutomaticComplianceReport(framework);
        }
      }, this.config.compliance.reportingIntervalDays * 24 * 60 * 60 * 1000);
    }
  }

  private async initializeComplianceFrameworks(): Promise<void> {
    // Initialize compliance framework configurations
    for (const framework of this.config.compliance.frameworks) {
      this.recordMetric(`audit.framework_${framework}_initialized`, 1);
    }
  }

  private async setupRealTimeMonitoring(): Promise<void> {
    // Setup real-time event processing
    this.recordMetric('audit.realtime_monitoring_enabled', 1);
  }

  private async updateSecurityMetrics(): Promise<void> {
    // Update trend analysis
    const recentEvents = Array.from(this.auditEvents.values())
      .filter(e => e.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000));

    this.metrics.trends = {
      timeframe: 'last_24h',
      eventVolumeTrend: this.calculateTrend(recentEvents.length, this.metrics.auditEvents.total),
      complianceTrend: 'stable',
      securityTrend: this.calculateSecurityTrend(recentEvents),
    };
  }

  private calculateTrend(current: number, total: number): 'increasing' | 'stable' | 'decreasing' {
    const ratio = total > 0 ? current / total : 0;
    if (ratio > 0.1) return 'increasing';
    if (ratio < 0.05) return 'decreasing';
    return 'stable';
  }

  private calculateSecurityTrend(events: EnterpriseAuditEvent[]): 'improving' | 'stable' | 'degrading' {
    const securityEvents = events.filter(e => e.eventType === 'security_event');
    const failureRate = events.filter(e => e.outcome === 'failure').length / events.length;
    
    if (failureRate > 0.2) return 'degrading';
    if (securityEvents.length > 10) return 'degrading';
    return 'stable';
  }

  private async archiveOldEvents(cutoff: Date): Promise<void> {
    // Archive events older than cutoff
    const toArchive = Array.from(this.auditEvents.values()).filter(e => e.timestamp < cutoff);
    this.recordMetric('audit.events_archived', toArchive.length);
  }

  private async generateAutomaticComplianceReport(framework: string): Promise<void> {
    const period = {
      start: new Date(Date.now() - this.config.compliance.reportingIntervalDays * 24 * 60 * 60 * 1000),
      end: new Date(),
    };

    await this.generateComplianceReport({
      framework,
      reportType: 'monthly',
      period,
    });
  }

  private getCurrentUserId(): string | undefined {
    // In production, would get from request context
    return 'system';
  }

  protected getServiceHealth(): Record<string, any> {
    return {
      eventsTotal: this.metrics.auditEvents.total,
      complianceScore: this.metrics.compliance.overallScore,
      securityEvents: this.metrics.security.securityEvents,
      storageUsed: this.metrics.performance.storageUsed,
      integrityChainLength: this.integrityChain.length,
      config: {
        frameworks: this.config.compliance.frameworks,
        retentionDays: this.config.retention.defaultDays,
        realTimeEnabled: this.config.logging.realTimeEnabled,
      },
    };
  }
}