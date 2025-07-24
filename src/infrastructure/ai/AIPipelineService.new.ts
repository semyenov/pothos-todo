import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { AIPipelineEventMap } from '../core/ServiceEventMaps.ai.js';
import { 
  ServiceConfig, 
  Metric, 
  HealthCheck 
} from '../core/decorators/ServiceDecorators.js';
import { 
  AIWorkflow,
  AIPerformance 
} from '../core/decorators/AIServiceDecorators.js';
import { EmbeddingService } from './EmbeddingService.new.js';
import { NLPService } from './NLPService.new.js';
import { RAGService } from './RAGService.new.js';
import { MLPredictionService } from './MLPredictionService.new.js';
import { AIInsightService } from './AIInsightService.new.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * AI Pipeline service configuration schema
 */
const AIPipelineConfigSchema = z.object({
  maxConcurrentPipelines: z.number().default(5),
  defaultTimeout: z.number().default(30000),
  retryAttempts: z.number().default(2),
  stages: z.array(z.string()).default([
    'input-processing',
    'embedding-generation',
    'similarity-search',
    'context-building',
    'prediction-analysis',
    'insight-generation',
    'output-formatting'
  ]),
});

export type AIPipelineConfig = z.infer<typeof AIPipelineConfigSchema>;

/**
 * Pipeline stage definition
 */
export interface PipelineStage {
  name: string;
  processor: (input: any, context: PipelineContext) => Promise<any>;
  timeout?: number;
  retryable?: boolean;
  optional?: boolean;
}

/**
 * Pipeline context
 */
export interface PipelineContext {
  pipelineId: string;
  userId: string;
  startTime: number;
  metadata: Record<string, any>;
  stageResults: Map<string, any>;
}

/**
 * Enhanced AI Pipeline Service using the new base service architecture
 * 
 * Orchestrates complex AI workflows by coordinating multiple AI services
 * in a configurable pipeline architecture.
 */
@ServiceConfig({
  schema: AIPipelineConfigSchema,
  prefix: 'ai-pipeline',
  hot: true,
})
export class AIPipelineService extends BaseAsyncService<AIPipelineConfig, AIPipelineEventMap> {
  private embeddingService!: EmbeddingService;
  private nlpService!: NLPService;
  private ragService!: RAGService;
  private mlPredictionService!: MLPredictionService;
  private aiInsightService!: AIInsightService;
  private activePipelines = new Map<string, PipelineContext>();
  private pipelineCount = 0;

  static override async getInstance(): Promise<AIPipelineService> {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'ai-pipeline-service';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'AI pipeline orchestration service for complex workflows';
  }

  protected override async onInitialize(): Promise<void> {
    // Get all AI service dependencies
    this.embeddingService = EmbeddingService.getInstance();
    this.nlpService = NLPService.getInstance();
    this.ragService = await RAGService.getInstance();
    this.mlPredictionService = MLPredictionService.getInstance();
    this.aiInsightService = AIInsightService.getInstance();
  }

  protected override async onStart(): Promise<void> {
    logger.info('AIPipelineService started with max concurrent pipelines:', this.config.maxConcurrentPipelines);
  }

  @HealthCheck({
    name: 'ai-pipeline:service',
    critical: false,
    interval: 60000,
  })
  async checkService(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const activeCount = this.activePipelines.size;
    if (activeCount > this.config.maxConcurrentPipelines * 0.8) {
      return {
        status: 'degraded',
        message: `High pipeline load: ${activeCount}/${this.config.maxConcurrentPipelines}`,
      };
    }
    return {
      status: 'healthy',
      message: `Pipeline service healthy (${activeCount} active)`,
    };
  }

  /**
   * Execute a complete AI pipeline
   */
  @Metric({ name: 'ai-pipeline.execute', recordDuration: true })
  @AIWorkflow({
    name: 'ai-pipeline-execution',
    steps: ['process', 'embed', 'search', 'predict', 'insights'],
  })
  @AIPerformance({
    operation: 'pipeline-execution',
    trackMemory: true,
    trackLatency: true,
  })
  async executePipeline(
    input: any,
    stages: string[],
    options: { userId: string; metadata?: Record<string, any> } = { userId: '' }
  ): Promise<any> {
    const pipelineId = `pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const context: PipelineContext = {
      pipelineId,
      userId: options.userId,
      startTime: Date.now(),
      metadata: options.metadata || {},
      stageResults: new Map(),
    };

    this.activePipelines.set(pipelineId, context);
    this.pipelineCount++;

    try {
      this.emit('pipeline:started', {
        pipelineId,
        stages,
        input,
      });

      let currentOutput = input;

      for (let i = 0; i < stages.length; i++) {
        const stageName = stages[i];
        
        this.emit('pipeline:stage-started', {
          pipelineId,
          stage: stageName,
          index: i,
        });

        const stageStart = Date.now();
        const stageOutput = await this.executeStage(stageName, currentOutput, context);
        const stageDuration = Date.now() - stageStart;

        context.stageResults.set(stageName, stageOutput);
        currentOutput = stageOutput;

        this.emit('pipeline:stage-completed', {
          pipelineId,
          stage: stageName,
          output: stageOutput,
          duration: stageDuration,
        });
      }

      const totalDuration = Date.now() - context.startTime;

      this.emit('pipeline:completed', {
        pipelineId,
        output: currentOutput,
        duration: totalDuration,
        stages: stages.length,
      });

      return currentOutput;
    } catch (error) {
      this.emit('pipeline:error', {
        error: error as Error,
        pipelineId,
      });
      throw error;
    } finally {
      this.activePipelines.delete(pipelineId);
    }
  }

  /**
   * Execute smart task analysis pipeline
   */
  async executeTaskAnalysisPipeline(
    todoId: string,
    userId: string
  ): Promise<{
    predictions: any;
    insights: any;
    recommendations: string[];
  }> {
    return this.executePipeline(
      { todoId, userId },
      ['task-analysis', 'prediction', 'insights'],
      { userId }
    );
  }

  /**
   * Execute intelligent query pipeline
   */
  async executeQueryPipeline(
    query: string,
    userId: string
  ): Promise<{
    nlpResult: any;
    ragResponse: any;
    suggestions: any;
  }> {
    return this.executePipeline(
      { query, userId },
      ['nlp-processing', 'rag-query', 'suggestions'],
      { userId }
    );
  }

  private async executeStage(stageName: string, input: any, context: PipelineContext): Promise<any> {
    switch (stageName) {
      case 'nlp-processing':
        return this.nlpService.parseCommand(input.query, { userId: input.userId });

      case 'embedding-generation':
        return this.embeddingService.generateEmbedding(input.text || input.query);

      case 'rag-query':
        return this.ragService.queryWithContext({
          query: input.query,
          userId: input.userId,
        });

      case 'task-analysis':
        return this.mlPredictionService.analyzeTaskComplexity(input.todoId, input.userId);

      case 'prediction':
        return this.mlPredictionService.predictCompletionTime(input.todoId, input.userId);

      case 'insights':
        return this.aiInsightService.generateUserInsights(input.userId);

      case 'suggestions':
        return this.mlPredictionService.predictNextActions(input.userId);

      default:
        throw new Error(`Unknown pipeline stage: ${stageName}`);
    }
  }

  public getStats() {
    return {
      pipelineCount: this.pipelineCount,
      activePipelines: this.activePipelines.size,
      uptime: Date.now() - this.metadata.startTime.getTime(),
    };
  }
}