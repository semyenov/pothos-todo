import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import boxen from 'boxen';

export default class Interactive extends Command {
  static override description = 'Interactive CLI mode for Pothos GraphQL Federation';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %>',
  ];

  async run(): Promise<void> {
    // Display ASCII art banner
    const banner = figlet.textSync('Pothos CLI', {
      font: 'Standard',
      horizontalLayout: 'default',
      verticalLayout: 'default',
    });

    console.log(chalk.cyan(banner));
    console.log(chalk.gray('GraphQL Federation Development Tools\n'));

    await this.showMainMenu();
  }

  private async showMainMenu(): Promise<void> {
    const choices = [
      {
        name: `${chalk.blue('🛠️')}  Development - Start dev server, build watch, etc.`,
        value: 'dev',
        short: 'Development',
      },
      {
        name: `${chalk.green('📦')} Build - Build project, clean, production builds`,
        value: 'build',
        short: 'Build',
      },
      {
        name: `${chalk.yellow('✅')} Check & Validate - TypeScript, lint, package validation`,
        value: 'check',
        short: 'Check',
      },
      {
        name: `${chalk.cyan('⚙️')}  Configuration - Show, validate, and manage configuration`,
        value: 'config',
        short: 'Configuration',
      },
      {
        name: `${chalk.magenta('🗄️')}  Database - Migrations, seed, studio, docker`,
        value: 'db',
        short: 'Database',
      },
      {
        name: `${chalk.yellow('🔧')} Services - Docker compose, service management`,
        value: 'services',
        short: 'Services',
      },
      {
        name: `${chalk.cyan('📊')} Status - View system status and health`,
        value: 'status',
        short: 'Status',
      },
      {
        name: `${chalk.magenta('❓')} Help - Show help and documentation`,
        value: 'help',
        short: 'Help',
      },
      {
        name: `${chalk.red('🚪')} Exit - Exit the CLI`,
        value: 'exit',
        short: 'Exit',
      },
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices,
        pageSize: 10,
      },
    ]);

    await this.handleAction(action);
  }

  private async handleAction(action: string): Promise<void> {
    switch (action) {
      case 'dev':
        await this.runCommand('dev:menu');
        break;
      case 'build':
        await this.runCommand('build:menu');
        break;
      case 'check':
        await this.runCommand('check:menu');
        break;
      case 'config':
        await this.runCommand('config:menu');
        break;
      case 'db':
        await this.runCommand('db:menu');
        break;
      case 'services':
        await this.runCommand('services:menu');
        break;
      case 'status':
        await this.runCommand('status');
        break;
      case 'help':
        await this.showHelp();
        break;
      case 'exit':
        this.log(chalk.green('👋 Goodbye!'));
        process.exit(0);
      default:
        this.log(chalk.red('Unknown action'));
        break;
    }

    // Ask if user wants to continue
    const { continue: shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Would you like to continue using the CLI?',
        default: true,
      },
    ]);

    if (shouldContinue) {
      console.log('\n');
      await this.showMainMenu();
    } else {
      this.log(chalk.green('👋 Goodbye!'));
    }
  }

  private async runCommand(command: string): Promise<void> {
    try {
      await this.config.runCommand(command);
    } catch (error) {
      this.log(chalk.red(`Error running command: ${error}`));
    }
  }

  private async showHelp(): Promise<void> {
    const helpText = `
${chalk.bold('📖 Pothos CLI Help')}

${chalk.underline('Available Commands:')}

${chalk.bold('Development:')}
  • dev:start     - Start development server with hot reload
  • dev:dist      - Start built server from dist/
  • dev:watch     - Start development with file watching

${chalk.bold('Build:')}
  • build         - Standard build
  • build:watch   - Build with watch mode
  • build:prod    - Production build
  • build:clean   - Clean build (removes dist/)

${chalk.bold('Check & Validate:')}
  • check:types   - TypeScript type checking
  • check:lint    - Package validation with publint
  • check:attw    - Are the types wrong check
  • check:all     - Run all validations

${chalk.bold('Configuration:')}
  • config:show     - Show current configuration
  • config:validate - Validate configuration
  • config:menu     - Interactive configuration menu

${chalk.bold('Database:')}
  • db:up         - Start database services
  • db:down       - Stop database services
  • db:migrate    - Run database migrations
  • db:seed       - Seed database with test data
  • db:studio     - Open Prisma Studio

${chalk.bold('Services:')}
  • services:up   - Start all services (Docker Compose)
  • services:down - Stop all services
  • services:logs - View service logs

${chalk.bold('Status:')}
  • status        - Show system status dashboard

${chalk.bold('Direct Usage:')}
You can also run commands directly:
  • ${chalk.gray('pothos build')}
  • ${chalk.gray('pothos dev:start')}
  • ${chalk.gray('pothos check:all')}
`;

    const helpBox = boxen(helpText, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      title: 'Help',
      titleAlignment: 'center',
    });

    console.log(helpBox);
  }
}