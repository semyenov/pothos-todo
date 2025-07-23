#!/usr/bin/env bun

/**
 * Code Generator for Base Class Patterns
 * 
 * This script generates boilerplate code using the established base class patterns.
 * 
 * Usage: bun scripts/generate-from-template.ts <type> <name> [options]
 * 
 * Examples:
 *   bun scripts/generate-from-template.ts singleton EmailService
 *   bun scripts/generate-from-template.ts repository Product
 *   bun scripts/generate-from-template.ts aggregate Order
 *   bun scripts/generate-from-template.ts middleware requiresSubscription
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { parseArgs } from 'util';

interface GeneratorOptions {
  type: 'singleton' | 'async-singleton' | 'repository' | 'aggregate' | 'middleware';
  name: string;
  path?: string;
  withTests?: boolean;
}

class CodeGenerator {
  constructor(private options: GeneratorOptions) {}

  async generate(): Promise<void> {
    console.log(`🚀 Generating ${this.options.type} for ${this.options.name}...`);

    switch (this.options.type) {
      case 'singleton':
        await this.generateSingleton();
        break;
      case 'async-singleton':
        await this.generateAsyncSingleton();
        break;
      case 'repository':
        await this.generateRepository();
        break;
      case 'aggregate':
        await this.generateAggregate();
        break;
      case 'middleware':
        await this.generateMiddleware();
        break;
      default:
        throw new Error(`Unknown type: ${this.options.type}`);
    }

    console.log('✅ Generation complete!');
  }

  private async generateSingleton(): Promise<void> {
    const className = this.ensureServiceSuffix(this.options.name);
    const fileName = this.toFileName(className);
    const path = this.options.path || `src/infrastructure/services/${fileName}.ts`;

    const content = `import { SingletonService } from '@/infrastructure/core/SingletonService';
import { logger } from '@/logger';

export class ${className} extends SingletonService<${className}> {
  protected constructor() {
    super();
    this.initialize();
  }

  static getInstance(): ${className} {
    return super.getInstance();
  }

  private initialize(): void {
    logger.info('${className} initialized');
    // Add initialization logic here
  }

  // Add your service methods here
  async processData(data: unknown): Promise<void> {
    logger.info('Processing data in ${className}', { data });
    // Implementation
  }
}`;

    await this.writeFile(path, content);

    if (this.options.withTests) {
      await this.generateSingletonTest(className, fileName);
    }
  }

  private async generateAsyncSingleton(): Promise<void> {
    const className = this.ensureServiceSuffix(this.options.name);
    const fileName = this.toFileName(className);
    const path = this.options.path || `src/infrastructure/services/${fileName}.ts`;

    const content = `import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';
import { logger } from '@/logger';

export class ${className} extends AsyncSingletonService<${className}> {
  private client: any; // Replace with actual client type

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<${className}> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    logger.info('Initializing ${className}...');
    
    try {
      // Add async initialization logic here
      // this.client = await createClient();
      
      logger.info('${className} initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ${className}', error);
      throw error;
    }
  }

  // Add your service methods here
  async processData(data: unknown): Promise<void> {
    if (!this.client) {
      throw new Error('${className} not initialized');
    }
    
    logger.info('Processing data in ${className}', { data });
    // Implementation
  }
}`;

    await this.writeFile(path, content);

    if (this.options.withTests) {
      await this.generateAsyncSingletonTest(className, fileName);
    }
  }

  private async generateRepository(): Promise<void> {
    const entityName = this.capitalizeFirst(this.options.name);
    const className = `${entityName}Repository`;
    const fileName = this.toFileName(className);
    const path = this.options.path || `src/infrastructure/repositories/${fileName}.ts`;

    const content = `import { BaseRepository } from '@/infrastructure/core/BaseRepository';
import { ${entityName} } from '@/domain/aggregates/${entityName}';
import { PrismaClient, ${entityName} as Prisma${entityName} } from '@prisma/client';

export class ${className} extends BaseRepository<${entityName}, Prisma${entityName}> {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected getModelName(): string {
    return '${this.toLowerFirst(entityName)}';
  }

  protected mapToDomain(data: Prisma${entityName}): ${entityName} {
    return new ${entityName}(
      data.id,
      // Add other properties here
      data.createdAt,
      data.updatedAt,
      data.version
    );
  }

  protected mapToCreateInput(entity: ${entityName}): any {
    return {
      // Map domain properties to Prisma create input
      // Example: name: entity.name,
    };
  }

  protected mapToUpdateInput(entity: ${entityName}): any {
    return {
      // Map domain properties to Prisma update input
      // Don't include id, createdAt
      updatedAt: entity.updatedAt,
      version: entity.version,
    };
  }

  // Add custom repository methods here
  async findByName(name: string): Promise<${entityName} | null> {
    const data = await this.getModel().findFirst({
      where: { name },
    });
    return data ? this.mapToDomain(data) : null;
  }
}`;

    await this.writeFile(path, content);

    if (this.options.withTests) {
      await this.generateRepositoryTest(className, entityName, fileName);
    }
  }

  private async generateAggregate(): Promise<void> {
    const className = this.capitalizeFirst(this.options.name);
    const fileName = this.toFileName(className);
    const path = this.options.path || `src/domain/aggregates/${fileName}.ts`;

    const content = `import { BaseAggregate } from '@/domain/core/BaseAggregate';
import { ${className}Created, ${className}Updated } from '@/domain/events/${fileName}-events';

export class ${className} extends BaseAggregate {
  private _name: string;
  private _description: string;
  private _status: ${className}Status;

  constructor(
    id: string,
    name: string,
    description: string,
    status: ${className}Status = ${className}Status.ACTIVE,
    createdAt = new Date(),
    updatedAt = new Date(),
    version = 0
  ) {
    super(id, createdAt, updatedAt, version);
    this._name = name;
    this._description = description;
    this._status = status;
    this.validate();
  }

  static create(
    id: string,
    name: string,
    description: string
  ): ${className} {
    const ${this.toLowerFirst(className)} = new ${className}(
      id,
      name,
      description
    );
    
    ${this.toLowerFirst(className)}.addDomainEvent(
      new ${className}Created(
        id,
        { name, description },
        ${this.toLowerFirst(className)}.version
      )
    );
    
    return ${this.toLowerFirst(className)};
  }

  update(updates: {
    name?: string;
    description?: string;
    status?: ${className}Status;
  }): void {
    const hasChanges = this.updateFields(updates);
    
    if (hasChanges) {
      this.validate();
      this.addDomainEvent(
        new ${className}Updated(this.id, updates, this.version)
      );
    }
  }

  protected validate(): void {
    this.ensureNotEmpty(this._name, 'name');
    this.ensureMaxLength(this._name, 255, 'name');
    this.ensureMaxLength(this._description, 1000, 'description');
  }

  // Getters
  get name(): string { return this._name; }
  get description(): string { return this._description; }
  get status(): ${className}Status { return this._status; }
}

export enum ${className}Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}`;

    await this.writeFile(path, content);

    // Generate domain events
    await this.generateDomainEvents(className);

    if (this.options.withTests) {
      await this.generateAggregateTest(className, fileName);
    }
  }

  private async generateDomainEvents(aggregateName: string): Promise<void> {
    const fileName = this.toFileName(aggregateName);
    const eventsPath = `src/domain/events/${fileName}-events.ts`;

    const content = `import { DomainEvent } from '@/domain/events/DomainEvent';

export class ${aggregateName}Created extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly data: {
      name: string;
      description: string;
    },
    version: number
  ) {
    super(aggregateId, '${aggregateName}Created', version);
  }
}

export class ${aggregateName}Updated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly updates: {
      name?: string;
      description?: string;
      status?: string;
    },
    version: number
  ) {
    super(aggregateId, '${aggregateName}Updated', version);
  }
}

export class ${aggregateName}Deleted extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly deletedBy: string,
    version: number
  ) {
    super(aggregateId, '${aggregateName}Deleted', version);
  }
}`;

    await this.writeFile(eventsPath, content);
  }

  private async generateMiddleware(): Promise<void> {
    const functionName = this.toLowerFirst(this.options.name);
    const fileName = this.toFileName(functionName);
    const path = this.options.path || `src/api/middleware/${fileName}.ts`;

    const content = `import { GraphQLError } from 'graphql';
import type { Context } from '@/api/context';

export interface ${this.capitalizeFirst(functionName)}Options {
  // Add configuration options here
  errorMessage?: string;
}

export function ${functionName}<TSource, TArgs, TReturn>(
  options: ${this.capitalizeFirst(functionName)}Options = {}
) {
  return function (
    resolver: (source: TSource, args: TArgs, context: Context) => TReturn
  ): (source: TSource, args: TArgs, context: Context) => TReturn {
    return (source: TSource, args: TArgs, context: Context): TReturn => {
      // Add middleware logic here
      
      // Example: Check for subscription
      if (!context.user?.hasSubscription) {
        throw new GraphQLError(
          options.errorMessage || 'Subscription required',
          {
            extensions: { code: 'SUBSCRIPTION_REQUIRED' },
          }
        );
      }
      
      // Call the resolver
      return resolver(source, args, context);
    };
  };
}

// Convenience function for common usage
export const ${functionName}Resolver = ${functionName}();`;

    await this.writeFile(path, content);

    if (this.options.withTests) {
      await this.generateMiddlewareTest(functionName, fileName);
    }
  }

  // Test generation methods

  private async generateSingletonTest(className: string, fileName: string): Promise<void> {
    const testPath = `src/tests/unit/${fileName}.test.ts`;
    
    const content = `import { describe, it, expect, beforeEach } from 'bun:test';
import { ${className} } from '@/infrastructure/services/${fileName}';
import { SingletonService } from '@/infrastructure/core/SingletonService';

describe('${className}', () => {
  beforeEach(() => {
    SingletonService.clearAllInstances();
  });

  it('should maintain singleton instance', () => {
    const instance1 = ${className}.getInstance();
    const instance2 = ${className}.getInstance();
    
    expect(instance1).toBe(instance2);
  });

  it('should process data successfully', async () => {
    const service = ${className}.getInstance();
    const testData = { test: 'data' };
    
    await expect(service.processData(testData)).resolves.toBeUndefined();
  });
});`;

    await this.writeFile(testPath, content);
  }

  private async generateAsyncSingletonTest(className: string, fileName: string): Promise<void> {
    const testPath = `src/tests/unit/${fileName}.test.ts`;
    
    const content = `import { describe, it, expect, beforeEach } from 'bun:test';
import { ${className} } from '@/infrastructure/services/${fileName}';
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';

describe('${className}', () => {
  beforeEach(() => {
    AsyncSingletonService.clearAllInstances();
  });

  it('should maintain singleton instance', async () => {
    const instance1 = await ${className}.getInstance();
    const instance2 = await ${className}.getInstance();
    
    expect(instance1).toBe(instance2);
  });

  it('should initialize successfully', async () => {
    const service = await ${className}.getInstance();
    expect(service).toBeDefined();
  });

  it('should process data successfully', async () => {
    const service = await ${className}.getInstance();
    const testData = { test: 'data' };
    
    await expect(service.processData(testData)).resolves.toBeUndefined();
  });
});`;

    await this.writeFile(testPath, content);
  }

  private async generateRepositoryTest(className: string, entityName: string, fileName: string): Promise<void> {
    const testPath = `src/tests/unit/${fileName}.test.ts`;
    
    const content = `import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ${className} } from '@/infrastructure/repositories/${fileName}';
import { ${entityName} } from '@/domain/aggregates/${entityName}';
import { PrismaClient } from '@prisma/client';

describe('${className}', () => {
  let repository: ${className};
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      ${this.toLowerFirst(entityName)}: {
        findUnique: mock(() => null),
        findMany: mock(() => []),
        create: mock(() => ({})),
        update: mock(() => ({})),
        delete: mock(() => ({})),
      },
    };
    
    repository = new ${className}(mockPrisma as PrismaClient);
  });

  it('should find by ID', async () => {
    const mockData = {
      id: '1',
      // Add other properties
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
    };
    
    mockPrisma.${this.toLowerFirst(entityName)}.findUnique.mockResolvedValue(mockData);
    
    const result = await repository.findById('1');
    
    expect(result).toBeDefined();
    expect(result?.id).toBe('1');
  });

  it('should return null when not found', async () => {
    mockPrisma.${this.toLowerFirst(entityName)}.findUnique.mockResolvedValue(null);
    
    const result = await repository.findById('999');
    
    expect(result).toBeNull();
  });
});`;

    await this.writeFile(testPath, content);
  }

  private async generateAggregateTest(className: string, fileName: string): Promise<void> {
    const testPath = `src/tests/unit/${fileName}.test.ts`;
    
    const content = `import { describe, it, expect } from 'bun:test';
import { ${className}, ${className}Status } from '@/domain/aggregates/${fileName}';
import { ${className}Created, ${className}Updated } from '@/domain/events/${fileName}-events';

describe('${className}', () => {
  it('should create a new ${className}', () => {
    const ${this.toLowerFirst(className)} = ${className}.create(
      '1',
      'Test Name',
      'Test Description'
    );
    
    expect(${this.toLowerFirst(className)}.id).toBe('1');
    expect(${this.toLowerFirst(className)}.name).toBe('Test Name');
    expect(${this.toLowerFirst(className)}.description).toBe('Test Description');
    expect(${this.toLowerFirst(className)}.status).toBe(${className}Status.ACTIVE);
    
    const events = ${this.toLowerFirst(className)}.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(${className}Created);
  });

  it('should update ${className} properties', () => {
    const ${this.toLowerFirst(className)} = new ${className}(
      '1',
      'Original Name',
      'Original Description'
    );
    
    ${this.toLowerFirst(className)}.update({
      name: 'Updated Name',
      description: 'Updated Description',
    });
    
    expect(${this.toLowerFirst(className)}.name).toBe('Updated Name');
    expect(${this.toLowerFirst(className)}.description).toBe('Updated Description');
    expect(${this.toLowerFirst(className)}.version).toBe(1);
    
    const events = ${this.toLowerFirst(className)}.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(${className}Updated);
  });

  it('should validate required fields', () => {
    expect(() => {
      new ${className}('1', '', 'Description');
    }).toThrow();
  });
});`;

    await this.writeFile(testPath, content);
  }

  private async generateMiddlewareTest(functionName: string, fileName: string): Promise<void> {
    const testPath = `src/tests/unit/${fileName}.test.ts`;
    
    const content = `import { describe, it, expect } from 'bun:test';
import { ${functionName} } from '@/api/middleware/${fileName}';
import { GraphQLError } from 'graphql';

describe('${functionName} middleware', () => {
  const mockResolver = (source: any, args: any, context: any) => {
    return 'resolved';
  };

  it('should allow access when condition is met', () => {
    const middleware = ${functionName}();
    const wrappedResolver = middleware(mockResolver);
    
    const context = {
      user: {
        id: '123',
        hasSubscription: true,
      },
    };
    
    const result = wrappedResolver({}, {}, context);
    expect(result).toBe('resolved');
  });

  it('should throw error when condition is not met', () => {
    const middleware = ${functionName}();
    const wrappedResolver = middleware(mockResolver);
    
    const context = {
      user: {
        id: '123',
        hasSubscription: false,
      },
    };
    
    expect(() => {
      wrappedResolver({}, {}, context);
    }).toThrow(GraphQLError);
  });

  it('should use custom error message', () => {
    const middleware = ${functionName}({
      errorMessage: 'Custom error message',
    });
    const wrappedResolver = middleware(mockResolver);
    
    const context = {
      user: {
        id: '123',
        hasSubscription: false,
      },
    };
    
    try {
      wrappedResolver({}, {}, context);
    } catch (error) {
      expect(error.message).toBe('Custom error message');
    }
  });
});`;

    await this.writeFile(testPath, content);
  }

  // Utility methods

  private async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, content);
    console.log(`✅ Created: ${path}`);
  }

  private ensureServiceSuffix(name: string): string {
    return name.endsWith('Service') ? name : `${name}Service`;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private toLowerFirst(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  private toFileName(className: string): string {
    // Convert PascalCase to kebab-case
    return className
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .substring(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: bun scripts/generate-from-template.ts <type> <name> [options]');
  console.error('\nTypes:');
  console.error('  singleton       - Synchronous singleton service');
  console.error('  async-singleton - Asynchronous singleton service');
  console.error('  repository      - Repository with BaseRepository');
  console.error('  aggregate       - Domain aggregate with BaseAggregate');
  console.error('  middleware      - GraphQL middleware function');
  console.error('\nOptions:');
  console.error('  --path <path>   - Custom output path');
  console.error('  --with-tests    - Generate test file');
  console.error('\nExamples:');
  console.error('  bun scripts/generate-from-template.ts singleton EmailService --with-tests');
  console.error('  bun scripts/generate-from-template.ts repository Product');
  console.error('  bun scripts/generate-from-template.ts aggregate Order --path src/domain/order/Order.ts');
  process.exit(1);
}

const [type, name, ...optionArgs] = args;

const parsedArgs = parseArgs({
  args: optionArgs,
  options: {
    path: { type: 'string' },
    'with-tests': { type: 'boolean', default: false },
  },
});

const options: GeneratorOptions = {
  type: type as GeneratorOptions['type'],
  name,
  path: parsedArgs.values.path as string | undefined,
  withTests: parsedArgs.values['with-tests'] as boolean,
};

// Validate type
const validTypes = ['singleton', 'async-singleton', 'repository', 'aggregate', 'middleware'];
if (!validTypes.includes(options.type)) {
  console.error(`❌ Invalid type: ${options.type}`);
  console.error(`Valid types: ${validTypes.join(', ')}`);
  process.exit(1);
}

// Run generator
const generator = new CodeGenerator(options);
generator.generate().catch(console.error);