import { PrismaClient, type Todo as PrismaTodo, Priority as PrismaPriority, TodoStatus as PrismaTodoStatus } from '@prisma/client';
import type { TodoRepository } from '../../domain/repositories/TodoRepository.js';
import { Todo } from '../../domain/aggregates/Todo.js';
import { BaseRepository } from '../core/BaseRepository.js';

export class PrismaTodoRepository 
  extends BaseRepository<Todo, PrismaTodo>
  implements TodoRepository {
  
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected getModelName(): string {
    return 'todo';
  }

  protected mapToDomain(todoData: PrismaTodo): Todo {
    const status = todoData.status as PrismaTodoStatus;
    const priority = todoData.priority as PrismaPriority;

    return new Todo(
      todoData.id,
      todoData.title,
      todoData.userId,
      todoData.todoListId,
      status,
      priority,
      todoData.dueDate,
      todoData.description,
      todoData.tags,
      todoData.completedAt,
      todoData.createdAt,
      todoData.updatedAt,
      todoData.version || 0,
    );
  }

  protected mapToCreateInput(todo: Todo): any {
    return {
      title: todo.title,
      status: todo.status,
      priority: todo.priority,
      dueDate: todo.dueDate,
      completedAt: todo.completedAt,
      userId: todo.userId,
      todoListId: todo.todoListId,
      description: todo.description,
      tags: todo.tags,
      version: todo.version,
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
    };
  }

  protected mapToUpdateInput(todo: Todo): any {
    return {
      title: todo.title,
      status: todo.status,
      priority: todo.priority,
      dueDate: todo.dueDate,
      completedAt: todo.completedAt,
      todoListId: todo.todoListId,
      description: todo.description,
      tags: todo.tags,
      version: todo.version,
      updatedAt: todo.updatedAt,
    };
  }

  // Additional methods specific to TodoRepository
  async findByUserId(userId: string): Promise<Todo[]> {
    return this.findByField('userId', userId, {
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTodoListId(todoListId: string): Promise<Todo[]> {
    return this.findByField('todoListId', todoListId, {
      orderBy: { createdAt: 'desc' },
    });
  }
}