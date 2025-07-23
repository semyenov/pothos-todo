#!/usr/bin/env bun

import { Command } from 'commander';
import { ServiceRegistry } from '@/infrastructure/core/ServiceRegistry.js';
import { ServiceDashboard } from '@/infrastructure/monitoring/ServiceDashboard.js';
import { logger } from '@/lib/unjs-utils.js';
import { Table } from 'console-table-printer';
import chalk from 'chalk';

const program = new Command();

program
  .name('service-manager')
  .description('Manage infrastructure services with the new BaseService architecture')
  .version('1.0.0');

// List all services
program
  .command('list')
  .description('List all registered services')
  .action(async () => {
    try {
      const services = ServiceRegistry.getAll();
      const health = await ServiceRegistry.getSystemHealth();

      const table = new Table({
        columns: [
          { name: 'service', title: 'Service', alignment: 'left' },
          { name: 'version', title: 'Version' },
          { name: 'state', title: 'State' },
          { name: 'health', title: 'Health' },
          { name: 'uptime', title: 'Uptime' },
          { name: 'dependencies', title: 'Dependencies' },
        ],
      });

      for (const [name, service] of services) {
        const serviceHealth = health.services.get(name);
        const uptime = serviceHealth ? formatUptime(serviceHealth.uptime) : 'N/A';
        
        table.addRow({
          service: name,
          version: service.metadata.version,
          state: colorizeState(service.state),
          health: colorizeHealth(serviceHealth?.health || 'unknown'),
          uptime,
          dependencies: (service.metadata.dependencies || []).join(', ') || 'None',
        });
      }

      table.printTable();
    } catch (error) {
      console.error(chalk.red('Failed to list services:'), error);
      process.exit(1);
    }
  });

// Start a service
program
  .command('start <service>')
  .description('Start a specific service')
  .action(async (serviceName: string) => {
    try {
      const service = ServiceRegistry.get(serviceName);
      if (!service) {
        console.error(chalk.red(`Service '${serviceName}' not found`));
        process.exit(1);
      }

      if (service.state === 'running') {
        console.log(chalk.yellow(`Service '${serviceName}' is already running`));
        return;
      }

      console.log(chalk.blue(`Starting service '${serviceName}'...`));
      await service.start();
      console.log(chalk.green(`✓ Service '${serviceName}' started successfully`));
    } catch (error) {
      console.error(chalk.red(`Failed to start service:`), error);
      process.exit(1);
    }
  });

// Stop a service
program
  .command('stop <service>')
  .description('Stop a specific service')
  .option('-r, --reason <reason>', 'Reason for stopping', 'Manual stop')
  .action(async (serviceName: string, options: { reason: string }) => {
    try {
      const service = ServiceRegistry.get(serviceName);
      if (!service) {
        console.error(chalk.red(`Service '${serviceName}' not found`));
        process.exit(1);
      }

      if (service.state !== 'running') {
        console.log(chalk.yellow(`Service '${serviceName}' is not running`));
        return;
      }

      console.log(chalk.blue(`Stopping service '${serviceName}'...`));
      await service.stop(options.reason);
      console.log(chalk.green(`✓ Service '${serviceName}' stopped successfully`));
    } catch (error) {
      console.error(chalk.red(`Failed to stop service:`), error);
      process.exit(1);
    }
  });

// Restart a service
program
  .command('restart <service>')
  .description('Restart a specific service')
  .action(async (serviceName: string) => {
    try {
      const service = ServiceRegistry.get(serviceName);
      if (!service) {
        console.error(chalk.red(`Service '${serviceName}' not found`));
        process.exit(1);
      }

      console.log(chalk.blue(`Restarting service '${serviceName}'...`));
      await service.restart();
      console.log(chalk.green(`✓ Service '${serviceName}' restarted successfully`));
    } catch (error) {
      console.error(chalk.red(`Failed to restart service:`), error);
      process.exit(1);
    }
  });

// Get service health
program
  .command('health [service]')
  .description('Check health of a service or all services')
  .action(async (serviceName?: string) => {
    try {
      if (serviceName) {
        // Check specific service
        const service = ServiceRegistry.get(serviceName);
        if (!service) {
          console.error(chalk.red(`Service '${serviceName}' not found`));
          process.exit(1);
        }

        const health = await service.getHealth();
        console.log(chalk.bold(`\nHealth Status for ${serviceName}:`));
        console.log(`Status: ${colorizeHealth(health.status)}`);
        console.log(`Message: ${health.message || 'No message'}`);

        if (health.checks && health.checks.length > 0) {
          console.log('\nHealth Checks:');
          const table = new Table({
            columns: [
              { name: 'check', title: 'Check' },
              { name: 'status', title: 'Status' },
              { name: 'message', title: 'Message' },
            ],
          });

          for (const check of health.checks) {
            table.addRow({
              check: check.name,
              status: colorizeHealth(check.status),
              message: check.message,
            });
          }

          table.printTable();
        }
      } else {
        // Check all services
        const health = await ServiceRegistry.getSystemHealth();
        console.log(chalk.bold('\nSystem Health Status:'));
        console.log(`Overall: ${health.healthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy')}`);

        const table = new Table({
          columns: [
            { name: 'service', title: 'Service' },
            { name: 'health', title: 'Health' },
            { name: 'state', title: 'State' },
            { name: 'uptime', title: 'Uptime' },
          ],
        });

        for (const [name, status] of health.services) {
          table.addRow({
            service: name,
            health: colorizeHealth(status.health),
            state: colorizeState(status.state),
            uptime: formatUptime(status.uptime),
          });
        }

        table.printTable();
      }
    } catch (error) {
      console.error(chalk.red('Failed to check health:'), error);
      process.exit(1);
    }
  });

// Show service stats
program
  .command('stats <service>')
  .description('Show statistics for a service')
  .action(async (serviceName: string) => {
    try {
      const service = ServiceRegistry.get(serviceName);
      if (!service) {
        console.error(chalk.red(`Service '${serviceName}' not found`));
        process.exit(1);
      }

      const stats = service.getStats();
      console.log(chalk.bold(`\nStatistics for ${serviceName}:`));
      console.log(JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error(chalk.red('Failed to get stats:'), error);
      process.exit(1);
    }
  });

// Show dependencies
program
  .command('deps [service]')
  .description('Show service dependencies')
  .action(async (serviceName?: string) => {
    try {
      if (serviceName) {
        const deps = ServiceRegistry.checkDependencies(serviceName);
        console.log(chalk.bold(`\nDependencies for ${serviceName}:`));
        
        if (deps.satisfied) {
          console.log(chalk.green('✓ All dependencies satisfied'));
        } else {
          console.log(chalk.red(`✗ Missing dependencies: ${deps.missing.join(', ')}`));
        }
      } else {
        const graph = ServiceRegistry.getDependencyGraph();
        console.log(chalk.bold('\nService Dependency Graph:'));
        
        for (const [service, deps] of graph) {
          if (deps.length > 0) {
            console.log(`${service} → ${deps.join(', ')}`);
          } else {
            console.log(`${service} → (no dependencies)`);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Failed to show dependencies:'), error);
      process.exit(1);
    }
  });

// Start all services
program
  .command('start-all')
  .description('Start all services in dependency order')
  .action(async () => {
    try {
      console.log(chalk.blue('Starting all services...'));
      await ServiceRegistry.startAll();
      console.log(chalk.green('✓ All services started successfully'));
    } catch (error) {
      console.error(chalk.red('Failed to start all services:'), error);
      process.exit(1);
    }
  });

// Stop all services
program
  .command('stop-all')
  .description('Stop all services in reverse dependency order')
  .action(async () => {
    try {
      console.log(chalk.blue('Stopping all services...'));
      await ServiceRegistry.stopAll();
      console.log(chalk.green('✓ All services stopped successfully'));
    } catch (error) {
      console.error(chalk.red('Failed to stop all services:'), error);
      process.exit(1);
    }
  });

// Dashboard command
program
  .command('dashboard')
  .description('Show service monitoring dashboard')
  .option('-w, --watch', 'Watch mode (refresh every 5 seconds)')
  .action(async (options: { watch?: boolean }) => {
    try {
      const dashboard = ServiceDashboard.getInstance();
      await dashboard.start();

      const showDashboard = async () => {
        console.clear();
        const data = await dashboard.getDashboardData();
        
        console.log(chalk.bold.cyan('=== Service Monitoring Dashboard ==='));
        console.log(`Timestamp: ${data.timestamp.toISOString()}`);
        console.log();
        
        // System health
        console.log(chalk.bold('System Health:'));
        console.log(`Status: ${data.systemHealth.healthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy')}`);
        console.log(`Services: ${data.systemHealth.healthyServices}/${data.systemHealth.totalServices} healthy`);
        
        if (data.systemHealth.degradedServices > 0) {
          console.log(chalk.yellow(`Degraded: ${data.systemHealth.degradedServices}`));
        }
        
        if (data.systemHealth.unhealthyServices > 0) {
          console.log(chalk.red(`Unhealthy: ${data.systemHealth.unhealthyServices}`));
        }
        
        console.log();
        
        // Services table
        const table = new Table({
          columns: [
            { name: 'service', title: 'Service', alignment: 'left' },
            { name: 'state', title: 'State' },
            { name: 'health', title: 'Health' },
            { name: 'uptime', title: 'Uptime' },
            { name: 'errors', title: 'Errors' },
          ],
        });

        for (const service of data.services) {
          table.addRow({
            service: service.service,
            state: colorizeState(service.state),
            health: colorizeHealth(service.health),
            uptime: formatUptime(service.uptime),
            errors: service.errors.length > 0 ? chalk.red(service.errors.length.toString()) : '0',
          });
        }

        table.printTable();
        
        // Recent alerts
        if (data.alerts.length > 0) {
          console.log(chalk.bold('\nRecent Alerts:'));
          for (const alert of data.alerts.slice(0, 5)) {
            const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : 'ℹ️';
            console.log(`${icon} [${alert.service}] ${alert.message}`);
          }
        }
        
        if (options.watch) {
          console.log(chalk.gray('\nPress Ctrl+C to exit...'));
        }
      };

      await showDashboard();

      if (options.watch) {
        setInterval(showDashboard, 5000);
      }
    } catch (error) {
      console.error(chalk.red('Failed to show dashboard:'), error);
      process.exit(1);
    }
  });

// Helper functions
function colorizeState(state: string): string {
  switch (state) {
    case 'running':
      return chalk.green(state);
    case 'stopped':
      return chalk.gray(state);
    case 'error':
      return chalk.red(state);
    case 'starting':
    case 'stopping':
      return chalk.yellow(state);
    default:
      return state;
  }
}

function colorizeHealth(health: string): string {
  switch (health) {
    case 'healthy':
      return chalk.green('✓ ' + health);
    case 'degraded':
      return chalk.yellow('⚠ ' + health);
    case 'unhealthy':
      return chalk.red('✗ ' + health);
    default:
      return chalk.gray('? ' + health);
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Parse and execute command
program.parse(process.argv);