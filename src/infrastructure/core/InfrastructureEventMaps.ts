import type { HealthCheckResult, HealthStatus, ServiceEventMap } from './TypedEventEmitter.js';

/**
 * Chaos Engineering System Event Map
 */
export interface ChaosEngineeringEventMap extends ServiceEventMap {
  // Experiment lifecycle events
  'experiment:created': { experiment: { id: string; name: string; type: string } };
  'experiment:started': { experimentId: string; targets: string[] };
  'experiment:completed': { experimentId: string; result: 'success' | 'failed' | 'rolled_back' };
  'experiment:failed': { experimentId: string; error: Error };
  'experiment:rollback': { experimentId: string; reason: string };

  // Chaos injection events
  'chaos:injected': { type: string; target: string; parameters: Record<string, any> };
  'chaos:cleared': { type: string; target: string };

  // Impact and monitoring events
  'impact:detected': { metric: string; value: number; threshold: number };
  'safeguard:triggered': { type: string; action: string; reason: string };
  'metrics:collected': { experimentId: string; metrics: Record<string, number> };
}

/**
 * Service Registry Event Map
 */
export interface ServiceRegistryEventMap extends ServiceEventMap {
  // Service lifecycle events
  'service:registered': { serviceId: string; name: string; host: string; port: number };
  'service:deregistered': { serviceId: string; reason?: string };
  'service:updated': { serviceId: string; updates: Record<string, any> };

  // Health check events
  'health:check': { serviceId: string; status: 'healthy' | 'unhealthy' | 'critical' };
  'health:changed': { serviceId: string; from: string; to: string; status: HealthStatus; checks: HealthCheckResult[] };
  'health:timeout': { serviceId: string; timeout: number };

  // Discovery events
  'discovery:refresh': { services: number; duration: number };
  'discovery:error': { error: Error; retrying: boolean };

  // Load balancing events
  'loadbalancer:selected': { serviceId: string; strategy: string };
  'loadbalancer:failed': { reason: string; fallback?: string };
}

/**
 * Service Mesh Event Map
 */
export interface ServiceMeshEventMap extends ServiceEventMap {
  // Traffic management events
  'traffic:routed': { from: string; to: string; method: string; path: string };
  'traffic:retry': { target: string; attempt: number; maxAttempts: number };
  'traffic:timeout': { target: string; duration: number };

  // Circuit breaker events
  'circuit:open': { service: string; failures: number; threshold: number };
  'circuit:half-open': { service: string };
  'circuit:close': { service: string; successCount: number };

  // Security events
  'security:authenticated': { method: string; principal: string };
  'security:authorized': { principal: string; resource: string; action: string };
  'security:denied': { principal: string; resource: string; reason: string };

  // Observability events
  'trace:started': { traceId: string; spanId: string; operation: string };
  'trace:completed': { traceId: string; duration: number };
  'metrics:exported': { count: number; endpoint: string };
}

/**
 * Message Broker Event Map
 */
export interface MessageBrokerEventMap extends ServiceEventMap {
  // Message lifecycle events
  'message:published': { topic: string; messageId: string; size: number };
  'message:consumed': { topic: string; messageId: string; consumer: string };
  'message:failed': { topic: string; messageId: string; error: Error };
  'message:retried': { topic: string; messageId: string; attempt: number };

  // Queue management events
  'queue:created': { name: string; type: 'standard' | 'priority' | 'dead-letter' };
  'queue:deleted': { name: string };
  'queue:full': { name: string; size: number; limit: number };

  // Event sourcing events
  'event:stored': { streamId: string; eventType: string; version: number };
  'event:replayed': { streamId: string; fromVersion: number; toVersion: number };
  'snapshot:created': { streamId: string; version: number };

  // Saga events
  'saga:started': { sagaId: string; type: string };
  'saga:step:completed': { sagaId: string; step: string };
  'saga:completed': { sagaId: string; duration: number };
  'saga:compensated': { sagaId: string; reason: string };
}

/**
 * CQRS Coordinator Event Map
 */
export interface CQRSCoordinatorEventMap extends ServiceEventMap {
  // Command events
  'command:received': { commandId: string; type: string; userId?: string };
  'command:validated': { commandId: string };
  'command:executed': { commandId: string; duration: number };
  'command:failed': { commandId: string; error: Error };

  // Query events
  'query:received': { queryId: string; type: string; complexity: number };
  'query:cached': { queryId: string; cacheKey: string };
  'query:executed': { queryId: string; duration: number; resultCount: number };

  // Event store events
  'eventstore:connected': { type: string; version: string };
  'eventstore:event': { aggregateId: string; eventType: string; version: number };
  'eventstore:snapshot': { aggregateId: string; version: number };

  // Projection events
  'projection:started': { name: string; fromPosition: number };
  'projection:updated': { name: string; position: number; events: number };
  'projection:completed': { name: string; duration: number };
  'projection:error': { name: string; error: Error; position: number };
}

/**
 * Read Model Manager Event Map
 */
export interface ReadModelManagerEventMap extends ServiceEventMap {
  // Model management events
  'model:created': { modelName: string; version: string };
  'model:updated': { modelName: string; records: number };
  'model:deleted': { modelName: string };

  // Projection processing events
  'projection:processed': { modelName: string; eventCount: number; duration: number };
  'projection:batch': { modelName: string; batchSize: number; processed: number };
  'projection:lag': { modelName: string; lag: number; threshold: number };

  // Cache events
  'cache:populated': { modelName: string; entries: number };
  'cache:invalidated': { modelName: string; reason: string };
  'cache:hit': { modelName: string; key: string };
  'cache:miss': { modelName: string; key: string };

  // Maintenance events
  'maintenance:vacuum': { modelName: string; duration: number; freed: number };
  'maintenance:archive': { modelName: string; records: number; age: number };
}

/**
 * Advanced Cache Manager Event Map
 */
export interface AdvancedCacheManagerEventMap extends ServiceEventMap {
  // Cache operations
  'cache:get': { key: string; hit: boolean; strategy: string };
  'cache:set': { key: string; size: number; ttl?: number };
  'cache:delete': { key: string; cascade: boolean };
  'cache:clear': { pattern?: string; count: number };

  // Eviction events
  'cache:evicted': { key: string; reason: 'ttl' | 'lru' | 'lfu' | 'size' };
  'cache:eviction:batch': { count: number; reason: string };

  // Warmup events
  'warmup:started': { keys: number };
  'warmup:progress': { completed: number; total: number };
  'warmup:completed': { duration: number; success: number; failed: number };

  // Tag-based invalidation
  'tags:invalidated': { tag: string; count: number };
  'tags:cascade': { from: string; to: string[]; count: number };

  // Persistence events
  'persistence:save': { entries: number; size: number };
  'persistence:load': { entries: number; duration: number };
  'persistence:error': { operation: string; error: Error };

  // Performance monitoring
  'performance:stats': {
    hitRate: number;
    missRate: number;
    evictionRate: number;
    averageGetTime: number;
  };
}

/**
 * Schema Generator Event Map
 */
export interface SchemaGeneratorEventMap extends ServiceEventMap {
  // Generation events
  'schema:generating': { source: string; format: string };
  'schema:generated': { source: string; output: string; size: number };
  'schema:error': { source: string; error: Error };

  // Validation events
  'schema:validating': { schema: string; data: any };
  'schema:valid': { schema: string };
  'schema:invalid': { schema: string; errors: string[] };

  // File operations
  'file:written': { path: string; size: number };
  'file:formatted': { path: string; formatter: string };
}

/**
 * WebSocket Server Event Map
 */
export interface WebSocketServerEventMap extends ServiceEventMap {
  // Connection events
  'ws:connection': { clientId: string; ip: string };
  'ws:authenticated': { clientId: string; userId: string };
  'ws:disconnection': { clientId: string; reason: string };

  // Message events
  'ws:message': { clientId: string; type: string; size: number };
  'ws:broadcast': { room?: string; clients: number };
  'ws:error': { clientId: string; error: Error };

  // Room management
  'room:join': { clientId: string; room: string };
  'room:leave': { clientId: string; room: string };
  'room:created': { room: string };
  'room:destroyed': { room: string };

  // Rate limiting
  'ratelimit:exceeded': { clientId: string; limit: number; window: number };
}

// Export all event maps
export type InfrastructureEventMaps = {
  chaos: ChaosEngineeringEventMap;
  serviceRegistry: ServiceRegistryEventMap;
  serviceMesh: ServiceMeshEventMap;
  messageBroker: MessageBrokerEventMap;
  cqrs: CQRSCoordinatorEventMap;
  readModel: ReadModelManagerEventMap;
  cache: AdvancedCacheManagerEventMap;
  schema: SchemaGeneratorEventMap;
  websocket: WebSocketServerEventMap;
};