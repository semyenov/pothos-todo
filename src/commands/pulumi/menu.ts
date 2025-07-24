import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class PulumiMenu extends Command {
  static override description = 'Interactive infrastructure management menu';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('Infrastructure as Code Management');
    const subtitle = chalk.gray('Deploy and manage cloud infrastructure with Pulumi');

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
          name: '🚀 Deploy Infrastructure',
          value: 'deploy',
          short: 'Deploy'
        },
        {
          name: '👁️ Preview Changes',
          value: 'preview',
          short: 'Preview'
        },
        {
          name: '🗑️ Destroy Infrastructure',
          value: 'destroy',
          short: 'Destroy'
        },
        {
          name: '📊 Stack Management',
          value: 'stack',
          short: 'Stacks'
        },
        {
          name: '⚙️ Configuration Management',
          value: 'config',
          short: 'Config'
        },
        new inquirer.Separator('━━━ Advanced Operations ━━━'),
        {
          name: '🔄 Refresh Infrastructure State',
          value: 'refresh',
          short: 'Refresh'
        },
        {
          name: '📈 View Infrastructure Logs',
          value: 'logs',
          short: 'Logs'
        },
        {
          name: '🔍 Infrastructure Status',
          value: 'status',
          short: 'Status'
        },
        {
          name: '🛡️ Security Scan',
          value: 'security',
          short: 'Security'
        },
        new inquirer.Separator('━━━ Multi-Cloud ━━━'),
        {
          name: '☁️ AWS Deployment',
          value: 'aws',
          short: 'AWS'
        },
        {
          name: '🌐 Azure Deployment',
          value: 'azure',
          short: 'Azure'
        },
        {
          name: '🌤️ Google Cloud Deployment',
          value: 'gcp',
          short: 'GCP'
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
          pageSize: 20,
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
        case 'deploy':
          await this.handleDeploy();
          break;
        case 'preview':
          await this.handlePreview();
          break;
        case 'destroy':
          await this.handleDestroy();
          break;
        case 'stack':
          await this.handleStackManagement();
          break;
        case 'config':
          await this.handleConfigManagement();
          break;
        case 'refresh':
          await this.handleRefresh();
          break;
        case 'logs':
          await this.handleLogs();
          break;
        case 'status':
          await this.handleStatus();
          break;
        case 'security':
          await this.handleSecurity();
          break;
        case 'aws':
          await this.handleCloudDeploy('aws');
          break;
        case 'azure':
          await this.handleCloudDeploy('azure');
          break;
        case 'gcp':
          await this.handleCloudDeploy('gcp');
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

  private async handleDeploy(): Promise<void> {
    const { stack, skipPreview, parallel } = await inquirer.prompt([
      {
        type: 'input',
        name: 'stack',
        message: 'Stack name (optional):',
        default: '',
      },
      {
        type: 'confirm',
        name: 'skipPreview',
        message: 'Skip preview and deploy directly?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'parallel',
        message: 'Enable parallel deployment?',
        default: true,
      }
    ]);

    const args: string[] = [];
    if (stack) args.push('--stack', stack);
    if (skipPreview) args.push('--skip-preview');
    if (parallel) args.push('--parallel');

    const PulumiDeploy = (await import('./deploy.js')).default;
    await PulumiDeploy.run(args);
  }

  private async handlePreview(): Promise<void> {
    const { stack, diff, detailed } = await inquirer.prompt([
      {
        type: 'input',
        name: 'stack',
        message: 'Stack name (optional):',
        default: '',
      },
      {
        type: 'confirm',
        name: 'diff',
        message: 'Show detailed diff?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'detailed',
        message: 'Show detailed resource information?',
        default: false,
      }
    ]);

    const args: string[] = [];
    if (stack) args.push('--stack', stack);
    if (diff) args.push('--diff');
    if (detailed) args.push('--detailed');

    const PulumiPreview = (await import('./preview.js')).default;
    await PulumiPreview.run(args);
  }

  private async handleDestroy(): Promise<void> {
    this.log(chalk.red('⚠️  WARNING: This will destroy all infrastructure resources!'));

    const { confirm, stack, force } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to destroy infrastructure?',
        default: false,
      },
      {
        type: 'input',
        name: 'stack',
        message: 'Stack name (optional):',
        default: '',
        when: (answers) => answers.confirm,
      },
      {
        type: 'confirm',
        name: 'force',
        message: 'Force destroy without confirmation prompts?',
        default: false,
        when: (answers) => answers.confirm,
      }
    ]);

    if (!confirm) {
      this.log(chalk.yellow('Destroy operation cancelled'));
      return;
    }

    const args: string[] = [];
    if (stack) args.push('--stack', stack);
    if (force) args.push('--force');

    const PulumiDestroy = (await import('./destroy.js')).default;
    await PulumiDestroy.run(args);
  }

  private async handleStackManagement(): Promise<void> {
    const { operation } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Stack operation:',
        choices: [
          { name: '📋 List all stacks', value: 'list' },
          { name: '🆕 Create new stack', value: 'create' },
          { name: '🔄 Switch active stack', value: 'select' },
          { name: '❌ Delete stack', value: 'delete' },
          { name: '📊 Stack outputs', value: 'outputs' },
          { name: '📈 Stack history', value: 'history' },
        ],
      }
    ]);

    const PulumiStack = (await import('./stack.js')).default;
    await PulumiStack.run(['--operation', operation]);
  }

  private async handleConfigManagement(): Promise<void> {
    const { operation } = await inquirer.prompt([
      {
        type: 'list',
        name: 'operation',
        message: 'Configuration operation:',
        choices: [
          { name: '📋 List all configuration', value: 'list' },
          { name: '➕ Set configuration value', value: 'set' },
          { name: '❌ Remove configuration value', value: 'remove' },
          { name: '🔐 Set secret value', value: 'set-secret' },
          { name: '📤 Export configuration', value: 'export' },
          { name: '📥 Import configuration', value: 'import' },
        ],
      }
    ]);

    const PulumiConfig = (await import('./config.js')).default;
    await PulumiConfig.run(['--operation', operation]);
  }

  private async handleRefresh(): Promise<void> {
    this.log(chalk.blue('🔄 Refreshing infrastructure state...'));

    const { executeCommand } = await import('../../lib/utils.js');
    await executeCommand('pulumi', ['refresh', '--yes'], { silent: false });
  }

  private async handleLogs(): Promise<void> {
    const { follow, since } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'follow',
        message: 'Follow logs in real-time?',
        default: false,
      },
      {
        type: 'input',
        name: 'since',
        message: 'Show logs since (e.g., "1h", "30m"):',
        default: '1h',
      }
    ]);

    const { executeCommand } = await import('../../lib/utils.js');
    const args: string[] = ['logs'];
    if (follow) args.push('--follow');
    if (since) args.push('--since', since);

    await executeCommand('pulumi', args, { silent: false });
  }

  private async handleStatus(): Promise<void> {
    this.log(chalk.blue('📊 Infrastructure Status'));
    this.log('='.repeat(50));

    try {
      const { executeCommand } = await import('../../lib/utils.js');

      // Get stack info
      this.log(chalk.yellow('📋 Current Stack:'));
      await executeCommand('pulumi', ['stack'], { silent: false });

      // Get stack outputs
      this.log(chalk.yellow('\n📤 Stack Outputs:'));
      await executeCommand('pulumi', ['stack', 'output'], { silent: false });

      // Get resource count
      this.log(chalk.yellow('\n🔢 Resource Summary:'));
      await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: false });

    } catch (error) {
      this.log(chalk.red(`Failed to get status: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async handleSecurity(): Promise<void> {
    this.log(chalk.blue('🛡️ Security Scan'));
    this.log(chalk.yellow('Running infrastructure security analysis...'));

    try {
      const { executeCommand } = await import('../../lib/utils.js');

      // Use Pulumi policy engine if available
      await executeCommand('pulumi', ['preview', '--policy-pack', 'security'], { silent: false });

    } catch (error) {
      this.log(chalk.red(`Security scan failed: ${error instanceof Error ? error.message : String(error)}`));
      this.log(chalk.yellow('💡 Tip: Install Pulumi CrossGuard for comprehensive security scanning'));
    }
  }

  private async handleCloudDeploy(cloud: string): Promise<void> {
    const { environment, region } = await inquirer.prompt([
      {
        type: 'list',
        name: 'environment',
        message: `${cloud.toUpperCase()} environment:`,
        choices: [
          { name: '🧪 Development', value: 'dev' },
          { name: '🚀 Staging', value: 'staging' },
          { name: '🏭 Production', value: 'prod' },
        ],
      },
      {
        type: 'input',
        name: 'region',
        message: 'Region:',
        default: cloud === 'aws' ? 'us-east-1' : cloud === 'azure' ? 'eastus' : 'us-central1',
      }
    ]);

    this.log(chalk.blue(`☁️ Deploying to ${cloud.toUpperCase()} (${environment} - ${region})`));

    const stackName = `${cloud}-${environment}`;
    const args = ['--stack', stackName, '--cloud', cloud, '--region', region];

    const PulumiDeploy = (await import('./deploy.js')).default;
    await PulumiDeploy.run(args);
  }
}