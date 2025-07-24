/**
 * Security-Specific Decorators
 * 
 * Specialized decorators for security services that extend the base decorators
 * with security-specific functionality like threat detection, access control,
 * audit logging, and compliance tracking.
 */

import { z } from 'zod';
import { BaseService } from '../BaseService.js';
import { BaseAsyncService } from '../BaseAsyncService.js';
import { Metric } from './ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';
import { performance } from 'perf_hooks';

/**
 * Security audit decorator
 * Automatically logs security events for compliance
 */
export interface SecurityAuditOptions {
  eventType: string;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  complianceFrameworks?: string[];
  includeStackTrace?: boolean;
  maskSensitiveData?: boolean;
}

export function SecurityAudit(options: SecurityAuditOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const auditId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startTime = Date.now();
      const userId = this.getCurrentUserId?.() || 'system';
      const sessionId = this.getCurrentSessionId?.() || 'unknown';

      // Pre-execution audit log
      const auditEvent = {
        eventId: auditId,
        eventType: options.eventType,
        userId,
        sessionId,
        timestamp: startTime,
        resource: `${target.constructor.name}.${propertyKey}`,
        action: 'attempt',
        outcome: 'pending' as 'success' | 'failure' | 'pending',
        metadata: {
          sensitivity: options.sensitivity,
          complianceFrameworks: options.complianceFrameworks || [],
          arguments: options.maskSensitiveData ? this.maskSensitiveArguments(args) : args,
          service: this.getServiceName(),
        },
      };

      this.emit('audit:event-logged' as any, auditEvent);

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        // Success audit log
        this.emit('audit:event-logged' as any, {
          ...auditEvent,
          action: 'completed',
          outcome: 'success',
          metadata: {
            ...auditEvent.metadata,
            duration,
            result: options.maskSensitiveData ? this.maskSensitiveData(result) : result,
          },
        });

        // Record security metrics
        this.recordMetric('security.audit.events', 1, {
          eventType: options.eventType,
          outcome: 'success',
          sensitivity: options.sensitivity,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Failure audit log
        this.emit('audit:event-logged' as any, {
          ...auditEvent,
          action: 'failed',
          outcome: 'failure',
          metadata: {
            ...auditEvent.metadata,
            duration,
            error: (error as Error).message,
            stackTrace: options.includeStackTrace ? (error as Error).stack : undefined,
          },
        });

        // Record security metrics
        this.recordMetric('security.audit.events', 1, {
          eventType: options.eventType,
          outcome: 'failure',
          sensitivity: options.sensitivity,
        });

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Access control decorator
 * Enforces role-based access control (RBAC)
 */
export interface AccessControlOptions {
  requiredRoles?: string[];
  requiredPermissions?: string[];
  resource?: string;
  action?: string;
  allowSuperuser?: boolean;
  checkOwnership?: boolean;
  ownershipField?: string;
}

export function AccessControl(options: AccessControlOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const userId = this.getCurrentUserId?.();
      const userRoles = this.getCurrentUserRoles?.() || [];
      const userPermissions = this.getCurrentUserPermissions?.() || [];

      if (!userId) {
        const error = new Error('Authentication required');
        this.emit('policy:violation' as any, {
          policyId: 'authentication',
          subject: 'anonymous',
          resource: options.resource || `${target.constructor.name}.${propertyKey}`,
          action: options.action || propertyKey,
          violation: 'No authentication provided',
          severity: 'high',
        });
        throw error;
      }

      // Check superuser bypass
      if (options.allowSuperuser && userRoles.includes('superuser')) {
        return originalMethod.apply(this, args);
      }

      // Check required roles
      if (options.requiredRoles && options.requiredRoles.length > 0) {
        const hasRequiredRole = options.requiredRoles.some(role => userRoles.includes(role));
        if (!hasRequiredRole) {
          this.emit('policy:violation' as any, {
            policyId: 'rbac',
            subject: userId,
            resource: options.resource || `${target.constructor.name}.${propertyKey}`,
            action: options.action || propertyKey,
            violation: `Missing required roles: ${options.requiredRoles.join(', ')}`,
            severity: 'medium',
          });
          throw new Error('Insufficient role permissions');
        }
      }

      // Check required permissions
      if (options.requiredPermissions && options.requiredPermissions.length > 0) {
        const hasRequiredPermission = options.requiredPermissions.some(perm => 
          userPermissions.includes(perm)
        );
        if (!hasRequiredPermission) {
          this.emit('policy:violation' as any, {
            policyId: 'permissions',
            subject: userId,
            resource: options.resource || `${target.constructor.name}.${propertyKey}`,
            action: options.action || propertyKey,
            violation: `Missing required permissions: ${options.requiredPermissions.join(', ')}`,
            severity: 'medium',
          });
          throw new Error('Insufficient permissions');
        }
      }

      // Check ownership if required
      if (options.checkOwnership && options.ownershipField) {
        const resourceOwnerId = await this.getResourceOwnerId?.(args[0], options.ownershipField);
        if (resourceOwnerId && resourceOwnerId !== userId && !userRoles.includes('admin')) {
          this.emit('policy:violation' as any, {
            policyId: 'ownership',
            subject: userId,
            resource: options.resource || `${target.constructor.name}.${propertyKey}`,
            action: options.action || propertyKey,
            violation: 'User does not own the resource',
            severity: 'high',
          });
          throw new Error('Access denied: resource ownership required');
        }
      }

      // Log successful authorization
      this.emit('policy:evaluated' as any, {
        policyId: `${target.constructor.name}.${propertyKey}`,
        subject: userId,
        resource: options.resource || `${target.constructor.name}.${propertyKey}`,
        action: options.action || propertyKey,
        decision: 'permit',
        duration: 0,
        context: {
          roles: userRoles,
          permissions: userPermissions,
        },
      });

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Rate limiting decorator for security
 * Prevents abuse and DoS attacks
 */
export interface SecurityRateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: 'ip' | 'user' | 'session' | 'custom';
  blockDuration?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  whitelist?: string[];
}

export function SecurityRateLimit(options: SecurityRateLimitOptions) {
  const requestCounts = new Map<string, { count: number; resetTime: number; blocked?: number }>();

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const now = Date.now();
      const key = this.generateRateLimitKey?.(options.keyGenerator || 'ip') || 'default';

      // Check whitelist
      if (options.whitelist && options.whitelist.includes(key)) {
        return originalMethod.apply(this, args);
      }

      // Get or create rate limit entry
      let entry = requestCounts.get(key);
      if (!entry || now > entry.resetTime) {
        entry = {
          count: 0,
          resetTime: now + options.windowMs,
        };
        requestCounts.set(key, entry);
      }

      // Check if blocked
      if (entry.blocked && now < entry.blocked) {
        this.emit('apikey:rate-limited' as any, {
          keyId: key,
          endpoint: `${target.constructor.name}.${propertyKey}`,
          currentRate: entry.count,
          limit: options.maxRequests,
          windowMs: options.windowMs,
        });
        throw new Error('Rate limit exceeded - blocked');
      }

      // Check rate limit
      if (entry.count >= options.maxRequests) {
        if (options.blockDuration) {
          entry.blocked = now + options.blockDuration;
        }

        this.emit('apikey:rate-limited' as any, {
          keyId: key,
          endpoint: `${target.constructor.name}.${propertyKey}`,
          currentRate: entry.count,
          limit: options.maxRequests,
          windowMs: options.windowMs,
        });

        this.recordMetric('security.rate_limit.exceeded', 1, {
          endpoint: `${target.constructor.name}.${propertyKey}`,
          key: this.hashKey(key),
        });

        throw new Error('Rate limit exceeded');
      }

      // Execute method
      let success = true;
      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        // Update count based on options
        const shouldCount = success ? !options.skipSuccessfulRequests : !options.skipFailedRequests;
        if (shouldCount) {
          entry.count++;
        }
      }
    };

    return descriptor;
  };
}

/**
 * Threat detection decorator
 * Monitors for suspicious activities
 */
export interface ThreatDetectionOptions {
  threatTypes: Array<'brute_force' | 'anomaly' | 'privilege_escalation' | 'data_exfiltration'>;
  sensitivityLevel: 'low' | 'medium' | 'high';
  autoBlock?: boolean;
  alertThreshold?: number;
}

export function ThreatDetection(options: ThreatDetectionOptions) {
  const suspiciousActivity = new Map<string, Array<{ timestamp: number; event: string }>>();

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const now = Date.now();
      const userId = this.getCurrentUserId?.() || 'anonymous';
      const clientIP = this.getClientIP?.() || 'unknown';
      const userAgent = this.getUserAgent?.() || 'unknown';
      
      // Track activity patterns
      const activityKey = `${userId}:${clientIP}`;
      if (!suspiciousActivity.has(activityKey)) {
        suspiciousActivity.set(activityKey, []);
      }

      const userActivity = suspiciousActivity.get(activityKey)!;
      userActivity.push({
        timestamp: now,
        event: `${target.constructor.name}.${propertyKey}`,
      });

      // Keep only recent activity (last hour)
      const cutoff = now - 3600000; // 1 hour
      const recentActivity = userActivity.filter(a => a.timestamp > cutoff);
      suspiciousActivity.set(activityKey, recentActivity);

      // Threat detection logic
      const threats = this.detectThreats(recentActivity, options, {
        userId,
        clientIP,
        userAgent,
        endpoint: `${target.constructor.name}.${propertyKey}`,
      });

      for (const threat of threats) {
        this.emit('threat:detected' as any, {
          threatId: `threat_${now}_${Math.random().toString(36).substr(2, 9)}`,
          type: threat.type,
          severity: threat.severity,
          source: clientIP,
          target: userId,
          description: threat.description,
          indicators: threat.indicators,
          timestamp: now,
          metadata: {
            userAgent,
            endpoint: `${target.constructor.name}.${propertyKey}`,
            activityCount: recentActivity.length,
          },
        });

        // Auto-block if configured
        if (options.autoBlock && threat.severity === 'critical') {
          this.blockUser?.(userId, 'Automatic threat detection', 3600000); // 1 hour
        }
      }

      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        // Failed attempts might indicate brute force
        if (options.threatTypes.includes('brute_force')) {
          const failedAttempts = recentActivity.filter(a => 
            a.event.includes('login') || a.event.includes('auth')
          ).length;

          if (failedAttempts > 5) {
            this.emit('threat:detected' as any, {
              threatId: `brute_force_${now}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'brute_force',
              severity: 'high',
              source: clientIP,
              target: userId,
              description: `Multiple failed authentication attempts: ${failedAttempts}`,
              indicators: [{
                type: 'failed_attempts',
                value: failedAttempts.toString(),
                confidence: 0.9,
              }],
              timestamp: now,
              metadata: { userAgent },
            });
          }
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Data classification decorator
 * Handles sensitive data according to classification
 */
export interface DataClassificationOptions {
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  dataTypes?: string[];
  encryptionRequired?: boolean;
  accessLogging?: boolean;
  retentionDays?: number;
}

export function DataClassification(options: DataClassificationOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const userId = this.getCurrentUserId?.() || 'system';
      const hasAccess = await this.checkDataAccess?.(userId, options.classification);

      if (!hasAccess) {
        this.emit('privacy:data-accessed' as any, {
          userId,
          dataTypes: options.dataTypes || ['unknown'],
          purpose: `${target.constructor.name}.${propertyKey}`,
          legalBasis: 'legitimate_interest',
          requestor: userId,
          authorized: false,
        });
        throw new Error(`Access denied: insufficient clearance for ${options.classification} data`);
      }

      // Log data access
      if (options.accessLogging) {
        this.emit('privacy:data-accessed' as any, {
          userId,
          dataTypes: options.dataTypes || ['unknown'],
          purpose: `${target.constructor.name}.${propertyKey}`,
          legalBasis: 'legitimate_interest',
          requestor: userId,
          authorized: true,
        });
      }

      try {
        let result = await originalMethod.apply(this, args);

        // Apply encryption if required
        if (options.encryptionRequired && result) {
          result = await this.encryptSensitiveData?.(result, options.classification) || result;
        }

        // Record data handling metrics
        this.recordMetric('security.data.accessed', 1, {
          classification: options.classification,
          dataTypes: options.dataTypes?.join(',') || 'unknown',
          encrypted: options.encryptionRequired ? 'yes' : 'no',
        });

        return result;
      } catch (error) {
        this.recordMetric('security.data.access_failed', 1, {
          classification: options.classification,
          error: (error as Error).name,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Compliance monitoring decorator
 * Ensures operations meet regulatory requirements
 */
export interface ComplianceMonitoringOptions {
  frameworks: Array<'gdpr' | 'hipaa' | 'pci_dss' | 'sox' | 'iso27001'>;
  requiredApprovals?: string[];
  evidenceCapture?: boolean;
  auditTrail?: boolean;
}

export function ComplianceMonitoring(options: ComplianceMonitoringOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const complianceContext = {
        operation: `${target.constructor.name}.${propertyKey}`,
        frameworks: options.frameworks,
        timestamp: Date.now(),
        userId: this.getCurrentUserId?.() || 'system',
      };

      // Check required approvals
      if (options.requiredApprovals && options.requiredApprovals.length > 0) {
        const approvals = await this.getOperationApprovals?.(
          complianceContext.operation,
          options.requiredApprovals
        );

        const missingApprovals = options.requiredApprovals.filter(
          approval => !approvals?.includes(approval)
        );

        if (missingApprovals.length > 0) {
          this.emit('policy:violation' as any, {
            policyId: 'compliance_approval',
            subject: complianceContext.userId,
            resource: complianceContext.operation,
            action: 'execute',
            violation: `Missing required approvals: ${missingApprovals.join(', ')}`,
            severity: 'high',
          });
          throw new Error(`Missing required approvals: ${missingApprovals.join(', ')}`);
        }
      }

      // Capture evidence if required
      let evidence: any = null;
      if (options.evidenceCapture) {
        evidence = {
          inputs: this.sanitizeForEvidence(args),
          context: complianceContext,
        };
      }

      try {
        const result = await originalMethod.apply(this, args);

        // Complete evidence capture
        if (evidence) {
          evidence.outputs = this.sanitizeForEvidence(result);
          evidence.outcome = 'success';
        }

        // Generate compliance report
        for (const framework of options.frameworks) {
          this.emit('audit:compliance-report' as any, {
            reportId: `compliance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            framework,
            period: {
              start: complianceContext.timestamp,
              end: Date.now(),
            },
            findings: [{
              requirement: `${framework.toUpperCase()}_OPERATION_CONTROL`,
              status: 'compliant' as const,
              evidence: evidence ? [JSON.stringify(evidence)] : [],
            }],
            score: 100,
          });
        }

        return result;
      } catch (error) {
        // Update evidence with error
        if (evidence) {
          evidence.outcome = 'failure';
          evidence.error = (error as Error).message;
        }

        // Report compliance violation
        for (const framework of options.frameworks) {
          this.emit('audit:compliance-report' as any, {
            reportId: `compliance_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            framework,
            period: {
              start: complianceContext.timestamp,
              end: Date.now(),
            },
            findings: [{
              requirement: `${framework.toUpperCase()}_ERROR_HANDLING`,
              status: 'non-compliant' as const,
              evidence: evidence ? [JSON.stringify(evidence)] : [],
              gaps: ['Operation failed without proper error handling'],
            }],
            score: 0,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Encryption decorator
 * Automatically encrypts sensitive data
 */
export interface EncryptionOptions {
  algorithm?: 'aes-256-gcm' | 'rsa-oaep' | 'post-quantum';
  fields?: string[];
  keyId?: string;
  encryptInputs?: boolean;
  encryptOutputs?: boolean;
}

export function Encryption(options: EncryptionOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      let processedArgs = args;

      // Encrypt inputs if required
      if (options.encryptInputs) {
        processedArgs = await Promise.all(args.map(async (arg) => {
          if (typeof arg === 'object' && arg !== null) {
            return await this.encryptObjectFields?.(arg, options.fields, options.algorithm) || arg;
          }
          return arg;
        }));
      }

      try {
        let result = await originalMethod.apply(this, processedArgs);

        // Encrypt outputs if required
        if (options.encryptOutputs && result) {
          if (typeof result === 'object') {
            result = await this.encryptObjectFields?.(result, options.fields, options.algorithm) || result;
          } else if (typeof result === 'string') {
            result = await this.encryptString?.(result, options.algorithm) || result;
          }
        }

        // Log encryption activity
        this.emit('encryption:data-encrypted' as any, {
          dataId: `data_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          algorithm: options.algorithm || 'aes-256-gcm',
          keyId: options.keyId || 'default',
          dataSize: JSON.stringify(result).length,
          duration: 0,
        });

        return result;
      } catch (error) {
        this.emit('encryption:error' as any, {
          error: error as Error,
          operation: 'encrypt',
          keyId: options.keyId,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Combined security monitoring decorator
 * Applies multiple security capabilities
 */
export function SecurityMonitored(options: {
  audit?: Omit<SecurityAuditOptions, 'eventType'>;
  accessControl?: AccessControlOptions;
  rateLimit?: SecurityRateLimitOptions;
  threatDetection?: ThreatDetectionOptions;
  dataClassification?: DataClassificationOptions;
}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Apply base metric decorator
    Metric({ 
      name: `security.${target.constructor.name.toLowerCase()}.${propertyKey}`, 
      recordDuration: true 
    })(target, propertyKey, descriptor);

    // Apply audit logging if enabled
    if (options.audit) {
      SecurityAudit({
        eventType: `${target.constructor.name}.${propertyKey}`,
        ...options.audit,
      })(target, propertyKey, descriptor);
    }

    // Apply access control if enabled
    if (options.accessControl) {
      AccessControl(options.accessControl)(target, propertyKey, descriptor);
    }

    // Apply rate limiting if enabled
    if (options.rateLimit) {
      SecurityRateLimit(options.rateLimit)(target, propertyKey, descriptor);
    }

    // Apply threat detection if enabled
    if (options.threatDetection) {
      ThreatDetection(options.threatDetection)(target, propertyKey, descriptor);
    }

    // Apply data classification if enabled
    if (options.dataClassification) {
      DataClassification(options.dataClassification)(target, propertyKey, descriptor);
    }

    return descriptor;
  };
}

/**
 * Helper method extensions for BaseService to support security decorators
 */
declare module '../BaseService' {
  interface BaseService<TConfig, TEventMap> {
    getCurrentUserId?(): string | undefined;
    getCurrentUserRoles?(): string[];
    getCurrentUserPermissions?(): string[];
    getCurrentSessionId?(): string | undefined;
    getClientIP?(): string | undefined;
    getUserAgent?(): string | undefined;
    getResourceOwnerId?(resource: any, field: string): Promise<string | undefined>;
    generateRateLimitKey?(strategy: string): string;
    hashKey(key: string): string;
    maskSensitiveArguments(args: any[]): any[];
    maskSensitiveData(data: any): any;
    detectThreats(activity: any[], options: ThreatDetectionOptions, context: any): any[];
    blockUser?(userId: string, reason: string, duration: number): void;
    checkDataAccess?(userId: string, classification: string): Promise<boolean>;
    encryptSensitiveData?(data: any, classification: string): Promise<any>;
    getOperationApprovals?(operation: string, required: string[]): Promise<string[]>;
    sanitizeForEvidence(data: any): any;
    encryptObjectFields?(obj: any, fields?: string[], algorithm?: string): Promise<any>;
    encryptString?(str: string, algorithm?: string): Promise<string>;
  }
}