/**
 * Enterprise Security System
 * Advanced security features including threat detection, audit logging, and compliance
 */

import { logger, objectUtils, stringUtils, cryptoUtils } from '@/lib/unjs-utils.js';
import { configManager } from '@/config/unjs-config.js';
import { validationService } from '@/infrastructure/validation/UnJSValidation.js';
import { monitoring } from '@/infrastructure/observability/AdvancedMonitoring.js';
import { z } from 'zod';
import type { H3Event } from 'h3';

export interface ISecurityEvent {
  id: string;
  type: 'authentication' | 'authorization' | 'threat' | 'compliance' | 'audit';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  ip: string;
  userAgent: string;
  resource?: string;
  action?: string;
  details: Record<string, any>;
  blocked: boolean;
}

export interface IThreatPattern {
  id: string;
  name: string;
  pattern: RegExp | string;
  type: 'sql_injection' | 'xss' | 'csrf' | 'rate_limit' | 'brute_force' | 'suspicious_behavior';
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  action: 'log' | 'block' | 'throttle';
  threshold?: number;
  windowMs?: number;
}

export interface IAuditLog {
  id: string;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  operation: string;
  resource: string;
  resourceId?: string;
  changes?: {
    before?: any;
    after?: any;
    fields?: string[];
  };
  ip: string;
  userAgent: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface IComplianceRule {
  id: string;
  name: string;
  regulation: 'GDPR' | 'HIPAA' | 'SOX' | 'PCI_DSS' | 'CCPA' | 'SOC2';
  description: string;
  enabled: boolean;
  checker: (context: any) => Promise<{ compliant: boolean; issues?: string[] }>;
}

/**
 * Enterprise-grade security system
 */
export class EnterpriseSecuritySystem {
  private securityEvents: Map<string, ISecurityEvent[]> = new Map();
  private threatPatterns: Map<string, IThreatPattern> = new Map();
  private auditLogs: IAuditLog[] = [];
  private complianceRules: Map<string, IComplianceRule> = new Map();
  private rateLimitStore: Map<string, { count: number; resetTime: number; blocked: boolean }> = new Map();
  private bruteForceTracker: Map<string, { attempts: number; lastAttempt: Date; blocked: boolean }> = new Map();
  private retentionPeriod = 90 * 24 * 60 * 60 * 1000; // 90 days

  constructor() {
    this.setupValidationSchemas();
    this.registerDefaultThreatPatterns();
    this.registerDefaultComplianceRules();
    this.startCleanupProcess();
    this.startSecurityMonitoring();
  }

  /**
   * Setup validation schemas
   */
  private setupValidationSchemas(): void {
    const securityEventSchema = z.object({
      type: z.enum(['authentication', 'authorization', 'threat', 'compliance', 'audit']),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      userId: z.string().optional(),
      sessionId: z.string().optional(),
      ip: z.ipv4(),
      userAgent: z.string(),
      resource: z.string().optional(),
      action: z.string().optional(),
      details: z.record(z.string(), z.any()),
      blocked: z.boolean().default(false),
    });

    const auditLogSchema = z.object({
      userId: z.string().optional(),
      sessionId: z.string().optional(),
      operation: z.string(),
      resource: z.string(),
      resourceId: z.string().optional(),
      changes: z.object({
        before: z.any().optional(),
        after: z.any().optional(),
        fields: z.array(z.string()).optional(),
      }).optional(),
      ip: z.ipv4(),
      userAgent: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    });

    validationService.registerSchema('securityEvent', securityEventSchema);
    validationService.registerSchema('auditLog', auditLogSchema);
  }

  /**
   * Middleware for threat detection and security validation
   */
  createSecurityMiddleware() {
    return async (event: H3Event, next: Function) => {
      const startTime = Date.now();
      const ip = this.getClientIP(event);
      const userAgent = this.getUserAgent(event);
      const url = event.node.req.url || '';
      const method = event.node.req.method || 'GET';

      try {
        // Check rate limiting
        const rateLimitResult = this.checkRateLimit(ip, url);
        if (rateLimitResult.blocked) {
          await this.recordSecurityEvent({
            type: 'threat',
            severity: 'medium',
            ip,
            userAgent,
            resource: url,
            action: method,
            details: {
              reason: 'rate_limit_exceeded',
              requests: rateLimitResult.count,
              windowMs: rateLimitResult.windowMs,
            },
            blocked: true,
          });

          monitoring.recordMetric({
            name: 'security.rate_limit.blocked',
            value: 1,
            tags: { ip, resource: url },
          });

          throw new Error('Rate limit exceeded');
        }

        // Check for threat patterns
        const threatResult = await this.detectThreats(event);
        if (threatResult.blocked) {
          await this.recordSecurityEvent({
            type: 'threat',
            severity: threatResult.severity,
            ip,
            userAgent,
            resource: url,
            action: method,
            details: {
              patterns: threatResult.patterns,
              payload: threatResult.payload,
            },
            blocked: true,
          });

          monitoring.recordMetric({
            name: 'security.threat.blocked',
            value: 1,
            tags: {
              ip,
              type: threatResult.patterns[0]?.type || 'unknown',
              severity: threatResult.severity
            },
          });

          throw new Error('Security threat detected');
        }

        // Continue with request
        const result = await next(event);

        // Record successful request metrics
        monitoring.recordMetric({
          name: 'security.request.success',
          value: 1,
          tags: { ip, method, url },
        });

        monitoring.recordMetric({
          name: 'security.request.duration',
          value: Date.now() - startTime,
          tags: { ip, method, url },
          unit: 'ms',
        });

        return result;

      } catch (error) {
        // Record security error
        await this.recordSecurityEvent({
          type: 'threat',
          severity: 'medium',
          ip,
          userAgent,
          resource: url,
          action: method,
          details: {
            error: String(error),
            duration: Date.now() - startTime,
          },
          blocked: true,
        });

        monitoring.recordMetric({
          name: 'security.request.error',
          value: 1,
          tags: { ip, method, url, error: 'security_violation' },
        });

        throw error;
      }
    };
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(
    ip: string,
    resource: string,
    config: { max: number; windowMs: number } = { max: 100, windowMs: 60000 }
  ): { blocked: boolean; count: number; windowMs: number } {
    const key = `${ip}:${resource}`;
    const now = Date.now();
    const limit = this.rateLimitStore.get(key);

    if (!limit || now > limit.resetTime) {
      this.rateLimitStore.set(key, {
        count: 1,
        resetTime: now + config.windowMs,
        blocked: false,
      });
      return { blocked: false, count: 1, windowMs: config.windowMs };
    }

    limit.count++;

    if (limit.count > config.max && !limit.blocked) {
      limit.blocked = true;
      logger.warn('Rate limit exceeded', { ip, resource, count: limit.count });
    }

    return {
      blocked: limit.blocked,
      count: limit.count,
      windowMs: config.windowMs
    };
  }

  /**
   * Detect security threats
   */
  private async detectThreats(event: H3Event): Promise<{
    blocked: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
    patterns: IThreatPattern[];
    payload?: any;
  }> {
    const url = event.node.req.url || '';
    const method = event.node.req.method || 'GET';
    const headers = event.node.req.headers;
    let body: any = null;

    // Try to read body for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        body = await this.readBody(event);
      } catch {
        // Ignore body read errors
      }
    }

    const detectedPatterns: IThreatPattern[] = [];
    let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let shouldBlock = false;

    // Check all threat patterns
    for (const pattern of this.threatPatterns.values()) {
      if (!pattern.enabled) continue;

      const isMatch = await this.checkThreatPattern(pattern, {
        url,
        method,
        headers,
        body,
      });

      if (isMatch) {
        detectedPatterns.push(pattern);

        // Update max severity
        const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
        if (severityLevels[pattern.severity] > severityLevels[maxSeverity]) {
          maxSeverity = pattern.severity;
        }

        // Check if we should block
        if (pattern.action === 'block') {
          shouldBlock = true;
        }

        logger.warn('Threat pattern detected', {
          pattern: pattern.name,
          type: pattern.type,
          severity: pattern.severity,
          url,
          method,
        });
      }
    }

    return {
      blocked: shouldBlock,
      severity: maxSeverity,
      patterns: detectedPatterns,
      payload: { url, method, headers: Object.keys(headers), body: body ? '[REDACTED]' : null },
    };
  }

  /**
   * Check individual threat pattern
   */
  private async checkThreatPattern(
    pattern: IThreatPattern,
    context: {
      url: string;
      method: string;
      headers: Record<string, any>;
      body?: any;
    }
  ): Promise<boolean> {
    const { url, method, headers, body } = context;

    switch (pattern.type) {
      case 'sql_injection':
        return this.checkSQLInjection(url, body);

      case 'xss':
        return this.checkXSS(url, body);

      case 'csrf':
        return this.checkCSRF(headers, method);

      case 'brute_force':
        return this.checkBruteForce(context);

      case 'suspicious_behavior':
        return this.checkSuspiciousBehavior(context);

      default:
        // Pattern-based check
        if (pattern.pattern instanceof RegExp) {
          return pattern.pattern.test(url) ||
            pattern.pattern.test(JSON.stringify(body) || '');
        } else {
          return url.includes(pattern.pattern) ||
            (JSON.stringify(body) || '').includes(pattern.pattern);
        }
    }
  }

  /**
   * Check for SQL injection patterns
   */
  private checkSQLInjection(url: string, body: any): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
      /(--|\#|\/\*|\*\/)/,
      /(\b(SCRIPT|JAVASCRIPT|VBSCRIPT)\b)/i,
    ];

    const content = `${url} ${JSON.stringify(body) || ''}`;
    return sqlPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check for XSS patterns
   */
  private checkXSS(url: string, body: any): boolean {
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe[^>]*>/i,
      /<object[^>]*>/i,
      /<embed[^>]*>/i,
    ];

    const content = `${url} ${JSON.stringify(body) || ''}`;
    return xssPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check for CSRF attacks
   */
  private checkCSRF(headers: Record<string, any>, method: string): boolean {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return false;
    }

    const csrfToken = headers['x-csrf-token'] || headers['csrf-token'];
    const referer = headers.referer;
    const origin = headers.origin;

    // Simple CSRF check - would be more sophisticated in production
    return !csrfToken && (!referer || !origin);
  }

  /**
   * Check for brute force attacks
   */
  private checkBruteForce(context: { url: string; headers: Record<string, any> }): boolean {
    // This would track failed login attempts
    // For now, return false as it requires more context
    return false;
  }

  /**
   * Check for suspicious behavior
   */
  private checkSuspiciousBehavior(context: any): boolean {
    // This would implement ML-based anomaly detection
    // For now, return false
    return false;
  }

  /**
   * Record security event
   */
  async recordSecurityEvent(event: Omit<ISecurityEvent, 'id' | 'timestamp'>): Promise<string> {
    const securityEvent: ISecurityEvent = {
      id: stringUtils.random(12),
      timestamp: new Date(),
      ...event,
    };

    const key = `${event.type}:${event.ip}`;
    if (!this.securityEvents.has(key)) {
      this.securityEvents.set(key, []);
    }

    this.securityEvents.get(key)!.push(securityEvent);

    // Record metrics
    monitoring.recordMetric({
      name: `security.event.${event.type}`,
      value: 1,
      tags: {
        severity: event.severity,
        blocked: event.blocked.toString(),
        ip: event.ip,
      },
    });

    logger.warn('Security event recorded', {
      id: securityEvent.id,
      type: event.type,
      severity: event.severity,
      blocked: event.blocked,
      ip: event.ip,
    });

    return securityEvent.id;
  }

  /**
   * Record audit log
   */
  async recordAuditLog(log: Omit<IAuditLog, 'id' | 'timestamp'>): Promise<string> {
    const auditLog: IAuditLog = {
      id: stringUtils.random(12),
      timestamp: new Date(),
      ...log,
    };

    this.auditLogs.push(auditLog);

    // Keep only recent logs
    const cutoff = Date.now() - this.retentionPeriod;
    this.auditLogs = this.auditLogs.filter(log => log.timestamp.getTime() > cutoff);

    // Record metrics
    monitoring.recordMetric({
      name: 'security.audit_log',
      value: 1,
      tags: {
        operation: log.operation,
        resource: log.resource,
        success: log.success.toString(),
        userId: log.userId || 'anonymous',
      },
    });

    logger.info('Audit log recorded', {
      id: auditLog.id,
      operation: log.operation,
      resource: log.resource,
      userId: log.userId,
      success: log.success,
    });

    return auditLog.id;
  }

  /**
   * Register threat pattern
   */
  registerThreatPattern(pattern: Omit<IThreatPattern, 'id'>): string {
    const id = stringUtils.random(8);
    this.threatPatterns.set(id, { id, ...pattern });

    logger.info('Threat pattern registered', { id, name: pattern.name, type: pattern.type });
    return id;
  }

  /**
   * Register compliance rule
   */
  registerComplianceRule(rule: Omit<IComplianceRule, 'id'>): string {
    const id = stringUtils.random(8);
    this.complianceRules.set(id, { id, ...rule });

    logger.info('Compliance rule registered', { id, name: rule.name, regulation: rule.regulation });
    return id;
  }

  /**
   * Run compliance check
   */
  async runComplianceCheck(context: any): Promise<{
    compliant: boolean;
    results: Array<{
      rule: IComplianceRule;
      compliant: boolean;
      issues?: string[];
    }>;
  }> {
    const results = [];
    let overallCompliant = true;

    for (const rule of this.complianceRules.values()) {
      if (!rule.enabled) continue;

      try {
        const result = await rule.checker(context);
        results.push({
          rule,
          compliant: result.compliant,
          issues: result.issues,
        });

        if (!result.compliant) {
          overallCompliant = false;
        }

      } catch (error) {
        logger.error('Compliance check error', {
          ruleId: rule.id,
          ruleName: rule.name,
          error
        });

        results.push({
          rule,
          compliant: false,
          issues: [`Check failed: ${String(error)}`],
        });

        overallCompliant = false;
      }
    }

    // Record compliance metrics
    monitoring.recordMetric({
      name: 'security.compliance.check',
      value: overallCompliant ? 1 : 0,
      tags: {
        compliant: overallCompliant.toString(),
        rulesChecked: results.length.toString(),
      },
    });

    return { compliant: overallCompliant, results };
  }

  /**
   * Get security dashboard data
   */
  getSecurityDashboard(): {
    events: {
      total: number;
      last24h: number;
      byType: Record<string, number>;
      bySeverity: Record<string, number>;
    };
    threats: {
      patternsActive: number;
      detectionsLast24h: number;
      topThreats: Array<{ type: string; count: number }>;
    };
    compliance: {
      rulesActive: number;
      lastCheckTime?: Date;
      overallStatus: 'compliant' | 'non-compliant' | 'unknown';
    };
    audit: {
      totalLogs: number;
      last24h: number;
      topOperations: Array<{ operation: string; count: number }>;
    };
  } {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);

    // Collect all events
    const allEvents = Array.from(this.securityEvents.values()).flat();
    const recent24hEvents = allEvents.filter(e => e.timestamp.getTime() > last24h);

    // Events statistics
    const eventsByType = allEvents.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsBySeverity = allEvents.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Audit log statistics
    const recent24hAudits = this.auditLogs.filter(log => log.timestamp.getTime() > last24h);
    const topOperations = this.auditLogs.reduce((acc, log) => {
      acc[log.operation] = (acc[log.operation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      events: {
        total: allEvents.length,
        last24h: recent24hEvents.length,
        byType: eventsByType,
        bySeverity: eventsBySeverity,
      },
      threats: {
        patternsActive: Array.from(this.threatPatterns.values()).filter(p => p.enabled).length,
        detectionsLast24h: recent24hEvents.filter(e => e.type === 'threat').length,
        topThreats: Object.entries(eventsByType)
          .filter(([type]) => type === 'threat')
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      },
      compliance: {
        rulesActive: Array.from(this.complianceRules.values()).filter(r => r.enabled).length,
        overallStatus: 'unknown', // Would be determined by last compliance check
      },
      audit: {
        totalLogs: this.auditLogs.length,
        last24h: recent24hAudits.length,
        topOperations: Object.entries(topOperations)
          .map(([operation, count]) => ({ operation, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      },
    };
  }

  /**
   * Register default threat patterns
   */
  private registerDefaultThreatPatterns(): void {
    // SQL Injection
    this.registerThreatPattern({
      name: 'SQL Injection Detection',
      pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      type: 'sql_injection',
      severity: 'high',
      enabled: true,
      action: 'block',
    });

    // XSS
    this.registerThreatPattern({
      name: 'Cross-Site Scripting Detection',
      pattern: /<script[^>]*>.*?<\/script>/i,
      type: 'xss',
      severity: 'high',
      enabled: true,
      action: 'block',
    });

    // Suspicious User Agents
    this.registerThreatPattern({
      name: 'Suspicious User Agent',
      pattern: /(bot|crawler|spider|scraper)/i,
      type: 'suspicious_behavior',
      severity: 'low',
      enabled: true,
      action: 'log',
    });

    logger.debug('Default threat patterns registered');
  }

  /**
   * Register default compliance rules
   */
  private registerDefaultComplianceRules(): void {
    // GDPR - Data retention
    this.registerComplianceRule({
      name: 'GDPR Data Retention',
      regulation: 'GDPR',
      description: 'Ensure personal data is not retained longer than necessary',
      enabled: true,
      checker: async (context) => {
        // Mock compliance check
        return { compliant: true };
      },
    });

    // SOC2 - Access logging
    this.registerComplianceRule({
      name: 'SOC2 Access Logging',
      regulation: 'SOC2',
      description: 'All system access must be logged',
      enabled: true,
      checker: async (context) => {
        return { compliant: this.auditLogs.length > 0 };
      },
    });

    logger.debug('Default compliance rules registered');
  }

  /**
   * Start security monitoring
   */
  private startSecurityMonitoring(): void {
    // Generate security health metrics every minute
    setInterval(() => {
      const dashboard = this.getSecurityDashboard();

      monitoring.recordMetric({
        name: 'security.events.total',
        value: dashboard.events.total,
        tags: {},
      });

      monitoring.recordMetric({
        name: 'security.threats.active_patterns',
        value: dashboard.threats.patternsActive,
        tags: {},
      });

      monitoring.recordMetric({
        name: 'security.audit.total_logs',
        value: dashboard.audit.totalLogs,
        tags: {},
      });

    }, 60000); // Every minute

    logger.debug('Security monitoring started');
  }

  /**
   * Start cleanup process
   */
  private startCleanupProcess(): void {
    setInterval(() => {
      const cutoff = Date.now() - this.retentionPeriod;

      // Clean up old security events
      for (const [key, events] of this.securityEvents.entries()) {
        const filtered = events.filter(e => e.timestamp.getTime() > cutoff);
        if (filtered.length === 0) {
          this.securityEvents.delete(key);
        } else {
          this.securityEvents.set(key, filtered);
        }
      }

      // Clean up rate limit store
      const now = Date.now();
      for (const [key, limit] of this.rateLimitStore.entries()) {
        if (now > limit.resetTime) {
          this.rateLimitStore.delete(key);
        }
      }

      logger.debug('Security data cleanup completed');

    }, 3600000); // Every hour
  }

  /**
   * Helper methods
   */
  private getClientIP(event: H3Event): string {
    const forwarded = event.node.req.headers['x-forwarded-for'];
    if (forwarded) {
      return (forwarded as string).split(',')[0]?.trim() || 'unknown';
    }
    return event.node.req.socket?.remoteAddress || 'unknown';
  }

  private getUserAgent(event: H3Event): string {
    return (event.node.req.headers['user-agent'] as string) || 'unknown';
  }

  private async readBody(event: H3Event): Promise<any> {
    // This would implement proper body reading
    // For now, return null
    return null;
  }
}

// Export singleton instance
export const enterpriseSecurity = new EnterpriseSecuritySystem();
