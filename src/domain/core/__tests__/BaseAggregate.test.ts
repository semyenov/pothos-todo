import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseAggregate, SoftDeletableAggregate, AuditableAggregate } from '../BaseAggregate';
import { DomainEvent } from '../../events/DomainEvent';

// Test event implementation
class TestEvent extends DomainEvent {
  constructor(aggregateId: string) {
    super(aggregateId, 'TestEvent', 1);
  }
  
  getEventData() {
    return {};
  }
}

// Test aggregate implementation
class TestAggregate extends BaseAggregate {
  private _name: string;
  private _value: number;

  constructor(
    id: string,
    name: string,
    value: number,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    version: number = 0
  ) {
    super(id, createdAt, updatedAt, version);
    this._name = name;
    this._value = value;
  }

  get name(): string {
    return this._name;
  }

  get value(): number {
    return this._value;
  }

  update(updates: { name?: string; value?: number }): boolean {
    const wasUpdated = this.updateFields(updates);
    if (wasUpdated) {
      this.addDomainEvent(new TestEvent(this.id));
    }
    return wasUpdated;
  }

  protected validate(): void {
    this.ensureNotEmpty(this._name, 'name');
    this.ensureInRange(this._value, 0, 100, 'value');
  }
}

// Soft deletable test aggregate
class SoftDeletableTestAggregate extends SoftDeletableAggregate {
  private _name: string;

  constructor(id: string, name: string) {
    super(id, new Date(), new Date(), 0);
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  delete(): void {
    this.softDelete(new TestEvent(this.id));
  }

  restore(): void {
    super.restore(new TestEvent(this.id));
  }

  protected validate(): void {
    // No validation needed for test
  }
}

// Auditable test aggregate
class AuditableTestAggregate extends AuditableAggregate {
  private _name: string;

  constructor(id: string, name: string, createdBy: string) {
    super(id, new Date(), new Date(), createdBy);
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  updateName(name: string, updatedBy: string): boolean {
    return this.updateFieldsWithAudit({ name }, updatedBy);
  }

  protected validate(): void {
    // No validation needed for test
  }
}

describe('BaseAggregate', () => {
  describe('Basic functionality', () => {
    let aggregate: TestAggregate;

    beforeEach(() => {
      aggregate = new TestAggregate('123', 'Test', 42);
    });

    it('should initialize with correct values', () => {
      expect(aggregate.id).toBe('123');
      expect(aggregate.name).toBe('Test');
      expect(aggregate.value).toBe(42);
      expect(aggregate.version).toBe(0);
    });

    it('should update fields when values change', () => {
      const oldUpdatedAt = aggregate.updatedAt;
      
      // Wait a bit to ensure timestamp changes
      setTimeout(() => {
        const wasUpdated = aggregate.update({ name: 'Updated', value: 50 });
        
        expect(wasUpdated).toBe(true);
        expect(aggregate.name).toBe('Updated');
        expect(aggregate.value).toBe(50);
        expect(aggregate.version).toBe(1);
        expect(aggregate.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
      }, 10);
    });

    it('should not update when values are the same', () => {
      const oldUpdatedAt = aggregate.updatedAt;
      const oldVersion = aggregate.version;
      
      const wasUpdated = aggregate.update({ name: 'Test', value: 42 });
      
      expect(wasUpdated).toBe(false);
      expect(aggregate.version).toBe(oldVersion);
      expect(aggregate.updatedAt).toBe(oldUpdatedAt);
    });

    it('should skip undefined values in updates', () => {
      const wasUpdated = aggregate.update({ name: 'NewName', value: undefined });
      
      expect(wasUpdated).toBe(true);
      expect(aggregate.name).toBe('NewName');
      expect(aggregate.value).toBe(42); // Unchanged
    });

    it('should track domain events', () => {
      aggregate.update({ name: 'Updated' });
      
      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('TestEvent');
      expect(events[0].aggregateId).toBe('123');
    });

    it('should clear domain events', () => {
      aggregate.update({ name: 'Updated' });
      aggregate.clearEvents();
      
      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('Validation helpers', () => {
    it('should validate not null', () => {
      const aggregate = new TestAggregate('123', 'Test', 42);
      
      expect(() => {
        aggregate['ensureNotNull'](null, 'field');
      }).toThrow('field cannot be null or undefined');
    });

    it('should validate not empty', () => {
      const aggregate = new TestAggregate('123', 'Test', 42);
      
      expect(() => {
        aggregate['ensureNotEmpty']('', 'field');
      }).toThrow('field cannot be empty');
      
      expect(() => {
        aggregate['ensureNotEmpty']('   ', 'field');
      }).toThrow('field cannot be empty');
    });

    it('should validate in range', () => {
      const aggregate = new TestAggregate('123', 'Test', 42);
      
      expect(() => {
        aggregate['ensureInRange'](150, 0, 100, 'value');
      }).toThrow('value must be between 0 and 100');
      
      expect(() => {
        aggregate['ensureInRange'](-10, 0, 100, 'value');
      }).toThrow('value must be between 0 and 100');
    });
  });

  describe('SoftDeletableAggregate', () => {
    let aggregate: SoftDeletableTestAggregate;

    beforeEach(() => {
      aggregate = new SoftDeletableTestAggregate('123', 'Test');
    });

    it('should soft delete', () => {
      expect(aggregate.isDeleted).toBe(false);
      expect(aggregate.deletedAt).toBeUndefined();
      
      aggregate.delete();
      
      expect(aggregate.isDeleted).toBe(true);
      expect(aggregate.deletedAt).toBeDefined();
      expect(aggregate.version).toBe(1);
      
      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(1);
    });

    it('should prevent double deletion', () => {
      aggregate.delete();
      
      expect(() => {
        aggregate.delete();
      }).toThrow('Entity is already deleted');
    });

    it('should restore soft-deleted entity', () => {
      aggregate.delete();
      aggregate.clearEvents();
      
      aggregate.restore();
      
      expect(aggregate.isDeleted).toBe(false);
      expect(aggregate.deletedAt).toBeUndefined();
      expect(aggregate.version).toBe(2);
      
      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(1);
    });

    it('should prevent updates on deleted entities', () => {
      aggregate.delete();
      
      expect(() => {
        aggregate['updateFields']({ name: 'NewName' });
      }).toThrow('Cannot update a deleted entity');
    });
  });

  describe('AuditableAggregate', () => {
    let aggregate: AuditableTestAggregate;

    beforeEach(() => {
      aggregate = new AuditableTestAggregate('123', 'Test', 'user1');
    });

    it('should track creator', () => {
      expect(aggregate.createdBy).toBe('user1');
      expect(aggregate.updatedBy).toBeUndefined();
    });

    it('should track updater when fields change', () => {
      const wasUpdated = aggregate.updateName('Updated', 'user2');
      
      expect(wasUpdated).toBe(true);
      expect(aggregate.name).toBe('Updated');
      expect(aggregate.updatedBy).toBe('user2');
    });

    it('should not update audit info when no changes', () => {
      const wasUpdated = aggregate.updateName('Test', 'user2');
      
      expect(wasUpdated).toBe(false);
      expect(aggregate.updatedBy).toBeUndefined();
    });
  });
});