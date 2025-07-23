import { OpenAI } from 'openai';
import { logger } from '@/logger';
import type { PrismaClient, Todo } from '@prisma/client';
import { Priority } from '../../domain/value-objects/Priority.js';
import { SingletonService } from '../core/SingletonService.js';

export interface CompletionTimePrediction {
  estimatedHours: number;
  confidence: number;
  factors: string[];
}

export interface PrioritySuggestion {
  suggestedPriority: string;
  reasoning: string;
  confidence: number;
}

export interface TaskComplexityAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  requiredSkills: string[];
  dependencies: string[];
  risks: string[];
}

export class MLPredictionService extends SingletonService<MLPredictionService> {
  private openai: OpenAI | null = null;
  private prisma: PrismaClient | null = null;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<MLPredictionService> {
    return super.getInstance();
  }

  /**
   * Configure the MLPredictionService with Prisma client
   */
  public configure(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  initialize(apiKey: string): void {
    this.openai = new OpenAI({ apiKey });
  }

  async predictCompletionTime(
    todoId: string,
    userId: string
  ): Promise<CompletionTimePrediction> {
    if (!this.openai) {
      return {
        estimatedHours: 2,
        confidence: 0.3,
        factors: ['No AI model available for accurate prediction']
      };
    }

    this.ensureConfigured();

    try {
      // Get the todo and user's historical data
      const todo = await this.prisma!.todo.findFirst({
        where: { id: todoId, userId }
      });

      if (!todo) {
        throw new Error('Todo not found');
      }

      // Get similar completed todos for reference
      const completedSimilarTodos = await this.prisma!.todo.findMany({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { not: null }
        },
        orderBy: { completedAt: 'desc' },
        take: 20
      });

      // Calculate average completion times by priority
      const completionStats = this.calculateCompletionStats(completedSimilarTodos);

      const systemPrompt = `You are a task time estimation expert. Based on the task details and historical data, predict completion time.
Return a JSON object with:
- estimatedHours: number (e.g., 0.5, 1, 2, 4)
- confidence: number between 0 and 1
- factors: array of 3-5 factors affecting the estimate`;

      const userPrompt = `Task: ${todo.title}
Description: ${todo.description || 'No description'}
Priority: ${todo.priority}
Tags: ${todo.tags.join(', ') || 'None'}

Historical completion times:
${JSON.stringify(completionStats)}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 200
      });

      const prediction = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        estimatedHours: prediction.estimatedHours || 2,
        confidence: prediction.confidence || 0.5,
        factors: prediction.factors || []
      };
    } catch (error) {
      logger.error('Failed to predict completion time', { error, todoId });
      return {
        estimatedHours: 2,
        confidence: 0.3,
        factors: ['Error during prediction']
      };
    }
  }

  async suggestPriority(
    title: string,
    description: string | null,
    userId: string
  ): Promise<PrioritySuggestion> {
    if (!this.openai) {
      return {
        suggestedPriority: 'MEDIUM',
        reasoning: 'Default priority without AI analysis',
        confidence: 0.3
      };
    }

    try {
      // Get user's priority patterns
      const userTodos = await this.prisma!.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          title: true,
          priority: true,
          tags: true,
        }
      });

      const priorityPatterns = this.analyzePriorityPatterns(userTodos);

      const systemPrompt = `You are a task priority expert. Suggest an appropriate priority level based on the task and user patterns.
Priority levels: LOW, MEDIUM, HIGH, URGENT
Return a JSON object with:
- suggestedPriority: one of the priority levels
- reasoning: brief explanation (1-2 sentences)
- confidence: number between 0 and 1`;

      const commonKeywords = this.extractKeywords(userTodos.filter(t => t.priority == 'HIGH' || t.priority == 'URGENT'));
      const userPrompt = `New task: ${title}
Description: ${description || 'No description'}

Common keywords in user's high priority tasks: ${commonKeywords}

User's priority patterns:
${JSON.stringify(priorityPatterns)}
`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 150
      });

      const suggestion = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        suggestedPriority: suggestion.suggestedPriority || 'MEDIUM',
        reasoning: suggestion.reasoning || 'Based on task content',
        confidence: suggestion.confidence || 0.6
      };
    } catch (error) {
      logger.error('Failed to suggest priority', { error });
      return {
        suggestedPriority: 'MEDIUM',
        reasoning: 'Error during analysis',
        confidence: 0.3
      };
    }
  }

  async analyzeTaskComplexity(
    todoId: string,
    userId: string
  ): Promise<TaskComplexityAnalysis> {
    if (!this.openai) {
      return {
        complexity: 'moderate',
        requiredSkills: [],
        dependencies: [],
        risks: []
      };
    }

    this.ensureConfigured();

    try {
      const todo = await this.prisma!.todo.findFirst({
        where: { id: todoId, userId },
        include: {
          todoList: true
        }
      });

      if (!todo) {
        throw new Error('Todo not found');
      }

      // Get related todos in the same list
      const relatedTodos = todo.todoListId ?
        await this.prisma!.todo.findMany({
          where: {
            todoListId: todo.todoListId,
            id: { not: todoId }
          },
          select: { title: true, status: true }
        }) : [];

      const systemPrompt = `You are a task complexity analyst. Analyze the task and determine its complexity.
Return a JSON object with:
- complexity: "simple", "moderate", or "complex"
- requiredSkills: array of 2-4 skills needed
- dependencies: array of potential dependencies or blockers
- risks: array of 1-3 potential risks`;

      const userPrompt = `Task: ${todo.title}
Description: ${todo.description || 'No description'}
Priority: ${todo.priority}
List: ${todo.todoList?.title || 'No list'}

Related tasks in the same context:
${relatedTodos.map(t => `- ${t.title} (${t.status})`).join('\n')}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 300
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        complexity: analysis.complexity || 'moderate',
        requiredSkills: analysis.requiredSkills || [],
        dependencies: analysis.dependencies || [],
        risks: analysis.risks || []
      };
    } catch (error) {
      logger.error('Failed to analyze task complexity', { error, todoId });
      return {
        complexity: 'moderate',
        requiredSkills: [],
        dependencies: [],
        risks: ['Unable to analyze']
      };
    }
  }

  async predictNextActions(userId: string): Promise<{
    suggestedNextTasks: string[];
    reasoning: string;
  }> {
    if (!this.openai) {
      return {
        suggestedNextTasks: [],
        reasoning: 'AI predictions not available'
      };
    }

    try {
      // Get recent todos and patterns
      const recentTodos = await this.prisma!.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          title: true,
          status: true,
          priority: true,
          completedAt: true,
          tags: true
        }
      });

      const completedToday = recentTodos.filter(t =>
        t.completedAt &&
        t.completedAt.toDateString() === new Date().toDateString()
      );

      const pending = recentTodos.filter(t => t.status === 'PENDING');

      const systemPrompt = `You are a productivity assistant. Based on the user's task history and current tasks, suggest next actions.
Return a JSON object with:
- suggestedNextTasks: array of 3-5 specific task suggestions
- reasoning: brief explanation of why these tasks are suggested`;

      const userPrompt = `User's recent activity:
Completed today: ${completedToday.map(t => t.title).join(', ') || 'None'}
Pending tasks: ${pending.map(t => `${t.title} (${t.priority})`).join(', ')}
Common tags: ${this.extractTags(recentTodos)}

Current time: ${new Date().toLocaleString()}
Day: ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 300
      });

      const prediction = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        suggestedNextTasks: prediction.suggestedNextTasks || [],
        reasoning: prediction.reasoning || 'Based on your task patterns'
      };
    } catch (error) {
      logger.error('Failed to predict next actions', { error, userId });
      return {
        suggestedNextTasks: [],
        reasoning: 'Error during prediction'
      };
    }
  }

  private calculateCompletionStats(todos: Todo[]): Record<string, number> {
    const stats: Record<string, { total: number; count: number }> = {};

    for (const todo of todos) {
      if (todo.completedAt && todo.createdAt) {
        const hoursToComplete = (todo.completedAt.getTime() - todo.createdAt.getTime()) / (1000 * 60 * 60);

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

  private analyzePriorityPatterns(todos: Array<{ title: string; priority: string }>): Record<string, number> {
    const counts: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      URGENT: 0
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

  private extractKeywords(todos: Array<{ title: string, tags: string[] }>): string {
    const words: Record<string, number> = {};
    const tags = todos.flatMap(todo => todo.tags);

    for (const todo of todos) {
      const titleWords = todo.title.toLowerCase().split(/\s+/);
      for (const word of [...titleWords, ...tags] as string[]) {
        if (word.length > 3) { // Skip short words
          words[word] = (words[word] || 0) + 1;
        }
      }
    }

    return Object.entries(words)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word)
      .join(', ');
  }

  private extractTags(todos: Array<{ tags: string[] }>): string {
    const tags = todos.flatMap(todo => todo.tags);
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

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.prisma) {
      throw new Error('MLPredictionService not configured - call configure() first');
    }
  }
}