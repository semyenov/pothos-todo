import { OpenAI } from 'openai';
import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import type { AIInsightServiceEventMap } from '../core/ServiceEventMaps.ai.js';
import { 
  ServiceConfig, 
  Metric, 
  HealthCheck,
  Cache 
} from '../core/decorators/ServiceDecorators.js';
import { 
  TokenUsage, 
  AIMonitored 
} from '../core/decorators/AIServiceDecorators.js';
import { PrismaService } from '../database/PrismaService.new.js';
import { EmbeddingService } from './EmbeddingService.new.js';
import { MLPredictionService } from './MLPredictionService.new.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * AI Insight service configuration schema
 */
const AIInsightConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o-mini'),
  maxInsightHistory: z.number().default(100),
  insightCategories: z.array(z.string()).default([
    'productivity', 'patterns', 'recommendations', 'trends', 'optimization'
  ]),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(3600), // 1 hour
    maxSize: z.number().default(500),
  }),
});

export type AIInsightConfig = z.infer<typeof AIInsightConfigSchema>;

/**
 * Enhanced AI Insight Service using the new base service architecture
 * 
 * Generates comprehensive insights about user productivity, task patterns,
 * and optimization recommendations using advanced AI analysis.
 */
@ServiceConfig({
  schema: AIInsightConfigSchema,
  prefix: 'ai-insight',
  hot: true,
})
export class AIInsightService extends BaseService<AIInsightConfig, AIInsightServiceEventMap> {
  private openai!: OpenAI;
  private prismaService!: PrismaService;
  private embeddingService!: EmbeddingService;
  private mlPredictionService!: MLPredictionService;
  private insightCount = 0;

  static override getInstance(): AIInsightService {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'ai-insight-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'AI-powered insights and recommendations service';
  }

  protected override async onInitialize(): Promise<void> {
    // Get dependencies
    this.prismaService = await PrismaService.getInstance();
    this.embeddingService = EmbeddingService.getInstance();
    this.mlPredictionService = MLPredictionService.getInstance();
  }

  protected override async onStart(): Promise<void> {
    this.openai = this.createResource({
      resource: new OpenAI({ apiKey: this.config.apiKey }),
      dispose: async () => { logger.info('OpenAI client disposed'); },
    } as any);
  }

  @HealthCheck({
    name: 'ai-insight:service',
    critical: false,
    interval: 120000,
  })
  async checkService(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    try {
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      });
      return { status: 'healthy', message: 'AI Insight service operational' };
    } catch (error) {
      return { status: 'degraded', message: `Service check failed: ${(error as Error).message}` };
    }
  }

  /**
   * Generate comprehensive user insights
   */
  @Metric({ name: 'ai-insight.generate', recordDuration: true })
  @Cache({ ttl: 3600, maxSize: 100 })
  @TokenUsage({ model: 'gpt-4o-mini', costPerToken: 0.00015 })
  @AIMonitored({ operation: 'generate-insights', performanceTracking: true })
  async generateUserInsights(userId: string): Promise<{
    insights: any[];
    confidence: number;
    recommendations: string[];
  }> {
    try {
      const prisma = this.prismaService.getClient();
      
      // Get user data
      const todos = await prisma.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: this.config.maxInsightHistory,
      });

      // Generate insights using AI
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'Analyze user productivity patterns and generate actionable insights. Return JSON with insights array, confidence score, and recommendations array.',
          },
          {
            role: 'user',
            content: `Analyze tasks: ${JSON.stringify(todos.slice(0, 20).map(t => ({ title: t.title, priority: t.priority, status: t.status })))}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      this.insightCount++;

      this.emit('insight:generated', {
        type: 'user-insights',
        userId,
        insights: result.insights || [],
        confidence: result.confidence || 0.5,
      });

      return {
        insights: result.insights || [],
        confidence: result.confidence || 0.5,
        recommendations: result.recommendations || [],
      };
    } catch (error) {
      logger.error('Failed to generate insights', { error, userId });
      return {
        insights: [],
        confidence: 0,
        recommendations: ['Unable to analyze productivity patterns'],
      };
    }
  }

  public getStats() {
    return {
      insightCount: this.insightCount,
      uptime: Date.now() - this.metadata.startTime.getTime(),
    };
  }
}