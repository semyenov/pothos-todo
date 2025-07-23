import { logger } from "../../lib/unjs-utils.js";
// import { DistributedCacheManager } from "./DistributedCacheManager";
// import { AdvancedCacheManager, CacheStrategy } from "./AdvancedCacheManager";
// import { MetricsCollector } from "../observability/MetricsCollector";
// import { DistributedTracing } from "../observability/DistributedTracing";
import { hash } from "ohash";

// Temporary interfaces for strict typing
interface DistributedCacheManager {
  set(key: string, value: any, options?: { ttl?: number; tags?: string[] }): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  invalidate(pattern: string, options?: any): Promise<void>;
}

interface AdvancedCacheManager {
  set(key: string, value: any, options?: { ttl?: number; tags?: string[] }): Promise<void>;
  get(key: string): Promise<any>;
  invalidateByTag(tag: string): Promise<void>;
}

interface MetricsCollector {
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  getMetricStats(name: string): Promise<{ avg: number } | null>;
}

interface DistributedTracing {
  startTrace(name: string): string | null;
  finishSpan(spanId: string | null, status: string, error?: Error): void;
}
import {
  parse,
  validate,
  execute,
  GraphQLSchema,
  type OperationDefinitionNode,
  type FieldNode,
} from "graphql";
import EventEmitter from "events";

export interface GraphQLCacheConfig {
  defaultTTL: number;
  enableQueryAnalysis: boolean;
  enableFieldLevelCaching: boolean;
  enableAutomaticInvalidation: boolean;
  enableQueryComplexityBasedCaching: boolean;
  enableResponseSizeOptimization: boolean;
  maxCacheableQueryComplexity: number;
  fieldCacheStrategies: Map<string, FieldCacheStrategy>;
}

export interface FieldCacheStrategy {
  fieldPath: string;
  ttl: number;
  cacheKey: (parent: any, args: any, context: any) => string;
  shouldCache: (parent: any, args: any, context: any) => boolean;
  invalidateOn: string[]; // Events that should invalidate this field
}

export interface QueryCacheMetadata {
  queryHash: string;
  operationType: "query" | "mutation" | "subscription";
  operationName?: string;
  fields: string[];
  complexity: number;
  variables: Record<string, any>;
  userId?: string;
  timestamp: number;
  ttl: number;
}

export interface CachedGraphQLResponse {
  data: any;
  errors?: any[];
  extensions?: any;
  metadata: QueryCacheMetadata;
  cachedAt: number;
  expiresAt: number;
}

export interface GraphQLCacheAnalytics {
  totalQueries: number;
  cachedQueries: number;
  hitRate: number;
  averageResponseTime: number;
  averageCachedResponseTime: number;
  topCachedQueries: Array<{
    query: string;
    hits: number;
    avgComplexity: number;
  }>;
  fieldCacheStats: Map<
    string,
    {
      hits: number;
      misses: number;
      avgTTL: number;
    }
  >;
}

export interface SmartCacheInvalidationRule {
  name: string;
  triggerEvents: string[];
  affectedPatterns: string[];
  delay: number; // ms
  cascadeRules: string[];
  condition?: (event: any) => boolean;
}

export class GraphQLCacheManager extends EventEmitter {
  private static instance: GraphQLCacheManager;
  private config: GraphQLCacheConfig;
  private distributedCache: DistributedCacheManager | null;
  private localCache: AdvancedCacheManager | null;
  private schema?: GraphQLSchema;
  private metrics: MetricsCollector | null;
  private tracing: DistributedTracing | null;

  // Cache analytics
  private queryStats: Map<
    string,
    { hits: number; complexity: number; lastUsed: number }
  > = new Map();
  private fieldStats: Map<
    string,
    { hits: number; misses: number; totalTTL: number }
  > = new Map();
  private invalidationRules: Map<string, SmartCacheInvalidationRule> =
    new Map();

  // Query parsing cache
  private parsedQueries: Map<string, OperationDefinitionNode> = new Map();

  private constructor(config: GraphQLCacheConfig) {
    super();
    this.config = config;
    // TODO: Initialize cache managers when available
    this.distributedCache = null; // DistributedCacheManager.getInstance();
    this.localCache = null; // AdvancedCacheManager.getAdvancedInstance();
    this.metrics = null; // MetricsCollector.getInstance();
    this.tracing = null; // DistributedTracing.getInstance();

    this.setupDefaultFieldStrategies();
    this.setupInvalidationRules();
  }

  public static getInstance(config?: GraphQLCacheConfig): GraphQLCacheManager {
    if (!GraphQLCacheManager.instance && config) {
      GraphQLCacheManager.instance = new GraphQLCacheManager(config);
    }
    return GraphQLCacheManager.instance;
  }

  /**
   * Set GraphQL schema for analysis
   */
  public setSchema(schema: GraphQLSchema): void {
    this.schema = schema;
    logger.info("GraphQL schema set for cache manager");
  }

  /**
   * Cache GraphQL query response
   */
  public async cacheQuery(
    query: string,
    variables: Record<string, any>,
    response: any,
    context?: any
  ): Promise<void> {
    const span = this.tracing?.startTrace("graphql_cache_set");

    try {
      // Parse and analyze query
      const queryAnalysis = await this.analyzeQuery(query, variables);

      if (!this.shouldCacheQuery(queryAnalysis, response)) {
        this.tracing?.finishSpan(span, "ok");
        return;
      }

      // Generate cache key
      const cacheKey = this.generateQueryCacheKey(
        query,
        variables,
        (context?.userId as string | undefined)
      );

      // Create cached response
      const cachedResponse: CachedGraphQLResponse = {
        data: response.data,
        errors: response.errors,
        extensions: response.extensions,
        metadata: {
          ...queryAnalysis,
          userId: context?.userId ?? undefined,
          timestamp: Date.now(),
          ttl: this.calculateTTL(queryAnalysis),
        },
        cachedAt: Date.now(),
        expiresAt: Date.now() + this.calculateTTL(queryAnalysis),
      };

      // Cache in distributed cache
      if (this.distributedCache) {
        await this.distributedCache.set(cacheKey, cachedResponse, {
          ttl: this.calculateTTL(queryAnalysis),
          tags: this.generateCacheTags(queryAnalysis),
        });
      }

      // Update statistics
      this.updateQueryStats(queryAnalysis);

      // Cache individual fields if enabled
      if (this.config.enableFieldLevelCaching) {
        await this.cacheIndividualFields(queryAnalysis, response.data, context);
      }

      this.metrics?.recordMetric("graphql_cache_set", 1, {
        operationType: queryAnalysis.operationType,
        complexity: queryAnalysis.complexity.toString(),
      });

      this.tracing?.finishSpan(span, "ok");
      this.emit("query_cached", {
        queryHash: queryAnalysis.queryHash,
        ttl: this.calculateTTL(queryAnalysis),
      });
    } catch (error) {
      this.tracing?.finishSpan(span, "error", error as Error);
      logger.error("Failed to cache GraphQL query", error, { query });
    }
  }

  /**
   * Get cached GraphQL query response
   */
  public async getCachedQuery(
    query: string,
    variables: Record<string, any>,
    context?: any
  ): Promise<CachedGraphQLResponse | null> {
    const span = this.tracing?.startTrace("graphql_cache_get");
    const startTime = Date.now();

    try {
      // Generate cache key
      const cacheKey = this.generateQueryCacheKey(
        query,
        variables,
        (context?.userId as string | undefined)
      );

      // Try to get from cache
      const cachedResponse = this.distributedCache
        ? await this.distributedCache.get<CachedGraphQLResponse>(cacheKey)
        : null;

      if (!cachedResponse) {
        this.metrics?.recordMetric("graphql_cache_miss", 1);
        this.tracing?.finishSpan(span, "ok");
        return null;
      }

      // Check if cache is still valid
      if (Date.now() > cachedResponse.expiresAt) {
        if (this.distributedCache) {
          await this.distributedCache.invalidate(cacheKey);
        }
        this.metrics?.recordMetric("graphql_cache_expired", 1);
        this.tracing?.finishSpan(span, "ok");
        return null;
      }

      // Update hit statistics
      const queryHash = hash({ query, variables });
      const stats = this.queryStats.get(queryHash);
      if (stats) {
        stats.hits++;
        stats.lastUsed = Date.now();
      }

      this.metrics?.recordMetric("graphql_cache_hit", 1, {
        operationType: cachedResponse.metadata.operationType,
      });

      this.metrics?.recordMetric(
        "graphql_cache_response_time",
        Date.now() - startTime
      );

      this.tracing?.finishSpan(span, "ok");
      this.emit("cache_hit", {
        queryHash,
        age: Date.now() - cachedResponse.cachedAt,
      });

      return cachedResponse;
    } catch (error) {
      this.tracing?.finishSpan(span, "error", error as Error);
      logger.error("Failed to get cached GraphQL query", error, { query });
      return null;
    }
  }

  /**
   * Cache individual GraphQL field
   */
  public async cacheField(
    fieldPath: string,
    parent: any,
    args: any,
    result: any,
    context: any
  ): Promise<void> {
    try {
      const strategy = this.config.fieldCacheStrategies.get(fieldPath);
      if (!strategy || !strategy.shouldCache(parent, args, context)) {
        return;
      }

      const fieldCacheKey = strategy.cacheKey(parent, args, context);

      if (this.localCache) {
        await this.localCache.set(fieldCacheKey, result, {
          ttl: strategy.ttl,
          tags: [`field:${fieldPath}`],
        });
      }

      // Update field statistics
      const stats = this.fieldStats.get(fieldPath) || {
        hits: 0,
        misses: 0,
        totalTTL: 0,
      };
      stats.totalTTL += strategy.ttl;
      this.fieldStats.set(fieldPath, stats);

      this.metrics?.recordMetric("graphql_field_cached", 1, {
        field: fieldPath,
      });
    } catch (error) {
      logger.error("Failed to cache GraphQL field", error, { fieldPath });
    }
  }

  /**
   * Get cached field value
   */
  public async getCachedField(
    fieldPath: string,
    parent: any,
    args: any,
    context: any
  ): Promise<any> {
    try {
      const strategy = this.config.fieldCacheStrategies.get(fieldPath);
      if (!strategy) {
        return null;
      }

      const fieldCacheKey = strategy.cacheKey(parent, args, context);
      const result = this.localCache ? await this.localCache.get(fieldCacheKey) : null;

      // Update statistics
      const stats = this.fieldStats.get(fieldPath) || {
        hits: 0,
        misses: 0,
        totalTTL: 0,
      };
      if (result !== null) {
        stats.hits++;
        this.metrics?.recordMetric("graphql_field_hit", 1, { field: fieldPath });
      } else {
        stats.misses++;
        this.metrics?.recordMetric("graphql_field_miss", 1, {
          field: fieldPath,
        });
      }
      this.fieldStats.set(fieldPath, stats);

      return result;
    } catch (error) {
      logger.error("Failed to get cached GraphQL field", error, { fieldPath });
      return null;
    }
  }

  /**
   * Intelligent GraphQL cache invalidation
   */
  public async invalidateByPattern(
    pattern: string,
    options?: {
      triggerEvent?: string;
      cascadeInvalidation?: boolean;
      affectedFields?: string[];
    }
  ): Promise<void> {
    const span = this.tracing.startTrace("graphql_cache_invalidate");

    try {
      // Invalidate query cache
      await this.distributedCache.invalidate(pattern, {
        cascadeInvalidation: options?.cascadeInvalidation,
        crossRegionSync: true,
      });

      // Invalidate field cache if specified
      if (options?.affectedFields) {
        for (const field of options.affectedFields) {
          await this.localCache.invalidateByTag(`field:${field}`);
        }
      }

      // Process cascade rules
      if (options?.cascadeInvalidation && options?.triggerEvent) {
        await this.processCascadeInvalidation(options.triggerEvent);
      }

      this.metrics.recordMetric("graphql_cache_invalidated", 1, {
        pattern,
        event: options?.triggerEvent || "manual",
      });

      this.tracing.finishSpan(span, "ok");
      this.emit("cache_invalidated", {
        pattern,
        trigger: options?.triggerEvent,
      });
    } catch (error) {
      this.tracing?.finishSpan(span, "error", error as Error);
      logger.error("GraphQL cache invalidation failed", error, { pattern });
    }
  }

  /**
   * Smart cache warming for GraphQL queries
   */
  public async warmGraphQLCache(
    queries: Array<{
      query: string;
      variables?: Record<string, any>;
      context?: any;
      priority: "high" | "medium" | "low";
    }>
  ): Promise<void> {
    const span = this.tracing?.startTrace("graphql_cache_warm");

    try {
      const warmingTasks = queries.map(async (queryConfig) => {
        try {
          // Check if already cached
          const cached = await this.getCachedQuery(
            queryConfig.query,
            queryConfig.variables || {},
            queryConfig.context
          );

          if (cached) {
            return; // Already cached
          }

          // Execute query to warm cache
          if (this.schema) {
            const result = await execute({
              schema: this.schema,
              document: parse(queryConfig.query),
              variableValues: queryConfig.variables,
              contextValue: queryConfig.context,
            });

            await this.cacheQuery(
              queryConfig.query,
              queryConfig.variables || {},
              result,
              queryConfig.context
            );
          }
        } catch (error) {
          logger.warn("Failed to warm query cache", error, {
            query: queryConfig.query.substring(0, 100),
          });
        }
      });

      await Promise.allSettled(warmingTasks);

      this.tracing?.finishSpan(span, "ok");
      logger.info("GraphQL cache warming completed", {
        queries: queries.length,
      });
    } catch (error) {
      this.tracing?.finishSpan(span, "error", error as Error);
      logger.error("GraphQL cache warming failed", error);
    }
  }

  /**
   * Get comprehensive GraphQL cache analytics
   */
  public async getGraphQLCacheAnalytics(): Promise<GraphQLCacheAnalytics> {
    try {
      const totalQueries = Array.from(this.queryStats.values()).reduce(
        (sum, stats) => sum + stats.hits,
        0
      );

      const cachedQueries = this.queryStats.size;
      const hitRate =
        cachedQueries > 0 ? (totalQueries / cachedQueries) * 100 : 0;

      // Calculate response times
      const avgResponseTime = await this.metrics.getMetricStats(
        "graphql_query_duration"
      );
      const avgCachedResponseTime = await this.metrics.getMetricStats(
        "graphql_cache_response_time"
      );

      // Top cached queries
      const topCachedQueries = Array.from(this.queryStats.entries())
        .sort(([, a], [, b]) => b.hits - a.hits)
        .slice(0, 10)
        .map(([queryHash, stats]) => ({
          query: queryHash,
          hits: stats.hits,
          avgComplexity: stats.complexity,
        }));

      // Field cache statistics
      const fieldCacheStats = new Map<
        string,
        {
          hits: number;
          misses: number;
          avgTTL: number;
        }
      >();

      for (const [field, stats] of this.fieldStats.entries()) {
        const totalRequests = stats.hits + stats.misses;
        fieldCacheStats.set(field, {
          hits: stats.hits,
          misses: stats.misses,
          avgTTL: totalRequests > 0 ? stats.totalTTL / totalRequests : 0,
        });
      }

      return {
        totalQueries,
        cachedQueries,
        hitRate,
        averageResponseTime: avgResponseTime?.avg ?? 0,
        averageCachedResponseTime: avgCachedResponseTime?.avg ?? 0,
        topCachedQueries,
        fieldCacheStats,
      };
    } catch (error) {
      logger.error("Failed to get GraphQL cache analytics", error);
      throw error;
    }
  }

  // Private helper methods

  private async analyzeQuery(
    query: string,
    variables: Record<string, any>
  ): Promise<QueryCacheMetadata> {
    const queryHash = hash({ query, variables });

    // Check if already parsed
    let parsedQuery = this.parsedQueries.get(queryHash);
    if (!parsedQuery) {
      const document = parse(query);
      parsedQuery = document.definitions[0] as OperationDefinitionNode;
      this.parsedQueries.set(queryHash, parsedQuery);
    }

    // Extract operation info
    const operationType = parsedQuery.operation;
    const operationName = parsedQuery.name?.value;

    // Extract fields
    const fields = this.extractFields(parsedQuery.selectionSet);

    // Calculate complexity (simplified)
    const complexity = this.calculateQueryComplexity(parsedQuery);

    return {
      queryHash,
      operationType,
      operationName,
      fields,
      complexity,
      variables,
      timestamp: Date.now(),
      ttl: this.config.defaultTTL,
    };
  }

  private extractFields(selectionSet: any, prefix = ""): string[] {
    const fields: string[] = [];

    for (const selection of selectionSet.selections) {
      if (selection.kind === "Field") {
        const fieldName = prefix
          ? `${prefix}.${selection.name.value}`
          : selection.name.value;
        fields.push(fieldName);

        if (selection.selectionSet) {
          fields.push(...this.extractFields(selection.selectionSet, fieldName));
        }
      }
    }

    return fields;
  }

  private calculateQueryComplexity(operation: OperationDefinitionNode): number {
    // Simplified complexity calculation
    // In production, use a proper GraphQL complexity analysis library
    let complexity = 1;

    const countSelections = (selectionSet: any): number => {
      let count = 0;
      for (const selection of selectionSet.selections) {
        count++;
        if (selection.selectionSet) {
          count += countSelections(selection.selectionSet);
        }
      }
      return count;
    };

    complexity = countSelections(operation.selectionSet);
    return Math.min(complexity, 1000); // Cap at 1000
  }

  private shouldCacheQuery(
    analysis: QueryCacheMetadata,
    response: any
  ): boolean {
    // Don't cache mutations
    if (analysis.operationType === "mutation") {
      return false;
    }

    // Don't cache subscriptions
    if (analysis.operationType === "subscription") {
      return false;
    }

    // Don't cache queries with errors
    if (response.errors && response.errors.length > 0) {
      return false;
    }

    // Don't cache overly complex queries
    if (
      this.config.enableQueryComplexityBasedCaching &&
      analysis.complexity > this.config.maxCacheableQueryComplexity
    ) {
      return false;
    }

    return true;
  }

  private generateQueryCacheKey(
    query: string,
    variables: Record<string, any>,
    userId?: string
  ): string {
    const keyParts = [query, JSON.stringify(variables)];
    if (userId) {
      keyParts.push(userId);
    }
    return `graphql:query:${hash(keyParts)}`;
  }

  private calculateTTL(analysis: QueryCacheMetadata): number {
    let ttl = this.config.defaultTTL;

    // Adjust TTL based on complexity
    if (analysis.complexity > 50) {
      ttl *= 2; // Cache complex queries longer
    }

    // Adjust TTL based on fields
    if (
      analysis.fields.some(
        (field) => field.includes("user") || field.includes("profile")
      )
    ) {
      ttl = Math.min(ttl, 1800); // User data expires faster (30 min)
    }

    if (
      analysis.fields.some(
        (field) => field.includes("stats") || field.includes("analytics")
      )
    ) {
      ttl = Math.min(ttl, 300); // Stats expire very fast (5 min)
    }

    return ttl;
  }

  private generateCacheTags(analysis: QueryCacheMetadata): string[] {
    const tags = [
      `operation:${analysis.operationType}`,
      `complexity:${Math.floor(analysis.complexity / 10) * 10}`, // Group by complexity ranges
    ];

    if (analysis.operationName) {
      tags.push(`name:${analysis.operationName}`);
    }

    // Add field-based tags
    const fieldTypes = new Set<string>();
    for (const field of analysis.fields) {
      const topLevelField = field.split(".")[0];
      if (topLevelField) {
        fieldTypes.add(topLevelField);
      }
    }

    for (const fieldType of fieldTypes) {
      tags.push(`field:${fieldType}`);
    }

    return tags;
  }

  private updateQueryStats(analysis: QueryCacheMetadata): void {
    const stats = this.queryStats.get(analysis.queryHash) || {
      hits: 0,
      complexity: analysis.complexity,
      lastUsed: Date.now(),
    };

    stats.lastUsed = Date.now();
    this.queryStats.set(analysis.queryHash, stats);
  }

  private async cacheIndividualFields(
    analysis: QueryCacheMetadata,
    data: any,
    context: any
  ): Promise<void> {
    for (const field of analysis.fields) {
      const strategy = this.config.fieldCacheStrategies.get(field);
      if (strategy) {
        const fieldValue = this.extractFieldValue(data, field);
        if (fieldValue !== undefined) {
          await this.cacheField(field, {}, {}, fieldValue, context);
        }
      }
    }
  }

  private extractFieldValue(data: any, fieldPath: string): any {
    const parts = fieldPath.split(".");
    let current = data;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private setupDefaultFieldStrategies(): void {
    // User profile field strategy
    this.config.fieldCacheStrategies.set("user.profile", {
      fieldPath: "user.profile",
      ttl: 1800, // 30 minutes
      cacheKey: (parent, args, context) => `user:profile:${context.userId}`,
      shouldCache: (parent, args, context) => !!context.userId,
      invalidateOn: ["user.updated", "profile.updated"],
    });

    // Todo list field strategy
    this.config.fieldCacheStrategies.set("user.todos", {
      fieldPath: "user.todos",
      ttl: 600, // 10 minutes
      cacheKey: (parent, args, context) =>
        `user:todos:${context.userId}:${hash(args)}`,
      shouldCache: (parent, args, context) => !!context.userId,
      invalidateOn: ["todo.created", "todo.updated", "todo.deleted"],
    });

    // AI suggestions field strategy
    this.config.fieldCacheStrategies.set("generateTaskSuggestions", {
      fieldPath: "generateTaskSuggestions",
      ttl: 3600, // 1 hour
      cacheKey: (parent, args, context) =>
        `ai:suggestions:${context.userId}:${hash(args)}`,
      shouldCache: (parent, args, context) => !!context.userId,
      invalidateOn: ["user.preferences.updated"],
    });
  }

  private setupInvalidationRules(): void {
    // User data invalidation rule
    this.invalidationRules.set("user-updates", {
      name: "user-updates",
      triggerEvents: ["user.updated", "user.deleted"],
      affectedPatterns: ["graphql:query:*user*", "user:*"],
      delay: 0,
      cascadeRules: ["user-related-data"],
    });

    // Todo data invalidation rule
    this.invalidationRules.set("todo-updates", {
      name: "todo-updates",
      triggerEvents: ["todo.created", "todo.updated", "todo.deleted"],
      affectedPatterns: ["graphql:query:*todo*", "user:todos:*"],
      delay: 1000, // 1 second delay for batch operations
      cascadeRules: [],
    });

    // AI data invalidation rule
    this.invalidationRules.set("ai-updates", {
      name: "ai-updates",
      triggerEvents: ["user.preferences.updated", "todo.completed"],
      affectedPatterns: ["ai:*", "graphql:query:*suggestion*"],
      delay: 5000, // 5 second delay for AI data
      cascadeRules: [],
    });
  }

  private async processCascadeInvalidation(
    triggerEvent: string
  ): Promise<void> {
    for (const [ruleName, rule] of this.invalidationRules.entries()) {
      if (rule.triggerEvents.includes(triggerEvent)) {
        // Apply delay if specified
        if (rule.delay > 0) {
          setTimeout(async () => {
            await this.executeInvalidationRule(rule);
          }, rule.delay);
        } else {
          await this.executeInvalidationRule(rule);
        }

        // Process cascade rules
        for (const cascadeRuleName of rule.cascadeRules) {
          const cascadeRule = this.invalidationRules.get(cascadeRuleName);
          if (cascadeRule) {
            setTimeout(async () => {
              await this.executeInvalidationRule(cascadeRule);
            }, rule.delay + 1000); // Add 1 second to cascade delay
          }
        }
      }
    }
  }

  private async executeInvalidationRule(
    rule: SmartCacheInvalidationRule
  ): Promise<void> {
    try {
      for (const pattern of rule.affectedPatterns) {
        await this.distributedCache.invalidate(pattern);
      }

      logger.debug("Invalidation rule executed", {
        ruleName: rule.name,
        patterns: rule.affectedPatterns,
      });
    } catch (error) {
      logger.error("Failed to execute invalidation rule", error, {
        ruleName: rule.name,
      });
    }
  }

  /**
   * Shutdown GraphQL cache manager
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear caches
      this.parsedQueries.clear();
      this.queryStats.clear();
      this.fieldStats.clear();
      this.invalidationRules.clear();

      logger.info("GraphQL cache manager shutdown completed");
      this.emit("shutdown");
    } catch (error) {
      logger.error("Error during GraphQL cache shutdown", error);
      throw error;
    }
  }
}

/**
 * GraphQL cache middleware
 */
export function createGraphQLCacheMiddleware(config?: GraphQLCacheConfig) {
  const cacheManager = GraphQLCacheManager.getInstance(config);

  return {
    requestDidStart() {
      return {
        async willSendResponse(requestContext: any) {
          if (requestContext.request.query && requestContext.response.data) {
            await cacheManager.cacheQuery(
              requestContext.request.query,
              requestContext.request.variables || {},
              requestContext.response,
              requestContext.context
            );
          }
        },

        async responseForOperation(requestContext: any) {
          if (requestContext.request.query) {
            const cached = await cacheManager.getCachedQuery(
              requestContext.request.query,
              requestContext.request.variables || {},
              requestContext.context
            );

            if (cached) {
              return {
                data: cached.data,
                errors: cached.errors,
                extensions: {
                  ...cached.extensions,
                  fromCache: true,
                  cachedAt: cached.cachedAt,
                },
              };
            }
          }
        },
      };
    },
  };
}

/**
 * Factory function to create GraphQL cache manager
 */
export const createGraphQLCacheManager = (config: GraphQLCacheConfig) => {
  return GraphQLCacheManager.getInstance(config);
};

/**
 * Default GraphQL cache configuration
 */
export const defaultGraphQLCacheConfig: GraphQLCacheConfig = {
  defaultTTL: 900, // 15 minutes
  enableQueryAnalysis: true,
  enableFieldLevelCaching: true,
  enableAutomaticInvalidation: true,
  enableQueryComplexityBasedCaching: true,
  enableResponseSizeOptimization: true,
  maxCacheableQueryComplexity: 100,
  fieldCacheStrategies: new Map(),
};
