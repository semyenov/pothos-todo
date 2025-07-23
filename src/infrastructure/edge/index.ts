// Edge Computing & Global Distribution Infrastructure
export { EdgeComputingSystem } from './EdgeComputing.js';
export * from './EdgeComputing.js';
export * from './DataReplication.js';
export * from './IntelligentCDN.js';
export * from './EdgeAuth.js';
export * from '../performance/PerformanceOptimizer.js';

// Re-export key types for convenience
export type {
  EdgeLocation,
  EdgeFunction,
  EdgeRequest,
  EdgeResponse,
  EdgeMetrics,
  GeolocationData,
} from './EdgeComputing.js';

export type {
  ReplicationNode,
  ReplicationStrategy,
  ReplicationEvent,
  Conflict,
  ConflictResolution,
} from './DataReplication.js';

export type {
  CDNConfig,
  CacheStrategy,
  CacheEntry,
  GraphQLCacheEntry,
  CacheStats,
  PurgeRequest,
} from './IntelligentCDN.js';

export type {
  EdgeAuthConfig,
  EdgeSession,
  GeographicLocation,
  SessionRestrictions,
  AuthCache,
} from './EdgeAuth.js';

export type {
  PerformanceConfig,
  PerformanceMetrics,
  OptimizationRecommendation,
  QueryProfile,
  ResourcePool,
} from '../performance/PerformanceOptimizer.js';