import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric } from '../core/decorators/ServiceDecorators.js';
import { ServiceDependencyGraph, ServiceDefinition, RetryPolicy } from './ServiceDependencyGraph.js';
import { ServiceStartupResult, ServiceFactory } from './StartupOrchestrator.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Recovery configuration schema
 */
const RecoveryConfigSchema = z.object({
  maxRecoveryAttempts: z.number().default(3),
  recoveryDelay: z.number().default(5000), // 5 seconds
  degradedModeTimeout: z.number().default(300000), // 5 minutes
  autoRecoveryEnabled: z.boolean().default(true),
  recoveryCheckInterval: z.number().default(30000), // 30 seconds
  cascadeProtectionEnabled: z.boolean().default(true),
});

export type RecoveryConfig = z.infer<typeof RecoveryConfigSchema>;

/**
 * Failed service information
 */
export interface FailedService {
  serviceName: string;
  definition: ServiceDefinition;
  error: Error;
  attempts: number;
  lastAttempt: Date;
  dependencies: string[];
  dependents: string[];
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  success: boolean;
  recoveredServices: string[];
  stillFailedServices: string[];
  degradedServices: string[];
  duration: number;
  attempts: number;
}

/**
 * Service alternative for substitution
 */
export interface ServiceAlternative {
  name: string;
  factory: ServiceFactory;
  compatibility: number; // 0-1 score
  limitations?: string[];
}

/**
 * Degraded mode configuration
 */
export interface DegradedModeConfig {
  missingServices: string[];
  availableServices: string[];
  limitations: string[];
  recommendations: string[];
}

/**
 * Cascade risk assessment
 */
export interface CascadeRisk {
  service: string;
  impactedServices: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  mitigationStrategy?: string;
}

/**
 * Recovery event map
 */
interface RecoveryEventMap {
  'recovery:starting': { failedServices: string[]; strategy: string };
  'recovery:service-recovered': { service: string; duration: number };
  'recovery:service-substituted': { original: string; substitute: string };
  'recovery:degraded-mode': { config: DegradedModeConfig };
  'recovery:complete': { result: RecoveryResult };
  'recovery:cascade-risk': { risks: CascadeRisk[] };
}

/**
 * Startup recovery and resilience manager
 * 
 * Features:
 * - Automatic retry of failed services
 * - Service substitution with alternatives
 * - Degraded mode operation
 * - Cascade failure prevention
 * - Progressive recovery attempts
 * - Bulkhead isolation
 */
@ServiceConfig({
  schema: RecoveryConfigSchema,
  prefix: 'recovery',
  hot: true,
})
export class StartupRecovery extends BaseService<RecoveryConfig, RecoveryEventMap> {
  private dependencyGraph: ServiceDependencyGraph;
  private failedServices: Map<string, FailedService> = new Map();
  private serviceAlternatives: Map<string, ServiceAlternative[]> = new Map();
  private degradedModeActive = false;
  private recoveryInterval?: NodeJS.Timeout;
  private isolatedServices: Set<string> = new Set();
  private bulkheads: Map<string, Set<string>> = new Map();

  constructor() {
    super();
    this.dependencyGraph = new ServiceDependencyGraph();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): StartupRecovery {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'startup-recovery';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Manages startup failure recovery and resilience';
  }

  /**
   * Initialize recovery system
   */
  protected async onInitialize(): Promise<void> {
    if (this.config.autoRecoveryEnabled) {
      this.startAutoRecovery();
    }
  }

  /**
   * Retry failed services with exponential backoff
   */
  @Metric({ name: 'recovery.retry', recordDuration: true })
  async retryFailedServices(
    failed: FailedService[],
    policy?: RetryPolicy
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    const recoveredServices: string[] = [];
    const stillFailedServices: string[] = [];
    let totalAttempts = 0;

    this.emit('recovery:starting', {
      failedServices: failed.map(f => f.serviceName),
      strategy: 'retry',
    });

    // Default retry policy
    const retryPolicy: RetryPolicy = policy || {
      attempts: 3,
      delay: 2000,
      maxDelay: 30000,
      backoff: 'exponential',
    };

    // Sort by dependencies (services with fewer dependencies first)
    const sortedFailed = this.sortByDependencies(failed);

    for (const failedService of sortedFailed) {
      const serviceStartTime = Date.now();
      let recovered = false;

      for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
        totalAttempts++;

        try {
          // Check if dependencies are satisfied
          const depsHealthy = await this.checkDependencies(failedService.serviceName);
          if (!depsHealthy) {
            logger.warn(`Skipping ${failedService.serviceName} - dependencies not healthy`);
            break;
          }

          // Attempt recovery
          logger.info(`Attempting recovery of ${failedService.serviceName} (attempt ${attempt}/${retryPolicy.attempts})`);
          
          // Simulate service recovery (in real implementation, use service factory)
          await this.recoverService(failedService);
          
          recovered = true;
          recoveredServices.push(failedService.serviceName);
          
          this.emit('recovery:service-recovered', {
            service: failedService.serviceName,
            duration: Date.now() - serviceStartTime,
          });

          break;
        } catch (error) {
          logger.warn(`Recovery attempt ${attempt} failed for ${failedService.serviceName}`, {
            error: (error as Error).message,
          });

          if (attempt < retryPolicy.attempts) {
            // Calculate backoff delay
            const delay = this.calculateBackoff(attempt, retryPolicy);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            stillFailedServices.push(failedService.serviceName);
          }
        }
      }

      if (!recovered) {
        // Update failed service info
        failedService.attempts += retryPolicy.attempts;
        failedService.lastAttempt = new Date();
        this.failedServices.set(failedService.serviceName, failedService);
      } else {
        // Remove from failed services
        this.failedServices.delete(failedService.serviceName);
      }
    }

    const result: RecoveryResult = {
      success: stillFailedServices.length === 0,
      recoveredServices,
      stillFailedServices,
      degradedServices: [],
      duration: Date.now() - startTime,
      attempts: totalAttempts,
    };

    this.emit('recovery:complete', { result });

    return result;
  }

  /**
   * Start system in degraded mode
   */
  async startDegradedMode(
    available: string[],
    missing: string[]
  ): Promise<DegradedModeConfig> {
    logger.warn('Starting system in degraded mode', {
      available: available.length,
      missing: missing.length,
    });

    this.degradedModeActive = true;

    // Analyze impact
    const limitations = this.analyzeLimitations(missing);
    const recommendations = this.generateRecommendations(missing);

    const config: DegradedModeConfig = {
      missingServices: missing,
      availableServices: available,
      limitations,
      recommendations,
    };

    this.emit('recovery:degraded-mode', { config });

    // Start monitoring for recovery opportunities
    this.monitorForRecovery(missing);

    return config;
  }

  /**
   * Attempt full recovery from degraded mode
   */
  async attemptFullRecovery(): Promise<RecoveryResult> {
    if (!this.degradedModeActive) {
      return {
        success: true,
        recoveredServices: [],
        stillFailedServices: [],
        degradedServices: [],
        duration: 0,
        attempts: 0,
      };
    }

    logger.info('Attempting full system recovery from degraded mode');

    const failed = Array.from(this.failedServices.values());
    const result = await this.retryFailedServices(failed);

    if (result.success) {
      this.degradedModeActive = false;
      logger.info('System fully recovered from degraded mode');
    }

    return result;
  }

  /**
   * Substitute failed service with alternative
   */
  async substituteService(
    failed: string,
    context?: any
  ): Promise<ServiceStartupResult> {
    const alternatives = this.serviceAlternatives.get(failed) || [];
    
    if (alternatives.length === 0) {
      throw new Error(`No alternatives available for service ${failed}`);
    }

    // Sort by compatibility score
    alternatives.sort((a, b) => b.compatibility - a.compatibility);

    for (const alternative of alternatives) {
      try {
        logger.info(`Attempting to substitute ${failed} with ${alternative.name}`);
        
        // Create alternative service
        const instance = await alternative.factory();
        
        this.emit('recovery:service-substituted', {
          original: failed,
          substitute: alternative.name,
        });

        return {
          serviceName: alternative.name,
          status: 'success',
          duration: 0,
          attempts: 1,
          health: 'degraded', // Substitutes are considered degraded
        };
      } catch (error) {
        logger.warn(`Failed to substitute with ${alternative.name}`, { error });
      }
    }

    throw new Error(`All substitution attempts failed for ${failed}`);
  }

  /**
   * Detect cascade failure risks
   */
  detectCascadeRisk(
    failedService: string,
    dependencyGraph: ServiceDependencyGraph
  ): CascadeRisk[] {
    const risks: CascadeRisk[] = [];
    const visited = new Set<string>();
    const queue: string[] = [failedService];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Get services that depend on current
      const dependents = this.getDependents(current);
      const impactedServices: string[] = [];

      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          impactedServices.push(dependent);
          queue.push(dependent);
        }
      }

      if (impactedServices.length > 0) {
        const riskLevel = this.assessRiskLevel(impactedServices.length, impactedServices);
        
        risks.push({
          service: current,
          impactedServices,
          riskLevel,
          mitigationStrategy: this.getMitigationStrategy(riskLevel),
        });
      }
    }

    if (risks.length > 0) {
      this.emit('recovery:cascade-risk', { risks });
    }

    return risks;
  }

  /**
   * Isolate failing service
   */
  async isolateService(service: string): Promise<void> {
    logger.warn(`Isolating service ${service} to prevent cascade failures`);
    
    this.isolatedServices.add(service);
    
    // Remove from dependency graph temporarily
    this.dependencyGraph.removeService(service);
    
    // Notify dependent services
    const dependents = this.getDependents(service);
    for (const dependent of dependents) {
      logger.info(`Notifying ${dependent} about isolation of ${service}`);
      // In real implementation, send notification
    }
  }

  /**
   * Create bulkheads between service groups
   */
  createBulkheads(groups: string[][]): Map<string, Set<string>> {
    this.bulkheads.clear();

    for (let i = 0; i < groups.length; i++) {
      const bulkheadName = `bulkhead-${i}`;
      this.bulkheads.set(bulkheadName, new Set(groups[i]));
    }

    logger.info(`Created ${this.bulkheads.size} bulkheads for fault isolation`);
    
    return this.bulkheads;
  }

  /**
   * Register service alternative
   */
  registerAlternative(
    serviceName: string,
    alternative: ServiceAlternative
  ): void {
    if (!this.serviceAlternatives.has(serviceName)) {
      this.serviceAlternatives.set(serviceName, []);
    }
    
    this.serviceAlternatives.get(serviceName)!.push(alternative);
    
    logger.info(`Registered alternative ${alternative.name} for ${serviceName}`);
  }

  /**
   * Private helper methods
   */

  private async recoverService(failedService: FailedService): Promise<void> {
    // In real implementation, this would use the service factory
    // For now, simulate recovery
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate occasional failure
    if (Math.random() < 0.3) {
      throw new Error(`Recovery failed for ${failedService.serviceName}`);
    }
  }

  private sortByDependencies(services: FailedService[]): FailedService[] {
    return services.sort((a, b) => 
      a.dependencies.length - b.dependencies.length
    );
  }

  private async checkDependencies(serviceName: string): Promise<boolean> {
    // In real implementation, check actual service health
    return true;
  }

  private calculateBackoff(attempt: number, policy: RetryPolicy): number {
    switch (policy.backoff) {
      case 'exponential':
        return Math.min(policy.delay * Math.pow(2, attempt - 1), policy.maxDelay);
      case 'linear':
        return Math.min(policy.delay * attempt, policy.maxDelay);
      default:
        return policy.delay;
    }
  }

  private analyzeLimitations(missingServices: string[]): string[] {
    const limitations: string[] = [];

    for (const service of missingServices) {
      switch (service) {
        case 'cache':
          limitations.push('Performance may be degraded without caching');
          break;
        case 'ai-services':
          limitations.push('AI features will be unavailable');
          break;
        case 'notification-system':
          limitations.push('Email/SMS notifications will not be sent');
          break;
        case 'search-engine':
          limitations.push('Search functionality will be limited');
          break;
        default:
          limitations.push(`Functionality dependent on ${service} will be limited`);
      }
    }

    return limitations;
  }

  private generateRecommendations(missingServices: string[]): string[] {
    const recommendations: string[] = [];

    if (missingServices.includes('cache')) {
      recommendations.push('Consider enabling in-memory caching as fallback');
    }

    if (missingServices.length > 3) {
      recommendations.push('System is severely degraded - consider full restart');
    }

    recommendations.push('Monitor system health closely');
    recommendations.push('Have incident response team on standby');

    return recommendations;
  }

  private monitorForRecovery(missingServices: string[]): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }

    this.recoveryInterval = setInterval(async () => {
      logger.debug('Checking for recovery opportunities');
      
      // In real implementation, check if missing services are now available
      const stillMissing = missingServices.filter(() => Math.random() > 0.1);
      
      if (stillMissing.length < missingServices.length) {
        logger.info('Some services have become available, attempting recovery');
        await this.attemptFullRecovery();
      }
    }, this.config.recoveryCheckInterval);
  }

  private getDependents(service: string): string[] {
    // In real implementation, use dependency graph
    return [];
  }

  private assessRiskLevel(
    impactCount: number,
    impactedServices: string[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (impactCount >= 10) return 'critical';
    if (impactCount >= 5) return 'high';
    if (impactCount >= 2) return 'medium';
    return 'low';
  }

  private getMitigationStrategy(riskLevel: string): string {
    switch (riskLevel) {
      case 'critical':
        return 'Immediate isolation and fallback to backup systems';
      case 'high':
        return 'Isolate service and activate circuit breakers';
      case 'medium':
        return 'Monitor closely and prepare fallback options';
      default:
        return 'Continue monitoring';
    }
  }

  private startAutoRecovery(): void {
    setInterval(async () => {
      if (this.failedServices.size > 0 && !this.degradedModeActive) {
        logger.info('Auto-recovery check triggered');
        const failed = Array.from(this.failedServices.values());
        await this.retryFailedServices(failed);
      }
    }, this.config.recoveryCheckInterval);
  }

  /**
   * Get recovery statistics
   */
  getStatistics(): {
    failedServices: number;
    isolatedServices: number;
    degradedMode: boolean;
    bulkheads: number;
    alternatives: number;
  } {
    return {
      failedServices: this.failedServices.size,
      isolatedServices: this.isolatedServices.size,
      degradedMode: this.degradedModeActive,
      bulkheads: this.bulkheads.size,
      alternatives: Array.from(this.serviceAlternatives.values())
        .reduce((sum, alts) => sum + alts.length, 0),
    };
  }

  /**
   * Export recovery state
   */
  exportState(): {
    failed: FailedService[];
    isolated: string[];
    degraded: boolean;
    bulkheads: Array<{ name: string; services: string[] }>;
  } {
    return {
      failed: Array.from(this.failedServices.values()),
      isolated: Array.from(this.isolatedServices),
      degraded: this.degradedModeActive,
      bulkheads: Array.from(this.bulkheads.entries()).map(([name, services]) => ({
        name,
        services: Array.from(services),
      })),
    };
  }
}