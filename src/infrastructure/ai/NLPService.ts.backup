import { OpenAI } from 'openai';
import { logger } from '@/logger';
import { Priority as PrismaPriority, TodoStatus as PrismaTodoStatus } from '@prisma/client';

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
}

export class NLPService {
  private static instance: NLPService | null = null;
  private openai: OpenAI | null = null;

  private constructor() { }

  static getInstance(): NLPService {
    if (!NLPService.instance) {
      NLPService.instance = new NLPService();
    }
    return NLPService.instance;
  }

  initialize(apiKey: string): void {
    this.openai = new OpenAI({ apiKey });
  }

  async parseCommand(command: string, context?: { userId: string }): Promise<ParsedCommand> {
    if (!this.openai) {
      throw new Error('NLP service not initialized. Please provide OpenAI API key.');
    }

    try {
      const systemPrompt = `You are a task management assistant that parses natural language commands into structured actions.
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
  "confidence": number between 0 and 1
}

Examples:
- "Create a todo to buy groceries tomorrow with high priority" -> create todo with title, dueDate, priority
- "Mark todo abc123 as complete" -> complete todo with todoId
- "Update the shopping list todo to add milk to the description" -> update todo with description
- "Show me all high priority todos" -> list todos with priority filter
- "Delete the old meeting notes" -> delete todo (may need clarification on which one)

If the command is ambiguous, set a lower confidence score.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: command }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 500
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');

      // Validate and transform the response
      const result: ParsedCommand = {
        action: parsed.action || 'list',
        entity: parsed.entity || 'todo',
        parameters: {},
        confidence: parsed.confidence || 0.5
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

      logger.info('Parsed natural language command', {
        command,
        result,
        userId: context?.userId
      });

      return result;
    } catch (error) {
      logger.error('Failed to parse natural language command', {
        command,
        error,
        userId: context?.userId
      });
      throw new Error('Failed to parse command. Please try again with clearer instructions.');
    }
  }

  async generateSuggestions(context: {
    recentTodos: Array<{ title: string; priority: string; status: string }>;
    timeOfDay: string;
    dayOfWeek: string;
  }): Promise<string[]> {
    if (!this.openai) {
      return [];
    }

    try {
      const systemPrompt = `Based on the user's recent todos and current context, suggest 3-5 new tasks they might want to create.
Consider the time of day, day of week, and patterns in their existing tasks.
Return a JSON array of suggested task titles.`;

      const userPrompt = `Recent todos: ${JSON.stringify(context.recentTodos)}
Time: ${context.timeOfDay}
Day: ${context.dayOfWeek}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 200
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"suggestions":[]}');
      return result.suggestions || [];
    } catch (error) {
      logger.error('Failed to generate suggestions', { error });
      return [];
    }
  }

  private mapPriority(priority: string): PrismaPriority {
    const normalized = priority.toLowerCase();
    switch (normalized) {
      case 'LOW':
        return PrismaPriority.LOW;
      case 'MEDIUM':
        return PrismaPriority.MEDIUM;
      case 'HIGH':
        return PrismaPriority.HIGH;
      case 'CRITICAL':
      case 'URGENT':
        return PrismaPriority.URGENT;
      default:
        return PrismaPriority.MEDIUM;
    }
  }

  private mapStatus(status: string): PrismaTodoStatus {
    const normalized = status.toLowerCase();
    switch (normalized) {
      case 'PENDING':
        return PrismaTodoStatus.PENDING;
      case 'IN_PROGRESS':
      case 'IN-PROGRESS':
        return PrismaTodoStatus.IN_PROGRESS;
      case 'COMPLETED':
      case 'DONE':
        return PrismaTodoStatus.COMPLETED;
      case 'CANCELLED':
      case 'CANCELED':
        return PrismaTodoStatus.CANCELLED;
      default:
        return PrismaTodoStatus.PENDING;
    }
  }
}