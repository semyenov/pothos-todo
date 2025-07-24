import { OpenAI } from 'openai';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { MLPredictionServiceEventMap } from '../core/ServiceEventMaps.ai.js';
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
  AIPerformance,
  ModelFallback,
  AIMonitored 
} from '../core/decorators/AIServiceDecorators.js';
import { PrismaService } from '../database/PrismaService.new.js';
import type { Todo } from '@prisma/client';
import { logger } from '@/lib/unjs-utils.js';

/**
 * ML Prediction service configuration schema
 */
const MLPredictionConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().default(0.3),
  maxTokens: z.number().default(300),
  fallbackModels: z.array(z.string()).default(['gpt-3.5-turbo']),
  predictions: z.object({
    maxHistoricalTodos: z.number().default(50),
    confidenceThreshold: z.number().default(0.6),
    defaultEstimateHours: z.number().default(2),
    complexityFactors: z.array(z.string()).default([
      'technical_requirements',
      'coordination_needed',
      'research_required',
      'creative_work',
      'routine_task'
    ]),
  }),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(1800), // 30 minutes
    maxSize: z.number().default(1000),
  }),
  costTracking: z.object({
    enabled: z.boolean().default(true),
    costPerInputToken: z.number().default(0.00015),
    costPerOutputToken: z.number().default(0.0006),
  }),
});

export type MLPredictionConfig = z.infer<typeof MLPredictionConfigSchema>;

/**
 * Completion time prediction result
 */
export interface CompletionTimePrediction {
  estimatedHours: number;
  confidence: number;
  factors: string[];
  breakdown?: {
    planning: number;
    execution: number;
    review: number;
  };
  historicalBasis?: {
    similarTasks: number;
    avgTimeForPriority: number;
    userProductivityFactor: number;
  };
}

/**
 * Priority suggestion result
 */
export interface PrioritySuggestion {
  suggestedPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  reasoning: string;
  confidence: number;
  alternatives?: Array<{
    priority: string;
    confidence: number;
    reasoning: string;
  }>;
}

/**
 * Task complexity analysis result
 */
export interface TaskComplexityAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  complexityScore: number; // 0-10 scale
  requiredSkills: string[];
  dependencies: string[];
  risks: string[];
  timeComponents: {
    research: number;
    planning: number;
    execution: number;
    testing: number;
    documentation: number;
  };
}

/**
 * Next actions prediction
 */
export interface NextActionsPrediction {
  suggestedNextTasks: Array<{
    title: string;
    priority: string;
    category: string;
    reasoning: string;
  }>;
  reasoning: string;
  contextFactors: string[];
  timeOptimal: boolean; // Whether this is a good time for these tasks
}

/**
 * User productivity insights
 */
export interface ProductivityInsights {
  currentPace: 'slow' | 'normal' | 'fast';
  optimalWorkingHours: [number, number];
  mostProductiveDays: string[];
  taskCompletionPatterns: {
    avgTimeByPriority: Record<string, number>;
    completionRateByDay: Record<string, number>;
    mostCommonTags: string[];
  };
  recommendations: string[];
}

/**
 * Enhanced ML Prediction Service using the new base service architecture
 * 
 * Features:
 * - Time estimation with historical analysis
 * - Priority suggestions based on user patterns
 * - Task complexity analysis with risk assessment
 * - Next action predictions with context awareness
 * - Productivity insights and optimization
 * - Model performance tracking and optimization
 * 
 * @example
 * ```typescript
 * const mlService = MLPredictionService.getInstance();
 * 
 * // Listen to prediction events
 * mlService.on('ml:prediction-made', ({ model, confidence, duration }) => {
 *   console.log(`Prediction made with ${confidence} confidence in ${duration}ms`);
 * });
 * 
 * // Predict completion time
 * const prediction = await mlService.predictCompletionTime('todo-123', 'user-456');
 * 
 * // Suggest priority
 * const priority = await mlService.suggestPriority('New task', 'Description', 'user-456');
 * ```
 */
@ServiceConfig({
  schema: MLPredictionConfigSchema,
  prefix: 'ml-prediction',
  hot: true, // Allow hot reload for API key changes
})
export class MLPredictionService extends BaseService<MLPredictionConfig, MLPredictionServiceEventMap> {
  private openai!: OpenAI;
  private prismaService!: PrismaService;
  private predictionCount = 0;
  private errorCount = 0;
  private totalTokensUsed = 0;
  private modelPerformanceCache = new Map<string, { accuracy: number; latency: number }>();

  /**
   * Get the singleton instance
   */
  static override getInstance(): MLPredictionService {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'ml-prediction-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Machine Learning service for task predictions and productivity insights';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('MLPredictionService initializing with config:', {
      model: this.config.model,
      maxHistoricalTodos: this.config.predictions.maxHistoricalTodos,
      caching: this.config.caching.enabled,
    });

    // Get dependencies
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
    this.modelPerformanceCache.clear();
    logger.info('MLPredictionService stopped');
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: MLPredictionConfig): Promise<void> {
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
   * Health check for ML service
   */
  @HealthCheck({
    name: 'ml:service',
    critical: true,
    interval: 60000,
    timeout: 5000,
  })
  async checkService(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const start = Date.now();
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'health check' }],
        max_tokens: 5,
      });
      const latency = Date.now() - start;

      if (latency > 3000) {
        return {
          status: 'unhealthy',
          message: `ML service latency too high: ${latency}ms`,
        };
      }

      return {
        status: 'healthy',
        message: `ML service healthy (latency: ${latency}ms)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `ML service check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Predict task completion time
   */
  @Metric({ name: 'ml.predict-completion-time', recordDuration: true })
  @RateLimit({ window: 60000, max: 50 })
  @Cache({ ttl: 1800, maxSize: 1000, keyGenerator: (args) => `completion:${args[0]}:${args[1]}` })
  @TokenUsage({
    model: 'gpt-4o-mini',
    costPerToken: 0.00015,
  })
  @ModelFallback({
    primary: 'gpt-4o-mini',
    fallbacks: ['gpt-3.5-turbo'],
  })
  @AIPerformance({
    operation: 'predict-completion-time',
    trackLatency: true,
  })
  async predictCompletionTime(
    todoId: string,
    userId: string
  ): Promise<CompletionTimePrediction> {
    const start = Date.now();

    try {
      const prisma = this.prismaService.getClient();

      // Get the todo
      const todo = await prisma.todo.findFirst({
        where: { id: todoId, userId },
      });

      if (!todo) {
        throw new Error('Todo not found');
      }

      // Get historical data
      const completedTodos = await prisma.todo.findMany({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        take: this.config.predictions.maxHistoricalTodos,
      });

      const completionStats = this.calculateCompletionStats(completedTodos);
      const userProductivity = this.calculateUserProductivity(completedTodos);

      const systemPrompt = `You are a task time estimation expert with access to historical data. Provide accurate time estimates.

Return a JSON object with:
- estimatedHours: number (realistic estimate, e.g., 0.25, 0.5, 1, 2, 4, 8)
- confidence: number between 0 and 1
- factors: array of 3-5 factors affecting the estimate
- breakdown: object with planning, execution, review percentages that sum to 100

Consider complexity, user's historical performance, and task characteristics.`;

      const userPrompt = `Task: ${todo.title}
Description: ${todo.description || 'No description'}
Priority: ${todo.priority}
Tags: ${todo.tags.join(', ') || 'None'}

Historical completion times by priority:
${JSON.stringify(completionStats, null, 2)}

User productivity factor: ${userProductivity.toFixed(2)} (1.0 = average)

Current time: ${new Date().toLocaleString()}
Day of week: ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });

      const prediction = JSON.parse(response.choices[0]?.message?.content || '{}');
      const duration = Date.now() - start;

      this.predictionCount++;
      this.totalTokensUsed += response.usage?.total_tokens || 0;

      const result: CompletionTimePrediction = {
        estimatedHours: prediction.estimatedHours || this.config.predictions.defaultEstimateHours,
        confidence: prediction.confidence || 0.5,
        factors: prediction.factors || ['Limited historical data'],
        breakdown: prediction.breakdown || {
          planning: 20,
          execution: 70,
          review: 10,
        },
        historicalBasis: {
          similarTasks: completedTodos.length,
          avgTimeForPriority: completionStats[todo.priority] || 0,
          userProductivityFactor: userProductivity,
        },
      };

      this.emit('ml:prediction-made', {
        model: this.config.model,
        input: { todoId, userId },
        output: result,
        confidence: result.confidence,
        duration,
      });

      return result;
    } catch (error) {
      this.errorCount++;
      this.emit('ml:error', {
        error: error as Error,
        model: this.config.model,
      });

      return {
        estimatedHours: this.config.predictions.defaultEstimateHours,
        confidence: 0.3,
        factors: ['Error during prediction'],
      };
    }
  }

  /**
   * Suggest priority for a new task
   */
  @Metric({ name: 'ml.suggest-priority', recordDuration: true })
  @Cache({ ttl: 900, maxSize: 500 })
  @AIMonitored({
    operation: 'suggest-priority',
    performanceTracking: true,
  })
  async suggestPriority(
    title: string,
    description: string | null,
    userId: string
  ): Promise<PrioritySuggestion> {
    try {
      const prisma = this.prismaService.getClient();

      // Get user's historical priority patterns
      const userTodos = await prisma.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          title: true,
          priority: true,
          tags: true,
          status: true,
          completedAt: true,
        },
      });

      const priorityPatterns = this.analyzePriorityPatterns(userTodos);
      const urgentKeywords = this.extractKeywords(
        userTodos.filter(t => t.priority === 'HIGH' || t.priority === 'URGENT')
      );

      const systemPrompt = `You are a task priority expert. Suggest appropriate priority based on content and user patterns.

Priority levels: LOW, MEDIUM, HIGH, URGENT

Return a JSON object with:
- suggestedPriority: one of the priority levels
- reasoning: clear explanation (2-3 sentences)
- confidence: number between 0 and 1
- alternatives: array of up to 2 alternative suggestions with confidence scores

Consider urgency indicators, deadlines, dependencies, and user's historical patterns.`;

      const userPrompt = `New task: ${title}
Description: ${description || 'No description'}

User's priority distribution:
${JSON.stringify(priorityPatterns, null, 2)}

Common keywords in user's high priority tasks: ${urgentKeywords}

Current context:
- Time: ${new Date().toLocaleString()}
- Day: ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}
- Pending high priority tasks: ${userTodos.filter(t => t.status === 'PENDING' && (t.priority === 'HIGH' || t.priority === 'URGENT')).length}`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 250,
      });

      const suggestion = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        suggestedPriority: suggestion.suggestedPriority || 'MEDIUM',
        reasoning: suggestion.reasoning || 'Based on task content and user patterns',
        confidence: suggestion.confidence || 0.6,
        alternatives: suggestion.alternatives || [],
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Failed to suggest priority', { error });
      return {
        suggestedPriority: 'MEDIUM',
        reasoning: 'Error during analysis, defaulting to medium priority',
        confidence: 0.3,
      };
    }
  }

  /**
   * Analyze task complexity
   */
  @Metric({ name: 'ml.analyze-complexity', recordDuration: true })
  @AIPerformance({
    operation: 'analyze-complexity',
    trackMemory: true,
  })
  async analyzeTaskComplexity(
    todoId: string,
    userId: string
  ): Promise<TaskComplexityAnalysis> {
    try {
      const prisma = this.prismaService.getClient();

      const todo = await prisma.todo.findFirst({
        where: { id: todoId, userId },
        include: { todoList: true },
      });

      if (!todo) {
        throw new Error('Todo not found');
      }

      // Get context from related todos
      const relatedTodos = todo.todoListId
        ? await prisma.todo.findMany({
            where: {
              todoListId: todo.todoListId,
              id: { not: todoId },
            },
            select: { title: true, status: true, priority: true },
          })
        : [];

      const systemPrompt = `You are a task complexity analyst. Analyze the task comprehensively.

Return a JSON object with:
- complexity: "simple", "moderate", or "complex"
- complexityScore: number from 0-10 (0=very simple, 10=extremely complex)
- requiredSkills: array of 2-5 specific skills needed
- dependencies: array of potential dependencies or blockers
- risks: array of 1-4 potential risks or challenges
- timeComponents: object with percentages for research, planning, execution, testing, documentation

Consider technical requirements, coordination needs, creative aspects, and potential obstacles.`;

      const userPrompt = `Task: ${todo.title}
Description: ${todo.description || 'No description'}
Priority: ${todo.priority}
List context: ${todo.todoList?.title || 'No list'}
Tags: ${todo.tags.join(', ') || 'None'}

Related tasks in the same context:
${relatedTodos.map(t => `- ${t.title} (${t.status}, ${t.priority})`).join('\n') || 'None'}

Complexity factors to consider: ${this.config.predictions.complexityFactors.join(', ')}`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 400,
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        complexity: analysis.complexity || 'moderate',
        complexityScore: analysis.complexityScore || 5,
        requiredSkills: analysis.requiredSkills || [],
        dependencies: analysis.dependencies || [],
        risks: analysis.risks || [],
        timeComponents: analysis.timeComponents || {
          research: 10,
          planning: 15,
          execution: 60,
          testing: 10,
          documentation: 5,
        },
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Failed to analyze task complexity', { error, todoId });
      return {
        complexity: 'moderate',
        complexityScore: 5,
        requiredSkills: [],
        dependencies: [],
        risks: ['Unable to analyze complexity'],
        timeComponents: {
          research: 10,
          planning: 15,
          execution: 60,
          testing: 10,
          documentation: 5,
        },
      };
    }
  }

  /**
   * Predict optimal next actions
   */
  @Metric({ name: 'ml.predict-next-actions', recordDuration: true })
  async predictNextActions(userId: string): Promise<NextActionsPrediction> {
    try {
      const prisma = this.prismaService.getClient();

      // Get comprehensive user context
      const recentTodos = await prisma.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          title: true,
          status: true,
          priority: true,
          completedAt: true,
          tags: true,
          createdAt: true,
        },
      });

      const now = new Date();
      const today = now.toDateString();
      const completedToday = recentTodos.filter(
        t => t.completedAt && t.completedAt.toDateString() === today
      );
      const pendingTasks = recentTodos.filter(t => t.status === 'PENDING');
      const currentHour = now.getHours();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

      const systemPrompt = `You are a productivity assistant that suggests optimal next actions based on context.

Return a JSON object with:
- suggestedNextTasks: array of 3-5 task suggestions, each with title, priority, category, reasoning
- reasoning: overall explanation for the suggestions
- contextFactors: array of key factors influencing the suggestions
- timeOptimal: boolean indicating if this is a good time for productivity

Consider current time, completed work, pending tasks, and optimal productivity patterns.`;

      const userPrompt = `Current context:
Time: ${now.toLocaleString()}
Day: ${dayOfWeek}
Hour: ${currentHour}

Today's activity:
- Completed: ${completedToday.length} tasks
- Completed task types: ${completedToday.map(t => t.title).join(', ') || 'None'}

Pending tasks (by priority):
- HIGH/URGENT: ${pendingTasks.filter(t => ['HIGH', 'URGENT'].includes(t.priority)).map(t => t.title).join(', ') || 'None'}
- MEDIUM: ${pendingTasks.filter(t => t.priority === 'MEDIUM').map(t => t.title).join(', ') || 'None'}
- LOW: ${pendingTasks.filter(t => t.priority === 'LOW').map(t => t.title).join(', ') || 'None'}

Common task categories: ${this.extractTags(recentTodos)}
Recent productivity: ${this.calculateRecentProductivity(recentTodos)} tasks/day avg`;

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 400,
      });

      const prediction = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        suggestedNextTasks: prediction.suggestedNextTasks || [],
        reasoning: prediction.reasoning || 'Based on your current context and task patterns',
        contextFactors: prediction.contextFactors || [],
        timeOptimal: prediction.timeOptimal ?? this.isOptimalWorkingTime(currentHour),
      };
    } catch (error) {
      this.errorCount++;
      logger.error('Failed to predict next actions', { error, userId });
      return {
        suggestedNextTasks: [],
        reasoning: 'Error during prediction',
        contextFactors: [],
        timeOptimal: false,
      };
    }
  }

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgTokensPerPrediction = this.predictionCount > 0
      ? Math.round(this.totalTokensUsed / this.predictionCount)
      : 0;

    return {
      predictionCount: this.predictionCount,
      errorCount: this.errorCount,
      totalTokensUsed: this.totalTokensUsed,
      avgTokensPerPrediction,
      estimatedCost: this.config.costTracking.enabled
        ? (this.totalTokensUsed * this.config.costTracking.costPerInputToken).toFixed(4)
        : 'N/A',
      uptime,
      errorRate: this.predictionCount > 0
        ? (this.errorCount / this.predictionCount * 100).toFixed(2) + '%'
        : '0%',
      modelPerformance: Object.fromEntries(this.modelPerformanceCache),
    };
  }

  /**
   * Private helper methods
   */

  private calculateCompletionStats(todos: Todo[]): Record<string, number> {
    const stats: Record<string, { total: number; count: number }> = {};

    for (const todo of todos) {
      if (todo.completedAt && todo.createdAt) {
        const hoursToComplete = 
          (todo.completedAt.getTime() - todo.createdAt.getTime()) / (1000 * 60 * 60);

        if (stats[todo.priority]) {
          stats[todo.priority]!.total += hoursToComplete;
          stats[todo.priority]!.count += 1;
        } else {
          stats[todo.priority] = { total: hoursToComplete, count: 1 };
        }
      }
    }

    const avgStats: Record<string, number> = {};
    for (const [priority, data] of Object.entries(stats)) {
      avgStats[priority] = data.count > 0 ? data.total / data.count : 0;
    }

    return avgStats;
  }

  private calculateUserProductivity(todos: Todo[]): number {
    if (todos.length === 0) return 1.0;

    const completionTimes = todos
      .filter(t => t.completedAt && t.createdAt)
      .map(t => (t.completedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));

    if (completionTimes.length === 0) return 1.0;

    const avgTime = completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length;
    
    // Compare to baseline (assuming 3 hours average)
    const baseline = 3;
    return baseline / Math.max(avgTime, 0.5); // Productivity factor
  }

  private analyzePriorityPatterns(todos: Array<{ priority: string }>): Record<string, number> {
    const counts: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      URGENT: 0,
    };

    for (const todo of todos) {
      counts[todo.priority] = (counts[todo.priority] || 0) + 1;
    }

    const total = todos.length;
    const percentages: Record<string, number> = {};

    for (const [priority, count] of Object.entries(counts)) {
      percentages[priority] = total > 0 ? (count / total) * 100 : 0;
    }

    return percentages;
  }

  private extractKeywords(todos: Array<{ title: string; tags: string[] }>): string {
    const words: Record<string, number> = {};
    const allTags = todos.flatMap(t => t.tags);

    for (const todo of todos) {
      const titleWords = todo.title.toLowerCase().split(/\s+/);
      for (const word of [...titleWords, ...allTags]) {
        if (word.length > 3) {
          words[word] = (words[word] || 0) + 1;
        }
      }
    }

    return Object.entries(words)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([word]) => word)
      .join(', ');
  }

  private extractTags(todos: Array<{ tags: string[] }>): string {
    const tags = todos.flatMap(t => t.tags);
    const tagCounts: Record<string, number> = {};

    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }

    return Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag)
      .join(', ');
  }

  private calculateRecentProductivity(todos: Array<{ completedAt: Date | null }>): number {
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCompleted = todos.filter(
      t => t.completedAt && t.completedAt >= last7Days
    );
    return Math.round((recentCompleted.length / 7) * 10) / 10;
  }

  private isOptimalWorkingTime(hour: number): boolean {
    // Most people are productive between 9 AM and 5 PM
    return hour >= 9 && hour <= 17;
  }

  private startMonitoring(): void {
    // Periodic metrics reporting
    setInterval(() => {
      const stats = this.getStats();
      
      // Update metrics
      this.recordMetric('ml.predictions.total', this.predictionCount);
      this.recordMetric('ml.tokens.total', this.totalTokensUsed);
      this.recordMetric('ml.errors.total', this.errorCount);
      
      if (this.config.costTracking.enabled) {
        const cost = this.totalTokensUsed * this.config.costTracking.costPerInputToken;
        this.recordMetric('ml.cost.total', cost);
      }
    }, 60000); // Every minute
  }
}