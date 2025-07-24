import { OpenAI } from 'openai';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { EmbeddingServiceEventMap } from '../core/ServiceEventMaps.ai.js';
import { 
  ServiceConfig, 
  Retry, 
  CircuitBreaker, 
  Metric, 
  HealthCheck,
  RateLimit,
  Cache 
} from '../core/decorators/ServiceDecorators.js';
import { 
  TokenUsage, 
  EmbeddingCache,
  AIPerformance,
  ModelFallback 
} from '../core/decorators/AIServiceDecorators.js';
import { PrismaService } from '../database/PrismaService.new.js';
import { VectorStore } from './VectorStore.new.js';
import type { Embedding, Priority as PrismaPriority, TodoStatus as PrismaTodoStatus } from '@prisma/client';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Embedding service configuration schema
 */
const EmbeddingConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('text-embedding-3-small'),
  dimensions: z.number().default(1536),
  batchSize: z.number().default(100),
  maxRetries: z.number().default(3),
  rateLimits: z.object({
    requestsPerMinute: z.number().default(3000),
    tokensPerMinute: z.number().default(1000000),
  }),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(3600), // 1 hour
    maxSize: z.number().default(10000),
  }),
  costTracking: z.object({
    enabled: z.boolean().default(true),
    costPerToken: z.number().default(0.00002), // $0.02 per 1M tokens
    warnThreshold: z.number().default(10000), // Warn at 10k tokens
    errorThreshold: z.number().default(50000), // Error at 50k tokens
  }),
  fallbackModels: z.array(z.string()).default([
    'text-embedding-ada-002',
  ]),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

/**
 * Embedding options
 */
export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
  user?: string; // For rate limiting per user
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  usage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Batch embedding request
 */
export interface BatchEmbeddingRequest {
  id: string;
  text: string;
  metadata?: Record<string, any>;
}

/**
 * Search result
 */
export interface EmbeddingSearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, any>;
}

/**
 * Enhanced Embedding Service using the new base service architecture
 * 
 * Features:
 * - Automatic OpenAI client management
 * - Type-safe embedding generation with events
 * - Built-in caching and rate limiting
 * - Token usage tracking and cost monitoring
 * - Batch embedding support
 * - Model fallback on failures
 * - Integration with vector store
 * 
 * @example
 * ```typescript
 * const embeddingService = EmbeddingService.getInstance();
 * 
 * // Listen to embedding events
 * embeddingService.on('embedding:generated', ({ text, model, duration, tokens }) => {
 *   console.log(`Generated embedding in ${duration}ms using ${tokens} tokens`);
 * });
 * 
 * // Generate embedding with caching
 * const result = await embeddingService.generateEmbedding('Hello world');
 * 
 * // Batch generate embeddings
 * const embeddings = await embeddingService.batchGenerateEmbeddings([
 *   { id: '1', text: 'First text' },
 *   { id: '2', text: 'Second text' }
 * ]);
 * ```
 */
@ServiceConfig({
  schema: EmbeddingConfigSchema,
  prefix: 'embedding',
  hot: true, // Allow hot reload for API key changes
})
@Cache({ ttl: 3600, maxSize: 10000 })
export class EmbeddingService extends BaseService<EmbeddingConfig, EmbeddingServiceEventMap> {
  private openai!: OpenAI;
  private vectorStore!: VectorStore;
  private prismaService!: PrismaService;
  private embeddingCount = 0;
  private tokenCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private errorCount = 0;

  /**
   * Get the singleton instance
   */
  static override getInstance(): EmbeddingService {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'embedding-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Text embedding service with OpenAI integration and vector storage';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('EmbeddingService initializing with config:', {
      model: this.config.model,
      dimensions: this.config.dimensions,
      caching: this.config.caching.enabled,
      costTracking: this.config.costTracking.enabled,
    });

    // Get dependencies
    this.vectorStore = await VectorStore.getInstance();
    this.prismaService = await PrismaService.getInstance();
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Create OpenAI client as a tracked resource
    this.openai = this.createResource({
      resource: new OpenAI({ 
        apiKey: this.config.apiKey,
        maxRetries: this.config.maxRetries,
      }),
      dispose: async () => {
        logger.info('OpenAI client disposed');
      },
    } as any);

    // Test the connection
    await this.testConnection();

    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    logger.info('EmbeddingService stopped');
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: EmbeddingConfig): Promise<void> {
    // If API key changed, recreate OpenAI client
    if (newConfig.apiKey !== this.config.apiKey) {
      logger.info('API key changed, recreating OpenAI client');
      
      // Dispose old client
      await this.disposeResource(this.openai);
      
      // Create new client
      this.openai = this.createResource({
        resource: new OpenAI({ 
          apiKey: newConfig.apiKey,
          maxRetries: newConfig.maxRetries,
        }),
        dispose: async () => {
          logger.info('OpenAI client disposed');
        },
      } as any);
    }

    // Emit model change event if needed
    if (newConfig.model !== this.config.model) {
      this.emit('embedding:model-changed', {
        oldModel: this.config.model,
        newModel: newConfig.model,
      });
    }
  }

  /**
   * Test OpenAI connection
   */
  @Retry({
    attempts: 3,
    delay: 1000,
    backoff: 'exponential',
  })
  private async testConnection(): Promise<void> {
    try {
      await this.openai.embeddings.create({
        model: this.config.model,
        input: 'test',
        dimensions: this.config.dimensions,
      });
      logger.info('OpenAI connection test successful');
    } catch (error) {
      logger.error('OpenAI connection test failed:', error);
      throw error;
    }
  }

  /**
   * Health check for OpenAI API
   */
  @HealthCheck({
    name: 'embedding:api',
    critical: true,
    interval: 60000,
    timeout: 5000,
  })
  async checkAPI(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const start = Date.now();
      await this.openai.embeddings.create({
        model: this.config.model,
        input: 'health check',
        dimensions: this.config.dimensions,
      });
      const latency = Date.now() - start;

      if (latency > 2000) {
        return {
          status: 'unhealthy',
          message: `OpenAI API latency too high: ${latency}ms`,
        };
      }

      return {
        status: 'healthy',
        message: `OpenAI API healthy (latency: ${latency}ms)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `OpenAI API check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Generate embedding for text
   */
  @Metric({ name: 'embedding.generate', recordDuration: true })
  @RateLimit({ 
    window: 60000, 
    max: (service: EmbeddingService) => service.config.rateLimits.requestsPerMinute 
  })
  @TokenUsage({
    model: 'text-embedding-3-small',
    costPerToken: 0.00002,
    warnThreshold: 10000,
    errorThreshold: 50000,
  })
  @EmbeddingCache({ ttl: 3600, maxSize: 10000 })
  @ModelFallback({
    primary: 'text-embedding-3-small',
    fallbacks: ['text-embedding-ada-002'],
    fallbackOn: (error) => error.message.includes('model_not_found'),
  })
  async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult> {
    const model = options.model || this.config.model;
    const dimensions = options.dimensions || this.config.dimensions;
    const start = Date.now();

    try {
      const response = await this.openai.embeddings.create({
        model,
        input: text,
        dimensions,
        user: options.user,
      });

      const embedding = response.data[0]?.embedding || [];
      const usage = response.usage ? {
        prompt: response.usage.prompt_tokens,
        completion: 0,
        total: response.usage.total_tokens,
      } : undefined;

      this.embeddingCount++;
      if (usage) {
        this.tokenCount += usage.total;
      }

      const result: EmbeddingResult = {
        embedding,
        model,
        dimensions,
        usage,
      };

      this.emit('embedding:generated', {
        text,
        model,
        dimension: dimensions,
        duration: Date.now() - start,
        tokens: usage?.total,
      });

      return result;
    } catch (error) {
      this.errorCount++;
      this.emit('embedding:error', {
        error: error as Error,
        text,
      });
      throw error;
    }
  }

  /**
   * Batch generate embeddings
   */
  @Metric({ name: 'embedding.batch-generate', recordDuration: true })
  @AIPerformance({
    operation: 'batch-embedding',
    trackMemory: true,
    trackLatency: true,
  })
  async batchGenerateEmbeddings(
    requests: BatchEmbeddingRequest[],
    options: EmbeddingOptions = {}
  ): Promise<Map<string, EmbeddingResult>> {
    const results = new Map<string, EmbeddingResult>();
    const batches = this.batchRequests(requests, this.config.batchSize);
    const start = Date.now();
    let totalTokens = 0;

    for (const batch of batches) {
      const texts = batch.map(r => r.text);
      
      try {
        const response = await this.openai.embeddings.create({
          model: options.model || this.config.model,
          input: texts,
          dimensions: options.dimensions || this.config.dimensions,
        });

        // Map results back to IDs
        batch.forEach((request, index) => {
          const embedding = response.data[index]?.embedding || [];
          results.set(request.id, {
            embedding,
            model: response.model,
            dimensions: this.config.dimensions,
          });
        });

        if (response.usage) {
          totalTokens += response.usage.total_tokens;
        }
      } catch (error) {
        logger.error('Batch embedding failed:', error);
        // Try individual embeddings for failed batch
        for (const request of batch) {
          try {
            const result = await this.generateEmbedding(request.text, options);
            results.set(request.id, result);
          } catch (individualError) {
            logger.error(`Failed to generate embedding for ${request.id}:`, individualError);
          }
        }
      }
    }

    this.emit('embedding:batch-generated', {
      count: requests.length,
      model: options.model || this.config.model,
      duration: Date.now() - start,
      totalTokens,
    });

    return results;
  }

  /**
   * Embed and store in vector database
   */
  @Metric({ name: 'embedding.embed-and-store', recordDuration: true })
  async embedAndStore(
    entityType: string,
    entityId: string,
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<Embedding> {
    // Generate embedding
    const { embedding, model, dimensions } = await this.generateEmbedding(content);

    // Get Prisma client
    const prisma = this.prismaService.getClient();

    // Store in database
    const embeddingRecord = await prisma.embedding.upsert({
      where: {
        entityType_entityId: {
          entityType,
          entityId,
        },
      },
      update: {
        content,
        embedding,
        model,
        dimensions,
      },
      create: {
        entityType,
        entityId,
        content,
        embedding,
        model,
        dimensions,
      },
    });

    // Store in vector database
    await this.vectorStore.upsert(entityType + 's', [{
      id: entityId,
      vector: embedding,
      payload: {
        entityType,
        entityId,
        content,
        ...metadata,
      },
    }]);

    logger.info(`Stored embedding for ${entityType}:${entityId}`);

    return embeddingRecord;
  }

  /**
   * Search for similar embeddings
   */
  @Metric({ name: 'embedding.search-similar', recordDuration: true })
  async searchSimilar(
    entityType: string,
    query: string,
    limit: number = 10,
    filter?: Record<string, any>
  ): Promise<EmbeddingSearchResult[]> {
    // Generate query embedding
    const { embedding } = await this.generateEmbedding(query);

    // Search in vector database
    const results = await this.vectorStore.search(
      entityType + 's',
      embedding,
      { limit, filter }
    );

    return results.map(result => ({
      id: result.id,
      score: result.score,
      content: result.payload.content as string,
      metadata: result.payload,
    }));
  }

  /**
   * Update existing embedding
   */
  async updateEmbedding(
    entityType: string,
    entityId: string,
    newContent: string,
    metadata: Record<string, any> = {}
  ): Promise<Embedding> {
    return this.embedAndStore(entityType, entityId, newContent, metadata);
  }

  /**
   * Delete embedding
   */
  @Metric({ name: 'embedding.delete', recordDuration: true })
  async deleteEmbedding(
    entityType: string,
    entityId: string
  ): Promise<void> {
    const prisma = this.prismaService.getClient();

    // Delete from database
    await prisma.embedding.delete({
      where: {
        entityType_entityId: {
          entityType,
          entityId,
        },
      },
    });

    // Delete from vector database
    await this.vectorStore.delete(entityType + 's', [entityId]);

    logger.info(`Deleted embedding for ${entityType}:${entityId}`);
  }

  /**
   * Embed todo with metadata
   */
  async embedTodo(
    todoId: string,
    title: string,
    userId: string,
    status: PrismaTodoStatus,
    priority: PrismaPriority | null
  ): Promise<Embedding> {
    const content = `Todo: ${title}`;
    const metadata = {
      userId,
      status,
      priority,
      type: 'todo',
    };

    return this.embedAndStore('todo', todoId, content, metadata);
  }

  /**
   * Embed todo list with metadata
   */
  async embedTodoList(
    todoListId: string,
    title: string,
    userId: string
  ): Promise<Embedding> {
    const content = `Todo List: ${title}`;
    const metadata = {
      userId,
      type: 'todoList',
    };

    return this.embedAndStore('todoList', todoListId, content, metadata);
  }

  /**
   * Find similar todos for user
   */
  async findSimilarTodos(
    query: string,
    userId: string,
    limit: number = 10
  ): Promise<EmbeddingSearchResult[]> {
    return this.searchSimilar('todo', query, limit, {
      must: [{ key: 'userId', match: { value: userId } }],
    });
  }

  /**
   * Find similar todo lists for user
   */
  async findSimilarTodoLists(
    query: string,
    userId: string,
    limit: number = 10
  ): Promise<EmbeddingSearchResult[]> {
    return this.searchSimilar('todoList', query, limit, {
      must: [{ key: 'userId', match: { value: userId } }],
    });
  }

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgTokensPerEmbedding = this.embeddingCount > 0
      ? Math.round(this.tokenCount / this.embeddingCount)
      : 0;
    const cacheHitRate = (this.cacheHits + this.cacheMisses) > 0
      ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(2) + '%'
      : '0%';

    return {
      embeddingCount: this.embeddingCount,
      tokenCount: this.tokenCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate,
      errorCount: this.errorCount,
      avgTokensPerEmbedding,
      estimatedCost: this.config.costTracking.enabled
        ? (this.tokenCount * this.config.costTracking.costPerToken).toFixed(4)
        : 'N/A',
      uptime,
    };
  }

  /**
   * Check rate limits
   */
  @HealthCheck({
    name: 'embedding:rate-limits',
    critical: false,
    interval: 30000,
  })
  async checkRateLimits(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const stats = this.getStats();
    const requestsPerMinute = (this.embeddingCount / (stats.uptime / 60000));
    
    if (requestsPerMinute > this.config.rateLimits.requestsPerMinute * 0.8) {
      return {
        status: 'degraded',
        message: `Approaching rate limit: ${requestsPerMinute.toFixed(0)} rpm`,
      };
    }

    return {
      status: 'healthy',
      message: `Rate limits healthy: ${requestsPerMinute.toFixed(0)} rpm`,
    };
  }

  /**
   * Private helper methods
   */

  private batchRequests<T>(requests: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < requests.length; i += batchSize) {
      batches.push(requests.slice(i, i + batchSize));
    }
    return batches;
  }

  private startMonitoring(): void {
    // Periodic metrics reporting
    setInterval(() => {
      const stats = this.getStats();
      
      // Update metrics
      this.recordMetric('embedding.total', this.embeddingCount);
      this.recordMetric('embedding.tokens.total', this.tokenCount);
      this.recordMetric('embedding.cache.hits', this.cacheHits);
      this.recordMetric('embedding.cache.misses', this.cacheMisses);
      this.recordMetric('embedding.errors.total', this.errorCount);
      
      if (this.config.costTracking.enabled) {
        const cost = this.tokenCount * this.config.costTracking.costPerToken;
        this.recordMetric('embedding.cost.total', cost);
      }
    }, 60000); // Every minute
  }
}