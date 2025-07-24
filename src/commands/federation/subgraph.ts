import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class FederationSubgraph extends Command {
  static override description = 'Manage individual GraphQL subgraphs';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --user',
    '<%= config.bin %> <%= command.id %> --todo',
    '<%= config.bin %> <%= command.id %> --ai',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static override flags = {
    user: Flags.boolean({
      char: 'u',
      description: 'Start User subgraph',
      exclusive: ['todo', 'ai', 'all'],
    }),
    todo: Flags.boolean({
      char: 't',
      description: 'Start Todo subgraph',
      exclusive: ['user', 'ai', 'all'],
    }),
    ai: Flags.boolean({
      char: 'a',
      description: 'Start AI subgraph',
      exclusive: ['user', 'todo', 'all'],
    }),
    all: Flags.boolean({
      description: 'Start all subgraphs',
      exclusive: ['user', 'todo', 'ai'],
    }),
    test: Flags.boolean({
      description: 'Test subgraph health instead of starting',
      default: false,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Start in watch mode (auto-reload on changes)',
      default: true,
    }),
    port: Flags.integer({
      char: 'p',
      description: 'Custom port (only for single subgraph)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationSubgraph);
    
    // Determine which subgraphs to manage
    const subgraphs = this.getSelectedSubgraphs(flags);
    
    if (subgraphs.length === 0) {
      this.log(chalk.red('❌ No subgraph specified. Use --user, --todo, --ai, or --all'));
      process.exit(1);
    }

    if (flags.test) {
      await this.testSubgraphs(subgraphs);
    } else {
      await this.startSubgraphs(subgraphs, flags.watch, flags.port);
    }
  }

  private getSelectedSubgraphs(flags: any): string[] {
    if (flags.all) return ['user', 'todo', 'ai'];
    
    const subgraphs: string[] = [];
    if (flags.user) subgraphs.push('user');
    if (flags.todo) subgraphs.push('todo');
    if (flags.ai) subgraphs.push('ai');
    
    return subgraphs;
  }

  private async startSubgraphs(subgraphs: string[], watch: boolean, customPort?: number): Promise<void> {
    if (subgraphs.length === 1) {
      await this.startSingleSubgraph(subgraphs[0], watch, customPort);
    } else {
      await this.startMultipleSubgraphs(subgraphs, watch);
    }
  }

  private async startSingleSubgraph(subgraph: string, watch: boolean, customPort?: number): Promise<void> {
    const port = customPort || this.getDefaultPort(subgraph);
    
    this.log(chalk.blue(`🚀 Starting ${subgraph} subgraph on port ${port}`));
    
    if (watch) {
      this.log(chalk.gray('Watch mode enabled - will auto-reload on changes'));
    }

    const env = { 
      ...process.env, 
      [`${subgraph.toUpperCase()}_SUBGRAPH_PORT`]: port.toString() 
    };

    const args = watch ? ['run', '--watch'] : ['run'];
    args.push(`src/subgraphs/${subgraph}/index.ts`);

    const result = await executeCommand('bun', args, {
      silent: false,
      showSpinner: false,
      env,
    });

    if (!result.success) {
      this.log(chalk.red(`❌ Failed to start ${subgraph} subgraph`));
      if (result.error) {
        this.log(chalk.red(result.error.message));
      }
      process.exit(1);
    }
  }

  private async startMultipleSubgraphs(subgraphs: string[], watch: boolean): Promise<void> {
    this.log(chalk.blue(`🚀 Starting ${subgraphs.length} subgraphs: ${subgraphs.join(', ')}`));
    
    if (watch) {
      this.log(chalk.gray('Watch mode enabled - will auto-reload on changes'));
    }

    // Use concurrently to start multiple subgraphs
    const commands = subgraphs.map(subgraph => {
      const port = this.getDefaultPort(subgraph);
      const script = `bun run ${watch ? '--watch ' : ''}src/subgraphs/${subgraph}/index.ts`;
      return `${subgraph.toUpperCase()}_SUBGRAPH_PORT=${port} ${script}`;
    });

    const concurrentlyArgs = [
      ...commands.map(cmd => `"${cmd}"`),
      '--names', subgraphs.join(','),
      '--prefix', 'name',
      '--kill-others-on-fail',
    ];

    const result = await executeCommand('npx', ['concurrently', ...concurrentlyArgs], {
      silent: false,
      showSpinner: false,
    });

    if (!result.success) {
      this.log(chalk.red('❌ Failed to start subgraphs'));
      process.exit(1);
    }
  }

  private async testSubgraphs(subgraphs: string[]): Promise<void> {
    this.log(chalk.blue(`🧪 Testing ${subgraphs.length} subgraph(s): ${subgraphs.join(', ')}`));
    this.log('='.repeat(60));

    let allHealthy = true;

    for (const subgraph of subgraphs) {
      const port = this.getDefaultPort(subgraph);
      const url = `http://localhost:${port}/graphql`;
      
      this.log(chalk.yellow(`🔍 Testing ${subgraph} subgraph (port ${port})...`));

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: '{ __schema { queryType { name } } }' 
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.errors) {
            this.log(chalk.red(`❌ ${subgraph}: GraphQL errors`));
            this.log(chalk.red(`   ${JSON.stringify(data.errors)}`));
            allHealthy = false;
          } else {
            this.log(chalk.green(`✅ ${subgraph}: Healthy and responsive`));
            if (data.data?.__schema?.queryType?.name) {
              this.log(chalk.gray(`   Query type: ${data.data.__schema.queryType.name}`));
            }
          }
        } else {
          this.log(chalk.red(`❌ ${subgraph}: HTTP ${response.status} ${response.statusText}`));
          allHealthy = false;
        }
      } catch (error) {
        this.log(chalk.red(`❌ ${subgraph}: Connection failed`));
        this.log(chalk.red(`   ${error instanceof Error ? error.message : 'Unknown error'}`));
        allHealthy = false;
      }
    }

    this.log('='.repeat(60));

    if (allHealthy) {
      this.log(chalk.green(`✅ All ${subgraphs.length} subgraph(s) are healthy`));
    } else {
      this.log(chalk.red(`❌ Some subgraphs are unhealthy`));
      this.log(chalk.yellow('\n💡 Troubleshooting tips:'));
      this.log(chalk.yellow('  1. Make sure the subgraphs are running'));
      this.log(chalk.yellow('  2. Check the ports are not blocked'));
      this.log(chalk.yellow('  3. View logs for error details'));
      this.log(chalk.yellow('  4. Try restarting the subgraphs'));
      process.exit(1);
    }
  }

  private getDefaultPort(subgraph: string): number {
    switch (subgraph) {
      case 'user': return 4001;
      case 'todo': return 4002;
      case 'ai': return 4003;
      default: throw new Error(`Unknown subgraph: ${subgraph}`);
    }
  }
}