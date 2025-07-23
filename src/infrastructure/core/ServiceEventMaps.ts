import { ServiceEventMap } from './TypedEventEmitter.js';

/**
 * Redis service event map
 */
export interface RedisServiceEventMap extends ServiceEventMap {
  'redis:connected': { host: string; port: number };
  'redis:disconnected': { reason: string };
  'redis:error': { error: Error; operation?: string };
  'redis:command': { command: string; duration: number; status: 'success' | 'error' };
  'redis:slow-query': { command: string; duration: number; threshold: number };
  'redis:memory-warning': { used: number; limit: number; percentage: number };
}

/**
 * Database service event map
 */
export interface DatabaseServiceEventMap extends ServiceEventMap {
  'db:connected': { database: string; poolSize: number };
  'db:disconnected': { reason: string };
  'db:query': { query: string; duration: number; rows: number };
  'db:error': { error: Error; query?: string };
  'db:pool:full': { active: number; waiting: number; available: number };
  'db:pool:timeout': { waitTime: number };
  'db:transaction:started': { txId: string };
  'db:transaction:committed': { txId: string; duration: number };
  'db:transaction:rolledback': { txId: string; reason: string };
  'db:migration:started': { version: string };
  'db:migration:completed': { version: string; direction: 'up' | 'down' };
}

/**
 * Message queue service event map
 */
export interface MessageQueueEventMap extends ServiceEventMap {
  'queue:connected': { brokers: string[] };
  'queue:disconnected': { reason: string };
  'queue:message:sent': { topic: string; partition?: number; offset?: string };
  'queue:message:received': { topic: string; partition?: number; offset?: string };
  'queue:message:error': { error: Error; topic: string; message?: any };
  'queue:consumer:started': { groupId: string; topics: string[] };
  'queue:consumer:stopped': { groupId: string; reason?: string };
  'queue:rebalance': { type: 'assigned' | 'revoked'; partitions: any[] };
}

/**
 * HTTP service event map
 */
export interface HttpServiceEventMap extends ServiceEventMap {
  'http:request': { method: string; path: string; duration: number; status: number };
  'http:error': { error: Error; method?: string; path?: string; status?: number };
  'http:timeout': { method: string; path: string; timeout: number };
  'http:retry': { method: string; path: string; attempt: number; maxAttempts: number };
  'http:rate-limit': { limit: number; remaining: number; reset: Date };
}

/**
 * WebSocket service event map
 */
export interface WebSocketServiceEventMap extends ServiceEventMap {
  'ws:connection': { clientId: string; origin?: string };
  'ws:disconnection': { clientId: string; reason?: string; code?: number };
  'ws:message': { clientId: string; type: string; size: number };
  'ws:error': { error: Error; clientId?: string };
  'ws:room:joined': { clientId: string; room: string };
  'ws:room:left': { clientId: string; room: string };
  'ws:broadcast': { room?: string; type: string; recipients: number };
}

/**
 * Cache service event map
 */
export interface CacheServiceEventMap extends ServiceEventMap {
  'cache:hit': { key: string; ttl?: number };
  'cache:miss': { key: string };
  'cache:set': { key: string; ttl?: number; size?: number };
  'cache:delete': { key: string };
  'cache:clear': { pattern?: string; count: number };
  'cache:expired': { key: string };
  'cache:evicted': { key: string; reason: 'ttl' | 'lru' | 'memory' };
  'cache:error': { error: Error; operation: string; key?: string };
}

/**
 * Search service event map (Elasticsearch, etc.)
 */
export interface SearchServiceEventMap extends ServiceEventMap {
  'search:indexed': { index: string; documentId: string; status: 'created' | 'updated' };
  'search:deleted': { index: string; documentId: string };
  'search:query': { index: string; query: any; duration: number; hits: number };
  'search:error': { error: Error; index?: string; operation?: string };
  'search:bulk': { index: string; success: number; failed: number };
  'search:health': { status: 'green' | 'yellow' | 'red'; indices: number };
}

/**
 * Storage service event map (S3, file system, etc.)
 */
export interface StorageServiceEventMap extends ServiceEventMap {
  'storage:uploaded': { path: string; size: number; contentType?: string };
  'storage:downloaded': { path: string; size: number };
  'storage:deleted': { path: string };
  'storage:moved': { from: string; to: string };
  'storage:error': { error: Error; operation: string; path?: string };
  'storage:quota': { used: number; limit: number; percentage: number };
}

/**
 * Authentication service event map
 */
export interface AuthServiceEventMap extends ServiceEventMap {
  'auth:login': { userId: string; method: string; ip?: string };
  'auth:logout': { userId: string; reason?: string };
  'auth:failed': { username: string; reason: string; ip?: string };
  'auth:token:created': { userId: string; type: 'access' | 'refresh'; expiresIn: number };
  'auth:token:refreshed': { userId: string; oldToken: string };
  'auth:token:revoked': { userId: string; token: string; reason?: string };
  'auth:permission:denied': { userId: string; resource: string; action: string };
  'auth:2fa:enabled': { userId: string; method: string };
  'auth:2fa:verified': { userId: string; method: string };
}

/**
 * Monitoring service event map
 */
export interface MonitoringServiceEventMap extends ServiceEventMap {
  'monitor:alert': { name: string; level: 'info' | 'warning' | 'error' | 'critical'; message: string };
  'monitor:metric': { name: string; value: number; unit?: string; tags?: Record<string, string> };
  'monitor:threshold': { metric: string; value: number; threshold: number; direction: 'above' | 'below' };
  'monitor:anomaly': { metric: string; value: number; expected: number; deviation: number };
  'monitor:health:degraded': { service: string; checks: any[] };
  'monitor:health:recovered': { service: string; duration: number };
}

/**
 * Scheduler service event map
 */
export interface SchedulerServiceEventMap extends ServiceEventMap {
  'scheduler:job:scheduled': { jobId: string; cron: string; nextRun: Date };
  'scheduler:job:started': { jobId: string; attempt: number };
  'scheduler:job:completed': { jobId: string; duration: number; result?: any };
  'scheduler:job:failed': { jobId: string; error: Error; attempt: number; willRetry: boolean };
  'scheduler:job:cancelled': { jobId: string; reason?: string };
  'scheduler:job:missed': { jobId: string; scheduledTime: Date };
}

/**
 * Email service event map
 */
export interface EmailServiceEventMap extends ServiceEventMap {
  'email:sent': { to: string[]; subject: string; messageId: string };
  'email:failed': { to: string[]; subject: string; error: Error };
  'email:bounced': { to: string; reason: string; permanent: boolean };
  'email:opened': { to: string; messageId: string; timestamp: Date };
  'email:clicked': { to: string; messageId: string; link: string; timestamp: Date };
  'email:unsubscribed': { email: string; listId?: string };
  'email:spam': { to: string; messageId: string; score: number };
}

/**
 * Payment service event map
 */
export interface PaymentServiceEventMap extends ServiceEventMap {
  'payment:created': { paymentId: string; amount: number; currency: string; method: string };
  'payment:completed': { paymentId: string; transactionId: string };
  'payment:failed': { paymentId: string; reason: string; code?: string };
  'payment:refunded': { paymentId: string; amount: number; reason?: string };
  'payment:disputed': { paymentId: string; reason: string; amount: number };
  'payment:subscription:created': { subscriptionId: string; plan: string; customerId: string };
  'payment:subscription:cancelled': { subscriptionId: string; reason?: string };
  'payment:webhook': { provider: string; event: string; data: any };
}

/**
 * AI/ML service event map
 */
export interface AIServiceEventMap extends ServiceEventMap {
  'ai:inference:started': { modelId: string; inputSize: number };
  'ai:inference:completed': { modelId: string; duration: number; tokensUsed?: number };
  'ai:inference:failed': { modelId: string; error: Error };
  'ai:embedding:created': { text: string; dimensions: number; modelId: string };
  'ai:training:started': { modelId: string; dataset: string; epochs: number };
  'ai:training:progress': { modelId: string; epoch: number; loss: number; accuracy?: number };
  'ai:training:completed': { modelId: string; duration: number; metrics: any };
  'ai:quota:warning': { used: number; limit: number; resetAt: Date };
}

/**
 * Type helper to combine multiple event maps
 */
export type CombinedEventMap<T extends ServiceEventMap[]> = T extends [
  infer First,
  ...infer Rest
]
  ? First extends ServiceEventMap
    ? Rest extends ServiceEventMap[]
      ? First & CombinedEventMap<Rest>
      : First
    : never
  : {};