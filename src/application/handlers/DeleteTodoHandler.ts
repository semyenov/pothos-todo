import { DeleteTodoCommand } from '../commands/DeleteTodoCommand.js';
import type { TodoRepository } from '../../domain/repositories/TodoRepository.js';
import type { IEventPublisher } from '../../infrastructure/events/EventPublisher.js';
import { logger } from '../../logger.js';

export class DeleteTodoHandler {
  constructor(
    private readonly todoRepository: TodoRepository,
    private readonly eventPublisher: IEventPublisher
  ) { }

  async handle(command: DeleteTodoCommand): Promise<void> {
    logger.debug('Handling delete todo command', {
      todoId: command.id,
      userId: command.userId
    });

    const todo = await this.todoRepository.findById(command.id);
    if (!todo) {
      logger.warn('Todo not found', { todoId: command.id });
      throw new Error('Todo not found');
    }

    if (todo.userId !== command.userId) {
      logger.warn('Unauthorized delete attempt', {
        todoId: command.id,
        requestedBy: command.userId,
        ownedBy: todo.userId
      });
      throw new Error('Unauthorized to delete this todo');
    }

    todo.delete(command.userId);

    await this.todoRepository.delete(command.id);

    await this.eventPublisher.publishAll(todo.domainEvents);
    todo.markEventsAsCommitted();

    logger.info('Todo deleted successfully', {
      todoId: command.id,
      userId: command.userId
    });
  }
}