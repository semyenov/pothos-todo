import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class FederationMenu extends Command {
  static override description = 'Interactive GraphQL federation management menu';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('GraphQL Federation Management');
    const subtitle = chalk.gray('Manage subgraphs, gateway, and federation testing');
    
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
          name: '🚀 Start Federation Development Environment',
          value: 'dev',
          short: 'Development Environment'
        },
        {
          name: '🐳 Start Federation with Docker',
          value: 'docker',
          short: 'Docker Federation'
        },
        {
          name: '🧪 Test Federation Setup',
          value: 'test',
          short: 'Test Federation'
        },
        {
          name: '🔧 Manage Individual Subgraphs',
          value: 'subgraphs',
          short: 'Manage Subgraphs'
        },
        {
          name: '🚪 Gateway Management',
          value: 'gateway',
          short: 'Gateway Management'
        },
        {
          name: '📊 Federation Status & Health',
          value: 'status',
          short: 'Federation Status'
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
          message: 'What would you like to do?',
          choices,
          pageSize: 15,
        }
      ]);

      if (action === 'exit') {
        this.log(chalk.green('👋 Goodbye!'));
        break;
      }

      if (action === 'back') {
        // Return to main CLI menu
        const { Command } = await import('../index.js');
        await Command.run([]);
        break;
      }

      await this.handleAction(action);
    }
  }

  private async handleAction(action: string): Promise<void> {
    try {
      switch (action) {
        case 'dev':
          await this.startDevelopmentEnvironment();
          break;
        case 'docker':
          await this.manageDockerFederation();
          break;
        case 'test':
          await this.testFederation();
          break;
        case 'subgraphs':
          await this.manageSubgraphs();
          break;
        case 'gateway':
          await this.manageGateway();
          break;
        case 'status':
          await this.showFederationStatus();
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

  private async startDevelopmentEnvironment(): Promise<void> {
    const { timeout, skipCleanup } = await inquirer.prompt([
      {
        type: 'number',
        name: 'timeout',
        message: 'Service startup timeout (seconds):',
        default: 30,
      },
      {
        type: 'confirm',
        name: 'skipCleanup',
        message: 'Skip cleanup of existing processes?',
        default: false,
      }
    ]);

    const args = [];
    if (timeout !== 30) args.push('--timeout', timeout.toString());
    if (skipCleanup) args.push('--skip-cleanup');

    const { FederationDev } = await import('./dev.js');
    await FederationDev.run(args);
  }

  private async manageDockerFederation(): Promise<void> {
    const { build, dev, logs } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'build',
        message: 'Build containers before starting?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'dev',
        message: 'Start in development mode?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'logs',
        message: 'Show logs after starting?',
        default: true,
      }
    ]);

    const args = [];
    if (build) args.push('--build');
    if (dev) args.push('--dev');
    if (logs) args.push('--logs');

    const { FederationDocker } = await import('./docker.js');
    await FederationDocker.run(args);
  }

  private async testFederation(): Promise<void> {
    const { verbose, servicesOnly, timeout } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'verbose',
        message: 'Show verbose output?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'servicesOnly',
        message: 'Test only service health (skip GraphQL queries)?',
        default: false,
      },
      {
        type: 'number',
        name: 'timeout',
        message: 'Health check timeout (seconds):',
        default: 10,
      }
    ]);

    const args = [];
    if (verbose) args.push('--verbose');
    if (servicesOnly) args.push('--services-only');
    if (timeout !== 10) args.push('--timeout', timeout.toString());

    const { FederationTest } = await import('./test.js');
    await FederationTest.run(args);
  }

  private async manageSubgraphs(): Promise<void> {
    const { subgraph, action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'subgraph',
        message: 'Which subgraph?',
        choices: [
          { name: '👤 User Subgraph', value: 'user' },
          { name: '📝 Todo Subgraph', value: 'todo' },
          { name: '🤖 AI Subgraph', value: 'ai' },
          { name: '🌐 All Subgraphs', value: 'all' },
        ]
      },
      {
        type: 'list',
        name: 'action',
        message: 'What action?',
        choices: [
          { name: '▶️  Start', value: 'start' },
          { name: '🔄 Restart', value: 'restart' },
          { name: '⏹️  Stop', value: 'stop' },
          { name: '🧪 Test', value: 'test' },
        ]
      }
    ]);

    // Execute subgraph action
    const { executeCommand } = await import('../../lib/utils.js');
    
    switch (action) {
      case 'start':
        if (subgraph === 'all') {
          await executeCommand('bun', ['run', 'federation:dev:manual'], { silent: false });
        } else {
          await executeCommand('bun', ['run', `subgraph:${subgraph}`], { silent: false });
        }
        break;
      case 'test':
        const port = subgraph === 'user' ? '4001' : subgraph === 'todo' ? '4002' : '4003';
        this.log(chalk.blue(`Testing ${subgraph} subgraph on port ${port}...`));
        try {
          const response = await fetch(`http://localhost:${port}/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '{ __typename }' }),
          });
          if (response.ok) {
            this.log(chalk.green(`✅ ${subgraph} subgraph is healthy`));
          } else {
            this.log(chalk.red(`❌ ${subgraph} subgraph returned HTTP ${response.status}`));
          }
        } catch (error) {
          this.log(chalk.red(`❌ ${subgraph} subgraph is not responding`));
        }
        break;
      default:
        this.log(chalk.yellow(`${action} action not implemented yet`));
    }
  }

  private async manageGateway(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Gateway action:',
        choices: [
          { name: '▶️  Start Development Gateway', value: 'dev' },
          { name: '🔒 Start Secure Gateway', value: 'secure' },
          { name: '⚡ Start Cached Gateway', value: 'cached' },
          { name: '🧪 Test Gateway', value: 'test' },
        ]
      }
    ]);

    const { executeCommand } = await import('../../lib/utils.js');

    switch (action) {
      case 'dev':
        await executeCommand('bun', ['run', 'gateway:dev'], { silent: false });
        break;
      case 'test':
        await executeCommand('bun', ['run', 'gateway:test'], { silent: false });
        break;
      case 'secure':
      case 'cached':
        this.log(chalk.yellow(`${action} gateway not implemented yet`));
        break;
    }
  }

  private async showFederationStatus(): Promise<void> {
    this.log(chalk.blue('📊 Federation Status'));
    this.log('='.repeat(50));

    // Run quick health checks
    const services = [
      { name: 'Gateway', url: 'http://localhost:4000/health', port: '4000' },
      { name: 'User Subgraph', url: 'http://localhost:4001/graphql', port: '4001' },
      { name: 'Todo Subgraph', url: 'http://localhost:4002/graphql', port: '4002' },
      { name: 'AI Subgraph', url: 'http://localhost:4003/graphql', port: '4003' },
    ];

    for (const service of services) {
      try {
        const response = await fetch(service.url, { 
          method: service.url.includes('/graphql') ? 'POST' : 'GET',
          headers: service.url.includes('/graphql') ? { 'Content-Type': 'application/json' } : {},
          body: service.url.includes('/graphql') ? JSON.stringify({ query: '{ __typename }' }) : undefined,
        });
        
        if (response.ok) {
          this.log(chalk.green(`✅ ${service.name} (port ${service.port}): Running`));
        } else {
          this.log(chalk.red(`❌ ${service.name} (port ${service.port}): HTTP ${response.status}`));
        }
      } catch {
        this.log(chalk.red(`❌ ${service.name} (port ${service.port}): Not responding`));
      }
    }

    this.log('='.repeat(50));
  }
}