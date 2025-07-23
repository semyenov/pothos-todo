import { z } from 'zod';

// Chaos Engineering Configuration Schema
export const ChaosEngineeringConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  maxConcurrentExperiments: z.number().min(1).max(10).default(3),
  safeguards: z.object({
    maxImpact: z.number().min(0).max(100).default(30), // percentage
    minAvailability: z.number().min(0).max(100).default(90), // percentage
    autoRollback: z.boolean().default(true),
  }),
  experiments: z.object({
    allowedTypes: z.array(z.enum([
      'network_latency',
      'network_partition',
      'service_failure',
      'resource_exhaustion',
      'data_corruption',
      'clock_skew',
      'dependency_failure',
      'security_breach'
    ])).default(['network_latency', 'service_failure']),
    defaultDuration: z.number().min(1000).default(60000), // milliseconds
  }),
  monitoring: z.object({
    checkInterval: z.number().min(1000).default(5000), // milliseconds
    metricsRetention: z.number().min(3600).default(86400), // seconds
  }),
});

// Service Registry Configuration Schema
export const ServiceRegistryConfigSchema = z.object({
  registry: z.object({
    type: z.enum(['consul', 'etcd', 'memory']).default('memory'),
    host: z.string().default('localhost'),
    port: z.number().default(8500),
    namespace: z.string().default('services'),
  }),
  health: z.object({
    checkInterval: z.number().min(1000).default(10000), // milliseconds
    timeout: z.number().min(500).default(5000), // milliseconds
    unhealthyThreshold: z.number().min(1).default(3),
  }),
  loadBalancing: z.object({
    strategy: z.enum(['round-robin', 'least-connections', 'weighted', 'ip-hash']).default('round-robin'),
    stickySession: z.boolean().default(false),
    sessionTimeout: z.number().min(60).default(300), // seconds
  }),
  discovery: z.object({
    ttl: z.number().min(10).default(60), // seconds
    deregisterCriticalAfter: z.number().min(60).default(300), // seconds
  }),
});

// Service Mesh Configuration Schema
export const ServiceMeshConfigSchema = z.object({
  enabled: z.boolean().default(true),
  proxy: z.object({
    type: z.enum(['envoy', 'linkerd', 'istio', 'builtin']).default('builtin'),
    port: z.number().default(15001),
  }),
  traffic: z.object({
    retries: z.number().min(0).max(10).default(3),
    timeout: z.number().min(1000).default(30000), // milliseconds
    circuitBreaker: z.object({
      enabled: z.boolean().default(true),
      failureThreshold: z.number().min(1).default(5),
      resetTimeout: z.number().min(1000).default(60000), // milliseconds
    }),
  }),
  security: z.object({
    mtls: z.boolean().default(true),
    rbac: z.boolean().default(true),
    encryption: z.enum(['none', 'tls', 'mutual-tls']).default('tls'),
  }),
  observability: z.object({
    tracing: z.boolean().default(true),
    metrics: z.boolean().default(true),
    logging: z.boolean().default(true),
    samplingRate: z.number().min(0).max(1).default(0.1),
  }),
});

// Message Broker Configuration Schema
export const MessageBrokerConfigSchema = z.object({
  broker: z.object({
    type: z.enum(['kafka', 'rabbitmq', 'redis', 'memory']).default('memory'),
    hosts: z.array(z.string()).default(['localhost:9092']),
    clientId: z.string().default('message-broker'),
  }),
  eventSourcing: z.object({
    enabled: z.boolean().default(true),
    retention: z.number().min(3600).default(604800), // seconds (7 days)
    snapshotInterval: z.number().min(100).default(1000),
  }),
  saga: z.object({
    enabled: z.boolean().default(true),
    timeout: z.number().min(1000).default(300000), // milliseconds
    maxRetries: z.number().min(0).default(3),
  }),
  deadLetter: z.object({
    enabled: z.boolean().default(true),
    maxRetries: z.number().min(0).default(5),
    retryDelay: z.number().min(1000).default(60000), // milliseconds
  }),
  performance: z.object({
    batchSize: z.number().min(1).max(1000).default(100),
    compressionEnabled: z.boolean().default(true),
    maxInFlightRequests: z.number().min(1).default(5),
  }),
});

// CQRS Coordinator Configuration Schema
export const CQRSCoordinatorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  command: z.object({
    timeout: z.number().min(1000).default(30000), // milliseconds
    retries: z.number().min(0).default(3),
    validationEnabled: z.boolean().default(true),
  }),
  query: z.object({
    cacheEnabled: z.boolean().default(true),
    cacheTTL: z.number().min(0).default(300), // seconds
    maxComplexity: z.number().min(1).default(100),
  }),
  eventStore: z.object({
    type: z.enum(['postgres', 'mongodb', 'eventstore', 'memory']).default('postgres'),
    snapshotEnabled: z.boolean().default(true),
    snapshotFrequency: z.number().min(10).default(100),
  }),
  projections: z.object({
    enabled: z.boolean().default(true),
    rebuildOnStart: z.boolean().default(false),
    concurrency: z.number().min(1).max(10).default(4),
  }),
});

// Read Model Manager Configuration Schema
export const ReadModelManagerConfigSchema = z.object({
  storage: z.object({
    type: z.enum(['postgres', 'mongodb', 'redis', 'memory']).default('postgres'),
    connectionPool: z.object({
      min: z.number().min(1).default(5),
      max: z.number().min(5).default(20),
    }),
  }),
  projections: z.object({
    batchSize: z.number().min(1).max(1000).default(100),
    concurrency: z.number().min(1).max(10).default(4),
    errorRetries: z.number().min(0).default(3),
  }),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().min(0).default(300), // seconds
    maxSize: z.number().min(100).default(10000),
  }),
  maintenance: z.object({
    vacuumEnabled: z.boolean().default(true),
    vacuumInterval: z.number().min(3600).default(86400), // seconds
    archiveOldData: z.boolean().default(true),
    archiveAfterDays: z.number().min(1).default(90),
  }),
});

// Advanced Cache Manager Configuration Schema
export const AdvancedCacheManagerConfigSchema = z.object({
  strategy: z.enum(['lru', 'lfu', 'arc', 'ttl']).default('lru'),
  maxSize: z.number().min(100).default(10000),
  ttl: z.number().min(0).default(3600), // seconds
  warmup: z.object({
    enabled: z.boolean().default(true),
    preloadKeys: z.array(z.string()).default([]),
    schedule: z.string().optional(), // cron expression
  }),
  invalidation: z.object({
    tagBased: z.boolean().default(true),
    cascading: z.boolean().default(true),
    batchSize: z.number().min(1).default(100),
  }),
  persistence: z.object({
    enabled: z.boolean().default(false),
    path: z.string().default('./cache'),
    interval: z.number().min(60).default(300), // seconds
  }),
  monitoring: z.object({
    trackHitRate: z.boolean().default(true),
    trackEvictions: z.boolean().default(true),
    metricsInterval: z.number().min(10).default(60), // seconds
  }),
});

// Schema Generator Configuration Schema
export const SchemaGeneratorConfigSchema = z.object({
  output: z.object({
    directory: z.string().default('./generated/schemas'),
    format: z.enum(['typescript', 'json', 'graphql', 'openapi']).default('typescript'),
    prettier: z.boolean().default(true),
  }),
  generation: z.object({
    includeValidation: z.boolean().default(true),
    includeExamples: z.boolean().default(true),
    includeDocumentation: z.boolean().default(true),
  }),
  validation: z.object({
    strict: z.boolean().default(true),
    coerceTypes: z.boolean().default(false),
    removeAdditional: z.boolean().default(true),
  }),
});

// Export all schemas
export const InfrastructureConfigSchemas = {
  chaos: ChaosEngineeringConfigSchema,
  serviceRegistry: ServiceRegistryConfigSchema,
  serviceMesh: ServiceMeshConfigSchema,
  messageBroker: MessageBrokerConfigSchema,
  cqrsCoordinator: CQRSCoordinatorConfigSchema,
  readModelManager: ReadModelManagerConfigSchema,
  advancedCacheManager: AdvancedCacheManagerConfigSchema,
  schemaGenerator: SchemaGeneratorConfigSchema,
} as const;

// Export individual config types
export type ChaosEngineeringConfig = z.infer<typeof ChaosEngineeringConfigSchema>;
export type ServiceRegistryConfig = z.infer<typeof ServiceRegistryConfigSchema>;
export type ServiceMeshConfig = z.infer<typeof ServiceMeshConfigSchema>;
export type MessageBrokerConfig = z.infer<typeof MessageBrokerConfigSchema>;
export type CQRSCoordinatorConfig = z.infer<typeof CQRSCoordinatorConfigSchema>;
export type ReadModelManagerConfig = z.infer<typeof ReadModelManagerConfigSchema>;
export type AdvancedCacheManagerConfig = z.infer<typeof AdvancedCacheManagerConfigSchema>;
export type SchemaGeneratorConfig = z.infer<typeof SchemaGeneratorConfigSchema>;