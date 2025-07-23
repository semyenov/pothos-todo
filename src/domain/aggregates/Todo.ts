import { BaseAggregate } from '../core/BaseAggregate.js';
import { TodoCreated } from '../events/TodoCreated.js';
import { TodoCompleted } from '../events/TodoCompleted.js';
import { TodoDeleted } from '../events/TodoDeleted.js';
import { TodoAssigned } from '../events/TodoAssigned.js';
import { TodoUpdated } from '../events/TodoUpdated.js';
import { Priority as PrismaPriority, TodoStatus as PrismaTodoStatus } from '@prisma/client';
import { DueDate } from '../value-objects/DueDate.js';

export class Todo extends BaseAggregate {
  private _title: string;
  private _status: PrismaTodoStatus;
  private _priority: PrismaPriority;
  private _dueDate: Date | null;
  private _description: string | null;
  private _completedAt: Date | null;
  private _userId: string;
  private _todoListId: string | null;
  private _tags: string[];

  constructor(
    id: string,
    title: string,
    userId: string,
    todoListId: string | null,
    status: PrismaTodoStatus = PrismaTodoStatus.PENDING,
    priority: PrismaPriority = PrismaPriority.MEDIUM,
    dueDate: Date | null = null,
    description: string | null = null,
    tags: string[] = [],
    completedAt: Date | null = null,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    version: number = 0,
  ) {
    super(id, createdAt, updatedAt, version);
    this._title = title;
    this._status = status;
    this._priority = priority;
    this._dueDate = dueDate;
    this._completedAt = completedAt;
    this._userId = userId;
    this._todoListId = todoListId;
    this._description = description;
    this._tags = tags;
  }

  public static create(
    id: string,
    title: string,
    userId: string,
    todoListId: string | null = null,
    priority: PrismaPriority = PrismaPriority.MEDIUM,
    dueDate: Date,
    description: string | null = null,
    tags: string[] = [],
    status: PrismaTodoStatus = PrismaTodoStatus.PENDING,
    completedAt: Date | null = null,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
  ): Todo {
    const todo = new Todo(
      id,
      title,
      userId,
      todoListId,
      status,
      priority,
      dueDate,
      description,
      tags,
      completedAt,
      createdAt,
      updatedAt,
      0, // Initial version
    );

    todo.addDomainEvent(
      new TodoCreated(
        id,
        title,
        userId,
        todoListId,
        status,
        priority,
        tags,
        dueDate,
        description,
        completedAt,
        new Date(),
        createdAt,
        updatedAt,
        1,
      )
    );

    return todo;
  }

  get title(): string {
    return this._title;
  }

  get status(): PrismaTodoStatus {
    return this._status;
  }

  get priority(): PrismaPriority {
    return this._priority;
  }

  get dueDate(): Date | null {
    return this._dueDate;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  get userId(): string {
    return this._userId;
  }

  get todoListId(): string | null {
    return this._todoListId;
  }


  get description(): string | null {
    return this._description;
  }

  get tags(): string[] {
    return this._tags;
  }

  public update(
    title?: string,
    priority?: PrismaPriority,
    dueDate?: Date | null,
    description?: string | null,
    tags?: string[],
    status?: PrismaTodoStatus,
    completedAt?: Date | null,
    updatedBy?: string,
  ): void {
    // Track what fields actually changed for the event
    const changedFields: Record<string, any> = {};
    const previousValues = {
      title: this._title,
      priority: this._priority,
      status: this._status,
      dueDate: this._dueDate,
      tags: this._tags,
      description: this._description,
      completedAt: this._completedAt,
    };

    // Use BaseAggregate's updateFields method
    const hasChanges = this.updateFields({
      title,
      priority,
      status,
      dueDate,
      tags,
      description,
      completedAt,
    });

    if (hasChanges) {
      // Build the changed fields for the event
      if (title !== undefined && title !== previousValues.title) {
        changedFields.title = title;
      }
      if (priority !== undefined && priority !== previousValues.priority) {
        changedFields.priority = priority;
      }
      if (status !== undefined && status !== previousValues.status) {
        changedFields.status = status;
      }
      if (dueDate !== undefined && dueDate !== previousValues.dueDate) {
        changedFields.dueDate = dueDate;
      }
      if (tags !== undefined && tags !== previousValues.tags) {
        changedFields.tags = tags;
      }
      if (description !== undefined && description !== previousValues.description) {
        changedFields.description = description;
      }
      if (completedAt !== undefined && completedAt !== previousValues.completedAt) {
        changedFields.completedAt = completedAt;
      }
      if (updatedBy) {
        changedFields.updatedBy = updatedBy;
      }

      this.addDomainEvent(
        new TodoUpdated(
          this.id,
          changedFields,
          updatedBy || this._userId,
          this.version
        )
      );
    }
  }

  public complete(userId: string, completedAt: Date | null = null): void {
    if (this._status === PrismaTodoStatus.COMPLETED) {
      throw new Error('Todo is already completed');
    }

    if (this._status !== PrismaTodoStatus.PENDING) {
      throw new Error(`Cannot complete todo from ${this._status} status`);
    }

    const completionDate = completedAt || new Date();
    
    // Use updateFields to track changes and update timestamp
    this.updateFields({
      status: PrismaTodoStatus.COMPLETED,
      completedAt: completionDate,
    });

    this.addDomainEvent(
      new TodoCompleted(
        this.id,
        completionDate,
        userId,
        this.version
      )
    );
  }

  public cancel(): void {
    if (this._status === PrismaTodoStatus.COMPLETED) {
      throw new Error('Cannot cancel completed todo');
    }

    if (this._status !== PrismaTodoStatus.PENDING) {
      throw new Error(`Cannot cancel todo from ${this._status} status`);
    }

    // Use updateFields to track changes and update timestamp
    this.updateFields({
      status: PrismaTodoStatus.CANCELLED,
    });

    this.addDomainEvent(
      new TodoUpdated(
        this.id,
        { status: PrismaTodoStatus.CANCELLED },
        this._userId,
        this.version
      )
    );
  }

  public assignToList(todoListId: string | null, assignedBy: string): void {
    if (this._todoListId === todoListId) {
      return;
    }

    // Use updateFields to track changes and update timestamp
    this.updateFields({
      todoListId,
    });

    this.addDomainEvent(
      new TodoAssigned(
        this.id,
        this._userId,
        assignedBy,
        todoListId,
        this._tags,
        this.version
      )
    );
  }

  public delete(deletedBy: string): void {
    this.addDomainEvent(
      new TodoDeleted(
        this.id,
        deletedBy,
        this.version
      )
    );
  }

  public isOverdue(): boolean {
    if (!this._dueDate) return false;
    return new DueDate(this._dueDate).isOverdue();
  }

  public isDueToday(): boolean {
    if (!this._dueDate) return false;
    return new DueDate(this._dueDate).isDueToday();
  }

  public isDueSoon(daysThreshold: number = 3): boolean {
    if (!this._dueDate) return false;
    return new DueDate(this._dueDate).isDueSoon(daysThreshold);
  }

  /**
   * Implement the abstract validate method from BaseAggregate
   */
  protected validate(): void {
    this.ensureNotEmpty(this._title, 'title');
    this.ensureNotEmpty(this._userId, 'userId');
    
    // Ensure title length is reasonable
    if (this._title.length > 200) {
      throw new Error('Title must not exceed 200 characters');
    }
    
    // Ensure description length is reasonable
    if (this._description && this._description.length > 1000) {
      throw new Error('Description must not exceed 1000 characters');
    }
    
    // Validate tags
    if (this._tags.length > 10) {
      throw new Error('Cannot have more than 10 tags');
    }
  }
}