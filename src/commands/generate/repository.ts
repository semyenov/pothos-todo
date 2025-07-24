import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export default class GenerateRepository extends Command {
  static override description = 'Generate repository implementations with different patterns';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --entity Product --pattern base',
    '<%= config.bin %> <%= command.id %> --entity User --pattern cached --cache',
    '<%= config.bin %> <%= command.id %> --entity Order --pattern custom --transactions',
  ];

  static override flags = {
    entity: Flags.string({
      char: 'e',
      description: 'Entity name for repository',
      required: true,
    }),
    pattern: Flags.string({
      char: 'p',
      description: 'Repository pattern',
      options: ['base', 'custom', 'cached'],
      default: 'base',
    }),
    transactions: Flags.boolean({
      char: 't',
      description: 'Include transaction support',
      default: true,
    }),
    cache: Flags.boolean({
      char: 'c',
      description: 'Include caching layer',
      default: false,
    }),
    path: Flags.string({
      description: 'Custom output path',
      default: 'src/infrastructure/persistence',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateRepository);
    
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(flags.entity)) {
      this.log(chalk.red('❌ Entity name must be PascalCase (e.g., "Product", "UserProfile")'));
      process.exit(1);
    }

    this.log(chalk.blue(`🗄️ Generating ${flags.pattern} repository for: ${flags.entity}`));
    
    try {
      // Generate repository interface
      await this.generateRepositoryInterface(flags);
      
      // Generate repository implementation
      await this.generateRepositoryImplementation(flags);
      
      // Generate test file
      await this.generateRepositoryTests(flags);

      this.log(chalk.green(`✅ Successfully generated repository for ${flags.entity}`));

    } catch (error) {
      this.log(chalk.red('❌ Repository generation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async generateRepositoryInterface(flags: any): Promise<void> {
    const interfacePath = join(flags.path, 'interfaces', `${flags.entity}Repository.ts`);
    const content = this.generateInterfaceContent(flags.entity);
    
    await this.writeFileWithDirectories(interfacePath, content);
    this.log(chalk.green(`📄 Generated interface: ${interfacePath}`));
  }

  private async generateRepositoryImplementation(flags: any): Promise<void> {
    const implPath = join(flags.path, 'repositories', `${flags.entity}Repository.ts`);
    let content: string;
    
    switch (flags.pattern) {
      case 'base':
        content = this.generateBaseRepositoryContent(flags);
        break;
      case 'custom':
        content = this.generateCustomRepositoryContent(flags);
        break;
      case 'cached':
        content = this.generateCachedRepositoryContent(flags);
        break;
      default:
        throw new Error(`Unknown pattern: ${flags.pattern}`);
    }
    
    await this.writeFileWithDirectories(implPath, content);
    this.log(chalk.green(`📄 Generated repository: ${implPath}`));
  }

  private async generateRepositoryTests(flags: any): Promise<void> {
    const testPath = join('src/tests/infrastructure/persistence', `${flags.entity}Repository.test.ts`);
    const content = this.generateTestContent(flags);
    
    await this.writeFileWithDirectories(testPath, content);
    this.log(chalk.green(`📄 Generated tests: ${testPath}`));
  }

  private generateInterfaceContent(entityName: string): string {
    const lowerEntity = entityName.toLowerCase();
    
    return `import { ${entityName} } from '../../domain/aggregates/${entityName}.js';

export interface ${entityName}Repository {
  findById(id: string): Promise<${entityName} | null>;
  findAll(userId: string): Promise<${entityName}[]>;
  findByStatus(userId: string, status: string): Promise<${entityName}[]>;
  save(${lowerEntity}: ${entityName}): Promise<${entityName}>;
  update(${lowerEntity}: ${entityName}): Promise<${entityName}>;
  delete(id: string): Promise<void>;
  
  // Pagination support
  findManyWithPagination(params: FindManyParams): Promise<PaginatedResult<${entityName}>>;
  
  // Search functionality
  search(query: string, limit?: number): Promise<${entityName}[]>;
  
  // Count operations
  count(filter?: ${entityName}Filter): Promise<number>;
  
  // Batch operations
  saveMany(${lowerEntity}s: ${entityName}[]): Promise<${entityName}[]>;
  deleteMany(ids: string[]): Promise<void>;
}

export interface FindManyParams {
  userId: string;
  filter?: ${entityName}Filter;
  sort?: SortParams;
  pagination?: PaginationParams;
}

export interface ${entityName}Filter {
  status?: string;
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface SortParams {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface PaginationParams {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

export interface PaginatedResult<T> {
  edges: Array<{
    node: T;
    cursor: string;
  }>;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string;
    endCursor?: string;
  };
  totalCount: number;
}
`;
  }

  private generateBaseRepositoryContent(flags: any): string {
    const entityName = flags.entity;
    const lowerEntity = entityName.toLowerCase();
    const withCache = flags.cache;
    const withTransactions = flags.transactions;
    
    const cacheImports = withCache ? `\nimport { CacheManager } from '../cache/CacheManager.js';` : '';
    const cacheInjection = withCache ? `,\n    private readonly cacheManager: CacheManager` : '';
    const cacheMethods = withCache ? this.generateCacheMethods(entityName) : '';
    
    return `import { BaseRepository } from '../core/BaseRepository.js';
import { ${entityName} } from '../../domain/aggregates/${entityName}.js';
import { ${entityName}Repository, FindManyParams, PaginatedResult, ${entityName}Filter } from '../interfaces/${entityName}Repository.js';
import { PrismaClient, Prisma${entityName} } from '@prisma/client';${cacheImports}

export class Prisma${entityName}Repository extends BaseRepository<${entityName}, Prisma${entityName}> implements ${entityName}Repository {
  
  constructor(
    prisma: PrismaClient${cacheInjection}
  ) {
    super(prisma);
  }

  protected getModelName(): string {
    return '${lowerEntity}';
  }

  protected mapToDomain(data: Prisma${entityName}): ${entityName} {
    return ${entityName}.fromSnapshot({
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status as any,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      version: data.version,
    });
  }

  protected mapToPrisma(domain: ${entityName}): Omit<Prisma${entityName}, 'id' | 'createdAt' | 'updatedAt'> {
    const snapshot = domain.toSnapshot();
    return {
      title: snapshot.title,
      description: snapshot.description,
      status: snapshot.status,
      version: snapshot.version,
    };
  }

  // Custom query methods
  async findByStatus(userId: string, status: string): Promise<${entityName}[]> {
    const cacheKey = \`${lowerEntity}:user:\${userId}:status:\${status}\`;
    ${withCache ? `
    const cached = await this.cacheManager.get<${entityName}[]>(cacheKey);
    if (cached) return cached;
    ` : ''}

    const results = await this.prisma.${lowerEntity}.findMany({
      where: {
        userId,
        status,
      },
      orderBy: { createdAt: 'desc' },
    });

    const ${lowerEntity}s = results.map(data => this.mapToDomain(data));
    ${withCache ? `await this.cacheManager.set(cacheKey, ${lowerEntity}s, 300);` : ''}
    
    return ${lowerEntity}s;
  }

  async findManyWithPagination(params: FindManyParams): Promise<PaginatedResult<${entityName}>> {
    const { userId, filter, sort, pagination } = params;
    
    const where: any = { userId };
    
    if (filter) {
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        where.OR = [
          { title: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ];
      }
      if (filter.createdAfter) where.createdAt = { ...where.createdAt, gte: filter.createdAfter };
      if (filter.createdBefore) where.createdAt = { ...where.createdAt, lte: filter.createdBefore };
    }

    const orderBy = sort ? { [sort.field]: sort.direction.toLowerCase() } : { createdAt: 'desc' };
    
    // Calculate pagination
    let skip = 0;
    let take = pagination?.first || 10;
    
    if (pagination?.after) {
      const afterCursor = Buffer.from(pagination.after, 'base64').toString();
      skip = 1; // Skip the cursor record
      where.id = { gt: afterCursor };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.${lowerEntity}.findMany({
        where,
        orderBy,
        skip,
        take: take + 1, // Get one extra to check for next page
      }),
      this.prisma.${lowerEntity}.count({ where }),
    ]);

    const hasNextPage = items.length > take;
    const nodes = hasNextPage ? items.slice(0, -1) : items;
    
    const edges = nodes.map(item => ({
      node: this.mapToDomain(item),
      cursor: Buffer.from(item.id).toString('base64'),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!pagination?.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount,
    };
  }

  async search(query: string, limit = 10): Promise<${entityName}[]> {
    const results = await this.prisma.${lowerEntity}.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return results.map(data => this.mapToDomain(data));
  }

  async count(filter?: ${entityName}Filter): Promise<number> {
    const where: any = {};
    
    if (filter) {
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        where.OR = [
          { title: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ];
      }
      if (filter.createdAfter) where.createdAt = { ...where.createdAt, gte: filter.createdAfter };
      if (filter.createdBefore) where.createdAt = { ...where.createdAt, lte: filter.createdBefore };
    }

    return await this.prisma.${lowerEntity}.count({ where });
  }

  async saveMany(${lowerEntity}s: ${entityName}[]): Promise<${entityName}[]> {
    ${withTransactions ? `
    return await this.prisma.$transaction(async (tx) => {
      const results: ${entityName}[] = [];
      
      for (const ${lowerEntity} of ${lowerEntity}s) {
        const data = this.mapToPrisma(${lowerEntity});
        const saved = await tx.${lowerEntity}.create({ data });
        results.push(this.mapToDomain(saved));
      }
      
      return results;
    });` : `
    const results: ${entityName}[] = [];
    
    for (const ${lowerEntity} of ${lowerEntity}s) {
      const saved = await this.save(${lowerEntity});
      results.push(saved);
    }
    
    return results;`}
  }

  async deleteMany(ids: string[]): Promise<void> {
    ${withTransactions ? `
    await this.prisma.$transaction(async (tx) => {
      await tx.${lowerEntity}.deleteMany({
        where: { id: { in: ids } },
      });
    });` : `
    await this.prisma.${lowerEntity}.deleteMany({
      where: { id: { in: ids } },
    });`}
    
    ${withCache ? `// Invalidate cache
    for (const id of ids) {
      await this.cacheManager.delete(\`${lowerEntity}:\${id}\`);
    }` : ''}
  }${cacheMethods}
}
`;
  }

  private generateCustomRepositoryContent(flags: any): string {
    // Custom repository implementation without extending BaseRepository
    const entityName = flags.entity;
    const lowerEntity = entityName.toLowerCase();
    
    return `import { ${entityName} } from '../../domain/aggregates/${entityName}.js';
import { ${entityName}Repository, FindManyParams, PaginatedResult, ${entityName}Filter } from '../interfaces/${entityName}Repository.js';
import { PrismaClient, Prisma${entityName} } from '@prisma/client';

export class Custom${entityName}Repository implements ${entityName}Repository {
  
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<${entityName} | null> {
    const data = await this.prisma.${lowerEntity}.findUnique({
      where: { id },
    });
    
    return data ? this.mapToDomain(data) : null;
  }

  async findAll(userId: string): Promise<${entityName}[]> {
    const results = await this.prisma.${lowerEntity}.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    return results.map(data => this.mapToDomain(data));
  }

  async findByStatus(userId: string, status: string): Promise<${entityName}[]> {
    const results = await this.prisma.${lowerEntity}.findMany({
      where: { userId, status },
      orderBy: { createdAt: 'desc' },
    });
    
    return results.map(data => this.mapToDomain(data));
  }

  async save(${lowerEntity}: ${entityName}): Promise<${entityName}> {
    const data = this.mapToPrisma(${lowerEntity});
    const saved = await this.prisma.${lowerEntity}.create({ data });
    return this.mapToDomain(saved);
  }

  async update(${lowerEntity}: ${entityName}): Promise<${entityName}> {
    const data = this.mapToPrisma(${lowerEntity});
    const updated = await this.prisma.${lowerEntity}.update({
      where: { id: ${lowerEntity}.id },
      data,
    });
    return this.mapToDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.${lowerEntity}.delete({
      where: { id },
    });
  }

  // Implementation of other interface methods...
  async findManyWithPagination(params: FindManyParams): Promise<PaginatedResult<${entityName}>> {
    // TODO: Implement pagination logic
    throw new Error('Method not implemented');
  }

  async search(query: string, limit?: number): Promise<${entityName}[]> {
    // TODO: Implement search logic
    throw new Error('Method not implemented');
  }

  async count(filter?: ${entityName}Filter): Promise<number> {
    // TODO: Implement count logic
    throw new Error('Method not implemented');
  }

  async saveMany(${lowerEntity}s: ${entityName}[]): Promise<${entityName}[]> {
    // TODO: Implement batch save logic
    throw new Error('Method not implemented');
  }

  async deleteMany(ids: string[]): Promise<void> {
    // TODO: Implement batch delete logic
    throw new Error('Method not implemented');
  }

  private mapToDomain(data: Prisma${entityName}): ${entityName} {
    return ${entityName}.fromSnapshot({
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status as any,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      version: data.version,
    });
  }

  private mapToPrisma(domain: ${entityName}): Omit<Prisma${entityName}, 'id' | 'createdAt' | 'updatedAt'> {
    const snapshot = domain.toSnapshot();
    return {
      title: snapshot.title,
      description: snapshot.description,
      status: snapshot.status,
      version: snapshot.version,
    };
  }
}
`;
  }

  private generateCachedRepositoryContent(flags: any): string {
    // Cached repository with Redis integration
    const entityName = flags.entity;
    const lowerEntity = entityName.toLowerCase();
    
    return `import { ${entityName} } from '../../domain/aggregates/${entityName}.js';
import { ${entityName}Repository, FindManyParams, PaginatedResult, ${entityName}Filter } from '../interfaces/${entityName}Repository.js';
import { PrismaClient, Prisma${entityName} } from '@prisma/client';
import { CacheManager } from '../cache/CacheManager.js';

export class Cached${entityName}Repository implements ${entityName}Repository {
  private readonly cacheTTL = 300; // 5 minutes
  
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheManager
  ) {}

  async findById(id: string): Promise<${entityName} | null> {
    const cacheKey = \`${lowerEntity}:\${id}\`;
    
    // Try cache first
    const cached = await this.cache.get<${entityName}>(cacheKey);
    if (cached) return cached;
    
    // Fall back to database
    const data = await this.prisma.${lowerEntity}.findUnique({
      where: { id },
    });
    
    if (data) {
      const ${lowerEntity} = this.mapToDomain(data);
      await this.cache.set(cacheKey, ${lowerEntity}, this.cacheTTL);
      return ${lowerEntity};
    }
    
    return null;
  }

  async save(${lowerEntity}: ${entityName}): Promise<${entityName}> {
    const data = this.mapToPrisma(${lowerEntity});
    const saved = await this.prisma.${lowerEntity}.create({ data });
    const result = this.mapToDomain(saved);
    
    // Cache the new entity
    await this.cache.set(\`${lowerEntity}:\${result.id}\`, result, this.cacheTTL);
    
    // Invalidate related caches
    await this.invalidateUserCache(data.userId);
    
    return result;
  }

  async update(${lowerEntity}: ${entityName}): Promise<${entityName}> {
    const data = this.mapToPrisma(${lowerEntity});
    const updated = await this.prisma.${lowerEntity}.update({
      where: { id: ${lowerEntity}.id },
      data,
    });
    
    const result = this.mapToDomain(updated);
    
    // Update cache
    await this.cache.set(\`${lowerEntity}:\${result.id}\`, result, this.cacheTTL);
    
    // Invalidate related caches
    await this.invalidateUserCache(data.userId);
    
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.${lowerEntity}.delete({
      where: { id },
    });
    
    // Remove from cache
    await this.cache.delete(\`${lowerEntity}:\${id}\`);
    
    // TODO: Invalidate user-specific caches
  }

  // Rest of the interface implementation...
  async findAll(userId: string): Promise<${entityName}[]> {
    const cacheKey = \`${lowerEntity}:user:\${userId}:all\`;
    
    const cached = await this.cache.get<${entityName}[]>(cacheKey);
    if (cached) return cached;
    
    const results = await this.prisma.${lowerEntity}.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    const ${lowerEntity}s = results.map(data => this.mapToDomain(data));
    await this.cache.set(cacheKey, ${lowerEntity}s, this.cacheTTL);
    
    return ${lowerEntity}s;
  }

  // Placeholder implementations for other methods
  async findByStatus(userId: string, status: string): Promise<${entityName}[]> {
    throw new Error('Method not implemented');
  }

  async findManyWithPagination(params: FindManyParams): Promise<PaginatedResult<${entityName}>> {
    throw new Error('Method not implemented');
  }

  async search(query: string, limit?: number): Promise<${entityName}[]> {
    throw new Error('Method not implemented');
  }

  async count(filter?: ${entityName}Filter): Promise<number> {
    throw new Error('Method not implemented');
  }

  async saveMany(${lowerEntity}s: ${entityName}[]): Promise<${entityName}[]> {
    throw new Error('Method not implemented');
  }

  async deleteMany(ids: string[]): Promise<void> {
    throw new Error('Method not implemented');
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    const patterns = [
      \`${lowerEntity}:user:\${userId}:*\`,
      \`${lowerEntity}:status:*\`,
    ];
    
    for (const pattern of patterns) {
      await this.cache.deletePattern(pattern);
    }
  }

  private mapToDomain(data: Prisma${entityName}): ${entityName} {
    return ${entityName}.fromSnapshot({
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status as any,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      version: data.version,
    });
  }

  private mapToPrisma(domain: ${entityName}): Omit<Prisma${entityName}, 'id' | 'createdAt' | 'updatedAt'> {
    const snapshot = domain.toSnapshot();
    return {
      title: snapshot.title,
      description: snapshot.description,
      status: snapshot.status,
      version: snapshot.version,
      userId: 'TODO', // Get from context
    };
  }
}
`;
  }

  private generateCacheMethods(entityName: string): string {
    const lowerEntity = entityName.toLowerCase();
    
    return `
  // Cache management methods
  private async invalidateCache(id: string): Promise<void> {
    await this.cacheManager.delete(\`${lowerEntity}:\${id}\`);
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    const patterns = [
      \`${lowerEntity}:user:\${userId}:*\`,
      \`${lowerEntity}:status:*\`,
    ];
    
    for (const pattern of patterns) {
      await this.cacheManager.deletePattern(pattern);
    }
  }`;
  }

  private generateTestContent(flags: any): string {
    const entityName = flags.entity;
    const lowerEntity = entityName.toLowerCase();
    
    return `import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { Prisma${entityName}Repository } from '../../../infrastructure/persistence/repositories/${entityName}Repository.js';
import { ${entityName} } from '../../../domain/aggregates/${entityName}.js';

describe('${entityName}Repository', () => {
  let prisma: PrismaClient;
  let repository: Prisma${entityName}Repository;
  let test${entityName}: ${entityName};

  beforeEach(async () => {
    prisma = new PrismaClient();
    repository = new Prisma${entityName}Repository(prisma);
    
    test${entityName} = ${entityName}.create('test-id', {
      title: 'Test ${entityName}',
      description: 'Test description',
      status: '${entityName}Status.ACTIVE',
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('findById', () => {
    it('should find ${lowerEntity} by id', async () => {
      // Setup
      await repository.save(test${entityName});
      
      // Execute
      const found = await repository.findById(test${entityName}.id);
      
      // Assert
      expect(found).toBeTruthy();
      expect(found?.id).toBe(test${entityName}.id);
      expect(found?.title).toBe(test${entityName}.title);
    });

    it('should return null for non-existent id', async () => {
      // Execute
      const found = await repository.findById('non-existent-id');
      
      // Assert
      expect(found).toBeNull();
    });
  });

  describe('save', () => {
    it('should save ${lowerEntity} to database', async () => {
      // Execute
      const saved = await repository.save(test${entityName});
      
      // Assert
      expect(saved.id).toBe(test${entityName}.id);
      expect(saved.title).toBe(test${entityName}.title);
      
      // Verify in database
      const found = await repository.findById(saved.id);
      expect(found).toBeTruthy();
    });
  });

  describe('update', () => {
    it('should update existing ${lowerEntity}', async () => {
      // Setup
      const saved = await repository.save(test${entityName});
      saved.update({ title: 'Updated Title' });
      
      // Execute
      const updated = await repository.update(saved);
      
      // Assert
      expect(updated.title).toBe('Updated Title');
      expect(updated.version).toBe(saved.version);
    });
  });

  describe('delete', () => {
    it('should delete ${lowerEntity} from database', async () => {
      // Setup
      const saved = await repository.save(test${entityName});
      
      // Execute
      await repository.delete(saved.id);
      
      // Assert
      const found = await repository.findById(saved.id);
      expect(found).toBeNull();
    });
  });

  describe('findByStatus', () => {
    it('should find ${lowerEntity}s by status', async () => {
      // Setup
      await repository.save(test${entityName});
      
      // Execute
      const results = await repository.findByStatus('user-id', 'ACTIVE');
      
      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('ACTIVE');
    });
  });

  describe('search', () => {
    it('should search ${lowerEntity}s by query', async () => {
      // Setup
      await repository.save(test${entityName});
      
      // Execute
      const results = await repository.search('Test');
      
      // Assert
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Test');
    });
  });
});
`;
  }

  private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}