/**
 * AI/ML Service-Specific Decorators
 * 
 * Specialized decorators for AI/ML services that extend the base decorators
 * with AI-specific functionality like token tracking, model management,
 * and cost optimization.
 */

import { z } from 'zod';
import { BaseService } from '../BaseService.js';
import { BaseAsyncService } from '../BaseAsyncService.js';
import { Metric } from './ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Token usage tracking decorator
 * Tracks token consumption and costs for LLM operations
 */
export interface TokenUsageOptions {
  model: string;
  costPerToken?: number;
  warnThreshold?: number;
  errorThreshold?: number;
}

export function TokenUsage(options: TokenUsageOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const start = Date.now();
      let tokens = { prompt: 0, completion: 0, total: 0 };

      try {
        const result = await originalMethod.apply(this, args);
        
        // Extract token usage from result (assumes standard format)
        if (result && typeof result === 'object') {
          if ('usage' in result) {
            tokens = result.usage;
          } else if ('tokens' in result) {
            tokens = result.tokens;
          }
        }

        const cost = options.costPerToken ? tokens.total * options.costPerToken : 0;

        // Record metrics
        this.recordMetric('ai.tokens.used', tokens.total, {
          model: options.model,
          method: propertyKey,
        });

        if (cost > 0) {
          this.recordMetric('ai.cost', cost, {
            model: options.model,
            method: propertyKey,
          });
        }

        // Check thresholds
        if (options.warnThreshold && tokens.total > options.warnThreshold) {
          logger.warn(`High token usage in ${propertyKey}`, {
            tokens: tokens.total,
            threshold: options.warnThreshold,
            model: options.model,
          });
        }

        if (options.errorThreshold && tokens.total > options.errorThreshold) {
          this.emit('ai:token-limit-exceeded' as any, {
            method: propertyKey,
            tokens: tokens.total,
            threshold: options.errorThreshold,
            model: options.model,
          });
        }

        return result;
      } catch (error) {
        this.recordMetric('ai.tokens.error', 1, {
          model: options.model,
          method: propertyKey,
          error: (error as Error).name,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Model fallback decorator
 * Automatically falls back to alternative models on failure
 */
export interface ModelFallbackOptions {
  primary: string;
  fallbacks: string[];
  retryPrimary?: boolean;
  fallbackOn?: (error: Error) => boolean;
}

export function ModelFallback(options: ModelFallbackOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const models = [options.primary, ...options.fallbacks];
      let lastError: Error | null = null;

      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        
        try {
          // Inject model into args (assumes first arg is options object)
          const modifiedArgs = [...args];
          if (modifiedArgs[0] && typeof modifiedArgs[0] === 'object') {
            modifiedArgs[0] = { ...modifiedArgs[0], model };
          }

          const result = await originalMethod.apply(this, modifiedArgs);

          if (i > 0) {
            // We used a fallback
            this.emit('ai:model-fallback-used' as any, {
              primary: options.primary,
              fallback: model,
              reason: lastError?.message,
            });
          }

          return result;
        } catch (error) {
          lastError = error as Error;

          // Check if we should fallback for this error
          if (options.fallbackOn && !options.fallbackOn(error as Error)) {
            throw error;
          }

          logger.warn(`Model ${model} failed in ${propertyKey}, trying fallback`, {
            error: (error as Error).message,
            remainingFallbacks: models.length - i - 1,
          });

          this.recordMetric('ai.model.fallback', 1, {
            from: model,
            method: propertyKey,
            error: (error as Error).name,
          });
        }
      }

      throw new Error(
        `All models failed for ${propertyKey}: ${lastError?.message}`
      );
    };

    return descriptor;
  };
}

/**
 * Embedding cache decorator
 * Caches embeddings to reduce API calls and costs
 */
export interface EmbeddingCacheOptions {
  ttl?: number; // Time to live in seconds
  maxSize?: number; // Maximum cache size
  keyExtractor?: (text: string) => string;
}

export function EmbeddingCache(options: EmbeddingCacheOptions = {}) {
  const cache = new Map<string, { embedding: number[]; expires: number }>();
  const ttl = (options.ttl || 3600) * 1000; // Convert to milliseconds
  const maxSize = options.maxSize || 10000;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      // Extract text from args (assumes first arg is text)
      const text = args[0];
      if (typeof text !== 'string') {
        return originalMethod.apply(this, args);
      }

      const cacheKey = options.keyExtractor ? options.keyExtractor(text) : text;
      const now = Date.now();

      // Check cache
      const cached = cache.get(cacheKey);
      if (cached && cached.expires > now) {
        this.emit('embedding:cached' as any, { text, hit: true });
        this.recordMetric('ai.embedding.cache.hit', 1);
        return cached.embedding;
      }

      // Clean expired entries if cache is full
      if (cache.size >= maxSize) {
        for (const [key, value] of cache.entries()) {
          if (value.expires <= now) {
            cache.delete(key);
          }
        }
      }

      // Generate embedding
      const embedding = await originalMethod.apply(this, args);

      // Cache result
      if (cache.size < maxSize) {
        cache.set(cacheKey, {
          embedding,
          expires: now + ttl,
        });
      }

      this.emit('embedding:cached' as any, { text, hit: false });
      this.recordMetric('ai.embedding.cache.miss', 1);

      return embedding;
    };

    return descriptor;
  };
}

/**
 * RAG context decorator
 * Manages context building for RAG operations
 */
export interface RAGContextOptions {
  maxContextLength?: number;
  relevanceThreshold?: number;
  includeSources?: boolean;
}

export function RAGContext(options: RAGContextOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const start = Date.now();

      try {
        const result = await originalMethod.apply(this, args);

        // Process RAG results
        if (result && typeof result === 'object' && 'context' in result) {
          const contextLength = JSON.stringify(result.context).length;

          if (options.maxContextLength && contextLength > options.maxContextLength) {
            logger.warn(`RAG context exceeds maximum length in ${propertyKey}`, {
              actual: contextLength,
              max: options.maxContextLength,
            });
          }

          this.emit('rag:context-built' as any, {
            query: args[0],
            contextLength,
            sources: options.includeSources ? result.sources : undefined,
          });

          this.recordMetric('ai.rag.context.length', contextLength, {
            method: propertyKey,
          });
        }

        return result;
      } catch (error) {
        this.recordMetric('ai.rag.error', 1, {
          method: propertyKey,
          error: (error as Error).name,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * AI performance monitoring decorator
 * Tracks detailed performance metrics for AI operations
 */
export interface AIPerformanceOptions {
  operation: string;
  trackMemory?: boolean;
  trackLatency?: boolean;
  sampleRate?: number; // 0-1, percentage of calls to track
}

export function AIPerformance(options: AIPerformanceOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      // Sample rate check
      if (options.sampleRate && Math.random() > options.sampleRate) {
        return originalMethod.apply(this, args);
      }

      const start = Date.now();
      const startMemory = options.trackMemory ? process.memoryUsage() : null;

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - start;

        const metrics: any = {
          operation: options.operation,
          method: propertyKey,
          duration,
        };

        if (options.trackMemory && startMemory) {
          const endMemory = process.memoryUsage();
          metrics.memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
          this.recordMetric('ai.memory.delta', metrics.memoryDelta, {
            operation: options.operation,
            method: propertyKey,
          });
        }

        if (options.trackLatency) {
          const latencyBucket = 
            duration < 100 ? 'fast' :
            duration < 1000 ? 'normal' :
            duration < 5000 ? 'slow' : 'very_slow';
          
          metrics.latencyBucket = latencyBucket;
          this.recordMetric(`ai.latency.${latencyBucket}`, 1, {
            operation: options.operation,
            method: propertyKey,
          });
        }

        this.emit('ai:performance-tracked' as any, metrics);

        return result;
      } catch (error) {
        this.recordMetric('ai.performance.error', 1, {
          operation: options.operation,
          method: propertyKey,
          error: (error as Error).name,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Vector search optimization decorator
 * Optimizes vector search operations
 */
export interface VectorSearchOptions {
  preFilter?: boolean;
  hybridSearch?: boolean;
  cacheResults?: boolean;
  cacheTTL?: number;
}

export function VectorSearch(options: VectorSearchOptions = {}) {
  const resultCache = options.cacheResults ? new Map<string, any>() : null;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const [query, searchOptions = {}] = args;
      
      // Generate cache key if caching is enabled
      const cacheKey = resultCache ? 
        JSON.stringify({ query, ...searchOptions }) : null;

      // Check cache
      if (cacheKey && resultCache!.has(cacheKey)) {
        const cached = resultCache!.get(cacheKey);
        if (cached.expires > Date.now()) {
          this.recordMetric('ai.vector.cache.hit', 1);
          return cached.results;
        }
        resultCache!.delete(cacheKey);
      }

      // Apply optimizations
      const optimizedOptions = { ...searchOptions };
      
      if (options.preFilter) {
        optimizedOptions.preFilter = true;
      }
      
      if (options.hybridSearch) {
        optimizedOptions.hybridSearch = true;
      }

      const start = Date.now();
      const results = await originalMethod.call(this, query, optimizedOptions);
      const duration = Date.now() - start;

      // Cache results
      if (cacheKey && resultCache) {
        resultCache.set(cacheKey, {
          results,
          expires: Date.now() + (options.cacheTTL || 300) * 1000,
        });
      }

      this.emit('vector:search-performed' as any, {
        collection: searchOptions.collection || 'default',
        query: Array.isArray(query) ? query : undefined,
        results: results.length,
        duration,
        filters: searchOptions.filter,
      });

      this.recordMetric('ai.vector.search.duration', duration, {
        method: propertyKey,
        resultCount: results.length,
      });

      return results;
    };

    return descriptor;
  };
}

/**
 * AI workflow decorator
 * Tracks and orchestrates multi-step AI workflows
 */
export interface AIWorkflowOptions {
  name: string;
  steps: string[];
  parallel?: boolean;
  continueOnError?: boolean;
}

export function AIWorkflow(options: AIWorkflowOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: BaseService<any>, ...args: any[]) {
      const workflowId = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const start = Date.now();

      this.emit('orchestration:workflow-started' as any, {
        workflowId,
        type: options.name,
        steps: options.steps.length,
      });

      try {
        const result = await originalMethod.apply(this, args);

        this.emit('orchestration:workflow-completed' as any, {
          workflowId,
          success: true,
          duration: Date.now() - start,
          outputs: result,
        });

        this.recordMetric('ai.workflow.completed', 1, {
          workflow: options.name,
          duration: Date.now() - start,
        });

        return result;
      } catch (error) {
        this.emit('orchestration:workflow-completed' as any, {
          workflowId,
          success: false,
          duration: Date.now() - start,
          error: error as Error,
        });

        this.recordMetric('ai.workflow.failed', 1, {
          workflow: options.name,
          error: (error as Error).name,
        });

        if (!options.continueOnError) {
          throw error;
        }

        return null;
      }
    };

    return descriptor;
  };
}

/**
 * Combined AI monitoring decorator
 * Applies multiple AI-specific monitoring capabilities
 */
export function AIMonitored(options: {
  operation: string;
  tokenTracking?: boolean;
  performanceTracking?: boolean;
  costTracking?: boolean;
}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Apply base metric decorator
    Metric({ 
      name: `ai.${options.operation}`, 
      recordDuration: true 
    })(target, propertyKey, descriptor);

    // Apply performance tracking
    if (options.performanceTracking) {
      AIPerformance({
        operation: options.operation,
        trackMemory: true,
        trackLatency: true,
        sampleRate: 1.0,
      })(target, propertyKey, descriptor);
    }

    return descriptor;
  };
}