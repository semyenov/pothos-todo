import { logger } from '@/logger';
import { BackupManager } from './BackupManager.js';
import { DisasterRecoveryOrchestrator } from './DisasterRecoveryOrchestrator.js';
import { MetricsCollector } from '../observability/MetricsCollector.js';
import { DistributedTracing } from '../observability/DistributedTracing.js';
import EventEmitter from 'events';

export interface ComplianceFramework {
  name: string;
  version: string;
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    category: 'backup' | 'recovery' | 'testing' | 'documentation' | 'monitoring';
    criticality: 'must' | 'should' | 'may';
    controls: Array<{
      id: string;
      description: string;
      implemented: boolean;
      evidence: string[];
    }>;
  }>;
}

export interface BusinessImpactAnalysis {
  process: string;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  rto: number; // minutes
  rpo: number; // minutes
  dependencies: string[];
  impactScenarios: Array<{
    duration: number; // hours
    financialImpact: number; // dollars
    reputationalRisk: 'high' | 'medium' | 'low';
    regulatoryRisk: 'high' | 'medium' | 'low';
  }>;
  recoveryStrategies: Array<{
    strategy: string;
    cost: number;
    effectiveness: number; // 0-100
    complexity: 'low' | 'medium' | 'high';
  }>;
}

export interface ContinuityPlan {
  id: string;
  name: string;
  version: string;
  lastUpdated: Date;
  nextReview: Date;
  owner: string;
  approver: string;
  scope: string[];
  objectives: Array<{
    metric: string;
    target: number;
    current?: number;
    status: 'met' | 'at_risk' | 'not_met';
  }>;
  strategies: Array<{
    scenario: string;
    response: string;
    resources: string[];
    timeline: string;
  }>;
  procedures: Array<{
    phase: 'preparation' | 'response' | 'recovery' | 'restoration';
    steps: Array<{
      order: number;
      action: string;
      responsible: string;
      timeframe: string;
      dependencies: string[];
    }>;
  }>;
}

export interface RiskAssessment {
  id: string;
  threat: string;
  likelihood: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  impact: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  mitigations: Array<{
    action: string;
    effectiveness: number; // 0-100
    cost: number;
    status: 'planned' | 'in_progress' | 'completed';
  }>;
  residualRisk: 'low' | 'medium' | 'high' | 'critical';
  reviewDate: Date;
}

export interface AuditRecord {
  id: string;
  timestamp: Date;
  auditor: string;
  framework: string;
  scope: string[];
  findings: Array<{
    id: string;
    requirement: string;
    status: 'compliant' | 'non_compliant' | 'partially_compliant';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: string[];
    remediation?: {
      action: string;
      timeline: string;
      responsible: string;
      status: 'open' | 'in_progress' | 'completed';
    };
  }>;
  overallCompliance: number; // percentage
  recommendations: string[];
}

export interface KPI {
  name: string;
  category: 'availability' | 'recovery' | 'testing' | 'compliance';
  value: number;
  target: number;
  trend: 'improving' | 'stable' | 'declining';
  lastUpdated: Date;
  alertThresholds: {
    warning: number;
    critical: number;
  };
}

export interface ExecutiveDashboard {
  summaryMetrics: {
    overallAvailability: number;
    businessContinuityReadiness: number;
    complianceScore: number;
    riskExposure: 'low' | 'medium' | 'high' | 'critical';
  };
  keyRisks: Array<{
    risk: string;
    impact: string;
    mitigation: string;
    dueDate?: Date;
  }>;
  recentIncidents: Array<{
    date: Date;
    type: string;
    impact: string;
    resolution: string;
  }>;
  upcomingActivities: Array<{
    activity: string;
    dueDate: Date;
    responsible: string;
    status: string;
  }>;
}

export class BusinessContinuityManager extends EventEmitter {
  private static instance: BusinessContinuityManager;
  private backupManager: BackupManager;
  private recoveryOrchestrator: DisasterRecoveryOrchestrator;
  private metrics: MetricsCollector;
  private tracing: DistributedTracing;
  
  private complianceFrameworks: Map<string, ComplianceFramework> = new Map();
  private businessImpactAnalyses: Map<string, BusinessImpactAnalysis> = new Map();
  private continuityPlans: Map<string, ContinuityPlan> = new Map();
  private riskAssessments: Map<string, RiskAssessment> = new Map();
  private auditRecords: AuditRecord[] = [];
  private kpis: Map<string, KPI> = new Map();
  
  // Monitoring intervals
  private complianceMonitor?: NodeJS.Timeout;
  private riskMonitor?: NodeJS.Timeout;
  private kpiCollector?: NodeJS.Timeout;
  private planReviewer?: NodeJS.Timeout;

  private constructor() {
    super();
    this.backupManager = BackupManager.getInstance();
    this.recoveryOrchestrator = DisasterRecoveryOrchestrator.getInstance();
    this.metrics = MetricsCollector.getInstance();
    this.tracing = DistributedTracing.getInstance();
    
    this.initializeFrameworks();
    this.setupBusinessImpactAnalyses();
    this.createContinuityPlans();
    this.setupKPIs();
    this.startMonitoring();
  }

  public static getInstance(): BusinessContinuityManager {
    if (!BusinessContinuityManager.instance) {
      BusinessContinuityManager.instance = new BusinessContinuityManager();
    }
    return BusinessContinuityManager.instance;
  }

  /**
   * Register compliance framework
   */
  public registerComplianceFramework(framework: ComplianceFramework): void {
    this.complianceFrameworks.set(framework.name, framework);
    
    logger.info('Compliance framework registered', {
      name: framework.name,
      version: framework.version,
      requirements: framework.requirements.length,
    });

    this.emit('framework_registered', framework);
  }

  /**
   * Conduct compliance assessment
   */
  public async conductComplianceAssessment(
    frameworkName: string,
    assessor: string,
    scope?: string[]
  ): Promise<AuditRecord> {
    const span = this.tracing.startTrace('compliance_assessment');
    
    try {
      const framework = this.complianceFrameworks.get(frameworkName);
      if (!framework) {
        throw new Error(`Compliance framework not found: ${frameworkName}`);
      }

      logger.info('Starting compliance assessment', {
        framework: frameworkName,
        assessor,
        scope: scope?.length || 'full',
      });

      const auditId = this.generateAuditId(frameworkName);
      const findings = [];
      
      // Assess each requirement
      for (const requirement of framework.requirements) {
        if (scope && !scope.includes(requirement.category)) {
          continue;
        }

        const finding = await this.assessRequirement(requirement);
        findings.push(finding);
      }

      // Calculate overall compliance
      const compliantFindings = findings.filter(f => f.status === 'compliant').length;
      const overallCompliance = (compliantFindings / findings.length) * 100;

      // Generate recommendations
      const recommendations = this.generateComplianceRecommendations(findings);

      const auditRecord: AuditRecord = {
        id: auditId,
        timestamp: new Date(),
        auditor: assessor,
        framework: frameworkName,
        scope: scope || ['all'],
        findings,
        overallCompliance,
        recommendations,
      };

      this.auditRecords.push(auditRecord);

      this.metrics.recordMetric('compliance_assessment', 1, {
        framework: frameworkName,
        compliance: overallCompliance.toString(),
        findings: findings.length.toString(),
      });

      this.tracing.finishSpan(span, 'ok');
      this.emit('assessment_completed', auditRecord);

      logger.info('Compliance assessment completed', {
        auditId,
        framework: frameworkName,
        compliance: overallCompliance,
        findings: findings.length,
      });

      return auditRecord;

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Compliance assessment failed', error, { frameworkName });
      throw error;
    }
  }

  /**
   * Perform business impact analysis
   */
  public async performBusinessImpactAnalysis(
    processName: string,
    stakeholders: string[]
  ): Promise<BusinessImpactAnalysis> {
    const span = this.tracing.startTrace('business_impact_analysis');
    
    try {
      logger.info('Starting business impact analysis', {
        process: processName,
        stakeholders: stakeholders.length,
      });

      // Analyze current metrics
      const metrics = await this.recoveryOrchestrator.getBusinessContinuityMetrics();
      
      // Determine criticality based on dependencies and usage
      const criticality = await this.determineCriticality(processName);
      
      // Calculate RTO/RPO requirements
      const rto = this.calculateRTO(criticality);
      const rpo = this.calculateRPO(criticality);
      
      // Identify dependencies
      const dependencies = await this.identifyDependencies(processName);
      
      // Model impact scenarios
      const impactScenarios = this.modelImpactScenarios(criticality);
      
      // Evaluate recovery strategies
      const recoveryStrategies = this.evaluateRecoveryStrategies(criticality, rto, rpo);

      const bia: BusinessImpactAnalysis = {
        process: processName,
        criticality,
        rto,
        rpo,
        dependencies,
        impactScenarios,
        recoveryStrategies,
      };

      this.businessImpactAnalyses.set(processName, bia);

      this.metrics.recordMetric('business_impact_analysis', 1, {
        process: processName,
        criticality,
        rto: rto.toString(),
      });

      this.tracing.finishSpan(span, 'ok');
      this.emit('bia_completed', bia);

      logger.info('Business impact analysis completed', {
        process: processName,
        criticality,
        rto,
        rpo,
        strategies: recoveryStrategies.length,
      });

      return bia;

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Business impact analysis failed', error, { processName });
      throw error;
    }
  }

  /**
   * Generate executive dashboard
   */
  public async generateExecutiveDashboard(): Promise<ExecutiveDashboard> {
    try {
      // Get current metrics
      const bcMetrics = await this.recoveryOrchestrator.getBusinessContinuityMetrics();
      const backupStatus = await this.backupManager.getBackupStatus();
      
      // Calculate summary metrics
      const overallAvailability = bcMetrics.availability.current;
      const businessContinuityReadiness = this.calculateReadinessScore();
      const complianceScore = this.calculateOverallComplianceScore();
      const riskExposure = this.assessOverallRiskExposure();

      // Get key risks
      const keyRisks = this.getTopRisks(5);
      
      // Get recent incidents
      const recentIncidents = await this.getRecentIncidents();
      
      // Get upcoming activities
      const upcomingActivities = this.getUpcomingActivities();

      const dashboard: ExecutiveDashboard = {
        summaryMetrics: {
          overallAvailability,
          businessContinuityReadiness,
          complianceScore,
          riskExposure,
        },
        keyRisks,
        recentIncidents,
        upcomingActivities,
      };

      logger.info('Executive dashboard generated', {
        availability: overallAvailability,
        readiness: businessContinuityReadiness,
        compliance: complianceScore,
        risks: keyRisks.length,
      });

      return dashboard;

    } catch (error) {
      logger.error('Failed to generate executive dashboard', error);
      throw error;
    }
  }

  /**
   * Generate compliance report
   */
  public async generateComplianceReport(
    frameworkName: string,
    period: { start: Date; end: Date }
  ): Promise<{
    framework: string;
    period: { start: Date; end: Date };
    overallCompliance: number;
    trendsAnalysis: Array<{ date: Date; compliance: number }>;
    riskAreas: Array<{ area: string; risk: string; remediation: string }>;
    recommendations: string[];
    nextSteps: Array<{ action: string; timeline: string; responsible: string }>;
  }> {
    try {
      const framework = this.complianceFrameworks.get(frameworkName);
      if (!framework) {
        throw new Error(`Framework not found: ${frameworkName}`);
      }

      // Get relevant audit records
      const periodAudits = this.auditRecords.filter(audit => 
        audit.framework === frameworkName &&
        audit.timestamp >= period.start &&
        audit.timestamp <= period.end
      );

      // Calculate overall compliance
      const overallCompliance = periodAudits.length > 0 ?
        periodAudits.reduce((sum, audit) => sum + audit.overallCompliance, 0) / periodAudits.length : 0;

      // Generate trends analysis
      const trendsAnalysis = periodAudits.map(audit => ({
        date: audit.timestamp,
        compliance: audit.overallCompliance,
      }));

      // Identify risk areas
      const riskAreas = this.identifyComplianceRiskAreas(periodAudits);
      
      // Generate recommendations
      const recommendations = this.generatePeriodRecommendations(periodAudits);
      
      // Define next steps
      const nextSteps = this.generateNextSteps(riskAreas);

      const report = {
        framework: frameworkName,
        period,
        overallCompliance,
        trendsAnalysis,
        riskAreas,
        recommendations,
        nextSteps,
      };

      logger.info('Compliance report generated', {
        framework: frameworkName,
        period: `${period.start.toISOString()} to ${period.end.toISOString()}`,
        compliance: overallCompliance,
        audits: periodAudits.length,
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate compliance report', error, { frameworkName });
      throw error;
    }
  }

  /**
   * Update KPI values
   */
  public updateKPI(name: string, value: number): void {
    const kpi = this.kpis.get(name);
    if (!kpi) {
      logger.warn('KPI not found', { name });
      return;
    }

    const previousValue = kpi.value;
    kpi.value = value;
    kpi.lastUpdated = new Date();
    
    // Determine trend
    if (value > previousValue) {
      kpi.trend = 'improving';
    } else if (value < previousValue) {
      kpi.trend = 'declining';
    } else {
      kpi.trend = 'stable';
    }

    // Check alert thresholds
    if (value <= kpi.alertThresholds.critical) {
      this.sendKPIAlert(kpi, 'critical');
    } else if (value <= kpi.alertThresholds.warning) {
      this.sendKPIAlert(kpi, 'warning');
    }

    this.metrics.recordMetric(`kpi_${name}`, value);
    this.emit('kpi_updated', { name, value, trend: kpi.trend });
  }

  /**
   * Get business continuity maturity assessment
   */
  public async getMaturityAssessment(): Promise<{
    overallMaturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
    dimensions: Array<{
      dimension: string;
      maturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
      score: number; // 1-5
      gaps: string[];
      recommendations: string[];
    }>;
    roadmap: Array<{
      phase: string;
      duration: string;
      activities: string[];
      outcomes: string[];
    }>;
  }> {
    try {
      // Assess different dimensions of maturity
      const dimensions = [
        await this.assessGovernanceMaturity(),
        await this.assessProcessMaturity(),
        await this.assessTechnologyMaturity(),
        await this.assessPeopleMaturity(),
      ];

      // Calculate overall maturity
      const averageScore = dimensions.reduce((sum, dim) => sum + dim.score, 0) / dimensions.length;
      const overallMaturity = this.scoreToMaturityLevel(averageScore);

      // Generate improvement roadmap
      const roadmap = this.generateMaturityRoadmap(dimensions, overallMaturity);

      const assessment = {
        overallMaturity,
        dimensions,
        roadmap,
      };

      logger.info('Maturity assessment completed', {
        overallMaturity,
        averageScore,
        dimensions: dimensions.length,
      });

      return assessment;

    } catch (error) {
      logger.error('Failed to assess maturity', error);
      throw error;
    }
  }

  // Private helper methods

  private initializeFrameworks(): void {
    // Initialize SOX compliance framework
    this.registerComplianceFramework({
      name: 'SOX',
      version: '2002',
      requirements: [
        {
          id: 'SOX-404',
          title: 'Management Assessment of Internal Controls',
          description: 'Establish and maintain adequate internal control over financial reporting',
          category: 'backup',
          criticality: 'must',
          controls: [
            {
              id: 'SOX-404-1',
              description: 'Daily backup of financial data',
              implemented: true,
              evidence: ['backup-logs', 'verification-reports'],
            },
          ],
        },
      ],
    });

    // Initialize ISO 22301 framework
    this.registerComplianceFramework({
      name: 'ISO-22301',
      version: '2019',
      requirements: [
        {
          id: 'ISO-22301-8.2',
          title: 'Business Impact Analysis',
          description: 'Conduct and maintain business impact analysis',
          category: 'recovery',
          criticality: 'must',
          controls: [
            {
              id: 'ISO-22301-8.2-1',
              description: 'Annual BIA review',
              implemented: true,
              evidence: ['bia-reports', 'stakeholder-interviews'],
            },
          ],
        },
      ],
    });
  }

  private setupBusinessImpactAnalyses(): void {
    // Example BIA for core application
    this.businessImpactAnalyses.set('core-application', {
      process: 'core-application',
      criticality: 'critical',
      rto: 30, // 30 minutes
      rpo: 5,  // 5 minutes
      dependencies: ['database', 'authentication', 'payment-gateway'],
      impactScenarios: [
        {
          duration: 1,
          financialImpact: 10000,
          reputationalRisk: 'low',
          regulatoryRisk: 'low',
        },
        {
          duration: 4,
          financialImpact: 50000,
          reputationalRisk: 'medium',
          regulatoryRisk: 'medium',
        },
        {
          duration: 24,
          financialImpact: 500000,
          reputationalRisk: 'high',
          regulatoryRisk: 'high',
        },
      ],
      recoveryStrategies: [
        {
          strategy: 'Hot standby with automatic failover',
          cost: 50000,
          effectiveness: 95,
          complexity: 'high',
        },
        {
          strategy: 'Warm standby with manual failover',
          cost: 25000,
          effectiveness: 85,
          complexity: 'medium',
        },
      ],
    });
  }

  private createContinuityPlans(): void {
    const plan: ContinuityPlan = {
      id: 'master-bcp',
      name: 'Master Business Continuity Plan',
      version: '2.1',
      lastUpdated: new Date(),
      nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      owner: 'CTO',
      approver: 'CEO',
      scope: ['all-systems'],
      objectives: [
        {
          metric: 'System Availability',
          target: 99.9,
          current: 99.7,
          status: 'at_risk',
        },
        {
          metric: 'Recovery Time Objective',
          target: 30,
          current: 45,
          status: 'not_met',
        },
      ],
      strategies: [
        {
          scenario: 'Database Failure',
          response: 'Activate hot standby and redirect traffic',
          resources: ['DBA team', 'Infrastructure team'],
          timeline: '15 minutes',
        },
      ],
      procedures: [
        {
          phase: 'preparation',
          steps: [
            {
              order: 1,
              action: 'Establish crisis management team',
              responsible: 'CTO',
              timeframe: 'Ongoing',
              dependencies: [],
            },
          ],
        },
      ],
    };

    this.continuityPlans.set(plan.id, plan);
  }

  private setupKPIs(): void {
    const kpis = [
      {
        name: 'system_availability',
        category: 'availability' as const,
        value: 99.7,
        target: 99.9,
        trend: 'stable' as const,
        lastUpdated: new Date(),
        alertThresholds: { warning: 99.5, critical: 99.0 },
      },
      {
        name: 'mean_time_to_recovery',
        category: 'recovery' as const,
        value: 25,
        target: 30,
        trend: 'improving' as const,
        lastUpdated: new Date(),
        alertThresholds: { warning: 45, critical: 60 },
      },
      {
        name: 'backup_success_rate',
        category: 'recovery' as const,
        value: 98.5,
        target: 99.5,
        trend: 'stable' as const,
        lastUpdated: new Date(),
        alertThresholds: { warning: 97, critical: 95 },
      },
      {
        name: 'compliance_score',
        category: 'compliance' as const,
        value: 92,
        target: 95,
        trend: 'improving' as const,
        lastUpdated: new Date(),
        alertThresholds: { warning: 85, critical: 80 },
      },
    ];

    for (const kpi of kpis) {
      this.kpis.set(kpi.name, kpi);
    }
  }

  private startMonitoring(): void {
    // Compliance monitoring
    this.complianceMonitor = setInterval(async () => {
      await this.monitorCompliance();
    }, 24 * 60 * 60 * 1000); // Daily

    // Risk monitoring
    this.riskMonitor = setInterval(async () => {
      await this.monitorRisks();
    }, 4 * 60 * 60 * 1000); // Every 4 hours

    // KPI collection
    this.kpiCollector = setInterval(async () => {
      await this.collectKPIs();
    }, 15 * 60 * 1000); // Every 15 minutes

    // Plan review reminders
    this.planReviewer = setInterval(async () => {
      await this.checkPlanReviews();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  private generateAuditId(frameworkName: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 6);
    return `audit-${frameworkName}-${timestamp}-${random}`;
  }

  private async assessRequirement(requirement: any): Promise<AuditRecord['findings'][0]> {
    // Simulate requirement assessment
    const compliance = Math.random();
    let status: 'compliant' | 'non_compliant' | 'partially_compliant';
    
    if (compliance > 0.8) {
      status = 'compliant';
    } else if (compliance > 0.5) {
      status = 'partially_compliant';
    } else {
      status = 'non_compliant';
    }

    return {
      id: `finding-${requirement.id}`,
      requirement: requirement.id,
      status,
      severity: status === 'non_compliant' ? 'high' : 'medium',
      description: `Assessment of ${requirement.title}`,
      evidence: ['system-configuration', 'process-documentation'],
      remediation: status !== 'compliant' ? {
        action: 'Implement missing controls',
        timeline: '30 days',
        responsible: 'Security Team',
        status: 'open',
      } : undefined,
    };
  }

  private generateComplianceRecommendations(findings: any[]): string[] {
    const recommendations = [];
    
    const nonCompliant = findings.filter(f => f.status === 'non_compliant');
    if (nonCompliant.length > 0) {
      recommendations.push(`Address ${nonCompliant.length} non-compliant findings immediately`);
    }

    const partiallyCompliant = findings.filter(f => f.status === 'partially_compliant');
    if (partiallyCompliant.length > 0) {
      recommendations.push(`Improve ${partiallyCompliant.length} partially compliant controls`);
    }

    recommendations.push('Schedule regular compliance assessments');
    recommendations.push('Implement continuous compliance monitoring');

    return recommendations;
  }

  private async determineCriticality(processName: string): Promise<'critical' | 'high' | 'medium' | 'low'> {
    // Determine criticality based on business factors
    if (processName.includes('payment') || processName.includes('auth')) {
      return 'critical';
    } else if (processName.includes('core') || processName.includes('api')) {
      return 'high';
    } else if (processName.includes('reporting') || processName.includes('analytics')) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private calculateRTO(criticality: string): number {
    switch (criticality) {
      case 'critical': return 15;
      case 'high': return 30;
      case 'medium': return 120;
      case 'low': return 480;
      default: return 240;
    }
  }

  private calculateRPO(criticality: string): number {
    switch (criticality) {
      case 'critical': return 5;
      case 'high': return 15;
      case 'medium': return 60;
      case 'low': return 240;
      default: return 120;
    }
  }

  private async identifyDependencies(processName: string): Promise<string[]> {
    // Identify process dependencies
    const commonDependencies = ['network', 'power', 'personnel'];
    
    if (processName.includes('database')) {
      return [...commonDependencies, 'storage', 'backup-systems'];
    } else if (processName.includes('web')) {
      return [...commonDependencies, 'cdn', 'load-balancer', 'database'];
    } else {
      return commonDependencies;
    }
  }

  private modelImpactScenarios(criticality: string): BusinessImpactAnalysis['impactScenarios'] {
    const baseImpact = criticality === 'critical' ? 10000 : 
                     criticality === 'high' ? 5000 : 
                     criticality === 'medium' ? 1000 : 500;

    return [
      {
        duration: 1,
        financialImpact: baseImpact,
        reputationalRisk: 'low',
        regulatoryRisk: 'low',
      },
      {
        duration: 4,
        financialImpact: baseImpact * 3,
        reputationalRisk: 'medium',
        regulatoryRisk: 'medium',
      },
      {
        duration: 24,
        financialImpact: baseImpact * 20,
        reputationalRisk: 'high',
        regulatoryRisk: 'high',
      },
    ];
  }

  private evaluateRecoveryStrategies(
    criticality: string,
    rto: number,
    rpo: number
  ): BusinessImpactAnalysis['recoveryStrategies'] {
    const strategies = [];

    if (criticality === 'critical') {
      strategies.push({
        strategy: 'Hot standby with automatic failover',
        cost: 100000,
        effectiveness: 95,
        complexity: 'high' as const,
      });
    }

    strategies.push({
      strategy: 'Warm standby with manual failover',
      cost: 50000,
      effectiveness: 85,
      complexity: 'medium' as const,
    });

    strategies.push({
      strategy: 'Cold standby with restore from backup',
      cost: 10000,
      effectiveness: 70,
      complexity: 'low' as const,
    });

    return strategies;
  }

  private calculateReadinessScore(): number {
    // Calculate based on various factors
    let score = 0;
    
    // Backup health (25%)
    score += 25 * (this.kpis.get('backup_success_rate')?.value || 0) / 100;
    
    // Recovery capability (25%)
    const mttr = this.kpis.get('mean_time_to_recovery')?.value || 60;
    score += 25 * Math.max(0, (60 - mttr) / 60);
    
    // Testing frequency (25%)
    score += 20; // Assume regular testing
    
    // Documentation completeness (25%)
    score += 22; // Assume good documentation

    return Math.round(score);
  }

  private calculateOverallComplianceScore(): number {
    if (this.auditRecords.length === 0) return 0;
    
    const recentAudits = this.auditRecords
      .filter(audit => audit.timestamp > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
      .slice(-5);

    if (recentAudits.length === 0) return 0;

    return recentAudits.reduce((sum, audit) => sum + audit.overallCompliance, 0) / recentAudits.length;
  }

  private assessOverallRiskExposure(): 'low' | 'medium' | 'high' | 'critical' {
    const highRisks = Array.from(this.riskAssessments.values())
      .filter(risk => risk.riskLevel === 'high' || risk.riskLevel === 'critical').length;

    if (highRisks > 3) return 'critical';
    if (highRisks > 1) return 'high';
    if (highRisks > 0) return 'medium';
    return 'low';
  }

  private getTopRisks(count: number): ExecutiveDashboard['keyRisks'] {
    return Array.from(this.riskAssessments.values())
      .sort((a, b) => this.riskScore(b) - this.riskScore(a))
      .slice(0, count)
      .map(risk => ({
        risk: risk.threat,
        impact: this.describeImpact(risk),
        mitigation: risk.mitigations[0]?.action || 'Under review',
        dueDate: risk.reviewDate,
      }));
  }

  private riskScore(risk: RiskAssessment): number {
    const likelihoodScore = this.likelihoodToScore(risk.likelihood);
    const impactScore = this.impactToScore(risk.impact);
    return likelihoodScore * impactScore;
  }

  private likelihoodToScore(likelihood: string): number {
    switch (likelihood) {
      case 'very_high': return 5;
      case 'high': return 4;
      case 'medium': return 3;
      case 'low': return 2;
      case 'very_low': return 1;
      default: return 1;
    }
  }

  private impactToScore(impact: string): number {
    switch (impact) {
      case 'very_high': return 5;
      case 'high': return 4;
      case 'medium': return 3;
      case 'low': return 2;
      case 'very_low': return 1;
      default: return 1;
    }
  }

  private describeImpact(risk: RiskAssessment): string {
    return `${risk.impact} impact, ${risk.likelihood} likelihood`;
  }

  private async getRecentIncidents(): Promise<ExecutiveDashboard['recentIncidents']> {
    // Mock recent incidents
    return [
      {
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        type: 'Database Performance',
        impact: 'Minor service degradation',
        resolution: 'Query optimization applied',
      },
      {
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        type: 'Network Connectivity',
        impact: 'Brief connectivity issues',
        resolution: 'ISP issue resolved',
      },
    ];
  }

  private getUpcomingActivities(): ExecutiveDashboard['upcomingActivities'] {
    const activities = [];
    
    // Check for plan reviews
    for (const [planId, plan] of this.continuityPlans.entries()) {
      if (plan.nextReview <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
        activities.push({
          activity: `Review ${plan.name}`,
          dueDate: plan.nextReview,
          responsible: plan.owner,
          status: 'scheduled',
        });
      }
    }

    // Add regular activities
    activities.push({
      activity: 'Quarterly DR Test',
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      responsible: 'IT Operations',
      status: 'planned',
    });

    return activities.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  private identifyComplianceRiskAreas(audits: AuditRecord[]): Array<{
    area: string;
    risk: string;
    remediation: string;
  }> {
    const riskAreas = [];
    
    // Analyze findings across audits
    const allFindings = audits.flatMap(audit => audit.findings);
    const nonCompliantFindings = allFindings.filter(f => f.status === 'non_compliant');
    
    // Group by category
    const categories = ['backup', 'recovery', 'testing', 'documentation'];
    for (const category of categories) {
      const categoryFindings = nonCompliantFindings.filter(f => f.requirement.includes(category));
      if (categoryFindings.length > 0) {
        riskAreas.push({
          area: category,
          risk: `${categoryFindings.length} non-compliant findings`,
          remediation: 'Implement missing controls and update procedures',
        });
      }
    }

    return riskAreas;
  }

  private generatePeriodRecommendations(audits: AuditRecord[]): string[] {
    const recommendations = new Set<string>();
    
    audits.forEach(audit => {
      audit.recommendations.forEach(rec => recommendations.add(rec));
    });

    return Array.from(recommendations);
  }

  private generateNextSteps(riskAreas: any[]): Array<{
    action: string;
    timeline: string;
    responsible: string;
  }> {
    return riskAreas.map(area => ({
      action: `Address ${area.area} compliance gaps`,
      timeline: '30 days',
      responsible: 'Compliance Team',
    }));
  }

  private sendKPIAlert(kpi: KPI, severity: 'warning' | 'critical'): void {
    logger.warn(`KPI Alert: ${kpi.name}`, {
      current: kpi.value,
      target: kpi.target,
      severity,
      trend: kpi.trend,
    });

    this.emit('kpi_alert', { kpi: kpi.name, severity, value: kpi.value });
  }

  private async assessGovernanceMaturity(): Promise<{
    dimension: string;
    maturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
    score: number;
    gaps: string[];
    recommendations: string[];
  }> {
    return {
      dimension: 'Governance',
      maturity: 'defined',
      score: 3,
      gaps: ['Board-level oversight', 'Risk appetite statement'],
      recommendations: ['Establish BC steering committee', 'Define risk tolerance levels'],
    };
  }

  private async assessProcessMaturity(): Promise<{
    dimension: string;
    maturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
    score: number;
    gaps: string[];
    recommendations: string[];
  }> {
    return {
      dimension: 'Process',
      maturity: 'managed',
      score: 4,
      gaps: ['Continuous improvement'],
      recommendations: ['Implement process metrics', 'Regular process reviews'],
    };
  }

  private async assessTechnologyMaturity(): Promise<{
    dimension: string;
    maturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
    score: number;
    gaps: string[];
    recommendations: string[];
  }> {
    return {
      dimension: 'Technology',
      maturity: 'defined',
      score: 3,
      gaps: ['Automated failover', 'Cross-region replication'],
      recommendations: ['Implement automation', 'Enhance monitoring'],
    };
  }

  private async assessPeopleMaturity(): Promise<{
    dimension: string;
    maturity: 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing';
    score: number;
    gaps: string[];
    recommendations: string[];
  }> {
    return {
      dimension: 'People',
      maturity: 'developing',
      score: 2,
      gaps: ['Regular training', 'Skills assessment'],
      recommendations: ['Develop training program', 'Create competency matrix'],
    };
  }

  private scoreToMaturityLevel(score: number): 'initial' | 'developing' | 'defined' | 'managed' | 'optimizing' {
    if (score >= 4.5) return 'optimizing';
    if (score >= 3.5) return 'managed';
    if (score >= 2.5) return 'defined';
    if (score >= 1.5) return 'developing';
    return 'initial';
  }

  private generateMaturityRoadmap(
    dimensions: any[],
    currentMaturity: string
  ): Array<{
    phase: string;
    duration: string;
    activities: string[];
    outcomes: string[];
  }> {
    const roadmap = [];

    // Phase 1: Foundation
    if (currentMaturity === 'initial' || currentMaturity === 'developing') {
      roadmap.push({
        phase: 'Foundation',
        duration: '6 months',
        activities: [
          'Establish BC governance',
          'Conduct BIA',
          'Develop initial plans',
          'Basic testing program',
        ],
        outcomes: [
          'BC policy and procedures',
          'Initial continuity plans',
          'Basic recovery capabilities',
        ],
      });
    }

    // Phase 2: Enhancement
    roadmap.push({
      phase: 'Enhancement',
      duration: '12 months',
      activities: [
        'Implement automation',
        'Enhance monitoring',
        'Regular testing',
        'Staff training',
      ],
      outcomes: [
        'Automated recovery procedures',
        'Comprehensive monitoring',
        'Skilled response teams',
      ],
    });

    // Phase 3: Optimization
    roadmap.push({
      phase: 'Optimization',
      duration: '6 months',
      activities: [
        'Continuous improvement',
        'Advanced analytics',
        'Predictive capabilities',
        'Industry benchmarking',
      ],
      outcomes: [
        'Optimized processes',
        'Predictive insights',
        'Industry-leading capabilities',
      ],
    });

    return roadmap;
  }

  private async monitorCompliance(): Promise<void> {
    // Check for overdue compliance activities
    const overdueAudits = this.auditRecords.filter(audit => {
      const daysSinceAudit = (Date.now() - audit.timestamp.getTime()) / (24 * 60 * 60 * 1000);
      return daysSinceAudit > 90; // Audits older than 90 days
    });

    if (overdueAudits.length > 0) {
      logger.warn('Overdue compliance assessments detected', {
        count: overdueAudits.length,
      });
    }
  }

  private async monitorRisks(): Promise<void> {
    // Check for risks requiring review
    const now = new Date();
    const overdueRisks = Array.from(this.riskAssessments.values())
      .filter(risk => risk.reviewDate <= now);

    if (overdueRisks.length > 0) {
      logger.warn('Risk assessments require review', {
        count: overdueRisks.length,
      });
    }
  }

  private async collectKPIs(): Promise<void> {
    try {
      // Update availability KPI
      const bcMetrics = await this.recoveryOrchestrator.getBusinessContinuityMetrics();
      this.updateKPI('system_availability', bcMetrics.availability.current);
      
      // Update recovery time KPI
      this.updateKPI('mean_time_to_recovery', bcMetrics.recovery.meanTimeToRecovery);
      
      // Update backup success rate
      const backupStatus = await this.backupManager.getBackupStatus();
      const successRate = backupStatus.totalBackups > 0 ? 
        ((backupStatus.totalBackups - backupStatus.recentFailures) / backupStatus.totalBackups) * 100 : 100;
      this.updateKPI('backup_success_rate', successRate);
      
      // Update compliance score
      const complianceScore = this.calculateOverallComplianceScore();
      this.updateKPI('compliance_score', complianceScore);

    } catch (error) {
      logger.error('Failed to collect KPIs', error);
    }
  }

  private async checkPlanReviews(): Promise<void> {
    const now = new Date();
    const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const [planId, plan] of this.continuityPlans.entries()) {
      if (plan.nextReview <= oneMonthFromNow) {
        logger.info('Plan review due soon', {
          planId,
          planName: plan.name,
          dueDate: plan.nextReview,
          owner: plan.owner,
        });

        this.emit('plan_review_due', {
          planId,
          planName: plan.name,
          dueDate: plan.nextReview,
          owner: plan.owner,
        });
      }
    }
  }

  /**
   * Shutdown business continuity manager
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear intervals
      if (this.complianceMonitor) {
        clearInterval(this.complianceMonitor);
      }
      if (this.riskMonitor) {
        clearInterval(this.riskMonitor);
      }
      if (this.kpiCollector) {
        clearInterval(this.kpiCollector);
      }
      if (this.planReviewer) {
        clearInterval(this.planReviewer);
      }

      // Clear data structures
      this.complianceFrameworks.clear();
      this.businessImpactAnalyses.clear();
      this.continuityPlans.clear();
      this.riskAssessments.clear();
      this.auditRecords.length = 0;
      this.kpis.clear();

      logger.info('Business continuity manager shutdown completed');
      this.emit('shutdown');
    } catch (error) {
      logger.error('Error during business continuity manager shutdown', error);
      throw error;
    }
  }
}

/**
 * Factory function to create business continuity manager
 */
export const createBusinessContinuityManager = () => {
  return BusinessContinuityManager.getInstance();
};