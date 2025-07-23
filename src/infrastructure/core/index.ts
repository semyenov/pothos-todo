/**
 * Core infrastructure components for building enterprise-grade services
 * 
 * This module provides:
 * - TypedEventEmitter: Strongly-typed event emitter for compile-time safety
 * - BaseService: Base class with automatic config, lifecycle, and health checks
 * - BaseAsyncService: Async singleton services with initialization
 * - Service decorators: Config, caching, retry, circuit breaker, etc.
 * - Event maps: Pre-defined event types for common services
 * 
 * @example
 * ```typescript
 * import { BaseAsyncService, ServiceConfig, RedisServiceEventMap } from '@/infrastructure/core';
 * 
 * @ServiceConfig({ schema: ConfigSchema, prefix: 'myservice' })
 * class MyService extends BaseAsyncService<Config, RedisServiceEventMap> {
 *   // Service implementation
 * }
 * ```
 */

// Core Infrastructure (existing)
export { BaseRepository } from './BaseRepository.js';
export { ErrorHandler } from './ErrorHandler.js';
export { SingletonService, AsyncSingletonService, EventEmitterSingletonService, AsyncEventEmitterSingletonService } from './SingletonService.js';

// New Enhanced Core Components
export { TypedEventEmitter } from './TypedEventEmitter.js';
export type { 
  ServiceEventMap, 
  HealthStatus, 
  HealthCheckResult,
  EventData,
  EventListener 
} from './TypedEventEmitter.js';

// Base services
export { BaseService } from './BaseService.js';
export type {
  ServiceState,
  ServiceMetadata,
  ServiceConfigOptions,
  HealthCheck,
  DisposableResource,
  ServiceMetrics
} from './BaseService.js';

export { BaseAsyncService } from './BaseAsyncService.js';

// Service event maps
export type {
  RedisServiceEventMap,
  DatabaseServiceEventMap,
  MessageQueueEventMap,
  HttpServiceEventMap,
  WebSocketServiceEventMap,
  CacheServiceEventMap,
  SearchServiceEventMap,
  StorageServiceEventMap,
  AuthServiceEventMap,
  MonitoringServiceEventMap,
  SchedulerServiceEventMap,
  EmailServiceEventMap,
  PaymentServiceEventMap,
  AIServiceEventMap,
  CombinedEventMap
} from './ServiceEventMaps.js';

// Decorators
export {
  ServiceConfig,
  Cache,
  Retry,
  CircuitBreaker,
  RateLimit,
  Metric,
  HealthCheck
} from './decorators/ServiceDecorators.js';

export type {
  CacheOptions,
  RetryOptions,
  CircuitBreakerOptions,
  RateLimitOptions,
  MetricOptions,
  HealthCheckOptions
} from './decorators/ServiceDecorators.js';