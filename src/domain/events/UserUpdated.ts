import { DomainEvent } from './DomainEvent.js';

export class UserUpdated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly email?: string,
    public readonly name?: string | null,
    public readonly role?: string,
    public readonly permissions?: string[],
    version: number = 1
  ) {
    super(aggregateId, 'UserUpdated', version);
  }

  getEventData(): Record<string, any> {
    return {
      email: this.email,
      name: this.name,
      role: this.role,
      permissions: this.permissions,
    };
  }
}