import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

export default class FederationDev extends Command {
  static override description = 'Start federation development environment with all subgraphs';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --timeout 60',
  ];

  static override flags = {
    timeout: Flags.integer({
      char: 't',
      description: 'Timeout in seconds for service startup',
      default: 30,
    }),
    'skip-cleanup': Flags.boolean({
      description: 'Skip cleanup of existing processes',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationDev);
    
    this.log(chalk.blue('🚀 Starting Federation Development Environment'));
    this.log(chalk.gray('This will start all subgraphs and the development gateway\n'));

    try {
      await this.startFederation(flags.timeout, flags['skip-cleanup']);
    } catch (error) {
      this.log(chalk.red('❌ Failed to start federation environment'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async checkHealth(url: string, name: string): Promise<boolean> {
    try {
      const response = await fetch(url);
      if (response.ok) {
        this.log(chalk.green(`✅ ${name} is healthy`));
        return true;
      }
    } catch {
      // Service not ready yet
    }
    return false;
  }

  private async waitForService(url: string, name: string, maxRetries: number): Promise<void> {
    this.log(chalk.yellow(`⏳ Waiting for ${name} to be ready...`));
    
    for (let i = 0; i < maxRetries; i++) {
      if (await this.checkHealth(url, name)) {
        return;
      }
      await setTimeout(1000);
    }
    
    throw new Error(`${name} failed to start after ${maxRetries} seconds`);
  }

  private async startFederation(timeout: number, skipCleanup: boolean): Promise<void> {
    if (!skipCleanup) {
      // Kill any existing processes on the ports
      this.log(chalk.yellow('🧹 Cleaning up existing processes...'));
      try {
        execSync('lsof -ti:4000 -ti:4001 -ti:4002 -ti:4003 | xargs kill -9', { stdio: 'ignore' });
      } catch {
        // Ignore errors if no processes are running
      }
    }

    // Start all services in the background
    this.log(chalk.blue('🚀 Starting subgraphs and gateway...'));
    
    const processes: any[] = [];
    
    // Start user subgraph
    const userProcess = Bun.spawn(['bun', 'run', 'subgraph:user'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, USER_SUBGRAPH_PORT: '4001' },
    });
    processes.push(userProcess);
    
    // Start todo subgraph
    const todoProcess = Bun.spawn(['bun', 'run', 'subgraph:todo'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, TODO_SUBGRAPH_PORT: '4002' },
    });
    processes.push(todoProcess);
    
    // Start AI subgraph
    const aiProcess = Bun.spawn(['bun', 'run', 'subgraph:ai'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, AI_SUBGRAPH_PORT: '4003' },
    });
    processes.push(aiProcess);
    
    // Wait for subgraphs to be ready
    await setTimeout(2000);
    
    try {
      await this.waitForService('http://localhost:4001/graphql', 'User Subgraph', timeout);
      await this.waitForService('http://localhost:4002/graphql', 'Todo Subgraph', timeout);
      await this.waitForService('http://localhost:4003/graphql', 'AI Subgraph', timeout);
      
      // Start the gateway
      this.log(chalk.blue('🚪 Starting development gateway...'));
      const gatewayProcess = Bun.spawn(['bun', 'run', 'gateway:dev'], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, GATEWAY_PORT: '4000' },
      });
      processes.push(gatewayProcess);
      
      await setTimeout(2000);
      await this.waitForService('http://localhost:4000/graphql', 'Development Gateway', timeout);
      
      this.log(chalk.green('\n🎉 Federation is up and running!'));
      this.log(chalk.cyan('\nYou can now:'));
      this.log(chalk.cyan('  - Access the gateway at http://localhost:4000/graphql'));
      this.log(chalk.cyan('  - Access individual subgraphs:'));
      this.log(chalk.cyan('    - User: http://localhost:4001/graphql'));
      this.log(chalk.cyan('    - Todo: http://localhost:4002/graphql'));
      this.log(chalk.cyan('    - AI: http://localhost:4003/graphql'));
      this.log(chalk.yellow('\nPress Ctrl+C to stop all services'));
      
      // Keep the process running
      process.on('SIGINT', () => {
        this.log(chalk.yellow('\n🛑 Shutting down federation...'));
        processes.forEach(p => p.kill());
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        this.log(chalk.yellow('\n🛑 Shutting down federation...'));
        processes.forEach(p => p.kill());
        process.exit(0);
      });
      
      // Wait indefinitely
      await new Promise(() => {});
      
    } catch (error) {
      this.log(chalk.red('❌ Failed to start federation:'), error);
      processes.forEach(p => p.kill());
      throw error;
    }
  }
}