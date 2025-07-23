/**
 * Central export for all domain events.
 * This makes it easier to import events and ensures consistency.
 */

// Base event class
export { DomainEvent } from './DomainEvent.js';

// Todo events
export { TodoCreated } from './TodoCreated.js';
export { TodoUpdated } from './TodoUpdated.js';
export { TodoCompleted } from './TodoCompleted.js';
export { TodoDeleted } from './TodoDeleted.js';
export { TodoAssigned } from './TodoAssigned.js';

// TodoList events
export { TodoListCreated } from './TodoListCreated.js';
export { TodoListUpdated } from './TodoListUpdated.js';
export { TodoListDeleted } from './TodoListDeleted.js';

// User events
export { UserCreated } from './UserCreated.js';
export { UserUpdated } from './UserUpdated.js';

/**
 * Event type constants for easy reference
 */
export const EventTypes = {
  // Todo events
  TODO_CREATED: 'TodoCreated',
  TODO_UPDATED: 'TodoUpdated',
  TODO_COMPLETED: 'TodoCompleted',
  TODO_DELETED: 'TodoDeleted',
  TODO_ASSIGNED: 'TodoAssigned',
  
  // TodoList events
  TODO_LIST_CREATED: 'TodoListCreated',
  TODO_LIST_UPDATED: 'TodoListUpdated',
  TODO_LIST_DELETED: 'TodoListDeleted',
  
  // User events
  USER_CREATED: 'UserCreated',
  USER_UPDATED: 'UserUpdated',
} as const;

/**
 * Type helper for all event types
 */
export type DomainEventType = 
  | TodoCreated
  | TodoUpdated
  | TodoCompleted
  | TodoDeleted
  | TodoAssigned
  | TodoListCreated
  | TodoListUpdated
  | TodoListDeleted
  | UserCreated
  | UserUpdated;