# GraphQL Federation with Hive Gateway

This document describes the GraphQL federation setup for the Pothos Todo API using Hive Gateway.

## Overview

The application is split into three federated subgraphs:
- **User Subgraph** (port 4001): Handles user authentication and profile management
- **Todo Subgraph** (port 4002): Manages todos and todo lists
- **AI Subgraph** (port 4003): Provides AI-powered features like search and suggestions

These subgraphs are unified by the Hive Gateway (port 4000) which provides a single GraphQL endpoint.

## Quick Start

### Development Mode (No Hive Credentials Required)

Run the federation setup locally without Hive Platform credentials:

```bash
# Start all services with development gateway
bun run federation:docker:dev

# Or start services individually
bun run services:up  # Start PostgreSQL, Redis, Qdrant
bun run federation:dev  # Start gateway and subgraphs locally (non-Docker)
```

**Note**: The `federation:docker:dev` command uses a special script that ensures the correct database URLs are used in the Docker environment, overriding any localhost values from your local .env file.

### Production Mode (Requires Hive Credentials)

For production deployment with Hive Platform:

```bash
# Set Hive credentials in .env
HIVE_CDN_ENDPOINT=your-endpoint
HIVE_CDN_KEY=your-key
HIVE_TOKEN=your-token

# Start federation
bun run federation:docker
```

## Architecture

### Subgraph Structure

Each subgraph is self-contained with its own:
- Schema definition using Pothos
- GraphQL server using Yoga
- Database access through Prisma
- Docker container for isolation

### Federation Keys

Types are federated using the `@key` directive:

```typescript
// User type owned by user subgraph
builder.prismaObject('User', {
  directives: {
    key: { fields: 'id' },
  },
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    // ...
  }),
});
```

### Development Gateway

The development gateway (`src/gateway/dev-gateway.ts`) uses schema stitching to combine subgraphs without requiring Hive credentials. This is ideal for local development.

### Production Gateway

The production setup uses the official Hive Gateway Docker image which provides:
- Schema composition
- Query planning and optimization
- Distributed tracing
- Performance monitoring

## Docker Setup

### Development Compose File

The `docker-compose.dev.yml` provides development overrides:
- Volume mounts for hot reloading
- Development gateway instead of Hive Gateway
- Debug logging enabled
- Docker-specific environment configuration

### Environment Configuration

Docker containers use `.env.docker` which configures:
- Container names instead of localhost (e.g., `redis` instead of `localhost`)
- Service discovery within Docker network
- Proper database URLs

## Testing Federation

### Basic Query
```graphql
{
  users {
    id
    email
    name
  }
}
```

### Cross-Subgraph Query
```graphql
{
  users {
    id
    email
    todos {
      id
      title
      status
    }
  }
}
```

### AI Features Query
```graphql
{
  searchTodos(query: "important") {
    id
    title
    similarity
  }
  
  suggestTodos(limit: 3) {
    title
    description
    priority
  }
}
```

## Common Issues

### Connection Refused Errors
If you see "ConnectionRefused" errors:
1. Ensure all services are running: `docker ps`
2. Use `bun run federation:docker:dev` which handles environment variables correctly
3. Verify service names in docker-compose.yml

### Database Connection to Localhost
If you see "Can't reach database server at localhost:5432":
1. Your local .env file has DATABASE_URL pointing to localhost
2. Use `bun run federation:docker:dev` which overrides this automatically
3. Or manually set: `DATABASE_URL="postgresql://postgres:password@postgres:5432/pothos_todo"`

### Schema Composition Errors
If schemas fail to compose:
1. Ensure no circular dependencies between subgraphs
2. Check that all `@key` fields are properly exposed
3. Verify federation directives are compatible with v1

### Database Connection Issues
If database connections fail:
1. Ensure PostgreSQL container is healthy
2. Check DATABASE_URL uses container name (`postgres`) not `localhost`
3. Verify database migrations have run

## Development Workflow

1. **Make Schema Changes**: Edit subgraph schemas in `src/subgraphs/*/schema.ts`
2. **Test Locally**: Changes are hot-reloaded with `--watch` flag
3. **Verify Federation**: Test queries through gateway at `http://localhost:4000/graphql`
4. **Deploy**: Build production images and deploy with Hive credentials

## Monitoring

### Health Checks
- Gateway: `http://localhost:4000/health`
- User Subgraph: `http://localhost:4001/graphql?query={__typename}`
- Todo Subgraph: `http://localhost:4002/graphql?query={__typename}`
- AI Subgraph: `http://localhost:4003/graphql?query={__typename}`

### GraphiQL Interfaces
Each service provides a GraphiQL interface:
- Gateway: `http://localhost:4000/graphql`
- User: `http://localhost:4001/graphql`
- Todo: `http://localhost:4002/graphql`
- AI: `http://localhost:4003/graphql`

## Next Steps

1. **Configure Hive Platform**: Sign up at https://graphql-hive.com for production deployment
2. **Add Monitoring**: Configure OpenTelemetry for distributed tracing
3. **Implement Caching**: Add Redis caching at the gateway level
4. **Add CI/CD**: Automate schema validation and deployment