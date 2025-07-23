/**
 * Service orchestration components for advanced startup management
 * 
 * This module provides:
 * - ServiceDependencyGraph: Dependency resolution with topological sort
 * - StartupOrchestrator: Progressive service initialization with health checks
 * - ServiceCommunicationHub: Type-safe inter-service communication
 * - Service definitions with comprehensive metadata
 * 
 * @example
 * ```typescript
 * import { StartupOrchestrator, getAllServiceDefinitions } from '@/infrastructure/orchestration';
 * 
 * const orchestrator = StartupOrchestrator.getInstance();
 * const services = getAllServiceDefinitions();
 * 
 * // Register services
 * for (const service of services) {
 *   orchestrator.registerService(service, factory);
 * }
 * 
 * // Start system
 * const result = await orchestrator.orchestrateStartup();
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
export { SystemIntegration } from '../SystemIntegration.enhanced.js';

/**
 * Quick start function for system initialization
 */
export async function initializeSystem(config?: any): Promise<any> {
  const { SystemIntegration } = await import('../SystemIntegration.enhanced.js');
  const system = SystemIntegration.getInstance();
  
  if (config) {
    // Update configuration if provided
    await system.initialize(config);
  }
  
  await system.start();
  return system;
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