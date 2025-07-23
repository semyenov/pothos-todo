import { ServiceDefinition } from './ServiceDependencyGraph.js';

/**
 * Comprehensive service definitions with dependencies and metadata
 * 
 * This file contains all service definitions for the Pothos Todo application,
 * including their dependencies, health requirements, and startup configurations.
 */

/**
 * Core infrastructure services (no dependencies)
 */
export const CORE_SERVICES: ServiceDefinition[] = [
  {
    name: 'database',
    critical: true,
    dependencies: [],
    startupTimeout: 30000,
    retryPolicy: {
      attempts: 3,
      delay: 2000,
      maxDelay: 10000,
      backoff: 'exponential',
    },
    healthRequirements: [
      { check: 'connection', threshold: 'healthy' },
      { check: 'pool', threshold: 'degraded' },
    ],
    metadata: {
      type: 'infrastructure',
      description: 'PostgreSQL database connection with Prisma ORM',
      resources: { memory: 512, cpu: 200 },
    },
  },
  {
    name: 'cache',
    critical: false,
    dependencies: [],
    startupTimeout: 10000,
    retryPolicy: {
      attempts: 3,
      delay: 1000,
      maxDelay: 5000,
      backoff: 'linear',
    },
    healthRequirements: [
      { check: 'connection', threshold: 'healthy' },
      { check: 'memory', threshold: 'degraded' },
    ],
    metadata: {
      type: 'infrastructure',
      description: 'Redis cache for performance optimization',
      resources: { memory: 256, cpu: 100 },
    },
  },
  {
    name: 'message-queue',
    critical: false,
    dependencies: [],
    startupTimeout: 15000,
    retryPolicy: {
      attempts: 3,
      delay: 2000,
      maxDelay: 10000,
      backoff: 'exponential',
    },
    metadata: {
      type: 'infrastructure',
      description: 'Message queue for async processing',
      resources: { memory: 256, cpu: 100 },
    },
  },
];

/**
 * Event system services
 */
export const EVENT_SERVICES: ServiceDefinition[] = [
  {
    name: 'event-store',
    critical: true,
    dependencies: ['database'],
    startupTimeout: 20000,
    retryPolicy: {
      attempts: 3,
      delay: 2000,
      maxDelay: 10000,
      backoff: 'exponential',
    },
    healthRequirements: [
      { check: 'connection', threshold: 'healthy' },
      { check: 'write-capability', threshold: 'healthy' },
    ],
    metadata: {
      type: 'event-sourcing',
      description: 'Event store for domain events',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'event-bus',
    critical: true,
    dependencies: ['event-store'],
    optionalDependencies: ['cache'],
    startupTimeout: 15000,
    healthRequirements: [
      { check: 'publisher', threshold: 'healthy' },
      { check: 'subscriber', threshold: 'healthy' },
    ],
    metadata: {
      type: 'event-sourcing',
      description: 'Event bus for domain event distribution',
      resources: { memory: 128, cpu: 100 },
    },
  },
  {
    name: 'command-bus',
    critical: true,
    dependencies: ['event-bus'],
    startupTimeout: 10000,
    metadata: {
      type: 'cqrs',
      description: 'Command bus for CQRS pattern',
      resources: { memory: 128, cpu: 100 },
    },
  },
  {
    name: 'query-bus',
    critical: true,
    dependencies: ['database'],
    optionalDependencies: ['cache'],
    startupTimeout: 10000,
    metadata: {
      type: 'cqrs',
      description: 'Query bus for CQRS pattern',
      resources: { memory: 128, cpu: 100 },
    },
  },
  {
    name: 'projection-engine',
    critical: false,
    dependencies: ['event-store', 'database'],
    startupTimeout: 20000,
    metadata: {
      type: 'cqrs',
      description: 'Projection engine for read models',
      resources: { memory: 256, cpu: 200 },
    },
  },
  {
    name: 'saga-orchestrator',
    critical: false,
    dependencies: ['event-bus', 'command-bus'],
    startupTimeout: 15000,
    metadata: {
      type: 'saga',
      description: 'Saga orchestrator for distributed transactions',
      resources: { memory: 256, cpu: 150 },
    },
  },
];

/**
 * AI/ML services
 */
export const AI_SERVICES: ServiceDefinition[] = [
  {
    name: 'vector-store',
    critical: false,
    dependencies: [],
    optionalDependencies: ['cache'],
    startupTimeout: 15000,
    retryPolicy: {
      attempts: 3,
      delay: 2000,
      maxDelay: 10000,
      backoff: 'exponential',
    },
    healthRequirements: [
      { check: 'connection', threshold: 'healthy' },
      { check: 'collections', threshold: 'any' },
    ],
    metadata: {
      type: 'ai',
      description: 'Qdrant vector database for embeddings',
      resources: { memory: 512, cpu: 200 },
    },
  },
  {
    name: 'embedding-service',
    critical: false,
    dependencies: ['vector-store'],
    optionalDependencies: ['cache'],
    startupTimeout: 20000,
    retryPolicy: {
      attempts: 2,
      delay: 5000,
      maxDelay: 15000,
      backoff: 'exponential',
    },
    metadata: {
      type: 'ai',
      description: 'OpenAI embedding service for semantic search',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'nlp-service',
    critical: false,
    dependencies: [],
    startupTimeout: 25000,
    retryPolicy: {
      attempts: 2,
      delay: 5000,
      maxDelay: 20000,
      backoff: 'exponential',
    },
    metadata: {
      type: 'ai',
      description: 'Natural language processing service',
      resources: { memory: 512, cpu: 300 },
    },
  },
  {
    name: 'rag-service',
    critical: false,
    dependencies: ['embedding-service', 'vector-store'],
    optionalDependencies: ['cache'],
    startupTimeout: 30000,
    metadata: {
      type: 'ai',
      description: 'Retrieval-augmented generation service',
      resources: { memory: 512, cpu: 300 },
    },
  },
  {
    name: 'ml-prediction-service',
    critical: false,
    dependencies: ['database'],
    optionalDependencies: ['cache'],
    startupTimeout: 20000,
    metadata: {
      type: 'ai',
      description: 'Machine learning prediction service',
      resources: { memory: 512, cpu: 250 },
    },
  },
  {
    name: 'ai-insight-service',
    critical: false,
    dependencies: ['nlp-service', 'ml-prediction-service'],
    startupTimeout: 25000,
    metadata: {
      type: 'ai',
      description: 'AI-powered insights generation',
      resources: { memory: 256, cpu: 200 },
    },
  },
];

/**
 * Security services
 */
export const SECURITY_SERVICES: ServiceDefinition[] = [
  {
    name: 'auth',
    critical: true,
    dependencies: ['database'],
    optionalDependencies: ['cache'],
    startupTimeout: 15000,
    healthRequirements: [
      { check: 'session-store', threshold: 'healthy' },
      { check: 'provider', threshold: 'healthy' },
    ],
    metadata: {
      type: 'security',
      description: 'Authentication service with OAuth providers',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'rate-limiter',
    critical: false,
    dependencies: ['cache'],
    startupTimeout: 10000,
    healthRequirements: [
      { check: 'store', threshold: 'healthy' },
    ],
    metadata: {
      type: 'security',
      description: 'Rate limiting service',
      resources: { memory: 128, cpu: 100 },
    },
  },
  {
    name: 'api-key-manager',
    critical: false,
    dependencies: ['database'],
    optionalDependencies: ['cache'],
    startupTimeout: 10000,
    metadata: {
      type: 'security',
      description: 'API key management service',
      resources: { memory: 128, cpu: 100 },
    },
  },
  {
    name: 'security-audit',
    critical: false,
    dependencies: ['database', 'event-store'],
    startupTimeout: 15000,
    metadata: {
      type: 'security',
      description: 'Security audit logging service',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'threat-detection',
    critical: false,
    dependencies: ['security-audit'],
    optionalDependencies: ['ml-prediction-service'],
    startupTimeout: 20000,
    metadata: {
      type: 'security',
      description: 'AI-powered threat detection',
      resources: { memory: 512, cpu: 300 },
    },
  },
];

/**
 * API layer services
 */
export const API_SERVICES: ServiceDefinition[] = [
  {
    name: 'api-gateway',
    critical: true,
    dependencies: ['auth', 'rate-limiter'],
    optionalDependencies: ['cache', 'api-key-manager'],
    startupTimeout: 30000,
    healthRequirements: [
      { check: 'routes', threshold: 'healthy' },
      { check: 'middleware', threshold: 'healthy' },
    ],
    metadata: {
      type: 'api',
      description: 'API gateway with routing and middleware',
      resources: { memory: 512, cpu: 300 },
    },
  },
  {
    name: 'graphql-server',
    critical: true,
    dependencies: ['api-gateway', 'database', 'event-bus', 'command-bus', 'query-bus'],
    optionalDependencies: ['cache', 'vector-store', 'embedding-service'],
    startupTimeout: 45000,
    healthRequirements: [
      { check: 'schema', threshold: 'healthy' },
      { check: 'resolvers', threshold: 'healthy' },
    ],
    metadata: {
      type: 'api',
      description: 'GraphQL server with Pothos schema builder',
      resources: { memory: 1024, cpu: 500 },
    },
  },
  {
    name: 'websocket-server',
    critical: false,
    dependencies: ['auth', 'event-bus'],
    startupTimeout: 20000,
    metadata: {
      type: 'api',
      description: 'WebSocket server for real-time features',
      resources: { memory: 256, cpu: 200 },
    },
  },
];

/**
 * Observability services
 */
export const OBSERVABILITY_SERVICES: ServiceDefinition[] = [
  {
    name: 'metrics-collector',
    critical: false,
    dependencies: [],
    optionalDependencies: ['cache'],
    startupTimeout: 10000,
    metadata: {
      type: 'observability',
      description: 'Metrics collection service',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'distributed-tracing',
    critical: false,
    dependencies: [],
    startupTimeout: 15000,
    metadata: {
      type: 'observability',
      description: 'OpenTelemetry distributed tracing',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'log-aggregation',
    critical: false,
    dependencies: [],
    optionalDependencies: ['message-queue'],
    startupTimeout: 10000,
    metadata: {
      type: 'observability',
      description: 'Centralized log aggregation',
      resources: { memory: 512, cpu: 200 },
    },
  },
  {
    name: 'alerting-system',
    critical: false,
    dependencies: ['metrics-collector'],
    optionalDependencies: ['notification-system'],
    startupTimeout: 15000,
    metadata: {
      type: 'observability',
      description: 'Alerting and notification system',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'anomaly-detection',
    critical: false,
    dependencies: ['metrics-collector'],
    optionalDependencies: ['ml-prediction-service'],
    startupTimeout: 20000,
    metadata: {
      type: 'observability',
      description: 'AI-powered anomaly detection',
      resources: { memory: 512, cpu: 300 },
    },
  },
];

/**
 * Supporting services
 */
export const SUPPORTING_SERVICES: ServiceDefinition[] = [
  {
    name: 'notification-system',
    critical: false,
    dependencies: ['message-queue'],
    optionalDependencies: ['template-engine'],
    startupTimeout: 15000,
    metadata: {
      type: 'communication',
      description: 'Multi-channel notification system',
      resources: { memory: 256, cpu: 150 },
    },
  },
  {
    name: 'search-engine',
    critical: false,
    dependencies: ['database'],
    optionalDependencies: ['cache', 'embedding-service'],
    startupTimeout: 20000,
    metadata: {
      type: 'search',
      description: 'Full-text and semantic search engine',
      resources: { memory: 512, cpu: 300 },
    },
  },
  {
    name: 'workflow-engine',
    critical: false,
    dependencies: ['event-bus', 'command-bus'],
    startupTimeout: 20000,
    metadata: {
      type: 'workflow',
      description: 'Business process workflow engine',
      resources: { memory: 256, cpu: 200 },
    },
  },
  {
    name: 'integration-hub',
    critical: false,
    dependencies: ['api-gateway'],
    optionalDependencies: ['message-queue'],
    startupTimeout: 25000,
    metadata: {
      type: 'integration',
      description: 'Third-party integration hub',
      resources: { memory: 512, cpu: 250 },
    },
  },
];

/**
 * Get all service definitions
 */
export function getAllServiceDefinitions(): ServiceDefinition[] {
  return [
    ...CORE_SERVICES,
    ...EVENT_SERVICES,
    ...AI_SERVICES,
    ...SECURITY_SERVICES,
    ...API_SERVICES,
    ...OBSERVABILITY_SERVICES,
    ...SUPPORTING_SERVICES,
  ];
}

/**
 * Get service definitions by type
 */
export function getServicesByType(type: string): ServiceDefinition[] {
  return getAllServiceDefinitions().filter(
    service => service.metadata?.type === type
  );
}

/**
 * Get critical services
 */
export function getCriticalServices(): ServiceDefinition[] {
  return getAllServiceDefinitions().filter(service => service.critical);
}

/**
 * Get service definition by name
 */
export function getServiceDefinition(name: string): ServiceDefinition | undefined {
  return getAllServiceDefinitions().find(service => service.name === name);
}

/**
 * Startup stages configuration
 */
export const STARTUP_STAGES: Array<{
  name: string;
  services: string[];
  healthGate?: {
    required: string[];
    optional?: string[];
  };
  timeout?: number;
  skipOnTimeout?: boolean;
  rollbackOnFailure?: boolean;
}> = [
  {
    name: 'core-infrastructure',
    services: CORE_SERVICES.map(s => s.name),
    healthGate: {
      required: ['database'],
      optional: ['cache', 'message-queue'],
    },
    timeout: 60000,
    rollbackOnFailure: true,
  },
  {
    name: 'event-system',
    services: EVENT_SERVICES.map(s => s.name),
    healthGate: {
      required: ['event-store', 'event-bus', 'command-bus', 'query-bus'],
      optional: ['projection-engine', 'saga-orchestrator'],
    },
    timeout: 45000,
  },
  {
    name: 'security-layer',
    services: SECURITY_SERVICES.map(s => s.name),
    healthGate: {
      required: ['auth'],
      optional: ['rate-limiter', 'api-key-manager'],
    },
    timeout: 30000,
  },
  {
    name: 'api-layer',
    services: API_SERVICES.map(s => s.name),
    healthGate: {
      required: ['api-gateway', 'graphql-server'],
      optional: ['websocket-server'],
    },
    timeout: 60000,
  },
  {
    name: 'ai-services',
    services: AI_SERVICES.map(s => s.name),
    healthGate: {
      optional: AI_SERVICES.map(s => s.name),
    },
    timeout: 90000,
    skipOnTimeout: true,
  },
  {
    name: 'observability',
    services: OBSERVABILITY_SERVICES.map(s => s.name),
    healthGate: {
      optional: OBSERVABILITY_SERVICES.map(s => s.name),
    },
    timeout: 30000,
    skipOnTimeout: true,
  },
  {
    name: 'supporting-services',
    services: SUPPORTING_SERVICES.map(s => s.name),
    healthGate: {
      optional: SUPPORTING_SERVICES.map(s => s.name),
    },
    timeout: 45000,
    skipOnTimeout: true,
  },
];

/**
 * Service dependency visualization data
 */
export function generateDependencyMatrix(): Array<[string, string]> {
  const dependencies: Array<[string, string]> = [];
  
  for (const service of getAllServiceDefinitions()) {
    for (const dep of service.dependencies) {
      dependencies.push([dep, service.name]);
    }
    
    if (service.optionalDependencies) {
      for (const dep of service.optionalDependencies) {
        dependencies.push([dep, service.name]);
      }
    }
  }
  
  return dependencies;
}