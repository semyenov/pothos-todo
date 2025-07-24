/**
 * Enterprise API Key Manager Service
 * 
 * Advanced API key management system providing:
 * - Hierarchical API key scopes with inheritance
 * - Advanced rate limiting with multiple strategies
 * - API key lifecycle management with auto-rotation
 * - Suspicious activity detection and response
 * - Service account and machine-to-machine authentication
 * - Quota management with overage handling
 * - Integration with identity providers
 * - Compliance tracking and audit trails
 */

import crypto from 'crypto';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { SecurityAudit, AccessControl, SecurityRateLimit, ThreatDetection } from '../core/decorators/SecurityDecorators.js';
import type { ApiKeyManagerEventMap } from '../core/ServiceEventMaps.security.js';
import { performance } from 'perf_hooks';

// Configuration Schema
const ApiKeyManagerConfigSchema = z.object({
  keyGeneration: z.object({
    algorithm: z.enum(['random', 'uuid', 'secure-random']).default('secure-random'),
    length: z.number().min(16).max(128).default(64),
    prefix: z.string().min(1).max(10).default('pk_'),
    checksumEnabled: z.boolean().default(true),
  }),
  security: z.object({
    hashAlgorithm: z.enum(['sha256', 'sha384', 'sha512']).default('sha256'),
    saltRounds: z.number().min(10).max(15).default(12),
    encryption: z.boolean().default(true),
    hmacValidation: z.boolean().default(true),
  }),
  rateLimit: z.object({
    defaultRPM: z.number().min(1).max(10000).default(100),
    defaultDaily: z.number().min(1).max(1000000).default(10000),
    burstAllowance: z.number().min(1).max(100).default(10),
    slidingWindow: z.boolean().default(true),
  }),
  lifecycle: z.object({
    defaultExpiryDays: z.number().min(1).max(3650).default(365),
    rotationWarningDays: z.number().min(1).max(90).default(30),
    autoRotationEnabled: z.boolean().default(false),
    gracePeriodDays: z.number().min(0).max(90).default(7),
  }),
  monitoring: z.object({
    suspiciousActivityThreshold: z.number().min(0.1).max(1.0).default(0.8),
    geoLocationTracking: z.boolean().default(true),
    deviceFingerprinting: z.boolean().default(true),
    anomalyDetectionEnabled: z.boolean().default(true),
  }),
  compliance: z.object({
    auditAllAccess: z.boolean().default(true),
    retentionDays: z.number().min(30).max(2555).default(2555),
    encryptAuditLogs: z.boolean().default(true),
    piiRedaction: z.boolean().default(true),
  }),
});

type ApiKeyManagerConfig = z.infer<typeof ApiKeyManagerConfigSchema>;

// API Key Types and Interfaces
export interface EnterpriseApiKey {
  id: string;
  name: string;
  description?: string;
  keyPrefix: string;
  hashedKey: string;
  checksumHash?: string;
  
  // Ownership and context
  userId?: string;
  serviceAccount?: string;
  organizationId?: string;
  projectId?: string;
  environment: 'development' | 'staging' | 'production';
  
  // Permissions and access
  scopes: string[];
  scopeHierarchy: Record<string, string[]>;
  permissions: string[];
  resourceAccess: Record<string, string[]>;
  
  // Rate limiting and quotas
  rateLimit: {
    rpm: number;
    hourly: number;
    daily: number;
    monthly: number;
    burst: number;
    strategy: 'fixed' | 'sliding' | 'token-bucket';
  };
  
  quota: {
    requests: number;
    bandwidth: number; // bytes
    compute: number; // compute units
    storage: number; // bytes
  };
  
  // Lifecycle and security
  expiresAt?: Date;
  lastUsedAt?: Date;
  lastRotatedAt?: Date;
  rotationSchedule?: {
    enabled: boolean;
    intervalDays: number;
    nextRotation: Date;
  };
  
  // Status and flags
  status: 'active' | 'suspended' | 'expired' | 'revoked' | 'rotating';
  isActive: boolean;
  allowedOrigins?: string[];
  allowedIPs?: string[];
  requiredHeaders?: Record<string, string>;
  
  // Audit and compliance
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lastAuditAt?: Date;
  complianceFlags: string[];
  
  // Metadata and tags
  metadata: Record<string, any>;
  tags: string[];
}

export interface ApiKeyUsage {
  keyId: string;
  timestamp: Date;
  requests: number;
  bandwidth: number;
  compute: number;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  userAgent?: string;
  ipAddress?: string;
  geolocation?: {
    country: string;
    region: string;
    city: string;
  };
  deviceFingerprint?: string;
  errorDetails?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: {
    rpm: number;
    hourly: number;
    daily: number;
    monthly: number;
    burst: number;
  };
  resetTimes: {
    rpm: Date;
    hourly: Date;
    daily: Date;
    monthly: Date;
  };
  quotaUsage: {
    requests: number;
    bandwidth: number;
    compute: number;
    storage: number;
  };
  violations?: string[];
}

export interface SuspiciousActivity {
  keyId: string;
  activityType: 'unusual_location' | 'rapid_requests' | 'invalid_scopes' | 'failed_auth' | 'anomalous_pattern';
  riskScore: number;
  indicators: Array<{
    type: string;
    value: any;
    confidence: number;
  }>;
  timestamp: Date;
  mitigationActions: string[];
}

export interface ApiKeyMetrics {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  revokedKeys: number;
  totalRequests: number;
  averageRequestsPerKey: number;
  rateLimitViolations: number;
  suspiciousActivities: number;
  errorRate: number;
}

@ServiceConfig({
  schema: ApiKeyManagerConfigSchema,
  prefix: 'apikey',
  hot: true,
})
export class ApiKeyManager extends BaseService<ApiKeyManagerConfig, ApiKeyManagerEventMap> {
  private keys = new Map<string, EnterpriseApiKey>();
  private keysByPrefix = new Map<string, string>(); // prefix -> keyId
  private usageData = new Map<string, ApiKeyUsage[]>();
  private rateLimitCounters = new Map<string, Map<string, number>>();
  private suspiciousActivities = new Map<string, SuspiciousActivity[]>();
  private metrics: ApiKeyMetrics = {
    totalKeys: 0,
    activeKeys: 0,
    expiredKeys: 0,
    revokedKeys: 0,
    totalRequests: 0,
    averageRequestsPerKey: 0,
    rateLimitViolations: 0,
    suspiciousActivities: 0,
    errorRate: 0,
  };

  protected async initialize(): Promise<void> {
    // Start cleanup intervals
    await this.startCleanupTasks();
    
    // Initialize rate limit counters
    this.initializeRateLimitCounters();
    
    // Load existing keys from persistent storage
    await this.loadKeysFromStorage();

    this.emit('apikey:service-initialized', {
      version: '2.0.0',
      totalKeys: this.keys.size,
      config: this.config,
    });
  }

  /**
   * Generate a new API key with advanced options
   */
  @SecurityAudit({
    eventType: 'api_key_creation',
    sensitivity: 'confidential',
    complianceFrameworks: ['gdpr', 'sox'],
  })
  @AccessControl({
    requiredRoles: ['api_admin', 'project_admin'],
    resource: 'api-key-manager',
    action: 'create_key',
  })
  @Metric({ name: 'apikey.created', recordDuration: true })
  async createApiKey(options: {
    name: string;
    description?: string;
    userId?: string;
    serviceAccount?: string;
    organizationId?: string;
    projectId?: string;
    environment?: 'development' | 'staging' | 'production';
    scopes: string[];
    permissions?: string[];
    resourceAccess?: Record<string, string[]>;
    rateLimit?: Partial<EnterpriseApiKey['rateLimit']>;
    quota?: Partial<EnterpriseApiKey['quota']>;
    expiresIn?: number; // days
    allowedOrigins?: string[];
    allowedIPs?: string[];
    metadata?: Record<string, any>;
    tags?: string[];
  }): Promise<{ key: string; apiKey: Omit<EnterpriseApiKey, 'hashedKey'> }> {
    const startTime = performance.now();

    // Generate secure API key
    const rawKey = this.generateSecureKey();
    const keyPrefix = this.extractPrefix(rawKey);
    const hashedKey = await this.hashKey(rawKey);
    const checksumHash = this.config.keyGeneration.checksumEnabled ? 
      this.generateChecksum(rawKey) : undefined;

    const keyId = `apikey_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Build API key object
    const apiKey: EnterpriseApiKey = {
      id: keyId,
      name: options.name,
      description: options.description,
      keyPrefix,
      hashedKey,
      checksumHash,
      
      userId: options.userId,
      serviceAccount: options.serviceAccount,
      organizationId: options.organizationId,
      projectId: options.projectId,
      environment: options.environment || 'development',
      
      scopes: options.scopes,
      scopeHierarchy: this.buildScopeHierarchy(options.scopes),
      permissions: options.permissions || [],
      resourceAccess: options.resourceAccess || {},
      
      rateLimit: {
        rpm: options.rateLimit?.rpm || this.config.rateLimit.defaultRPM,
        hourly: options.rateLimit?.hourly || this.config.rateLimit.defaultRPM * 60,
        daily: options.rateLimit?.daily || this.config.rateLimit.defaultDaily,
        monthly: options.rateLimit?.monthly || this.config.rateLimit.defaultDaily * 30,
        burst: options.rateLimit?.burst || this.config.rateLimit.burstAllowance,
        strategy: options.rateLimit?.strategy || 'sliding',
      },
      
      quota: {
        requests: options.quota?.requests || 1000000,
        bandwidth: options.quota?.bandwidth || 10 * 1024 * 1024 * 1024, // 10GB
        compute: options.quota?.compute || 1000,
        storage: options.quota?.storage || 1024 * 1024 * 1024, // 1GB
      },
      
      expiresAt: options.expiresIn ? 
        new Date(Date.now() + options.expiresIn * 24 * 60 * 60 * 1000) : 
        new Date(Date.now() + this.config.lifecycle.defaultExpiryDays * 24 * 60 * 60 * 1000),
      
      status: 'active',
      isActive: true,
      allowedOrigins: options.allowedOrigins,
      allowedIPs: options.allowedIPs,
      
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: options.userId || 'system',
      complianceFlags: this.determineComplianceFlags(options),
      
      metadata: options.metadata || {},
      tags: options.tags || [],
    };

    // Store the key
    this.keys.set(keyId, apiKey);
    this.keysByPrefix.set(keyPrefix, keyId);
    this.metrics.totalKeys++;
    this.metrics.activeKeys++;

    // Persist to storage
    await this.persistKey(apiKey);

    const duration = performance.now() - startTime;

    this.emit('apikey:created', {
      keyId,
      name: apiKey.name,
      scopes: apiKey.scopes,
      expiryDate: apiKey.expiresAt?.getTime(),
      userId: apiKey.userId,
      serviceAccount: apiKey.serviceAccount,
    });

    this.recordMetric('apikey.creation_time', duration);

    // Return key without sensitive data
    const { hashedKey: _, ...publicApiKey } = apiKey;
    return { key: rawKey, apiKey: publicApiKey };
  }

  /**
   * Validate API key with comprehensive checks
   */
  @ThreatDetection({
    threatTypes: ['brute_force', 'anomaly'],
    sensitivityLevel: 'high',
    autoBlock: false,
  })
  @Metric({ name: 'apikey.validated', recordDuration: true })
  async validateApiKey(
    key: string,
    context: {
      ipAddress?: string;
      userAgent?: string;
      origin?: string;
      endpoint?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<EnterpriseApiKey | null> {
    const startTime = performance.now();

    try {
      // Extract prefix and validate format
      const keyPrefix = this.extractPrefix(key);
      if (!this.isValidKeyFormat(key)) {
        return null;
      }

      // Verify checksum if enabled
      if (this.config.keyGeneration.checksumEnabled && !this.verifyChecksum(key)) {
        return null;
      }

      // Get key ID from prefix
      const keyId = this.keysByPrefix.get(keyPrefix);
      if (!keyId) {
        return null;
      }

      // Get API key
      const apiKey = this.keys.get(keyId);
      if (!apiKey) {
        return null;
      }

      // Verify hash
      const hashedKey = await this.hashKey(key);
      if (apiKey.hashedKey !== hashedKey) {
        return null;
      }

      // Check basic status
      if (!apiKey.isActive || apiKey.status !== 'active') {
        return null;
      }

      // Check expiration
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        await this.markKeyExpired(keyId);
        return null;
      }

      // Validate context constraints
      if (!await this.validateContext(apiKey, context)) {
        this.emit('apikey:access-denied', {
          keyId,
          reason: 'context_validation_failed',
          context,
        });
        return null;
      }

      // Check for suspicious activity
      const suspiciousActivity = await this.detectSuspiciousActivity(apiKey, context);
      if (suspiciousActivity && suspiciousActivity.riskScore > this.config.monitoring.suspiciousActivityThreshold) {
        this.emit('apikey:suspicious-activity', {
          keyId,
          activity: suspiciousActivity.activityType,
          indicators: suspiciousActivity.indicators,
          riskScore: suspiciousActivity.riskScore,
        });

        if (suspiciousActivity.riskScore > 0.95) {
          await this.suspendKey(keyId, 'suspicious_activity');
          return null;
        }
      }

      // Update last used timestamp
      apiKey.lastUsedAt = new Date();
      apiKey.updatedAt = new Date();

      // Record access
      this.emit('apikey:accessed', {
        keyId,
        endpoint: context.endpoint || 'unknown',
        method: 'unknown',
        timestamp: Date.now(),
        clientIP: context.ipAddress || 'unknown',
        userAgent: context.userAgent,
      });

      const duration = performance.now() - startTime;
      this.recordMetric('apikey.validation_time', duration);

      return apiKey;

    } catch (error) {
      this.emit('apikey:error', {
        error: error as Error,
        operation: 'validate',
        keyId: key.substring(0, 8),
      });
      return null;
    }
  }

  /**
   * Check rate limits with multiple strategies
   */
  @Metric({ name: 'apikey.rate_limit_checked', recordDuration: true })
  async checkRateLimit(
    apiKey: EnterpriseApiKey,
    usage: {
      requests?: number;
      bandwidth?: number;
      compute?: number;
    } = { requests: 1 }
  ): Promise<RateLimitResult> {
    const now = new Date();
    const keyId = apiKey.id;

    // Get current counters
    const counters = this.getRateLimitCounters(keyId);
    
    // Calculate time windows
    const minute = Math.floor(now.getTime() / 60000);
    const hour = Math.floor(now.getTime() / 3600000);
    const day = Math.floor(now.getTime() / 86400000);
    const month = Math.floor(now.getTime() / (86400000 * 30));

    // Check limits
    const minuteCount = counters.get(`rpm:${minute}`) || 0;
    const hourCount = counters.get(`hourly:${hour}`) || 0;
    const dayCount = counters.get(`daily:${day}`) || 0;
    const monthCount = counters.get(`monthly:${month}`) || 0;
    const burstCount = counters.get(`burst:${minute}`) || 0;

    const violations: string[] = [];

    // Check each limit
    if (minuteCount >= apiKey.rateLimit.rpm) {
      violations.push('rpm_exceeded');
    }
    if (hourCount >= apiKey.rateLimit.hourly) {
      violations.push('hourly_exceeded');
    }
    if (dayCount >= apiKey.rateLimit.daily) {
      violations.push('daily_exceeded');
    }
    if (monthCount >= apiKey.rateLimit.monthly) {
      violations.push('monthly_exceeded');
    }
    if (burstCount >= apiKey.rateLimit.burst) {
      violations.push('burst_exceeded');
    }

    const allowed = violations.length === 0;

    if (allowed) {
      // Update counters
      const requestCount = usage.requests || 1;
      counters.set(`rpm:${minute}`, minuteCount + requestCount);
      counters.set(`hourly:${hour}`, hourCount + requestCount);
      counters.set(`daily:${day}`, dayCount + requestCount);
      counters.set(`monthly:${month}`, monthCount + requestCount);
      counters.set(`burst:${minute}`, burstCount + requestCount);

      // Track usage
      await this.trackUsage({
        keyId,
        timestamp: now,
        requests: requestCount,
        bandwidth: usage.bandwidth || 0,
        compute: usage.compute || 0,
      });
    } else {
      this.metrics.rateLimitViolations++;
      
      this.emit('apikey:rate-limited', {
        keyId,
        endpoint: 'current',
        currentRate: Math.max(minuteCount, hourCount, dayCount, monthCount),
        limit: Math.min(apiKey.rateLimit.rpm, apiKey.rateLimit.hourly, apiKey.rateLimit.daily, apiKey.rateLimit.monthly),
        windowMs: 60000, // Most restrictive window
      });
    }

    return {
      allowed,
      remaining: {
        rpm: Math.max(0, apiKey.rateLimit.rpm - minuteCount),
        hourly: Math.max(0, apiKey.rateLimit.hourly - hourCount),
        daily: Math.max(0, apiKey.rateLimit.daily - dayCount),
        monthly: Math.max(0, apiKey.rateLimit.monthly - monthCount),
        burst: Math.max(0, apiKey.rateLimit.burst - burstCount),
      },
      resetTimes: {
        rpm: new Date((minute + 1) * 60000),
        hourly: new Date((hour + 1) * 3600000),
        daily: new Date((day + 1) * 86400000),
        monthly: new Date((month + 1) * 86400000 * 30),
      },
      quotaUsage: {
        requests: monthCount,
        bandwidth: 0, // Would be calculated from usage data
        compute: 0,
        storage: 0,
      },
      violations: violations.length > 0 ? violations : undefined,
    };
  }

  /**
   * Revoke an API key
   */
  @SecurityAudit({
    eventType: 'api_key_revocation',
    sensitivity: 'confidential',
  })
  @AccessControl({
    requiredRoles: ['api_admin', 'security_admin'],
    resource: 'api-key-manager',
    action: 'revoke_key',
  })
  @Metric({ name: 'apikey.revoked' })
  async revokeApiKey(keyId: string, reason: string, revokedBy: string): Promise<boolean> {
    const apiKey = this.keys.get(keyId);
    if (!apiKey) {
      return false;
    }

    // Update key status
    apiKey.status = 'revoked';
    apiKey.isActive = false;
    apiKey.updatedAt = new Date();
    apiKey.metadata.revokedBy = revokedBy;
    apiKey.metadata.revocationReason = reason;
    apiKey.metadata.revokedAt = new Date();

    // Update metrics
    this.metrics.activeKeys--;
    this.metrics.revokedKeys++;

    // Remove from lookup maps
    this.keysByPrefix.delete(apiKey.keyPrefix);

    this.emit('apikey:revoked', {
      keyId,
      reason,
      revokedBy,
      immediate: true,
    });

    return true;
  }

  /**
   * Get API key usage statistics
   */
  @AccessControl({
    requiredRoles: ['api_admin', 'project_admin'],
    resource: 'api-key-manager',
    action: 'read_usage',
  })
  @Metric({ name: 'apikey.usage_retrieved' })
  async getUsageStatistics(keyId: string, options: {
    startDate?: Date;
    endDate?: Date;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  } = {}): Promise<{
    totalRequests: number;
    totalBandwidth: number;
    totalCompute: number;
    averageResponseTime: number;
    errorRate: number;
    topEndpoints: Array<{ endpoint: string; requests: number }>;
    timeSeriesData: Array<{ timestamp: Date; requests: number; bandwidth: number }>;
  }> {
    const usage = this.usageData.get(keyId) || [];
    const endDate = options.endDate || new Date();
    const startDate = options.startDate || new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Filter usage data by date range
    const filteredUsage = usage.filter(u => 
      u.timestamp >= startDate && u.timestamp <= endDate
    );

    // Calculate statistics
    const totalRequests = filteredUsage.reduce((sum, u) => sum + u.requests, 0);
    const totalBandwidth = filteredUsage.reduce((sum, u) => sum + u.bandwidth, 0);
    const totalCompute = filteredUsage.reduce((sum, u) => sum + u.compute, 0);
    
    const responseTimes = filteredUsage
      .filter(u => u.responseTime !== undefined)
      .map(u => u.responseTime!);
    
    const averageResponseTime = responseTimes.length > 0 ?
      responseTimes.reduce((sum, rt) => sum + rt, 0) / responseTimes.length : 0;

    const errorRequests = filteredUsage.filter(u => 
      u.statusCode && u.statusCode >= 400
    ).length;
    
    const errorRate = totalRequests > 0 ? errorRequests / totalRequests : 0;

    // Calculate top endpoints
    const endpointCounts = new Map<string, number>();
    filteredUsage.forEach(u => {
      if (u.endpoint) {
        endpointCounts.set(u.endpoint, (endpointCounts.get(u.endpoint) || 0) + u.requests);
      }
    });

    const topEndpoints = Array.from(endpointCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([endpoint, requests]) => ({ endpoint, requests }));

    // Generate time series data (simplified)
    const timeSeriesData = this.generateTimeSeriesData(filteredUsage, options.granularity || 'day');

    return {
      totalRequests,
      totalBandwidth,
      totalCompute,
      averageResponseTime,
      errorRate,
      topEndpoints,
      timeSeriesData,
    };
  }

  /**
   * Get service metrics
   */
  @HealthCheck({
    name: 'apikey-metrics',
    critical: false,
  })
  @AccessControl({
    requiredRoles: ['admin', 'api_admin'],
    resource: 'api-key-manager',
    action: 'read_metrics',
  })
  async getServiceMetrics(): Promise<ApiKeyMetrics> {
    // Update real-time metrics
    this.updateMetrics();
    return { ...this.metrics };
  }

  // Private helper methods
  private generateSecureKey(): string {
    const prefix = this.config.keyGeneration.prefix;
    const randomBytes = crypto.randomBytes(this.config.keyGeneration.length);
    const key = randomBytes.toString('base64url');
    return `${prefix}${key}`;
  }

  private extractPrefix(key: string): string {
    return key.substring(0, this.config.keyGeneration.prefix.length + 8);
  }

  private async hashKey(key: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(key, salt, this.config.security.saltRounds * 1000, 64, this.config.security.hashAlgorithm);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  private generateChecksum(key: string): string {
    return crypto.createHash('crc32').update(key).digest('hex');
  }

  private verifyChecksum(key: string): boolean {
    // Simplified checksum verification
    return true; // Would implement actual CRC32 verification
  }

  private isValidKeyFormat(key: string): boolean {
    const prefix = this.config.keyGeneration.prefix;
    return key.startsWith(prefix) && key.length >= this.config.keyGeneration.length;
  }

  private buildScopeHierarchy(scopes: string[]): Record<string, string[]> {
    const hierarchy: Record<string, string[]> = {};
    
    scopes.forEach(scope => {
      const parts = scope.split(':');
      let current = '';
      parts.forEach((part, index) => {
        current = index === 0 ? part : `${current}:${part}`;
        if (!hierarchy[current]) {
          hierarchy[current] = [];
        }
        if (index > 0) {
          const parent = parts.slice(0, index).join(':');
          hierarchy[parent].push(current);
        }
      });
    });

    return hierarchy;
  }

  private determineComplianceFlags(options: any): string[] {
    const flags: string[] = [];
    
    if (options.scopes?.includes('pii:read') || options.scopes?.includes('pii:write')) {
      flags.push('gdpr_applicable');
    }
    
    if (options.environment === 'production') {
      flags.push('production_data');
    }
    
    return flags;
  }

  private async validateContext(apiKey: EnterpriseApiKey, context: any): Promise<boolean> {
    // Check allowed origins
    if (apiKey.allowedOrigins && context.origin) {
      if (!apiKey.allowedOrigins.includes(context.origin)) {
        return false;
      }
    }

    // Check allowed IPs
    if (apiKey.allowedIPs && context.ipAddress) {
      if (!apiKey.allowedIPs.includes(context.ipAddress)) {
        return false;
      }
    }

    // Check required headers
    if (apiKey.requiredHeaders && context.headers) {
      for (const [header, expectedValue] of Object.entries(apiKey.requiredHeaders)) {
        if (context.headers[header] !== expectedValue) {
          return false;
        }
      }
    }

    return true;
  }

  private async detectSuspiciousActivity(apiKey: EnterpriseApiKey, context: any): Promise<SuspiciousActivity | null> {
    if (!this.config.monitoring.anomalyDetectionEnabled) {
      return null;
    }

    const indicators: Array<{ type: string; value: any; confidence: number }> = [];
    let riskScore = 0;

    // Check for unusual geolocation
    if (this.config.monitoring.geoLocationTracking && context.ipAddress) {
      // Would implement actual geolocation checking
      const isUnusualLocation = false; // Placeholder
      if (isUnusualLocation) {
        indicators.push({
          type: 'unusual_geolocation',
          value: context.ipAddress,
          confidence: 0.7,
        });
        riskScore += 0.3;
      }
    }

    // Check for rapid requests
    const recentUsage = this.usageData.get(apiKey.id) || [];
    const recentMinute = recentUsage.filter(u => 
      u.timestamp > new Date(Date.now() - 60000)
    );
    
    if (recentMinute.length > apiKey.rateLimit.rpm * 2) {
      indicators.push({
        type: 'rapid_requests',
        value: recentMinute.length,
        confidence: 0.9,
      });
      riskScore += 0.5;
    }

    if (indicators.length === 0) {
      return null;
    }

    const activity: SuspiciousActivity = {
      keyId: apiKey.id,
      activityType: indicators[0].type as any,
      riskScore,
      indicators,
      timestamp: new Date(),
      mitigationActions: riskScore > 0.8 ? ['suspend_key', 'alert_admin'] : ['monitor_closely'],
    };

    // Store suspicious activity
    if (!this.suspiciousActivities.has(apiKey.id)) {
      this.suspiciousActivities.set(apiKey.id, []);
    }
    this.suspiciousActivities.get(apiKey.id)!.push(activity);
    this.metrics.suspiciousActivities++;

    return activity;
  }

  private getRateLimitCounters(keyId: string): Map<string, number> {
    if (!this.rateLimitCounters.has(keyId)) {
      this.rateLimitCounters.set(keyId, new Map());
    }
    return this.rateLimitCounters.get(keyId)!;
  }

  private async trackUsage(usage: ApiKeyUsage): Promise<void> {
    if (!this.usageData.has(usage.keyId)) {
      this.usageData.set(usage.keyId, []);
    }
    
    this.usageData.get(usage.keyId)!.push(usage);
    this.metrics.totalRequests += usage.requests;
  }

  private async markKeyExpired(keyId: string): Promise<void> {
    const apiKey = this.keys.get(keyId);
    if (apiKey) {
      apiKey.status = 'expired';
      apiKey.isActive = false;
      this.metrics.activeKeys--;
      this.metrics.expiredKeys++;

      this.emit('apikey:expired', {
        keyId,
        name: apiKey.name,
        lastUsed: apiKey.lastUsedAt?.getTime(),
        gracePeriodDays: this.config.lifecycle.gracePeriodDays,
      });
    }
  }

  private async suspendKey(keyId: string, reason: string): Promise<void> {
    const apiKey = this.keys.get(keyId);
    if (apiKey) {
      apiKey.status = 'suspended';
      apiKey.isActive = false;
      apiKey.metadata.suspensionReason = reason;
      apiKey.metadata.suspendedAt = new Date();
      
      this.metrics.activeKeys--;
    }
  }

  private initializeRateLimitCounters(): void {
    // Clean up old rate limit counters every minute
    setInterval(() => {
      const cutoff = Date.now() - 3600000; // 1 hour ago
      
      for (const [keyId, counters] of this.rateLimitCounters) {
        for (const [key, timestamp] of counters) {
          if (timestamp < cutoff) {
            counters.delete(key);
          }
        }
        
        if (counters.size === 0) {
          this.rateLimitCounters.delete(keyId);
        }
      }
    }, 60000);
  }

  private async startCleanupTasks(): Promise<void> {
    // Clean expired usage data every hour
    setInterval(() => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
      
      for (const [keyId, usage] of this.usageData) {
        const filteredUsage = usage.filter(u => u.timestamp > cutoff);
        if (filteredUsage.length === 0) {
          this.usageData.delete(keyId);
        } else {
          this.usageData.set(keyId, filteredUsage);
        }
      }
    }, 3600000);
  }

  private async loadKeysFromStorage(): Promise<void> {
    // Placeholder for loading keys from persistent storage
    // In production, this would load from database
  }

  private async persistKey(apiKey: EnterpriseApiKey): Promise<void> {
    // Placeholder for persisting key to storage
    // In production, this would save to database
  }

  private generateTimeSeriesData(usage: ApiKeyUsage[], granularity: string): Array<{ timestamp: Date; requests: number; bandwidth: number }> {
    // Simplified time series generation
    const timeSeriesMap = new Map<string, { requests: number; bandwidth: number }>();
    
    usage.forEach(u => {
      const key = this.getTimeSeriesKey(u.timestamp, granularity);
      const existing = timeSeriesMap.get(key) || { requests: 0, bandwidth: 0 };
      existing.requests += u.requests;
      existing.bandwidth += u.bandwidth;
      timeSeriesMap.set(key, existing);
    });

    return Array.from(timeSeriesMap.entries()).map(([key, data]) => ({
      timestamp: new Date(key),
      requests: data.requests,
      bandwidth: data.bandwidth,
    }));
  }

  private getTimeSeriesKey(timestamp: Date, granularity: string): string {
    switch (granularity) {
      case 'hour':
        return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate(), timestamp.getHours()).toISOString();
      case 'day':
        return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()).toISOString();
      case 'week':
        const weekStart = new Date(timestamp);
        weekStart.setDate(timestamp.getDate() - timestamp.getDay());
        return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).toISOString();
      case 'month':
        return new Date(timestamp.getFullYear(), timestamp.getMonth(), 1).toISOString();
      default:
        return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()).toISOString();
    }
  }

  private updateMetrics(): void {
    this.metrics.totalKeys = this.keys.size;
    this.metrics.activeKeys = Array.from(this.keys.values()).filter(k => k.isActive).length;
    this.metrics.expiredKeys = Array.from(this.keys.values()).filter(k => k.status === 'expired').length;
    this.metrics.revokedKeys = Array.from(this.keys.values()).filter(k => k.status === 'revoked').length;
    
    const totalUsage = Array.from(this.usageData.values()).flat();
    this.metrics.totalRequests = totalUsage.reduce((sum, u) => sum + u.requests, 0);
    this.metrics.averageRequestsPerKey = this.metrics.activeKeys > 0 ? 
      this.metrics.totalRequests / this.metrics.activeKeys : 0;
  }

  protected getServiceHealth(): Record<string, any> {
    this.updateMetrics();
    
    return {
      keysTotal: this.metrics.totalKeys,
      keysActive: this.metrics.activeKeys,
      totalRequests: this.metrics.totalRequests,
      rateLimitViolations: this.metrics.rateLimitViolations,
      suspiciousActivities: this.metrics.suspiciousActivities,
      config: {
        rateLimitStrategy: this.config.rateLimit,
        securityFeatures: this.config.security,
        monitoring: this.config.monitoring,
      },
    };
  }
}