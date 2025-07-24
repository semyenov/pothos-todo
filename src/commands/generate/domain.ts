import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import inquirer from 'inquirer';

export default class GenerateDomain extends Command {
  static override description = 'Generate domain layer components (aggregates, value objects, events)';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --type aggregate --name Product',
    '<%= config.bin %> <%= command.id %> --type valueobject --name Price',
    '<%= config.bin %> <%= command.id %> --type event --name UserCreated',
    '<%= config.bin %> <%= command.id %> --type aggregate --name Order --events --value-objects',
  ];

  static override flags = {
    type: Flags.string({
      char: 't',
      description: 'Domain component type',
      options: ['aggregate', 'valueobject', 'event', 'domainservice'],
      required: true,
    }),
    name: Flags.string({
      char: 'n',
      description: 'Component name (PascalCase)',
      required: true,
    }),
    events: Flags.boolean({
      char: 'e',
      description: 'Generate domain events for aggregate',
      default: false,
    }),
    'value-objects': Flags.boolean({
      char: 'v',
      description: 'Generate associated value objects',
      default: false,
    }),
    path: Flags.string({
      char: 'p',
      description: 'Custom output path',
      default: 'src/domain',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateDomain);
    
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(flags.name)) {
      this.log(chalk.red('❌ Name must be PascalCase (e.g., "UserProfile", "TodoItem")'));
      process.exit(1);
    }

    this.log(chalk.blue(`🏗️ Generating ${flags.type}: ${flags.name}`));
    
    try {
      switch (flags.type) {
        case 'aggregate':
          await this.generateAggregate(flags);
          break;
        case 'valueobject':
          await this.generateValueObject(flags);
          break;
        case 'event':
          await this.generateDomainEvent(flags);
          break;
        case 'domainservice':
          await this.generateDomainService(flags);
          break;
      }

      this.log(chalk.green(`✅ Successfully generated ${flags.type}: ${flags.name}`));

    } catch (error) {
      this.log(chalk.red('❌ Generation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async generateAggregate(flags: any): Promise<void> {
    const aggregatePath = join(flags.path, 'aggregates', `${flags.name}.ts`);
    
    const aggregateContent = this.generateAggregateContent(flags.name, flags.events);
    await this.writeFileWithDirectories(aggregatePath, aggregateContent);
    
    this.log(chalk.green(`📄 Generated aggregate: ${aggregatePath}`));

    // Generate domain events if requested
    if (flags.events) {
      await this.generateAggregateEvents(flags);
    }

    // Generate value objects if requested
    if (flags['value-objects']) {
      await this.generateAggregateValueObjects(flags);
    }
  }

  private async generateValueObject(flags: any): Promise<void> {
    const valueObjectPath = join(flags.path, 'valueObjects', `${flags.name}.ts`);
    
    const content = this.generateValueObjectContent(flags.name);
    await this.writeFileWithDirectories(valueObjectPath, content);
    
    this.log(chalk.green(`📄 Generated value object: ${valueObjectPath}`));
  }

  private async generateDomainEvent(flags: any): Promise<void> {
    const eventPath = join(flags.path, 'events', `${flags.name}.ts`);
    
    const content = this.generateDomainEventContent(flags.name);
    await this.writeFileWithDirectories(eventPath, content);
    
    this.log(chalk.green(`📄 Generated domain event: ${eventPath}`));
  }

  private async generateDomainService(flags: any): Promise<void> {
    const servicePath = join(flags.path, 'services', `${flags.name}.ts`);
    
    const content = this.generateDomainServiceContent(flags.name);
    await this.writeFileWithDirectories(servicePath, content);
    
    this.log(chalk.green(`📄 Generated domain service: ${servicePath}`));
  }

  private async generateAggregateEvents(flags: any): Promise<void> {
    const events = [`${flags.name}Created`, `${flags.name}Updated`, `${flags.name}Deleted`];
    
    for (const eventName of events) {
      const eventPath = join(flags.path, 'events', `${eventName}.ts`);
      const content = this.generateDomainEventContent(eventName, flags.name);
      await this.writeFileWithDirectories(eventPath, content);
      this.log(chalk.gray(`  📧 Generated event: ${eventName}`));
    }
  }

  private async generateAggregateValueObjects(flags: any): Promise<void> {
    // Prompt user for value objects to generate
    const { valueObjects } = await inquirer.prompt([{
      type: 'input',
      name: 'valueObjects',
      message: `Value objects for ${flags.name} (comma-separated):`,
      default: `${flags.name}Id,${flags.name}Status`,
    }]);

    const voNames = valueObjects.split(',').map((name: string) => name.trim()).filter(Boolean);
    
    for (const voName of voNames) {
      const voPath = join(flags.path, 'valueObjects', `${voName}.ts`);
      const content = this.generateValueObjectContent(voName);
      await this.writeFileWithDirectories(voPath, content);
      this.log(chalk.gray(`  🔷 Generated value object: ${voName}`));
    }
  }

  private generateAggregateContent(name: string, withEvents: boolean): string {
    const events = withEvents ? `
import { ${name}Created } from '../events/${name}Created.js';
import { ${name}Updated } from '../events/${name}Updated.js';
import { ${name}Deleted } from '../events/${name}Deleted.js';` : '';

    const eventMethods = withEvents ? `
  static create(id: string, data: Create${name}Data): ${name} {
    const ${name.toLowerCase()} = new ${name}(id, data);
    ${name.toLowerCase()}.addDomainEvent(new ${name}Created(${name.toLowerCase()}));
    return ${name.toLowerCase()};
  }

  update(data: Update${name}Data): void {
    const hasChanges = this.updateFields(data);
    if (hasChanges) {
      this.validate();
      this.addDomainEvent(new ${name}Updated(this));
    }
  }

  delete(): void {
    this.addDomainEvent(new ${name}Deleted(this));
  }` : `
  static create(id: string, data: Create${name}Data): ${name} {
    return new ${name}(id, data);
  }

  update(data: Update${name}Data): void {
    const hasChanges = this.updateFields(data);
    if (hasChanges) {
      this.validate();
    }
  }`;

    return `import { BaseAggregate } from '../core/BaseAggregate.js';${events}

export class ${name} extends BaseAggregate {
  private _title: string;
  private _description?: string;
  private _status: ${name}Status;

  constructor(
    id: string,
    data: Create${name}Data,
    createdAt?: Date,
    updatedAt?: Date,
    version?: number
  ) {
    super(id, createdAt, updatedAt, version);
    this._title = data.title;
    this._description = data.description;
    this._status = data.status || ${name}Status.ACTIVE;
    this.validate();
  }

  // Getters
  get title(): string {
    return this._title;
  }

  get description(): string | undefined {
    return this._description;
  }

  get status(): ${name}Status {
    return this._status;
  }

  // Business logic methods
${eventMethods}

  protected validate(): void {
    this.ensureNotEmpty(this._title, 'title');
    this.ensureMaxLength(this._title, 200, 'title');
    
    if (this._description) {
      this.ensureMaxLength(this._description, 1000, 'description');
    }
  }

  // Serialization
  toSnapshot(): ${name}Snapshot {
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

  static fromSnapshot(snapshot: ${name}Snapshot): ${name} {
    return new ${name}(
      snapshot.id,
      {
        title: snapshot.title,
        description: snapshot.description,
        status: snapshot.status,
      },
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.version
    );
  }
}

// Types and interfaces
export interface Create${name}Data {
  title: string;
  description?: string;
  status?: ${name}Status;
}

export interface Update${name}Data {
  title?: string;
  description?: string;
  status?: ${name}Status;
}

export interface ${name}Snapshot {
  id: string;
  title: string;
  description?: string;
  status: ${name}Status;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export enum ${name}Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}
`;
  }

  private generateValueObjectContent(name: string): string {
    return `export class ${name} {
  private readonly _value: ${this.inferValueType(name)};

  constructor(value: ${this.inferValueType(name)}) {
    this.validate(value);
    this._value = value;
  }

  get value(): ${this.inferValueType(name)} {
    return this._value;
  }

  private validate(value: ${this.inferValueType(name)}): void {
    ${this.generateValidation(name)}
  }

  equals(other: ${name}): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return String(this._value);
  }

  static create(value: ${this.inferValueType(name)}): ${name} {
    return new ${name}(value);
  }
}
`;
  }

  private generateDomainEventContent(eventName: string, aggregateName?: string): string {
    const aggregateParam = aggregateName ? `aggregate: ${aggregateName}` : 'data: any';
    const aggregateProperty = aggregateName ? `
  public readonly aggregateId: string;
  public readonly aggregateType: string = '${aggregateName}';` : '';

    return `import { DomainEvent } from '../core/DomainEvent.js';${aggregateName ? `\nimport { ${aggregateName} } from '../aggregates/${aggregateName}.js';` : ''}

export class ${eventName} extends DomainEvent {${aggregateProperty}

  constructor(${aggregateParam}) {
    super();${aggregateName ? `
    this.aggregateId = aggregate.id;` : ''}
  }

  getEventName(): string {
    return '${eventName}';
  }

  getEventData(): Record<string, any> {
    return {${aggregateName ? `
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,` : ''}
      ...this.metadata,
    };
  }
}
`;
  }

  private generateDomainServiceContent(name: string): string {
    return `export class ${name} {
  
  constructor(
    // Inject dependencies here
  ) {}

  async execute(/* parameters */): Promise</* return type */> {
    // Implement domain service logic here
    throw new Error('${name}.execute() not implemented');
  }

  private validate(/* parameters */): void {
    // Implement validation logic
  }
}
`;
  }

  private inferValueType(name: string): string {
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('id')) return 'string';
    if (lowerName.includes('email')) return 'string';
    if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) return 'number';
    if (lowerName.includes('count') || lowerName.includes('quantity')) return 'number';
    if (lowerName.includes('date') || lowerName.includes('time')) return 'Date';
    if (lowerName.includes('active') || lowerName.includes('enabled') || lowerName.includes('valid')) return 'boolean';
    if (lowerName.includes('status') || lowerName.includes('type') || lowerName.includes('category')) return 'string';
    
    return 'string'; // Default
  }

  private generateValidation(name: string): string {
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('id')) {
      return `if (!value || value.length === 0) {
      throw new Error('${name} cannot be empty');
    }`;
    }
    
    if (lowerName.includes('email')) {
      return `const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new Error('Invalid email format');
    }`;
    }
    
    if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) {
      return `if (value < 0) {
      throw new Error('${name} cannot be negative');
    }`;
    }
    
    if (lowerName.includes('count') || lowerName.includes('quantity')) {
      return `if (value < 0 || !Number.isInteger(value)) {
      throw new Error('${name} must be a non-negative integer');
    }`;
    }
    
    return `if (value == null) {
      throw new Error('${name} cannot be null or undefined');
    }`;
  }

  private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}