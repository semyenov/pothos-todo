import { OpenAI } from 'openai';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { NLPServiceEventMap } from '../core/ServiceEventMaps.ai.js';
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
import { 
  Priority as PrismaPriority, 
  TodoStatus as PrismaTodoStatus 
} from '@prisma/client';
import { logger } from '@/lib/unjs-utils.js';

/**
 * NLP service configuration schema
 */
const NLPConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().default(0.3),
  maxTokens: z.number().default(500),
  fallbackModels: z.array(z.string()).default(['gpt-3.5-turbo']),
  rateLimits: z.object({
    requestsPerMinute: z.number().default(60),
    tokensPerMinute: z.number().default(90000),
  }),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(300), // 5 minutes
    maxSize: z.number().default(1000),
  }),
  costTracking: z.object({
    enabled: z.boolean().default(true),
    costPerInputToken: z.number().default(0.00015), // $0.15 per 1M tokens for gpt-4o-mini
    costPerOutputToken: z.number().default(0.0006), // $0.60 per 1M tokens
  }),
  intents: z.object({
    confidenceThreshold: z.number().default(0.7),
    ambiguityThreshold: z.number().default(0.5),
  }),
});

export type NLPConfig = z.infer<typeof NLPConfigSchema>;

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  action: 'create' | 'update' | 'complete' | 'delete' | 'list';
  entity: 'todo' | 'todoList';
  parameters: {
    title?: string;
    priority?: PrismaPriority;
    status?: PrismaTodoStatus;
    dueDate?: Date;
    tags?: string[];
    todoId?: string;
    listId?: string;
    filter?: {
      status?: string;
      priority?: string;
      search?: string;
    };
  };
  confidence: number;
  entities?: Record<string, any>;
  intent?: string;
  slots?: Record<string, any>;
}

/**
 * Suggestion context
 */
export interface SuggestionContext {
  recentTodos: Array<{ title: string; priority: string; status: string }>;
  timeOfDay: string;
  dayOfWeek: string;
  userPreferences?: {
    workingHours?: [number, number];
    categories?: string[];
    recurringTasks?: string[];
  };
}

/**
 * Sentiment analysis result
 */
export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  aspects?: Array<{
    aspect: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;
  }>;
}

/**
 * Enhanced NLP Service using the new base service architecture
 * 
 * Features:
 * - Natural language command parsing with confidence scoring
 * - Intent recognition and entity extraction
 * - Smart task suggestions based on context
 * - Sentiment analysis for user feedback
 * - Token usage tracking and cost monitoring
 * - Model fallback for reliability
 * - Response caching for common queries
 * 
 * @example
 * ```typescript
 * const nlpService = NLPService.getInstance();
 * 
 * // Listen to NLP events
 * nlpService.on('nlp:command-parsed', ({ input, command, confidence }) => {
 *   console.log(`Parsed "${input}" with ${confidence} confidence`);
 * });
 * 
 * // Parse natural language command
 * const command = await nlpService.parseCommand(
 *   "Create a high priority todo to buy groceries tomorrow"
 * );
 * 
 * // Generate task suggestions
 * const suggestions = await nlpService.generateSuggestions(context);
 * ```
 */
@ServiceConfig({
  schema: NLPConfigSchema,
  prefix: 'nlp',
  hot: true, // Allow hot reload for API key changes
})
export class NLPService extends BaseService<NLPConfig, NLPServiceEventMap> {
  private openai!: OpenAI;
  private parseCount = 0;
  private suggestionCount = 0;
  private errorCount = 0;
  private totalTokensUsed = 0;
  private cachedSystemPrompts = new Map<string, string>();

  /**
   * Get the singleton instance
   */
  static override getInstance(): NLPService {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'nlp-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'Natural Language Processing service for command parsing and text generation';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('NLPService initializing with config:', {
      model: this.config.model,
      temperature: this.config.temperature,
      caching: this.config.caching.enabled,
    });

    // Pre-cache system prompts
    this.initializeSystemPrompts();
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
    this.cachedSystemPrompts.clear();
    logger.info('NLPService stopped');
  }

  /**
   * Handle configuration changes
   */
  protected override async onConfigChange(newConfig: NLPConfig): Promise<void> {
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

    if (newConfig.model !== this.config.model) {
      this.emit('nlp:model-switched', {
        from: this.config.model,
        to: newConfig.model,
        reason: 'Configuration change',
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
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: 'Test' },
          { role: 'user', content: 'Test' },
        ],
        max_tokens: 10,
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
    name: 'nlp:api',
    critical: true,
    interval: 60000,
    timeout: 5000,
  })
  async checkAPI(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const start = Date.now();
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'health' }],
        max_tokens: 5,
      });
      const latency = Date.now() - start;

      if (latency > 3000) {
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
   * Parse natural language command
   */
  @Metric({ name: 'nlp.parse-command', recordDuration: true })
  @RateLimit({ window: 60000, max: 60 })
  @Cache({ ttl: 300, maxSize: 1000, keyGenerator: (args) => args[0] })
  @TokenUsage({
    model: 'gpt-4o-mini',
    costPerToken: 0.00015,
    warnThreshold: 1000,
  })
  @ModelFallback({
    primary: 'gpt-4o-mini',
    fallbacks: ['gpt-3.5-turbo'],
    fallbackOn: (error) => error.message.includes('model_not_found'),
  })
  @AIPerformance({
    operation: 'parse-command',
    trackLatency: true,
  })
  async parseCommand(
    command: string,
    context?: { userId?: string; currentTodos?: string[] }
  ): Promise<ParsedCommand> {
    const systemPrompt = this.cachedSystemPrompts.get('parseCommand')!;
    const start = Date.now();

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: command },
        ],
        response_format: { type: 'json_object' },
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      // Transform and validate
      const result = this.transformParsedCommand(parsed);
      
      this.parseCount++;
      this.totalTokensUsed += response.usage?.total_tokens || 0;

      this.emit('nlp:command-parsed', {
        input: command,
        command: result.action,
        confidence: result.confidence,
        entities: result.entities,
      });

      // Check confidence threshold
      if (result.confidence < this.config.intents.confidenceThreshold) {
        logger.warn('Low confidence command parse', {
          command,
          confidence: result.confidence,
        });
      }

      return result;
    } catch (error) {
      this.errorCount++;
      this.emit('nlp:error', {
        error: error as Error,
        operation: 'parseCommand',
      });
      throw new Error(
        'Failed to parse command. Please try again with clearer instructions.'
      );
    }
  }

  /**
   * Generate task suggestions
   */
  @Metric({ name: 'nlp.generate-suggestions', recordDuration: true })
  @TokenUsage({
    model: 'gpt-4o-mini',
    costPerToken: 0.00015,
  })
  @AIMonitored({
    operation: 'generate-suggestions',
    performanceTracking: true,
  })
  async generateSuggestions(context: SuggestionContext): Promise<string[]> {
    const systemPrompt = this.cachedSystemPrompts.get('generateSuggestions')!;
    const start = Date.now();

    try {
      const userPrompt = this.buildSuggestionPrompt(context);

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7, // Higher temperature for creativity
        max_tokens: 200,
      });

      const result = JSON.parse(
        response.choices[0]?.message?.content || '{"suggestions":[]}'
      );
      
      const suggestions = result.suggestions || [];
      this.suggestionCount++;
      this.totalTokensUsed += response.usage?.total_tokens || 0;

      this.emit('nlp:text-generated', {
        prompt: 'generateSuggestions',
        response: suggestions.join(', '),
        model: this.config.model,
        tokens: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
        },
      });

      return suggestions;
    } catch (error) {
      logger.error('Failed to generate suggestions', { error });
      return [];
    }
  }

  /**
   * Analyze sentiment of text
   */
  @Metric({ name: 'nlp.analyze-sentiment', recordDuration: true })
  @Cache({ ttl: 600, maxSize: 500 })
  async analyzeSentiment(text: string): Promise<SentimentResult> {
    const systemPrompt = this.cachedSystemPrompts.get('analyzeSentiment')!;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 150,
      });

      const result = JSON.parse(
        response.choices[0]?.message?.content || 
        '{"sentiment":"neutral","score":0}'
      );

      const sentimentResult: SentimentResult = {
        sentiment: result.sentiment || 'neutral',
        score: result.score || 0,
        aspects: result.aspects,
      };

      this.emit('nlp:sentiment-analyzed', {
        text,
        sentiment: sentimentResult.sentiment,
        score: sentimentResult.score,
      });

      return sentimentResult;
    } catch (error) {
      logger.error('Failed to analyze sentiment', { error });
      return { sentiment: 'neutral', score: 0 };
    }
  }

  /**
   * Extract entities from text
   */
  @Metric({ name: 'nlp.extract-entities', recordDuration: true })
  async extractEntities(text: string): Promise<Record<string, any>> {
    const systemPrompt = this.cachedSystemPrompts.get('extractEntities')!;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 200,
      });

      const entities = JSON.parse(
        response.choices[0]?.message?.content || '{}'
      );

      return entities;
    } catch (error) {
      logger.error('Failed to extract entities', { error });
      return {};
    }
  }

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgTokensPerRequest = this.parseCount > 0
      ? Math.round(this.totalTokensUsed / this.parseCount)
      : 0;

    return {
      parseCount: this.parseCount,
      suggestionCount: this.suggestionCount,
      errorCount: this.errorCount,
      totalTokensUsed: this.totalTokensUsed,
      avgTokensPerRequest,
      estimatedCost: this.config.costTracking.enabled
        ? (this.totalTokensUsed * this.config.costTracking.costPerInputToken).toFixed(4)
        : 'N/A',
      uptime,
      errorRate: this.parseCount > 0
        ? (this.errorCount / this.parseCount * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Private helper methods
   */

  private initializeSystemPrompts(): void {
    this.cachedSystemPrompts.set('parseCommand', `You are a task management assistant that parses natural language commands into structured actions.
Parse the user's command and return a JSON object with the following structure:
{
  "action": "create" | "update" | "complete" | "delete" | "list",
  "entity": "todo" | "todoList",
  "parameters": {
    "title": string (for create/update),
    "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "URGENT",
    "status": "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
    "dueDate": ISO date string (optional),
    "tags": array of strings (optional),
    "todoId": string (for update/complete/delete),
    "listId": string (optional),
    "filter": {
      "status": string (for list),
      "priority": string (for list),
      "search": string (for list)
    }
  },
  "confidence": number between 0 and 1,
  "intent": string (the primary intent),
  "entities": object (extracted entities),
  "slots": object (filled slots)
}

Examples:
- "Create a todo to buy groceries tomorrow with high priority" -> create todo with title, dueDate, priority
- "Mark todo abc123 as complete" -> complete todo with todoId
- "Show me all high priority todos" -> list todos with priority filter

If the command is ambiguous, set a lower confidence score.`);

    this.cachedSystemPrompts.set('generateSuggestions', `Based on the user's recent todos and current context, suggest 3-5 new tasks they might want to create.
Consider the time of day, day of week, patterns in their existing tasks, and any user preferences.
Return a JSON object with an array of suggested task titles:
{
  "suggestions": ["Task 1", "Task 2", "Task 3"]
}

Make suggestions contextual and actionable. Consider:
- Time-based tasks (morning routines, evening tasks)
- Day-specific tasks (Monday planning, Friday review)
- Recurring patterns in user's todos
- Balance between work and personal tasks`);

    this.cachedSystemPrompts.set('analyzeSentiment', `Analyze the sentiment of the given text.
Return a JSON object with:
{
  "sentiment": "positive" | "negative" | "neutral",
  "score": number between -1 and 1,
  "aspects": [
    {
      "aspect": string,
      "sentiment": "positive" | "negative" | "neutral",
      "score": number
    }
  ]
}`);

    this.cachedSystemPrompts.set('extractEntities', `Extract named entities from the text.
Return a JSON object with entities grouped by type:
{
  "dates": ["2024-01-15", "tomorrow"],
  "times": ["3pm", "morning"],
  "people": ["John", "Sarah"],
  "places": ["office", "home"],
  "priorities": ["high", "urgent"],
  "tags": ["work", "personal"],
  "numbers": ["5", "two"]
}`);
  }

  private transformParsedCommand(parsed: any): ParsedCommand {
    const result: ParsedCommand = {
      action: parsed.action || 'list',
      entity: parsed.entity || 'todo',
      parameters: {},
      confidence: parsed.confidence || 0.5,
      entities: parsed.entities,
      intent: parsed.intent,
      slots: parsed.slots,
    };

    // Transform parameters
    if (parsed.parameters) {
      if (parsed.parameters.title) {
        result.parameters.title = parsed.parameters.title;
      }
      if (parsed.parameters?.priority) {
        result.parameters.priority = this.mapPriority(parsed.parameters.priority);
      }
      if (parsed.parameters?.status) {
        result.parameters.status = this.mapStatus(parsed.parameters.status);
      }
      if (parsed.parameters.dueDate) {
        result.parameters.dueDate = new Date(parsed.parameters.dueDate);
      }
      if (parsed.parameters.tags) {
        result.parameters.tags = parsed.parameters.tags;
      }
      if (parsed.parameters.todoId) {
        result.parameters.todoId = parsed.parameters.todoId;
      }
      if (parsed.parameters.listId) {
        result.parameters.listId = parsed.parameters.listId;
      }
      if (parsed.parameters.filter) {
        result.parameters.filter = parsed.parameters.filter;
      }
    }

    return result;
  }

  private buildSuggestionPrompt(context: SuggestionContext): string {
    let prompt = `Recent todos: ${JSON.stringify(context.recentTodos)}
Time: ${context.timeOfDay}
Day: ${context.dayOfWeek}`;

    if (context.userPreferences) {
      if (context.userPreferences.workingHours) {
        prompt += `\nWorking hours: ${context.userPreferences.workingHours.join('-')}`;
      }
      if (context.userPreferences.categories) {
        prompt += `\nPreferred categories: ${context.userPreferences.categories.join(', ')}`;
      }
      if (context.userPreferences.recurringTasks) {
        prompt += `\nRecurring tasks: ${context.userPreferences.recurringTasks.join(', ')}`;
      }
    }

    return prompt;
  }

  private mapPriority(priority: string): PrismaPriority {
    const normalized = priority.toLowerCase();
    switch (normalized) {
      case 'low':
        return PrismaPriority.LOW;
      case 'medium':
        return PrismaPriority.MEDIUM;
      case 'high':
        return PrismaPriority.HIGH;
      case 'critical':
      case 'urgent':
        return PrismaPriority.URGENT;
      default:
        return PrismaPriority.MEDIUM;
    }
  }

  private mapStatus(status: string): PrismaTodoStatus {
    const normalized = status.toLowerCase();
    switch (normalized) {
      case 'pending':
        return PrismaTodoStatus.PENDING;
      case 'in_progress':
      case 'in-progress':
        return PrismaTodoStatus.IN_PROGRESS;
      case 'completed':
      case 'done':
        return PrismaTodoStatus.COMPLETED;
      case 'cancelled':
      case 'canceled':
        return PrismaTodoStatus.CANCELLED;
      default:
        return PrismaTodoStatus.PENDING;
    }
  }

  private startMonitoring(): void {
    // Periodic metrics reporting
    setInterval(() => {
      const stats = this.getStats();
      
      // Update metrics
      this.recordMetric('nlp.commands.total', this.parseCount);
      this.recordMetric('nlp.suggestions.total', this.suggestionCount);
      this.recordMetric('nlp.tokens.total', this.totalTokensUsed);
      this.recordMetric('nlp.errors.total', this.errorCount);
      
      if (this.config.costTracking.enabled) {
        const cost = this.totalTokensUsed * this.config.costTracking.costPerInputToken;
        this.recordMetric('nlp.cost.total', cost);
      }
    }, 60000); // Every minute
  }
}