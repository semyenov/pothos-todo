import { DomainEvent } from './DomainEvent.js';

export class UserCreated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly email: string,
    public readonly name: string | null,
    version: number = 1
  ) {
    super(aggregateId, 'UserCreated', version);
  }

  getEventData(): Record<string, any> {
    return {
      email: this.email,
      name: this.name,
    };
  }
}