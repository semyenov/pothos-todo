/**
 * Migration Example: NLPService
 * 
 * This example shows how to migrate a service from the old singleton pattern
 * to use the new SingletonService base class.
 */

// ============================================
// BEFORE: Original NLPService implementation
// ============================================
/*
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

  // ... rest of the implementation
}
*/

// ============================================
// AFTER: Migrated to use SingletonService
// ============================================

import { OpenAI } from 'openai';
import { logger } from '@/logger';
import { Priority as PrismaPriority, TodoStatus as PrismaTodoStatus } from '@prisma/client';
import { SingletonService } from '@/infrastructure/core/SingletonService';

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

export class NLPService extends SingletonService<NLPService> {
  private openai: OpenAI | null = null;

  protected constructor() {
    super();
  }

  static getInstance(): NLPService {
    return super.getInstance();
  }

  initialize(apiKey: string): void {
    this.openai = new OpenAI({ apiKey });
  }

  async parseCommand(command: string, context?: { userId: string }): Promise<ParsedCommand> {
    if (!this.openai) {
      throw new Error('NLP service not initialized. Please provide OpenAI API key.');
    }

    // ... rest of the implementation remains the same
  }
}

// ============================================
// MIGRATION STEPS:
// ============================================
/*
1. Import SingletonService base class
2. Change class declaration to extend SingletonService<YourClass>
3. Remove the static instance property (handled by base class)
4. Change constructor from private to protected
5. Add super() call in constructor
6. Simplify getInstance() to call super.getInstance()
7. Remove null type from static instance declaration

Benefits:
- Reduced code: ~10 lines removed
- Consistent pattern across all services
- Easier to test (can clear instances)
- Type-safe singleton implementation
*/