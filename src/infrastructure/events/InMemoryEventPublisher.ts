import type { IEventPublisher } from './EventPublisher.js';
import type { IEventStore } from './EventStore.js';
import { DomainEvent } from '../../domain/events/DomainEvent.js';
import { EventEmitter } from 'events';

export class InMemoryEventPublisher extends EventEmitter implements IEventPublisher {
  constructor(private readonly eventStore: IEventStore) {
    super();
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.eventStore.append(event);

    this.emit('domainEvent', event);
    this.emit(event.eventType, event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.eventStore.appendAll(events);

    for (const event of events) {
      this.emit('domainEvent', event);
      this.emit(event.eventType, event);
    }
  }

  onDomainEvent(callback: (event: DomainEvent) => void): void {
    this.on('domainEvent', callback);
  }

  onEventType(eventType: string, callback: (event: DomainEvent) => void): void {
    this.on(eventType, callback);
  }
}