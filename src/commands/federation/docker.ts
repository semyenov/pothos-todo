import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class FederationDocker extends Command {
  static override description = 'Start federation using Docker containers';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --build',
    '<%= config.bin %> <%= command.id %> --dev',
    '<%= config.bin %> <%= command.id %> --logs',
  ];

  static override flags = {
    build: Flags.boolean({
      char: 'b',
      description: 'Build containers before starting',
      default: false,
    }),
    dev: Flags.boolean({
      char: 'd',
      description: 'Start in development mode with Docker-specific configuration',
      default: false,
    }),
    logs: Flags.boolean({
      char: 'l',
      description: 'Show container logs after starting',
      default: false,
    }),
    detach: Flags.boolean({
      description: 'Run containers in detached mode',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationDocker);
    
    this.log(chalk.blue('🐳 Starting Federation with Docker'));
    
    try {
      if (flags.build) {
        await this.buildContainers();
      }

      if (flags.dev) {
        await this.startDevMode();
      } else {
        await this.startProduction(flags.detach);
      }

      if (flags.logs && !flags.detach) {
        await this.showLogs();
      }

    } catch (error) {
      this.log(chalk.red('❌ Failed to start federation with Docker'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async buildContainers(): Promise<void> {
    this.log(chalk.yellow('🔨 Building federation containers...'));
    
    const result = await executeCommand('docker', [
      'compose',
      'build',
      'hive-gateway',
      'user-subgraph',
      'todo-subgraph',
      'ai-subgraph'
    ], {
      silent: false,
      showSpinner: true,
      spinnerText: 'Building containers...'
    });

    if (!result.success) {
      throw new Error('Failed to build containers');
    }

    this.log(chalk.green('✅ Containers built successfully'));
  }

  private async startDevMode(): Promise<void> {
    this.log(chalk.blue('🚀 Starting federation in development mode...'));
    
    // Create temporary .env with Docker-specific values
    const envContent = `NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@postgres:5432/pothos_todo
REDIS_URL=redis://redis:6379
QDRANT_URL=http://qdrant:6333
SESSION_SECRET=your-session-secret-at-least-32-characters-long`;

    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Backup existing .env if it exists
      try {
        await fs.access('.env');
        await fs.copyFile('.env', '.env.backup');
        this.log(chalk.yellow('📋 Backed up existing .env to .env.backup'));
      } catch {
        // .env doesn't exist, that's fine
      }

      // Write Docker-specific .env
      await fs.writeFile('.env', envContent);
      this.log(chalk.green('📝 Created Docker-specific .env file'));

      // Start services with docker compose
      const result = await executeCommand('docker', [
        'compose',
        '-f', 'docker-compose.yml',
        '-f', 'docker-compose.dev.yml',
        'up'
      ], {
        silent: false,
        showSpinner: false,
      });

      if (!result.success) {
        throw new Error('Failed to start federation in development mode');
      }

    } finally {
      // Restore original .env if backup exists
      try {
        await fs.access('.env.backup');
        await fs.rename('.env.backup', '.env');
        this.log(chalk.green('🔄 Restored original .env file'));
      } catch {
        // No backup to restore
      }
    }
  }

  private async startProduction(detach: boolean): Promise<void> {
    this.log(chalk.blue('🚀 Starting federation containers...'));
    
    const args = [
      'compose',
      'up',
      'hive-gateway',
      'user-subgraph',
      'todo-subgraph',
      'ai-subgraph'
    ];

    if (detach) {
      args.push('-d');
    }

    const result = await executeCommand('docker', args, {
      silent: false,
      showSpinner: detach,
      spinnerText: 'Starting containers...'
    });

    if (!result.success) {
      throw new Error('Failed to start federation containers');
    }

    if (detach) {
      this.log(chalk.green('✅ Federation containers started in detached mode'));
      this.log(chalk.cyan('Use "docker compose logs -f" to view logs'));
      this.log(chalk.cyan('Use "docker compose down" to stop services'));
    }
  }

  private async showLogs(): Promise<void> {
    this.log(chalk.blue('📄 Showing container logs...'));
    
    const result = await executeCommand('docker', [
      'compose',
      'logs',
      '-f',
      'hive-gateway',
      'user-subgraph',
      'todo-subgraph',
      'ai-subgraph'
    ], {
      silent: false,
      showSpinner: false,
    });

    if (!result.success) {
      this.log(chalk.yellow('⚠️ Could not show logs (containers may not be running)'));
    }
  }
}