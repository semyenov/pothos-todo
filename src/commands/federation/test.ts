import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class FederationTest extends Command {
  static override description = 'Test federation setup and run health checks';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --verbose',
    '<%= config.bin %> <%= command.id %> --services-only',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
    'services-only': Flags.boolean({
      description: 'Test only service health, skip GraphQL queries',
      default: false,
    }),
    timeout: Flags.integer({
      char: 't',
      description: 'Timeout in seconds for each health check',
      default: 10,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FederationTest);
    
    this.log(chalk.blue('🧪 Testing Federation Setup'));
    this.log(chalk.gray('Running comprehensive health checks...\n'));

    try {
      const results = await this.runHealthChecks(flags.timeout, flags.verbose);
      
      if (!flags['services-only']) {
        await this.runGraphQLTests(flags.verbose);
      }

      this.printResults(results);

    } catch (error) {
      this.log(chalk.red('❌ Federation tests failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async runHealthChecks(timeout: number, verbose: boolean): Promise<HealthCheckResult[]> {
    const services = [
      { name: 'Gateway', url: 'http://localhost:4000/health' },
      { name: 'User Subgraph', url: 'http://localhost:4001/graphql' },
      { name: 'Todo Subgraph', url: 'http://localhost:4002/graphql' },
      { name: 'AI Subgraph', url: 'http://localhost:4003/graphql' },
    ];

    const results: HealthCheckResult[] = [];

    for (const service of services) {
      if (verbose) {
        this.log(chalk.yellow(`🔍 Checking ${service.name}...`));
      }

      const result = await this.checkService(service.name, service.url, timeout);
      results.push(result);

      if (result.healthy) {
        this.log(chalk.green(`✅ ${service.name}: Healthy`));
      } else {
        this.log(chalk.red(`❌ ${service.name}: Unhealthy - ${result.error}`));
      }
    }

    return results;
  }

  private async checkService(name: string, url: string, timeout: number): Promise<HealthCheckResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

      let response: Response;
      
      if (url.includes('/graphql')) {
        // GraphQL endpoint - send introspection query
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: controller.signal,
        });
      } else {
        // Health endpoint
        response = await fetch(url, { signal: controller.signal });
      }

      clearTimeout(timeoutId);

      if (response.ok) {
        return { name, healthy: true };
      } else {
        return { 
          name, 
          healthy: false, 
          error: `HTTP ${response.status}: ${response.statusText}` 
        };
      }
    } catch (error) {
      return { 
        name, 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async runGraphQLTests(verbose: boolean): Promise<void> {
    this.log(chalk.blue('\n🔍 Running GraphQL Federation Tests'));

    const tests = [
      {
        name: 'Gateway Schema Composition',
        query: '{ __schema { types { name } } }',
        endpoint: 'http://localhost:4000/graphql',
      },
      {
        name: 'User Subgraph Query',
        query: '{ __typename }',
        endpoint: 'http://localhost:4001/graphql',
      },
      {
        name: 'Todo Subgraph Query', 
        query: '{ __typename }',
        endpoint: 'http://localhost:4002/graphql',
      },
      {
        name: 'AI Subgraph Query',
        query: '{ __typename }',
        endpoint: 'http://localhost:4003/graphql',
      },
    ];

    for (const test of tests) {
      if (verbose) {
        this.log(chalk.yellow(`🧪 Running: ${test.name}`));
      }

      try {
        const response = await fetch(test.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: test.query }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.errors) {
            this.log(chalk.red(`❌ ${test.name}: GraphQL errors`));
            if (verbose) {
              this.log(chalk.red(JSON.stringify(data.errors, null, 2)));
            }
          } else {
            this.log(chalk.green(`✅ ${test.name}: Success`));
          }
        } else {
          this.log(chalk.red(`❌ ${test.name}: HTTP ${response.status}`));
        }
      } catch (error) {
        this.log(chalk.red(`❌ ${test.name}: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    }
  }

  private printResults(results: HealthCheckResult[]): void {
    const healthy = results.filter(r => r.healthy).length;
    const total = results.length;

    this.log(chalk.blue('\n📊 Health Check Summary'));
    this.log('='.repeat(50));

    if (healthy === total) {
      this.log(chalk.green(`✅ All services healthy (${healthy}/${total})`));
    } else {
      this.log(chalk.red(`❌ ${total - healthy} services unhealthy (${healthy}/${total})`));
      
      // Show unhealthy services
      const unhealthy = results.filter(r => !r.healthy);
      this.log(chalk.yellow('\n🚨 Unhealthy Services:'));
      for (const service of unhealthy) {
        this.log(chalk.red(`  - ${service.name}: ${service.error}`));
      }
    }

    this.log('='.repeat(50));

    if (healthy < total) {
      this.log(chalk.yellow('\n💡 Troubleshooting Tips:'));
      this.log(chalk.yellow('  1. Make sure all services are running'));
      this.log(chalk.yellow('  2. Check Docker containers: docker compose ps'));
      this.log(chalk.yellow('  3. View logs: docker compose logs <service-name>'));
      this.log(chalk.yellow('  4. Restart services: docker compose restart'));
      process.exit(1);
    }
  }
}

interface HealthCheckResult {
  name: string;
  healthy: boolean;
  error?: string;
}