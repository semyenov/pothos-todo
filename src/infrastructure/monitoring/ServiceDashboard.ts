import { BaseService } from '../core/BaseService.js';
import { ServiceEventMap } from '../core/TypedEventEmitter.js';
import { ServiceConfig, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { ServiceRegistry } from '../core/ServiceRegistry.js';
import { z } from 'zod';
import { logger } from '@/lib/unjs-utils.js';

const DashboardConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(9090),
  refreshInterval: z.number().min(1000).default(5000),
  retentionPeriod: z.number().default(3600), // 1 hour in seconds
});

type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

interface DashboardEventMap extends ServiceEventMap {
  'metrics:collected': { service: string; metrics: Record<string, any> };
  'alert:triggered': { service: string; alert: string; severity: 'info' | 'warning' | 'critical' };
}

interface ServiceMetrics {
  service: string;
  state: string;
  health: string;
  uptime: number;
  metrics: Record<string, number>;
  events: Array<{ timestamp: Date; event: string; data: any }>;
  errors: Array<{ timestamp: Date; error: string }>;
}

/**
 * Service Dashboard for monitoring all infrastructure services
 * Provides real-time metrics, health status, and event tracking
 */
@ServiceConfig({
  schema: DashboardConfigSchema,
  prefix: 'dashboard',
  hot: true,
})
export class ServiceDashboard extends BaseService<DashboardConfig, DashboardEventMap> {
  private metricsStore = new Map<string, ServiceMetrics>();
  private collectionInterval?: NodeJS.Timeout;

  static getInstance(): ServiceDashboard {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'service-dashboard';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Centralized monitoring dashboard for all infrastructure services';
  }

  protected async onInitialize(): Promise<void> {
    logger.info('Service Dashboard initializing', {
      port: this.config.port,
      refreshInterval: this.config.refreshInterval,
    });
  }

  protected async onStart(): Promise<void> {
    if (!this.config.enabled) {
      logger.warn('Service Dashboard is disabled');
      return;
    }

    // Start collecting metrics
    this.startMetricsCollection();

    // Subscribe to all service events
    this.subscribeToServiceEvents();

    logger.info('Service Dashboard started');
  }

  protected async onStop(): Promise<void> {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }

    logger.info('Service Dashboard stopped');
  }

  @HealthCheck({
    name: 'dashboard:health',
    critical: false,
    interval: 60000,
  })
  async checkDashboardHealth(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const services = ServiceRegistry.getAll();
    const monitoredCount = this.metricsStore.size;

    if (monitoredCount < services.size) {
      return {
        status: 'degraded',
        message: `Monitoring ${monitoredCount}/${services.size} services`,
      };
    }

    return {
      status: 'healthy',
      message: `Monitoring all ${monitoredCount} services`,
    };
  }

  /**
   * Get dashboard data for all services
   */
  @Metric({ name: 'dashboard.data.requested' })
  async getDashboardData(): Promise<{
    timestamp: Date;
    services: ServiceMetrics[];
    systemHealth: {
      healthy: boolean;
      totalServices: number;
      healthyServices: number;
      degradedServices: number;
      unhealthyServices: number;
    };
    alerts: Array<{ service: string; message: string; severity: string; timestamp: Date }>;
  }> {
    const services = Array.from(this.metricsStore.values());
    const systemHealth = await ServiceRegistry.getSystemHealth();

    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;

    for (const [_, health] of systemHealth.services) {
      switch (health.health) {
        case 'healthy':
          healthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
        case 'unhealthy':
          unhealthyCount++;
          break;
      }
    }

    // Collect recent alerts
    const alerts: any[] = [];
    for (const metrics of services) {
      if (metrics.errors.length > 0) {
        const recentErrors = metrics.errors.slice(-5);
        for (const error of recentErrors) {
          alerts.push({
            service: metrics.service,
            message: error.error,
            severity: 'warning',
            timestamp: error.timestamp,
          });
        }
      }
    }

    return {
      timestamp: new Date(),
      services,
      systemHealth: {
        healthy: systemHealth.healthy,
        totalServices: services.length,
        healthyServices: healthyCount,
        degradedServices: degradedCount,
        unhealthyServices: unhealthyCount,
      },
      alerts: alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20),
    };
  }

  /**
   * Get metrics for a specific service
   */
  getServiceMetrics(serviceName: string): ServiceMetrics | undefined {
    return this.metricsStore.get(serviceName);
  }

  /**
   * Start collecting metrics from all services
   */
  private startMetricsCollection(): void {
    const collect = async () => {
      const services = ServiceRegistry.getAll();

      for (const [name, service] of services) {
        try {
          const health = await service.getHealth();
          const stats = service.getStats();

          let metrics = this.metricsStore.get(name);
          if (!metrics) {
            metrics = {
              service: name,
              state: service.state,
              health: health.status,
              uptime: Date.now() - service.metadata.startTime.getTime(),
              metrics: {},
              events: [],
              errors: [],
            };
            this.metricsStore.set(name, metrics);
          }

          // Update metrics
          metrics.state = service.state;
          metrics.health = health.status;
          metrics.uptime = Date.now() - service.metadata.startTime.getTime();
          metrics.metrics = {
            ...metrics.metrics,
            ...stats.metrics,
          };

          this.emit('metrics:collected', {
            service: name,
            metrics: metrics.metrics,
          });

          // Clean up old events
          const cutoff = Date.now() - this.config.retentionPeriod * 1000;
          metrics.events = metrics.events.filter(e => e.timestamp.getTime() > cutoff);
          metrics.errors = metrics.errors.filter(e => e.timestamp.getTime() > cutoff);

        } catch (error) {
          logger.error('Failed to collect metrics', {
            service: name,
            error: (error as Error).message,
          });
        }
      }
    };

    // Initial collection
    collect().catch(error => {
      logger.error('Metrics collection failed', { error });
    });

    // Schedule regular collection
    this.collectionInterval = setInterval(() => {
      collect().catch(error => {
        logger.error('Metrics collection failed', { error });
      });
    }, this.config.refreshInterval);
  }

  /**
   * Subscribe to events from all services
   */
  private subscribeToServiceEvents(): void {
    const services = ServiceRegistry.getAll();

    for (const [name, service] of services) {
      // Subscribe to errors
      service.on('service:error', (data) => {
        const metrics = this.metricsStore.get(name);
        if (metrics) {
          metrics.errors.push({
            timestamp: new Date(),
            error: data.error.message,
          });

          this.emit('alert:triggered', {
            service: name,
            alert: `Service error: ${data.error.message}`,
            severity: data.fatal ? 'critical' : 'warning',
          });
        }
      });

      // Subscribe to state changes
      service.on('service:state-changed', (data) => {
        const metrics = this.metricsStore.get(name);
        if (metrics) {
          metrics.state = data.to;
          metrics.events.push({
            timestamp: new Date(),
            event: 'state-changed',
            data,
          });
        }
      });

      // Subscribe to health changes
      service.on('health:changed', (data) => {
        const metrics = this.metricsStore.get(name);
        if (metrics) {
          metrics.health = data.status;
          metrics.events.push({
            timestamp: new Date(),
            event: 'health-changed',
            data,
          });

          if (data.status === 'unhealthy') {
            this.emit('alert:triggered', {
              service: name,
              alert: `Service unhealthy: ${data.checks[0]?.message || 'Unknown'}`,
              severity: 'critical',
            });
          }
        }
      });
    }
  }

  /**
   * Generate a summary report
   */
  async generateReport(): Promise<string> {
    const data = await this.getDashboardData();
    
    let report = `# Service Dashboard Report\n\n`;
    report += `Generated: ${data.timestamp.toISOString()}\n\n`;
    
    report += `## System Health\n`;
    report += `- Status: ${data.systemHealth.healthy ? '✅ Healthy' : '❌ Unhealthy'}\n`;
    report += `- Total Services: ${data.systemHealth.totalServices}\n`;
    report += `- Healthy: ${data.systemHealth.healthyServices}\n`;
    report += `- Degraded: ${data.systemHealth.degradedServices}\n`;
    report += `- Unhealthy: ${data.systemHealth.unhealthyServices}\n\n`;
    
    report += `## Service Details\n`;
    for (const service of data.services) {
      report += `\n### ${service.service}\n`;
      report += `- State: ${service.state}\n`;
      report += `- Health: ${service.health}\n`;
      report += `- Uptime: ${Math.floor(service.uptime / 1000 / 60)} minutes\n`;
      
      if (Object.keys(service.metrics).length > 0) {
        report += `- Metrics:\n`;
        for (const [key, value] of Object.entries(service.metrics)) {
          report += `  - ${key}: ${value}\n`;
        }
      }
      
      if (service.errors.length > 0) {
        report += `- Recent Errors: ${service.errors.length}\n`;
      }
    }
    
    if (data.alerts.length > 0) {
      report += `\n## Recent Alerts\n`;
      for (const alert of data.alerts.slice(0, 10)) {
        report += `- [${alert.severity.toUpperCase()}] ${alert.service}: ${alert.message} (${alert.timestamp.toISOString()})\n`;
      }
    }
    
    return report;
  }
}