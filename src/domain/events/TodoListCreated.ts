import { DomainEvent } from './DomainEvent.js';

export class TodoListCreated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly title: string,
    public readonly description: string | null,
    public readonly userId: string,
    version: number = 1
  ) {
    super(aggregateId, 'TodoListCreated', version);
  }

  getEventData(): Record<string, any> {
    return {
      title: this.title,
      description: this.description,
      userId: this.userId,
    };
  }
}