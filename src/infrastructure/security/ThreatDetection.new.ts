import { createHash } from 'crypto';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { ThreatDetectionEventMap } from '../core/ServiceEventMaps.security.js';
import { 
  ServiceConfig, 
  Metric, 
  HealthCheck,
  Cache,
  RateLimit 
} from '../core/decorators/ServiceDecorators.js';
import { 
  SecurityAudit,
  AccessControl,
  SecurityRateLimit,
  ThreatDetection as ThreatDetectionDecorator,
  SecurityMonitored 
} from '../core/decorators/SecurityDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { performance } from 'perf_hooks';

/**
 * Threat detection service configuration schema
 */
const ThreatDetectionConfigSchema = z.object({
  serviceName: z.string().default('pothos-todo'),
  environment: z.string().default('development'),
  
  // Detection capabilities
  detection: z.object({
    enableRealTime: z.boolean().default(true),
    enableML: z.boolean().default(true),
    enableBehavioralAnalysis: z.boolean().default(true),
    enableCorrelation: z.boolean().default(true),
    enableThreatIntelligence: z.boolean().default(true),
  }),

  // ML and AI configuration
  ml: z.object({
    modelPath: z.string().optional(),
    confidence: z.object({
      minThreshold: z.number().default(0.6),
      highThreshold: z.number().default(0.8),
      criticalThreshold: z.number().default(0.9),
    }),
    retraining: z.object({
      enabled: z.boolean().default(true),
      interval: z.number().default(86400000), // 24 hours
      minSamples: z.number().default(1000),
    }),
  }),

  // Behavioral analysis
  behavioral: z.object({
    profileBuildingPeriod: z.number().default(2592000000), // 30 days
    minEventsForProfile: z.number().default(100),
    anomalyThreshold: z.number().default(0.7),
    adaptiveThresholds: z.boolean().default(true),
  }),

  // Event processing
  events: z.object({
    maxStoredEvents: z.number().default(100000),
    retentionPeriod: z.number().default(604800000), // 7 days
    batchProcessingSize: z.number().default(100),
    processingInterval: z.number().default(5000), // 5 seconds
  }),

  // Threat intelligence
  intelligence: z.object({
    enableFeeds: z.boolean().default(true),
    updateInterval: z.number().default(3600000), // 1 hour
    sources: z.array(z.string()).default(['internal', 'misp', 'otx']),
    cacheSize: z.number().default(10000),
  }),

  // Response and mitigation
  response: z.object({
    autoMitigation: z.boolean().default(true),
    autoBlocking: z.boolean().default(false),
    escalationThreshold: z.number().default(0.85),
    notificationChannels: z.array(z.string()).default(['log', 'alert']),
  }),

  // Performance and limits
  performance: z.object({
    maxConcurrentAnalysis: z.number().default(10),
    analysisTimeout: z.number().default(5000),
    cacheEventResults: z.boolean().default(true),
    enableMetrics: z.boolean().default(true),
  }),
});

export type ThreatDetectionConfig = z.infer<typeof ThreatDetectionConfigSchema>;

/**
 * Threat types enumeration
 */
export type ThreatType = 
  | 'malware' 
  | 'intrusion' 
  | 'anomaly' 
  | 'vulnerability' 
  | 'data_exfiltration' 
  | 'privilege_escalation'
  | 'brute_force'
  | 'injection'
  | 'xss'
  | 'csrf'
  | 'dos'
  | 'malicious_payload'
  | 'unauthorized_access'
  | 'insider_threat'
  | 'apt'
  | 'zero_day';

/**
 * Threat severity levels
 */
export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Threat indicator interface
 */
export interface ThreatIndicator {
  id: string;
  type: ThreatType;
  severity: ThreatSeverity;
  confidence: number;
  timestamp: Date;
  source: string;
  target?: string;
  description: string;
  details: Record<string, any>;
  indicators: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  metadata: Record<string, any>;
  mitigationActions?: string[];
  relatedThreats?: string[];
}

/**
 * Security event interface
 */
export interface SecurityEvent {
  id: string;
  type: string;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  payload?: any;
  headers?: Record<string, string>;
  response?: {
    statusCode: number;
    size: number;
    duration: number;
  };
  geolocation?: {
    country: string;
    region: string;
    city: string;
    coordinates?: [number, number];
  };
  deviceFingerprint?: string;
  riskScore?: number;
}

/**
 * Behavioral profile interface
 */
export interface BehaviorProfile {
  userId: string;
  createdAt: Date;
  lastUpdated: Date;
  eventCount: number;
  patterns: {
    accessTimes: {
      hours: number[];
      daysOfWeek: number[];
      timezone: string;
    };
    resources: {
      common: string[];
      frequencies: Record<string, number>;
    };
    devices: {
      fingerprints: string[];
      userAgents: string[];
    };
    geolocation: {
      countries: string[];
      cities: string[];
    };
    behavior: {
      sessionDuration: { mean: number; stdDev: number };
      requestRate: { mean: number; stdDev: number };
      dataVolume: { mean: number; stdDev: number };
      errorRate: { mean: number; stdDev: number };
    };
  };
  anomalyHistory: Array<{
    timestamp: Date;
    type: string;
    score: number;
  }>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Threat intelligence interface
 */
export interface ThreatIntelligence {
  indicators: Map<string, {
    type: 'ip' | 'domain' | 'hash' | 'url' | 'email';
    value: string;
    confidence: number;
    source: string;
    firstSeen: Date;
    lastSeen: Date;
    tags: string[];
  }>;
  signatures: Map<string, {
    id: string;
    pattern: string | RegExp;
    type: ThreatType;
    confidence: number;
    source: string;
    metadata: Record<string, any>;
  }>;
  attackPatterns: Map<string, {
    id: string;
    name: string;
    tactics: string[];
    techniques: string[];
    indicators: string[];
    mitigations: string[];
  }>;
}

/**
 * Threat analysis result interface
 */
export interface ThreatAnalysisResult {
  threatId: string;
  analysisId: string;
  riskScore: number;
  attackVector: string[];
  potentialImpact: string;
  recommendedActions: string[];
  confidence: number;
  timeline: Array<{
    timestamp: Date;
    event: string;
    significance: number;
  }>;
  correlatedEvents: string[];
  mitigationPlan: Array<{
    action: string;
    priority: 'immediate' | 'high' | 'medium' | 'low';
    automated: boolean;
    estimated_duration: number;
  }>;
}

/**
 * Enhanced Threat Detection Service using the new base service architecture
 * 
 * Features:
 * - Real-time threat detection with ML and behavioral analysis
 * - Advanced pattern recognition and signature matching
 * - Behavioral profiling and anomaly detection
 * - Threat intelligence integration and correlation
 * - Automated response and mitigation
 * - Comprehensive threat analytics and reporting
 * 
 * @example
 * ```typescript
 * const threatDetection = ThreatDetectionService.getInstance();
 * 
 * // Listen to threat events
 * threatDetection.on('threat:detected', ({ threatId, type, severity }) => {
 *   console.log(`Threat detected: ${type} with severity ${severity}`);
 * });
 * 
 * // Analyze security events
 * const threats = await threatDetection.analyzeEvent({
 *   id: 'event_123',
 *   type: 'web_request',
 *   timestamp: new Date(),
 *   ipAddress: '192.168.1.100',
 *   userAgent: 'Mozilla/5.0...',
 *   resource: '/api/users',
 *   action: 'GET',
 *   payload: { query: 'SELECT * FROM users' }
 * });
 * 
 * // Get threat intelligence
 * const intelligence = await threatDetection.getThreatIntelligence('ip', '192.168.1.100');
 * 
 * // Analyze user behavior
 * const riskAssessment = await threatDetection.assessUserRisk('user123');
 * ```
 */
@ServiceConfig({
  schema: ThreatDetectionConfigSchema,
  prefix: 'threat',
  hot: true, // Allow hot reload for configuration changes
})
export class ThreatDetectionService extends BaseService<ThreatDetectionConfig, ThreatDetectionEventMap> {
  private securityEvents: SecurityEvent[] = [];
  private detectedThreats: Map<string, ThreatIndicator> = new Map();
  private behaviorProfiles: Map<string, BehaviorProfile> = new Map();
  private threatIntelligence: ThreatIntelligence = {
    indicators: new Map(),
    signatures: new Map(),
    attackPatterns: new Map(),
  };
  private mlModels: Map<string, any> = new Map();
  private processingQueue: SecurityEvent[] = [];
  private analysisInProgress = 0;
  private threatsDetected = 0;
  private threatsBlocked = 0;
  private falsePositives = 0;
  private analysisStats: Map<string, { count: number; avgDuration: number; totalDuration: number }> = new Map();

  /**
   * Get the singleton instance
   */
  static override getInstance(): ThreatDetectionService {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'threat-detection';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Advanced threat detection service with ML and behavioral analysis';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('ThreatDetectionService initializing with config:', {
      realTimeDetection: this.config.detection.enableRealTime,
      mlEnabled: this.config.detection.enableML,
      behavioralAnalysis: this.config.detection.enableBehavioralAnalysis,
      threatIntelligence: this.config.detection.enableThreatIntelligence,
    });

    // Initialize threat intelligence
    await this.initializeThreatIntelligence();

    // Initialize ML models if enabled
    if (this.config.detection.enableML) {
      await this.initializeMLModels();
    }
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Start background processing
    this.startBackgroundProcessing();

    // Start threat intelligence updates
    if (this.config.intelligence.enableFeeds) {
      this.startThreatIntelligenceUpdates();
    }

    // Start ML model retraining if enabled
    if (this.config.ml.retraining.enabled) {
      this.startMLRetraining();
    }

    logger.info('ThreatDetectionService started successfully');
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    try {
      // Process remaining events
      await this.processQueuedEvents();

      // Clear collections
      this.securityEvents = [];
      this.processingQueue = [];
      this.detectedThreats.clear();
      this.analysisStats.clear();

      logger.info('ThreatDetectionService stopped successfully');
    } catch (error) {
      logger.error('Error stopping ThreatDetectionService:', error);
    }
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: ThreatDetectionConfig): Promise<void> {
    // Update ML thresholds
    if (newConfig.ml.confidence.minThreshold !== this.config.ml.confidence.minThreshold) {
      logger.info('ML confidence thresholds updated');
    }

    // Reinitialize threat intelligence if sources changed
    if (JSON.stringify(newConfig.intelligence.sources) !== JSON.stringify(this.config.intelligence.sources)) {
      logger.info('Threat intelligence sources changed, reinitializing');
      await this.initializeThreatIntelligence();
    }
  }

  /**
   * Health check for threat detection system
   */
  @HealthCheck({
    name: 'threat:detection-system',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkDetectionSystem(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const queueSize = this.processingQueue.length;
      const activeAnalysis = this.analysisInProgress;
      
      if (queueSize > this.config.events.maxStoredEvents * 0.9) {
        return {
          status: 'unhealthy',
          message: `Event queue too full: ${queueSize}/${this.config.events.maxStoredEvents}`,
        };
      }

      if (activeAnalysis > this.config.performance.maxConcurrentAnalysis) {
        return {
          status: 'unhealthy',
          message: `Too many concurrent analyses: ${activeAnalysis}/${this.config.performance.maxConcurrentAnalysis}`,
        };
      }

      return {
        status: 'healthy',
        message: `Detection system healthy (${queueSize} queued, ${activeAnalysis} active)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Detection system check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for ML models
   */
  @HealthCheck({
    name: 'threat:ml-models',
    critical: false,
    interval: 60000,
  })
  async checkMLModels(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    if (!this.config.detection.enableML) {
      return { status: 'healthy', message: 'ML disabled' };
    }

    const modelCount = this.mlModels.size;
    if (modelCount === 0) {
      return {
        status: 'degraded',
        message: 'No ML models loaded',
      };
    }

    return {
      status: 'healthy',
      message: `ML models healthy (${modelCount} loaded)`,
    };
  }

  /**
   * Analyze security event for threats
   */
  @Metric({ name: 'threat.event-analyzed', recordDuration: true })
  @SecurityAudit({
    eventType: 'threat_analysis',
    sensitivity: 'internal',
    complianceFrameworks: ['iso27001'],
  })
  @SecurityRateLimit({
    maxRequests: 1000,
    windowMs: 60000,
    keyGenerator: 'ip',
  })
  public async analyzeEvent(event: SecurityEvent): Promise<ThreatIndicator[]> {
    // Add to processing queue
    this.processingQueue.push(event);

    // Limit queue size
    if (this.processingQueue.length > this.config.events.maxStoredEvents) {
      this.processingQueue = this.processingQueue.slice(-this.config.events.maxStoredEvents);
    }

    // Process immediately if real-time detection is enabled
    if (this.config.detection.enableRealTime) {
      return await this.processEvent(event);
    }

    return [];
  }

  /**
   * Get threat intelligence for specific indicator
   */
  @Metric({ name: 'threat.intelligence-queried', recordDuration: true })
  @Cache({ ttl: 300000, maxSize: 1000 }) // 5 minutes cache
  public getThreatIntelligence(
    type: 'ip' | 'domain' | 'hash' | 'url' | 'email',
    value: string
  ): any {
    const key = `${type}:${value}`;
    const intelligence = this.threatIntelligence.indicators.get(key);

    if (intelligence) {
      return {
        found: true,
        type: intelligence.type,
        confidence: intelligence.confidence,
        source: intelligence.source,
        firstSeen: intelligence.firstSeen,
        lastSeen: intelligence.lastSeen,
        tags: intelligence.tags,
      };
    }

    return { found: false };
  }

  /**
   * Assess user risk based on behavioral profile
   */
  @Metric({ name: 'threat.risk-assessed', recordDuration: true })
  @SecurityMonitored({
    audit: {
      sensitivity: 'confidential',
      complianceFrameworks: ['gdpr'],
    },
    accessControl: {
      requiredPermissions: ['read:user_profiles'],
    },
  })
  public async assessUserRisk(userId: string): Promise<{
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    factors: Array<{
      factor: string;
      impact: number;
      description: string;
    }>;
    recommendations: string[];
  }> {
    const profile = this.behaviorProfiles.get(userId);
    
    if (!profile) {
      return {
        riskLevel: 'medium',
        score: 0.5,
        factors: [{ factor: 'no_profile', impact: 0.5, description: 'No behavioral profile available' }],
        recommendations: ['Establish behavioral baseline'],
      };
    }

    const riskFactors = this.calculateRiskFactors(profile);
    const score = riskFactors.reduce((sum, factor) => sum + factor.impact, 0) / riskFactors.length;
    
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (score < 0.3) riskLevel = 'low';
    else if (score < 0.6) riskLevel = 'medium';
    else if (score < 0.8) riskLevel = 'high';
    else riskLevel = 'critical';

    const recommendations = this.generateRiskRecommendations(riskLevel, riskFactors);

    return {
      riskLevel,
      score,
      factors: riskFactors,
      recommendations,
    };
  }

  /**
   * Create or update behavioral profile
   */
  @Metric({ name: 'threat.profile-updated' })
  public async updateBehaviorProfile(userId: string, event: SecurityEvent): Promise<void> {
    let profile = this.behaviorProfiles.get(userId);

    if (!profile) {
      profile = this.createNewBehaviorProfile(userId);
      this.behaviorProfiles.set(userId, profile);
    }

    // Update profile with new event
    this.updateProfileWithEvent(profile, event);

    // Calculate new risk level
    const riskAssessment = await this.assessUserRisk(userId);
    profile.riskLevel = riskAssessment.riskLevel;
    profile.lastUpdated = new Date();
    profile.eventCount++;

    logger.debug('Behavior profile updated', {
      userId,
      eventCount: profile.eventCount,
      riskLevel: profile.riskLevel,
    });
  }

  /**
   * Get comprehensive threat analysis
   */
  @Metric({ name: 'threat.analysis-performed', recordDuration: true })
  public async performThreatAnalysis(threatId: string): Promise<ThreatAnalysisResult> {
    const threat = this.detectedThreats.get(threatId);
    if (!threat) {
      throw new Error(`Threat ${threatId} not found`);
    }

    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Perform comprehensive analysis
    const analysis: ThreatAnalysisResult = {
      threatId,
      analysisId,
      riskScore: this.calculateThreatRiskScore(threat),
      attackVector: this.identifyAttackVectors(threat),
      potentialImpact: this.assessPotentialImpact(threat),
      recommendedActions: this.generateRecommendedActions(threat),
      confidence: threat.confidence,
      timeline: await this.buildThreatTimeline(threat),
      correlatedEvents: this.findCorrelatedEvents(threat),
      mitigationPlan: this.createMitigationPlan(threat),
    };

    this.emit('threat:analysis-completed', {
      threatId,
      analysis: {
        riskScore: analysis.riskScore,
        attackVector: analysis.attackVector,
        potentialImpact: analysis.potentialImpact,
        recommendedActions: analysis.recommendedActions,
      },
      duration: 0,
    });

    return analysis;
  }

  /**
   * Report false positive to improve detection
   */
  @Metric({ name: 'threat.false-positive-reported' })
  @SecurityAudit({
    eventType: 'false_positive_feedback',
    sensitivity: 'internal',
  })
  public reportFalsePositive(
    threatId: string,
    analyst: string,
    reason: string,
    feedback?: Record<string, any>
  ): void {
    const threat = this.detectedThreats.get(threatId);
    if (!threat) {
      throw new Error(`Threat ${threatId} not found`);
    }

    this.falsePositives++;

    this.emit('threat:false-positive', {
      threatId,
      reason,
      analyst,
      feedback: feedback || {},
    });

    // Update ML models with false positive feedback
    if (this.config.detection.enableML) {
      this.updateMLModelsWithFeedback(threat, 'false_positive', feedback);
    }

    logger.info('False positive reported', {
      threatId,
      analyst,
      reason,
      threatType: threat.type,
    });
  }

  /**
   * Get service statistics
   */
  public getServiceStatistics() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    
    return {
      threatsDetected: this.threatsDetected,
      threatsBlocked: this.threatsBlocked,
      falsePositives: this.falsePositives,
      activeThreats: this.detectedThreats.size,
      behaviorProfiles: this.behaviorProfiles.size,
      threatIntelligenceIndicators: this.threatIntelligence.indicators.size,
      threatIntelligenceSignatures: this.threatIntelligence.signatures.size,
      queuedEvents: this.processingQueue.length,
      concurrentAnalysis: this.analysisInProgress,
      mlModelsLoaded: this.mlModels.size,
      uptime,
      eventsPerSecond: this.securityEvents.length / (uptime / 1000),
      detectionRate: this.securityEvents.length > 0 ? this.threatsDetected / this.securityEvents.length : 0,
      falsePositiveRate: this.threatsDetected > 0 ? this.falsePositives / this.threatsDetected : 0,
      analysisStatistics: Object.fromEntries(this.analysisStats),
    };
  }

  /**
   * Private helper methods
   */

  private async processEvent(event: SecurityEvent): Promise<ThreatIndicator[]> {
    if (this.analysisInProgress >= this.config.performance.maxConcurrentAnalysis) {
      // Queue for later processing
      return [];
    }

    this.analysisInProgress++;
    const startTime = performance.now();

    try {
      const threats: ThreatIndicator[] = [];

      // Store event
      this.securityEvents.push(event);
      this.pruneOldEvents();

      // Update behavioral profile if user ID available
      if (event.userId) {
        await this.updateBehaviorProfile(event.userId, event);
      }

      // Run detection modules in parallel
      const detectionPromises = [
        this.detectInjectionAttacks(event),
        this.detectBruteForceAttacks(event),
        this.detectAnomalousBehavior(event),
        this.detectDataExfiltration(event),
        this.detectMaliciousPayloads(event),
        this.detectPrivilegeEscalation(event),
        this.detectInsiderThreats(event),
      ];

      if (this.config.detection.enableML) {
        detectionPromises.push(this.runMLDetection(event));
      }

      const detectionResults = await Promise.allSettled(detectionPromises);

      // Collect successful results
      for (const result of detectionResults) {
        if (result.status === 'fulfilled' && result.value) {
          const detected = Array.isArray(result.value) ? result.value : [result.value];
          threats.push(...detected.filter(Boolean));
        }
      }

      // Correlate threats if enabled
      if (this.config.detection.enableCorrelation && threats.length > 0) {
        const correlatedThreats = await this.correlateThreats(event, threats);
        threats.push(...correlatedThreats);
      }

      // Process detected threats
      for (const threat of threats) {
        await this.processThreat(threat);
      }

      return threats;

    } finally {
      this.analysisInProgress--;
      
      // Update statistics
      const duration = performance.now() - startTime;
      const eventType = event.type || 'unknown';
      const stats = this.analysisStats.get(eventType) || { count: 0, avgDuration: 0, totalDuration: 0 };
      stats.count++;
      stats.totalDuration += duration;
      stats.avgDuration = stats.totalDuration / stats.count;
      this.analysisStats.set(eventType, stats);
    }
  }

  private async processThreat(threat: ThreatIndicator): Promise<void> {
    // Store threat
    this.detectedThreats.set(threat.id, threat);
    this.threatsDetected++;

    // Emit threat detected event
    this.emit('threat:detected', {
      threatId: threat.id,
      type: threat.type,
      severity: threat.severity,
      source: threat.source,
      target: threat.target,
      description: threat.description,
      indicators: threat.indicators,
      timestamp: Date.now(),
      metadata: threat.metadata,
    });

    // Auto-mitigation if enabled and threat is high severity
    if (this.config.response.autoMitigation && 
        (threat.severity === 'high' || threat.severity === 'critical')) {
      await this.executeMitigation(threat);
    }

    // Escalate if threshold exceeded
    if (threat.confidence >= this.config.response.escalationThreshold) {
      this.emit('threat:escalated', {
        threatId: threat.id,
        escalationLevel: 'high',
        reason: `Confidence ${threat.confidence} exceeds threshold ${this.config.response.escalationThreshold}`,
        urgency: threat.severity === 'critical' ? 10 : 7,
      });
    }

    logger.warn('Threat detected and processed', {
      threatId: threat.id,
      type: threat.type,
      severity: threat.severity,
      confidence: threat.confidence,
    });
  }

  private async executeMitigation(threat: ThreatIndicator): Promise<void> {
    const mitigationActions = threat.mitigationActions || [];
    let success = true;

    for (const action of mitigationActions) {
      try {
        await this.executeMitigationAction(action, threat);
      } catch (error) {
        success = false;
        logger.error(`Mitigation action failed: ${action}`, error);
      }
    }

    this.emit('threat:mitigated', {
      threatId: threat.id,
      mitigation: mitigationActions.join(', '),
      automaticResponse: true,
      duration: 0,
      success,
    });

    if (success) {
      this.threatsBlocked++;
    }
  }

  private async executeMitigationAction(action: string, threat: ThreatIndicator): Promise<void> {
    switch (action) {
      case 'block_ip':
        // Implementation would integrate with firewall/WAF
        logger.info(`Blocking IP for threat ${threat.id}`);
        break;
      case 'block_user':
        // Implementation would integrate with user management
        logger.info(`Blocking user for threat ${threat.id}`);
        break;
      case 'rate_limit':
        // Implementation would enhance rate limiting
        logger.info(`Applying rate limiting for threat ${threat.id}`);
        break;
      case 'alert_security':
        // Implementation would send security alerts
        logger.info(`Alerting security team for threat ${threat.id}`);
        break;
    }
  }

  private async detectInjectionAttacks(event: SecurityEvent): Promise<ThreatIndicator | null> {
    const injectionPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\bFROM\b)/i,
      /(\$\{.*\}|\$\(.*\))/,
      /(;|\||&|`|<|>|\$|\{|\})/,
      /(\bOR\b.*=.*\bOR\b|\bAND\b.*=.*\bAND\b)/i,
      /(\/\*.*\*\/|--.*$)/m,
      /(exec|eval|system|cmd)/i,
    ];

    const payload = JSON.stringify(event.payload || '');
    const headers = JSON.stringify(event.headers || {});
    const combined = payload + headers;

    for (const pattern of injectionPatterns) {
      if (pattern.test(combined)) {
        return {
          id: `injection_${event.id}_${Date.now()}`,
          type: 'injection',
          severity: 'high',
          confidence: 0.85,
          timestamp: event.timestamp,
          source: 'pattern_detection',
          target: event.userId,
          description: `SQL/Code injection attempt detected in ${event.resource}`,
          details: {
            event,
            pattern: pattern.toString(),
            matchedContent: combined.match(pattern)?.[0],
          },
          indicators: [{
            type: 'pattern_match',
            value: pattern.toString(),
            confidence: 0.85,
          }],
          metadata: {
            attack_vector: 'injection',
            affected_resource: event.resource,
          },
          mitigationActions: ['block_request', 'alert_security', 'sanitize_input'],
        };
      }
    }

    return null;
  }

  private async detectBruteForceAttacks(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.userId || !event.action.includes('login')) {
      return null;
    }

    const recentAttempts = this.securityEvents.filter(e => 
      (e.userId === event.userId || e.ipAddress === event.ipAddress) &&
      e.action.includes('login') &&
      e.response?.statusCode === 401 &&
      e.timestamp > new Date(Date.now() - 300000) // Last 5 minutes
    );

    if (recentAttempts.length >= 5) {
      return {
        id: `brute_force_${event.userId}_${Date.now()}`,
        type: 'brute_force',
        severity: recentAttempts.length > 10 ? 'critical' : 'high',
        confidence: Math.min(recentAttempts.length / 15, 1),
        timestamp: event.timestamp,
        source: 'behavior_analysis',
        target: event.userId,
        description: `Brute force attack detected: ${recentAttempts.length} failed login attempts`,
        details: {
          attempts: recentAttempts.length,
          timeWindow: '5 minutes',
          ipAddresses: [...new Set(recentAttempts.map(e => e.ipAddress))],
        },
        indicators: [{
          type: 'failed_login_rate',
          value: recentAttempts.length.toString(),
          confidence: 0.9,
        }],
        metadata: {
          attack_vector: 'credential_stuffing',
          target_user: event.userId,
        },
        mitigationActions: ['block_ip', 'lock_account', 'require_mfa'],
      };
    }

    return null;
  }

  private async detectAnomalousBehavior(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.userId || !this.config.detection.enableBehavioralAnalysis) {
      return null;
    }

    const profile = this.behaviorProfiles.get(event.userId);
    if (!profile) {
      return null; // Need profile for comparison
    }

    const anomalies = this.detectBehavioralAnomalies(event, profile);
    const anomalyScore = anomalies.reduce((sum, a) => sum + a.score, 0) / anomalies.length;

    if (anomalyScore > this.config.behavioral.anomalyThreshold) {
      return {
        id: `anomaly_${event.id}_${Date.now()}`,
        type: 'anomaly',
        severity: anomalyScore > 0.9 ? 'critical' : 'high',
        confidence: anomalyScore,
        timestamp: event.timestamp,
        source: 'behavioral_analysis',
        target: event.userId,
        description: `Anomalous behavior detected: ${anomalies.map(a => a.type).join(', ')}`,
        details: {
          anomalies,
          anomalyScore,
          profile: {
            lastUpdated: profile.lastUpdated,
            eventCount: profile.eventCount,
          },
        },
        indicators: anomalies.map(a => ({
          type: a.type,
          value: a.description,
          confidence: a.score,
        })),
        metadata: {
          user_id: event.userId,
          baseline_events: profile.eventCount,
        },
        mitigationActions: ['increase_monitoring', 'require_mfa', 'alert_security'],
      };
    }

    return null;
  }

  private async detectDataExfiltration(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.response || !event.userId) {
      return null;
    }

    const responseSize = event.response.size;
    const profile = this.behaviorProfiles.get(event.userId);

    if (profile) {
      const normalSize = profile.patterns.behavior.dataVolume.mean;
      const threshold = normalSize + (3 * profile.patterns.behavior.dataVolume.stdDev);

      if (responseSize > threshold && responseSize > 1024 * 1024) { // At least 1MB
        return {
          id: `exfiltration_${event.id}_${Date.now()}`,
          type: 'data_exfiltration',
          severity: 'high',
          confidence: 0.8,
          timestamp: event.timestamp,
          source: 'volume_analysis',
          target: event.userId,
          description: `Potential data exfiltration: unusually large data transfer (${Math.round(responseSize / 1024 / 1024)}MB)`,
          details: {
            responseSize,
            normalSize,
            threshold,
            resource: event.resource,
          },
          indicators: [{
            type: 'data_volume',
            value: `${responseSize} bytes`,
            confidence: 0.8,
          }],
          metadata: {
            data_size_mb: Math.round(responseSize / 1024 / 1024),
            resource: event.resource,
          },
          mitigationActions: ['throttle_bandwidth', 'alert_security', 'monitor_user'],
        };
      }
    }

    return null;
  }

  private async detectMaliciousPayloads(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.payload) {
      return null;
    }

    const payloadStr = JSON.stringify(event.payload);
    
    // Check against threat intelligence signatures
    for (const [sigId, signature] of this.threatIntelligence.signatures) {
      let matches = false;
      
      if (signature.pattern instanceof RegExp) {
        matches = signature.pattern.test(payloadStr);
      } else {
        matches = payloadStr.includes(signature.pattern as string);
      }

      if (matches) {
        return {
          id: `malicious_${event.id}_${Date.now()}`,
          type: signature.type,
          severity: 'critical',
          confidence: signature.confidence,
          timestamp: event.timestamp,
          source: 'signature_detection',
          target: event.userId,
          description: `Malicious payload detected matching signature ${sigId}`,
          details: {
            signatureId: sigId,
            signature: signature.metadata,
            payload: payloadStr.substring(0, 1000), // Limit size
          },
          indicators: [{
            type: 'signature_match',
            value: sigId,
            confidence: signature.confidence,
          }],
          metadata: {
            signature_id: sigId,
            signature_source: signature.source,
          },
          mitigationActions: ['block_immediately', 'isolate_user', 'alert_security'],
        };
      }
    }

    return null;
  }

  private async detectPrivilegeEscalation(event: SecurityEvent): Promise<ThreatIndicator | null> {
    const privilegedPatterns = [
      /^\/admin/,
      /^\/api\/admin/,
      /^\/api\/users\/[^\/]+\/permissions/,
      /^\/api\/system/,
      /^\/api\/config/,
    ];

    const isPrivilegedResource = privilegedPatterns.some(pattern => 
      pattern.test(event.resource)
    );

    if (isPrivilegedResource && event.userId) {
      const profile = this.behaviorProfiles.get(event.userId);
      
      if (profile) {
        const hasAccessedBefore = profile.patterns.resources.common.some(resource =>
          privilegedPatterns.some(pattern => pattern.test(resource))
        );

        if (!hasAccessedBefore) {
          return {
            id: `privilege_escalation_${event.id}_${Date.now()}`,
            type: 'privilege_escalation',
            severity: 'high',
            confidence: 0.85,
            timestamp: event.timestamp,
            source: 'access_pattern_analysis',
            target: event.userId,
            description: `First-time access to privileged resource: ${event.resource}`,
            details: {
              resource: event.resource,
              userProfile: {
                normalResources: profile.patterns.resources.common,
                riskLevel: profile.riskLevel,
              },
            },
            indicators: [{
              type: 'first_time_privileged_access',
              value: event.resource,
              confidence: 0.85,
            }],
            metadata: {
              user_id: event.userId,
              resource: event.resource,
            },
            mitigationActions: ['verify_permissions', 'require_mfa', 'alert_security'],
          };
        }
      }
    }

    return null;
  }

  private async detectInsiderThreats(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.userId) {
      return null;
    }

    const profile = this.behaviorProfiles.get(event.userId);
    if (!profile) {
      return null;
    }

    // Check for insider threat indicators
    const indicators = [];
    
    // Unusual time access
    const hour = event.timestamp.getHours();
    if (!profile.patterns.accessTimes.hours.includes(hour)) {
      indicators.push('off_hours_access');
    }

    // Unusual resource access
    const isUnusualResource = !profile.patterns.resources.common.some(resource =>
      event.resource.startsWith(resource)
    );
    if (isUnusualResource) {
      indicators.push('unusual_resource_access');
    }

    // Multiple recent anomalies
    const recentAnomalies = profile.anomalyHistory.filter(a =>
      a.timestamp > new Date(Date.now() - 86400000) // Last 24 hours
    );
    if (recentAnomalies.length > 3) {
      indicators.push('multiple_anomalies');
    }

    if (indicators.length >= 2) {
      return {
        id: `insider_threat_${event.id}_${Date.now()}`,
        type: 'insider_threat',
        severity: 'medium',
        confidence: 0.7,
        timestamp: event.timestamp,
        source: 'insider_threat_analysis',
        target: event.userId,
        description: `Potential insider threat: ${indicators.join(', ')}`,
        details: {
          indicators,
          recentAnomalies: recentAnomalies.length,
          userRiskLevel: profile.riskLevel,
        },
        indicators: indicators.map(indicator => ({
          type: 'insider_threat_indicator',
          value: indicator,
          confidence: 0.7,
        })),
        metadata: {
          user_id: event.userId,
          risk_factors: indicators,
        },
        mitigationActions: ['increase_monitoring', 'alert_hr', 'review_access'],
      };
    }

    return null;
  }

  private async runMLDetection(event: SecurityEvent): Promise<ThreatIndicator | null> {
    // Simplified ML detection - in real implementation would use trained models
    const features = this.extractMLFeatures(event);
    const score = await this.predictThreatScore(features);

    if (score > this.config.ml.confidence.minThreshold) {
      return {
        id: `ml_threat_${event.id}_${Date.now()}`,
        type: 'anomaly',
        severity: score > this.config.ml.confidence.criticalThreshold ? 'critical' : 'medium',
        confidence: score,
        timestamp: event.timestamp,
        source: 'ml_model',
        target: event.userId,
        description: `ML model detected potential threat (score: ${score.toFixed(2)})`,
        details: {
          mlScore: score,
          features,
          model: 'threat_detection_v1',
        },
        indicators: [{
          type: 'ml_score',
          value: score.toString(),
          confidence: score,
        }],
        metadata: {
          ml_model: 'threat_detection_v1',
          feature_count: Object.keys(features).length,
        },
        mitigationActions: ['investigate_further', 'increase_monitoring'],
      };
    }

    return null;
  }

  private extractMLFeatures(event: SecurityEvent): Record<string, number> {
    const payload = JSON.stringify(event.payload || '');
    const headers = JSON.stringify(event.headers || {});
    
    return {
      payload_length: payload.length,
      header_count: Object.keys(event.headers || {}).length,
      special_chars: (payload.match(/[;<>&|`${}]/g) || []).length,
      sql_keywords: (payload.match(/\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b/gi) || []).length,
      script_tags: (payload.match(/<script/gi) || []).length,
      response_size: event.response?.size || 0,
      response_time: event.response?.duration || 0,
      hour_of_day: event.timestamp.getHours(),
      day_of_week: event.timestamp.getDay(),
    };
  }

  private async predictThreatScore(features: Record<string, number>): Promise<number> {
    // Simplified threat scoring - real implementation would use trained ML model
    let score = 0;
    
    if (features.special_chars > 10) score += 0.3;
    if (features.sql_keywords > 0) score += 0.4;
    if (features.script_tags > 0) score += 0.5;
    if (features.payload_length > 10000) score += 0.2;
    if (features.response_size > 10 * 1024 * 1024) score += 0.3;
    if (features.hour_of_day < 6 || features.hour_of_day > 22) score += 0.1;
    
    return Math.min(score, 1);
  }

  private async correlateThreats(event: SecurityEvent, threats: ThreatIndicator[]): Promise<ThreatIndicator[]> {
    // Implementation would perform sophisticated threat correlation
    return [];
  }

  private async initializeThreatIntelligence(): Promise<void> {
    // Load default signatures
    const defaultSignatures = [
      {
        id: 'xss_basic',
        pattern: /<script[^>]*>.*?<\/script>/gi,
        type: 'xss' as ThreatType,
        confidence: 0.9,
        source: 'internal',
        metadata: { category: 'web_attack' },
      },
      {
        id: 'sql_injection',
        pattern: /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b.*\bWHERE\b)/gi,
        type: 'injection' as ThreatType,
        confidence: 0.85,
        source: 'internal',
        metadata: { category: 'injection_attack' },
      },
    ];

    for (const sig of defaultSignatures) {
      this.threatIntelligence.signatures.set(sig.id, sig);
    }

    logger.info('Threat intelligence initialized', {
      signatures: this.threatIntelligence.signatures.size,
    });
  }

  private async initializeMLModels(): Promise<void> {
    // Initialize ML models - in real implementation would load trained models
    this.mlModels.set('threat_detection', {
      predict: this.predictThreatScore.bind(this),
    });

    logger.info('ML models initialized', {
      models: this.mlModels.size,
    });
  }

  private startBackgroundProcessing(): void {
    setInterval(async () => {
      await this.processQueuedEvents();
    }, this.config.events.processingInterval);
  }

  private startThreatIntelligenceUpdates(): void {
    setInterval(async () => {
      await this.updateThreatIntelligence();
    }, this.config.intelligence.updateInterval);
  }

  private startMLRetraining(): void {
    setInterval(async () => {
      await this.retrainMLModels();
    }, this.config.ml.retraining.interval);
  }

  private async processQueuedEvents(): Promise<void> {
    const batchSize = Math.min(this.config.events.batchProcessingSize, this.processingQueue.length);
    const events = this.processingQueue.splice(0, batchSize);

    for (const event of events) {
      try {
        await this.processEvent(event);
      } catch (error) {
        logger.error('Error processing queued event', error);
      }
    }
  }

  private async updateThreatIntelligence(): Promise<void> {
    // Implementation would fetch updates from threat intelligence feeds
    logger.debug('Threat intelligence update completed');
  }

  private async retrainMLModels(): Promise<void> {
    if (this.securityEvents.length < this.config.ml.retraining.minSamples) {
      return;
    }

    // Implementation would retrain ML models with new data
    logger.debug('ML model retraining completed');
  }

  private createNewBehaviorProfile(userId: string): BehaviorProfile {
    return {
      userId,
      createdAt: new Date(),
      lastUpdated: new Date(),
      eventCount: 0,
      patterns: {
        accessTimes: { hours: [], daysOfWeek: [], timezone: 'UTC' },
        resources: { common: [], frequencies: {} },
        devices: { fingerprints: [], userAgents: [] },
        geolocation: { countries: [], cities: [] },
        behavior: {
          sessionDuration: { mean: 0, stdDev: 0 },
          requestRate: { mean: 0, stdDev: 0 },
          dataVolume: { mean: 0, stdDev: 0 },
          errorRate: { mean: 0, stdDev: 0 },
        },
      },
      anomalyHistory: [],
      riskLevel: 'medium',
    };
  }

  private updateProfileWithEvent(profile: BehaviorProfile, event: SecurityEvent): void {
    // Update access patterns
    const hour = event.timestamp.getHours();
    if (!profile.patterns.accessTimes.hours.includes(hour)) {
      profile.patterns.accessTimes.hours.push(hour);
    }

    // Update resource patterns
    const resourceBase = event.resource.split('/').slice(0, 3).join('/');
    if (!profile.patterns.resources.common.includes(resourceBase)) {
      profile.patterns.resources.common.push(resourceBase);
    }

    profile.patterns.resources.frequencies[resourceBase] = 
      (profile.patterns.resources.frequencies[resourceBase] || 0) + 1;

    // Update device patterns
    if (event.deviceFingerprint && !profile.patterns.devices.fingerprints.includes(event.deviceFingerprint)) {
      profile.patterns.devices.fingerprints.push(event.deviceFingerprint);
    }

    if (!profile.patterns.devices.userAgents.includes(event.userAgent)) {
      profile.patterns.devices.userAgents.push(event.userAgent);
    }

    // Update geolocation patterns
    if (event.geolocation) {
      if (!profile.patterns.geolocation.countries.includes(event.geolocation.country)) {
        profile.patterns.geolocation.countries.push(event.geolocation.country);
      }
      if (!profile.patterns.geolocation.cities.includes(event.geolocation.city)) {
        profile.patterns.geolocation.cities.push(event.geolocation.city);
      }
    }

    // Keep arrays manageable
    if (profile.patterns.accessTimes.hours.length > 24) {
      profile.patterns.accessTimes.hours = profile.patterns.accessTimes.hours.slice(-24);
    }
    if (profile.patterns.resources.common.length > 50) {
      profile.patterns.resources.common = profile.patterns.resources.common.slice(-50);
    }
  }

  private detectBehavioralAnomalies(event: SecurityEvent, profile: BehaviorProfile): Array<{ type: string; score: number; description: string }> {
    const anomalies = [];

    // Time-based anomaly
    const hour = event.timestamp.getHours();
    if (!profile.patterns.accessTimes.hours.includes(hour)) {
      anomalies.push({
        type: 'time_anomaly',
        score: 0.7,
        description: `Access at unusual hour: ${hour}:00`,
      });
    }

    // Resource anomaly
    const resourceBase = event.resource.split('/').slice(0, 3).join('/');
    if (!profile.patterns.resources.common.includes(resourceBase)) {
      anomalies.push({
        type: 'resource_anomaly',
        score: 0.6,
        description: `Access to unusual resource: ${resourceBase}`,
      });
    }

    // Device anomaly
    if (event.deviceFingerprint && !profile.patterns.devices.fingerprints.includes(event.deviceFingerprint)) {
      anomalies.push({
        type: 'device_anomaly',
        score: 0.8,
        description: 'Access from unrecognized device',
      });
    }

    // Geolocation anomaly
    if (event.geolocation && !profile.patterns.geolocation.countries.includes(event.geolocation.country)) {
      anomalies.push({
        type: 'location_anomaly',
        score: 0.9,
        description: `Access from new country: ${event.geolocation.country}`,
      });
    }

    return anomalies;
  }

  private calculateRiskFactors(profile: BehaviorProfile): Array<{ factor: string; impact: number; description: string }> {
    const factors = [];

    // Recent anomalies
    const recentAnomalies = profile.anomalyHistory.filter(a =>
      a.timestamp > new Date(Date.now() - 604800000) // Last week
    );
    if (recentAnomalies.length > 0) {
      factors.push({
        factor: 'recent_anomalies',
        impact: Math.min(recentAnomalies.length * 0.1, 0.5),
        description: `${recentAnomalies.length} anomalies in the last week`,
      });
    }

    // Profile completeness
    const resourceCount = profile.patterns.resources.common.length;
    if (resourceCount < 5) {
      factors.push({
        factor: 'incomplete_profile',
        impact: 0.3,
        description: 'Limited behavioral data available',
      });
    }

    // Geographic diversity
    const countryCount = profile.patterns.geolocation.countries.length;
    if (countryCount > 3) {
      factors.push({
        factor: 'geographic_diversity',
        impact: 0.2,
        description: `Access from ${countryCount} different countries`,
      });
    }

    return factors;
  }

  private generateRiskRecommendations(riskLevel: string, factors: any[]): string[] {
    const recommendations = [];

    if (riskLevel === 'high' || riskLevel === 'critical') {
      recommendations.push('Enable mandatory MFA');
      recommendations.push('Increase monitoring frequency');
      recommendations.push('Review access permissions');
    }

    if (factors.some(f => f.factor === 'recent_anomalies')) {
      recommendations.push('Investigate recent anomalous activities');
    }

    if (factors.some(f => f.factor === 'geographic_diversity')) {
      recommendations.push('Implement geo-location restrictions');
    }

    return recommendations;
  }

  private calculateThreatRiskScore(threat: ThreatIndicator): number {
    let score = threat.confidence;
    
    // Adjust based on severity
    switch (threat.severity) {
      case 'critical': score *= 1.0; break;
      case 'high': score *= 0.8; break;
      case 'medium': score *= 0.6; break;
      case 'low': score *= 0.4; break;
    }

    return Math.min(score, 1);
  }

  private identifyAttackVectors(threat: ThreatIndicator): string[] {
    const vectors = [];
    
    switch (threat.type) {
      case 'injection':
        vectors.push('web_application', 'input_validation');
        break;
      case 'brute_force':
        vectors.push('authentication', 'credential_attack');
        break;
      case 'data_exfiltration':
        vectors.push('data_theft', 'privilege_abuse');
        break;
      default:
        vectors.push('unknown');
    }

    return vectors;
  }

  private assessPotentialImpact(threat: ThreatIndicator): string {
    switch (threat.severity) {
      case 'critical':
        return 'Complete system compromise, data breach, service disruption';
      case 'high':
        return 'Significant security breach, potential data exposure';
      case 'medium':
        return 'Limited security compromise, minimal data risk';
      case 'low':
        return 'Minor security issue, low risk to data';
      default:
        return 'Unknown impact';
    }
  }

  private generateRecommendedActions(threat: ThreatIndicator): string[] {
    const actions = [];

    if (threat.severity === 'critical') {
      actions.push('Immediately isolate affected systems');
      actions.push('Activate incident response team');
    }

    if (threat.type === 'injection') {
      actions.push('Sanitize input validation');
      actions.push('Update WAF rules');
    }

    if (threat.type === 'brute_force') {
      actions.push('Implement account lockout');
      actions.push('Enable MFA');
    }

    actions.push('Monitor for related activities');
    actions.push('Update security signatures');

    return actions;
  }

  private async buildThreatTimeline(threat: ThreatIndicator): Promise<Array<{ timestamp: Date; event: string; significance: number }>> {
    // Implementation would build timeline of related events
    return [
      {
        timestamp: threat.timestamp,
        event: `Threat detected: ${threat.type}`,
        significance: 1.0,
      },
    ];
  }

  private findCorrelatedEvents(threat: ThreatIndicator): string[] {
    // Implementation would find related security events
    return [];
  }

  private createMitigationPlan(threat: ThreatIndicator): Array<{ action: string; priority: 'immediate' | 'high' | 'medium' | 'low'; automated: boolean; estimated_duration: number }> {
    const plan = [];

    if (threat.severity === 'critical') {
      plan.push({
        action: 'Block malicious traffic',
        priority: 'immediate' as const,
        automated: true,
        estimated_duration: 300, // 5 minutes
      });
    }

    plan.push({
      action: 'Investigate threat source',
      priority: 'high' as const,
      automated: false,
      estimated_duration: 3600, // 1 hour
    });

    return plan;
  }

  private updateMLModelsWithFeedback(threat: ThreatIndicator, feedback: string, metadata?: any): void {
    // Implementation would update ML models with feedback
    logger.debug('ML model feedback recorded', {
      threatId: threat.id,
      feedback,
      metadata,
    });
  }

  private pruneOldEvents(): void {
    const cutoff = new Date(Date.now() - this.config.events.retentionPeriod);
    this.securityEvents = this.securityEvents.filter(e => e.timestamp > cutoff);
    
    // Also prune old threats
    for (const [id, threat] of this.detectedThreats) {
      if (threat.timestamp < cutoff) {
        this.detectedThreats.delete(id);
      }
    }
  }
}