import { PrismaClient, type DomainEvent as PrismaDomainEvent } from '@prisma/client';
import type { IEventStore, StoredEvent } from './EventStore.js';
import { DomainEvent } from '../../domain/events/DomainEvent.js';
import type { JsonObject } from '@prisma/client/runtime/library';

export class PrismaEventStore implements IEventStore {
  constructor(private readonly prisma: PrismaClient) { }

  async append(event: DomainEvent): Promise<void> {
    await this.prisma.domainEvent.create({
      data: {
        id: event.eventId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        eventData: event.getEventData(),
        version: event.version,
        createdAt: event.occurredAt,
      },
    });
  }

  async appendAll(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    const eventData = events.map(event => ({
      id: event.eventId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      eventData: event.getEventData(),
      version: event.version,
      createdAt: event.occurredAt,
    }));

    await this.prisma.domainEvent.createMany({
      data: eventData,
    });
  }

  async getEvents(aggregateId: string, fromVersion: number = 0, limit?: number): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      where: {
        aggregateId,
        version: { gte: fromVersion }
      },
      orderBy: { version: 'asc' },
      take: limit,
    });

    return events.map(this.mapToStoredEvent);
  }

  async getEventsFromVersion(aggregateId: string, fromVersion: number): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      where: {
        aggregateId,
        version: { gte: fromVersion },
      },
      orderBy: { version: 'asc' },
    });

    return events.map(this.mapToStoredEvent);
  }

  async getAllEvents(): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return events.map(this.mapToStoredEvent);
  }

  async getEventsByType(eventType: string): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      where: { eventType },
      orderBy: { createdAt: 'asc' },
    });

    return events.map(this.mapToStoredEvent);
  }

  async getEventsAfterPosition(position: number, limit: number): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      skip: position,
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    return events.map(this.mapToStoredEvent);
  }

  async getEventsByTimeRange(start: Date, end: Date): Promise<StoredEvent[]> {
    const events = await this.prisma.domainEvent.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return events.map(this.mapToStoredEvent);
  }

  private mapToStoredEvent(event: PrismaDomainEvent): StoredEvent {
    const {
      eventData,
      id,
      eventType,
      aggregateId,
      version,
      createdAt,
    } = event;

    return {
      id,
      eventType,
      aggregateId,
      eventData,
      version,
      createdAt,
    };
  }

  private mapToDomainEvent = (event: PrismaDomainEvent): DomainEvent => {
    // Create a minimal DomainEvent implementation for stored events
    class StoredDomainEvent extends DomainEvent {
      getEventData(): JsonObject {
        return event.eventData as JsonObject;
      }
    }

    return new StoredDomainEvent(
      event.aggregateId,
      event.eventType,
      event.version,
      event.id,
      {
        title: 'Event #' + event.id,
        userId: 'User #' + event.id,
        assigneeIds: ['User #' + event.id],
        requiresNotification: true,
      },
      event.createdAt,
      event.createdAt,
      event.createdAt
    );
  }
}