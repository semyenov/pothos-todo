import { logger } from '@/logger.js';
import type { User } from '@/domain/aggregates/User.js';
import type { Todo } from '@prisma/client';
import { CacheManager } from '../cache/CacheManager.js';
import { SingletonService } from '../core/SingletonService.js';

export interface PolicyContext {
  user: User | null;
  resource?: any;
  action: string;
  field?: string;
  args?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  filters?: Record<string, any>;
  maskedFields?: string[];
}

export type PolicyFunction = (context: PolicyContext) => PolicyResult | Promise<PolicyResult>;

/**
 * Dynamic policy-based authorization engine
 */
export class PolicyEngine extends SingletonService<PolicyEngine> {
  private policies = new Map<string, PolicyFunction[]>();
  private fieldPolicies = new Map<string, Map<string, PolicyFunction[]>>();
  private cache: CacheManager | null = null;

  protected constructor() {
    super();
    this.initializeCache();
    this.registerDefaultPolicies();
  }

  private async initializeCache() {
    this.cache = await CacheManager.getInstance();
  }

  private ensureCache(): CacheManager {
    if (!this.cache) {
      throw new Error('PolicyEngine cache not initialized');
    }
    return this.cache;
  }

  static async getInstance(): Promise<PolicyEngine> {
    return super.getInstance();
  }

  /**
   * Register a policy for a specific action
   */
  registerPolicy(action: string, policy: PolicyFunction) {
    const policies = this.policies.get(action) || [];
    policies.push(policy);
    this.policies.set(action, policies);
  }

  /**
   * Register a field-level policy
   */
  registerFieldPolicy(type: string, field: string, policy: PolicyFunction) {
    if (!this.fieldPolicies.has(type)) {
      this.fieldPolicies.set(type, new Map());
    }

    const typePolicies = this.fieldPolicies.get(type)!;
    const fieldPolicies = typePolicies.get(field) || [];
    fieldPolicies.push(policy);
    typePolicies.set(field, fieldPolicies);
  }

  /**
   * Evaluate policies for an action
   */
  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    // Check cache first
    const cacheKey = this.getCacheKey(context);
    const cached = await this.ensureCache().get<PolicyResult>(cacheKey);
    if (cached) return cached;

    // Get applicable policies
    const policies = this.policies.get(context.action) || [];
    const fieldPolicies = this.getFieldPolicies(context);
    const allPolicies = [...policies, ...fieldPolicies];

    if (allPolicies.length === 0) {
      // No policies defined, default to deny
      return { allowed: false, reason: 'No policies defined for action' };
    }

    // Evaluate all policies
    const results = await Promise.all(
      allPolicies.map(policy => this.evaluatePolicy(policy, context))
    );

    // Combine results (all must pass)
    const finalResult = this.combineResults(results);

    // Cache result
    await this.ensureCache().set(cacheKey, finalResult, { ttl: 60 }); // 1 minute cache

    // Log authorization decision
    logger.debug('Authorization decision', {
      action: context.action,
      field: context.field,
      allowed: finalResult.allowed,
      userId: context.user?.id,
    });

    return finalResult;
  }

  /**
   * Evaluate if a user can access a field
   */
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
    };

    const result = await this.evaluate(context);
    return result.allowed;
  }

  /**
   * Get fields that should be masked for a user
   */
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
      };

      const results = await Promise.all(
        policies.map(policy => this.evaluatePolicy(policy, context))
      );

      const finalResult = this.combineResults(results);
      if (!finalResult.allowed || finalResult.maskedFields?.includes(field)) {
        maskedFields.push(field);
      }
    }

    return maskedFields;
  }

  /**
   * Create a policy builder for fluent API
   */
  createPolicy(name: string) {
    const engine = this;
    const builder: {
      policies: PolicyFunction[];
      requireAuth(): typeof builder;
      requireRole(role: string): typeof builder;
      requireOwnership(getOwnerId: (resource: any) => string): typeof builder;
      requirePermission(permission: string): typeof builder;
      custom(policy: PolicyFunction): typeof builder;
      build(): PolicyFunction;
    } = {
      policies: [] as PolicyFunction[],

      requireAuth(): typeof builder {
        builder.policies.push((ctx) => ({
          allowed: !!ctx.user,
          reason: 'Authentication required',
        }));
        return builder;
      },

      requireRole(role: string): typeof builder {
        builder.policies.push((ctx) => ({
          allowed: ctx.user?.role?.includes(role) || false,
          reason: `Role '${role}' required`,
        }));
        return builder;
      },

      requireOwnership(getOwnerId: (resource: any) => string): typeof builder {
        builder.policies.push((ctx) => {
          if (!ctx.resource || !ctx.user) {
            return { allowed: false, reason: 'Resource or user not found' };
          }
          const ownerId = getOwnerId(ctx.resource);
          return {
            allowed: ownerId === ctx.user.id,
            reason: 'Resource ownership required',
          };
        });
        return builder;
      },

      requirePermission(permission: string): typeof builder {
        builder.policies.push((ctx) => ({
          allowed: ctx.user?.permissions?.includes(permission) || false,
          reason: `Permission '${permission}' required`,
        }));
        return builder;
      },

      custom(policy: PolicyFunction): typeof builder {
        builder.policies.push(policy);
        return builder;
      },

      build(): PolicyFunction {
        return async (context) => {
          const results = await Promise.all(
            builder.policies.map(p => p(context))
          );
          return engine.combineResults(results);
        };
      },
    };

    return builder;
  }

  private registerDefaultPolicies() {
    // Todo policies
    this.registerPolicy('todo.create', (ctx) => ({
      allowed: !!ctx.user,
      reason: 'Must be authenticated to create todos',
    }));

    this.registerPolicy('todo.read', (ctx) => {
      if (!ctx.user) return { allowed: false, reason: 'Authentication required' };
      if (!ctx.resource) return { allowed: true }; // Allow listing

      const todo = ctx.resource as Todo;
      return {
        allowed: todo.userId === ctx.user.id,
        reason: 'Can only read own todos',
      };
    });

    this.registerPolicy('todo.update', (ctx) => {
      if (!ctx.user || !ctx.resource) {
        return { allowed: false, reason: 'Authentication and resource required' };
      }

      const todo = ctx.resource as Todo;
      return {
        allowed: todo.userId === ctx.user.id,
        reason: 'Can only update own todos',
      };
    });

    this.registerPolicy('todo.delete', (ctx) => {
      if (!ctx.user || !ctx.resource) {
        return { allowed: false, reason: 'Authentication and resource required' };
      }

      const todo = ctx.resource as Todo;
      return {
        allowed: todo.userId === ctx.user.id,
        reason: 'Can only delete own todos',
      };
    });

    // Field-level policies
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

    this.registerFieldPolicy('User', 'settings', (ctx) => {
      if (!ctx.user || !ctx.resource) {
        return { allowed: false, reason: 'Authentication required' };
      }

      const targetUser = ctx.resource as User;
      return {
        allowed: targetUser.id === ctx.user.id,
        reason: 'Can only view own settings',
      };
    });

    // Performance metrics - admin only
    this.registerPolicy('metrics.read', (ctx) => ({
      allowed: ctx.user?.role?.includes('admin') || false,
      reason: 'Admin access required for metrics',
    }));
  }

  private getFieldPolicies(context: PolicyContext): PolicyFunction[] {
    if (!context.field) return [];

    const [type, field] = context.field.split('.');
    const typePolicies = this.fieldPolicies.get(type || '');
    if (!typePolicies) return [];

    return typePolicies.get(field || '') || [];
  }

  private async evaluatePolicy(
    policy: PolicyFunction,
    context: PolicyContext
  ): Promise<PolicyResult> {
    try {
      return await policy(context);
    } catch (error) {
      logger.error('Policy evaluation error', { error, context });
      return { allowed: false, reason: 'Policy evaluation failed' };
    }
  }

  private combineResults(results: PolicyResult[]): PolicyResult {
    // All policies must pass
    const allowed = results.every(r => r.allowed);
    const reasons = results.filter(r => !r.allowed).map(r => r.reason);
    const filters = results.reduce((acc, r) => ({ ...acc, ...r.filters }), {});
    const maskedFields = results.flatMap(r => r.maskedFields || []);

    return {
      allowed,
      reason: reasons.join('; '),
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      maskedFields: maskedFields.length > 0 ? [...new Set(maskedFields)] : undefined,
    };
  }

  private getCacheKey(context: PolicyContext): string {
    return CacheManager.createKey(
      'policy',
      context.action,
      context.user?.id || 'anonymous',
      context.field || '',
      JSON.stringify(context.args || {})
    );
  }
}

export const policyEngine = PolicyEngine.getInstance();