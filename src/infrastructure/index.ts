// Infrastructure Layer Exports
// Container
export { Container } from './container/Container.js'

// Events
export { EventHandlerRegistry } from './events/EventHandlerRegistry.js'
export type { IEventPublisher as EventPublisher } from './events/EventPublisher.js'
export type { IEventStore, StoredEvent } from './events/EventStore.js'
export { InMemoryEventPublisher } from './events/InMemoryEventPublisher.js'
export { PrismaEventStore } from './events/PrismaEventStore.js'

// Event Handlers
export { TodoCompletedHandler } from './events/handlers/TodoCompletedHandler.js'
export { TodoCreatedHandler } from './events/handlers/TodoCreatedHandler.js'
export { TodoUpdatedHandler } from './events/handlers/TodoUpdatedHandler.js'

// Persistence
export { PrismaTodoRepository } from './persistence/PrismaTodoRepository.js'
export { PrismaTodoListRepository } from './persistence/PrismaTodoListRepository.js'
export { PrismaUserRepository } from './persistence/PrismaUserRepository.js'

// Advanced Infrastructure Services
export * from './ai/index.js'
export * from './security/index.js'
export * from './edge/index.js'
export * from './observability/index.js'
export * from './collaboration/index.js'
export * from './monitoring/index.js'
export * from './cache/index.js'
export * from './backup/index.js'

// Projections (when implemented)
// export * from './projections/index.js'