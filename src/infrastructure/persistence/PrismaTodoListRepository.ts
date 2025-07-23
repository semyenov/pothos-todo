import { PrismaClient, type TodoList as PrismaTodoList } from '@prisma/client';
import type { TodoListRepository } from '../../domain/repositories/TodoListRepository.js';
import { TodoList } from '../../domain/aggregates/TodoList.js';
import { BaseRepository } from '../core/BaseRepository.js';

export class PrismaTodoListRepository 
  extends BaseRepository<TodoList, PrismaTodoList>
  implements TodoListRepository {
  
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected getModelName(): string {
    return 'todoList';
  }

  protected mapToDomain(todoListData: PrismaTodoList): TodoList {
    return new TodoList(
      todoListData.id,
      todoListData.title,
      todoListData.description,
      todoListData.userId,
      todoListData.createdAt,
      todoListData.updatedAt
    );
  }

  protected mapToCreateInput(todoList: TodoList): any {
    return {
      title: todoList.title,
      description: todoList.description,
      userId: todoList.userId,
    };
  }

  protected mapToUpdateInput(todoList: TodoList): any {
    return {
      title: todoList.title,
      description: todoList.description,
    };
  }

  // Additional method specific to TodoListRepository
  async findByUserId(userId: string): Promise<TodoList[]> {
    return this.findByField('userId', userId, {
      orderBy: { createdAt: 'desc' },
    });
  }
}