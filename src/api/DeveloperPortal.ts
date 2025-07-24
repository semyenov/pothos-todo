import { printSchema, GraphQLSchema } from 'graphql';
import { logger } from '@/logger.js';
import { SystemIntegration } from '@/infrastructure/SystemIntegration.js';
import { MonitoringDashboard } from './MonitoringDashboard.js';
import { schema } from './schema/schema.js';

export interface DeveloperPortalConfig {
  baseUrl: string;
  features: {
    playground: boolean;
    documentation: boolean;
    monitoring: boolean;
    apiKeys: boolean;
    rateLimits: boolean;
  };
}

export interface APIDocumentation {
  overview: string;
  authentication: {
    methods: string[];
    examples: Record<string, string>;
  };
  endpoints: {
    graphql: EndpointDoc;
    rest?: EndpointDoc[];
  };
  sdks: SDK[];
  examples: Example[];
  changelog: ChangelogEntry[];
}

export interface EndpointDoc {
  name: string;
  url: string;
  description: string;
  authentication: boolean;
  rateLimit?: {
    requests: number;
    window: string;
  };
}

export interface SDK {
  language: string;
  version: string;
  repository: string;
  documentation: string;
  installation: string;
  example: string;
}

export interface Example {
  title: string;
  description: string;
  language: string;
  code: string;
  live?: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: Date;
  changes: {
    type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';
    description: string;
  }[];
}

/**
 * Developer Portal
 * Provides API documentation, playground, and developer tools
 */
export class DeveloperPortal {
  private config: DeveloperPortalConfig;
  private system: SystemIntegration;
  private monitoring?: MonitoringDashboard;
  private documentation: APIDocumentation;

  private constructor(
    config: DeveloperPortalConfig,
    system: SystemIntegration,
    monitoring?: MonitoringDashboard
  ) {
    this.config = config;
    this.system = system;
    this.monitoring = monitoring;
    this.documentation = this.generateDocumentation();
  }

  /**
   * Create a new DeveloperPortal instance
   * Handles async initialization of dependencies
   */
  static async create(config: DeveloperPortalConfig): Promise<DeveloperPortal> {
    const system = SystemIntegration.getInstance();
    
    let monitoring: MonitoringDashboard | undefined;
    if (config.features.monitoring) {
      monitoring = await MonitoringDashboard.create({
        refreshInterval: 30000,
        historyWindow: 3600000,
        alertThresholds: {
          errorRate: 0.05,
          responseTime: 1000,
          availability: 99,
          threatCount: 10,
        },
      });
    }

    return new DeveloperPortal(config, system, monitoring);
  }

  /**
   * Generate comprehensive API documentation
   */
  private generateDocumentation(): APIDocumentation {
    return {
      overview: `
# Pothos Todo GraphQL API

A modern, scalable GraphQL API with advanced features including:
- 🚀 Edge computing with global distribution
- 🔒 Zero-trust security architecture
- 📊 Real-time monitoring and observability
- 🤖 AI-powered assistance
- ⚡ Event-driven architecture with CQRS
- 🌍 Multi-region data replication

## Key Features

### Performance
- Sub-100ms response times globally
- Intelligent caching with GraphQL awareness
- Automatic query optimization
- Predictive prefetching

### Security
- JWT-based authentication
- Multi-factor authentication support
- Threat detection and prevention
- Compliance automation (GDPR, SOC2)

### Scalability
- Auto-scaling based on demand
- Edge computing across 5+ regions
- Conflict-free data replication
- Resource pooling and optimization

### Developer Experience
- Comprehensive GraphQL playground
- Real-time API monitoring
- SDKs for multiple languages
- Extensive code examples
      `.trim(),

      authentication: {
        methods: ['Bearer Token', 'API Key', 'OAuth 2.0'],
        examples: {
          bearer: `
// Bearer Token Authentication
const response = await fetch('${this.config.baseUrl}/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  },
  body: JSON.stringify({
    query: '{ todos { id title } }'
  })
});
          `.trim(),
          
          apiKey: `
// API Key Authentication
const response = await fetch('${this.config.baseUrl}/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    query: '{ todos { id title } }'
  })
});
          `.trim(),
        },
      },

      endpoints: {
        graphql: {
          name: 'GraphQL Endpoint',
          url: `${this.config.baseUrl}/graphql`,
          description: 'Main GraphQL endpoint with full schema support',
          authentication: true,
          rateLimit: {
            requests: 100,
            window: '1m',
          },
        },
      },

      sdks: [
        {
          language: 'TypeScript',
          version: '1.0.0',
          repository: 'https://github.com/example/pothos-todo-sdk-ts',
          documentation: 'https://docs.example.com/sdk/typescript',
          installation: 'npm install @pothos-todo/sdk',
          example: `
import { TodoClient } from '@pothos-todo/sdk';

const client = new TodoClient({
  url: '${this.config.baseUrl}/graphql',
  auth: { token: 'YOUR_TOKEN' }
});

// Get todos
const todos = await client.todos.list({
  filter: { status: 'pending' },
  orderBy: { field: 'createdAt', direction: 'DESC' }
});

// Create a todo
const todo = await client.todos.create({
  title: 'New Todo',
  description: 'Description here'
});
          `.trim(),
        },
        {
          language: 'Python',
          version: '1.0.0',
          repository: 'https://github.com/example/pothos-todo-sdk-py',
          documentation: 'https://docs.example.com/sdk/python',
          installation: 'pip install pothos-todo-sdk',
          example: `
from pothos_todo import TodoClient

client = TodoClient(
    url="${this.config.baseUrl}/graphql",
    auth_token="YOUR_TOKEN"
)

# Get todos
todos = client.todos.list(
    filter={"status": "pending"},
    order_by={"field": "createdAt", "direction": "DESC"}
)

# Create a todo
todo = client.todos.create(
    title="New Todo",
    description="Description here"
)
          `.trim(),
        },
      ],

      examples: [
        {
          title: 'Query Todos with Filtering',
          description: 'Fetch todos with advanced filtering and pagination',
          language: 'graphql',
          code: `
query GetTodos($filter: TodoFilter, $page: PageInput) {
  todos(filter: $filter, page: $page) {
    nodes {
      id
      title
      description
      status
      priority
      createdAt
      tags
      assignee {
        id
        name
        email
      }
    }
    pageInfo {
      total
      hasNextPage
      hasPreviousPage
    }
  }
}

# Variables
{
  "filter": {
    "status": "pending",
    "priority": "high",
    "tags": ["urgent", "bug"]
  },
  "page": {
    "size": 20,
    "cursor": null
  }
}
          `.trim(),
          live: true,
        },
        {
          title: 'Create Todo with Optimistic UI',
          description: 'Create a todo with optimistic updates',
          language: 'graphql',
          code: `
mutation CreateTodo($input: CreateTodoInput!) {
  createTodo(input: $input) {
    todo {
      id
      title
      description
      status
      priority
      createdAt
    }
    errors {
      field
      message
    }
  }
}

# Variables
{
  "input": {
    "title": "Implement new feature",
    "description": "Add user notifications",
    "priority": "medium",
    "tags": ["feature", "notifications"],
    "assigneeId": "user123"
  }
}
          `.trim(),
          live: true,
        },
        {
          title: 'Real-time Todo Updates',
          description: 'Subscribe to real-time todo updates',
          language: 'graphql',
          code: `
subscription TodoUpdates($userId: ID) {
  todoUpdated(userId: $userId) {
    id
    title
    status
    updatedAt
    updatedBy {
      id
      name
    }
  }
}

# Variables
{
  "userId": "current-user-id"
}
          `.trim(),
          live: true,
        },
        {
          title: 'Batch Operations',
          description: 'Perform batch operations efficiently',
          language: 'graphql',
          code: `
mutation BatchUpdateTodos($ids: [ID!]!, $update: UpdateTodoInput!) {
  batchUpdateTodos(ids: $ids, update: $update) {
    updated
    errors {
      id
      message
    }
  }
}

# Variables
{
  "ids": ["todo1", "todo2", "todo3"],
  "update": {
    "status": "completed",
    "completedAt": "2024-01-01T00:00:00Z"
  }
}
          `.trim(),
          live: true,
        },
      ],

      changelog: [
        {
          version: '2.0.0',
          date: new Date('2024-01-01'),
          changes: [
            {
              type: 'added',
              description: 'Edge computing support with global distribution',
            },
            {
              type: 'added',
              description: 'AI-powered todo suggestions and categorization',
            },
            {
              type: 'added',
              description: 'Real-time collaboration features',
            },
            {
              type: 'changed',
              description: 'Improved query performance by 10x',
            },
            {
              type: 'security',
              description: 'Added zero-trust authentication',
            },
          ],
        },
        {
          version: '1.5.0',
          date: new Date('2023-11-01'),
          changes: [
            {
              type: 'added',
              description: 'Batch operations for todos',
            },
            {
              type: 'added',
              description: 'Advanced filtering with full-text search',
            },
            {
              type: 'fixed',
              description: 'Improved error handling and validation',
            },
          ],
        },
      ],
    };
  }

  /**
   * Get GraphQL schema documentation
   */
  getSchemaDocumentation(): string {
    return printSchema(schema);
  }

  /**
   * Get API status and health
   */
  async getAPIStatus(): Promise<{
    status: 'operational' | 'degraded' | 'down';
    uptime: number;
    performance: {
      responseTime: number;
      throughput: number;
      errorRate: number;
    };
    regions: Array<{
      name: string;
      status: string;
      latency: number;
    }>;
  }> {
    const health = await this.system.getSystemHealth();
    const dashboardData = this.monitoring ? 
      await this.monitoring.getCurrentData() : null;

    return {
      status: health.status === 'healthy' ? 'operational' : 
              health.status === 'degraded' ? 'degraded' : 'down',
      uptime: process.uptime(),
      performance: {
        responseTime: dashboardData?.performance.responseTime.p95 || 0,
        throughput: dashboardData?.performance.throughput || 0,
        errorRate: (dashboardData?.performance.errors?.length || 0) / Math.max(dashboardData?.performance.throughput || 1, 1),
      },
      regions: dashboardData?.infrastructure.edge.locations.map(loc => ({
        name: loc.region,
        status: loc.status,
        latency: loc.latency,
      })) || [],
    };
  }

  /**
   * Generate interactive API playground
   */
  generatePlayground(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Pothos Todo API Playground</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
  <style>
    body { margin: 0; height: 100vh; }
    #graphiql { height: 100%; }
    .toolbar { 
      background: #1e1e1e; 
      color: white; 
      padding: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status { 
      display: flex; 
      gap: 20px;
      align-items: center;
    }
    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
    }
    .status-operational { background: #4caf50; }
    .status-degraded { background: #ff9800; }
    .status-down { background: #f44336; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h2>Pothos Todo API Playground</h2>
    <div class="status">
      <div>
        <span class="status-indicator status-operational"></span>
        <span>API Status: Operational</span>
      </div>
      <div>Response Time: <span id="response-time">-</span>ms</div>
      <div>Region: <span id="region">-</span></div>
    </div>
  </div>
  <div id="graphiql">Loading...</div>
  
  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  
  <script>
    // Custom fetcher with monitoring
    function graphQLFetcher(graphQLParams) {
      const startTime = Date.now();
      
      return fetch('${this.config.baseUrl}/graphql', {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('authToken') || '')
        },
        body: JSON.stringify(graphQLParams),
      }).then(response => {
        const responseTime = Date.now() - startTime;
        document.getElementById('response-time').textContent = responseTime;
        document.getElementById('region').textContent = 
          response.headers.get('x-served-by') || 'origin';
        
        return response.json();
      });
    }

    // Render GraphiQL
    ReactDOM.render(
      React.createElement(GraphiQL, {
        fetcher: graphQLFetcher,
        defaultQuery: \`# Welcome to Pothos Todo API Playground
# 
# Try running this query:

query GetTodos {
  todos(page: { size: 10 }) {
    nodes {
      id
      title
      status
      priority
    }
    pageInfo {
      total
      hasNextPage
    }
  }
}\`,
        headerEditorEnabled: true,
        shouldPersistHeaders: true,
      }),
      document.getElementById('graphiql'),
    );
    
    // Update status periodically
    setInterval(async () => {
      try {
        const response = await fetch('${this.config.baseUrl}/health');
        const health = await response.json();
        
        const statusEl = document.querySelector('.status-indicator');
        statusEl.className = 'status-indicator status-' + 
          (health.status === 'healthy' ? 'operational' : 
           health.status === 'degraded' ? 'degraded' : 'down');
      } catch (e) {
        console.error('Health check failed', e);
      }
    }, 30000);
  </script>
</body>
</html>
    `.trim();
  }

  /**
   * Generate OpenAPI specification for REST endpoints
   */
  generateOpenAPISpec(): any {
    return {
      openapi: '3.0.0',
      info: {
        title: 'Pothos Todo API',
        version: '2.0.0',
        description: this.documentation.overview,
        contact: {
          name: 'API Support',
          email: 'api@example.com',
        },
      },
      servers: [
        {
          url: this.config.baseUrl,
          description: 'Production',
        },
      ],
      paths: {
        '/graphql': {
          post: {
            summary: 'GraphQL Endpoint',
            description: 'Execute GraphQL queries and mutations',
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['query'],
                    properties: {
                      query: { type: 'string' },
                      variables: { type: 'object' },
                      operationName: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        data: { type: 'object' },
                        errors: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              message: { type: 'string' },
                              path: { type: 'array' },
                              extensions: { type: 'object' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/health': {
          get: {
            summary: 'Health Check',
            description: 'Get API health status',
            responses: {
              200: {
                description: 'Health status',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        uptime: { type: 'number' },
                        version: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
    };
  }

  /**
   * Get rate limit information
   */
  getRateLimitInfo(): {
    tiers: Array<{
      name: string;
      limits: {
        requests: number;
        window: string;
        concurrent: number;
      };
      features: string[];
    }>;
  } {
    return {
      tiers: [
        {
          name: 'Free',
          limits: {
            requests: 100,
            window: '1m',
            concurrent: 10,
          },
          features: [
            'Basic GraphQL queries',
            'Standard response time',
            'Community support',
          ],
        },
        {
          name: 'Pro',
          limits: {
            requests: 1000,
            window: '1m',
            concurrent: 50,
          },
          features: [
            'All GraphQL operations',
            'Priority routing',
            'Real-time subscriptions',
            'Email support',
          ],
        },
        {
          name: 'Enterprise',
          limits: {
            requests: 10000,
            window: '1m',
            concurrent: 500,
          },
          features: [
            'Unlimited GraphQL operations',
            'Dedicated infrastructure',
            'Custom rate limits',
            'SLA guarantee',
            '24/7 phone support',
          ],
        },
      ],
    };
  }

  /**
   * Export documentation in various formats
   */
  exportDocumentation(format: 'markdown' | 'html' | 'pdf'): string {
    switch (format) {
      case 'markdown':
        return this.exportAsMarkdown();
      case 'html':
        return this.exportAsHTML();
      case 'pdf':
        // Would use a PDF generation library
        return 'PDF generation not implemented';
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Export as Markdown
   */
  private exportAsMarkdown(): string {
    const doc = this.documentation;
    
    return `
# ${doc.overview}

## Authentication

Supported methods: ${doc.authentication.methods.join(', ')}

### Examples

${Object.entries(doc.authentication.examples).map(([method, example]) => `
#### ${method}
\`\`\`javascript
${example}
\`\`\`
`).join('\n')}

## Endpoints

### ${doc.endpoints.graphql.name}
- URL: ${doc.endpoints.graphql.url}
- Description: ${doc.endpoints.graphql.description}
- Authentication: ${doc.endpoints.graphql.authentication ? 'Required' : 'Optional'}
- Rate Limit: ${doc.endpoints.graphql.rateLimit?.requests}/${doc.endpoints.graphql.rateLimit?.window}

## SDKs

${doc.sdks.map(sdk => `
### ${sdk.language} SDK
- Version: ${sdk.version}
- Repository: ${sdk.repository}
- Documentation: ${sdk.documentation}

Installation:
\`\`\`bash
${sdk.installation}
\`\`\`

Example:
\`\`\`${sdk.language.toLowerCase()}
${sdk.example}
\`\`\`
`).join('\n')}

## Examples

${doc.examples.map(example => `
### ${example.title}
${example.description}

\`\`\`${example.language}
${example.code}
\`\`\`
`).join('\n')}

## Changelog

${doc.changelog.map(entry => `
### ${entry.version} - ${entry.date.toDateString()}
${entry.changes.map(change => `- **${change.type}**: ${change.description}`).join('\n')}
`).join('\n')}
    `.trim();
  }

  /**
   * Export as HTML
   */
  private exportAsHTML(): string {
    const markdown = this.exportAsMarkdown();
    // Would use a markdown-to-HTML converter
    return `<html><body>${markdown}</body></html>`;
  }
}