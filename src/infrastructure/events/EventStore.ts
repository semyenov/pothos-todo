import { DomainEvent } from '../../domain/events/DomainEvent.js';
import type { JsonValue } from '@prisma/client/runtime/library';

export interface StoredEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  eventData: JsonValue;
  version: number;
  createdAt: Date;
}

export interface IEventStore {
  append(event: DomainEvent): Promise<void>;
  appendAll(events: DomainEvent[]): Promise<void>;
  getEvents(aggregateId: string): Promise<StoredEvent[]>;
  getEventsFromVersion(aggregateId: string, fromVersion: number): Promise<StoredEvent[]>;
  getAllEvents(): Promise<StoredEvent[]>;
  getEventsByType(eventType: string): Promise<StoredEvent[]>;
}