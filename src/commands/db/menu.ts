import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { executeCommand, isDockerRunning } from '../../lib/utils.js';

export default class DbMenu extends Command {
  static override description = 'Interactive database menu';

  async run(): Promise<void> {
    // Check if Docker is running
    const dockerRunning = await isDockerRunning();
    const dockerStatus = dockerRunning ?
      chalk.green('✅ Running') :
      chalk.red('❌ Not running');

    this.log(chalk.cyan('🗄️  Database Management'));
    this.log(chalk.gray('─'.repeat(50)));
    this.log(`Docker: ${dockerStatus}`);
    this.log(chalk.gray('─'.repeat(50)));

    const choices = [
      {
        name: `${chalk.green('🚀')} Start Database - Start database containers`,
        value: 'up',
        short: 'Start DB',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.red('🛑')} Stop Database - Stop database containers`,
        value: 'down',
        short: 'Stop DB',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.blue('📊')} Database Status - Check container status`,
        value: 'status',
        short: 'Status',
      },
      {
        name: `${chalk.yellow('🔄')} Restart Database - Restart containers`,
        value: 'restart',
        short: 'Restart',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.magenta('🗂️')} Migration Menu - Database migrations`,
        value: 'migrate',
        short: 'Migrations',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.cyan('🌱')} Seed Database - Populate with test data`,
        value: 'seed',
        short: 'Seed',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.magenta('🎯')} Prisma Studio - Open database management UI`,
        value: 'studio',
        short: 'Studio',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.gray('🧹')} Reset Database - Reset to clean state`,
        value: 'reset',
        short: 'Reset',
        disabled: dockerRunning ? false : 'Docker not running',
      },
      {
        name: `${chalk.red('🔙')} Back to Main Menu`,
        value: 'back',
        short: 'Back',
      },
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Choose a database action:',
        choices,
        pageSize: 12,
      },
    ]);

    await this.handleAction(action);
  }

  private async handleAction(action: string): Promise<void> {
    switch (action) {
      case 'up':
        await this.startDatabase();
        break;
      case 'down':
        await this.stopDatabase();
        break;
      case 'status':
        await this.showDatabaseStatus();
        break;
      case 'restart':
        await this.restartDatabase();
        break;
      case 'migrate':
        await this.migrationMenu();
        break;
      case 'seed':
        await this.seedDatabase();
        break;
      case 'studio':
        await this.openDatabaseStudio();
        break;
      case 'reset':
        await this.resetDatabase();
        break;
      case 'back':
        return;
      default:
        this.log(chalk.red('Unknown action'));
        break;
    }
  }

  private async startDatabase(): Promise<void> {
    this.log(chalk.green('🚀 Starting database containers...'));

    const result = await executeCommand('docker', ['compose', 'up', '-d'], {
      spinnerText: 'Starting database containers...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database containers started successfully!'));
      await this.showDatabaseStatus();
    } else {
      this.log(chalk.red('❌ Failed to start database containers'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async stopDatabase(): Promise<void> {
    this.log(chalk.red('🛑 Stopping database containers...'));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to stop the database containers?',
        default: false,
      },
    ]);

    if (!confirm) {
      return;
    }

    const result = await executeCommand('docker', ['compose', 'down'], {
      spinnerText: 'Stopping database containers...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database containers stopped successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to stop database containers'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async showDatabaseStatus(): Promise<void> {
    this.log(chalk.blue('📊 Database Status:'));
    this.log(chalk.gray('─'.repeat(50)));

    const result = await executeCommand('docker', ['compose', 'ps'], {
      spinnerText: 'Checking container status...',
    });

    if (result.success) {
      this.log(result.stdout);
    } else {
      this.log(chalk.red('❌ Failed to get container status'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async restartDatabase(): Promise<void> {
    this.log(chalk.yellow('🔄 Restarting database containers...'));

    const result = await executeCommand('docker', ['compose', 'restart'], {
      spinnerText: 'Restarting database containers...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database containers restarted successfully!'));
      await this.showDatabaseStatus();
    } else {
      this.log(chalk.red('❌ Failed to restart database containers'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async migrationMenu(): Promise<void> {
    const choices = [
      {
        name: `${chalk.green('⬆️')} Run Migrations - Apply pending migrations`,
        value: 'run',
        short: 'Run',
      },
      {
        name: `${chalk.blue('📋')} Migration Status - Show migration status`,
        value: 'status',
        short: 'Status',
      },
      {
        name: `${chalk.yellow('➕')} Create Migration - Generate new migration`,
        value: 'create',
        short: 'Create',
      },
      {
        name: `${chalk.red('⬇️')} Rollback - Rollback last migration`,
        value: 'rollback',
        short: 'Rollback',
      },
      {
        name: `${chalk.gray('🔄')} Reset Migrations - Reset to clean state`,
        value: 'reset',
        short: 'Reset',
      },
      {
        name: `${chalk.red('🔙')} Back to Database Menu`,
        value: 'back',
        short: 'Back',
      },
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Choose a migration action:',
        choices,
        pageSize: 10,
      },
    ]);

    switch (action) {
      case 'run':
        await this.runMigrations();
        break;
      case 'status':
        await this.showMigrationStatus();
        break;
      case 'create':
        await this.createMigration();
        break;
      case 'rollback':
        await this.rollbackMigration();
        break;
      case 'reset':
        await this.resetMigrations();
        break;
      case 'back':
        return;
      default:
        this.log(chalk.red('Unknown migration action'));
        break;
    }
  }

  private async runMigrations(): Promise<void> {
    this.log(chalk.green('⬆️ Running migrations...'));

    const result = await executeCommand('bunx', ['prisma', 'migrate', 'deploy'], {
      spinnerText: 'Applying migrations...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Migrations applied successfully!'));
    } else {
      this.log(chalk.red('❌ Migration failed'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async showMigrationStatus(): Promise<void> {
    this.log(chalk.blue('📋 Migration Status:'));
    this.log(chalk.gray('─'.repeat(50)));

    const result = await executeCommand('bunx', ['prisma', 'migrate', 'status'], {
      spinnerText: 'Checking migration status...',
    });

    if (result.success) {
      this.log(result.stdout);
    } else {
      this.log(chalk.red('❌ Failed to get migration status'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async createMigration(): Promise<void> {
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter migration name:',
        validate: (input) => {
          if (!input.trim()) {
            return 'Migration name is required';
          }
          return true;
        },
      },
    ]);

    this.log(chalk.yellow(`➕ Creating migration: ${name}...`));

    const result = await executeCommand('bunx', ['prisma', 'migrate', 'dev', '--name', name], {
      spinnerText: 'Generating migration...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Migration created successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to create migration'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async rollbackMigration(): Promise<void> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to rollback the last migration?',
        default: false,
      },
    ]);

    if (!confirm) {
      return;
    }

    this.log(chalk.red('⬇️ Rolling back migration...'));

    const result = await executeCommand('bunx', ['prisma', 'migrate', 'reset'], {
      spinnerText: 'Rolling back migration...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Migration rolled back successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to rollback migration'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async resetMigrations(): Promise<void> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This will reset all migrations. Are you sure?',
        default: false,
      },
    ]);

    if (!confirm) {
      return;
    }

    this.log(chalk.gray('🔄 Resetting migrations...'));

    const result = await executeCommand('bunx', ['prisma', 'migrate', 'reset'], {
      spinnerText: 'Resetting migrations...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Migrations reset successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to reset migrations'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async seedDatabase(): Promise<void> {
    this.log(chalk.cyan('🌱 Seeding database...'));

    const result = await executeCommand('bun', ['run', 'db:seed'], {
      spinnerText: 'Seeding database with test data...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database seeded successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to seed database'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async openDatabaseStudio(): Promise<void> {
    this.log(chalk.magenta('🎯 Opening Prisma Studio...'));
    this.log(chalk.gray('This will open a web interface for database management.'));

    const result = await executeCommand('bunx', ['prisma', 'studio'], {
      spinnerText: 'Starting Prisma Studio...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Prisma Studio opened!'));
      this.log(chalk.blue('Check your browser for the database management interface.'));
    } else {
      this.log(chalk.red('❌ Failed to open Prisma Studio'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }

  private async resetDatabase(): Promise<void> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This will completely reset the database. Are you sure?',
        default: false,
      },
    ]);

    if (!confirm) {
      return;
    }

    const { doubleConfirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'doubleConfirm',
        message: 'This action cannot be undone. Continue?',
        default: false,
      },
    ]);

    if (!doubleConfirm) {
      return;
    }

    this.log(chalk.gray('🧹 Resetting database...'));

    const result = await executeCommand('bun', ['run', 'db:reset'], {
      spinnerText: 'Resetting database to clean state...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database reset successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to reset database'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
    }
  }
}