import { Command, Flags } from '@oclif/core';
import { executeCommand, isDockerRunning } from '../../lib/utils.js';
import chalk from 'chalk';

export default class Db extends Command {
  static override description = 'Database management commands';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --up',
    '<%= config.bin %> <%= command.id %> --down',
    '<%= config.bin %> <%= command.id %> --status',
    '<%= config.bin %> <%= command.id %> --migrate',
    '<%= config.bin %> <%= command.id %> --seed',
    '<%= config.bin %> <%= command.id %> --studio',
  ];

  static override flags = {
    up: Flags.boolean({
      char: 'u',
      description: 'Start database containers',
    }),
    down: Flags.boolean({
      char: 'd',
      description: 'Stop database containers',
    }),
    status: Flags.boolean({
      char: 's',
      description: 'Show database status',
    }),
    migrate: Flags.boolean({
      char: 'm',
      description: 'Run database migrations',
    }),
    seed: Flags.boolean({
      description: 'Seed database with test data',
    }),
    studio: Flags.boolean({
      description: 'Open database studio',
    }),
    reset: Flags.boolean({
      description: 'Reset database to clean state',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Db);

    // Check if Docker is running for commands that need it
    const dockerCommands = ['up', 'down', 'migrate', 'seed', 'studio', 'reset'];
    const needsDocker = Object.keys(flags).some(flag => dockerCommands.includes(flag) && flags[flag]);

    if (needsDocker && !await isDockerRunning()) {
      this.log(chalk.red('❌ Docker is not running. Please start Docker first.'));
      process.exit(1);
    }

    if (flags.up) {
      await this.startDatabase();
    } else if (flags.down) {
      await this.stopDatabase();
    } else if (flags.status) {
      await this.showDatabaseStatus();
    } else if (flags.migrate) {
      await this.runMigrations();
    } else if (flags.seed) {
      await this.seedDatabase();
    } else if (flags.studio) {
      await this.openDatabaseStudio();
    } else if (flags.reset) {
      await this.resetDatabase();
    } else {
      // If no flags, show status
      await this.showDatabaseStatus();
    }
  }

  private async startDatabase(): Promise<void> {
    this.log(chalk.green('🚀 Starting database containers...'));

    const result = await executeCommand('docker', ['compose', 'up', '-d'], {
      spinnerText: 'Starting database containers...',
    });

    if (result.success) {
      this.log(chalk.green('✅ Database containers started successfully!'));
    } else {
      this.log(chalk.red('❌ Failed to start database containers'));
      if (result.stderr) {
        this.log(chalk.red(result.stderr));
      }
      process.exit(1);
    }
  }

  private async stopDatabase(): Promise<void> {
    this.log(chalk.red('🛑 Stopping database containers...'));

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
      process.exit(1);
    }
  }

  private async showDatabaseStatus(): Promise<void> {
    this.log(chalk.blue('📊 Database Status:'));
    this.log(chalk.gray('─'.repeat(50)));

    const dockerRunning = await isDockerRunning();
    const dockerStatus = dockerRunning ?
      chalk.green('✅ Running') :
      chalk.red('❌ Not running');

    this.log(`Docker: ${dockerStatus}`);

    if (dockerRunning) {
      const result = await executeCommand('docker', ['compose', 'ps'], {
        spinnerText: 'Checking container status...',
      });

      if (result.success) {
        this.log(chalk.gray('─'.repeat(50)));
        this.log(result.stdout);
      } else {
        this.log(chalk.red('❌ Failed to get container status'));
        if (result.stderr) {
          this.log(chalk.red(result.stderr));
        }
      }
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
      process.exit(1);
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
      process.exit(1);
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
      process.exit(1);
    }
  }

  private async resetDatabase(): Promise<void> {
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
      process.exit(1);
    }
  }
}