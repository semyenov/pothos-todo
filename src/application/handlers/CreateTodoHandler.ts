import { CreateTodoCommand } from '../commands/CreateTodoCommand.js';
import { Todo } from '../../domain/aggregates/Todo.js';
import type { TodoRepository } from '../../domain/repositories/TodoRepository.js';
import type { IEventPublisher } from '../../infrastructure/events/EventPublisher.js';

export class CreateTodoHandler {
  constructor(
    private readonly todoRepository: TodoRepository,
    private readonly eventPublisher: IEventPublisher
  ) { }

  async handle(command: CreateTodoCommand): Promise<Todo> {
    if (command.dueDate && command.dueDate < new Date()) {
      throw new Error('Due date cannot be in the past');
    }

    const todo = Todo.create(
      command.id,
      command.title,
      command.userId,
      command.todoListId,
      command.priority,
      command.dueDate,
      command.description,
      command.tags,
      command.status,
      command.completedAt,
      command.createdAt,
      command.updatedAt,
    );

    await this.todoRepository.save(todo);
    await this.eventPublisher.publishAll(todo.getUncommittedEvents());

    return todo;
  }
}