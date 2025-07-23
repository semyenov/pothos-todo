import type { SpanOptions } from '@opentelemetry/api';
import { AsyncSingletonService } from '@/lib/base/AsyncSingletonService.js';
import { createLogger } from '@/lib/logger.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { DistributedTracing } from '@/infrastructure/observability/DistributedTracing.js';

const logger = createLogger('ThreatDetectionEngine');

export interface ThreatEvent {
  id: string;
  type: ThreatType;
  severity: ThreatSeverity;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  details: Record<string, any>;
  riskScore: number;
  blocked: boolean;
}

export enum ThreatType {
  BRUTE_FORCE = 'brute_force',
  SQL_INJECTION = 'sql_injection',
  XSS_ATTACK = 'xss_attack',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  SUSPICIOUS_LOGIN = 'suspicious_login',
  DATA_EXFILTRATION = 'data_exfiltration',
  ANOMALOUS_BEHAVIOR = 'anomalous_behavior',
  MALICIOUS_PAYLOAD = 'malicious_payload',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  ACCOUNT_TAKEOVER = 'account_takeover'
}

export enum ThreatSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SecurityRule {
  id: string;
  name: string;
  type: ThreatType;
  enabled: boolean;
  riskScore: number;
  threshold: number;
  timeWindow: number; // in milliseconds
  actions: SecurityAction[];
  conditions: SecurityCondition[];
}

export interface SecurityAction {
  type: 'block' | 'alert' | 'captcha' | 'rate_limit' | 'quarantine';
  params: Record<string, any>;
}

export interface SecurityCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'greater_than' | 'less_than';
  value: any;
}

export interface ThreatAnalysis {
  threatId: string;
  riskScore: number;
  confidence: number;
  recommendations: string[];
  patterns: DetectedPattern[];
  mitigation: MitigationAction[];
}

export interface DetectedPattern {
  type: string;
  description: string;
  frequency: number;
  timespan: number;
}

export interface MitigationAction {
  action: string;
  priority: number;
  automated: boolean;
  description: string;
}

export interface SecurityMetrics {
  totalThreats: number;
  threatsBlocked: number;
  averageRiskScore: number;
  topThreatTypes: Array<{ type: ThreatType; count: number }>;
  falsePositives: number;
  responseTime: number;
}

export class ThreatDetectionEngine extends AsyncSingletonService<ThreatDetectionEngine> {
  private redis!: RedisClusterManager;
  private tracing!: DistributedTracing;
  private rules: Map<string, SecurityRule> = new Map();
  private behaviorBaselines: Map<string, UserBehaviorBaseline> = new Map();
  private mlModels: Map<string, any> = new Map();

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<ThreatDetectionEngine> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.redis = RedisClusterManager.getInstance();
      this.tracing = await DistributedTracing.getInstance();
      
      await this.loadSecurityRules();
      await this.initializeBehaviorBaselines();
      await this.loadMLModels();
      
      logger.info('ThreatDetectionEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ThreatDetectionEngine:', error);
      throw error;
    }
  }

  async detectThreats(request: SecurityRequest): Promise<ThreatAnalysis | null> {
    const spanOptions: SpanOptions = {
      attributes: {
        'security.request_id': request.id,
        'security.user_id': request.userId,
        'security.ip_address': request.ipAddress
      }
    };

    return this.tracing.traceAsync('threat_detection', spanOptions, async () => {
      try {
        const threats: ThreatEvent[] = [];
        
        // Run all detection rules
        for (const rule of this.rules.values()) {
          if (!rule.enabled) continue;
          
          const threat = await this.evaluateRule(rule, request);
          if (threat) {
            threats.push(threat);
          }
        }

        // Behavioral analysis
        const behaviorThreat = await this.analyzeBehavior(request);
        if (behaviorThreat) {
          threats.push(behaviorThreat);
        }

        // ML-based detection
        const mlThreats = await this.runMLDetection(request);
        threats.push(...mlThreats);

        if (threats.length === 0) {
          return null;
        }

        // Aggregate and analyze threats
        const analysis = await this.analyzeThreatCollection(threats);
        
        // Store threats for historical analysis
        await this.storeThreatEvents(threats);
        
        // Execute mitigation actions
        await this.executeMitigation(analysis);

        return analysis;
      } catch (error) {
        logger.error('Threat detection failed:', error);
        throw error;
      }
    });
  }

  async addSecurityRule(rule: SecurityRule): Promise<void> {
    try {
      this.rules.set(rule.id, rule);
      await this.redis.setObject(`security:rule:${rule.id}`, rule, 86400000); // 24 hours
      
      logger.info(`Security rule added: ${rule.name} (${rule.id})`);
    } catch (error) {
      logger.error('Failed to add security rule:', error);
      throw error;
    }
  }

  async updateSecurityRule(ruleId: string, updates: Partial<SecurityRule>): Promise<void> {
    try {
      const existing = this.rules.get(ruleId);
      if (!existing) {
        throw new Error(`Security rule not found: ${ruleId}`);
      }

      const updated = { ...existing, ...updates };
      this.rules.set(ruleId, updated);
      await this.redis.setObject(`security:rule:${ruleId}`, updated, 86400000);
      
      logger.info(`Security rule updated: ${ruleId}`);
    } catch (error) {
      logger.error('Failed to update security rule:', error);
      throw error;
    }
  }

  async getSecurityMetrics(timeRange: number = 3600000): Promise<SecurityMetrics> {
    try {
      const startTime = Date.now() - timeRange;
      const threatEvents = await this.getThreatEventsByTimeRange(startTime, Date.now());
      
      const metrics: SecurityMetrics = {
        totalThreats: threatEvents.length,
        threatsBlocked: threatEvents.filter(t => t.blocked).length,
        averageRiskScore: threatEvents.reduce((sum, t) => sum + t.riskScore, 0) / threatEvents.length || 0,
        topThreatTypes: this.calculateTopThreatTypes(threatEvents),
        falsePositives: await this.calculateFalsePositives(threatEvents),
        responseTime: await this.calculateAverageResponseTime(timeRange)
      };

      return metrics;
    } catch (error) {
      logger.error('Failed to get security metrics:', error);
      throw error;
    }
  }

  async createUserBehaviorBaseline(userId: string): Promise<void> {
    try {
      const userActions = await this.getUserActionHistory(userId, 30); // 30 days
      const baseline = this.calculateBehaviorBaseline(userActions);
      
      this.behaviorBaselines.set(userId, baseline);
      await this.redis.setObject(`security:baseline:${userId}`, baseline, 86400000 * 30); // 30 days
      
      logger.info(`Behavior baseline created for user: ${userId}`);
    } catch (error) {
      logger.error('Failed to create behavior baseline:', error);
      throw error;
    }
  }

  private async evaluateRule(rule: SecurityRule, request: SecurityRequest): Promise<ThreatEvent | null> {
    try {
      // Check all conditions
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(condition, request)) {
          return null;
        }
      }

      // Count recent events of this type
      const recentEvents = await this.getRecentEventCount(rule.type, request.ipAddress, rule.timeWindow);
      
      if (recentEvents >= rule.threshold) {
        const threat: ThreatEvent = {
          id: this.generateThreatId(),
          type: rule.type,
          severity: this.calculateSeverity(rule.riskScore),
          userId: request.userId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          timestamp: new Date(),
          details: { rule: rule.id, recentEvents, threshold: rule.threshold },
          riskScore: rule.riskScore,
          blocked: rule.actions.some(a => a.type === 'block')
        };

        return threat;
      }

      return null;
    } catch (error) {
      logger.error('Failed to evaluate security rule:', error);
      return null;
    }
  }

  private async analyzeBehavior(request: SecurityRequest): Promise<ThreatEvent | null> {
    if (!request.userId) return null;

    try {
      const baseline = this.behaviorBaselines.get(request.userId);
      if (!baseline) return null;

      const currentBehavior = this.extractBehaviorFeatures(request);
      const anomalyScore = this.calculateAnomalyScore(baseline, currentBehavior);

      if (anomalyScore > 0.8) { // High anomaly threshold
        return {
          id: this.generateThreatId(),
          type: ThreatType.ANOMALOUS_BEHAVIOR,
          severity: ThreatSeverity.MEDIUM,
          userId: request.userId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          timestamp: new Date(),
          details: { anomalyScore, baseline: baseline.summary },
          riskScore: Math.floor(anomalyScore * 100),
          blocked: anomalyScore > 0.9
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to analyze behavior:', error);
      return null;
    }
  }

  private async runMLDetection(request: SecurityRequest): Promise<ThreatEvent[]> {
    const threats: ThreatEvent[] = [];
    
    try {
      // Payload analysis for injection attacks
      const payloadThreat = await this.detectMaliciousPayload(request);
      if (payloadThreat) threats.push(payloadThreat);

      // Pattern analysis for known attack signatures
      const patternThreat = await this.detectAttackPatterns(request);
      if (patternThreat) threats.push(patternThreat);

      return threats;
    } catch (error) {
      logger.error('ML detection failed:', error);
      return threats;
    }
  }

  private async analyzeThreatCollection(threats: ThreatEvent[]): Promise<ThreatAnalysis> {
    const totalRiskScore = threats.reduce((sum, t) => sum + t.riskScore, 0);
    const maxSeverity = Math.max(...threats.map(t => this.severityToNumber(t.severity)));
    
    const patterns = this.identifyThreatPatterns(threats);
    const recommendations = this.generateRecommendations(threats, patterns);
    const mitigation = this.planMitigation(threats);

    return {
      threatId: this.generateThreatId(),
      riskScore: Math.min(100, totalRiskScore),
      confidence: this.calculateConfidence(threats),
      recommendations,
      patterns,
      mitigation
    };
  }

  private async executeMitigation(analysis: ThreatAnalysis): Promise<void> {
    for (const action of analysis.mitigation) {
      if (action.automated) {
        try {
          await this.executeMitigationAction(action);
          logger.info(`Executed mitigation action: ${action.action}`);
        } catch (error) {
          logger.error(`Failed to execute mitigation action: ${action.action}`, error);
        }
      }
    }
  }

  private async loadSecurityRules(): Promise<void> {
    const defaultRules: SecurityRule[] = [
      {
        id: 'brute_force_login',
        name: 'Brute Force Login Detection',
        type: ThreatType.BRUTE_FORCE,
        enabled: true,
        riskScore: 80,
        threshold: 5,
        timeWindow: 300000, // 5 minutes
        actions: [{ type: 'block', params: { duration: 3600000 } }],
        conditions: [{ field: 'endpoint', operator: 'equals', value: '/auth/login' }]
      },
      {
        id: 'rate_limit_api',
        name: 'API Rate Limit',
        type: ThreatType.RATE_LIMIT_EXCEEDED,
        enabled: true,
        riskScore: 60,
        threshold: 100,
        timeWindow: 60000, // 1 minute
        actions: [{ type: 'rate_limit', params: { requests: 10, window: 60000 } }],
        conditions: [{ field: 'endpoint', operator: 'contains', value: '/api/' }]
      }
    ];

    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
    }
  }

  private async initializeBehaviorBaselines(): Promise<void> {
    // Initialize with empty baselines - will be populated as users interact
    logger.info('Behavior baselines initialized');
  }

  private async loadMLModels(): Promise<void> {
    // Placeholder for ML model loading
    logger.info('ML models loaded');
  }

  private generateThreatId(): string {
    return `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private evaluateCondition(condition: SecurityCondition, request: SecurityRequest): boolean {
    const value = this.getRequestField(request, condition.field);
    
    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'matches':
        return new RegExp(condition.value).test(String(value));
      case 'greater_than':
        return Number(value) > Number(condition.value);
      case 'less_than':
        return Number(value) < Number(condition.value);
      default:
        return false;
    }
  }

  private getRequestField(request: SecurityRequest, field: string): any {
    const fields: Record<string, any> = {
      'endpoint': request.endpoint,
      'method': request.method,
      'ip_address': request.ipAddress,
      'user_agent': request.userAgent,
      'user_id': request.userId,
      'payload_size': request.payload?.length || 0
    };
    
    return fields[field];
  }

  private calculateSeverity(riskScore: number): ThreatSeverity {
    if (riskScore >= 90) return ThreatSeverity.CRITICAL;
    if (riskScore >= 70) return ThreatSeverity.HIGH;
    if (riskScore >= 40) return ThreatSeverity.MEDIUM;
    return ThreatSeverity.LOW;
  }

  private severityToNumber(severity: ThreatSeverity): number {
    const map = {
      [ThreatSeverity.LOW]: 1,
      [ThreatSeverity.MEDIUM]: 2,
      [ThreatSeverity.HIGH]: 3,
      [ThreatSeverity.CRITICAL]: 4
    };
    return map[severity];
  }

  private async getRecentEventCount(type: ThreatType, ipAddress: string, timeWindow: number): Promise<number> {
    const key = `security:events:${type}:${ipAddress}`;
    const events = await this.redis.getList(key) || [];
    const cutoff = Date.now() - timeWindow;
    return events.filter(e => e.timestamp > cutoff).length;
  }

  private async storeThreatEvents(threats: ThreatEvent[]): Promise<void> {
    for (const threat of threats) {
      const key = `security:events:${threat.type}:${threat.ipAddress}`;
      await this.redis.listPush(key, { ...threat, timestamp: threat.timestamp.getTime() });
      await this.redis.expire(key, 86400); // 24 hours
    }
  }

  private async getThreatEventsByTimeRange(start: number, end: number): Promise<ThreatEvent[]> {
    // Implementation would query stored threat events
    return [];
  }

  private calculateTopThreatTypes(events: ThreatEvent[]): Array<{ type: ThreatType; count: number }> {
    const counts = new Map<ThreatType, number>();
    
    for (const event of events) {
      counts.set(event.type, (counts.get(event.type) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private async calculateFalsePositives(events: ThreatEvent[]): Promise<number> {
    // Implementation would analyze false positive rates
    return 0;
  }

  private async calculateAverageResponseTime(timeRange: number): Promise<number> {
    // Implementation would calculate average threat response time
    return 0;
  }

  private async getUserActionHistory(userId: string, days: number): Promise<UserAction[]> {
    // Implementation would get user action history
    return [];
  }

  private calculateBehaviorBaseline(actions: UserAction[]): UserBehaviorBaseline {
    return {
      summary: 'baseline',
      patterns: {},
      averageSessionDuration: 0,
      typicalAccessTimes: [],
      commonEndpoints: [],
      averageRequestsPerSession: 0
    };
  }

  private extractBehaviorFeatures(request: SecurityRequest): any {
    return {
      hour: new Date().getHours(),
      endpoint: request.endpoint,
      method: request.method
    };
  }

  private calculateAnomalyScore(baseline: UserBehaviorBaseline, current: any): number {
    // Simplified anomaly detection
    return Math.random() * 0.5; // Placeholder
  }

  private async detectMaliciousPayload(request: SecurityRequest): Promise<ThreatEvent | null> {
    if (!request.payload) return null;
    
    const maliciousPatterns = [
      /union\s+select/i,
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/i,
      /eval\s*\(/i
    ];
    
    for (const pattern of maliciousPatterns) {
      if (pattern.test(request.payload)) {
        return {
          id: this.generateThreatId(),
          type: ThreatType.MALICIOUS_PAYLOAD,
          severity: ThreatSeverity.HIGH,
          userId: request.userId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          timestamp: new Date(),
          details: { pattern: pattern.source, payload: request.payload.substring(0, 100) },
          riskScore: 85,
          blocked: true
        };
      }
    }
    
    return null;
  }

  private async detectAttackPatterns(request: SecurityRequest): Promise<ThreatEvent | null> {
    // Implementation would use ML models to detect attack patterns
    return null;
  }

  private identifyThreatPatterns(threats: ThreatEvent[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    
    const typeGroups = new Map<ThreatType, ThreatEvent[]>();
    for (const threat of threats) {
      if (!typeGroups.has(threat.type)) {
        typeGroups.set(threat.type, []);
      }
      typeGroups.get(threat.type)!.push(threat);
    }
    
    for (const [type, groupThreats] of typeGroups) {
      if (groupThreats.length > 1) {
        patterns.push({
          type: `repeated_${type}`,
          description: `Multiple ${type} threats detected`,
          frequency: groupThreats.length,
          timespan: Math.max(...groupThreats.map(t => t.timestamp.getTime())) - 
                   Math.min(...groupThreats.map(t => t.timestamp.getTime()))
        });
      }
    }
    
    return patterns;
  }

  private generateRecommendations(threats: ThreatEvent[], patterns: DetectedPattern[]): string[] {
    const recommendations: string[] = [];
    
    const highRiskThreats = threats.filter(t => t.riskScore > 80);
    if (highRiskThreats.length > 0) {
      recommendations.push('Immediately review high-risk threats and consider blocking affected IPs');
    }
    
    const bruteForceThreats = threats.filter(t => t.type === ThreatType.BRUTE_FORCE);
    if (bruteForceThreats.length > 0) {
      recommendations.push('Implement account lockout policies and consider MFA requirements');
    }
    
    if (patterns.length > 2) {
      recommendations.push('Coordinated attack detected - consider implementing IP blocking and rate limiting');
    }
    
    return recommendations;
  }

  private planMitigation(threats: ThreatEvent[]): MitigationAction[] {
    const actions: MitigationAction[] = [];
    
    const criticalThreats = threats.filter(t => t.severity === ThreatSeverity.CRITICAL);
    if (criticalThreats.length > 0) {
      actions.push({
        action: 'block_ip_addresses',
        priority: 1,
        automated: true,
        description: 'Block IP addresses associated with critical threats'
      });
    }
    
    const bruteForceThreats = threats.filter(t => t.type === ThreatType.BRUTE_FORCE);
    if (bruteForceThreats.length > 0) {
      actions.push({
        action: 'enable_account_lockout',
        priority: 2,
        automated: true,
        description: 'Enable account lockout for affected accounts'
      });
    }
    
    return actions.sort((a, b) => a.priority - b.priority);
  }

  private async executeMitigationAction(action: MitigationAction): Promise<void> {
    switch (action.action) {
      case 'block_ip_addresses':
        // Implementation would block IPs
        break;
      case 'enable_account_lockout':
        // Implementation would enable account lockout
        break;
      default:
        logger.warn(`Unknown mitigation action: ${action.action}`);
    }
  }

  private calculateConfidence(threats: ThreatEvent[]): number {
    const avgRiskScore = threats.reduce((sum, t) => sum + t.riskScore, 0) / threats.length;
    return Math.min(100, avgRiskScore + (threats.length * 5));
  }
}

interface SecurityRequest {
  id: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  endpoint: string;
  method: string;
  payload?: string;
  headers: Record<string, string>;
  timestamp: Date;
}

interface UserBehaviorBaseline {
  summary: string;
  patterns: Record<string, any>;
  averageSessionDuration: number;
  typicalAccessTimes: number[];
  commonEndpoints: string[];
  averageRequestsPerSession: number;
}

interface UserAction {
  userId: string;
  action: string;
  timestamp: Date;
  details: Record<string, any>;
}