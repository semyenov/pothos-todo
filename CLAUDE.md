# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a fully modernized, enterprise-grade Pothos GraphQL API built with Domain-Driven Design (DDD) architecture and CQRS pattern. It uses Bun as the JavaScript runtime, H3 as the HTTP framework, and includes comprehensive next-generation capabilities:

- **AI/ML Integration**: LangChain-powered conversational AI, RAG, vector search, and predictive analytics
- **Enterprise Security**: Quantum-resistant cryptography, advanced threat detection, and compliance frameworks
- **Edge Computing**: Intelligent CDN optimization and global content distribution
- **Advanced Observability**: OpenTelemetry distributed tracing, comprehensive monitoring, and anomaly detection
- **Real-time Collaboration**: Live editing, presence tracking, conflict-free data synchronization
- **Enterprise Backup & DR**: Complete business continuity infrastructure with automated disaster recovery
- **Advanced Caching**: Multi-level distributed caching with predictive warming and intelligent invalidation

The project represents a complete transformation from a basic todo application to a modern, enterprise-ready platform with world-class infrastructure capabilities.

### Recent Advanced Modernization
The application has undergone extensive enterprise modernization with the addition of:
- **Microservices Architecture**: Service registry, message broker with event sourcing, service mesh with traffic management
- **Multi-Tenant SaaS Platform**: Complete tenant isolation with billing integration and automated migrations
- **Advanced Analytics & BI**: Real-time data analytics with predictive modeling and automated reporting
- **Redis Cluster Caching**: High-performance distributed caching with consistent hashing and intelligent policies
- **Enterprise API Gateway**: Centralized API management with authentication, rate limiting, and intelligent routing
- **Production Monitoring**: 360° observability with distributed tracing and automated alerting

## Development Commands

### Essential Commands
```bash
# Install dependencies
bun install

# Start development server (with watch mode)
bun run dev

# Start production server
bun run start

# Type checking (critical - run before commits)
bun run check:types

# Build project
bun run build

# Validate project (types + linting)
bun run validate
```

### Database Commands
```bash
# Start PostgreSQL container
bun run db:up

# Start all services (PostgreSQL + Qdrant for AI features)
bun run services:up

# Run Prisma migrations
bun run db:migrate

# Generate Prisma client (required after schema changes)
bun run db:generate

# Open Prisma Studio (database GUI)
bun run db:studio

# Reset database (caution: deletes all data)
bun run db:reset

# Seed database with initial data
bun run db:seed
```

Note: The project uses `docker compose` (not `docker-compose`) for container management.

### Service Management
```bash
# Start all Docker services (PostgreSQL + Qdrant)
bun run services:up

# Stop all Docker services
bun run services:down

# Start only Qdrant (for AI features)
bun run qdrant:up
```

### CLI Commands
The project includes a comprehensive CLI built with OCLIF:
```bash
bun run cli <command>

# Available topics:
# - build: Build project commands
# - check: Validation and check commands  
# - config: Configuration management commands
# - db: Database management commands
# - dev: Development commands
# - services: Docker services management
```

## Architecture Overview

### Domain-Driven Design Structure

The codebase follows DDD principles with clear separation of concerns:

1. **Domain Layer** (`src/domain/`)
   - **Aggregates**: User, Todo, TodoList - core business entities with business logic
   - **Events**: Domain events for state changes (UserCreated, TodoCreated, etc.)
   - **Value Objects**: Priority, TodoStatus, UserId - immutable domain concepts
   - **Repositories**: Interfaces defining data access contracts

2. **Application Layer** (`src/application/`)
   - **Commands**: Command objects representing user intentions
   - **Handlers**: Command handlers implementing business use cases
   - Uses CQRS pattern - commands for writes, direct queries for reads

3. **Infrastructure Layer** (`src/infrastructure/`)
   - **Persistence**: Prisma-based repository implementations
   - **Container**: Dependency injection setup
   - **Events**: Event publishing and handling infrastructure
   - **AI Services**: Advanced AI/ML capabilities (AdvancedLangChainService, EmbeddingService, NLPService, RAGService)
   - **Security**: Quantum-resistant cryptography, advanced threat detection, policy engines
   - **Edge Computing**: Intelligent CDN optimization, edge computing management
   - **Observability**: OpenTelemetry integration, distributed tracing, metrics collection
   - **Collaboration**: Real-time collaboration with operational transforms
   - **Monitoring**: Advanced monitoring with anomaly detection and alerting
   - **Caching**: Multi-level distributed caching with predictive warming
   - **Backup & DR**: Enterprise-grade backup management and disaster recovery orchestration

4. **API Layer** (`src/api/`)
   - **GraphQL Schema**: Pothos-based type-safe schema definitions
   - **Mutations**: GraphQL mutations mapped to application commands
   - **Queries**: GraphQL queries for data retrieval
   - **Server**: GraphQL Yoga server configuration
   - **DataLoaders**: N+1 query optimization

### Key Architectural Decisions

- **Event Sourcing**: All domain changes emit events stored in DomainEvent table
- **Repository Pattern**: Domain logic isolated from persistence details
- **Dependency Injection**: IoC container manages dependencies
- **Type Safety**: End-to-end type safety from database to GraphQL API
- **Advanced Caching**: Multi-level distributed caching with consistent hashing and predictive warming
- **AI Integration**: LangChain-powered conversational AI with vector embeddings (Qdrant) for semantic search
- **Real-time Features**: WebSocket subscriptions with operational transforms for conflict-free collaboration
- **Enterprise Security**: Quantum-resistant cryptography with post-quantum algorithms (Kyber, Dilithium, SPHINCS+)
- **Edge Computing**: Intelligent CDN optimization with ML-based content distribution
- **Comprehensive Observability**: OpenTelemetry distributed tracing with Prometheus metrics
- **Business Continuity**: Complete backup and disaster recovery infrastructure with automated failover

## Configuration System

The project uses **c12** for configuration management with environment-specific overrides:

- `config/base.config.ts` - Base configuration
- `config/development.config.ts` - Development overrides
- `config/production.config.ts` - Production overrides
- `config/test.config.ts` - Test overrides

### Configuration Usage
```typescript
import { getServerConfig, getSessionConfig, getDatabaseConfig } from './src/config/index.js';

// ✅ Correct - use config functions
const serverConfig = getServerConfig();

// ❌ Wrong - never access process.env directly
const port = process.env.PORT; // Don't do this
```

## Authentication System

### OAuth Providers
- Google OAuth with PKCE support
- GitHub OAuth
- Routes: `/auth/google`, `/auth/github`, and respective callbacks

### Session Management
- H3 sessions with encrypted cookies
- Lucia for auth state management
- Secure session storage in database

### User Management
- Email/password authentication with bcrypt
- Provider account linking
- Session-based authentication for GraphQL

## GraphQL Development

### Schema Development Workflow
1. Define domain models in `prisma/schema.prisma`
2. Run `bun run db:generate` to update Prisma client
3. Create/update GraphQL types in `src/api/schema/types/`
4. Add mutations in `src/api/schema/mutations/`
5. Add queries in `src/api/schema/queries/`
6. **Always run `bun run check:types` before committing**

### Pothos Builder Configuration
The schema builder in `src/api/schema/builder.ts` includes plugins:
- Prisma integration for automatic type generation
- DataLoader for N+1 query optimization
- Error handling with typed errors
- Relay-style connections and nodes
- Validation with Zod schemas
- Tracing and performance monitoring

### GraphQL Endpoints
- **Primary**: `http://localhost:4000/graphql`
- **WebSocket**: `ws://localhost:4000/graphql` (for subscriptions)
- **Health Check**: `http://localhost:4000/health`
- **Metrics**: `http://localhost:4000/metrics`

## Database Management

### Prisma Workflow
1. Modify schema in `prisma/schema.prisma`
2. Create migration: `bun run db:migrate`
3. Generate types: `bun run db:generate`
4. Update GraphQL schema accordingly
5. Test with `bun run check:types`

### Event Sourcing
All domain mutations emit events stored in the DomainEvent table:
- Automatic event capture via domain aggregates
- Event replay capabilities
- Audit trail for all changes
- Real-time subscriptions based on events

## UnJS Ecosystem Integration

The project extensively leverages the UnJS ecosystem for maximum performance and developer experience. This comprehensive integration includes:

### Core UnJS Utilities (`src/lib/unjs-utils.ts`)

**HTTP Operations**: 
- `ofetch`/`$fetch` for optimized HTTP requests with retry and caching
- Built-in request/response transformation and validation

**Path & URL Utilities**:
- `pathe` for cross-platform path operations
- `ufo` for URL parsing, manipulation, and query handling

**Data Processing**:
- `ohash` for consistent hashing and `scule` for deep object operations
- `destr` for safe JSON parsing and serialization
- `defu` for intelligent deep merging

**Storage & Caching**:
- `unstorage` for unified storage abstraction across backends
- Redis, file system, and memory drivers

**Development Tools**:
- `consola` for enhanced logging with multiple formats
- `std-env` for reliable environment detection

### File System Service (`src/infrastructure/filesystem/UnJSFileSystem.ts`)

- **Unified Storage**: `unstorage` with multiple driver support
- **Dynamic Imports**: `jiti` for runtime TypeScript module loading
- **Archive Operations**: `nanotar` for tar file handling
- **Real-time Monitoring**: File watching with automatic change detection
- **Pattern Matching**: Advanced glob patterns for file discovery
- **Type-aware Processing**: Automatic parsing based on file extensions

### Enhanced Validation (`src/infrastructure/validation/UnJSValidation.ts`)

- **Schema Generation**: `untyped` for TypeScript-to-schema conversion
- **H3 Integration**: Built-in middleware for request validation
- **Multi-format Export**: JSON Schema and TypeScript interface generation
- **Batch Validation**: Concurrent validation with detailed reporting
- **Custom Validators**: Extensible validation rules and transformations

### Configuration Management (`src/config/unjs-config.ts`)

- **Multi-source Loading**: `unconfig` with priority-based merging
- **Live Reloading**: Automatic configuration updates on file changes
- **Environment Awareness**: Context-sensitive configuration loading
- **Validation**: Built-in schema validation with detailed error messages
- **Hierarchical Merging**: Intelligent deep merging with `defu`

### HTTP Client System (`src/infrastructure/http/UnJSHttpClient.ts`)

- **Advanced Caching**: Intelligent cache management with TTL
- **Request Retrying**: Configurable retry strategies with backoff
- **Performance Metrics**: Request timing, cache hit rates, error tracking
- **GraphQL Support**: Dedicated GraphQL query execution
- **File Operations**: Upload/download with progress tracking
- **Batch Processing**: Concurrent request execution

### CLI Framework (`src/infrastructure/cli/UnJSCLI.ts`)

- **Modern Interface**: `citty` for rich CLI with auto-completion
- **Interactive Help**: Contextual help with examples and usage
- **Plugin Architecture**: Extensible command system
- **Shell Integration**: Bash completion generation
- **Documentation**: Automatic Markdown docs from command definitions

### WebSocket Server (`src/infrastructure/websocket/UnJSWebSocket.ts`)

- **High Performance**: `unws` for optimized WebSocket handling
- **Room Management**: Advanced room system with authentication
- **Message Validation**: Integrated validation for all message types
- **Rate Limiting**: Per-client rate limiting with sliding windows
- **Real-time Features**: Chat, notifications, live collaboration

### Routing System (`src/infrastructure/router/UnJSRouter.ts`)

- **Dual Routing**: H3 router + `unrouter` for maximum flexibility
- **Middleware Chain**: Ordered middleware execution with context passing
- **Auto-validation**: Request/response validation integration
- **Route Caching**: Built-in caching with TTL and key generation
- **REST Resources**: Automatic CRUD endpoint generation
- **OpenAPI Generation**: Automatic API documentation

### Development Server (`src/infrastructure/server/UnJSDevServer.ts`)

- **Hot Reload**: `listhen` for advanced development features
- **File Watching**: Automatic restart on source changes
- **Dev Tools**: Built-in metrics, health checks, and debugging endpoints
- **Performance Monitoring**: Real-time server statistics
- **Live Configuration**: Configuration reloading without restart

### UnJS Package Utilization

The project uses **22+ UnJS packages** including:
- `citty`, `consola`, `defu`, `destr`, `dotenv`, `execa`
- `jiti`, `listhen`, `magicast`, `mlly`, `nanoid`, `nanotar`
- `node-fetch-native`, `nypm`, `ofetch`, `ohash`, `pathe`
- `pkg-types`, `scule`, `serve-placeholder`, `std-env`
- `ufo`, `unbuild`, `unconfig`, `uncrypto`, `unenv`
- `unhead`, `unimport`, `unrouter`, `unstorage`, `untyped`, `unws`

## Microservices & Enterprise Architecture

### Service Registry & Discovery (`src/infrastructure/microservices/ServiceRegistry.ts`)
- **Service Discovery**: Automatic service registration and health monitoring
- **Load Balancing**: Round-robin, least-connections, weighted, and IP-hash strategies
- **Circuit Breakers**: Automatic failure detection with configurable thresholds
- **Health Monitoring**: Continuous health checks with automatic node recovery
- **Metrics Collection**: Performance monitoring with connection and latency tracking

### Message Broker System (`src/infrastructure/microservices/MessageBroker.ts`)
- **Event-Driven Architecture**: Pub/sub messaging with topic-based routing
- **Event Sourcing**: Complete event store with stream management and replay capabilities
- **Saga Pattern**: Distributed transaction management with automatic compensation
- **Dead Letter Queues**: Failed message handling with retry mechanisms
- **Queue Management**: Priority queues, TTL, and statistics tracking

### Service Mesh (`src/infrastructure/microservices/ServiceMesh.ts`)
- **Traffic Management**: Advanced routing with weighted traffic splitting
- **Security Policies**: mTLS, RBAC, and network security policies
- **Observability**: Distributed tracing with request correlation
- **Middleware Pipeline**: Authentication, rate limiting, metrics, and logging
- **Fault Tolerance**: Circuit breakers, retries, and timeout policies

### Multi-Tenant Architecture (`src/infrastructure/multitenancy/MultiTenantManager.ts`)
- **Tenant Isolation**: Shared, hybrid, and dedicated isolation levels
- **Resource Management**: Auto-scaling with quota enforcement and billing integration
- **Migration Tools**: Automated tenant migrations with rollback capabilities
- **Compliance Support**: GDPR, SOC2, HIPAA, and PCI compliance frameworks
- **Billing Integration**: Usage tracking with overage handling and multiple billing cycles

### Advanced Analytics (`src/infrastructure/analytics/AdvancedAnalytics.ts`)
- **Real-time Metrics**: Live data streaming with configurable time granularities
- **Query Engine**: Flexible analytics with filters, aggregations, and time-series analysis
- **Predictive Models**: Machine learning for forecasting and anomaly detection
- **Report Generation**: Automated report creation with multiple export formats
- **Alert System**: Intelligent alerting with configurable thresholds and channels

### Redis Cluster Manager (`src/infrastructure/cache/RedisClusterManager.ts`)
- **Distributed Caching**: Consistent hashing with automatic node discovery
- **Cache Policies**: Intelligent eviction strategies with TTL management
- **Distributed Locking**: Coordination primitives with auto-renewal capabilities
- **Performance Monitoring**: Cache hit rates, latency tracking, and throughput metrics
- **Failover Management**: Automatic failover with circuit breaker integration

### Enterprise API Gateway (`src/infrastructure/gateway/APIGateway.ts`)
- **Centralized Management**: Single entry point for all API requests with intelligent routing
- **Authentication & Authorization**: Multi-scheme auth support (Bearer, API Key, OAuth2, Basic)
- **Rate Limiting**: Configurable rate limiting per client, IP, user, and endpoint
- **Response Caching**: Intelligent caching with cache key generation and TTL management
- **Request/Response Transformation**: Middleware for request modification and response filtering
- **Analytics & Monitoring**: Comprehensive API usage analytics and performance monitoring
- **Client Management**: API key management with quota enforcement and usage tracking
- **Health Integration**: Integration with service mesh for health-aware routing

### Advanced AI Manager (`src/infrastructure/ai/AdvancedAIManager.ts`)
- **Multi-Provider Support**: OpenAI, Anthropic, Google, Azure with intelligent routing
- **Cost Optimization**: Provider selection based on cost, latency, and quality metrics
- **Rate Limiting**: Provider-aware rate limiting with automatic failover
- **Intelligent Caching**: Response caching with cache invalidation strategies
- **Model Management**: Dynamic model selection with capability matching
- **Usage Analytics**: Comprehensive tracking of AI usage, costs, and performance

## Advanced Enterprise Features

### AI and Machine Learning Integration

#### Infrastructure Components
1. **Advanced LangChain Service**: Conversational AI with memory and context management
2. **Vector Database**: Qdrant for storing and searching embeddings with collections and filtering
3. **Embedding Service**: OpenAI text-embedding-3-small model with batch processing
4. **NLP Service**: OpenAI GPT-4 for natural language processing and command interpretation
5. **RAG Service**: Retrieval-Augmented Generation with source attribution and confidence scoring
6. **ML Prediction Service**: Time-series analysis and predictive modeling for task completion
7. **AI Insight Service**: Advanced analytics and productivity insights generation
8. **Cache Layer**: Multi-level caching with intelligent invalidation and warming

### AI-Powered GraphQL Operations

#### Queries
- `searchTodos`: Semantic search across user's todos
- `findSimilarTodos`: Find todos similar to a specific todo
- `suggestTodos`: AI-powered task suggestions based on user patterns
- `askAboutTodos`: Ask questions about your todos using natural language
- `getUserInsights`: Get AI-generated insights about productivity patterns
- `predictCompletionTime`: Estimate task completion time based on historical data

#### Mutations
- `executeNLPCommand`: Process natural language commands
  - Examples: "Create a todo to buy groceries tomorrow with high priority"
  - Supports: create, update, complete, delete, and list actions
- `createTodoWithAI`: Create todos with AI-suggested priority and completion time
- `createTodosFromSuggestions`: Batch create todos from AI suggestions

### AI Configuration
Set these environment variables for AI features:
```bash
# OpenAI Configuration
OPENAI_API_KEY=your-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536

# Qdrant Configuration  
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=optional-api-key

# Enable/Disable AI
AI_ENABLED=true
```

## Real-time Features

### WebSocket Subscriptions
- Todo updates and completion notifications
- Real-time collaboration features
- User presence tracking
- Live todo list changes

### Subscription Examples
```graphql
subscription TodoUpdates {
  todoUpdated {
    id
    title
    status
    updatedAt
  }
}

subscription CollaborationEvents {
  collaborationEvent {
    type
    userId
    todoId
    timestamp
  }
}
```

## Monitoring and Observability

### Health Checks
- `/health` - Basic health check
- `/health/ready` - Readiness probe
- `/health/detailed` - Comprehensive system health

### Metrics and Monitoring
- `/metrics` - System metrics
- `/metrics/prometheus` - Prometheus-compatible metrics
- OpenTelemetry distributed tracing
- Performance monitoring with custom metrics

### Key Performance Indicators
- GraphQL query complexity analysis
- Database connection pooling metrics
- Cache hit/miss rates
- AI service response times
- WebSocket connection health

## Development Guidelines

### Adding New Features
1. Start with domain model (aggregate, value objects)
2. Define repository interface in domain layer
3. Implement repository in infrastructure layer
4. Create command and handler in application layer
5. Expose via GraphQL mutation/query in API layer
6. Add appropriate DataLoader if needed
7. Consider AI integration opportunities
8. **Always run `bun run check:types` before committing**

### Enterprise Architecture Development
When working with the advanced enterprise features:

#### Microservices Development
- **Service Registration**: All new services should register with the ServiceRegistry
- **Event Publishing**: Use MessageBroker for all inter-service communication
- **Health Checks**: Implement health endpoints for service mesh integration
- **Circuit Breakers**: Wrap external service calls with circuit breaker patterns
- **Distributed Tracing**: Ensure all operations include trace propagation

#### Multi-Tenant Development
- **Tenant Context**: Always work within a tenant context using MultiTenantManager.createContext()
- **Resource Isolation**: Respect tenant isolation levels (shared, hybrid, dedicated)
- **Usage Tracking**: Track resource usage for billing and quota enforcement
- **Data Partitioning**: Ensure proper data isolation based on tenant configuration

#### Caching Strategy
- **Cache Policies**: Apply appropriate cache policies based on data access patterns
- **Distributed Locks**: Use RedisClusterManager for coordination across services
- **Cache Invalidation**: Follow tag-based invalidation strategies
- **Performance Monitoring**: Monitor cache hit rates and adjust policies accordingly

#### Analytics Integration
- **Metrics Collection**: Use AdvancedAnalytics.recordMetric() for business metrics
- **Custom Queries**: Create analytics queries for new data insights
- **Real-time Data**: Leverage real-time data streams for live dashboards
- **Predictive Models**: Consider ML opportunities for new feature predictions

### Code Organization Principles
- Keep domain logic in aggregates, not in GraphQL resolvers
- Use commands for all state-changing operations
- Repository implementations should only handle data access
- GraphQL layer should be thin, delegating to application layer
- AI services should be event-driven and asynchronous
- Cache invalidation should follow domain events

### Type Safety Requirements
- Leverage Pothos for GraphQL type generation
- Use Prisma's generated types for database operations
- Define explicit types for all command/query parameters
- Never use `any` types - use proper generics instead
- Import types using `type` keyword when appropriate (e.g., `import type { Span }`)

## Common Development Issues

### TypeScript Compilation
- The project is in active modernization with some remaining TypeScript errors
- Always check `bun run check:types` before making changes
- Federation components are currently simplified (placeholder implementations)
- Date objects need `.toISOString()` when passing to domain constructors

### Common Type Issues and Solutions
- **Import types properly**: Use `import type { Type }` for type-only imports to avoid circular dependencies
- **Domain constructors**: Always pass properly formatted data (e.g., dates as ISO strings)
- **Optional parameters**: Use `undefined` instead of `null` for consistency
- **Enum values**: Use exact casing from enum definitions (e.g., `Priority.medium`, not `Priority.Medium`)
- **GraphQL resolvers**: Let Pothos handle type generation - don't manually type resolvers

### Performance Considerations
- Use DataLoaders for any database queries in GraphQL resolvers
- AI operations are cached - check cache invalidation logic
- Database queries should go through repository pattern
- Complex queries should use query complexity analysis

### AI Feature Development
- Embeddings are generated automatically via domain events
- Vector searches are user-scoped for security
- NLP commands follow specific parsing patterns
- RAG responses include source attribution

## Testing

### Performance Testing
The project includes trace-based performance testing:
```bash
# Run performance tests (when test infrastructure is completed)
bun test src/tests/performance/
```

### Testing Guidelines
- Domain value objects use specific enum values (e.g., `Priority.medium` not `Priority.Medium`)
- Use `undefined` instead of `null` for optional parameters
- Performance tests require specific trace expectations

## Environment Setup

1. Create a `.env` file in the project root
2. Configure the following essential environment variables:
   ```bash
   # Database
   DATABASE_URL="postgresql://user:password@localhost:5432/pothos_todo"
   
   # Authentication
   SESSION_SECRET="your-session-secret"
   GOOGLE_CLIENT_ID="your-google-client-id"
   GOOGLE_CLIENT_SECRET="your-google-client-secret"
   GITHUB_CLIENT_ID="your-github-client-id"
   GITHUB_CLIENT_SECRET="your-github-client-secret"
   
   # AI Features (Optional)
   OPENAI_API_KEY="your-openai-api-key"
   OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
   OPENAI_EMBEDDING_DIMENSIONS="1536"
   QDRANT_URL="http://localhost:6333"
   AI_ENABLED="true"
   
   # Server
   PORT="4000"
   NODE_ENV="development"
   ```
3. Run `bun run services:up` to start all services
4. Run `bun run db:migrate` to initialize database
5. Run `bun run dev` to start development server

## Production Deployment

### Build Process
- Uses `tsdown` for optimized TypeScript compilation
- Build artifacts go to `dist/` directory
- Production build: `bun run build:prod`

### Service Dependencies
- **Primary Services**: PostgreSQL database, Redis Cluster, Qdrant vector database
- **External APIs**: OpenAI API for AI features, Anthropic API for alternative AI provider
- **Infrastructure**: Service registry, message broker, API gateway
- **Monitoring**: OpenTelemetry collector, Prometheus metrics, alerting system

### Enterprise Deployment Architecture
- **Microservices Cluster**: Service registry with load balancing and failover
- **Multi-Tenant Infrastructure**: Tenant isolation with resource management
- **Distributed Caching**: Redis Cluster with consistent hashing
- **API Gateway**: Centralized entry point with authentication and rate limiting
- **Analytics Pipeline**: Real-time data processing with automated reporting
- **AI/ML Services**: Multi-provider AI routing with cost optimization

### Monitoring & Observability
- **Distributed Tracing**: OpenTelemetry with service mesh integration
- **Metrics Collection**: Prometheus-compatible metrics with custom business KPIs
- **Health Monitoring**: Comprehensive health checks across all service tiers
- **Analytics Dashboard**: Real-time operational and business intelligence
- **Alert Management**: Intelligent alerting with escalation policies
- **Performance Monitoring**: Cache hit rates, response times, and throughput tracking

## Architecture Highlights

### Advanced Caching Strategy
- Intelligent cache warming based on usage patterns
- Multi-strategy caching (cache, static, simplified, disabled)
- Tag-based invalidation with dependency tracking
- Performance analytics with hit/miss rates

### Enterprise Security
- Advanced rate limiting (per-endpoint, per-user, global)
- Content Security Policy with GraphQL compatibility
- Request validation and sanitization
- Audit logging for all mutations

### Microservices Readiness
- Federation gateway architecture (currently simplified)
- Service discovery and health monitoring capabilities
- Load balancing preparation
- Distributed tracing across services

## Important Notes

- Server runs on port 4000 by default (configurable)
- Hot reload enabled in development mode
- GraphQL code generation runs automatically via Pothos
- All async operations use Bun's optimized runtime
- Federation support is prepared but currently uses placeholder implementations
- The project prioritizes type safety - compilation errors should be resolved before deployment

## Quick Reference

### Most Common Development Tasks
```bash
# Start development with hot reload
bun run dev

# Check types before committing (CRITICAL)
bun run check:types

# Database workflow after schema changes
bun run db:generate && bun run db:migrate

# Start all services (PostgreSQL + Qdrant)
bun run services:up
```

### Import Path Aliases
The project uses the `@/*` alias for the `src` directory:
```typescript
import { Todo } from '@/domain/aggregates/Todo.js';
```

### CLI Access
The project includes a comprehensive CLI:
```bash
bun run cli help
```

### Testing
Performance tests are located in `src/tests/performance/`. Run tests with:
```bash
bun test src/tests/performance/
```

## Refactoring and Code Quality

### Base Classes for Code Reuse
The project uses base classes to eliminate code duplication and enforce consistent patterns:

#### SingletonService Pattern
All infrastructure services extend from base singleton classes:
```typescript
// For synchronous services
export class MyService extends SingletonService<MyService> {
  protected constructor() {
    super();
  }
  
  static getInstance(): MyService {
    return super.getInstance();
  }
}

// For services requiring async initialization
export class VectorStore extends AsyncSingletonService<VectorStore> {
  static async getInstance(): Promise<VectorStore> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }
}
```

#### BaseRepository Pattern
All repositories extend BaseRepository for consistent CRUD operations:
```typescript
export class UserRepository extends BaseRepository<User, PrismaUser> {
  protected getModelName(): string {
    return 'user';
  }
  
  protected mapToDomain(data: PrismaUser): User {
    return new User(data.id, data.email, data.name);
  }
}
```

#### BaseAggregate Pattern
Domain aggregates extend BaseAggregate for automatic timestamp and version management:
```typescript
export class Todo extends BaseAggregate {
  update(updates: { title?: string; priority?: Priority }): void {
    const hasChanges = this.updateFields(updates);
    if (hasChanges) {
      this.validate();
      this.addDomainEvent(new TodoUpdated(this.id, updates));
    }
  }
  
  protected validate(): void {
    this.ensureNotEmpty(this._title, 'title');
    this.ensureInRange(this._priority, 0, 4, 'priority');
  }
}
```

### GraphQL Middleware
Use composable middleware for authentication and authorization:
```typescript
// Simple authentication
const resolver = authenticated(async (parent, args, context) => {
  // context.user is guaranteed to exist
  return todoService.create(context.user.id, args.input);
});

// With permissions and rate limiting
const adminResolver = compose(
  authenticated,
  withPermissions(['admin']),
  rateLimit({ window: 60000, max: 10 })
)(resolver);

// With ownership check
const ownerResolver = ownsResource({
  getOwnerId: async (args) => {
    const todo = await todoService.findById(args.id);
    return todo?.userId;
  }
})(resolver);
```

### Cache Management
Use centralized cache invalidation helpers:
```typescript
// Automatic cache invalidation
const mutation = withCacheInvalidation(
  CachePatterns.TODO,
  (result) => ({ entityId: result.id, userId: result.userId })
)(resolver);

// Batch invalidation
await batchInvalidate([
  { pattern: CachePatterns.TODO, data: { entityId: todo.id } },
  { pattern: CachePatterns.USER, data: { userId } }
]);
```

### DataLoader Factory
Create DataLoaders using the factory pattern:
```typescript
const loaders = {
  users: createBatchLoader(prisma, { modelName: 'user' }),
  todosByUser: createRelationLoader(prisma, {
    modelName: 'todo',
    relationField: 'userId',
    orderBy: { createdAt: 'desc' }
  })
};
```

### Refactoring Tools
The project includes automated refactoring tools:

```bash
# Analyze codebase for refactoring opportunities
bun run refactor:analyze

# Preview migration changes (dry run)
bun run refactor:migrate:dry

# Apply migrations
bun run refactor:migrate

# Migrate specific patterns
bun scripts/migrate-to-base-classes.ts --type=singleton --path=src/infrastructure
```

For detailed refactoring guidelines, see:
- `REFACTORING_BEST_PRACTICES.md` - Best practices for using new patterns
- `scripts/MIGRATION_SCRIPTS_README.md` - Guide for using migration scripts
- `examples/migrations/` - Migration examples for different patterns

## Working with AR/VR Features
The project includes AR/VR capabilities through the infrastructure layer. When implementing AR/VR features:
- Use the AR/VR manager services in `src/infrastructure/ar/` and `src/infrastructure/vr/`
- Follow the existing patterns for real-time data synchronization
- Ensure WebSocket connections are properly managed for low-latency requirements