import { DomainEvent } from './DomainEvent.js';

export class TodoListUpdated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly title?: string,
    public readonly description?: string | null,
    public readonly updatedBy?: string,
    version: number = 1
  ) {
    super(aggregateId, 'TodoListUpdated', version);
  }

  getEventData(): Record<string, any> {
    return {
      title: this.title,
      description: this.description,
      updatedBy: this.updatedBy,
    };
  }
}