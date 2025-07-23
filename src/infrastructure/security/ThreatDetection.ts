import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { logger } from '@/logger.js';
import { AnomalyDetectionSystem } from '../observability/AnomalyDetection.js';
import { AlertingSystem } from '../observability/AlertingSystem.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface ThreatIndicator {
  id: string;
  type: ThreatType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  timestamp: Date;
  source: string;
  details: Record<string, any>;
  mitigationActions?: string[];
}

export type ThreatType = 
  | 'brute_force'
  | 'injection'
  | 'xss'
  | 'csrf'
  | 'dos'
  | 'privilege_escalation'
  | 'data_exfiltration'
  | 'anomalous_behavior'
  | 'malicious_payload'
  | 'unauthorized_access';

export interface ThreatIntelligence {
  ipReputations: Map<string, number>;
  maliciousPatterns: RegExp[];
  knownAttackSignatures: string[];
  behavioralProfiles: Map<string, BehaviorProfile>;
}

export interface BehaviorProfile {
  userId: string;
  normalPatterns: {
    accessTimes: number[];
    resources: string[];
    dataVolume: { mean: number; stdDev: number };
    requestRate: { mean: number; stdDev: number };
  };
  lastUpdated: Date;
}

export interface SecurityEvent {
  id: string;
  type: string;
  timestamp: Date;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  payload?: any;
  headers?: Record<string, string>;
  response?: {
    statusCode: number;
    size: number;
  };
}

/**
 * Advanced Threat Detection System
 * Uses ML, behavioral analysis, and threat intelligence
 */
export class ThreatDetectionSystem extends EventEmitterSingletonService<ThreatDetectionSystem> {
  private threatIntelligence: ThreatIntelligence;
  private securityEvents: SecurityEvent[] = [];
  private detectedThreats: Map<string, ThreatIndicator> = new Map();
  private anomalySystem: AnomalyDetectionSystem;
  private alertingSystem: AlertingSystem;
  private mlModels: Map<string, ThreatMLModel> = new Map();

  protected constructor() {
    super();
    this.threatIntelligence = {
      ipReputations: new Map(),
      maliciousPatterns: this.loadMaliciousPatterns(),
      knownAttackSignatures: this.loadAttackSignatures(),
      behavioralProfiles: new Map(),
    };
    
    this.anomalySystem = AnomalyDetectionSystem.getInstance();
    this.alertingSystem = AlertingSystem.getInstance();
    
    this.initializeMLModels();
    this.setupEventHandlers();
  }

  static getInstance(): ThreatDetectionSystem {
    return super.getInstance();
  }

  /**
   * Analyze security event for threats
   */
  async analyzeEvent(event: SecurityEvent): Promise<ThreatIndicator[]> {
    const threats: ThreatIndicator[] = [];

    // Store event for correlation
    this.securityEvents.push(event);
    this.pruneOldEvents();

    // Run detection modules
    const detectionResults = await Promise.all([
      this.detectInjectionAttacks(event),
      this.detectBruteForce(event),
      this.detectAnomalousBehavior(event),
      this.detectDataExfiltration(event),
      this.detectMaliciousPayloads(event),
      this.detectPrivilegeEscalation(event),
    ]);

    // Collect all detected threats
    for (const result of detectionResults) {
      if (result) {
        threats.push(...(Array.isArray(result) ? result : [result]));
      }
    }

    // Correlate with recent events
    const correlatedThreats = await this.correlateThreats(event, threats);
    threats.push(...correlatedThreats);

    // Store detected threats
    for (const threat of threats) {
      this.detectedThreats.set(threat.id, threat);
      this.emit('threat:detected', threat);
      
      // Create alert for high severity threats
      if (threat.severity === 'high' || threat.severity === 'critical') {
        this.createThreatAlert(threat);
      }
    }

    return threats;
  }

  /**
   * Detect injection attacks (SQL, NoSQL, Command)
   */
  private async detectInjectionAttacks(event: SecurityEvent): Promise<ThreatIndicator | null> {
    const injectionPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\bFROM\b)/i,
      /(\$\{.*\}|\$\(.*\))/,
      /(;|\||&|`|<|>|\$|\{|\})/,
      /(\bOR\b.*=.*\bOR\b|\bAND\b.*=.*\bAND\b)/i,
      /(\/\*.*\*\/|--.*$)/m,
    ];

    const payload = JSON.stringify(event.payload || '');
    const headers = JSON.stringify(event.headers || {});
    const combined = payload + headers;

    for (const pattern of injectionPatterns) {
      if (pattern.test(combined)) {
        return {
          id: `injection_${event.id}`,
          type: 'injection',
          severity: 'high',
          confidence: 0.8,
          timestamp: event.timestamp,
          source: 'pattern_matching',
          details: {
            event,
            pattern: pattern.toString(),
            matchedContent: combined.match(pattern)?.[0],
          },
          mitigationActions: ['block_request', 'notify_security_team'],
        };
      }
    }

    // ML-based detection
    const mlScore = await this.mlModels.get('injection')?.predict(event);
    if (mlScore && mlScore > 0.7) {
      return {
        id: `injection_ml_${event.id}`,
        type: 'injection',
        severity: 'medium',
        confidence: mlScore,
        timestamp: event.timestamp,
        source: 'ml_model',
        details: { event, mlScore },
      };
    }

    return null;
  }

  /**
   * Detect brute force attacks
   */
  private async detectBruteForce(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.userId || event.action !== 'login') {
      return null;
    }

    // Check recent failed login attempts
    const recentAttempts = this.securityEvents.filter(e => 
      e.userId === event.userId &&
      e.action === 'login' &&
      e.response?.statusCode === 401 &&
      e.timestamp > new Date(Date.now() - 300000) // Last 5 minutes
    );

    if (recentAttempts.length >= 5) {
      return {
        id: `brute_force_${event.userId}_${Date.now()}`,
        type: 'brute_force',
        severity: 'high',
        confidence: Math.min(recentAttempts.length / 10, 1),
        timestamp: event.timestamp,
        source: 'rate_analysis',
        details: {
          userId: event.userId,
          attempts: recentAttempts.length,
          ipAddresses: [...new Set(recentAttempts.map(e => e.ipAddress))],
        },
        mitigationActions: ['lock_account', 'require_captcha', 'notify_user'],
      };
    }

    return null;
  }

  /**
   * Detect anomalous behavior using ML
   */
  private async detectAnomalousBehavior(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.userId) return null;

    const profile = this.threatIntelligence.behavioralProfiles.get(event.userId);
    if (!profile) {
      // Create new profile
      await this.createBehaviorProfile(event.userId);
      return null;
    }

    // Check access time anomaly
    const hour = event.timestamp.getHours();
    const isNormalTime = profile.normalPatterns.accessTimes.includes(hour);
    
    // Check resource access anomaly
    const isNormalResource = profile.normalPatterns.resources.some(r => 
      event.resource.startsWith(r)
    );

    // Calculate anomaly score
    let anomalyScore = 0;
    if (!isNormalTime) anomalyScore += 0.3;
    if (!isNormalResource) anomalyScore += 0.4;

    // Use ML model for deeper analysis
    const mlScore = await this.mlModels.get('behavior')?.predict(event);
    if (mlScore) {
      anomalyScore = (anomalyScore + mlScore) / 2;
    }

    if (anomalyScore > 0.6) {
      return {
        id: `anomaly_${event.id}`,
        type: 'anomalous_behavior',
        severity: anomalyScore > 0.8 ? 'high' : 'medium',
        confidence: anomalyScore,
        timestamp: event.timestamp,
        source: 'behavioral_analysis',
        details: {
          event,
          anomalyScore,
          deviations: {
            timeAnomaly: !isNormalTime,
            resourceAnomaly: !isNormalResource,
          },
        },
        mitigationActions: ['increase_monitoring', 'require_mfa'],
      };
    }

    return null;
  }

  /**
   * Detect potential data exfiltration
   */
  private async detectDataExfiltration(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.response) return null;

    const responseSize = event.response.size;
    const threshold = 10 * 1024 * 1024; // 10MB

    // Check for large data transfers
    if (responseSize > threshold) {
      // Check if this is normal for the user
      const recentTransfers = this.securityEvents.filter(e =>
        e.userId === event.userId &&
        e.timestamp > new Date(Date.now() - 3600000) // Last hour
      );

      const avgSize = recentTransfers.reduce((sum, e) => 
        sum + (e.response?.size || 0), 0
      ) / recentTransfers.length;

      if (responseSize > avgSize * 5) {
        return {
          id: `exfiltration_${event.id}`,
          type: 'data_exfiltration',
          severity: 'high',
          confidence: 0.7,
          timestamp: event.timestamp,
          source: 'volume_analysis',
          details: {
            event,
            dataSize: responseSize,
            avgSize,
            threshold,
          },
          mitigationActions: ['throttle_bandwidth', 'alert_security'],
        };
      }
    }

    return null;
  }

  /**
   * Detect malicious payloads
   */
  private async detectMaliciousPayloads(event: SecurityEvent): Promise<ThreatIndicator | null> {
    if (!event.payload) return null;

    const payloadStr = JSON.stringify(event.payload);
    
    // Check against known attack signatures
    for (const signature of this.threatIntelligence.knownAttackSignatures) {
      const hash = createHash('sha256').update(payloadStr).digest('hex');
      if (hash === signature) {
        return {
          id: `malicious_${event.id}`,
          type: 'malicious_payload',
          severity: 'critical',
          confidence: 1.0,
          timestamp: event.timestamp,
          source: 'signature_match',
          details: {
            event,
            signatureHash: hash,
          },
          mitigationActions: ['block_immediately', 'isolate_user'],
        };
      }
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /document\.cookie/gi,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(payloadStr)) {
        return {
          id: `xss_${event.id}`,
          type: 'xss',
          severity: 'high',
          confidence: 0.8,
          timestamp: event.timestamp,
          source: 'pattern_matching',
          details: {
            event,
            pattern: pattern.toString(),
          },
          mitigationActions: ['sanitize_input', 'block_request'],
        };
      }
    }

    return null;
  }

  /**
   * Detect privilege escalation attempts
   */
  private async detectPrivilegeEscalation(event: SecurityEvent): Promise<ThreatIndicator | null> {
    const privilegedResources = [
      /^\/admin/,
      /^\/api\/users\/\d+\/permissions/,
      /^\/api\/system/,
    ];

    const isPrivileged = privilegedResources.some(pattern => 
      pattern.test(event.resource)
    );

    if (isPrivileged && event.userId) {
      // Check if user has accessed privileged resources before
      const previousAccess = this.securityEvents.filter(e =>
        e.userId === event.userId &&
        privilegedResources.some(p => p.test(e.resource)) &&
        e.timestamp < event.timestamp
      );

      if (previousAccess.length === 0) {
        return {
          id: `privilege_escalation_${event.id}`,
          type: 'privilege_escalation',
          severity: 'high',
          confidence: 0.75,
          timestamp: event.timestamp,
          source: 'access_pattern',
          details: {
            event,
            firstTimeAccess: true,
            resource: event.resource,
          },
          mitigationActions: ['verify_permissions', 'require_mfa'],
        };
      }
    }

    return null;
  }

  /**
   * Correlate threats across multiple events
   */
  private async correlateThreats(
    event: SecurityEvent,
    currentThreats: ThreatIndicator[]
  ): Promise<ThreatIndicator[]> {
    const correlatedThreats: ThreatIndicator[] = [];

    // Look for attack chains
    const recentThreats = Array.from(this.detectedThreats.values()).filter(t =>
      t.timestamp > new Date(Date.now() - 600000) && // Last 10 minutes
      (t.details.event?.userId === event.userId ||
       t.details.event?.ipAddress === event.ipAddress)
    );

    if (recentThreats.length >= 3) {
      const attackTypes = new Set(recentThreats.map(t => t.type));
      
      if (attackTypes.size >= 2) {
        correlatedThreats.push({
          id: `correlated_${event.id}`,
          type: 'anomalous_behavior',
          severity: 'critical',
          confidence: 0.9,
          timestamp: event.timestamp,
          source: 'correlation_engine',
          details: {
            event,
            correlatedThreats: recentThreats.map(t => ({
              id: t.id,
              type: t.type,
            })),
            attackChain: Array.from(attackTypes),
          },
          mitigationActions: ['isolate_immediately', 'full_investigation'],
        });
      }
    }

    return correlatedThreats;
  }

  /**
   * Create behavior profile for user
   */
  private async createBehaviorProfile(userId: string): Promise<void> {
    const userEvents = this.securityEvents.filter(e => e.userId === userId);
    
    if (userEvents.length < 100) return; // Need enough data

    const profile: BehaviorProfile = {
      userId,
      normalPatterns: {
        accessTimes: this.extractAccessTimes(userEvents),
        resources: this.extractCommonResources(userEvents),
        dataVolume: this.calculateDataVolumeStats(userEvents),
        requestRate: this.calculateRequestRateStats(userEvents),
      },
      lastUpdated: new Date(),
    };

    this.threatIntelligence.behavioralProfiles.set(userId, profile);
  }

  /**
   * Initialize ML models
   */
  private initializeMLModels(): void {
    // Initialize threat detection ML models
    this.mlModels.set('injection', new InjectionDetectionModel());
    this.mlModels.set('behavior', new BehaviorAnomalyModel());
    this.mlModels.set('malware', new MalwareDetectionModel());
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.on('threat:detected', (threat: ThreatIndicator) => {
      logger.warn('Threat detected', {
        type: threat.type,
        severity: threat.severity,
        confidence: threat.confidence,
        source: threat.source,
      });

      // Update anomaly detection
      this.anomalySystem.addDataPoint(`threat_${threat.type}`, threat.confidence, {
        severity: threat.severity,
        critical: threat.severity === 'critical',
      });
    });
  }

  /**
   * Create alert for threat
   */
  private createThreatAlert(threat: ThreatIndicator): void {
    this.alertingSystem.registerRule({
      id: `threat_${threat.id}`,
      name: `Security Threat: ${threat.type}`,
      description: `${threat.type} detected with ${threat.confidence} confidence`,
      enabled: true,
      conditions: [{
        type: 'custom',
        customEvaluator: () => true,
      }],
      actions: [
        { type: 'log', config: {} },
        { type: 'pagerduty', config: { priority: 'high' } },
      ],
    });
  }

  /**
   * Load malicious patterns
   */
  private loadMaliciousPatterns(): RegExp[] {
    return [
      /(<script[^>]*>[\s\S]*?<\/script>|javascript:|on\w+\s*=)/gi,
      /(union.*select|select.*from.*information_schema)/gi,
      /(\.\.[\/\\]|%2e%2e[\/\\]|\.\.;|%2e%2e%3b)/gi,
    ];
  }

  /**
   * Load known attack signatures
   */
  private loadAttackSignatures(): string[] {
    // In real implementation, would load from threat intelligence feed
    return [];
  }

  /**
   * Prune old events
   */
  private pruneOldEvents(): void {
    const cutoff = new Date(Date.now() - 86400000); // 24 hours
    this.securityEvents = this.securityEvents.filter(e => e.timestamp > cutoff);
  }

  /**
   * Extract common access times
   */
  private extractAccessTimes(events: SecurityEvent[]): number[] {
    const hourCounts = new Map<number, number>();
    
    for (const event of events) {
      const hour = event.timestamp.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Return hours that account for 80% of activity
    const sorted = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    const threshold = events.length * 0.8;
    let count = 0;
    const commonHours: number[] = [];
    
    for (const [hour, hourCount] of sorted) {
      commonHours.push(hour);
      count += hourCount;
      if (count >= threshold) break;
    }

    return commonHours;
  }

  /**
   * Extract commonly accessed resources
   */
  private extractCommonResources(events: SecurityEvent[]): string[] {
    const resourceCounts = new Map<string, number>();
    
    for (const event of events) {
      const basePath = event.resource.split('/').slice(0, 3).join('/');
      resourceCounts.set(basePath, (resourceCounts.get(basePath) || 0) + 1);
    }

    return Array.from(resourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([resource]) => resource);
  }

  /**
   * Calculate data volume statistics
   */
  private calculateDataVolumeStats(events: SecurityEvent[]): { mean: number; stdDev: number } {
    const sizes = events
      .filter(e => e.response?.size)
      .map(e => e.response!.size);
    
    if (sizes.length === 0) return { mean: 0, stdDev: 0 };

    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const variance = sizes.reduce((sum, size) => 
      sum + Math.pow(size - mean, 2), 0
    ) / sizes.length;
    
    return { mean, stdDev: Math.sqrt(variance) };
  }

  /**
   * Calculate request rate statistics
   */
  private calculateRequestRateStats(events: SecurityEvent[]): { mean: number; stdDev: number } {
    if (events.length < 2) return { mean: 0, stdDev: 0 };

    // Calculate requests per minute
    const sorted = [...events].sort((a, b) => 
      a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    const rates: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const timeDiff = sorted[i + 1].timestamp.getTime() - sorted[i].timestamp.getTime();
      if (timeDiff > 0) {
        rates.push(60000 / timeDiff); // Requests per minute
      }
    }

    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((sum, rate) => 
      sum + Math.pow(rate - mean, 2), 0
    ) / rates.length;

    return { mean, stdDev: Math.sqrt(variance) };
  }
}

/**
 * Base ML Model for threat detection
 */
abstract class ThreatMLModel {
  abstract predict(event: SecurityEvent): Promise<number>;
}

/**
 * Injection detection ML model
 */
class InjectionDetectionModel extends ThreatMLModel {
  async predict(event: SecurityEvent): Promise<number> {
    // Simplified ML model - in reality would use trained model
    const features = this.extractFeatures(event);
    return this.calculateScore(features);
  }

  private extractFeatures(event: SecurityEvent): Record<string, number> {
    const payload = JSON.stringify(event.payload || '');
    return {
      length: payload.length,
      specialChars: (payload.match(/[;<>&|`${}]/g) || []).length,
      sqlKeywords: (payload.match(/\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b/gi) || []).length,
      encodedChars: (payload.match(/%[0-9a-f]{2}/gi) || []).length,
    };
  }

  private calculateScore(features: Record<string, number>): number {
    // Simplified scoring
    let score = 0;
    if (features.specialChars > 5) score += 0.3;
    if (features.sqlKeywords > 0) score += 0.4;
    if (features.encodedChars > 10) score += 0.2;
    return Math.min(score, 1);
  }
}

/**
 * Behavior anomaly ML model
 */
class BehaviorAnomalyModel extends ThreatMLModel {
  async predict(event: SecurityEvent): Promise<number> {
    // Simplified - would use real ML model
    return Math.random() * 0.5; // Low baseline score
  }
}

/**
 * Malware detection ML model
 */
class MalwareDetectionModel extends ThreatMLModel {
  async predict(event: SecurityEvent): Promise<number> {
    // Simplified - would use real ML model
    return 0;
  }
}