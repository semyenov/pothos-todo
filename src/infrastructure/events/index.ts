// Events Infrastructure
export type { IDomainEventHandler } from './DomainEventHandler.js';
export { EventBus } from './EventBus.js';
export { EventHandlerRegistry } from './EventHandlerRegistry.js';
export type { IEventPublisher as IEventPublisher } from './EventPublisher.js';
export type { IEventStore as IEventStore } from './EventStore.js';
export { InMemoryEventPublisher } from './InMemoryEventPublisher.js';
export { PrismaEventStore } from './PrismaEventStore.js';

// Export adapters
export { RabbitMQAdapter } from './adapters/RabbitMQAdapter.js';
export { RedisAdapter } from './adapters/RedisAdapter.js';

// Export handlers
export { RealtimeEventHandler } from './handlers/RealtimeEventHandler.js';
export { TodoCompletedHandler } from './handlers/TodoCompletedHandler.js';
export { TodoCreatedHandler } from './handlers/TodoCreatedHandler.js';
export { TodoDeletedHandler } from './handlers/TodoDeletedHandler.js';
export { TodoEmbeddingHandler } from './handlers/TodoEmbeddingHandler.js';
export { TodoUpdatedHandler } from './handlers/TodoUpdatedHandler.js';