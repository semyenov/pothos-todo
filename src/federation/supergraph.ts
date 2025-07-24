import { buildSubgraphSchema } from "@apollo/subgraph";
import { composeServices } from "@apollo/composition";
import { logger } from "../lib/unjs-utils.js";
import chalk from "chalk";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { parse } from "graphql";
import type { ServiceDefinition } from "@/api/federation/FederationManager.js";

const execAsync = promisify(exec);

// Supergraph configuration
export interface SupergraphConfig {
  subgraphs: Array<{
    name: string;
    url: string;
    schemaPath?: string;
    introspectionUrl?: string;
  }>;
  outputPath: string;
  federation: {
    version: "2.0" | "2.1" | "2.2" | "2.3" | "2.4" | "2.5";
    directives: {
      link: boolean;
      shareable: boolean;
      inaccessible: boolean;
      override: boolean;
      tag: boolean;
      authenticated: boolean;
      requiresScopes: boolean;
    };
  };
  composition: {
    enableHints: boolean;
    enableWarn: boolean;
    enableDebug: boolean;
  };
  rover: {
    enabled: boolean;
    configPath: string;
  };
}

export const defaultSupergraphConfig: SupergraphConfig = {
  subgraphs: [
    {
      name: "users",
      url: "http://localhost:4001/graphql",
      schemaPath: "schemas/users.graphql",
      introspectionUrl: "http://localhost:4001/graphql",
    },
    {
      name: "todos",
      url: "http://localhost:4002/graphql",
      schemaPath: "schemas/todos.graphql",
      introspectionUrl: "http://localhost:4002/graphql",
    },
    {
      name: "ai",
      url: "http://localhost:4003/graphql",
      schemaPath: "schemas/ai.graphql",
      introspectionUrl: "http://localhost:4003/graphql",
    },
  ],
  outputPath: "supergraph.graphql",
  federation: {
    version: "2.5",
    directives: {
      link: true,
      shareable: true,
      inaccessible: true,
      override: true,
      tag: true,
      authenticated: true,
      requiresScopes: true,
    },
  },
  composition: {
    enableHints: true,
    enableWarn: true,
    enableDebug: false,
  },
  rover: {
    enabled: true,
    configPath: "supergraph.yaml",
  },
};

// Federation 2.0 enhanced schema builder
export class Federation2SchemaBuilder {
  constructor(private config: SupergraphConfig) { }

  // Build enhanced subgraph schema with Federation 2.0 features
  buildEnhancedSubgraphSchema(
    typeDefs: string,
    resolvers: any,
    subgraphName: string
  ) {
    // Add Federation 2.0 link directive
    const linkDirective = `
      extend schema
        @link(url: "https://specs.apollographql.org/federation/v${this.config.federation.version}", import: [
          "@key", "@requires", "@provides", "@external", "@tag", "@extends", "@shareable", "@inaccessible", "@override", "@authenticated", "@requiresScopes"
        ])
    `;

    // Enhanced typeDefs with Federation 2.0 features
    const enhancedTypeDefs = `
      ${linkDirective}
      
      ${typeDefs}
      
      # Federation 2.0 enhancements
      directive @authenticated on FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM
      directive @requiresScopes(scopes: [String!]!) on FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM
      directive @tag(name: String!) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION
    `;

    return buildSubgraphSchema([
      {
        typeDefs: parse(enhancedTypeDefs),
        resolvers: {
          ...resolvers,
          // Add reference resolvers for Federation 2.0
          ...this.createReferenceResolvers(subgraphName),
        },
      },
    ]);
  }

  // Create reference resolvers for entity resolution
  private createReferenceResolvers(subgraphName: string) {
    const resolvers: any = {};

    switch (subgraphName) {
      case "users":
        resolvers.User = {
          __resolveReference: async (reference: { id: string }) => {
            // Resolve user entity
            return { id: reference.id, __typename: "User" };
          },
        };
        break;
      case "todos":
        resolvers.Todo = {
          __resolveReference: async (reference: { id: string }) => {
            // Resolve todo entity
            return { id: reference.id, __typename: "Todo" };
          },
        };
        break;
      case "ai":
        resolvers.AIInsight = {
          __resolveReference: async (reference: { id: string }) => {
            // Resolve AI insight entity
            return { id: reference.id, __typename: "AIInsight" };
          },
        };
        break;
    }

    return resolvers;
  }

  // Generate supergraph schema using composition
  async composeSupergraph(): Promise<string> {
    logger.info(chalk.blue("🔗 Composing Federation 2.0 supergraph..."));

    try {
      // Collect subgraph schemas
      const services = await Promise.all(
        this.config.subgraphs.map(async (subgraph) => {
          let schema: string;

          if (subgraph.schemaPath) {
            // Read from local file
            schema = await readFile(subgraph.schemaPath, "utf-8");
          } else if (subgraph.introspectionUrl) {
            // Fetch via introspection
            schema = await this.introspectSubgraph(subgraph.introspectionUrl);
          } else {
            throw new Error(`No schema source for subgraph: ${subgraph.name}`);
          }

          return [
            { name: subgraph.name, url: subgraph.url, typeDefs: parse(schema) },
          ];
        })
      );

      // Use Apollo composition
      const compositionResult = composeServices(services.flat());

      if (compositionResult.errors && compositionResult.errors.length > 0) {
        logger.error(chalk.red("Composition errors:"));
        compositionResult.errors.forEach((error) => {
          logger.error(chalk.red(`  - ${error.message}`));
        });
        throw new Error("Schema composition failed");
      }

      if (compositionResult.supergraphSdl) {
        // Save supergraph schema
        await writeFile(
          this.config.outputPath,
          compositionResult.supergraphSdl
        );
        logger.info(
          chalk.green(
            `✅ Supergraph schema saved to: ${this.config.outputPath}`
          )
        );

        return compositionResult.supergraphSdl;
      } else {
        throw new Error("No supergraph SDL generated");
      }
    } catch (error) {
      logger.error(chalk.red("Supergraph composition failed:"), error);
      throw error;
    }
  }

  // Introspect subgraph schema
  private async introspectSubgraph(url: string): Promise<string> {
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

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: introspectionQuery }),
    });

    if (!response.ok) {
      throw new Error(`Introspection failed: ${response.status}`);
    }

    const { data } = await response.json();

    // Convert introspection result to SDL
    // This is a simplified conversion - in production, use proper introspection-to-SDL tools
    return this.introspectionToSDL(data.__schema);
  }

  // Convert introspection result to SDL (simplified)
  private introspectionToSDL(schema: any): string {
    // This is a basic implementation
    // In production, use libraries like @graphql-tools/schema or apollo-schema-processor
    let sdl = "";

    // Add types
    for (const type of schema.types) {
      if (type.name.startsWith("__")) continue; // Skip introspection types

      switch (type.kind) {
        case "OBJECT":
          sdl += `type ${type.name} {\n`;
          if (type.fields) {
            for (const field of type.fields) {
              sdl += `  ${field.name}: ${this.typeToString(field.type)}\n`;
            }
          }
          sdl += "}\n\n";
          break;
        case "ENUM":
          sdl += `enum ${type.name} {\n`;
          if (type.enumValues) {
            for (const value of type.enumValues) {
              sdl += `  ${value.name}\n`;
            }
          }
          sdl += "}\n\n";
          break;
      }
    }

    return sdl;
  }

  private typeToString(type: any): string {
    if (type.kind === "NON_NULL") {
      return `${this.typeToString(type.ofType)}!`;
    }
    if (type.kind === "LIST") {
      return `[${this.typeToString(type.ofType)}]`;
    }
    return type.name;
  }

  // Generate Rover configuration
  async generateRoverConfig(): Promise<void> {
    if (!this.config.rover.enabled) return;

    const roverConfig = {
      federation_version: this.config.federation.version,
      subgraphs: this.config.subgraphs.reduce((acc, subgraph) => {
        acc[subgraph.name] = {
          routing_url: subgraph.url,
          schema: {
            file: subgraph.schemaPath || `./schemas/${subgraph.name}.graphql`,
          },
        };
        return acc;
      }, {} as Record<string, any>),
    };

    // Convert to YAML format
    const yamlContent = `federation_version: ${roverConfig.federation_version}
subgraphs:
${Object.entries(roverConfig.subgraphs)
        .map(
          ([name, config]) => `  ${name}:
    routing_url: ${(config as any).routing_url}
    schema:
      file: ${(config as any).schema.file}`
        )
        .join("\n")}
`;

    await writeFile(this.config.rover.configPath, yamlContent);
    logger.info(
      chalk.green(`✅ Rover config saved to: ${this.config.rover.configPath}`)
    );
  }

  // Validate supergraph with Rover
  async validateWithRover(): Promise<boolean> {
    if (!this.config.rover.enabled) {
      logger.warn(chalk.yellow("Rover validation disabled"));
      return true;
    }

    try {
      // Check if Rover is installed
      await execAsync("rover --version");
    } catch (error) {
      logger.warn(chalk.yellow("Rover not installed. Skipping validation."));
      return true;
    }

    try {
      logger.info(chalk.blue("🔍 Validating supergraph with Rover..."));

      const { stdout, stderr } = await execAsync(
        `rover supergraph compose --config ${this.config.rover.configPath}`
      );

      if (stderr && !stderr.includes("WARN")) {
        logger.error(chalk.red("Rover validation failed:"), stderr);
        return false;
      }

      logger.info(chalk.green("✅ Supergraph validation passed"));
      return true;
    } catch (error) {
      logger.error(chalk.red("Rover validation error:"), error);
      return false;
    }
  }
}

// Enhanced Federation 2.0 directives for subgraphs
export const Federation2Directives = {
  // User subgraph enhancements
  userSubgraph: `
    # Federation 2.0 enhanced User type
    type User @key(fields: "id") @authenticated {
      id: ID!
      email: String! @tag(name: "pii")
      name: String!
      profile: UserProfile @shareable
      settings: UserSettings @requiresScopes(scopes: ["user:read"])
      createdAt: DateTime!
      updatedAt: DateTime!
      
      # Computed fields
      todoCount: Int! @requires(fields: "id")
      lastActiveAt: DateTime @inaccessible
    }
    
    type UserProfile @shareable {
      avatar: String
      bio: String
      location: String
    }
    
    type UserSettings {
      theme: Theme!
      notifications: NotificationSettings!
      privacy: PrivacySettings! @requiresScopes(scopes: ["user:settings"])
    }
  `,

  // Todo subgraph enhancements
  todoSubgraph: `
    # Federation 2.0 enhanced Todo type
    type Todo @key(fields: "id") {
      id: ID!
      title: String!
      description: String
      status: TodoStatus!
      priority: Priority!
      tags: [String!]! @shareable
      dueDate: DateTime
      completedAt: DateTime
      userId: ID! @external
      user: User @provides(fields: "id email name")
      
      # Computed fields
      isOverdue: Boolean! @requires(fields: "dueDate status")
      timeToComplete: Duration @inaccessible
    }
    
    type TodoList @key(fields: "id") @authenticated {
      id: ID!
      title: String!
      description: String
      todos: [Todo!]! @provides(fields: "id title status")
      collaborators: [User!]! @requires(fields: "userId")
      userId: ID! @external
      user: User @provides(fields: "id email")
    }
    
    # Override User.todos in todo subgraph
    extend type User @key(fields: "id") {
      id: ID! @external
      todos: [Todo!]! @override(from: "users")
      todoLists: [TodoList!]!
    }
  `,

  // AI subgraph enhancements
  aiSubgraph: `
    # Federation 2.0 enhanced AI types
    type AIInsight @key(fields: "id") @authenticated {
      id: ID!
      type: InsightType!
      content: String!
      confidence: Float!
      userId: ID! @external
      user: User @provides(fields: "id email")
      relatedTodos: [Todo!]! @requires(fields: "userId")
      
      # Advanced AI fields
      metadata: AIMetadata @inaccessible
      createdAt: DateTime!
    }
    
    type AIMetadata {
      model: String!
      version: String!
      processingTime: Duration!
      tokens: Int!
    }
    
    # Extend User with AI capabilities
    extend type User @key(fields: "id") {
      id: ID! @external
      aiInsights: [AIInsight!]! @requiresScopes(scopes: ["ai:read"])
      productivityScore: Float @requires(fields: "id")
    }
    
    # Extend Todo with AI enhancements
    extend type Todo @key(fields: "id") {
      id: ID! @external
      aiSuggestions: AISuggestions @requiresScopes(scopes: ["ai:read"])
      complexity: ComplexityScore @inaccessible
    }
  `,
};

// Supergraph management
export class SupergraphManager {
  private builder: Federation2SchemaBuilder;

  constructor(config: SupergraphConfig = defaultSupergraphConfig) {
    this.builder = new Federation2SchemaBuilder(config);
  }

  // Build complete supergraph
  async buildSupergraph(): Promise<string> {
    logger.info(chalk.bold("🏗️  Building Federation 2.0 Supergraph"));

    // Create schemas directory
    await mkdir("schemas", { recursive: true });

    // Generate enhanced subgraph schemas
    await this.generateEnhancedSchemas();

    // Generate Rover configuration
    await this.builder.generateRoverConfig();

    // Compose supergraph
    const supergraphSchema = await this.builder.composeSupergraph();

    // Validate with Rover
    const isValid = await this.builder.validateWithRover();
    if (!isValid) {
      throw new Error("Supergraph validation failed");
    }

    logger.info(chalk.green("✅ Federation 2.0 supergraph built successfully"));
    return supergraphSchema;
  }

  // Generate enhanced schemas for each subgraph
  private async generateEnhancedSchemas(): Promise<void> {
    // User subgraph schema
    const userSchema = `
      extend schema @link(url: "https://specs.apollographql.org/federation/v2.5")
      
      ${Federation2Directives.userSubgraph}
      
      type Query {
        users(first: Int, after: String): [User!]!
        user(id: ID!): User
        me: User @authenticated
      }
      
      type Mutation {
        createUser(input: CreateUserInput!): User!
        updateUser(id: ID!, input: UpdateUserInput!): User! @authenticated
        deleteUser(id: ID!): Boolean! @requiresScopes(scopes: ["user:delete"])
      }
    `;

    // Todo subgraph schema
    const todoSchema = `
      extend schema @link(url: "https://specs.apollographql.org/federation/v2.5")
      
      ${Federation2Directives.todoSubgraph}
      
      type Query {
        todos(first: Int, where: TodoWhereInput): [Todo!]!
        todo(id: ID!): Todo
        todoLists(userId: ID!): [TodoList!]! @authenticated
      }
      
      type Mutation {
        createTodo(input: CreateTodoInput!): Todo! @authenticated
        updateTodo(id: ID!, input: UpdateTodoInput!): Todo! @authenticated
        deleteTodo(id: ID!): Boolean! @authenticated
      }
      
      type Subscription {
        todoUpdated(userId: ID!): Todo! @authenticated
      }
    `;

    // AI subgraph schema
    const aiSchema = `
      extend schema @link(url: "https://specs.apollographql.org/federation/v2.5")
      
      ${Federation2Directives.aiSubgraph}
      
      type Query {
        suggestTodos(userId: ID!, limit: Int): [TodoSuggestion!]! @requiresScopes(scopes: ["ai:read"])
        searchTodos(userId: ID!, query: String!): [SearchResult!]! @authenticated
        getUserInsights(userId: ID!): AIInsight @requiresScopes(scopes: ["ai:read"])
      }
      
      type Mutation {
        executeNLPCommand(userId: ID!, command: String!): NLPResult! @authenticated
      }
    `;

    // Write schema files
    await writeFile("schemas/users.graphql", userSchema);
    await writeFile("schemas/todos.graphql", todoSchema);
    await writeFile("schemas/ai.graphql", aiSchema);

    logger.info(chalk.green("✅ Enhanced subgraph schemas generated"));
  }

  // Hot reload supergraph
  async hotReloadSupergraph(): Promise<void> {
    logger.info(chalk.blue("🔄 Hot reloading supergraph..."));

    try {
      await this.buildSupergraph();
      logger.info(chalk.green("✅ Supergraph hot reload completed"));
    } catch (error) {
      logger.error(chalk.red("Hot reload failed:"), error);
      throw error;
    }
  }
}

// Export default instance
export const supergraphManager = new SupergraphManager();
