import { DomainEvent } from '../../domain/events/DomainEvent.js';

export interface IEventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: DomainEvent[]): Promise<void>;
}