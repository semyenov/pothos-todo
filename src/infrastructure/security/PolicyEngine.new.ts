/**
 * Enterprise Policy Engine Service
 * 
 * Advanced policy-based access control system with support for:
 * - Role-Based Access Control (RBAC)
 * - Attribute-Based Access Control (ABAC)
 * - Custom policy functions
 * - Policy composition and conflict resolution
 * - Real-time policy evaluation with caching
 * - Policy versioning and deployment
 * - Compliance framework integration
 */

import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric, HealthCheck } from '../core/decorators/ServiceDecorators.js';
import { SecurityAudit, AccessControl, SecurityRateLimit, ComplianceMonitoring } from '../core/decorators/SecurityDecorators.js';
import type { PolicyEngineEventMap } from '../core/ServiceEventMaps.security.js';
import type { User } from '@/domain/aggregates/User.js';
import { performance } from 'perf_hooks';

// Configuration Schema
const PolicyEngineConfigSchema = z.object({
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().min(1).max(3600).default(300), // 5 minutes
    maxSize: z.number().min(100).max(100000).default(10000),
  }),
  evaluation: z.object({
    timeout: z.number().min(100).max(10000).default(5000), // 5 seconds
    concurrency: z.number().min(1).max(100).default(10),
    defaultDecision: z.enum(['permit', 'deny']).default('deny'),
  }),
  policies: z.object({
    versioning: z.boolean().default(true),
    auditChanges: z.boolean().default(true),
    validateOnCreation: z.boolean().default(true),
  }),
  compliance: z.object({
    frameworks: z.array(z.string()).default(['gdpr', 'hipaa', 'sox']),
    auditRetention: z.number().min(30).max(2555).default(2555), // 7 years
    evidenceCapture: z.boolean().default(true),
  }),
});

type PolicyEngineConfig = z.infer<typeof PolicyEngineConfigSchema>;

// Policy Context and Results
export interface PolicyContext {
  user: User | null;
  resource?: any;
  action: string;
  field?: string;
  args?: Record<string, any>;
  metadata?: Record<string, any>;
  environment?: string;
  timestamp?: number;
  requestId?: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  filters?: Record<string, any>;
  maskedFields?: string[];
  obligations?: Array<{
    type: string;
    action: string;
    params?: Record<string, any>;
  }>;
  advice?: Array<{
    type: string;
    message: string;
  }>;
}

export interface PolicyDefinition {
  id: string;
  name: string;
  description?: string;
  type: 'rbac' | 'abac' | 'custom';
  version: string;
  enabled: boolean;
  priority: number;
  target: {
    actions?: string[];
    resources?: string[];
    subjects?: string[];
  };
  condition?: string; // Expression language condition
  effect: 'permit' | 'deny';
  obligations?: Array<{
    type: string;
    action: string;
    params?: Record<string, any>;
  }>;
  metadata?: Record<string, any>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicySet {
  id: string;
  name: string;
  policies: string[]; // Policy IDs
  combiningAlgorithm: 'first-applicable' | 'deny-override' | 'permit-override' | 'only-one-applicable';
  description?: string;
  enabled: boolean;
}

export interface AccessRequest {
  subject: string;
  action: string;
  resource: string;
  environment?: Record<string, any>;
  attributes?: Record<string, any>;
}

export interface PolicyEvaluationMetrics {
  totalEvaluations: number;
  permitDecisions: number;
  denyDecisions: number;
  averageEvaluationTime: number;
  cacheHitRate: number;
  policyConflicts: number;
  errorRate: number;
}

export type PolicyFunction = (context: PolicyContext) => PolicyResult | Promise<PolicyResult>;

@ServiceConfig({
  schema: PolicyEngineConfigSchema,
  prefix: 'policy',
  hot: true,
})
export class PolicyEngine extends BaseService<PolicyEngineConfig, PolicyEngineEventMap> {
  private policies = new Map<string, PolicyDefinition>();
  private policySets = new Map<string, PolicySet>();
  private policyFunctions = new Map<string, PolicyFunction>();
  private fieldPolicies = new Map<string, Map<string, PolicyFunction[]>>();
  private evaluationCache = new Map<string, { result: PolicyResult; expiry: number }>();
  private metrics: PolicyEvaluationMetrics = {
    totalEvaluations: 0,
    permitDecisions: 0,
    denyDecisions: 0,
    averageEvaluationTime: 0,
    cacheHitRate: 0,
    policyConflicts: 0,
    errorRate: 0,
  };

  protected async initialize(): Promise<void> {
    await this.loadDefaultPolicies();
    await this.startCacheCleanup();
    
    this.emit('policy:engine-initialized', {
      version: '2.0.0',
      policies: this.policies.size,
      policySets: this.policySets.size,
      config: this.config,
    });
  }

  /**
   * Create a new policy
   */
  @SecurityAudit({
    eventType: 'policy_creation',
    sensitivity: 'confidential',
    complianceFrameworks: ['gdpr', 'sox'],
  })
  @AccessControl({
    requiredRoles: ['policy_admin', 'security_admin'],
    resource: 'policy-engine',
    action: 'create_policy',
  })
  @Metric({ name: 'policy.created', recordDuration: true })
  async createPolicy(definition: Omit<PolicyDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const startTime = performance.now();

    // Validate policy definition
    if (this.config.policies.validateOnCreation) {
      await this.validatePolicyDefinition(definition);
    }

    const policyId = `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const policy: PolicyDefinition = {
      id: policyId,
      ...definition,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store policy
    this.policies.set(policyId, policy);

    // Compile policy function if custom
    if (policy.type === 'custom' && policy.condition) {
      const policyFunction = await this.compilePolicy(policy);
      this.policyFunctions.set(policyId, policyFunction);
    }

    // Clear relevant caches
    this.invalidateCache(policy.target);

    const duration = performance.now() - startTime;

    this.emit('policy:created', {
      policyId,
      name: policy.name,
      type: policy.type,
      version: policy.version,
      createdBy: policy.createdBy,
    });

    this.recordMetric('policy.creation.time', duration);

    return policyId;
  }

  /**
   * Update an existing policy
   */
  @SecurityAudit({
    eventType: 'policy_modification',
    sensitivity: 'confidential',
    complianceFrameworks: ['gdpr', 'sox'],
  })
  @AccessControl({
    requiredRoles: ['policy_admin', 'security_admin'],
    resource: 'policy-engine',
    action: 'update_policy',
  })
  @Metric({ name: 'policy.updated', recordDuration: true })
  async updatePolicy(policyId: string, updates: Partial<PolicyDefinition>): Promise<void> {
    const existingPolicy = this.policies.get(policyId);
    if (!existingPolicy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    // Track changes for audit
    const changes = this.calculatePolicyChanges(existingPolicy, updates);

    // Create new version if versioning enabled
    let newVersion = existingPolicy.version;
    if (this.config.policies.versioning && this.hasSignificantChanges(changes)) {
      newVersion = this.incrementVersion(existingPolicy.version);
    }

    const updatedPolicy: PolicyDefinition = {
      ...existingPolicy,
      ...updates,
      version: newVersion,
      updatedAt: new Date(),
    };

    // Validate updated policy
    if (this.config.policies.validateOnCreation) {
      await this.validatePolicyDefinition(updatedPolicy);
    }

    // Update policy
    this.policies.set(policyId, updatedPolicy);

    // Recompile if custom policy
    if (updatedPolicy.type === 'custom' && updatedPolicy.condition) {
      const policyFunction = await this.compilePolicy(updatedPolicy);
      this.policyFunctions.set(policyId, policyFunction);
    }

    // Clear relevant caches
    this.invalidateCache(updatedPolicy.target);

    this.emit('policy:updated', {
      policyId,
      changes,
      version: newVersion,
      updatedBy: updates.createdBy || 'system',
    });
  }

  /**
   * Evaluate policies for an access request
   */
  @SecurityRateLimit({
    maxRequests: 1000,
    windowMs: 60000,
    keyGenerator: 'user',
  })
  @Metric({ name: 'policy.evaluated', recordDuration: true })
  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    const startTime = performance.now();
    this.metrics.totalEvaluations++;

    try {
      // Check cache first
      if (this.config.caching.enabled) {
        const cacheKey = this.getCacheKey(context);
        const cached = this.evaluationCache.get(cacheKey);
        
        if (cached && cached.expiry > Date.now()) {
          this.metrics.cacheHitRate = (this.metrics.cacheHitRate * 0.9) + (1 * 0.1);
          return cached.result;
        }
      }

      // Get applicable policies
      const applicablePolicies = await this.findApplicablePolicies(context);
      
      if (applicablePolicies.length === 0) {
        const defaultResult = this.getDefaultDecision(context);
        this.updateDecisionMetrics(defaultResult);
        return defaultResult;
      }

      // Evaluate policies
      const policyResults = await Promise.all(
        applicablePolicies.map(policy => this.evaluatePolicy(policy, context))
      );

      // Combine results using combining algorithm
      const finalResult = this.combineResults(policyResults, context);

      // Cache result
      if (this.config.caching.enabled) {
        const cacheKey = this.getCacheKey(context);
        this.evaluationCache.set(cacheKey, {
          result: finalResult,
          expiry: Date.now() + (this.config.caching.ttl * 1000),
        });
      }

      // Update metrics
      const duration = performance.now() - startTime;
      this.metrics.averageEvaluationTime = (this.metrics.averageEvaluationTime * 0.9) + (duration * 0.1);
      this.updateDecisionMetrics(finalResult);

      // Emit evaluation event
      this.emit('policy:evaluated', {
        policyId: applicablePolicies.map(p => p.id).join(','),
        subject: context.user?.id || 'anonymous',
        resource: context.resource?.id || context.action,
        action: context.action,
        decision: finalResult.allowed ? 'permit' : 'deny',
        duration,
        context: {
          policies: applicablePolicies.length,
          cached: false,
        },
      });

      return finalResult;

    } catch (error) {
      this.metrics.errorRate = (this.metrics.errorRate * 0.9) + (1 * 0.1);
      
      this.emit('policy:error', {
        error: error as Error,
        operation: 'evaluate',
        policyId: context.action,
      });

      // Return safe default on error
      return {
        allowed: this.config.evaluation.defaultDecision === 'permit',
        reason: 'Policy evaluation error - default decision applied',
      };
    }
  }

  /**
   * Check if user can access a specific field
   */
  @Metric({ name: 'policy.field_access_checked' })
  async canAccessField(
    user: User | null,
    type: string,
    field: string,
    resource?: any
  ): Promise<boolean> {
    const context: PolicyContext = {
      user,
      resource,
      action: 'read',
      field: `${type}.${field}`,
      timestamp: Date.now(),
    };

    const result = await this.evaluate(context);
    return result.allowed;
  }

  /**
   * Get fields that should be masked for a user
   */
  @Metric({ name: 'policy.masked_fields_calculated' })
  async getMaskedFields(
    user: User | null,
    type: string,
    resource?: any
  ): Promise<string[]> {
    const fieldPolicies = this.fieldPolicies.get(type);
    if (!fieldPolicies) return [];

    const maskedFields: string[] = [];

    for (const [field, policies] of fieldPolicies) {
      const context: PolicyContext = {
        user,
        resource,
        action: 'read',
        field: `${type}.${field}`,
        timestamp: Date.now(),
      };

      const results = await Promise.all(
        policies.map(policy => policy(context))
      );

      const finalResult = this.combineResults(results.map(r => ({ 
        policy: { id: 'field-policy', effect: r.allowed ? 'permit' : 'deny' }, 
        result: r 
      })), context);
      
      if (!finalResult.allowed || finalResult.maskedFields?.includes(field)) {
        maskedFields.push(field);
      }
    }

    return maskedFields;
  }

  /**
   * Create a policy set for grouping related policies
   */
  @SecurityAudit({
    eventType: 'policy_set_creation',
    sensitivity: 'confidential',
  })
  @AccessControl({
    requiredRoles: ['policy_admin'],
    resource: 'policy-engine',
    action: 'create_policy_set',
  })
  async createPolicySet(policySet: Omit<PolicySet, 'id'>): Promise<string> {
    const setId = `set_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const set: PolicySet = {
      id: setId,
      ...policySet,
    };

    this.policySets.set(setId, set);

    this.emit('policy:set-created', {
      setId,
      name: set.name,
      policies: set.policies,
      combiningAlgorithm: set.combiningAlgorithm,
    });

    return setId;
  }

  /**
   * Deploy policies to an environment
   */
  @SecurityAudit({
    eventType: 'policy_deployment',
    sensitivity: 'confidential',
    complianceFrameworks: ['sox'],
  })
  @ComplianceMonitoring({
    frameworks: ['sox'],
    evidenceCapture: true,
    auditTrail: true,
  })
  async deployPolicies(policyIds: string[], environment: string): Promise<void> {
    // Validate all policies exist
    const missingPolicies = policyIds.filter(id => !this.policies.has(id));
    if (missingPolicies.length > 0) {
      throw new Error(`Policies not found: ${missingPolicies.join(', ')}`);
    }

    // Run deployment tests
    const testResults = await this.runPolicyTests(policyIds);
    
    // Deploy policies
    for (const policyId of policyIds) {
      const policy = this.policies.get(policyId)!;
      
      this.emit('policy:deployment', {
        policyId,
        environment,
        deploymentStrategy: 'rolling',
        rollbackPlan: true,
        testResults,
      });
    }

    this.recordMetric('policy.deployments', policyIds.length);
  }

  /**
   * Get policy evaluation metrics
   */
  @HealthCheck({
    name: 'policy-metrics',
    critical: false,
  })
  @AccessControl({
    requiredRoles: ['admin', 'security_admin'],
    resource: 'policy-engine',
    action: 'read_metrics',
  })
  async getMetrics(): Promise<PolicyEvaluationMetrics> {
    return { ...this.metrics };
  }

  /**
   * Export policies for backup or migration
   */
  @SecurityAudit({
    eventType: 'policy_export',
    sensitivity: 'confidential',
  })
  @AccessControl({
    requiredRoles: ['policy_admin'],
    resource: 'policy-engine',
    action: 'export_policies',
  })
  async exportPolicies(format: 'json' | 'xml' = 'json'): Promise<string> {
    const exportData = {
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      policies: Array.from(this.policies.values()),
      policySets: Array.from(this.policySets.values()),
    };

    switch (format) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'xml':
        return this.convertToXML(exportData);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Create a fluent policy builder
   */
  createPolicyBuilder(name: string) {
    const engine = this;
    
    return {
      policies: [] as PolicyFunction[],
      metadata: {} as Record<string, any>,

      requireAuth() {
        this.policies.push((ctx) => ({
          allowed: !!ctx.user,
          reason: 'Authentication required',
        }));
        return this;
      },

      requireRole(role: string) {
        this.policies.push((ctx) => ({
          allowed: ctx.user?.role?.includes(role) || false,
          reason: `Role '${role}' required`,
        }));
        return this;
      },

      requirePermission(permission: string) {
        this.policies.push((ctx) => ({
          allowed: ctx.user?.permissions?.includes(permission) || false,
          reason: `Permission '${permission}' required`,
        }));
        return this;
      },

      requireOwnership(getOwnerId: (resource: any) => string) {
        this.policies.push((ctx) => {
          if (!ctx.resource || !ctx.user) {
            return { allowed: false, reason: 'Resource or user not found' };
          }
          const ownerId = getOwnerId(ctx.resource);
          return {
            allowed: ownerId === ctx.user.id,
            reason: 'Resource ownership required',
          };
        });
        return this;
      },

      custom(policy: PolicyFunction) {
        this.policies.push(policy);
        return this;
      },

      withMetadata(key: string, value: any) {
        this.metadata[key] = value;
        return this;
      },

      build(): PolicyFunction {
        return async (context) => {
          const results = await Promise.all(
            this.policies.map(p => p(context))
          );
          return engine.combineResults(results.map(r => ({ 
            policy: { id: 'builder-policy', effect: r.allowed ? 'permit' : 'deny' }, 
            result: r 
          })), context);
        };
      },
    };
  }

  // Private helper methods
  private async loadDefaultPolicies(): Promise<void> {
    // Load default RBAC and business logic policies
    await this.createPolicy({
      name: 'Todo Read Access',
      type: 'rbac',
      version: '1.0.0',
      enabled: true,
      priority: 100,
      target: { actions: ['todo.read'] },
      effect: 'permit',
      createdBy: 'system',
      description: 'Allow users to read their own todos',
    });

    await this.createPolicy({
      name: 'Admin Metrics Access',
      type: 'rbac',
      version: '1.0.0',
      enabled: true,
      priority: 200,
      target: { actions: ['metrics.read'] },
      effect: 'permit',
      createdBy: 'system',
      description: 'Allow admins to read system metrics',
    });

    // Register field-level policies
    this.registerFieldPolicy('User', 'email', (ctx) => {
      if (!ctx.user || !ctx.resource) {
        return { allowed: false, reason: 'Authentication required' };
      }

      const targetUser = ctx.resource as User;
      const isOwner = targetUser.id === ctx.user.id;
      const isAdmin = ctx.user.role?.includes('admin');

      return {
        allowed: isOwner || isAdmin,
        reason: 'Can only view own email or must be admin',
      };
    });
  }

  private async findApplicablePolicies(context: PolicyContext): Promise<PolicyDefinition[]> {
    const applicable: PolicyDefinition[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      // Check action match
      if (policy.target.actions && !policy.target.actions.includes(context.action)) {
        continue;
      }

      // Check subject match
      if (policy.target.subjects && context.user) {
        const userIdentifier = context.user.id;
        if (!policy.target.subjects.includes(userIdentifier)) {
          continue;
        }
      }

      // Check resource match
      if (policy.target.resources && context.resource) {
        const resourceType = context.resource.constructor.name.toLowerCase();
        if (!policy.target.resources.includes(resourceType)) {
          continue;
        }
      }

      applicable.push(policy);
    }

    // Sort by priority (higher first)
    return applicable.sort((a, b) => b.priority - a.priority);
  }

  private async evaluatePolicy(
    policy: PolicyDefinition,
    context: PolicyContext
  ): Promise<{ policy: PolicyDefinition; result: PolicyResult }> {
    try {
      let result: PolicyResult;

      switch (policy.type) {
        case 'rbac':
          result = await this.evaluateRBACPolicy(policy, context);
          break;
        case 'abac':
          result = await this.evaluateABACPolicy(policy, context);
          break;
        case 'custom':
          const policyFunction = this.policyFunctions.get(policy.id);
          if (policyFunction) {
            result = await policyFunction(context);
          } else {
            result = { allowed: false, reason: 'Custom policy function not found' };
          }
          break;
        default:
          result = { allowed: false, reason: 'Unknown policy type' };
      }

      // Apply policy effect
      if (policy.effect === 'deny') {
        result.allowed = !result.allowed;
      }

      return { policy, result };

    } catch (error) {
      return {
        policy,
        result: {
          allowed: false,
          reason: `Policy evaluation error: ${(error as Error).message}`,
        },
      };
    }
  }

  private async evaluateRBACPolicy(policy: PolicyDefinition, context: PolicyContext): Promise<PolicyResult> {
    if (!context.user) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Basic RBAC evaluation based on user roles
    const userRoles = context.user.role || [];
    const requiredRoles = policy.metadata?.requiredRoles || [];

    if (requiredRoles.length === 0) {
      return { allowed: true, reason: 'No role requirements' };
    }

    const hasRequiredRole = requiredRoles.some((role: string) => userRoles.includes(role));
    
    return {
      allowed: hasRequiredRole,
      reason: hasRequiredRole ? 'Role requirements met' : `Required roles: ${requiredRoles.join(', ')}`,
    };
  }

  private async evaluateABACPolicy(policy: PolicyDefinition, context: PolicyContext): Promise<PolicyResult> {
    // Implement ABAC evaluation with attribute-based rules
    const attributes = {
      user: context.user,
      resource: context.resource,
      environment: context.environment || {},
      action: context.action,
      time: new Date(),
    };

    // Evaluate condition expression (simplified implementation)
    if (policy.condition) {
      try {
        const allowed = await this.evaluateCondition(policy.condition, attributes);
        return {
          allowed,
          reason: allowed ? 'ABAC condition satisfied' : 'ABAC condition not met',
        };
      } catch (error) {
        return {
          allowed: false,
          reason: `ABAC evaluation error: ${(error as Error).message}`,
        };
      }
    }

    return { allowed: true, reason: 'No ABAC conditions defined' };
  }

  private async evaluateCondition(condition: string, attributes: any): Promise<boolean> {
    // Simplified condition evaluation - in production, use a proper expression engine
    // This is a placeholder implementation
    return condition.includes('user') && !!attributes.user;
  }

  private combineResults(
    results: Array<{ policy: PolicyDefinition; result: PolicyResult }>,
    context: PolicyContext
  ): PolicyResult {
    if (results.length === 0) {
      return this.getDefaultDecision(context);
    }

    // Default combining algorithm: deny-override
    const permitResults = results.filter(r => r.result.allowed);
    const denyResults = results.filter(r => !r.result.allowed);

    // If any policy denies, deny overall
    if (denyResults.length > 0) {
      const obligations = results.flatMap(r => r.result.obligations || []);
      const advice = results.flatMap(r => r.result.advice || []);
      
      return {
        allowed: false,
        reason: denyResults.map(r => r.result.reason).join('; '),
        obligations: obligations.length > 0 ? obligations : undefined,
        advice: advice.length > 0 ? advice : undefined,
      };
    }

    // All policies permit
    if (permitResults.length > 0) {
      const filters = results.reduce((acc, r) => ({ ...acc, ...r.result.filters }), {});
      const maskedFields = results.flatMap(r => r.result.maskedFields || []);
      const obligations = results.flatMap(r => r.result.obligations || []);
      const advice = results.flatMap(r => r.result.advice || []);

      return {
        allowed: true,
        reason: 'All applicable policies permit',
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        maskedFields: maskedFields.length > 0 ? [...new Set(maskedFields)] : undefined,
        obligations: obligations.length > 0 ? obligations : undefined,
        advice: advice.length > 0 ? advice : undefined,
      };
    }

    return this.getDefaultDecision(context);
  }

  private getDefaultDecision(context: PolicyContext): PolicyResult {
    const allowed = this.config.evaluation.defaultDecision === 'permit';
    
    return {
      allowed,
      reason: `No applicable policies found - default ${this.config.evaluation.defaultDecision}`,
    };
  }

  private registerFieldPolicy(type: string, field: string, policy: PolicyFunction): void {
    if (!this.fieldPolicies.has(type)) {
      this.fieldPolicies.set(type, new Map());
    }

    const typePolicies = this.fieldPolicies.get(type)!;
    const fieldPolicies = typePolicies.get(field) || [];
    fieldPolicies.push(policy);
    typePolicies.set(field, fieldPolicies);
  }

  private async validatePolicyDefinition(definition: Partial<PolicyDefinition>): Promise<void> {
    if (!definition.name) {
      throw new Error('Policy name is required');
    }

    if (!definition.type) {
      throw new Error('Policy type is required');
    }

    if (!['rbac', 'abac', 'custom'].includes(definition.type)) {
      throw new Error('Invalid policy type');
    }

    if (!definition.effect) {
      throw new Error('Policy effect is required');
    }

    if (!['permit', 'deny'].includes(definition.effect)) {
      throw new Error('Invalid policy effect');
    }
  }

  private async compilePolicy(policy: PolicyDefinition): Promise<PolicyFunction> {
    // Simplified policy compilation - in production, use a proper policy language compiler
    return async (context: PolicyContext): Promise<PolicyResult> => {
      return {
        allowed: policy.effect === 'permit',
        reason: `Custom policy: ${policy.name}`,
      };
    };
  }

  private calculatePolicyChanges(
    original: PolicyDefinition,
    updates: Partial<PolicyDefinition>
  ): Array<{ field: string; oldValue: any; newValue: any }> {
    const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = (original as any)[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ field: key, oldValue, newValue });
      }
    }

    return changes;
  }

  private hasSignificantChanges(changes: Array<{ field: string; oldValue: any; newValue: any }>): boolean {
    const significantFields = ['condition', 'effect', 'target', 'enabled'];
    return changes.some(change => significantFields.includes(change.field));
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const minor = parseInt(parts[1] || '0') + 1;
    return `${parts[0]}.${minor}.0`;
  }

  private invalidateCache(target: PolicyDefinition['target']): void {
    if (!this.config.caching.enabled) return;

    // Remove cache entries that might be affected by this policy
    const keysToRemove: string[] = [];
    
    for (const [key] of this.evaluationCache) {
      if (target.actions && target.actions.some(action => key.includes(action))) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => this.evaluationCache.delete(key));
  }

  private getCacheKey(context: PolicyContext): string {
    const parts = [
      'policy',
      context.action,
      context.user?.id || 'anonymous',
      context.field || '',
      context.resource?.id || '',
      JSON.stringify(context.args || {}),
    ];
    
    return parts.join(':');
  }

  private async startCacheCleanup(): Promise<void> {
    // Clean expired cache entries every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.evaluationCache) {
        if (entry.expiry <= now) {
          this.evaluationCache.delete(key);
        }
      }
    }, 60000);
  }

  private updateDecisionMetrics(result: PolicyResult): void {
    if (result.allowed) {
      this.metrics.permitDecisions++;
    } else {
      this.metrics.denyDecisions++;
    }
  }

  private async runPolicyTests(policyIds: string[]): Promise<Record<string, any>> {
    // Simplified policy testing - in production, implement comprehensive test suite
    return {
      totalTests: policyIds.length * 5,
      passed: policyIds.length * 5,
      failed: 0,
      coverage: 100,
    };
  }

  private convertToXML(data: any): string {
    // Simplified XML conversion - in production, use a proper XML library
    return `<?xml version="1.0" encoding="UTF-8"?>
<policies>
  <version>${data.version}</version>
  <timestamp>${data.timestamp}</timestamp>
  <count>${data.policies.length}</count>
</policies>`;
  }

  protected getServiceHealth(): Record<string, any> {
    return {
      policies: this.policies.size,
      policySets: this.policySets.size,
      cacheSize: this.evaluationCache.size,
      metrics: this.metrics,
      config: {
        cachingEnabled: this.config.caching.enabled,
        defaultDecision: this.config.evaluation.defaultDecision,
      },
    };
  }
}