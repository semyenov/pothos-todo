import { DomainEvent } from './DomainEvent.js';

export class TodoListDeleted extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly deletedBy: string,
    version: number = 1
  ) {
    super(aggregateId, 'TodoListDeleted', version);
  }

  getEventData(): Record<string, any> {
    return {
      deletedBy: this.deletedBy,
    };
  }
}