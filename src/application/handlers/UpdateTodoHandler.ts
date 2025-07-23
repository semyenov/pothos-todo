import { UpdateTodoCommand } from '../commands/UpdateTodoCommand.js';
import { Todo } from '../../domain/aggregates/Todo.js';
import type { TodoRepository } from '../../domain/repositories/TodoRepository.js';
import type { IEventPublisher } from '../../infrastructure/events/EventPublisher.js';
import { DueDate } from '../../domain/value-objects/DueDate.js';

export class UpdateTodoHandler {
  constructor(
    private readonly todoRepository: TodoRepository,
    private readonly eventPublisher: IEventPublisher
  ) { }

  async handle(command: UpdateTodoCommand): Promise<Todo> {
    if (!command.hasChanges()) {
      throw new Error('No changes provided');
    }

    command.validateDueDate();

    const todo = await this.todoRepository.findById(command.id);
    if (!todo) {
      throw new Error('Todo not found');
    }

    if (todo.userId !== command.userId) {
      throw new Error('Unauthorized to update this todo');
    }

    todo.update(
      command.title,
      command.priority,
      command.dueDate,
      command.description,
      command.tags,
      command.status,
      command.completedAt,
      command.userId
    );

    await this.todoRepository.save(todo);

    await this.eventPublisher.publishAll(todo.domainEvents);
    todo.markEventsAsCommitted();

    return todo;
  }
}