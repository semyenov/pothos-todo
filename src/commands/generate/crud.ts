import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export default class GenerateCrud extends Command {
  static override description = 'Generate full CRUD operations';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --entity User --graphql --validation --auth',
    '<%= config.bin %> <%= command.id %> --entity Todo --graphql',
  ];

  static override flags = {
    entity: Flags.string({
      description: 'Entity name for CRUD operations',
      required: true,
    }),
    graphql: Flags.boolean({
      description: 'Generate GraphQL mutations and queries',
      default: true,
    }),
    validation: Flags.boolean({
      description: 'Include validation logic',
      default: true,
    }),
    auth: Flags.boolean({
      description: 'Include authentication/authorization',
      default: true,
    }),
    output: Flags.string({
      description: 'Output directory',
      default: 'src',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateCrud);

    try {
      await this.generateCRUDOperations(flags);
      this.log(chalk.green('✅ CRUD operations generated successfully'));
    } catch (error) {
      this.error(`Failed to generate CRUD operations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateCRUDOperations(flags: any): Promise<void> {
    const { entity, graphql, validation, auth, output } = flags;

    // Ensure output directories exist
    await fs.mkdir(path.join(output, 'api', 'schema', 'mutations'), { recursive: true });
    await fs.mkdir(path.join(output, 'api', 'schema', 'queries'), { recursive: true });
    await fs.mkdir(path.join(output, 'application', 'handlers'), { recursive: true });
    await fs.mkdir(path.join(output, 'domain', 'repositories'), { recursive: true });
    await fs.mkdir(path.join(output, 'validation', 'schemas'), { recursive: true });

    // Generate repository
    await this.generateRepository(entity, output);

    // Generate handlers
    await this.generateHandlers(entity, output);

    if (graphql) {
      // Generate GraphQL schema
      await this.generateGraphQLSchema(entity, output);
    }

    if (validation) {
      // Generate validation schemas
      await this.generateValidationSchemas(entity, output);
    }

    if (auth) {
      // Generate auth middleware
      await this.generateAuthMiddleware(entity, output);
    }
  }

  private async generateRepository(entity: string, output: string): Promise<void> {
    const className = `${entity}Repository`;
    const fileName = `${entity}Repository.ts`;
    const filePath = path.join(output, 'domain', 'repositories', fileName);

    const template = `import { ${entity} } from '../aggregates/${entity}';
import { BaseRepository } from './BaseRepository';
import { Logger } from '../../logger';

export interface ${entity}Repository extends BaseRepository<${entity}> {
  findByUserId(userId: string): Promise<${entity}[]>;
  findByStatus(status: string): Promise<${entity}[]>;
  // Add custom repository methods here
}

export class ${className} implements ${entity}Repository {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('${className}');
  }

  async findById(id: string): Promise<${entity} | null> {
    this.logger.info('Finding ${entity.toLowerCase()} by ID', { id });
    
    try {
      // TODO: Implement database query
      return null;
    } catch (error) {
      this.logger.error('Failed to find ${entity.toLowerCase()} by ID', { id, error });
      throw error;
    }
  }

  async findAll(): Promise<${entity}[]> {
    this.logger.info('Finding all ${entity.toLowerCase()}s');
    
    try {
      // TODO: Implement database query
      return [];
    } catch (error) {
      this.logger.error('Failed to find all ${entity.toLowerCase()}s', { error });
      throw error;
    }
  }

  async save(entity: ${entity}): Promise<${entity}> {
    this.logger.info('Saving ${entity.toLowerCase()}', { id: entity.id });
    
    try {
      // TODO: Implement database save
      return entity;
    } catch (error) {
      this.logger.error('Failed to save ${entity.toLowerCase()}', { id: entity.id, error });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    this.logger.info('Deleting ${entity.toLowerCase()}', { id });
    
    try {
      // TODO: Implement database delete
    } catch (error) {
      this.logger.error('Failed to delete ${entity.toLowerCase()}', { id, error });
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<${entity}[]> {
    this.logger.info('Finding ${entity.toLowerCase()}s by user ID', { userId });
    
    try {
      // TODO: Implement database query
      return [];
    } catch (error) {
      this.logger.error('Failed to find ${entity.toLowerCase()}s by user ID', { userId, error });
      throw error;
    }
  }

  async findByStatus(status: string): Promise<${entity}[]> {
    this.logger.info('Finding ${entity.toLowerCase()}s by status', { status });
    
    try {
      // TODO: Implement database query
      return [];
    } catch (error) {
      this.logger.error('Failed to find ${entity.toLowerCase()}s by status', { status, error });
      throw error;
    }
  }
}

export default ${className};
`;

    await fs.writeFile(filePath, template);
    this.log(chalk.blue(`📝 Generated repository: ${filePath}`));
  }

  private async generateHandlers(entity: string, output: string): Promise<void> {
    const className = `${entity}Handler`;
    const fileName = `${entity}Handler.ts`;
    const filePath = path.join(output, 'application', 'handlers', fileName);

    const template = `import { ${entity}Repository } from '../../domain/repositories/${entity}Repository';
import { ${entity} } from '../../domain/aggregates/${entity}';
import { Logger } from '../../logger';

export interface Create${entity}Command {
  // TODO: Add command properties
  id?: string;
}

export interface Update${entity}Command {
  id: string;
  // TODO: Add update properties
}

export interface Delete${entity}Command {
  id: string;
}

export class ${className} {
  private repository: ${entity}Repository;
  private logger: Logger;

  constructor(repository: ${entity}Repository) {
    this.repository = repository;
    this.logger = new Logger('${className}');
  }

  async create(command: Create${entity}Command): Promise<${entity}> {
    this.logger.info('Creating ${entity.toLowerCase()}', { command });
    
    try {
      // TODO: Implement creation logic
      const entity = new ${entity}();
      return await this.repository.save(entity);
    } catch (error) {
      this.logger.error('Failed to create ${entity.toLowerCase()}', { command, error });
      throw error;
    }
  }

  async update(command: Update${entity}Command): Promise<${entity}> {
    this.logger.info('Updating ${entity.toLowerCase()}', { command });
    
    try {
      const entity = await this.repository.findById(command.id);
      if (!entity) {
        throw new Error('${entity} not found');
      }

      // TODO: Implement update logic
      return await this.repository.save(entity);
    } catch (error) {
      this.logger.error('Failed to update ${entity.toLowerCase()}', { command, error });
      throw error;
    }
  }

  async delete(command: Delete${entity}Command): Promise<void> {
    this.logger.info('Deleting ${entity.toLowerCase()}', { command });
    
    try {
      const entity = await this.repository.findById(command.id);
      if (!entity) {
        throw new Error('${entity} not found');
      }

      await this.repository.delete(command.id);
    } catch (error) {
      this.logger.error('Failed to delete ${entity.toLowerCase()}', { command, error });
      throw error;
    }
  }

  async findById(id: string): Promise<${entity} | null> {
    this.logger.info('Finding ${entity.toLowerCase()} by ID', { id });
    
    try {
      return await this.repository.findById(id);
    } catch (error) {
      this.logger.error('Failed to find ${entity.toLowerCase()} by ID', { id, error });
      throw error;
    }
  }

  async findAll(): Promise<${entity}[]> {
    this.logger.info('Finding all ${entity.toLowerCase()}s');
    
    try {
      return await this.repository.findAll();
    } catch (error) {
      this.logger.error('Failed to find all ${entity.toLowerCase()}s', { error });
      throw error;
    }
  }
}

export default ${className};
`;

    await fs.writeFile(filePath, template);
    this.log(chalk.blue(`📝 Generated handler: ${filePath}`));
  }

  private async generateGraphQLSchema(entity: string, output: string): Promise<void> {
    // Generate mutations
    const mutationsFileName = `${entity.toLowerCase()}Mutations.ts`;
    const mutationsPath = path.join(output, 'api', 'schema', 'mutations', mutationsFileName);

    const mutationsTemplate = `import { builder } from '../builder';
import { ${entity}Handler } from '../../../application/handlers/${entity}Handler';
import { Create${entity}Command, Update${entity}Command, Delete${entity}Command } from '../../../application/handlers/${entity}Handler';

// Input types
const Create${entity}Input = builder.inputType('Create${entity}Input', {
  fields: (t) => ({
    // TODO: Add input fields
  }),
});

const Update${entity}Input = builder.inputType('Update${entity}Input', {
  fields: (t) => ({
    id: t.string({ required: true }),
    // TODO: Add update fields
  }),
});

// Mutation fields
builder.mutationField('create${entity}', (t) =>
  t.field({
    type: '${entity}',
    args: {
      input: t.arg({ type: Create${entity}Input, required: true }),
    },
    resolve: async (parent, { input }, context) => {
      const handler = new ${entity}Handler(context.repositories.${entity.toLowerCase()});
      const command: Create${entity}Command = input;
      return await handler.create(command);
    },
  })
);

builder.mutationField('update${entity}', (t) =>
  t.field({
    type: '${entity}',
    args: {
      input: t.arg({ type: Update${entity}Input, required: true }),
    },
    resolve: async (parent, { input }, context) => {
      const handler = new ${entity}Handler(context.repositories.${entity.toLowerCase()});
      const command: Update${entity}Command = input;
      return await handler.update(command);
    },
  })
);

builder.mutationField('delete${entity}', (t) =>
  t.field({
    type: 'Boolean',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (parent, { id }, context) => {
      const handler = new ${entity}Handler(context.repositories.${entity.toLowerCase()});
      const command: Delete${entity}Command = { id };
      await handler.delete(command);
      return true;
    },
  })
);
`;

    await fs.writeFile(mutationsPath, mutationsTemplate);
    this.log(chalk.blue(`📝 Generated GraphQL mutations: ${mutationsPath}`));

    // Generate queries
    const queriesFileName = `${entity.toLowerCase()}Queries.ts`;
    const queriesPath = path.join(output, 'api', 'schema', 'queries', queriesFileName);

    const queriesTemplate = `import { builder } from '../builder';
import { ${entity}Handler } from '../../../application/handlers/${entity}Handler';

// Query fields
builder.queryField('${entity.toLowerCase()}', (t) =>
  t.field({
    type: '${entity}',
    nullable: true,
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (parent, { id }, context) => {
      const handler = new ${entity}Handler(context.repositories.${entity.toLowerCase()});
      return await handler.findById(id);
    },
  })
);

builder.queryField('${entity.toLowerCase()}s', (t) =>
  t.field({
    type: ['${entity}'],
    resolve: async (parent, args, context) => {
      const handler = new ${entity}Handler(context.repositories.${entity.toLowerCase()});
      return await handler.findAll();
    },
  })
);
`;

    await fs.writeFile(queriesPath, queriesTemplate);
    this.log(chalk.blue(`📝 Generated GraphQL queries: ${queriesPath}`));
  }

  private async generateValidationSchemas(entity: string, output: string): Promise<void> {
    const fileName = `${entity.toLowerCase()}Validation.ts`;
    const filePath = path.join(output, 'validation', 'schemas', fileName);

    const template = `import { z } from 'zod';

export const Create${entity}Schema = z.object({
  // TODO: Add validation fields
  id: z.string().optional(),
});

export const Update${entity}Schema = z.object({
  id: z.string(),
  // TODO: Add validation fields
});

export const Delete${entity}Schema = z.object({
  id: z.string(),
});

export type Create${entity}Input = z.infer<typeof Create${entity}Schema>;
export type Update${entity}Input = z.infer<typeof Update${entity}Schema>;
export type Delete${entity}Input = z.infer<typeof Delete${entity}Schema>;
`;

    await fs.writeFile(filePath, template);
    this.log(chalk.blue(`📝 Generated validation schema: ${filePath}`));
  }

  private async generateAuthMiddleware(entity: string, output: string): Promise<void> {
    const className = `${entity}AuthMiddleware`;
    const fileName = `${entity}AuthMiddleware.ts`;
    const filePath = path.join(output, 'middleware', fileName);

    const template = `import { Request, Response, NextFunction } from 'express';
import { Logger } from '../logger';

export class ${className} {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('${className}');
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // TODO: Implement authentication logic
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        // TODO: Validate token and extract user information
        // const user = await validateToken(token);
        // req.user = user;

        this.logger.info('Authentication successful', { 
          method: req.method, 
          url: req.url 
        });

        next();
      } catch (error) {
        this.logger.error('Authentication failed', { error });
        res.status(401).json({ error: 'Authentication failed' });
      }
    };
  }

  async authorize(userId: string, resourceId: string): Promise<boolean> {
    // TODO: Implement authorization logic
    this.logger.info('Checking authorization', { userId, resourceId });
    return true;
  }
}

export default ${className};
`;

    await fs.writeFile(filePath, template);
    this.log(chalk.blue(`📝 Generated auth middleware: ${filePath}`));
  }
} 