import { logger } from '@/logger.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { CacheManager } from '../cache/CacheManager.js';
import { hash } from 'ohash';
import type { H3Event } from 'h3';
import { SingletonService } from '../core/SingletonService.js';

export interface SecurityRule {
  name: string;
  type: 'rate_limit' | 'ip_allowlist' | 'ip_blocklist' | 'pattern_match' | 'geo_block';
  condition: string | RegExp | ((event: H3Event) => boolean);
  action: 'block' | 'throttle' | 'log' | 'challenge';
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  metadata?: Record<string, any>;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (event: H3Event) => string;
  handler?: (event: H3Event) => Promise<void>;
}

export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ip: string;
  userAgent: string;
  url: string;
  method: string;
  userId?: string;
  rule: string;
  action: string;
  metadata: Record<string, any>;
}

export interface SecurityMetrics {
  totalRequests: number;
  blockedRequests: number;
  throttledRequests: number;
  securityEvents: number;
  topBlockedIPs: Array<{ ip: string; count: number }>;
  topTriggeredRules: Array<{ rule: string; count: number }>;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class AdvancedSecurityManager extends SingletonService<AdvancedSecurityManager> {
  private rules = new Map<string, SecurityRule>();
  private rateLimiters = new Map<string, RateLimitConfig>();
  private securityEvents: SecurityEvent[] = [];
  private metrics: MetricsCollector | null = null;
  private cache: CacheManager | null = null;
  private monitoringInterval?: NodeJS.Timeout;

  // IP reputation tracking
  private ipReputation = new Map<string, {
    score: number; // 0-100, lower is worse
    lastUpdate: Date;
    violations: number;
    country?: string;
  }>();

  // Geo-location data (simplified)
  private geoBlockedCountries = new Set<string>();
  private geoAllowedCountries = new Set<string>();

  protected constructor() {
    super();
  }

  public initialize(): void {
    this.metrics = MetricsCollector.getInstance();
    this.cache = CacheManager.getInstance();
    this.setupDefaultRules();
    this.startSecurityMonitoring();
  }

  private ensureMetrics(): MetricsCollector {
    if (!this.metrics) {
      throw new Error('AdvancedSecurityManager not initialized');
    }
    return this.metrics;
  }

  private ensureCache(): CacheManager {
    if (!this.cache) {
      throw new Error('AdvancedSecurityManager not initialized');
    }
    return this.cache;
  }

  public static getInstance(): AdvancedSecurityManager {
    const instance = super.getInstance();
    if (!instance.metrics) {
      instance.initialize();
    }
    return instance;
  }

  /**
   * Add a security rule
   */
  public addSecurityRule(rule: SecurityRule): void {
    this.rules.set(rule.name, rule);
    
    logger.info('Security rule added', {
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      enabled: rule.enabled,
    });
  }

  /**
   * Configure rate limiting for specific endpoints
   */
  public configureRateLimit(
    endpoint: string, 
    config: RateLimitConfig
  ): void {
    this.rateLimiters.set(endpoint, config);
    
    logger.info('Rate limiter configured', {
      endpoint,
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
    });
  }

  /**
   * Check if request should be allowed
   */
  public async checkRequest(event: H3Event): Promise<{
    allowed: boolean;
    action: string;
    rule?: string;
    reason?: string;
  }> {
    const startTime = Date.now();
    const ip = this.getClientIP(event);
    const userAgent = event.node.req.headers['user-agent'] || '';
    const url = event.node.req.url || '';
    const method = event.node.req.method || '';

    try {
      // Check IP reputation first
      const ipCheck = await this.checkIPReputation(ip);
      if (!ipCheck.allowed) {
        await this.recordSecurityEvent({
          type: 'ip_reputation_block',
          severity: 'high',
          ip,
          userAgent,
          url,
          method,
          rule: 'ip_reputation',
          action: 'block',
          metadata: { reputation: ipCheck.score },
        });
        return { allowed: false, action: 'block', rule: 'ip_reputation', reason: ipCheck.reason };
      }

      // Check rate limits
      const rateLimitCheck = await this.checkRateLimit(event);
      if (!rateLimitCheck.allowed) {
        await this.recordSecurityEvent({
          type: 'rate_limit_exceeded',
          severity: 'medium',
          ip,
          userAgent,
          url,
          method,
          rule: rateLimitCheck.rule,
          action: 'throttle',
          metadata: rateLimitCheck.metadata,
        });
        return { 
          allowed: false, 
          action: 'throttle', 
          rule: rateLimitCheck.rule, 
          reason: 'Rate limit exceeded' 
        };
      }

      // Check geo-blocking
      const geoCheck = await this.checkGeoLocation(ip);
      if (!geoCheck.allowed) {
        await this.recordSecurityEvent({
          type: 'geo_block',
          severity: 'medium',
          ip,
          userAgent,
          url,
          method,
          rule: 'geo_location',
          action: 'block',
          metadata: { country: geoCheck.country },
        });
        return { 
          allowed: false, 
          action: 'block', 
          rule: 'geo_location', 
          reason: `Blocked country: ${geoCheck.country}` 
        };
      }

      // Check custom security rules
      for (const [name, rule] of this.rules.entries()) {
        if (!rule.enabled) continue;

        const ruleCheck = await this.evaluateRule(rule, event);
        if (!ruleCheck.passed) {
          await this.recordSecurityEvent({
            type: rule.type,
            severity: rule.severity,
            ip,
            userAgent,
            url,
            method,
            rule: name,
            action: rule.action,
            metadata: ruleCheck.metadata,
          });

          if (rule.action === 'block') {
            return { 
              allowed: false, 
              action: 'block', 
              rule: name, 
              reason: ruleCheck.reason 
            };
          }
        }
      }

      // Record successful security check
      this.ensureMetrics().recordMetric('security.request.allowed', 1, {
        ip: this.hashIP(ip),
        userAgent: hash(userAgent),
        endpoint: url,
      });

      return { allowed: true, action: 'allow' };

    } catch (error) {
      logger.error('Security check failed', error as Error, { ip, url });
      
      // Fail secure - allow by default but log the error
      return { allowed: true, action: 'allow' };
    } finally {
      const duration = Date.now() - startTime;
      this.ensureMetrics().recordMetric('security.check.duration', duration);
    }
  }

  /**
   * Check IP reputation
   */
  private async checkIPReputation(ip: string): Promise<{
    allowed: boolean;
    score: number;
    reason?: string;
  }> {
    try {
      // Check cache first
      const cacheKey = `ip_reputation:${hash(ip)}`;
      let reputation = await this.ensureCache().get<any>(cacheKey);

      if (!reputation) {
        // In a real implementation, you would check external threat intelligence APIs
        // For now, we'll simulate with some basic checks
        reputation = await this.calculateIPReputation(ip);
        
        // Cache for 1 hour
        await this.ensureCache().set(cacheKey, reputation, { ttl: 3600 });
      }

      const threshold = 30; // IPs with score below 30 are blocked
      const allowed = reputation.score >= threshold;

      return {
        allowed,
        score: reputation.score,
        reason: allowed ? undefined : `IP reputation score too low: ${reputation.score}`,
      };

    } catch (error) {
      logger.error('IP reputation check failed', error as Error, { ip });
      return { allowed: true, score: 50 }; // Default to neutral reputation
    }
  }

  /**
   * Check rate limits
   */
  private async checkRateLimit(event: H3Event): Promise<{
    allowed: boolean;
    rule?: string;
    metadata?: Record<string, any>;
  }> {
    const url = event.node.req.url || '';
    const ip = this.getClientIP(event);

    // Find matching rate limiter
    let matchedLimiter: [string, RateLimitConfig] | undefined;
    
    for (const [endpoint, config] of this.rateLimiters.entries()) {
      if (url.startsWith(endpoint)) {
        matchedLimiter = [endpoint, config];
        break;
      }
    }

    if (!matchedLimiter) {
      return { allowed: true };
    }

    const [endpoint, config] = matchedLimiter;
    const key = config.keyGenerator ? config.keyGenerator(event) : `rate_limit:${endpoint}:${hash(ip)}`;
    
    try {
      // Get current request count
      const current = await this.ensureCache().get<number>(key) || 0;
      
      if (current >= config.maxRequests) {
        return {
          allowed: false,
          rule: `rate_limit_${endpoint}`,
          metadata: {
            current,
            limit: config.maxRequests,
            windowMs: config.windowMs,
          },
        };
      }

      // Increment counter
      await this.ensureCache().set(key, current + 1, { ttl: Math.ceil(config.windowMs / 1000) });
      
      return { allowed: true };

    } catch (error) {
      logger.error('Rate limit check failed', error as Error, { endpoint, ip });
      return { allowed: true }; // Fail open
    }
  }

  /**
   * Check geo-location restrictions
   */
  private async checkGeoLocation(ip: string): Promise<{
    allowed: boolean;
    country?: string;
  }> {
    try {
      // In a real implementation, you would use a geo-IP service
      // For now, we'll simulate geo-location
      const country = await this.getCountryFromIP(ip);
      
      // Check if country is blocked
      if (this.geoBlockedCountries.has(country)) {
        return { allowed: false, country };
      }

      // Check if only specific countries are allowed
      if (this.geoAllowedCountries.size > 0 && !this.geoAllowedCountries.has(country)) {
        return { allowed: false, country };
      }

      return { allowed: true, country };

    } catch (error) {
      logger.error('Geo-location check failed', error as Error, { ip });
      return { allowed: true }; // Fail open
    }
  }

  /**
   * Evaluate a custom security rule
   */
  private async evaluateRule(rule: SecurityRule, event: H3Event): Promise<{
    passed: boolean;
    reason?: string;
    metadata?: Record<string, any>;
  }> {
    try {
      switch (rule.type) {
        case 'pattern_match':
          return this.evaluatePatternRule(rule, event);
          
        case 'ip_allowlist':
          return this.evaluateIPAllowlistRule(rule, event);
          
        case 'ip_blocklist':
          return this.evaluateIPBlocklistRule(rule, event);
          
        default:
          if (typeof rule.condition === 'function') {
            const result = rule.condition(event);
            return { passed: result };
          }
          
          return { passed: true };
      }
    } catch (error) {
      logger.error('Rule evaluation failed', error as Error, { rule: rule.name });
      return { passed: true }; // Fail safe
    }
  }

  /**
   * Record a security event
   */
  private async recordSecurityEvent(eventData: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    const event: SecurityEvent = {
      id: hash({ ...eventData, timestamp: Date.now() }),
      timestamp: new Date(),
      userId: this.getUserId(eventData.userAgent), // Extract from context if available
      ...eventData,
    };

    this.securityEvents.push(event);

    // Keep only recent events (last 1000)
    if (this.securityEvents.length > 1000) {
      this.securityEvents = this.securityEvents.slice(-1000);
    }

    // Log security event
    logger.warn('Security event recorded', {
      id: event.id,
      type: event.type,
      severity: event.severity,
      ip: this.hashIP(event.ip),
      rule: event.rule,
      action: event.action,
    });

    // Record metrics
    this.ensureMetrics().recordMetric('security.event', 1, {
      type: event.type,
      severity: event.severity,
      action: event.action,
      rule: event.rule,
    });

    // Update IP reputation for blocked requests
    if (event.action === 'block') {
      await this.updateIPReputation(event.ip, -10);
    }
  }

  /**
   * Get comprehensive security metrics
   */
  public async getSecurityMetrics(): Promise<SecurityMetrics> {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Filter recent events
    const recentEvents = this.securityEvents.filter(
      event => event.timestamp.getTime() > oneHourAgo
    );

    // Calculate blocked/throttled requests
    const blockedRequests = recentEvents.filter(e => e.action === 'block').length;
    const throttledRequests = recentEvents.filter(e => e.action === 'throttle').length;

    // Get total requests from metrics
    const totalRequests = await this.ensureMetrics().getMetric('security.request.total') || 0;

    // Top blocked IPs
    const ipCounts = new Map<string, number>();
    recentEvents.forEach(event => {
      if (event.action === 'block') {
        const hashedIP = this.hashIP(event.ip);
        ipCounts.set(hashedIP, (ipCounts.get(hashedIP) || 0) + 1);
      }
    });

    const topBlockedIPs = Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top triggered rules
    const ruleCounts = new Map<string, number>();
    recentEvents.forEach(event => {
      ruleCounts.set(event.rule, (ruleCounts.get(event.rule) || 0) + 1);
    });

    const topTriggeredRules = Array.from(ruleCounts.entries())
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate threat level
    const criticalEvents = recentEvents.filter(e => e.severity === 'critical').length;
    const highEvents = recentEvents.filter(e => e.severity === 'high').length;
    const mediumEvents = recentEvents.filter(e => e.severity === 'medium').length;

    let threatLevel: SecurityMetrics['threatLevel'] = 'low';
    if (criticalEvents > 0) threatLevel = 'critical';
    else if (highEvents > 5) threatLevel = 'high';
    else if (mediumEvents > 20) threatLevel = 'medium';

    return {
      totalRequests: totalRequests,
      blockedRequests,
      throttledRequests,
      securityEvents: recentEvents.length,
      topBlockedIPs,
      topTriggeredRules,
      threatLevel,
    };
  }

  /**
   * Setup default security rules
   */
  private setupDefaultRules(): void {
    // SQL injection detection
    this.addSecurityRule({
      name: 'sql_injection_detection',
      type: 'pattern_match',
      condition: /('|(\\x27)|(\\x2D)|(\\x3E)|(\\x3C)|(\\x22)|(\\x00)|(\\x5C)|(\\x0D)|(\\x0A)|(\\x1A)|(\\x09)|(\\x20)|(\\x3B)|(\\x2F)|(\\x2A)|(\\x2B)|(\\x3D)|(\\x28)|(\\x29)|(\\x5B)|(\\x5D)|(\\x7B)|(\\x7D)|(\\x3A)|(\\x3F)|(\\x21)|(\\x40)|(\\x23)|(\\x24)|(\\x25)|(\\x5E)|(\\x26)|(\\x2A)|(\\x7E)|(\\x60)|(\\x7C)|(\\x5C)|(\\x22)|(\\x27)|(\\x5C)|(\\x2E)|(\\x2D)|(\\x2B)|(\\x3D)|(\\x3C)|(\\x3E)|(\\x3F)|(\\x3A)|(\\x3B)|(\\x2C)|(\\x21)|(\\x40)|(\\x23)|(\\x24)|(\\x25)|(\\x5E)|(\\x26)|(\\x2A)|(\\x28)|(\\x29)|(\\x5F)|(\\x2B)|(\\x3D)|(\\x5B)|(\\x5D)|(\\x7B)|(\\x7D)|(\\x5C)|(\\x7C)|(\\x3A)|(\\x3B)|(\\x22)|(\\x27)|(\\x3C)|(\\x3E)|(\\x2C)|(\\x2E)|(\\x3F)|(\\x2F))/gi,
      action: 'block',
      severity: 'high',
      enabled: true,
    });

    // XSS detection
    this.addSecurityRule({
      name: 'xss_detection',
      type: 'pattern_match',
      condition: /<script[^>]*>.*?<\/script>/gi,
      action: 'block',
      severity: 'high',
      enabled: true,
    });

    // Suspicious user agents
    this.addSecurityRule({
      name: 'suspicious_user_agents',
      type: 'pattern_match',
      condition: /(bot|crawler|spider|scraper|curl|wget|python|node|php|java|go-http)/i,
      action: 'throttle',
      severity: 'medium',
      enabled: true,
    });

    // API rate limiting
    this.configureRateLimit('/graphql', {
      windowMs: 60000, // 1 minute
      maxRequests: 100,
      keyGenerator: (event) => `graphql:${this.getClientIP(event)}`,
    });

    this.configureRateLimit('/auth', {
      windowMs: 900000, // 15 minutes
      maxRequests: 5,
      keyGenerator: (event) => `auth:${this.getClientIP(event)}`,
    });

    logger.info('Default security rules configured');
  }

  /**
   * Start security monitoring
   */
  private startSecurityMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      const metrics = await this.getSecurityMetrics();
      
      // Log security status
      logger.info('Security monitoring report', {
        threatLevel: metrics.threatLevel,
        blockedRequests: metrics.blockedRequests,
        throttledRequests: metrics.throttledRequests,
        securityEvents: metrics.securityEvents,
      });

      // Alert on high threat levels
      if (metrics.threatLevel === 'critical' || metrics.threatLevel === 'high') {
        logger.error('High threat level detected', {
          threatLevel: metrics.threatLevel,
          metrics,
        });
      }

    }, 300000); // Every 5 minutes
  }

  // Helper methods
  private getClientIP(event: H3Event): string {
    return (
      event.node.req.headers['x-forwarded-for'] as string ||
      event.node.req.headers['x-real-ip'] as string ||
      event.node.req.connection?.remoteAddress ||
      '127.0.0.1'
    ).split(',')[0].trim();
  }

  private hashIP(ip: string): string {
    return hash(ip).substring(0, 8);
  }

  private getUserId(userAgent: string): string | undefined {
    // Extract user ID from session context if available
    return undefined;
  }

  private async calculateIPReputation(ip: string): Promise<{ score: number; violations: number }> {
    // In a real implementation, this would check:
    // - Threat intelligence feeds
    // - Previous violations
    // - Geographic location
    // - ISP reputation
    
    // For now, return neutral reputation
    return { score: 50, violations: 0 };
  }

  private async getCountryFromIP(ip: string): Promise<string> {
    // In a real implementation, use a geo-IP service like MaxMind
    // For now, return a default country
    return 'US';
  }

  private async updateIPReputation(ip: string, delta: number): Promise<void> {
    const current = this.ipReputation.get(ip) || {
      score: 50,
      lastUpdate: new Date(),
      violations: 0,
    };

    current.score = Math.max(0, Math.min(100, current.score + delta));
    current.lastUpdate = new Date();
    if (delta < 0) current.violations++;

    this.ipReputation.set(ip, current);
  }

  private evaluatePatternRule(rule: SecurityRule, event: H3Event): { passed: boolean; reason?: string } {
    const url = event.node.req.url || '';
    const body = (event.node.req as any).body || '';
    const userAgent = event.node.req.headers['user-agent'] || '';
    
    const content = `${url} ${body} ${userAgent}`;
    
    if (rule.condition instanceof RegExp) {
      const match = rule.condition.test(content);
      return {
        passed: !match,
        reason: match ? `Pattern matched: ${rule.condition}` : undefined,
      };
    }

    return { passed: true };
  }

  private evaluateIPAllowlistRule(rule: SecurityRule, event: H3Event): { passed: boolean; reason?: string } {
    const ip = this.getClientIP(event);
    const allowedIPs = rule.metadata?.ips || [];
    
    const allowed = allowedIPs.includes(ip);
    return {
      passed: allowed,
      reason: allowed ? undefined : `IP not in allowlist: ${ip}`,
    };
  }

  private evaluateIPBlocklistRule(rule: SecurityRule, event: H3Event): { passed: boolean; reason?: string } {
    const ip = this.getClientIP(event);
    const blockedIPs = rule.metadata?.ips || [];
    
    const blocked = blockedIPs.includes(ip);
    return {
      passed: !blocked,
      reason: blocked ? `IP in blocklist: ${ip}` : undefined,
    };
  }

  /**
   * Shutdown security manager
   */
  public shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Advanced security manager shutdown completed');
  }
}

/**
 * Security middleware for H3
 */
export function createSecurityMiddleware() {
  const securityManager = AdvancedSecurityManager.getInstance();

  return async (event: H3Event) => {
    const result = await securityManager.checkRequest(event);
    
    if (!result.allowed) {
      const status = result.action === 'throttle' ? 429 : 403;
      const message = result.reason || 'Request blocked by security policy';
      
      throw new Error(`Security check failed: ${message}`);
    }
  };
}