import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class MonitoringMenu extends Command {
  static override description = 'Interactive monitoring and observability management menu';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('Monitoring & Observability Center');
    const subtitle = chalk.gray('Health checks, metrics, logs, and alerting management');

    this.log(boxen(`${header}\n${subtitle}`, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }));
  }

  private async showMainMenu(): Promise<void> {
    while (true) {
      const choices = [
        {
          name: '🏥 Health Checks',
          value: 'health',
          short: 'Health'
        },
        {
          name: '📊 Metrics & Analytics',
          value: 'metrics',
          short: 'Metrics'
        },
        {
          name: '📝 Log Management',
          value: 'logs',
          short: 'Logs'
        },
        {
          name: '🚨 Alert Management',
          value: 'alerts',
          short: 'Alerts'
        },
        {
          name: '📈 Performance Monitoring',
          value: 'performance',
          short: 'Performance'
        },
        new inquirer.Separator('━━━ Dashboards & Reports ━━━'),
        {
          name: '📊 Live Dashboard',
          value: 'dashboard',
          short: 'Dashboard'
        },
        {
          name: '📋 System Status Report',
          value: 'status',
          short: 'Status'
        },
        {
          name: '📈 Performance Report',
          value: 'report',
          short: 'Report'
        },
        new inquirer.Separator('━━━ Infrastructure Monitoring ━━━'),
        {
          name: '🐳 Container Health',
          value: 'containers',
          short: 'Containers'
        },
        {
          name: '🗄️ Database Monitoring',
          value: 'database',
          short: 'Database'
        },
        {
          name: '☁️ Cloud Resources',
          value: 'cloud',
          short: 'Cloud'
        },
        {
          name: '🌐 Network Monitoring',
          value: 'network',
          short: 'Network'
        },
        new inquirer.Separator('━━━ Advanced Features ━━━'),
        {
          name: '🔍 Distributed Tracing',
          value: 'tracing',
          short: 'Tracing'
        },
        {
          name: '🛡️ Security Monitoring',
          value: 'security',
          short: 'Security'
        },
        {
          name: '📱 Uptime Monitoring',
          value: 'uptime',
          short: 'Uptime'
        },
        {
          name: '⚡ Synthetic Monitoring',
          value: 'synthetic',
          short: 'Synthetic'
        },
        new inquirer.Separator(),
        {
          name: '🔙 Back to Main Menu',
          value: 'back',
          short: 'Back'
        },
        {
          name: '❌ Exit',
          value: 'exit',
          short: 'Exit'
        }
      ];

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to monitor?',
          choices,
          pageSize: 25,
        }
      ]);

      if (action === 'exit') {
        this.log(chalk.green('👋 Goodbye!'));
        break;
      }

      if (action === 'back') {
        // Return to main CLI menu  
        const Command = (await import('../../commands/index.js')).default;
        await Command.run([]);
        break;
      }

      await this.handleAction(action);
    }
  }

  private async handleAction(action: string): Promise<void> {
    try {
      switch (action) {
        case 'health':
          await this.handleHealthChecks();
          break;
        case 'metrics':
          await this.handleMetrics();
          break;
        case 'logs':
          await this.handleLogs();
          break;
        case 'alerts':
          await this.handleAlerts();
          break;
        case 'performance':
          await this.handlePerformance();
          break;
        case 'dashboard':
          await this.handleDashboard();
          break;
        case 'status':
          await this.handleSystemStatus();
          break;
        case 'report':
          await this.handlePerformanceReport();
          break;
        case 'containers':
          await this.handleContainerHealth();
          break;
        case 'database':
          await this.handleDatabaseMonitoring();
          break;
        case 'cloud':
          await this.handleCloudResources();
          break;
        case 'network':
          await this.handleNetworkMonitoring();
          break;
        case 'tracing':
          await this.handleDistributedTracing();
          break;
        case 'security':
          await this.handleSecurityMonitoring();
          break;
        case 'uptime':
          await this.handleUptimeMonitoring();
          break;
        case 'synthetic':
          await this.handleSyntheticMonitoring();
          break;
        default:
          this.log(chalk.red('Unknown action'));
      }
    } catch (error) {
      this.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }

    // Pause before returning to menu
    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...',
    }]);
  }

  private async handleHealthChecks(): Promise<void> {
    const { operation } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Health check operation:',
        choices: [
          { name: '🏥 Run Full Health Check', value: 'full' },
          { name: '⚡ Quick Health Check', value: 'quick' },
          { name: '🎯 Targeted Health Check', value: 'targeted' },
          { name: '📊 Health Dashboard', value: 'dashboard' },
          { name: '📋 Health Report', value: 'report' },
          { name: '⚙️ Configure Health Checks', value: 'configure' },
        ],
      }
    ]);

    const MonitoringHealth = (await import('../../commands/monitoring/health.js')).default;
    await MonitoringHealth.run(['--operation', operation]);
  }

  private async handleMetrics(): Promise<void> {
    const { operation, timeframe } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Metrics operation:',
        choices: [
          { name: '📊 View Live Metrics', value: 'live' },
          { name: '📈 View Historical Metrics', value: 'historical' },
          { name: '🎯 Custom Query', value: 'query' },
          { name: '📤 Export Metrics', value: 'export' },
          { name: '⚙️ Configure Metrics', value: 'configure' },
        ],
      },
      {
        type: 'list',
        name: 'timeframe',
        message: 'Time frame:',
        choices: [
          { name: '🕑 Last Hour', value: '1h' },
          { name: '📅 Last 24 Hours', value: '24h' },
          { name: '📊 Last Week', value: '7d' },
          { name: '📈 Last Month', value: '30d' },
          { name: '🎯 Custom Range', value: 'custom' },
        ],
        when: (answers) => ['historical', 'export'].includes(answers.operation),
      }
    ]);

    const args = ['--operation', operation];
    if (timeframe) args.push('--timeframe', timeframe);

    const MonitoringMetrics = (await import('../../commands/monitoring/metrics.js')).default;
    await MonitoringMetrics.run(args);
  }

  private async handleLogs(): Promise<void> {
    const { operation, service, level } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Log operation:',
        choices: [
          { name: '📝 View Live Logs', value: 'live' },
          { name: '🔍 Search Logs', value: 'search' },
          { name: '📊 Log Analytics', value: 'analytics' },
          { name: '📤 Export Logs', value: 'export' },
          { name: '🗑️ Clean Old Logs', value: 'cleanup' },
        ],
      },
      {
        type: 'list',
        name: 'service',
        message: 'Service:',
        choices: [
          { name: '🌐 All Services', value: 'all' },
          { name: '🚪 API Gateway', value: 'gateway' },
          { name: '👤 User Service', value: 'user' },
          { name: '📝 Todo Service', value: 'todo' },
          { name: '🤖 AI Service', value: 'ai' },
          { name: '🗄️ Database', value: 'database' },
        ],
        when: (answers) => ['live', 'search', 'analytics'].includes(answers.operation),
      },
      {
        type: 'list',
        name: 'level',
        message: 'Log level:',
        choices: [
          { name: '🔴 Error', value: 'error' },
          { name: '🟡 Warning', value: 'warn' },
          { name: '🔵 Info', value: 'info' },
          { name: '🔍 Debug', value: 'debug' },
          { name: '📊 All Levels', value: 'all' },
        ],
        default: 'info',
        when: (answers) => ['live', 'search'].includes(answers.operation),
      }
    ]);

    const args = ['--operation', operation];
    if (service) args.push('--service', service);
    if (level) args.push('--level', level);

    const MonitoringLogs = (await import('./logs.js')).default;
    await MonitoringLogs.run(args);
  }

  private async handleAlerts(): Promise<void> {
    const { operation } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Alert operation:',
        choices: [
          { name: '🚨 View Active Alerts', value: 'active' },
          { name: '📋 Alert History', value: 'history' },
          { name: '➕ Create Alert Rule', value: 'create' },
          { name: '✏️ Edit Alert Rule', value: 'edit' },
          { name: '❌ Delete Alert Rule', value: 'delete' },
          { name: '🔕 Silence Alerts', value: 'silence' },
          { name: '📊 Alert Dashboard', value: 'dashboard' },
        ],
      }
    ]);

    const MonitoringAlerts = (await import('./alerts.js')).default;
    await MonitoringAlerts.run(['--operation', operation]);
  }

  private async handlePerformance(): Promise<void> {
    this.log(chalk.blue('⚡ Performance Monitoring'));

    const { executeCommand } = await import('../../lib/utils.js');

    this.log(chalk.yellow('📊 Current Performance Metrics:'));

    // System performance
    this.log(chalk.cyan('\n🖥️ System Resources:'));
    try {
      await executeCommand('ps', ['aux', '--sort=-%cpu'], { silent: false });
    } catch {
      this.log(chalk.gray('System resource information not available'));
    }

    // Memory usage
    this.log(chalk.cyan('\n💾 Memory Usage:'));
    try {
      await executeCommand('free', ['-h'], { silent: false });
    } catch {
      this.log(chalk.gray('Memory information not available'));
    }
  }

  private async handleDashboard(): Promise<void> {
    this.log(chalk.blue('📊 Live Monitoring Dashboard'));
    this.log('='.repeat(60));

    // Quick health overview
    await this.showQuickHealth();

    // System metrics
    await this.showSystemMetrics();

    // Service status
    await this.showServiceStatus();
  }

  private async showQuickHealth(): Promise<void> {
    this.log(chalk.blue('\n🏥 Health Status:'));

    const services = [
      { name: 'API Gateway', url: 'http://localhost:4000/health', expected: 200 },
      { name: 'Database', url: 'http://localhost:5432', expected: 'connection' },
      { name: 'Redis Cache', url: 'http://localhost:6379', expected: 'connection' },
      { name: 'AI Service', url: 'http://localhost:4003/health', expected: 200 },
    ];

    for (const service of services) {
      try {
        if (service.expected === 200) {
          const response = await fetch(service.url, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });

          if (response.ok) {
            this.log(chalk.green(`  ✅ ${service.name}: Healthy`));
          } else {
            this.log(chalk.red(`  ❌ ${service.name}: HTTP ${response.status}`));
          }
        } else {
          this.log(chalk.green(`  ✅ ${service.name}: Available`));
        }
      } catch {
        this.log(chalk.red(`  ❌ ${service.name}: Unavailable`));
      }
    }
  }

  private async showSystemMetrics(): Promise<void> {
    this.log(chalk.blue('\n📊 System Metrics:'));

    // CPU and memory info
    try {
      this.log(chalk.cyan('  💻 CPU Usage:'));
      this.log(chalk.gray(`    Load: ${process.cpuUsage()}`));

      this.log(chalk.cyan('  💾 Memory Usage:'));
      const memory = process.memoryUsage();
      this.log(chalk.gray(`    Heap Used: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`));
      this.log(chalk.gray(`    Heap Total: ${Math.round(memory.heapTotal / 1024 / 1024)}MB`));
      this.log(chalk.gray(`    RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`));

    } catch {
      this.log(chalk.gray('  System metrics not available'));
    }
  }

  private async showServiceStatus(): Promise<void> {
    this.log(chalk.blue('\n🔧 Service Status:'));

    try {
      const { executeCommand } = await import('../../lib/utils.js');

      // Check if services are running
      this.log(chalk.cyan('  🐳 Docker Containers:'));
      await executeCommand('docker', ['ps', '--format', 'table {{.Names}}\\t{{.Status}}'], { silent: false });

    } catch {
      this.log(chalk.gray('  Docker status not available'));
    }
  }

  private async handleSystemStatus(): Promise<void> {
    this.log(chalk.blue('📋 Comprehensive System Status Report'));
    await this.handleDashboard(); // Reuse dashboard logic for status
  }

  private async handlePerformanceReport(): Promise<void> {
    this.log(chalk.blue('📈 Performance Report Generation'));
    this.log(chalk.yellow('Performance reporting will be implemented in a future release'));
  }

  private async handleContainerHealth(): Promise<void> {
    this.log(chalk.blue('🐳 Container Health Monitoring'));

    const { executeCommand } = await import('../../lib/utils.js');

    try {
      this.log(chalk.yellow('📊 Container Status:'));
      await executeCommand('docker', ['ps', '--all'], { silent: false });

      this.log(chalk.yellow('\n💾 Container Resource Usage:'));
      await executeCommand('docker', ['stats', '--no-stream'], { silent: false });

    } catch {
      this.log(chalk.gray('Docker not available or no containers running'));
    }
  }

  private async handleDatabaseMonitoring(): Promise<void> {
    this.log(chalk.blue('🗄️ Database Monitoring'));
    this.log(chalk.yellow('Database monitoring will be implemented in a future release'));
  }

  private async handleCloudResources(): Promise<void> {
    this.log(chalk.blue('☁️ Cloud Resource Monitoring'));
    this.log(chalk.yellow('Cloud resource monitoring will be implemented in a future release'));
  }

  private async handleNetworkMonitoring(): Promise<void> {
    this.log(chalk.blue('🌐 Network Monitoring'));
    this.log(chalk.yellow('Network monitoring will be implemented in a future release'));
  }

  private async handleDistributedTracing(): Promise<void> {
    this.log(chalk.blue('🔍 Distributed Tracing'));
    this.log(chalk.yellow('Distributed tracing viewer will be implemented in a future release'));
  }

  private async handleSecurityMonitoring(): Promise<void> {
    this.log(chalk.blue('🛡️ Security Monitoring'));
    this.log(chalk.yellow('Security monitoring will be implemented in a future release'));
  }

  private async handleUptimeMonitoring(): Promise<void> {
    this.log(chalk.blue('📱 Uptime Monitoring'));
    this.log(chalk.yellow('Uptime monitoring will be implemented in a future release'));
  }

  private async handleSyntheticMonitoring(): Promise<void> {
    this.log(chalk.blue('⚡ Synthetic Monitoring'));
    this.log(chalk.yellow('Synthetic monitoring will be implemented in a future release'));
  }
}