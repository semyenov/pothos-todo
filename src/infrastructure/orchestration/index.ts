/**
 * Service Orchestration & Mesh Integration
 * 
 * This module provides comprehensive service orchestration and mesh capabilities:
 * - ServiceDependencyGraph: Dependency resolution with topological sort
 * - StartupOrchestrator: Progressive service initialization with health checks
 * - ServiceCommunicationHub: Type-safe inter-service communication
 * - ServiceMeshIntegration: Advanced traffic management and security
 * - MeshGateway: API gateway with rate limiting and auth
 * - ServiceDiscovery: Dynamic service registration and health monitoring
 * - TrafficSplitter: Canary deployments and traffic splitting
 * 
 * @example Basic Orchestration
 * ```typescript
 * import { StartupOrchestrator, getAllServiceDefinitions } from '@/infrastructure/orchestration';
 * 
 * const orchestrator = StartupOrchestrator.getInstance();
 * const services = getAllServiceDefinitions();
 * 
 * for (const service of services) {
 *   orchestrator.registerService(service, factory);
 * }
 * 
 * const result = await orchestrator.orchestrateStartup();
 * ```
 * 
 * @example Service Mesh
 * ```typescript
 * import { initializeServiceMesh } from '@/infrastructure/orchestration';
 * 
 * const { mesh, gateway, discovery, splitter } = await initializeServiceMesh();
 * 
 * // Register service in mesh
 * await mesh.registerService({
 *   name: 'user-service',
 *   endpoints: [{ protocol: 'http', port: 8080, secure: true }]
 * });
 * 
 * // Apply security policy
 * await mesh.applySecurityPolicy({
 *   id: 'strict-mtls',
 *   name: 'Strict mTLS Policy',
 *   namespace: 'production',
 *   mtls: { mode: 'STRICT' }
 * });
 * ```
 */

// Core orchestration components
export {
  ServiceDependencyGraph,
  type ServiceDefinition,
  type ServiceGroup,
  type RetryPolicy,
  type HealthRequirement,
  type ValidationResult,
} from './ServiceDependencyGraph.js';

export {
  StartupOrchestrator,
  type StartupOptions,
  type ServiceStartupResult,
  type GroupStartupResult,
  type StartupResult,
  type StartupProfile,
  type StartupStage,
  type HealthGate,
  type ServiceFactory,
  type OrchestratorConfig,
} from './StartupOrchestrator.js';

export {
  ServiceCommunicationHub,
  ServiceProxy,
  type CallOptions,
  type RequestOptions,
  type ServiceMethod,
  type Subscription,
  type MessageEnvelope,
  type CommunicationHubConfig,
} from './ServiceCommunicationHub.js';

// Service definitions
export {
  CORE_SERVICES,
  EVENT_SERVICES,
  AI_SERVICES,
  SECURITY_SERVICES,
  API_SERVICES,
  OBSERVABILITY_SERVICES,
  SUPPORTING_SERVICES,
  STARTUP_STAGES,
  getAllServiceDefinitions,
  getServicesByType,
  getCriticalServices,
  getServiceDefinition,
  generateDependencyMatrix,
} from './ServiceDefinitions.js';

// Enhanced SystemIntegration
export { EnhancedSystemIntegration } from './SystemIntegration.enhanced.js';

// Service Mesh Integration
export {
  ServiceMeshIntegration,
  type ServiceMeshNode,
  type TrafficRule,
  type SecurityPolicy,
  type ServiceMeshMetrics,
} from './ServiceMeshIntegration.js';

export {
  MeshGateway,
} from './MeshGateway.js';

export {
  ServiceDiscovery,
} from './ServiceDiscovery.js';

export {
  TrafficSplitter,
} from './TrafficSplitter.js';

// Resilience Components
export {
  LoadBalancer,
  type LoadBalancerConfig,
  type LoadBalancerStats,
} from './LoadBalancer.js';

export {
  CircuitBreakerManager,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  type CircuitBreakerStats,
} from './CircuitBreaker.js';

export {
  RetryPolicy,
  type RetryConfig,
  type RetryResult,
} from './RetryPolicy.js';

export {
  ServiceProxy,
  type ProxyConfig,
  type ProxyCall,
} from './ServiceProxy.js';

/**
 * Initialize complete service mesh and orchestration system
 */
export async function initializeServiceMesh(): Promise<{
  mesh: ServiceMeshIntegration;
  gateway: MeshGateway;
  discovery: ServiceDiscovery;
  splitter: TrafficSplitter;
  integration: EnhancedSystemIntegration;
  resilience: {
    loadBalancer: LoadBalancer;
    circuitBreaker: CircuitBreakerManager;
    retryPolicy: RetryPolicy;
    serviceProxy: ServiceProxy;
  };
}> {
  const mesh = ServiceMeshIntegration.getInstance();
  const gateway = MeshGateway.getInstance();
  const discovery = ServiceDiscovery.getInstance();
  const splitter = TrafficSplitter.getInstance();
  const integration = EnhancedSystemIntegration.getInstance();
  
  // Resilience components
  const loadBalancer = new LoadBalancer();
  const circuitBreaker = CircuitBreakerManager.getInstance();
  const retryPolicy = RetryPolicy.getInstance();
  const serviceProxy = ServiceProxy.getInstance();

  // Initialize in correct order
  await mesh.initialize();
  discovery.startHealthChecks();
  
  return { 
    mesh, 
    gateway, 
    discovery, 
    splitter, 
    integration,
    resilience: {
      loadBalancer,
      circuitBreaker,
      retryPolicy,
      serviceProxy,
    }
  };
}

/**
 * Quick start function for system initialization
 */
export async function initializeSystem(config?: any): Promise<any> {
  const integration = EnhancedSystemIntegration.getInstance();
  
  if (config) {
    await integration.initialize(config);
  } else {
    await integration.initialize({ strategy: 'orchestrated' });
  }
  
  return integration;
}

/**
 * Utility to visualize service dependencies
 */
export function visualizeDependencies(): string {
  const graph = new ServiceDependencyGraph();
  const services = getAllServiceDefinitions();
  
  for (const service of services) {
    graph.addService(service);
  }
  
  return graph.exportDOT();
}

/**
 * Get startup optimization recommendations
 */
export function getOptimizationRecommendations(
  startupProfile?: StartupProfile
): Array<{ service: string; recommendation: string; impact: 'high' | 'medium' | 'low' }> {
  if (!startupProfile) return [];
  
  const recommendations: Array<{ service: string; recommendation: string; impact: 'high' | 'medium' | 'low' }> = [];
  
  // Analyze bottlenecks
  for (const bottleneck of startupProfile.bottlenecks) {
    if (bottleneck.reason === 'On critical path' && bottleneck.duration > 20000) {
      recommendations.push({
        service: bottleneck.service,
        recommendation: 'Consider breaking down this service or optimizing initialization',
        impact: 'high',
      });
    }
    
    if (bottleneck.reason.includes('attempts')) {
      recommendations.push({
        service: bottleneck.service,
        recommendation: 'Improve service reliability to reduce retry attempts',
        impact: 'medium',
      });
    }
  }
  
  // Analyze parallelization
  if (startupProfile.parallelizationMetrics.efficiency < 0.7) {
    recommendations.push({
      service: 'system',
      recommendation: 'Increase parallelism limit or reduce service dependencies',
      impact: 'high',
    });
  }
  
  return recommendations;
}