import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export default class GenerateInfrastructure extends Command {
    static override description = 'Generate infrastructure components';

    static override examples = [
        '<%= config.bin %> <%= command.id %> --component eventhandler --pattern singleton',
        '<%= config.bin %> <%= command.id %> --component healthcheck --pattern eventdriven',
    ];

    static override flags = {
        component: Flags.string({
            description: 'Infrastructure component type',
            options: ['eventhandler', 'healthcheck', 'gateway', 'middleware', 'metrics', 'monitor'],
            required: true,
        }),
        pattern: Flags.string({
            description: 'Implementation pattern',
            options: ['singleton', 'eventdriven', 'async'],
            default: 'singleton',
        }),
        name: Flags.string({
            description: 'Component name (PascalCase)',
            required: true,
        }),
        output: Flags.string({
            description: 'Output directory',
            default: 'src/infrastructure',
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenerateInfrastructure);

        try {
            await this.generateInfrastructureComponent(flags);
            this.log(chalk.green('✅ Infrastructure component generated successfully'));
        } catch (error) {
            this.error(`Failed to generate infrastructure component: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async generateInfrastructureComponent(flags: any): Promise<void> {
        const { component, pattern, name, output } = flags;

        // Ensure output directory exists
        await fs.mkdir(output, { recursive: true });

        switch (component) {
            case 'eventhandler':
                await this.generateEventHandler(name, pattern, output);
                break;
            case 'healthcheck':
                await this.generateHealthCheck(name, pattern, output);
                break;
            case 'gateway':
                await this.generateGateway(name, pattern, output);
                break;
            case 'middleware':
                await this.generateMiddleware(name, pattern, output);
                break;
            case 'metrics':
                await this.generateMetricsCollector(name, pattern, output);
                break;
            case 'monitor':
                await this.generateMonitor(name, pattern, output);
                break;
            default:
                throw new Error(`Unknown component type: ${component}`);
        }
    }

    private async generateEventHandler(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}EventHandler`;
        const fileName = `${name}EventHandler.ts`;
        const filePath = path.join(output, 'events', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { DomainEvent } from '../../domain/events/DomainEvent';
import { EventHandler } from '../../domain/events/EventHandler';
import { Logger } from '../../logger';

export class ${className} implements EventHandler {
  private static instance: ${className} | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('${className}');
  }

  public static getInstance(): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}();
    }
    return ${className}.instance;
  }

  async handle(event: DomainEvent): Promise<void> {
    this.logger.info('Handling event', { eventType: event.type, eventId: event.id });
    
    try {
      // TODO: Implement event handling logic
      this.logger.info('Event handled successfully', { eventId: event.id });
    } catch (error) {
      this.logger.error('Failed to handle event', { eventId: event.id, error });
      throw error;
    }
  }

  async canHandle(event: DomainEvent): Promise<boolean> {
    // TODO: Implement event type checking logic
    return true;
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated event handler: ${filePath}`));
    }

    private async generateHealthCheck(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}HealthCheck`;
        const fileName = `${name}HealthCheck.ts`;
        const filePath = path.join(output, 'monitoring', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { HealthCheck } from '../../domain/core/HealthCheck';
import { Logger } from '../../logger';

export interface ${name}HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  timestamp: Date;
  details?: Record<string, any>;
}

export class ${className} implements HealthCheck {
  private static instance: ${className} | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('${className}');
  }

  public static getInstance(): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}();
    }
    return ${className}.instance;
  }

  async check(): Promise<${name}HealthStatus> {
    this.logger.info('Performing health check');

    try {
      // TODO: Implement health check logic
      const status: ${name}HealthStatus = {
        status: 'healthy',
        message: 'Service is healthy',
        timestamp: new Date(),
        details: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        }
      };

      this.logger.info('Health check completed', { status: status.status });
      return status;
    } catch (error) {
      this.logger.error('Health check failed', { error });
      return {
        status: 'unhealthy',
        message: 'Health check failed',
        timestamp: new Date(),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    const status = await this.check();
    return status.status === 'healthy';
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated health check: ${filePath}`));
    }

    private async generateGateway(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}Gateway`;
        const fileName = `${name}Gateway.ts`;
        const filePath = path.join(output, 'gateway', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { Logger } from '../../logger';

export interface ${name}GatewayConfig {
  endpoint: string;
  timeout: number;
  retries: number;
}

export class ${className} {
  private static instance: ${className} | null = null;
  private logger: Logger;
  private config: ${name}GatewayConfig;

  private constructor(config: ${name}GatewayConfig) {
    this.logger = new Logger('${className}');
    this.config = config;
  }

  public static getInstance(config: ${name}GatewayConfig): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}(config);
    }
    return ${className}.instance;
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting to gateway', { endpoint: this.config.endpoint });
    
    try {
      // TODO: Implement connection logic
      this.logger.info('Gateway connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to gateway', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from gateway');
    
    try {
      // TODO: Implement disconnection logic
      this.logger.info('Gateway disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from gateway', { error });
      throw error;
    }
  }

  async send(data: any): Promise<any> {
    this.logger.info('Sending data through gateway', { dataType: typeof data });
    
    try {
      // TODO: Implement data sending logic
      this.logger.info('Data sent successfully');
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to send data through gateway', { error });
      throw error;
    }
  }

  async receive(): Promise<any> {
    this.logger.info('Receiving data from gateway');
    
    try {
      // TODO: Implement data receiving logic
      this.logger.info('Data received successfully');
      return { data: 'sample data' };
    } catch (error) {
      this.logger.error('Failed to receive data from gateway', { error });
      throw error;
    }
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated gateway: ${filePath}`));
    }

    private async generateMiddleware(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}Middleware`;
        const fileName = `${name}Middleware.ts`;
        const filePath = path.join(output, 'middleware', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../logger';

export interface ${name}MiddlewareConfig {
  enabled: boolean;
  options?: Record<string, any>;
}

export class ${className} {
  private static instance: ${className} | null = null;
  private logger: Logger;
  private config: ${name}MiddlewareConfig;

  private constructor(config: ${name}MiddlewareConfig) {
    this.logger = new Logger('${className}');
    this.config = config;
  }

  public static getInstance(config: ${name}MiddlewareConfig): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}(config);
    }
    return ${className}.instance;
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!this.config.enabled) {
        return next();
      }

      const startTime = Date.now();
      this.logger.info('Processing request', { 
        method: req.method, 
        url: req.url,
        userAgent: req.get('User-Agent')
      });

      try {
        // TODO: Implement middleware logic
        this.logger.info('Request processed successfully', { 
          duration: Date.now() - startTime 
        });
        next();
      } catch (error) {
        this.logger.error('Middleware processing failed', { error });
        next(error);
      }
    };
  }

  async processRequest(req: Request): Promise<void> {
    // TODO: Implement request processing logic
    this.logger.info('Processing request in middleware', { 
      method: req.method, 
      url: req.url 
    });
  }

  async processResponse(res: Response): Promise<void> {
    // TODO: Implement response processing logic
    this.logger.info('Processing response in middleware', { 
      statusCode: res.statusCode 
    });
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated middleware: ${filePath}`));
    }

    private async generateMetricsCollector(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}MetricsCollector`;
        const fileName = `${name}MetricsCollector.ts`;
        const filePath = path.join(output, 'monitoring', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { Logger } from '../../logger';

export interface ${name}Metrics {
  timestamp: Date;
  value: number;
  unit: string;
  labels?: Record<string, string>;
}

export class ${className} {
  private static instance: ${className} | null = null;
  private logger: Logger;
  private metrics: ${name}Metrics[] = [];

  private constructor() {
    this.logger = new Logger('${className}');
  }

  public static getInstance(): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}();
    }
    return ${className}.instance;
  }

  async collect(): Promise<${name}Metrics[]> {
    this.logger.info('Collecting metrics');

    try {
      // TODO: Implement metrics collection logic
      const metrics: ${name}Metrics[] = [
        {
          timestamp: new Date(),
          value: Math.random() * 100,
          unit: 'requests/second',
          labels: { service: '${name.toLowerCase()}' }
        }
      ];

      this.metrics.push(...metrics);
      this.logger.info('Metrics collected successfully', { count: metrics.length });
      
      return metrics;
    } catch (error) {
      this.logger.error('Failed to collect metrics', { error });
      throw error;
    }
  }

  async getMetrics(): Promise<${name}Metrics[]> {
    return this.metrics;
  }

  async clearMetrics(): Promise<void> {
    this.metrics = [];
    this.logger.info('Metrics cleared');
  }

  async exportMetrics(): Promise<string> {
    // TODO: Implement metrics export logic (e.g., Prometheus format)
    return JSON.stringify(this.metrics, null, 2);
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated metrics collector: ${filePath}`));
    }

    private async generateMonitor(name: string, pattern: string, output: string): Promise<void> {
        const className = `${name}Monitor`;
        const fileName = `${name}Monitor.ts`;
        const filePath = path.join(output, 'monitoring', fileName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const template = `import { Logger } from '../../logger';

export interface ${name}MonitorConfig {
  interval: number;
  enabled: boolean;
  alertThreshold?: number;
}

export interface ${name}MonitorStatus {
  isHealthy: boolean;
  lastCheck: Date;
  metrics: Record<string, any>;
  alerts: string[];
}

export class ${className} {
  private static instance: ${className} | null = null;
  private logger: Logger;
  private config: ${name}MonitorConfig;
  private intervalId?: NodeJS.Timeout;

  private constructor(config: ${name}MonitorConfig) {
    this.logger = new Logger('${className}');
    this.config = config;
  }

  public static getInstance(config: ${name}MonitorConfig): ${className} {
    if (!${className}.instance) {
      ${className}.instance = new ${className}(config);
    }
    return ${className}.instance;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Monitor is disabled');
      return;
    }

    this.logger.info('Starting monitor', { interval: this.config.interval });
    
    this.intervalId = setInterval(async () => {
      await this.performCheck();
    }, this.config.interval);

    this.logger.info('Monitor started successfully');
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.logger.info('Monitor stopped');
    }
  }

  private async performCheck(): Promise<void> {
    try {
      this.logger.info('Performing monitoring check');
      
      // TODO: Implement monitoring check logic
      const status: ${name}MonitorStatus = {
        isHealthy: true,
        lastCheck: new Date(),
        metrics: {
          cpu: Math.random() * 100,
          memory: Math.random() * 100,
          responseTime: Math.random() * 1000
        },
        alerts: []
      };

      if (this.config.alertThreshold && status.metrics.cpu > this.config.alertThreshold) {
        status.alerts.push('High CPU usage detected');
        status.isHealthy = false;
      }

      this.logger.info('Monitoring check completed', { 
        isHealthy: status.isHealthy,
        alerts: status.alerts.length 
      });

      if (!status.isHealthy) {
        await this.handleAlert(status);
      }
    } catch (error) {
      this.logger.error('Monitoring check failed', { error });
    }
  }

  private async handleAlert(status: ${name}MonitorStatus): Promise<void> {
    this.logger.warn('Alert triggered', { alerts: status.alerts });
    
    // TODO: Implement alert handling logic (e.g., send notifications)
    this.logger.info('Alert handled');
  }

  async getStatus(): Promise<${name}MonitorStatus> {
    // TODO: Return current monitoring status
    return {
      isHealthy: true,
      lastCheck: new Date(),
      metrics: {},
      alerts: []
    };
  }
}

export default ${className};
`;

        await fs.writeFile(filePath, template);
        this.log(chalk.blue(`📝 Generated monitor: ${filePath}`));
    }
} 