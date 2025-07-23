import { DomainEvent } from '../events/DomainEvent.js';

/**
 * Base class for all domain aggregates.
 * Provides common functionality for update tracking, domain events, and field updates.
 * This eliminates ~20 conditional blocks of duplicated update logic across aggregates.
 */
export abstract class BaseAggregate {
  protected _id: string;
  protected _createdAt: Date;
  protected _updatedAt: Date;
  protected _version: number;
  private _domainEvents: DomainEvent[] = [];

  constructor(id: string, createdAt: Date, updatedAt: Date, version: number = 0) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._version = version;
  }

  get id(): string {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get version(): number {
    return this._version;
  }

  /**
   * Update multiple fields at once with automatic change tracking.
   * Only updates fields that have actually changed.
   * 
   * @param updates - Object containing field updates
   * @returns Whether any fields were actually updated
   * 
   * @example
   * const wasUpdated = this.updateFields({
   *   title: newTitle,
   *   description: newDescription,
   *   priority: newPriority
   * });
   */
  protected updateFields<T extends Record<string, any>>(updates: T): boolean {
    let hasChanges = false;

    for (const [key, value] of Object.entries(updates)) {
      // Skip undefined values
      if (value === undefined) {
        continue;
      }

      // Check if the value actually changed
      const currentValue = (this as any)[`_${key}`];
      if (value !== currentValue) {
        (this as any)[`_${key}`] = value;
        hasChanges = true;
      }
    }

    // Update timestamp if there were changes
    if (hasChanges) {
      this._updatedAt = new Date();
      this._version++;
    }

    return hasChanges;
  }

  /**
   * Helper method to check if a single field would change
   */
  protected wouldFieldChange(fieldName: string, newValue: any): boolean {
    const currentValue = (this as any)[`_${fieldName}`];
    return newValue !== undefined && newValue !== currentValue;
  }

  /**
   * Add a domain event to be published
   */
  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /**
   * Get all uncommitted domain events
   */
  getUncommittedEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  /**
   * Clear all domain events (typically called after publishing)
   */
  clearEvents(): void {
    this._domainEvents = [];
  }

  /**
   * Mark the aggregate as deleted by adding a deletion event
   */
  protected markAsDeleted(deletionEvent: DomainEvent): void {
    this.addDomainEvent(deletionEvent);
  }

  /**
   * Get the current timestamp. Can be overridden for testing.
   */
  protected getCurrentTimestamp(): Date {
    return new Date();
  }

  /**
   * Validate that the aggregate is in a valid state.
   * Should be overridden by subclasses with specific validation logic.
   */
  protected abstract validate(): void;

  /**
   * Helper to ensure a value is not null or undefined
   */
  protected ensureNotNull<T>(value: T | null | undefined, fieldName: string): T {
    if (value === null || value === undefined) {
      throw new Error(`${fieldName} cannot be null or undefined`);
    }
    return value;
  }

  /**
   * Helper to ensure a string is not empty
   */
  protected ensureNotEmpty(value: string, fieldName: string): string {
    this.ensureNotNull(value, fieldName);
    if (value.trim().length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }
    return value;
  }

  /**
   * Helper to ensure a number is within a range
   */
  protected ensureInRange(
    value: number,
    min: number,
    max: number,
    fieldName: string
  ): number {
    if (value < min || value > max) {
      throw new Error(`${fieldName} must be between ${min} and ${max}`);
    }
    return value;
  }
}

/**
 * Extended base aggregate with support for soft deletion
 */
export abstract class SoftDeletableAggregate extends BaseAggregate {
  protected _deletedAt?: Date;
  protected _isDeleted: boolean = false;

  get deletedAt(): Date | undefined {
    return this._deletedAt;
  }

  get isDeleted(): boolean {
    return this._isDeleted;
  }

  /**
   * Soft delete the aggregate
   */
  protected softDelete(deletionEvent: DomainEvent): void {
    if (this._isDeleted) {
      throw new Error('Entity is already deleted');
    }

    this._isDeleted = true;
    this._deletedAt = this.getCurrentTimestamp();
    this._updatedAt = this._deletedAt;
    this._version++;

    this.addDomainEvent(deletionEvent);
  }

  /**
   * Restore a soft-deleted aggregate
   */
  protected restore(restorationEvent?: DomainEvent): void {
    if (!this._isDeleted) {
      throw new Error('Entity is not deleted');
    }

    this._isDeleted = false;
    this._deletedAt = undefined;
    this._updatedAt = this.getCurrentTimestamp();
    this._version++;

    if (restorationEvent) {
      this.addDomainEvent(restorationEvent);
    }
  }

  /**
   * Override updateFields to prevent updates on deleted entities
   */
  protected updateFields<T extends Record<string, any>>(updates: T): boolean {
    if (this._isDeleted) {
      throw new Error('Cannot update a deleted entity');
    }
    return super.updateFields(updates);
  }
}

/**
 * Base aggregate with audit trail support
 */
export abstract class AuditableAggregate extends BaseAggregate {
  protected _createdBy: string;
  protected _updatedBy?: string;

  constructor(
    id: string,
    createdAt: Date,
    updatedAt: Date,
    createdBy: string,
    updatedBy?: string,
    version: number = 0
  ) {
    super(id, createdAt, updatedAt, version);
    this._createdBy = createdBy;
    this._updatedBy = updatedBy;
  }

  get createdBy(): string {
    return this._createdBy;
  }

  get updatedBy(): string | undefined {
    return this._updatedBy;
  }

  /**
   * Update fields with audit information
   */
  protected updateFieldsWithAudit<T extends Record<string, any>>(
    updates: T,
    updatedBy: string
  ): boolean {
    const hasChanges = super.updateFields(updates);
    
    if (hasChanges) {
      this._updatedBy = updatedBy;
    }

    return hasChanges;
  }
}