import { logger } from '@/logger.js';
import { SystemIntegration } from '@/infrastructure/SystemIntegration.js';
import { MetricsSystem } from '@/infrastructure/observability/Metrics.js';
import { SLOMonitoringSystem } from '@/infrastructure/observability/SLOMonitoring.js';
import { AnomalyDetectionSystem } from '@/infrastructure/observability/AnomalyDetection.js';
import { ThreatDetectionSystem } from '@/infrastructure/security/ThreatDetection.js';
import { ComplianceAutomationSystem } from '@/infrastructure/security/ComplianceAutomation.js';
import { SecurityAuditSystem } from '@/infrastructure/security/SecurityAudit.js';
import { EdgeComputingSystem } from '@/infrastructure/edge/EdgeComputing.js';
import { DataReplicationSystem } from '@/infrastructure/edge/DataReplication.js';
import { IntelligentCDN } from '@/infrastructure/edge/IntelligentCDN.js';
import { PerformanceOptimizer } from '@/infrastructure/performance/PerformanceOptimizer.js';

export interface DashboardConfig {
  refreshInterval: number; // milliseconds
  historyWindow: number; // milliseconds
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    availability: number;
    threatCount: number;
  };
}

export interface DashboardData {
  timestamp: Date;
  overview: {
    status: 'healthy' | 'degraded' | 'critical';
    uptime: number;
    requestsPerSecond: number;
    activeUsers: number;
    errorRate: number;
  };
  performance: {
    responseTime: { p50: number; p95: number; p99: number };
    throughput: number;
    saturation: number;
    errors: Array<{ time: Date; count: number }>;
  };
  security: {
    threats: {
      total: number;
      critical: number;
      byType: Record<string, number>;
    };
    authentication: {
      attempts: number;
      failures: number;
      mfaUsage: number;
    };
    compliance: {
      score: number;
      frameworks: Array<{ name: string; status: string; score: number }>;
    };
  };
  infrastructure: {
    edge: {
      locations: Array<{
        id: string;
        region: string;
        status: string;
        latency: number;
        load: number;
      }>;
      replication: {
        nodes: number;
        lag: number;
        conflicts: number;
      };
    };
    cache: {
      hitRate: number;
      size: number;
      evictions: number;
    };
    resources: {
      cpu: number;
      memory: number;
      storage: number;
      network: number;
    };
  };
  slo: {
    objectives: Array<{
      name: string;
      target: number;
      current: number;
      errorBudget: number;
      burning: boolean;
    }>;
  };
  anomalies: Array<{
    id: string;
    type: string;
    severity: string;
    description: string;
    timestamp: Date;
  }>;
  recommendations: Array<{
    type: string;
    priority: string;
    description: string;
    impact: number;
  }>;
}

/**
 * Advanced Monitoring Dashboard
 * Provides real-time insights into system health and performance
 */
export class MonitoringDashboard {
  private config: DashboardConfig;
  private system: SystemIntegration;
  private metrics: MetricsSystem;
  private sloMonitoring: SLOMonitoringSystem;
  private anomalyDetection: AnomalyDetectionSystem;
  private threatDetection: ThreatDetectionSystem;
  private compliance: ComplianceAutomationSystem;
  private securityAudit: SecurityAuditSystem;
  private edgeComputing: EdgeComputingSystem;
  private dataReplication: DataReplicationSystem;
  private cdn: IntelligentCDN;
  private performanceOptimizer: PerformanceOptimizer;

  private dashboardData: DashboardData[] = [];
  private refreshInterval?: NodeJS.Timeout;

  private constructor(
    config: DashboardConfig,
    system: SystemIntegration,
    metrics: MetricsSystem,
    sloMonitoring: SLOMonitoringSystem,
    anomalyDetection: AnomalyDetectionSystem,
    threatDetection: ThreatDetectionSystem,
    compliance: ComplianceAutomationSystem,
    securityAudit: SecurityAuditSystem,
    edgeComputing: EdgeComputingSystem,
    dataReplication: DataReplicationSystem,
    cdn: IntelligentCDN,
    performanceOptimizer: PerformanceOptimizer
  ) {
    this.config = config;
    this.system = system;
    this.metrics = metrics;
    this.sloMonitoring = sloMonitoring;
    this.anomalyDetection = anomalyDetection;
    this.threatDetection = threatDetection;
    this.compliance = compliance;
    this.securityAudit = securityAudit;
    this.edgeComputing = edgeComputing;
    this.dataReplication = dataReplication;
    this.cdn = cdn;
    this.performanceOptimizer = performanceOptimizer;
  }

  /**
   * Create a new MonitoringDashboard instance
   * Handles async initialization of dependencies
   */
  static async create(config: DashboardConfig): Promise<MonitoringDashboard> {
    // SystemIntegration is an AsyncSingletonService and must be initialized first
    const system = SystemIntegration.getInstance();
    
    // These are async singleton services that need await
    const metrics = await MetricsSystem.getInstance();
    const edgeComputing = await EdgeComputingSystem.getInstance();
    
    // These are regular singleton services
    const sloMonitoring = SLOMonitoringSystem.getInstance();
    const anomalyDetection = AnomalyDetectionSystem.getInstance();
    const threatDetection = ThreatDetectionSystem.getInstance();
    const compliance = ComplianceAutomationSystem.getInstance();
    const securityAudit = SecurityAuditSystem.getInstance();
    const dataReplication = DataReplicationSystem.getInstance();
    const cdn = IntelligentCDN.getInstance();
    const performanceOptimizer = PerformanceOptimizer.getInstance();

    return new MonitoringDashboard(
      config,
      system,
      metrics,
      sloMonitoring,
      anomalyDetection,
      threatDetection,
      compliance,
      securityAudit,
      edgeComputing,
      dataReplication,
      cdn,
      performanceOptimizer
    );
  }

  /**
   * Start dashboard data collection
   */
  async start(): Promise<void> {
    logger.info('Starting monitoring dashboard...');

    // Collect initial data
    await this.collectDashboardData();

    // Start periodic refresh
    this.refreshInterval = setInterval(async () => {
      await this.collectDashboardData();
    }, this.config.refreshInterval);

    logger.info('Monitoring dashboard started');
  }

  /**
   * Stop dashboard data collection
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
    logger.info('Monitoring dashboard stopped');
  }

  /**
   * Get current dashboard data
   */
  async getCurrentData(): Promise<DashboardData> {
    return this.dashboardData[this.dashboardData.length - 1] || await this.collectDashboardData();
  }

  /**
   * Get historical dashboard data
   */
  getHistoricalData(duration?: number): DashboardData[] {
    const cutoff = Date.now() - (duration || this.config.historyWindow);
    return this.dashboardData.filter(d => d.timestamp.getTime() > cutoff);
  }

  /**
   * Get real-time metrics stream
   */
  async *streamMetrics(): AsyncGenerator<DashboardData> {
    while (true) {
      yield await this.getCurrentData();
      await new Promise(resolve => setTimeout(resolve, this.config.refreshInterval));
    }
  }

  /**
   * Collect dashboard data
   */
  private async collectDashboardData(): Promise<DashboardData> {
    const [
      systemHealth,
      performanceData,
      securityData,
      infrastructureData,
      sloData,
      anomalies,
      recommendations,
    ] = await Promise.all([
      this.system.getSystemHealth(),
      this.collectPerformanceData(),
      this.collectSecurityData(),
      this.collectInfrastructureData(),
      this.collectSLOData(),
      this.collectAnomalies(),
      this.collectRecommendations(),
    ]);

    const dashboardData: DashboardData = {
      timestamp: new Date(),
      overview: {
        status: systemHealth.status,
        uptime: process.uptime(),
        requestsPerSecond: performanceData.throughput,
        activeUsers: await this.getActiveUserCount(),
        errorRate: performanceData.errorRate,
      },
      performance: performanceData,
      security: securityData,
      infrastructure: infrastructureData,
      slo: sloData,
      anomalies,
      recommendations,
    };

    // Store data
    this.dashboardData.push(dashboardData);

    // Trim old data
    const cutoff = Date.now() - this.config.historyWindow;
    this.dashboardData = this.dashboardData.filter(d => d.timestamp.getTime() > cutoff);

    // Check alerts
    this.checkAlerts(dashboardData);

    return dashboardData;
  }

  /**
   * Collect performance data
   */
  private async collectPerformanceData(): Promise<DashboardData['performance']> {
    const perfDashboard = await this.performanceOptimizer.getDashboardData();
    const current = perfDashboard.current;

    // Get error history
    const errorHistory = this.dashboardData
      .slice(-20)
      .map(d => ({
        time: d.timestamp,
        count: Math.round(d.performance.throughput * d.performance.errorRate),
      }));

    return {
      responseTime: current.responseTime,
      throughput: current.throughput,
      saturation: current.resourceUtilization.cpu / 100,
      errors: errorHistory,
    };
  }

  /**
   * Collect security data
   */
  private async collectSecurityData(): Promise<DashboardData['security']> {
    // Get threat data
    const threats = this.threatDetection.getAnomalyHistory({ limit: 1000 });
    const threatsByType = threats.reduce((acc, t) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get authentication data from audit logs
    const authEvents = this.securityAudit.searchAuditLogs({
      eventType: 'authentication',
      startDate: new Date(Date.now() - 3600000), // Last hour
    });

    const authAttempts = authEvents.length;
    const authFailures = authEvents.filter(e => e.result === 'failure').length;
    const mfaUsage = authEvents.filter(e => e.details.mfaUsed).length;

    // Get compliance data
    const complianceData = await this.compliance.getDashboardData();

    return {
      threats: {
        total: threats.length,
        critical: threats.filter(t => t.severity === 'critical').length,
        byType: threatsByType,
      },
      authentication: {
        attempts: authAttempts,
        failures: authFailures,
        mfaUsage,
      },
      compliance: {
        score: complianceData.overallCompliance,
        frameworks: complianceData.frameworks.map(f => ({
          name: f.name,
          status: f.status,
          score: f.score,
        })),
      },
    };
  }

  /**
   * Collect infrastructure data
   */
  private async collectInfrastructureData(): Promise<DashboardData['infrastructure']> {
    // Get edge data
    const edgeAnalytics = await this.edgeComputing.getPerformanceAnalytics();
    const replicationStatus = this.dataReplication.getReplicationStatus();

    const edgeLocations = Array.from(edgeAnalytics.byLocation.entries()).map(([id, metrics]) => ({
      id,
      region: id.split('-')[1] + '-' + id.split('-')[2],
      status: metrics.errorRate > 0.1 ? 'degraded' : 'healthy',
      latency: metrics.latency.p50,
      load: metrics.cpuUsage,
    }));

    // Get cache data
    const cacheStats = this.cdn.getCacheStats();
    let totalHitRate = 0;
    let totalSize = 0;
    let totalEvictions = 0;

    if (cacheStats instanceof Map) {
      for (const stats of cacheStats.values()) {
        totalHitRate += stats.hitRate;
        totalSize += stats.totalSize;
        totalEvictions += stats.evictionRate;
      }
      totalHitRate /= cacheStats.size;
    }

    // Get resource data
    const perfData = await this.performanceOptimizer.getDashboardData();
    const resources = perfData.current.resourceUtilization;

    return {
      edge: {
        locations: edgeLocations,
        replication: {
          nodes: replicationStatus.nodes.length,
          lag: replicationStatus.totalLag,
          conflicts: replicationStatus.conflicts,
        },
      },
      cache: {
        hitRate: totalHitRate,
        size: totalSize,
        evictions: totalEvictions,
      },
      resources,
    };
  }

  /**
   * Collect SLO data
   */
  private async collectSLOData(): Promise<DashboardData['slo']> {
    const sloStatus = await this.sloMonitoring.getSLOStatus();

    return {
      objectives: sloStatus.map(slo => ({
        name: slo.name,
        target: slo.target,
        current: slo.current,
        errorBudget: slo.errorBudgetRemaining,
        burning: slo.status === 'breaching',
      })),
    };
  }

  /**
   * Collect anomalies
   */
  private async collectAnomalies(): Promise<DashboardData['anomalies']> {
    const recentAnomalies = this.anomalyDetection.getAnomalyHistory({
      limit: 10,
      since: new Date(Date.now() - 3600000), // Last hour
    });

    return recentAnomalies.map(a => ({
      id: a.id,
      type: a.metricName,
      severity: a.anomalyScore > 0.9 ? 'critical' : a.anomalyScore > 0.7 ? 'high' : 'medium',
      description: `${a.metricName} anomaly detected: ${a.value} (expected: ${a.expected})`,
      timestamp: a.timestamp,
    }));
  }

  /**
   * Collect recommendations
   */
  private async collectRecommendations(): Promise<DashboardData['recommendations']> {
    const perfAnalysis = await this.performanceOptimizer.analyzePerformance();
    
    return perfAnalysis.recommendations.map(r => ({
      type: r.type,
      priority: r.priority,
      description: r.description,
      impact: r.impact.performance,
    }));
  }

  /**
   * Get active user count
   */
  private async getActiveUserCount(): Promise<number> {
    // Count unique users from recent audit logs
    const recentEvents = this.securityAudit.searchAuditLogs({
      startDate: new Date(Date.now() - 300000), // Last 5 minutes
    });

    const uniqueUsers = new Set(recentEvents.map(e => e.userId).filter(Boolean));
    return uniqueUsers.size;
  }

  /**
   * Check alerts
   */
  private checkAlerts(data: DashboardData): void {
    const alerts: Array<{ type: string; severity: string; message: string }> = [];

    // Check error rate
    if (data.performance.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push({
        type: 'performance',
        severity: 'high',
        message: `High error rate: ${(data.performance.errorRate * 100).toFixed(2)}%`,
      });
    }

    // Check response time
    if (data.performance.responseTime.p95 > this.config.alertThresholds.responseTime) {
      alerts.push({
        type: 'performance',
        severity: 'medium',
        message: `Slow response time: p95 = ${data.performance.responseTime.p95}ms`,
      });
    }

    // Check availability
    const availability = (1 - data.performance.errorRate) * 100;
    if (availability < this.config.alertThresholds.availability) {
      alerts.push({
        type: 'availability',
        severity: 'critical',
        message: `Low availability: ${availability.toFixed(2)}%`,
      });
    }

    // Check threats
    if (data.security.threats.critical > this.config.alertThresholds.threatCount) {
      alerts.push({
        type: 'security',
        severity: 'critical',
        message: `${data.security.threats.critical} critical threats detected`,
      });
    }

    // Log alerts
    for (const alert of alerts) {
      logger.warn('Dashboard alert triggered', alert);
    }
  }

  /**
   * Export dashboard data
   */
  exportData(format: 'json' | 'csv'): string {
    const data = this.getHistoricalData();

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        // Flatten data for CSV
        const rows = data.map(d => ({
          timestamp: d.timestamp.toISOString(),
          status: d.overview.status,
          rps: d.overview.requestsPerSecond,
          errorRate: d.overview.errorRate,
          responseTimeP95: d.performance.responseTime.p95,
          threats: d.security.threats.total,
          complianceScore: d.security.compliance.score,
          cacheHitRate: d.infrastructure.cache.hitRate,
        }));

        const headers = Object.keys(rows[0]);
        const csv = [
          headers.join(','),
          ...rows.map(r => headers.map(h => (r as any)[h]).join(',')),
        ].join('\n');

        return csv;
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}