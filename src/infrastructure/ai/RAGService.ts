import { OpenAI } from 'openai';
import { EmbeddingService } from './EmbeddingService.js';
import { VectorStore } from './VectorStore.js';
import { logger } from '@/logger.js';
import type { Todo, PrismaClient } from '@prisma/client';
import { AsyncSingletonService, SingletonService } from '../core/SingletonService.js';

export interface RAGContext {
  query: string;
  userId: string;
  maxContextItems?: number;
  includeCompleted?: boolean;
}

export interface RAGResponse {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    relevanceScore: number;
  }>;
  confidence: number;
}

export class RAGService extends SingletonService {
  private openai: OpenAI | null = null;
  private embeddingService: EmbeddingService | null = null;
  private vectorStore: VectorStore | null = null;

  /**
   * Configure the RAGService with required dependencies
   */
  public configure(
    embeddingService: EmbeddingService,
    vectorStore: VectorStore
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
  }

  initialize(apiKey: string): void {
    this.openai = new OpenAI({ apiKey });
  }

  async queryWithContext(context: RAGContext): Promise<RAGResponse> {
    if (!this.openai) {
      throw new Error('RAG service not initialized. Please provide OpenAI API key.');
    }

    this.ensureConfigured();

    try {
      // Step 1: Retrieve relevant todos using semantic search
      const relevantTodos = await this.embeddingService!.findSimilarTodos(
        context.query,
        context.userId,
        context.maxContextItems || 5
      );

      if (relevantTodos.length === 0) {
        return {
          answer: "I couldn't find any relevant tasks to answer your question. Try adding more tasks or rephrasing your query.",
          sources: [],
          confidence: 0.3
        };
      }

      // Step 2: Build context from relevant todos
      const contextText = this.buildContextFromTodos(relevantTodos);

      // Step 3: Generate response using GPT-4
      const response = await this.generateResponse(
        context.query,
        contextText,
        relevantTodos
      );

      return response;
    } catch (error) {
      logger.error('RAG query failed', { error, context });
      throw new Error('Failed to process your query. Please try again.');
    }
  }

  async generateInsights(userId: string): Promise<{
    productivity: string;
    patterns: string[];
    recommendations: string[];
  }> {
    if (!this.openai) {
      throw new Error('RAG service not initialized.');
    }

    this.ensureConfigured();

    try {
      // Get user's todos for analysis
      const todos = await this.embeddingService!.findSimilarTodos(
        'all tasks',
        userId,
        50
      );

      const todosSummary = todos.map(t => ({
        title: t.content,
        metadata: t.metadata
      }));

      const systemPrompt = `You are a productivity analyst. Analyze the user's todo list and provide insights.
Return a JSON object with:
- productivity: A brief assessment of their productivity level
- patterns: Array of 3-5 observed patterns in their tasks
- recommendations: Array of 3-5 actionable recommendations`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze these tasks: ${JSON.stringify(todosSummary)}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 500
      });

      const insights = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        productivity: insights.productivity || 'Unable to assess',
        patterns: insights.patterns || [],
        recommendations: insights.recommendations || []
      };
    } catch (error) {
      logger.error('Failed to generate insights', { error, userId });
      return {
        productivity: 'Unable to analyze productivity',
        patterns: [],
        recommendations: []
      };
    }
  }

  async explainTask(todoId: string, userId: string): Promise<{
    explanation: string;
    breakdown: string[];
    estimatedTime: string;
    difficulty: string;
  }> {
    if (!this.openai) {
      throw new Error('RAG service not initialized.');
    }

    this.ensureConfigured();

    try {
      // Get the specific todo and related tasks
      const todo = await this.embeddingService!.findSimilarTodos(todoId, userId, 1);
      const todoContent = todo[0]?.content || '';
      if (!todo) {
        throw new Error('Task not found');
      }

      const relatedTodos = await this.embeddingService!.findSimilarTodos(
        todoContent,
        userId,
        3
      );

      const systemPrompt = `You are a task analysis expert. Analyze the given task and provide:
- explanation: A clear explanation of what the task involves
- breakdown: Array of 3-5 subtasks or steps to complete it
- estimatedTime: Estimated time to complete (e.g., "30 minutes", "2 hours")
- difficulty: Task difficulty (easy, medium, hard)

Return as JSON.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Task: ${todoContent}\nRelated tasks: ${relatedTodos.map(t => t.content).join(', ')}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 400
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        explanation: analysis.explanation || 'Unable to analyze task',
        breakdown: analysis.breakdown || [],
        estimatedTime: analysis.estimatedTime || 'Unknown',
        difficulty: analysis.difficulty || 'medium'
      };
    } catch (error) {
      logger.error('Failed to explain task', { error, todoId, userId });
      return {
        explanation: 'Unable to analyze this task',
        breakdown: [],
        estimatedTime: 'Unknown',
        difficulty: 'medium'
      };
    }
  }

  private buildContextFromTodos(todos: Array<any>): string {
    return todos
      .map((t, index) => `Task ${index + 1}: ${t.content} (Priority: ${t.metadata.priority}, Status: ${t.metadata.status})`)
      .join('\n');
  }

  private async generateResponse(
    query: string,
    context: string,
    sources: Array<any>
  ): Promise<RAGResponse> {
    const systemPrompt = `You are a helpful task management assistant. Answer questions about the user's todos based on the provided context.
Be concise but informative. If the context doesn't contain enough information to fully answer the question, say so.
Always base your answers on the provided context.`;

    const userPrompt = `Context (User's Tasks):\n${context}\n\nQuestion: ${query}`;

    const response = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const answer = response.choices[0]?.message?.content || 'Unable to generate response';

    // Calculate confidence based on source relevance scores
    const avgScore = sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
    const confidence = Math.min(avgScore + 0.2, 1); // Boost confidence slightly

    return {
      answer,
      sources: sources.slice(0, 3).map(s => ({
        id: s.id,
        title: s.content,
        relevanceScore: s.score
      })),
      confidence
    };
  }

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.embeddingService || !this.vectorStore) {
      throw new Error('RAGService not configured - call configure() first');
    }
  }
}