import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class GenerateMenu extends Command {
  static override description = 'Interactive code generation menu';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('Code Generation Tools');
    const subtitle = chalk.gray('Generate boilerplate code, schemas, and templates');
    
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
          name: '🏗️ Generate Domain Components',
          value: 'domain',
          short: 'Domain Components'
        },
        {
          name: '🌐 Generate GraphQL Schema',
          value: 'schema',
          short: 'GraphQL Schema'
        },
        {
          name: '📊 Generate Repository',
          value: 'repository',
          short: 'Repository'
        },
        {
          name: '⚡ Generate Service',
          value: 'service',
          short: 'Service'
        },
        {
          name: '🔧 Generate Infrastructure Component',
          value: 'infrastructure',
          short: 'Infrastructure'
        },
        new inquirer.Separator('━━━ Advanced Generators ━━━'),
        {
          name: '📋 Generate CRUD Operations',
          value: 'crud',
          short: 'CRUD Operations'
        },
        {
          name: '🧪 Generate Test Suite',
          value: 'tests',
          short: 'Test Suite'
        },
        {
          name: '📚 Generate Documentation',
          value: 'docs',
          short: 'Documentation'
        },
        {
          name: '🎨 Generate Types from Schema',
          value: 'types',
          short: 'Types'
        },
        new inquirer.Separator('━━━ Templates ━━━'),
        {
          name: '📁 Create Custom Template',
          value: 'template',
          short: 'Custom Template'
        },
        {
          name: '🔄 Scaffold Full Feature',
          value: 'scaffold',
          short: 'Scaffold Feature'
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
          message: 'What would you like to generate?',
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
        case 'domain':
          await this.generateDomainComponent();
          break;
        case 'schema':
          await this.generateGraphQLSchema();
          break;
        case 'repository':
          await this.generateRepository();
          break;
        case 'service':
          await this.generateService();
          break;
        case 'infrastructure':
          await this.generateInfrastructure();
          break;
        case 'crud':
          await this.generateCRUD();
          break;
        case 'tests':
          await this.generateTests();
          break;
        case 'docs':
          await this.generateDocumentation();
          break;
        case 'types':
          await this.generateTypes();
          break;
        case 'template':
          await this.createTemplate();
          break;
        case 'scaffold':
          await this.scaffoldFeature();
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

  private async generateDomainComponent(): Promise<void> {
    const { type, name, withEvents, withValueObjects } = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: 'Domain component type:',
        choices: [
          { name: '🏗️ Aggregate', value: 'aggregate' },
          { name: '🔷 Value Object', value: 'valueobject' },
          { name: '📧 Domain Event', value: 'event' },
          { name: '🎭 Domain Service', value: 'domainservice' },
        ],
      },
      {
        type: 'input',
        name: 'name',
        message: 'Component name (PascalCase):',
        validate: (input) => /^[A-Z][a-zA-Z0-9]*$/.test(input) || 'Must be PascalCase',
      },
      {
        type: 'confirm',
        name: 'withEvents',
        message: 'Include domain events?',
        default: true,
        when: (answers) => answers.type === 'aggregate',
      },
      {
        type: 'confirm',
        name: 'withValueObjects',
        message: 'Generate associated value objects?',
        default: false,
      }
    ]);

    const args = ['--type', type, '--name', name];
    if (withEvents) args.push('--events');
    if (withValueObjects) args.push('--value-objects');

    const GenerateDomain = (await import('./domain.js')).default;
    await GenerateDomain.run(args);
  }

  private async generateGraphQLSchema(): Promise<void> {
    const { entity, operations, withSubscriptions, withMutations } = await inquirer.prompt([
      {
        type: 'input',
        name: 'entity',
        message: 'Entity name:',
        validate: (input) => input.length > 0 || 'Entity name is required',
      },
      {
        type: 'checkbox',
        name: 'operations',
        message: 'GraphQL operations to generate:',
        choices: [
          { name: '🔍 Queries (findById, findAll)', value: 'queries' },
          { name: '✏️ Mutations (create, update, delete)', value: 'mutations' },
          { name: '📡 Subscriptions (realtime updates)', value: 'subscriptions' },
        ],
        default: ['queries', 'mutations'],
      },
      {
        type: 'confirm',
        name: 'withMutations',
        message: 'Include complex mutations (batch operations)?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'withSubscriptions',
        message: 'Include real-time subscriptions?',
        default: false,
      }
    ]);

    const args = ['--entity', entity, '--operations', operations.join(',')];
    if (withMutations) args.push('--complex-mutations');
    if (withSubscriptions) args.push('--subscriptions');

    const GenerateSchema = (await import('./schema.js')).default;
    await GenerateSchema.run(args);
  }

  private async generateRepository(): Promise<void> {
    const { entity, pattern, withTransactions, withCache } = await inquirer.prompt([
      {
        type: 'input',
        name: 'entity',
        message: 'Entity name:',
        validate: (input) => input.length > 0 || 'Entity name is required',
      },
      {
        type: 'list',
        name: 'pattern',
        message: 'Repository pattern:',
        choices: [
          { name: '🏗️ Base Repository (extends BaseRepository)', value: 'base' },
          { name: '🔧 Custom Repository (implements interface)', value: 'custom' },
          { name: '⚡ Cached Repository (with Redis)', value: 'cached' },
        ],
        default: 'base',
      },
      {
        type: 'confirm',
        name: 'withTransactions',
        message: 'Include transaction support?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'withCache',
        message: 'Include caching layer?',
        default: false,
      }
    ]);

    const args = ['--entity', entity, '--pattern', pattern];
    if (withTransactions) args.push('--transactions');
    if (withCache) args.push('--cache');

    const GenerateRepository = (await import('./repository.js')).default;
    await GenerateRepository.run(args);
  }

  private async generateService(): Promise<void> {
    const { name, type, singleton, withInterface } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Service name:',
        validate: (input) => input.length > 0 || 'Service name is required',
      },
      {
        type: 'list',
        name: 'type',
        message: 'Service type:',
        choices: [
          { name: '🔧 Application Service', value: 'application' },
          { name: '🏗️ Domain Service', value: 'domain' },
          { name: '🌐 Infrastructure Service', value: 'infrastructure' },
          { name: '🤖 AI Service', value: 'ai' },
        ],
      },
      {
        type: 'confirm',
        name: 'singleton',
        message: 'Use singleton pattern?',
        default: true,
        when: (answers) => answers.type === 'infrastructure',
      },
      {
        type: 'confirm',
        name: 'withInterface',
        message: 'Generate interface/contract?',
        default: true,
      }
    ]);

    const args = ['--name', name, '--type', type];
    if (singleton) args.push('--singleton');
    if (withInterface) args.push('--interface');

    const GenerateService = (await import('./service.js')).default;
    await GenerateService.run(args);
  }

  private async generateInfrastructure(): Promise<void> {
    const { component, pattern } = await inquirer.prompt([
      {
        type: 'list',
        name: 'component',
        message: 'Infrastructure component:',
        choices: [
          { name: '🔄 Event Handler', value: 'eventhandler' },
          { name: '📊 Health Check', value: 'healthcheck' },
          { name: '🚪 Gateway', value: 'gateway' },
          { name: '🔧 Middleware', value: 'middleware' },
          { name: '📈 Metrics Collector', value: 'metrics' },
          { name: '🔍 Monitor', value: 'monitor' },
        ],
      },
      {
        type: 'list',
        name: 'pattern',
        message: 'Implementation pattern:',
        choices: [
          { name: '📦 Singleton Service', value: 'singleton' },
          { name: '🔄 Event-driven', value: 'eventdriven' },
          { name: '⚡ Async Service', value: 'async' },
        ],
        default: 'singleton',
      }
    ]);

    const args = ['--component', component, '--pattern', pattern];

    const GenerateInfrastructure = (await import('./infrastructure.js')).default;
    await GenerateInfrastructure.run(args);
  }

  private async generateCRUD(): Promise<void> {
    this.log(chalk.blue('🔄 Generate Full CRUD Operations'));
    
    const { entity, includeGraphQL, includeValidation, includeAuth } = await inquirer.prompt([
      {
        type: 'input',
        name: 'entity',
        message: 'Entity name for CRUD operations:',
        validate: (input) => input.length > 0 || 'Entity name is required',
      },
      {
        type: 'confirm',
        name: 'includeGraphQL',
        message: 'Generate GraphQL mutations and queries?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'includeValidation',
        message: 'Include validation logic?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'includeAuth',
        message: 'Include authentication/authorization?',
        default: true,
      }
    ]);

    const args = ['--entity', entity];
    if (includeGraphQL) args.push('--graphql');
    if (includeValidation) args.push('--validation');
    if (includeAuth) args.push('--auth');

    const GenerateCrud = (await import('./crud.js')).default;
    await GenerateCrud.run(args);
  }

  private async generateTests(): Promise<void> {
    const { target, type, coverage } = await inquirer.prompt([
      {
        type: 'input',
        name: 'target',
        message: 'Target file/directory for tests:',
        validate: (input) => input.length > 0 || 'Target is required',
      },
      {
        type: 'list',
        name: 'type',
        message: 'Test type:',
        choices: [
          { name: '🧪 Unit Tests', value: 'unit' },
          { name: '🔗 Integration Tests', value: 'integration' },
          { name: '⚡ Performance Tests', value: 'performance' },
          { name: '🌐 E2E Tests', value: 'e2e' },
        ],
      },
      {
        type: 'confirm',
        name: 'coverage',
        message: 'Generate coverage configuration?',
        default: true,
      }
    ]);

    const args = ['--target', target, '--type', type];
    if (coverage) args.push('--coverage');

    const GenerateTests = (await import('./tests.js')).default;
    await GenerateTests.run(args);
  }

  private async generateDocumentation(): Promise<void> {
    this.log(chalk.blue('📚 Generate Documentation'));
    this.log(chalk.yellow('Documentation generation will be implemented in a future release'));
  }

  private async generateTypes(): Promise<void> {
    this.log(chalk.blue('🎨 Generate Types from Schema'));
    
    const { executeCommand } = await import('../../lib/utils.js');
    await executeCommand('bun', ['run', 'db:generate'], { silent: false });
    
    this.log(chalk.green('✅ Prisma types generated successfully'));
  }

  private async createTemplate(): Promise<void> {
    this.log(chalk.blue('📁 Create Custom Template'));
    this.log(chalk.yellow('Custom template creation will be implemented in a future release'));
  }

  private async scaffoldFeature(): Promise<void> {
    this.log(chalk.blue('🔄 Scaffold Full Feature'));
    
    const { featureName, includeDomain, includeGraphQL, includeTests } = await inquirer.prompt([
      {
        type: 'input',
        name: 'featureName',
        message: 'Feature name (e.g., "UserProfile", "TodoList"):',
        validate: (input) => /^[A-Z][a-zA-Z0-9]*$/.test(input) || 'Must be PascalCase',
      },
      {
        type: 'confirm',
        name: 'includeDomain',
        message: 'Include domain layer (aggregate, events, value objects)?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'includeGraphQL',
        message: 'Include GraphQL schema and resolvers?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'includeTests',
        message: 'Generate test files?',
        default: true,
      }
    ]);

    const args = ['--feature', featureName];
    if (includeDomain) args.push('--domain');
    if (includeGraphQL) args.push('--graphql');
    if (includeTests) args.push('--tests');

    const GenerateScaffold = (await import('./scaffold.js')).default;
    await GenerateScaffold.run(args);
  }
}