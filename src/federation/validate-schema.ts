import { buildSchema, GraphQLSchema, introspectionFromSchema, printSchema } from 'graphql';
import { validateSDL } from '@graphql-tools/utils';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    types: number;
    queries: number;
    mutations: number;
    subscriptions: number;
    directives: number;
  };
}

interface SubgraphInfo {
  name: string;
  url: string;
  schema?: GraphQLSchema;
}

const FEDERATION_DIRECTIVES = [
  '@key',
  '@extends',
  '@external',
  '@requires',
  '@provides',
  '@shareable',
  '@override',
  '@inaccessible',
  '@tag',
  '@composeDirective',
  '@interfaceObject',
];

const BEST_PRACTICES = {
  // Naming conventions
  typeNaming: /^[A-Z][a-zA-Z0-9]*$/,
  fieldNaming: /^[a-z][a-zA-Z0-9]*$/,
  enumValueNaming: /^[A-Z][A-Z0-9_]*$/,
  
  // Size limits
  maxQueryDepth: 10,
  maxFieldsPerType: 50,
  maxArgumentsPerField: 10,
  
  // Required fields
  requiredTypeFields: {
    'Query': ['__typename'],
    'Mutation': ['__typename'],
  },
};

async function fetchSubgraphSchema(subgraph: SubgraphInfo): Promise<GraphQLSchema | null> {
  try {
    const response = await fetch(subgraph.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: introspectionQuery,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const { data } = await response.json();
    if (!data) {
      throw new Error('No introspection data returned');
    }

    return buildSchema(data);
  } catch (error) {
    logger.error(`Failed to fetch schema from ${subgraph.name}:`, error);
    return null;
  }
}

function validateNamingConventions(schema: GraphQLSchema): string[] {
  const errors: string[] = [];
  const typeMap = schema.getTypeMap();

  for (const [typeName, type] of Object.entries(typeMap)) {
    // Skip introspection types
    if (typeName.startsWith('__')) continue;

    // Check type naming
    if (!BEST_PRACTICES.typeNaming.test(typeName)) {
      errors.push(`Type "${typeName}" doesn't follow naming convention (PascalCase)`);
    }

    // Check field naming
    if ('getFields' in type) {
      const fields = type.getFields();
      for (const [fieldName, field] of Object.entries(fields)) {
        if (!BEST_PRACTICES.fieldNaming.test(fieldName)) {
          errors.push(`Field "${typeName}.${fieldName}" doesn't follow naming convention (camelCase)`);
        }

        // Check argument count
        if (field.args && field.args.length > BEST_PRACTICES.maxArgumentsPerField) {
          errors.push(`Field "${typeName}.${fieldName}" has too many arguments (${field.args.length} > ${BEST_PRACTICES.maxArgumentsPerField})`);
        }
      }

      // Check field count
      const fieldCount = Object.keys(fields).length;
      if (fieldCount > BEST_PRACTICES.maxFieldsPerType) {
        errors.push(`Type "${typeName}" has too many fields (${fieldCount} > ${BEST_PRACTICES.maxFieldsPerType})`);
      }
    }
  }

  return errors;
}

function validateFederationDirectives(schemaSDL: string): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for @key directive on entities
  const keyDirectiveRegex = /@key\s*\(\s*fields:\s*"([^"]+)"\s*\)/g;
  const matches = [...schemaSDL.matchAll(keyDirectiveRegex)];
  
  if (matches.length === 0) {
    warnings.push('No @key directives found. Consider adding entity keys for federation.');
  }

  // Check for proper use of @external
  if (schemaSDL.includes('@external') && !schemaSDL.includes('@extends')) {
    errors.push('@external directive used without @extends directive');
  }

  // Check for conflicting directives
  if (schemaSDL.includes('@shareable') && schemaSDL.includes('@override')) {
    warnings.push('Both @shareable and @override directives found. Make sure they are not on the same field.');
  }

  return errors;
}

function analyzeSchemaComplexity(schema: GraphQLSchema): string[] {
  const warnings: string[] = [];
  const queryType = schema.getQueryType();
  
  if (!queryType) {
    warnings.push('No Query type found in schema');
    return warnings;
  }

  // Simple depth analysis (would need more sophisticated analysis in production)
  const checkDepth = (type: any, depth: number = 0, visited: Set<string> = new Set()): void => {
    if (depth > BEST_PRACTICES.maxQueryDepth) {
      warnings.push(`Potential deep nesting detected (depth > ${BEST_PRACTICES.maxQueryDepth})`);
      return;
    }

    if (!type || visited.has(type.name)) return;
    visited.add(type.name);

    if ('getFields' in type) {
      const fields = type.getFields();
      for (const field of Object.values(fields)) {
        const fieldType = field.type;
        // Recursively check field types
        checkDepth(fieldType, depth + 1, visited);
      }
    }
  };

  checkDepth(queryType);
  return warnings;
}

export async function validateSubgraphSchema(subgraph: SubgraphInfo): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    stats: {
      types: 0,
      queries: 0,
      mutations: 0,
      subscriptions: 0,
      directives: 0,
    },
  };

  try {
    // Fetch schema
    const schema = await fetchSubgraphSchema(subgraph);
    if (!schema) {
      result.valid = false;
      result.errors.push('Failed to fetch schema');
      return result;
    }

    // Get schema SDL
    const schemaSDL = printSchema(schema);

    // Basic SDL validation
    const sdlErrors = validateSDL(schemaSDL);
    if (sdlErrors.length > 0) {
      result.valid = false;
      result.errors.push(...sdlErrors.map(e => e.message));
    }

    // Naming convention validation
    const namingErrors = validateNamingConventions(schema);
    result.errors.push(...namingErrors);

    // Federation directive validation
    const federationErrors = validateFederationDirectives(schemaSDL);
    result.errors.push(...federationErrors);

    // Complexity analysis
    const complexityWarnings = analyzeSchemaComplexity(schema);
    result.warnings.push(...complexityWarnings);

    // Calculate stats
    const typeMap = schema.getTypeMap();
    result.stats.types = Object.keys(typeMap).filter(name => !name.startsWith('__')).length;
    
    const queryType = schema.getQueryType();
    if (queryType && 'getFields' in queryType) {
      result.stats.queries = Object.keys(queryType.getFields()).length;
    }

    const mutationType = schema.getMutationType();
    if (mutationType && 'getFields' in mutationType) {
      result.stats.mutations = Object.keys(mutationType.getFields()).length;
    }

    const subscriptionType = schema.getSubscriptionType();
    if (subscriptionType && 'getFields' in subscriptionType) {
      result.stats.subscriptions = Object.keys(subscriptionType.getFields()).length;
    }

    // Count directives
    result.stats.directives = (schemaSDL.match(/@\w+/g) || []).length;

    result.valid = result.errors.length === 0;
  } catch (error) {
    result.valid = false;
    result.errors.push(`Validation failed: ${error}`);
  }

  return result;
}

export async function validateAllSubgraphs(): Promise<void> {
  const subgraphs: SubgraphInfo[] = [
    { name: 'User', url: process.env.USER_SUBGRAPH_URL || 'http://localhost:4001/graphql' },
    { name: 'Todo', url: process.env.TODO_SUBGRAPH_URL || 'http://localhost:4002/graphql' },
    { name: 'AI', url: process.env.AI_SUBGRAPH_URL || 'http://localhost:4003/graphql' },
  ];

  logger.info(chalk.bold('\n🔍 Validating Federation Schemas\n'));

  let allValid = true;
  const results: Record<string, ValidationResult> = {};

  for (const subgraph of subgraphs) {
    logger.info(chalk.blue(`Validating ${subgraph.name} subgraph...`));
    
    const result = await validateSubgraphSchema(subgraph);
    results[subgraph.name] = result;
    
    if (result.valid) {
      logger.info(chalk.green(`✅ ${subgraph.name} schema is valid`));
    } else {
      logger.error(chalk.red(`❌ ${subgraph.name} schema has errors`));
      allValid = false;
    }

    // Print stats
    logger.info(chalk.dim(`   Types: ${result.stats.types}, Queries: ${result.stats.queries}, Mutations: ${result.stats.mutations}, Subscriptions: ${result.stats.subscriptions}`));

    // Print errors
    if (result.errors.length > 0) {
      logger.error(chalk.red('\n   Errors:'));
      result.errors.forEach(error => {
        logger.error(chalk.red(`   - ${error}`));
      });
    }

    // Print warnings
    if (result.warnings.length > 0) {
      logger.warn(chalk.yellow('\n   Warnings:'));
      result.warnings.forEach(warning => {
        logger.warn(chalk.yellow(`   - ${warning}`));
      });
    }

    logger.info(''); // Empty line
  }

  // Generate report
  const reportPath = join(process.cwd(), 'federation-validation-report.json');
  await writeFile(reportPath, JSON.stringify({ 
    timestamp: new Date().toISOString(),
    allValid,
    results,
  }, null, 2));

  logger.info(chalk.bold('\n📊 Summary:'));
  logger.info(`Total subgraphs: ${subgraphs.length}`);
  logger.info(`Valid subgraphs: ${Object.values(results).filter(r => r.valid).length}`);
  logger.info(`Report saved to: ${reportPath}`);

  if (!allValid) {
    process.exit(1);
  }
}

// Introspection query
const introspectionQuery = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Run validation if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateAllSubgraphs().catch(error => {
    logger.error('Validation failed:', error);
    process.exit(1);
  });
}