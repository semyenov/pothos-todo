import { CompleteTodoCommand } from '../commands/CompleteTodoCommand.js';
import { Todo } from '../../domain/aggregates/Todo.js';
import type { TodoRepository } from '../../domain/repositories/TodoRepository.js';
import type { IEventPublisher } from '../../infrastructure/events/EventPublisher.js';

export class CompleteTodoHandler {
  constructor(
    private readonly todoRepository: TodoRepository,
    private readonly eventPublisher: IEventPublisher
  ) { }

  async handle(command: CompleteTodoCommand): Promise<Todo> {
    const todo = await this.todoRepository.findById(command.id);
    if (!todo) {
      throw new Error('Todo not found');
    }

    if (todo.userId !== command.userId) {
      throw new Error('Unauthorized to complete this todo');
    }

    todo.complete(command.userId);

    await this.todoRepository.save(todo);

    await this.eventPublisher.publishAll(todo.domainEvents);
    todo.markEventsAsCommitted();

    return todo;
  }
}