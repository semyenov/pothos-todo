import { OpenAI } from 'openai';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { RAGServiceEventMap } from '../core/ServiceEventMaps.ai.js';
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
  RAGContext as RAGContextDecorator,
  AIPerformance,
  ModelFallback,
  AIWorkflow 
} from '../core/decorators/AIServiceDecorators.js';
import { EmbeddingService } from './EmbeddingService.new.js';
import { VectorStore } from './VectorStore.new.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * RAG service configuration schema
 */
const RAGConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().default(0.3),
  maxTokens: z.number().default(500),
  fallbackModels: z.array(z.string()).default(['gpt-3.5-turbo']),
  retrieval: z.object({
    maxContextItems: z.number().default(5),
    relevanceThreshold: z.number().default(0.7),
    includeCompleted: z.boolean().default(false),
    reranking: z.boolean().default(true),
  }),
  generation: z.object({
    temperature: z.number().default(0.3),
    maxContextLength: z.number().default(4000),
    citationStyle: z.enum(['numbered', 'inline', 'footnote']).default('numbered'),
  }),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(600), // 10 minutes
    maxSize: z.number().default(500),
  }),
  costTracking: z.object({
    enabled: z.boolean().default(true),
    costPerInputToken: z.number().default(0.00015),
    costPerOutputToken: z.number().default(0.0006),
  }),
});

export type RAGConfig = z.infer<typeof RAGConfigSchema>;

/**
 * RAG query context
 */
export interface RAGContext {
  query: string;
  userId: string;
  maxContextItems?: number;
  includeCompleted?: boolean;
  filters?: {
    priority?: string[];
    status?: string[];
    tags?: string[];
    dateRange?: [Date, Date];
  };
  metadata?: Record<string, any>;
}

/**
 * RAG response
 */
export interface RAGResponse {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    relevanceScore: number;
    content?: string;
    metadata?: Record<string, any>;
  }>;
  confidence: number;
  citations?: string[];
  usage?: {
    retrievalTime: number;
    generationTime: number;
    totalTokens: number;
  };
}

/**
 * Knowledge item for indexing
 */
export interface KnowledgeItem {
  id: string;
  content: string;
  metadata: Record<string, any>;
  type: 'todo' | 'todoList' | 'note' | 'document';
}

/**
 * Insight generation result
 */
export interface UserInsights {
  productivity: string;
  patterns: string[];
  recommendations: string[];
  trends: Array<{
    metric: string;
    value: number;
    change: 'increasing' | 'decreasing' | 'stable';
  }>;
}

/**
 * Task explanation result
 */
export interface TaskExplanation {
  explanation: string;
  breakdown: string[];
  estimatedTime: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prerequisites?: string[];
  resources?: string[];
}

/**
 * Enhanced RAG Service using the new base service architecture
 * 
 * Features:
 * - Retrieval-augmented generation with semantic search
 * - Knowledge indexing and management
 * - Citation and source attribution
 * - Context building with relevance scoring
 * - Multi-stage RAG pipeline
 * - Performance monitoring and optimization
 * 
 * @example
 * ```typescript
 * const ragService = await RAGService.getInstance();
 * 
 * // Listen to RAG events
 * ragService.on('rag:answer-generated', ({ query, answer, confidence }) => {
 *   console.log(`Generated answer with ${confidence} confidence`);
 * });
 * 
 * // Query with context
 * const response = await ragService.queryWithContext({
 *   query: "What high priority tasks do I have this week?",
 *   userId: "user-123",
 *   maxContextItems: 10
 * });
 * 
 * // Generate insights
 * const insights = await ragService.generateInsights("user-123");
 * ```
 */
@ServiceConfig({
  schema: RAGConfigSchema,
  prefix: 'rag',
  hot: true, // Allow hot reload for API key changes
})
export class RAGService extends BaseAsyncService<RAGConfig, RAGServiceEventMap> {
  private openai!: OpenAI;
  private embeddingService!: EmbeddingService;
  private vectorStore!: VectorStore;
  private queryCount = 0;
  private insightCount = 0;
  private errorCount = 0;
  private totalTokensUsed = 0;
  private knowledgeCache = new Map<string, any>();

  /**
   * Get the singleton instance
   */
  static override async getInstance(): Promise<RAGService> {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'rag-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Retrieval-Augmented Generation service for intelligent query answering';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('RAGService initializing with config:', {
      model: this.config.model,
      maxContextItems: this.config.retrieval.maxContextItems,
      caching: this.config.caching.enabled,
    });

    // Get dependencies
    this.embeddingService = EmbeddingService.getInstance();
    this.vectorStore = await VectorStore.getInstance();
  }

  /**
   * Start the service
   */
  protected override async onStart(): Promise<void> {
    // Create OpenAI client as a tracked resource
    this.openai = this.createResource({
      resource: new OpenAI({ 
        apiKey: this.config.apiKey,
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
    this.knowledgeCache.clear();
    logger.info('RAGService stopped');
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: RAGConfig): Promise<void> {
    if (newConfig.apiKey !== this.config.apiKey) {
      logger.info('API key changed, recreating OpenAI client');
      
      await this.disposeResource(this.openai);
      
      this.openai = this.createResource({
        resource: new OpenAI({ 
          apiKey: newConfig.apiKey,
        }),
        dispose: async () => {
          logger.info('OpenAI client disposed');
        },
      } as any);
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
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      });
      logger.info('OpenAI connection test successful');
    } catch (error) {
      logger.error('OpenAI connection test failed:', error);
      throw error;
    }
  }

  /**
   * Health check for RAG service
   */
  @HealthCheck({
    name: 'rag:service',
    critical: true,
    interval: 60000,
    timeout: 10000,
  })
  async checkService(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Test retrieval
      const start = Date.now();
      const testQuery = await this.embeddingService.generateEmbedding('test query');
      
      // Test generation
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      });

      const duration = Date.now() - start;

      if (duration > 5000) {
        return {
          status: 'unhealthy',
          message: `RAG service latency too high: ${duration}ms`,
        };
      }

      return {
        status: 'healthy',
        message: `RAG service healthy (latency: ${duration}ms)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `RAG service check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Query with context using RAG pipeline
   */
  @Metric({ name: 'rag.query', recordDuration: true })
  @RateLimit({ window: 60000, max: 30 })
  @Cache({ ttl: 600, maxSize: 500, keyGenerator: (args) => `${args[0].query}:${args[0].userId}` })
  @TokenUsage({
    model: 'gpt-4o-mini',
    costPerToken: 0.00015,
  })
  @RAGContextDecorator({
    maxContextLength: 4000,
    relevanceThreshold: 0.7,
    includeSources: true,
  })
  @AIWorkflow({
    name: 'rag-query',
    steps: ['retrieve', 'rerank', 'generate', 'cite'],
  })
  async queryWithContext(context: RAGContext): Promise<RAGResponse> {
    const start = Date.now();
    let retrievalTime = 0;
    let generationTime = 0;

    try {
      // Step 1: Retrieve relevant documents
      const retrievalStart = Date.now();
      const relevantDocs = await this.retrieveRelevantDocuments(context);
      retrievalTime = Date.now() - retrievalStart;

      if (relevantDocs.length === 0) {
        return {
          answer: "I couldn't find any relevant information to answer your question. Try adding more tasks or rephrasing your query.",
          sources: [],
          confidence: 0.3,
          usage: {
            retrievalTime,
            generationTime: 0,
            totalTokens: 0,
          },
        };
      }

      this.emit('rag:query-processed', {
        query: context.query,
        documentsRetrieved: relevantDocs.length,
        relevanceScores: relevantDocs.map(d => d.score),
      });

      // Step 2: Build context
      const contextText = this.buildContext(relevantDocs, context.query);
      
      this.emit('rag:context-built', {
        query: context.query,
        contextLength: contextText.length,
        sources: relevantDocs.map(d => d.id),
      });

      // Step 3: Generate response
      const generationStart = Date.now();
      const response = await this.generateResponse(
        context.query,
        contextText,
        relevantDocs,
        context.metadata
      );
      generationTime = Date.now() - generationStart;

      this.queryCount++;
      this.totalTokensUsed += response.usage?.totalTokens || 0;

      this.emit('rag:answer-generated', {
        query: context.query,
        answer: response.answer,
        confidence: response.confidence,
        citations: response.citations || [],
      });

      return {
        ...response,
        usage: {
          retrievalTime,
          generationTime,
          totalTokens: response.usage?.totalTokens || 0,
        },
      };
    } catch (error) {
      this.errorCount++;
      this.emit('rag:error', {
        error: error as Error,
        stage: 'retrieval',
      });
      throw new Error('Failed to process your query. Please try again.');
    }
  }

  /**
   * Generate user insights from their data
   */
  @Metric({ name: 'rag.insights', recordDuration: true })
  @AIPerformance({
    operation: 'generate-insights',
    trackMemory: true,
    trackLatency: true,
  })
  async generateInsights(userId: string): Promise<UserInsights> {
    try {
      // Get user's recent activity
      const todos = await this.embeddingService.findSimilarTodos(
        'productivity analysis tasks',
        userId,
        50
      );

      const todosSummary = todos.map(t => ({
        title: t.content,
        metadata: t.metadata,
      }));

      const systemPrompt = `You are a productivity analyst. Analyze the user's todo list and provide comprehensive insights.
Return a JSON object with:
- productivity: A brief assessment of their productivity level and working style
- patterns: Array of 3-5 observed patterns in their tasks and behavior
- recommendations: Array of 3-5 actionable recommendations for improvement
- trends: Array of metrics with their direction (increasing/decreasing/stable)

Focus on actionable insights that can help improve productivity.`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: `Analyze these tasks and provide insights: ${JSON.stringify(todosSummary)}` 
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 600,
      });

      const insights = JSON.parse(response.choices[0]?.message?.content || '{}');
      this.insightCount++;

      return {
        productivity: insights.productivity || 'Unable to assess productivity',
        patterns: insights.patterns || [],
        recommendations: insights.recommendations || [],
        trends: insights.trends || [],
      };
    } catch (error) {
      logger.error('Failed to generate insights', { error, userId });
      return {
        productivity: 'Unable to analyze productivity',
        patterns: [],
        recommendations: [],
        trends: [],
      };
    }
  }

  /**
   * Explain a specific task in detail
   */
  @Metric({ name: 'rag.explain-task', recordDuration: true })
  async explainTask(todoId: string, userId: string): Promise<TaskExplanation> {
    try {
      // Get the specific todo and related tasks
      const todo = await this.embeddingService.findSimilarTodos(todoId, userId, 1);
      const todoContent = todo[0]?.content || '';
      
      if (!todo.length) {
        throw new Error('Task not found');
      }

      // Get related tasks for context
      const relatedTodos = await this.embeddingService.findSimilarTodos(
        todoContent,
        userId,
        5
      );

      const systemPrompt = `You are a task analysis expert. Analyze the given task and provide detailed breakdown.
Return a JSON object with:
- explanation: Clear explanation of what the task involves
- breakdown: Array of 3-7 specific subtasks or steps to complete it
- estimatedTime: Realistic time estimate (e.g., "30 minutes", "2 hours", "1 day")
- difficulty: Task difficulty assessment (easy, medium, hard)
- prerequisites: Array of things needed before starting (optional)
- resources: Array of helpful resources or tools (optional)

Be specific and actionable in your analysis.`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Main task: ${todoContent}\n\nRelated tasks for context: ${relatedTodos.map(t => t.content).join(', ')}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 500,
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        explanation: analysis.explanation || 'Unable to analyze task',
        breakdown: analysis.breakdown || [],
        estimatedTime: analysis.estimatedTime || 'Unknown',
        difficulty: analysis.difficulty || 'medium',
        prerequisites: analysis.prerequisites,
        resources: analysis.resources,
      };
    } catch (error) {
      logger.error('Failed to explain task', { error, todoId, userId });
      return {
        explanation: 'Unable to analyze this task',
        breakdown: [],
        estimatedTime: 'Unknown',
        difficulty: 'medium',
      };
    }
  }

  /**
   * Index knowledge items for retrieval
   */
  @Metric({ name: 'rag.index-knowledge', recordDuration: true })
  async indexKnowledge(items: KnowledgeItem[]): Promise<void> {
    const batchSize = 10;
    const batches = this.batchItems(items, batchSize);
    let totalIndexed = 0;

    for (const batch of batches) {
      const embeddings = await this.embeddingService.batchGenerateEmbeddings(
        batch.map(item => ({
          id: item.id,
          text: item.content,
          metadata: item.metadata,
        }))
      );

      // Store in vector database
      const vectorDocs = batch.map(item => ({
        id: item.id,
        vector: embeddings.get(item.id)?.embedding || [],
        payload: {
          content: item.content,
          type: item.type,
          ...item.metadata,
        },
      })).filter(doc => doc.vector.length > 0);

      await this.vectorStore.upsert('knowledge', vectorDocs);
      totalIndexed += vectorDocs.length;
    }

    this.emit('rag:knowledge-indexed', {
      documents: items.length,
      chunks: totalIndexed,
      duration: Date.now(),
    });

    logger.info(`Indexed ${totalIndexed} knowledge items`);
  }

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgTokensPerQuery = this.queryCount > 0
      ? Math.round(this.totalTokensUsed / this.queryCount)
      : 0;

    return {
      queryCount: this.queryCount,
      insightCount: this.insightCount,
      errorCount: this.errorCount,
      totalTokensUsed: this.totalTokensUsed,
      avgTokensPerQuery,
      cacheSize: this.knowledgeCache.size,
      estimatedCost: this.config.costTracking.enabled
        ? (this.totalTokensUsed * this.config.costTracking.costPerInputToken).toFixed(4)
        : 'N/A',
      uptime,
      errorRate: this.queryCount > 0
        ? (this.errorCount / this.queryCount * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Private helper methods
   */

  private async retrieveRelevantDocuments(context: RAGContext) {
    // Generate query embedding
    const queryEmbedding = await this.embeddingService.generateEmbedding(context.query);

    // Search in todos
    const todoResults = await this.embeddingService.findSimilarTodos(
      context.query,
      context.userId,
      context.maxContextItems || this.config.retrieval.maxContextItems
    );

    // Apply filters if provided
    let filteredResults = todoResults;
    if (context.filters) {
      filteredResults = this.applyFilters(todoResults, context.filters);
    }

    // Filter by relevance threshold
    return filteredResults.filter(
      doc => doc.score >= this.config.retrieval.relevanceThreshold
    );
  }

  private applyFilters(docs: any[], filters: NonNullable<RAGContext['filters']>) {
    return docs.filter(doc => {
      if (filters.priority && !filters.priority.includes(doc.metadata.priority)) {
        return false;
      }
      if (filters.status && !filters.status.includes(doc.metadata.status)) {
        return false;
      }
      if (filters.tags && filters.tags.length > 0) {
        const docTags = doc.metadata.tags || [];
        if (!filters.tags.some(tag => docTags.includes(tag))) {
          return false;
        }
      }
      return true;
    });
  }

  private buildContext(docs: any[], query: string): string {
    // Sort by relevance score
    const sortedDocs = docs.sort((a, b) => b.score - a.score);
    
    // Build context with citations
    const contextParts = sortedDocs.map((doc, index) => {
      const citation = this.generateCitation(doc, index + 1);
      return `${citation}: ${doc.content}`;
    });

    return contextParts.join('\n\n');
  }

  private generateCitation(doc: any, index: number): string {
    switch (this.config.generation.citationStyle) {
      case 'numbered':
        return `[${index}]`;
      case 'inline':
        return `(${doc.metadata.type}: ${doc.id})`;
      case 'footnote':
        return `^${index}`;
      default:
        return `[${index}]`;
    }
  }

  private async generateResponse(
    query: string,
    context: string,
    sources: any[],
    metadata?: Record<string, any>
  ): Promise<RAGResponse> {
    const systemPrompt = `You are a helpful task management assistant. Answer questions about the user's tasks based on the provided context.

Guidelines:
- Be concise but informative
- Always base your answers on the provided context
- Include specific references to tasks when relevant
- If the context doesn't contain enough information, say so clearly
- Use the citation numbers in your response when referencing specific tasks
- Provide actionable insights when appropriate`;

    const userPrompt = `Context (User's Tasks):\n${context}\n\nQuestion: ${query}`;

    const response = await this.openai.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: this.config.generation.temperature,
      max_tokens: this.config.maxTokens,
    });

    const answer = response.choices[0]?.message?.content || 'Unable to generate response';

    // Calculate confidence based on source relevance and response quality
    const avgScore = sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
    const responseLength = answer.length;
    const confidenceBoost = responseLength > 50 ? 0.1 : 0; // Boost for longer responses
    const confidence = Math.min(avgScore + confidenceBoost, 1);

    // Extract citations from answer
    const citationRegex = /\[(\d+)\]/g;
    const citations = [...answer.matchAll(citationRegex)].map(match => match[1]);

    return {
      answer,
      sources: sources.slice(0, 5).map((s, index) => ({
        id: s.id,
        title: s.content,
        relevanceScore: s.score,
        content: s.content,
        metadata: s.metadata,
      })),
      confidence,
      citations,
      usage: {
        retrievalTime: 0, // Will be set by caller
        generationTime: 0, // Will be set by caller
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }

  private batchItems<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private startMonitoring(): void {
    // Periodic metrics reporting
    setInterval(() => {
      const stats = this.getStats();
      
      // Update metrics
      this.recordMetric('rag.queries.total', this.queryCount);
      this.recordMetric('rag.insights.total', this.insightCount);
      this.recordMetric('rag.tokens.total', this.totalTokensUsed);
      this.recordMetric('rag.errors.total', this.errorCount);
      
      if (this.config.costTracking.enabled) {
        const cost = this.totalTokensUsed * this.config.costTracking.costPerInputToken;
        this.recordMetric('rag.cost.total', cost);
      }
    }, 60000); // Every minute
  }
}