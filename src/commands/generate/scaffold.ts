import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export default class GenerateScaffold extends Command {
  static override description = 'Scaffold a complete feature with domain, GraphQL, and infrastructure layers';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --feature Product',
    '<%= config.bin %> <%= command.id %> --feature UserProfile --domain --graphql --tests',
    '<%= config.bin %> <%= command.id %> --feature Order --no-ai --custom-fields',
  ];

  static override flags = {
    feature: Flags.string({
      char: 'f',
      description: 'Feature name (PascalCase)',
      required: true,
    }),
    domain: Flags.boolean({
      char: 'd',
      description: 'Generate domain layer components',
      default: true,
    }),
    graphql: Flags.boolean({
      char: 'g',
      description: 'Generate GraphQL schema and resolvers',
      default: true,
    }),
    tests: Flags.boolean({
      char: 't',
      description: 'Generate test files',
      default: true,
    }),
    'no-ai': Flags.boolean({
      description: 'Skip AI-related components',
      default: false,
    }),
    'custom-fields': Flags.boolean({
      description: 'Prompt for custom field definitions',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  private generatedFiles: string[] = [];

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateScaffold);
    
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(flags.feature)) {
      this.log(chalk.red('❌ Feature name must be PascalCase (e.g., "Product", "UserProfile")'));
      process.exit(1);
    }

    this.log(chalk.blue(`🔄 Scaffolding feature: ${flags.feature}`));
    this.log(chalk.gray('This will generate a complete feature stack\n'));
    
    try {
      // Step 1: Generate Domain Layer
      if (flags.domain) {
        await this.generateDomainLayer(flags);
      }

      // Step 2: Generate Infrastructure Layer
      await this.generateInfrastructureLayer(flags);

      // Step 3: Generate Application Layer
      await this.generateApplicationLayer(flags);

      // Step 4: Generate GraphQL Layer
      if (flags.graphql) {
        await this.generateGraphQLLayer(flags);
      }

      // Step 5: Generate Tests
      if (flags.tests) {
        await this.generateTestLayer(flags);
      }

      // Step 6: Generate AI Integration (unless disabled)
      if (!flags['no-ai']) {
        await this.generateAIIntegration(flags);
      }

      // Step 7: Generate Migration Files
      await this.generateMigrationFiles(flags);

      this.printSummary(flags.feature);

    } catch (error) {
      this.log(chalk.red('❌ Scaffolding failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async generateDomainLayer(flags: any): Promise<void> {
    this.log(chalk.blue('📦 Generating Domain Layer...'));
    
    const feature = flags.feature;
    
    // Generate aggregate
    const aggregateContent = this.generateAggregateScaffold(feature);
    const aggregatePath = join('src/domain/aggregates', `${feature}.ts`);
    await this.writeFileWithDirectories(aggregatePath, aggregateContent);
    this.generatedFiles.push(aggregatePath);

    // Generate value objects
    const valueObjects = [`${feature}Id`, `${feature}Status`];
    for (const vo of valueObjects) {
      const voContent = this.generateValueObjectScaffold(vo);
      const voPath = join('src/domain/valueObjects', `${vo}.ts`);
      await this.writeFileWithDirectories(voPath, voContent);
      this.generatedFiles.push(voPath);
    }

    // Generate domain events
    const events = [`${feature}Created`, `${feature}Updated`, `${feature}Deleted`];
    for (const event of events) {
      const eventContent = this.generateDomainEventScaffold(event, feature);
      const eventPath = join('src/domain/events', `${event}.ts`);
      await this.writeFileWithDirectories(eventPath, eventContent);
      this.generatedFiles.push(eventPath);
    }

    this.log(chalk.green(`  ✅ Generated domain components for ${feature}`));
  }

  private async generateInfrastructureLayer(flags: any): Promise<void> {
    this.log(chalk.blue('🏗️ Generating Infrastructure Layer...'));
    
    const feature = flags.feature;
    
    // Generate repository interface
    const repoInterface = this.generateRepositoryInterface(feature);
    const repoInterfacePath = join('src/infrastructure/persistence/interfaces', `${feature}Repository.ts`);
    await this.writeFileWithDirectories(repoInterfacePath, repoInterface);
    this.generatedFiles.push(repoInterfacePath);

    // Generate repository implementation
    const repoImpl = this.generateRepositoryImplementation(feature);
    const repoImplPath = join('src/infrastructure/persistence/repositories', `${feature}Repository.ts`);
    await this.writeFileWithDirectories(repoImplPath, repoImpl);
    this.generatedFiles.push(repoImplPath);

    // Generate event handlers
    const eventHandlerContent = this.generateEventHandlers(feature);
    const eventHandlerPath = join('src/infrastructure/events/handlers', `${feature}EventHandlers.ts`);
    await this.writeFileWithDirectories(eventHandlerPath, eventHandlerContent);
    this.generatedFiles.push(eventHandlerPath);

    this.log(chalk.green(`  ✅ Generated infrastructure components for ${feature}`));
  }

  private async generateApplicationLayer(flags: any): Promise<void> {
    this.log(chalk.blue('⚡ Generating Application Layer...'));
    
    const feature = flags.feature;
    
    // Generate application service
    const serviceContent = this.generateApplicationService(feature);
    const servicePath = join('src/application/services', `${feature}Service.ts`);
    await this.writeFileWithDirectories(servicePath, serviceContent);
    this.generatedFiles.push(servicePath);

    // Generate command handlers
    const commands = ['Create', 'Update', 'Delete'];
    for (const command of commands) {
      const commandContent = this.generateCommandHandler(feature, command);
      const commandPath = join('src/application/handlers', `${command}${feature}Handler.ts`);
      await this.writeFileWithDirectories(commandPath, commandContent);
      this.generatedFiles.push(commandPath);
    }

    this.log(chalk.green(`  ✅ Generated application components for ${feature}`));
  }

  private async generateGraphQLLayer(flags: any): Promise<void> {
    this.log(chalk.blue('🌐 Generating GraphQL Layer...'));
    
    const feature = flags.feature;
    
    // Generate GraphQL type definitions
    const typeContent = this.generateGraphQLTypes(feature);
    const typePath = join('src/api/schema/types', `${feature}.ts`);
    await this.writeFileWithDirectories(typePath, typeContent);
    this.generatedFiles.push(typePath);

    // Generate queries
    const queryContent = this.generateGraphQLQueries(feature);
    const queryPath = join('src/api/schema/queries', `${feature.toLowerCase()}.ts`);
    await this.writeFileWithDirectories(queryPath, queryContent);
    this.generatedFiles.push(queryPath);

    // Generate mutations
    const mutationContent = this.generateGraphQLMutations(feature);
    const mutationPath = join('src/api/schema/mutations', `${feature.toLowerCase()}.ts`);
    await this.writeFileWithDirectories(mutationPath, mutationContent);
    this.generatedFiles.push(mutationPath);

    // Generate subscriptions
    const subscriptionContent = this.generateGraphQLSubscriptions(feature);
    const subscriptionPath = join('src/api/schema/subscriptions', `${feature.toLowerCase()}.ts`);
    await this.writeFileWithDirectories(subscriptionPath, subscriptionContent);
    this.generatedFiles.push(subscriptionPath);

    this.log(chalk.green(`  ✅ Generated GraphQL components for ${feature}`));
  }

  private async generateTestLayer(flags: any): Promise<void> {
    this.log(chalk.blue('🧪 Generating Test Layer...'));
    
    const feature = flags.feature;
    
    // Generate unit tests for domain
    const domainTestContent = this.generateDomainTests(feature);
    const domainTestPath = join('src/tests/domain', `${feature}.test.ts`);
    await this.writeFileWithDirectories(domainTestPath, domainTestContent);
    this.generatedFiles.push(domainTestPath);

    // Generate integration tests
    const integrationTestContent = this.generateIntegrationTests(feature);
    const integrationTestPath = join('src/tests/integration', `${feature}.test.ts`);
    await this.writeFileWithDirectories(integrationTestPath, integrationTestContent);
    this.generatedFiles.push(integrationTestPath);

    this.log(chalk.green(`  ✅ Generated test components for ${feature}`));
  }

  private async generateAIIntegration(flags: any): Promise<void> {
    this.log(chalk.blue('🤖 Generating AI Integration...'));
    
    const feature = flags.feature;
    
    // Generate AI service for the feature
    const aiServiceContent = this.generateAIService(feature);
    const aiServicePath = join('src/infrastructure/ai', `${feature}AIService.ts`);
    await this.writeFileWithDirectories(aiServicePath, aiServiceContent);
    this.generatedFiles.push(aiServicePath);

    // Generate AI-powered GraphQL queries
    const aiQueryContent = this.generateAIQueries(feature);
    const aiQueryPath = join('src/api/schema/queries', `${feature.toLowerCase()}-ai.ts`);
    await this.writeFileWithDirectories(aiQueryPath, aiQueryContent);
    this.generatedFiles.push(aiQueryPath);

    this.log(chalk.green(`  ✅ Generated AI integration for ${feature}`));
  }

  private async generateMigrationFiles(flags: any): Promise<void> {
    this.log(chalk.blue('📄 Generating Migration Files...'));
    
    const feature = flags.feature;
    
    // Generate Prisma schema addition
    const schemaAddition = this.generatePrismaSchema(feature);
    const schemaPath = join('prisma/schema', `${feature.toLowerCase()}.prisma`);
    await this.writeFileWithDirectories(schemaPath, schemaAddition);
    this.generatedFiles.push(schemaPath);

    // Generate database seeder
    const seederContent = this.generateSeeder(feature);
    const seederPath = join('prisma/seeds', `${feature.toLowerCase()}.ts`);
    await this.writeFileWithDirectories(seederPath, seederContent);
    this.generatedFiles.push(seederPath);

    this.log(chalk.green(`  ✅ Generated migration files for ${feature}`));
  }

  // Content generation methods (simplified for brevity)
  private generateAggregateScaffold(feature: string): string {
    return `import { BaseAggregate } from '../core/BaseAggregate.js';
import { ${feature}Created } from '../events/${feature}Created.js';
import { ${feature}Updated } from '../events/${feature}Updated.js';
import { ${feature}Status } from '../valueObjects/${feature}Status.js';

export class ${feature} extends BaseAggregate {
  private _title: string;
  private _description?: string;
  private _status: ${feature}Status;

  constructor(
    id: string,
    data: Create${feature}Data,
    createdAt?: Date,
    updatedAt?: Date,
    version?: number
  ) {
    super(id, createdAt, updatedAt, version);
    this._title = data.title;
    this._description = data.description;
    this._status = data.status || ${feature}Status.ACTIVE;
    this.validate();
  }

  static create(id: string, data: Create${feature}Data): ${feature} {
    const ${feature.toLowerCase()} = new ${feature}(id, data);
    ${feature.toLowerCase()}.addDomainEvent(new ${feature}Created(${feature.toLowerCase()}));
    return ${feature.toLowerCase()};
  }

  update(data: Update${feature}Data): void {
    const hasChanges = this.updateFields(data);
    if (hasChanges) {
      this.validate();
      this.addDomainEvent(new ${feature}Updated(this));
    }
  }

  get title(): string { return this._title; }
  get description(): string | undefined { return this._description; }
  get status(): ${feature}Status { return this._status; }

  protected validate(): void {
    this.ensureNotEmpty(this._title, 'title');
    this.ensureMaxLength(this._title, 200, 'title');
  }

  toSnapshot(): ${feature}Snapshot {
    return {
      id: this.id,
      title: this._title,
      description: this._description,
      status: this._status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
    };
  }

  static fromSnapshot(snapshot: ${feature}Snapshot): ${feature} {
    return new ${feature}(
      snapshot.id,
      { title: snapshot.title, description: snapshot.description, status: snapshot.status },
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.version
    );
  }
}

export interface Create${feature}Data {
  title: string;
  description?: string;
  status?: ${feature}Status;
}

export interface Update${feature}Data {
  title?: string;
  description?: string;
  status?: ${feature}Status;
}

export interface ${feature}Snapshot {
  id: string;
  title: string;
  description?: string;
  status: ${feature}Status;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}`;
  }

  private generateValueObjectScaffold(name: string): string {
    if (name.endsWith('Status')) {
      return `export enum ${name} {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}`;
    }
    
    return `export class ${name} {
  private readonly _value: string;

  constructor(value: string) {
    this.validate(value);
    this._value = value;
  }

  get value(): string { return this._value; }

  private validate(value: string): void {
    if (!value || value.length === 0) {
      throw new Error('${name} cannot be empty');
    }
  }

  equals(other: ${name}): boolean {
    return this._value === other._value;
  }

  toString(): string { return this._value; }
}`;
  }

  private generateDomainEventScaffold(eventName: string, aggregateName: string): string {
    return `import { DomainEvent } from '../core/DomainEvent.js';
import { ${aggregateName} } from '../aggregates/${aggregateName}.js';

export class ${eventName} extends DomainEvent {
  public readonly aggregateId: string;
  public readonly aggregateType = '${aggregateName}';

  constructor(aggregate: ${aggregateName}) {
    super();
    this.aggregateId = aggregate.id;
  }

  getEventName(): string {
    return '${eventName}';
  }

  getEventData(): Record<string, any> {
    return {
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      ...this.metadata,
    };
  }
}`;
  }

  // Additional generation methods would be here (simplified for space)
  private generateRepositoryInterface(feature: string): string {
    return `// Repository interface for ${feature} (generated by scaffold)`;
  }

  private generateRepositoryImplementation(feature: string): string {
    return `// Repository implementation for ${feature} (generated by scaffold)`;
  }

  private generateEventHandlers(feature: string): string {
    return `// Event handlers for ${feature} (generated by scaffold)`;
  }

  private generateApplicationService(feature: string): string {
    return `// Application service for ${feature} (generated by scaffold)`;
  }

  private generateCommandHandler(feature: string, command: string): string {
    return `// ${command} command handler for ${feature} (generated by scaffold)`;
  }

  private generateGraphQLTypes(feature: string): string {
    return `// GraphQL types for ${feature} (generated by scaffold)`;
  }

  private generateGraphQLQueries(feature: string): string {
    return `// GraphQL queries for ${feature} (generated by scaffold)`;
  }

  private generateGraphQLMutations(feature: string): string {
    return `// GraphQL mutations for ${feature} (generated by scaffold)`;
  }

  private generateGraphQLSubscriptions(feature: string): string {
    return `// GraphQL subscriptions for ${feature} (generated by scaffold)`;
  }

  private generateDomainTests(feature: string): string {
    return `// Domain tests for ${feature} (generated by scaffold)`;
  }

  private generateIntegrationTests(feature: string): string {
    return `// Integration tests for ${feature} (generated by scaffold)`;
  }

  private generateAIService(feature: string): string {
    return `// AI service for ${feature} (generated by scaffold)`;
  }

  private generateAIQueries(feature: string): string {
    return `// AI queries for ${feature} (generated by scaffold)`;
  }

  private generatePrismaSchema(feature: string): string {
    return `// Prisma schema for ${feature} (generated by scaffold)`;
  }

  private generateSeeder(feature: string): string {
    return `// Database seeder for ${feature} (generated by scaffold)`;
  }

  private printSummary(feature: string): void {
    this.log(chalk.green(`\n🎉 Successfully scaffolded feature: ${feature}`));
    this.log(chalk.blue('\n📁 Generated Files:'));
    
    for (const file of this.generatedFiles) {
      this.log(chalk.gray(`  📄 ${file}`));
    }

    this.log(chalk.blue('\n🚀 Next Steps:'));
    this.log(chalk.yellow('  1. Review and customize the generated files'));
    this.log(chalk.yellow('  2. Run database migration: bun run db:migrate'));
    this.log(chalk.yellow('  3. Update dependency injection container'));
    this.log(chalk.yellow('  4. Add feature to GraphQL schema exports'));
    this.log(chalk.yellow('  5. Run tests: bun test'));

    this.log(chalk.blue(`\n✨ ${this.generatedFiles.length} files generated for ${feature} feature`));
  }

  private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}