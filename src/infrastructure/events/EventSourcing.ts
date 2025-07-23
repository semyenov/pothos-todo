import { DomainEvent } from '@/domain/events/DomainEvent.js';
import { AggregateRoot } from '@/domain/aggregates/base/AggregateRoot.js';
import type { IEventStore } from './EventStore.js';
import { logger } from '@/logger.js';

export interface Snapshot<T = any> {
  aggregateId: string;
  aggregateType: string;
  version: number;
  data: T;
  timestamp: Date;
}

export interface SnapshotStore {
  save(snapshot: Snapshot): Promise<void>;
  load(aggregateId: string): Promise<Snapshot | null>;
  delete(aggregateId: string): Promise<void>;
}

export interface ProjectionState {
  projectionName: string;
  lastProcessedPosition: number;
  lastProcessedTimestamp: Date;
  checkpoint: Record<string, any>;
}

export interface Projection {
  name: string;

  /**
   * Handle an event and update the projection
   */
  handle(event: DomainEvent): Promise<void>;

  /**
   * Initialize or reset the projection
   */
  initialize?(): Promise<void>;

  /**
   * Get current state of the projection
   */
  getState?(): Promise<ProjectionState>;
}

/**
 * Event Sourcing Repository with snapshot support
 */
export abstract class EventSourcedRepository<T extends AggregateRoot> {
  constructor(
    protected eventStore: IEventStore,
    protected snapshotStore?: SnapshotStore,
    protected snapshotFrequency: number = 10
  ) { }

  /**
   * Load an aggregate from events (with optional snapshot)
   */
  async load(aggregateId: string): Promise<T | null> {
    let aggregate: T;
    let fromVersion = 0;

    // Try to load from snapshot
    if (this.snapshotStore) {
      const snapshot = await this.snapshotStore.load(aggregateId);
      if (snapshot) {
        aggregate = this.createFromSnapshot(snapshot);
        fromVersion = snapshot.version + 1;

        logger.debug(`Loaded aggregate from snapshot`, {
          aggregateId,
          snapshotVersion: snapshot.version,
        });
      }
    }

    // Load events after snapshot (or all events if no snapshot)
    const events = await this.eventStore.getEvents(aggregateId, fromVersion);

    if (events.length === 0 && !aggregate!) {
      return null; // Aggregate doesn't exist
    }

    // Create aggregate if not loaded from snapshot
    if (!aggregate!) {
      aggregate = this.createEmptyAggregate(aggregateId);
    }

    // Apply events to rebuild state
    for (const event of events) {
      this.applyEvent(aggregate, event);
    }

    logger.debug(`Loaded aggregate from events`, {
      aggregateId,
      eventCount: events.length,
      finalVersion: aggregate.version,
    });

    return aggregate;
  }

  /**
   * Save an aggregate (persist new events and optionally create snapshot)
   */
  async save(aggregate: T): Promise<void> {
    const events = aggregate.getUncommittedEvents();

    if (events.length === 0) {
      return; // No changes to save
    }

    // Persist events
    for (const event of events) {
      await this.eventStore.append(event);
    }

    // Clear uncommitted events after successful save
    aggregate.markEventsAsCommitted();

    // Create snapshot if threshold reached
    if (this.snapshotStore && aggregate.version % this.snapshotFrequency === 0) {
      await this.createSnapshot(aggregate);
    }

    logger.debug(`Saved aggregate`, {
      aggregateId: aggregate.id,
      eventCount: events.length,
      version: aggregate.version,
    });
  }

  /**
   * Create a snapshot of the aggregate
   */
  private async createSnapshot(aggregate: T): Promise<void> {
    const snapshot: Snapshot = {
      aggregateId: aggregate.id,
      aggregateType: this.getAggregateType(),
      version: aggregate.version,
      data: this.serializeAggregate(aggregate),
      timestamp: new Date(),
    };

    await this.snapshotStore!.save(snapshot);

    logger.info(`Created snapshot`, {
      aggregateId: aggregate.id,
      version: aggregate.version,
    });
  }

  /**
   * Get aggregate type name
   */
  protected abstract getAggregateType(): string;

  /**
   * Create empty aggregate instance
   */
  protected abstract createEmptyAggregate(id: string): T;

  /**
   * Create aggregate from snapshot
   */
  protected abstract createFromSnapshot(snapshot: Snapshot): T;

  /**
   * Serialize aggregate for snapshot
   */
  protected abstract serializeAggregate(aggregate: T): any;

  /**
   * Apply an event to an aggregate
   */
  protected abstract applyEvent(aggregate: T, event: DomainEvent): void;
}

/**
 * In-memory snapshot store (for development)
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private snapshots: Map<string, Snapshot> = new Map();

  async save(snapshot: Snapshot): Promise<void> {
    this.snapshots.set(snapshot.aggregateId, { ...snapshot });
  }

  async load(aggregateId: string): Promise<Snapshot | null> {
    const snapshot = this.snapshots.get(aggregateId);
    return snapshot ? { ...snapshot } : null;
  }

  async delete(aggregateId: string): Promise<void> {
    this.snapshots.delete(aggregateId);
  }
}

/**
 * Projection Manager for managing read model projections
 */
export class ProjectionManager {
  private projections: Map<string, Projection> = new Map();
  private positions: Map<string, number> = new Map();
  private running = false;
  private processingInterval?: NodeJS.Timeout;

  constructor(
    private eventStore: IEventStore,
    private checkInterval: number = 1000 // Check for new events every second
  ) { }

  /**
   * Register a projection
   */
  registerProjection(projection: Projection): void {
    this.projections.set(projection.name, projection);
    logger.info(`Registered projection: ${projection.name}`);
  }

  /**
   * Start processing events for all projections
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Initialize projections
    for (const projection of this.projections.values()) {
      if (projection.initialize) {
        await projection.initialize();
      }

      // Load last processed position
      if (projection.getState) {
        const state = await projection.getState();
        this.positions.set(projection.name, state.lastProcessedPosition);
      } else {
        this.positions.set(projection.name, 0);
      }
    }

    // Start processing loop
    this.processingInterval = setInterval(() => {
      this.processNewEvents().catch(error => {
        logger.error('Error processing events for projections:', error);
      });
    }, this.checkInterval);

    logger.info('Projection manager started');
  }

  /**
   * Stop processing events
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    this.running = false;
    logger.info('Projection manager stopped');
  }

  /**
   * Process new events for all projections
   */
  private async processNewEvents(): Promise<void> {
    for (const [name, projection] of this.projections) {
      const lastPosition = this.positions.get(name) || 0;

      // Get new events since last position
      const events = await this.eventStore.getEventsAfterPosition(lastPosition, 100);

      if (events.length === 0) {
        continue;
      }

      logger.debug(`Processing ${events.length} events for projection ${name}`);

      for (const event of events) {
        try {
          await projection.handle(event);
          this.positions.set(name, event.position || lastPosition + 1);
        } catch (error) {
          logger.error(`Error handling event in projection ${name}:`, {
            error,
            eventId: event.eventId,
            eventType: event.eventType,
          });

          // Stop processing this projection on error
          break;
        }
      }
    }
  }

  /**
   * Rebuild a projection from the beginning
   */
  async rebuildProjection(projectionName: string): Promise<void> {
    const projection = this.projections.get(projectionName);
    if (!projection) {
      throw new Error(`Projection ${projectionName} not found`);
    }

    logger.info(`Rebuilding projection ${projectionName}`);

    // Initialize projection
    if (projection.initialize) {
      await projection.initialize();
    }

    // Reset position
    this.positions.set(projectionName, 0);

    // Process all events
    let position = 0;
    let hasMore = true;

    while (hasMore) {
      const events = await this.eventStore.getEventsAfterPosition(position, 1000);

      if (events.length === 0) {
        hasMore = false;
        break;
      }

      for (const event of events) {
        await projection.handle(event);
        position = event.position || position + 1;
      }

      this.positions.set(projectionName, position);

      logger.debug(`Processed batch for projection ${projectionName}`, {
        eventsProcessed: events.length,
        currentPosition: position,
      });
    }

    logger.info(`Projection ${projectionName} rebuilt successfully`);
  }
}

/**
 * Example Todo Count Projection
 */
export class TodoCountProjection implements Projection {
  name = 'TodoCount';
  private counts: Map<string, number> = new Map();

  async handle(event: DomainEvent): Promise<void> {
    const userId = event.metadata?.userId;
    if (!userId) return;

    switch (event.eventType) {
      case 'TodoCreated':
        this.counts.set(userId, (this.counts.get(userId) || 0) + 1);
        break;
      case 'TodoDeleted':
        this.counts.set(userId, Math.max((this.counts.get(userId) || 0) - 1, 0));
        break;
    }
  }

  async initialize(): Promise<void> {
    this.counts.clear();
  }

  getTodoCount(userId: string): number {
    return this.counts.get(userId) || 0;
  }
}

/**
 * Event replay utility for debugging and testing
 */
export class EventReplayer {
  constructor(private eventStore: IEventStore) { }

  /**
   * Replay events for an aggregate
   */
  async replayAggregate(
    aggregateId: string,
    handler: (event: DomainEvent) => void
  ): Promise<void> {
    const events = await this.eventStore.getEvents(aggregateId);

    for (const event of events) {
      handler(event);
    }
  }

  /**
   * Replay events within a time range
   */
  async replayTimeRange(
    start: Date,
    end: Date,
    handler: (event: DomainEvent) => void
  ): Promise<void> {
    const events = await this.eventStore.getEventsByTimeRange(start, end);

    for (const event of events) {
      handler(event);
    }
  }
}