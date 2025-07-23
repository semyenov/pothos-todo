import { BaseService } from '../core/BaseService.js';
import { ServiceEventMap } from '../core/TypedEventEmitter.js';
import { ServiceConfig, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { ServiceRegistry } from '../core/ServiceRegistry.js';
import { z } from 'zod';
import { logger } from '@/lib/unjs-utils.js';
import * as k8s from '@kubernetes/client-node';

const DeploymentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  kubernetes: z.object({
    namespace: z.string().default('default'),
    configFile: z.string().optional(),
    inCluster: z.boolean().default(false),
  }),
  deployment: z.object({
    strategy: z.enum(['rolling', 'blue-green', 'canary']).default('rolling'),
    replicas: z.number().min(1).default(3),
    maxSurge: z.number().default(1),
    maxUnavailable: z.number().default(1),
  }),
  resources: z.object({
    requests: z.object({
      cpu: z.string().default('100m'),
      memory: z.string().default('128Mi'),
    }),
    limits: z.object({
      cpu: z.string().default('500m'),
      memory: z.string().default('512Mi'),
    }),
  }),
  autoscaling: z.object({
    enabled: z.boolean().default(true),
    minReplicas: z.number().default(1),
    maxReplicas: z.number().default(10),
    cpuThreshold: z.number().default(70),
    memoryThreshold: z.number().default(80),
  }),
  monitoring: z.object({
    prometheus: z.boolean().default(true),
    grafana: z.boolean().default(true),
    alerts: z.array(z.object({
      name: z.string(),
      condition: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
    })).default([]),
  }),
});

type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

interface DeploymentEventMap extends ServiceEventMap {
  'deployment:started': { service: string; version: string; strategy: string };
  'deployment:progress': { service: string; replicas: { ready: number; total: number } };
  'deployment:completed': { service: string; duration: number };
  'deployment:failed': { service: string; error: Error };
  'deployment:rollback': { service: string; reason: string };
  'scaling:triggered': { service: string; from: number; to: number; reason: string };
}

/**
 * Service Deployment Manager
 * Handles deployment of services to Kubernetes with various strategies
 */
@ServiceConfig({
  schema: DeploymentConfigSchema,
  prefix: 'deployment',
  hot: true,
})
export class ServiceDeployment extends BaseService<DeploymentConfig, DeploymentEventMap> {
  private k8sApi?: k8s.AppsV1Api;
  private k8sCore?: k8s.CoreV1Api;
  private deployments: Map<string, any> = new Map();

  static getInstance(): ServiceDeployment {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'service-deployment';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Kubernetes deployment manager for infrastructure services';
  }

  protected async onInitialize(): Promise<void> {
    logger.info('Service Deployment Manager initializing', {
      environment: this.config.environment,
      namespace: this.config.kubernetes.namespace,
    });

    // Initialize Kubernetes client
    if (this.config.environment !== 'development') {
      this.initializeK8sClient();
    }
  }

  protected async onStart(): Promise<void> {
    if (!this.config.enabled) {
      logger.warn('Service deployment is disabled');
      return;
    }

    logger.info('Service Deployment Manager started');
  }

  protected async onStop(): Promise<void> {
    logger.info('Service Deployment Manager stopped');
  }

  @HealthCheck({
    name: 'deployment:kubernetes',
    critical: false,
    interval: 60000,
  })
  async checkKubernetesConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    if (this.config.environment === 'development') {
      return { status: 'healthy', message: 'Development mode - no K8s connection' };
    }

    try {
      if (this.k8sCore) {
        await this.k8sCore.listNamespace();
        return { status: 'healthy', message: 'Kubernetes API connected' };
      }
      return { status: 'unhealthy', message: 'Kubernetes client not initialized' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `Kubernetes connection failed: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Deploy a service
   */
  @Metric({ name: 'deployment.deploy', recordDuration: true })
  async deployService(
    serviceName: string,
    options: {
      version: string;
      image: string;
      env?: Record<string, string>;
      configMaps?: string[];
      secrets?: string[];
    }
  ): Promise<void> {
    const service = ServiceRegistry.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found in registry`);
    }

    const startTime = Date.now();

    this.emit('deployment:started', {
      service: serviceName,
      version: options.version,
      strategy: this.config.deployment.strategy,
    });

    try {
      switch (this.config.deployment.strategy) {
        case 'rolling':
          await this.deployRolling(serviceName, options);
          break;
        case 'blue-green':
          await this.deployBlueGreen(serviceName, options);
          break;
        case 'canary':
          await this.deployCanary(serviceName, options);
          break;
      }

      const duration = Date.now() - startTime;
      this.emit('deployment:completed', {
        service: serviceName,
        duration,
      });

      logger.info('Service deployed successfully', {
        service: serviceName,
        version: options.version,
        duration,
      });

    } catch (error) {
      this.emit('deployment:failed', {
        service: serviceName,
        error: error as Error,
      });

      logger.error('Service deployment failed', {
        service: serviceName,
        error,
      });

      // Attempt rollback
      await this.rollbackDeployment(serviceName, 'deployment_failed');
      
      throw error;
    }
  }

  /**
   * Rolling deployment strategy
   */
  private async deployRolling(serviceName: string, options: any): Promise<void> {
    if (this.config.environment === 'development') {
      // Simulate deployment in development
      await this.simulateDeployment(serviceName, options);
      return;
    }

    const deployment = this.createDeploymentManifest(serviceName, options);
    
    try {
      const existing = await this.getExistingDeployment(serviceName);
      
      if (existing) {
        // Update existing deployment
        await this.k8sApi!.patchNamespacedDeployment(
          serviceName,
          this.config.kubernetes.namespace,
          deployment,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
        );
      } else {
        // Create new deployment
        await this.k8sApi!.createNamespacedDeployment(
          this.config.kubernetes.namespace,
          deployment
        );
      }

      // Monitor deployment progress
      await this.monitorDeployment(serviceName);

    } catch (error) {
      throw new Error(`Rolling deployment failed: ${error}`);
    }
  }

  /**
   * Blue-Green deployment strategy
   */
  private async deployBlueGreen(serviceName: string, options: any): Promise<void> {
    if (this.config.environment === 'development') {
      await this.simulateDeployment(serviceName, options);
      return;
    }

    // Create green deployment
    const greenDeployment = this.createDeploymentManifest(`${serviceName}-green`, options);
    
    try {
      // Deploy green version
      await this.k8sApi!.createNamespacedDeployment(
        this.config.kubernetes.namespace,
        greenDeployment
      );

      // Wait for green deployment to be ready
      await this.monitorDeployment(`${serviceName}-green`);

      // Switch traffic to green
      await this.switchTraffic(serviceName, 'green');

      // Delete blue deployment
      await this.k8sApi!.deleteNamespacedDeployment(
        `${serviceName}-blue`,
        this.config.kubernetes.namespace
      );

      // Rename green to blue for next deployment
      await this.renameDeployment(`${serviceName}-green`, `${serviceName}-blue`);

    } catch (error) {
      throw new Error(`Blue-Green deployment failed: ${error}`);
    }
  }

  /**
   * Canary deployment strategy
   */
  private async deployCanary(serviceName: string, options: any): Promise<void> {
    if (this.config.environment === 'development') {
      await this.simulateDeployment(serviceName, options);
      return;
    }

    const canaryDeployment = this.createDeploymentManifest(`${serviceName}-canary`, {
      ...options,
      replicas: 1, // Start with single replica
    });

    try {
      // Deploy canary version
      await this.k8sApi!.createNamespacedDeployment(
        this.config.kubernetes.namespace,
        canaryDeployment
      );

      // Wait for canary to be ready
      await this.monitorDeployment(`${serviceName}-canary`);

      // Gradually increase traffic to canary
      const steps = [10, 25, 50, 75, 100];
      for (const percentage of steps) {
        await this.adjustCanaryTraffic(serviceName, percentage);
        
        // Monitor metrics
        const healthy = await this.monitorCanaryHealth(serviceName);
        if (!healthy) {
          throw new Error('Canary deployment unhealthy');
        }

        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute between steps
      }

      // Promote canary to stable
      await this.promoteCanary(serviceName);

    } catch (error) {
      throw new Error(`Canary deployment failed: ${error}`);
    }
  }

  /**
   * Rollback a deployment
   */
  async rollbackDeployment(serviceName: string, reason: string): Promise<void> {
    this.emit('deployment:rollback', {
      service: serviceName,
      reason,
    });

    if (this.config.environment === 'development') {
      logger.info('Simulated rollback', { service: serviceName, reason });
      return;
    }

    try {
      // Get deployment history
      const deployment = await this.getExistingDeployment(serviceName);
      if (!deployment) {
        throw new Error(`Deployment ${serviceName} not found`);
      }

      // Rollback to previous revision
      await this.k8sApi!.createNamespacedDeploymentRollback(
        serviceName,
        this.config.kubernetes.namespace,
        {
          name: serviceName,
          rollbackTo: {
            revision: 0, // Previous revision
          },
        }
      );

      logger.info('Deployment rolled back', {
        service: serviceName,
        reason,
      });

    } catch (error) {
      logger.error('Rollback failed', {
        service: serviceName,
        error,
      });
      throw error;
    }
  }

  /**
   * Scale a service
   */
  @Metric({ name: 'deployment.scale' })
  async scaleService(serviceName: string, replicas: number, reason: string): Promise<void> {
    const currentReplicas = this.deployments.get(serviceName)?.spec?.replicas || 0;

    this.emit('scaling:triggered', {
      service: serviceName,
      from: currentReplicas,
      to: replicas,
      reason,
    });

    if (this.config.environment === 'development') {
      logger.info('Simulated scaling', {
        service: serviceName,
        from: currentReplicas,
        to: replicas,
      });
      return;
    }

    try {
      await this.k8sApi!.patchNamespacedDeploymentScale(
        serviceName,
        this.config.kubernetes.namespace,
        {
          spec: { replicas },
        }
      );

      logger.info('Service scaled', {
        service: serviceName,
        replicas,
        reason,
      });

    } catch (error) {
      logger.error('Scaling failed', {
        service: serviceName,
        error,
      });
      throw error;
    }
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(serviceName: string): Promise<{
    exists: boolean;
    ready: boolean;
    replicas: {
      desired: number;
      ready: number;
      available: number;
    };
    conditions: Array<{
      type: string;
      status: string;
      message?: string;
    }>;
  }> {
    if (this.config.environment === 'development') {
      return {
        exists: true,
        ready: true,
        replicas: { desired: 1, ready: 1, available: 1 },
        conditions: [{ type: 'Available', status: 'True' }],
      };
    }

    try {
      const deployment = await this.getExistingDeployment(serviceName);
      
      if (!deployment) {
        return {
          exists: false,
          ready: false,
          replicas: { desired: 0, ready: 0, available: 0 },
          conditions: [],
        };
      }

      const status = deployment.status!;
      
      return {
        exists: true,
        ready: status.readyReplicas === status.replicas,
        replicas: {
          desired: status.replicas || 0,
          ready: status.readyReplicas || 0,
          available: status.availableReplicas || 0,
        },
        conditions: status.conditions?.map(c => ({
          type: c.type,
          status: c.status,
          message: c.message,
        })) || [],
      };

    } catch (error) {
      logger.error('Failed to get deployment status', { error });
      throw error;
    }
  }

  /**
   * Initialize Kubernetes client
   */
  private initializeK8sClient(): void {
    const kc = new k8s.KubeConfig();

    if (this.config.kubernetes.inCluster) {
      kc.loadFromCluster();
    } else if (this.config.kubernetes.configFile) {
      kc.loadFromFile(this.config.kubernetes.configFile);
    } else {
      kc.loadFromDefault();
    }

    this.k8sApi = kc.makeApiClient(k8s.AppsV1Api);
    this.k8sCore = kc.makeApiClient(k8s.CoreV1Api);
  }

  /**
   * Create deployment manifest
   */
  private createDeploymentManifest(name: string, options: any): any {
    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name,
        namespace: this.config.kubernetes.namespace,
        labels: {
          app: name,
          version: options.version,
          'managed-by': 'service-deployment',
        },
      },
      spec: {
        replicas: options.replicas || this.config.deployment.replicas,
        selector: {
          matchLabels: {
            app: name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: name,
              version: options.version,
            },
            annotations: {
              'prometheus.io/scrape': 'true',
              'prometheus.io/port': '9090',
            },
          },
          spec: {
            containers: [{
              name,
              image: options.image,
              imagePullPolicy: 'Always',
              env: this.createEnvVars(options.env || {}),
              resources: {
                requests: this.config.resources.requests,
                limits: this.config.resources.limits,
              },
              livenessProbe: {
                httpGet: {
                  path: '/health',
                  port: 8080,
                },
                initialDelaySeconds: 30,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: {
                  path: '/health/ready',
                  port: 8080,
                },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
            }],
          },
        },
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: this.config.deployment.maxSurge,
            maxUnavailable: this.config.deployment.maxUnavailable,
          },
        },
      },
    };
  }

  /**
   * Create environment variables
   */
  private createEnvVars(env: Record<string, string>): any[] {
    return Object.entries(env).map(([name, value]) => ({ name, value }));
  }

  /**
   * Get existing deployment
   */
  private async getExistingDeployment(name: string): Promise<any> {
    try {
      const response = await this.k8sApi!.readNamespacedDeployment(
        name,
        this.config.kubernetes.namespace
      );
      return response.body;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Monitor deployment progress
   */
  private async monitorDeployment(name: string): Promise<void> {
    const maxWait = 600000; // 10 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const deployment = await this.getExistingDeployment(name);
      
      if (!deployment) {
        throw new Error(`Deployment ${name} not found`);
      }

      const status = deployment.status!;
      
      this.emit('deployment:progress', {
        service: name,
        replicas: {
          ready: status.readyReplicas || 0,
          total: status.replicas || 0,
        },
      });

      if (status.readyReplicas === status.replicas) {
        return; // Deployment complete
      }

      // Check for failure conditions
      const conditions = status.conditions || [];
      const failed = conditions.find(c => 
        c.type === 'Progressing' && 
        c.status === 'False' &&
        c.reason === 'ProgressDeadlineExceeded'
      );

      if (failed) {
        throw new Error(`Deployment failed: ${failed.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Deployment timeout');
  }

  /**
   * Simulate deployment for development
   */
  private async simulateDeployment(serviceName: string, options: any): Promise<void> {
    logger.info('Simulating deployment', {
      service: serviceName,
      version: options.version,
    });

    // Simulate deployment progress
    for (let i = 0; i <= this.config.deployment.replicas; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.emit('deployment:progress', {
        service: serviceName,
        replicas: {
          ready: i,
          total: this.config.deployment.replicas,
        },
      });
    }

    this.deployments.set(serviceName, {
      spec: { replicas: this.config.deployment.replicas },
      status: { readyReplicas: this.config.deployment.replicas },
    });
  }

  // Additional helper methods for blue-green and canary deployments...
  private async switchTraffic(serviceName: string, target: string): Promise<void> {
    // Implementation would update service selector
  }

  private async renameDeployment(from: string, to: string): Promise<void> {
    // Implementation would recreate deployment with new name
  }

  private async adjustCanaryTraffic(serviceName: string, percentage: number): Promise<void> {
    // Implementation would update ingress or service mesh rules
  }

  private async monitorCanaryHealth(serviceName: string): Promise<boolean> {
    // Implementation would check metrics and error rates
    return true;
  }

  private async promoteCanary(serviceName: string): Promise<void> {
    // Implementation would replace stable with canary
  }
}