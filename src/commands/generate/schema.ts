import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export default class GenerateSchema extends Command {
  static override description = 'Generate GraphQL schema components (types, queries, mutations, subscriptions)';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --entity Product --operations queries,mutations',
    '<%= config.bin %> <%= command.id %> --entity User --operations queries,mutations,subscriptions --subscriptions',
    '<%= config.bin %> <%= command.id %> --entity Order --complex-mutations',
  ];

  static override flags = {
    entity: Flags.string({
      char: 'e',
      description: 'Entity name for GraphQL schema',
      required: true,
    }),
    operations: Flags.string({
      char: 'o',
      description: 'Comma-separated list of operations to generate',
      default: 'queries,mutations',
    }),
    'complex-mutations': Flags.boolean({
      description: 'Include complex mutations (batch operations)',
      default: false,
    }),
    subscriptions: Flags.boolean({
      char: 's',
      description: 'Include real-time subscriptions',
      default: false,
    }),
    path: Flags.string({
      char: 'p',
      description: 'Custom output path',
      default: 'src/api/schema',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateSchema);
    
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(flags.entity)) {
      this.log(chalk.red('❌ Entity name must be PascalCase (e.g., "Product", "UserProfile")'));
      process.exit(1);
    }

    this.log(chalk.blue(`🌐 Generating GraphQL schema for: ${flags.entity}`));
    
    const operations = flags.operations.split(',').map(op => op.trim());
    
    try {
      // Generate type definitions
      await this.generateTypeDefinition(flags);
      
      // Generate operations based on flags
      if (operations.includes('queries')) {
        await this.generateQueries(flags);
      }
      
      if (operations.includes('mutations')) {
        await this.generateMutations(flags);
      }
      
      if (operations.includes('subscriptions') || flags.subscriptions) {
        await this.generateSubscriptions(flags);
      }

      this.log(chalk.green(`✅ Successfully generated GraphQL schema for ${flags.entity}`));

    } catch (error) {
      this.log(chalk.red('❌ Schema generation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async generateTypeDefinition(flags: any): Promise<void> {
    const typePath = join(flags.path, 'types', `${flags.entity}.ts`);
    const content = this.generateTypeContent(flags.entity);
    
    await this.writeFileWithDirectories(typePath, content);
    this.log(chalk.green(`📄 Generated type: ${typePath}`));
  }

  private async generateQueries(flags: any): Promise<void> {
    const queryPath = join(flags.path, 'queries', `${flags.entity.toLowerCase()}.ts`);
    const content = this.generateQueryContent(flags.entity);
    
    await this.writeFileWithDirectories(queryPath, content);
    this.log(chalk.green(`📄 Generated queries: ${queryPath}`));
  }

  private async generateMutations(flags: any): Promise<void> {
    const mutationPath = join(flags.path, 'mutations', `${flags.entity.toLowerCase()}.ts`);
    const content = this.generateMutationContent(flags.entity, flags['complex-mutations']);
    
    await this.writeFileWithDirectories(mutationPath, content);
    this.log(chalk.green(`📄 Generated mutations: ${mutationPath}`));
  }

  private async generateSubscriptions(flags: any): Promise<void> {
    const subscriptionPath = join(flags.path, 'subscriptions', `${flags.entity.toLowerCase()}.ts`);
    const content = this.generateSubscriptionContent(flags.entity);
    
    await this.writeFileWithDirectories(subscriptionPath, content);
    this.log(chalk.green(`📄 Generated subscriptions: ${subscriptionPath}`));
  }

  private generateTypeContent(entityName: string): string {
    const lowerEntity = entityName.toLowerCase();
    
    return `import { builder } from '../builder.js';
import { ${entityName} } from '../../domain/aggregates/${entityName}.js';

// GraphQL Type Definition
export const ${entityName}Type = builder.prismaObject('${entityName}', {
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    description: t.exposeString('description', { nullable: true }),
    status: t.exposeString('status'),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (${lowerEntity}) => ${lowerEntity}.createdAt,
    }),
    updatedAt: t.field({
      type: 'DateTime',
      resolve: (${lowerEntity}) => ${lowerEntity}.updatedAt,
    }),
    version: t.exposeInt('version'),
  }),
});

// Input Types
export const Create${entityName}Input = builder.inputType('Create${entityName}Input', {
  fields: (t) => ({
    title: t.string({ required: true }),
    description: t.string({ required: false }),
    status: t.string({ required: false }),
  }),
});

export const Update${entityName}Input = builder.inputType('Update${entityName}Input', {
  fields: (t) => ({
    title: t.string({ required: false }),
    description: t.string({ required: false }),
    status: t.string({ required: false }),
  }),
});

// Filter and Sort Types
export const ${entityName}FilterInput = builder.inputType('${entityName}FilterInput', {
  fields: (t) => ({
    status: t.string({ required: false }),
    search: t.string({ required: false }),
    createdAfter: t.field({ type: 'DateTime', required: false }),
    createdBefore: t.field({ type: 'DateTime', required: false }),
  }),
});

export const ${entityName}SortInput = builder.inputType('${entityName}SortInput', {
  fields: (t) => ({
    field: t.string({ required: true }),
    direction: t.string({ required: true }),
  }),
});

// Connection Types for Relay-style pagination
export const ${entityName}Connection = builder.connectionObject({
  type: ${entityName}Type,
  name: '${entityName}Connection',
});

// Enum Types
builder.enumType('${entityName}Status', {
  values: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const,
});
`;
  }

  private generateQueryContent(entityName: string): string {
    const lowerEntity = entityName.toLowerCase();
    const pluralEntity = `${lowerEntity}s`; // Simple pluralization
    
    return `import { builder } from '../builder.js';
import { ${entityName}Type, ${entityName}Connection, ${entityName}FilterInput, ${entityName}SortInput } from '../types/${entityName}.js';

// Query field for single ${entityName}
builder.queryField('${lowerEntity}', (t) =>
  t.field({
    type: ${entityName}Type,
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (parent, args, context) => {
      const { ${lowerEntity}Service } = context.services;
      return await ${lowerEntity}Service.findById(args.id);
    },
  })
);

// Query field for multiple ${entityName}s with pagination
builder.queryField('${pluralEntity}', (t) =>
  t.connection({
    type: ${entityName}Type,
    args: {
      filter: t.arg({ type: ${entityName}FilterInput, required: false }),
      sort: t.arg({ type: ${entityName}SortInput, required: false }),
    },
    resolve: async (parent, args, context) => {
      const { ${lowerEntity}Service } = context.services;
      
      const filter = args.filter || {};
      const sort = args.sort || { field: 'createdAt', direction: 'DESC' };
      
      return await ${lowerEntity}Service.findManyWithPagination({
        filter,
        sort,
        first: args.first,
        after: args.after,
        last: args.last,
        before: args.before,
      });
    },
  })
);

// Search query
builder.queryField('search${entityName}s', (t) =>
  t.field({
    type: [${entityName}Type],
    args: {
      query: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false, defaultValue: 10 }),
    },
    resolve: async (parent, args, context) => {
      const { ${lowerEntity}Service } = context.services;
      return await ${lowerEntity}Service.search(args.query, args.limit);
    },
  })
);

// Count query
builder.queryField('${lowerEntity}Count', (t) =>
  t.int({
    args: {
      filter: t.arg({ type: ${entityName}FilterInput, required: false }),
    },
    resolve: async (parent, args, context) => {
      const { ${lowerEntity}Service } = context.services;
      return await ${lowerEntity}Service.count(args.filter || {});
    },
  })
);
`;
  }

  private generateMutationContent(entityName: string, includeComplex: boolean): string {
    const lowerEntity = entityName.toLowerCase();
    
    const complexMutations = includeComplex ? `
// Batch create mutation
builder.mutationField('create${entityName}s', (t) =>
  t.field({
    type: [${entityName}Type],
    args: {
      inputs: t.arg({ type: [Create${entityName}Input], required: true }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return await ${lowerEntity}Service.createMany(user.id, args.inputs);
    },
  })
);

// Batch update mutation
builder.mutationField('update${entityName}s', (t) =>
  t.field({
    type: [${entityName}Type],
    args: {
      updates: t.arg({ 
        type: builder.inputType('${entityName}BulkUpdate', {
          fields: (t) => ({
            ids: t.idList({ required: true }),
            data: t.field({ type: Update${entityName}Input, required: true }),
          }),
        }), 
        required: true 
      }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return await ${lowerEntity}Service.updateMany(user.id, args.updates.ids, args.updates.data);
    },
  })
);

// Batch delete mutation
builder.mutationField('delete${entityName}s', (t) =>
  t.boolean({
    args: {
      ids: t.arg.idList({ required: true }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await ${lowerEntity}Service.deleteMany(user.id, args.ids);
      return true;
    },
  })
);` : '';

    return `import { GraphQLError } from 'graphql';
import { builder } from '../builder.js';
import { ${entityName}Type, Create${entityName}Input, Update${entityName}Input } from '../types/${entityName}.js';

// Create ${entityName} mutation
builder.mutationField('create${entityName}', (t) =>
  t.field({
    type: ${entityName}Type,
    args: {
      input: t.arg({ type: Create${entityName}Input, required: true }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return await ${lowerEntity}Service.create(user.id, args.input);
    },
  })
);

// Update ${entityName} mutation
builder.mutationField('update${entityName}', (t) =>
  t.field({
    type: ${entityName}Type,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: Update${entityName}Input, required: true }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return await ${lowerEntity}Service.update(user.id, args.id, args.input);
    },
  })
);

// Delete ${entityName} mutation
builder.mutationField('delete${entityName}', (t) =>
  t.boolean({
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (parent, args, context, info) => {
      const { ${lowerEntity}Service } = context.services;
      const { user } = context;

      if (!user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await ${lowerEntity}Service.delete(user.id, args.id);
      return true;
    },
  })
);${complexMutations}
`;
  }

  private generateSubscriptionContent(entityName: string): string {
    const lowerEntity = entityName.toLowerCase();
    const pluralEntity = `${lowerEntity}s`;
    
    return `import { builder } from '../builder.js';
import { ${entityName}Type } from '../types/${entityName}.js';

// Subscription for ${entityName} updates
builder.subscriptionField('${lowerEntity}Updated', (t) =>
  t.field({
    type: ${entityName}Type,
    args: {
      id: t.arg.id({ required: false }),
    },
    subscribe: async (parent, args, context) => {
      const { pubSub } = context;
      const topic = args.id ? \`${lowerEntity}:\${args.id}:updated\` : '${lowerEntity}:updated';
      return pubSub.asyncIterator(topic);
    },
    resolve: (payload) => payload,
  })
);

// Subscription for ${entityName} creation
builder.subscriptionField('${lowerEntity}Created', (t) =>
  t.field({
    type: ${entityName}Type,
    subscribe: async (parent, args, context) => {
      const { pubSub } = context;
      return pubSub.asyncIterator('${lowerEntity}:created');
    },
    resolve: (payload) => payload,
  })
);

// Subscription for ${entityName} deletion
builder.subscriptionField('${lowerEntity}Deleted', (t) =>
  t.field({
    type: 'ID',
    subscribe: async (parent, args, context) => {
      const { pubSub } = context;
      return pubSub.asyncIterator('${lowerEntity}:deleted');
    },
    resolve: (payload) => payload.id,
  })
);

// Subscription for user-specific ${entityName} changes
builder.subscriptionField('my${entityName}Changes', (t) =>
  t.field({
    type: ${entityName}Type,
    subscribe: async (parent, args, context) => {
      const { pubSub, user } = context;
      
      if (!user) {
        throw new Error('Not authenticated');
      }
      
      return pubSub.asyncIterator(\`user:\${user.id}:${pluralEntity}:changes\`);
    },
    resolve: (payload) => payload,
  })
);

// Generic subscription for all ${entityName} events
builder.subscriptionField('${lowerEntity}Events', (t) =>
  t.field({
    type: builder.objectType('${entityName}Event', {
      fields: (t) => ({
        type: t.exposeString('type'),
        ${lowerEntity}: t.field({
          type: ${entityName}Type,
          nullable: true,
          resolve: (event) => event.${lowerEntity},
        }),
        timestamp: t.field({
          type: 'DateTime',
          resolve: (event) => event.timestamp,
        }),
      }),
    }),
    args: {
      types: t.arg.stringList({ 
        required: false,
        description: 'Filter by event types: created, updated, deleted',
      }),
    },
    subscribe: async (parent, args, context) => {
      const { pubSub } = context;
      const types = args.types || ['created', 'updated', 'deleted'];
      const topics = types.map(type => \`${lowerEntity}:\${type}\`);
      return pubSub.asyncIterator(topics);
    },
    resolve: (payload) => payload,
  })
);
`;
  }

  private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}