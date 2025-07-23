# Local Federation Testing Guide

This guide explains how to run and test the GraphQL federation setup locally without Hive credentials.

## Prerequisites

1. Ensure PostgreSQL is running:
   ```bash
   bun run db:up
   ```

2. Run database migrations if needed:
   ```bash
   bun run db:migrate
   ```

3. Generate Prisma client:
   ```bash
   bun run db:generate
   ```

## Running the Federation

### Quick Start (Recommended)

Run all subgraphs and the development gateway with a single command:

```bash
bun run federation:dev
```

This will:
- Clean up any existing processes on the federation ports
- Start all three subgraphs (user, todo, AI)
- Wait for subgraphs to be healthy
- Start the development gateway
- Provide links to access each service

### Manual Start

If you prefer to run each service in separate terminals:

```bash
# Terminal 1: User Subgraph
bun run subgraph:user

# Terminal 2: Todo Subgraph  
bun run subgraph:todo

# Terminal 3: AI Subgraph
bun run subgraph:ai

# Terminal 4: Development Gateway
bun run gateway:dev
```

## Accessing the Services

Once running, you can access:

- **Federation Gateway**: http://localhost:4000/graphql
- **User Subgraph**: http://localhost:4001/graphql
- **Todo Subgraph**: http://localhost:4002/graphql
- **AI Subgraph**: http://localhost:4003/graphql

## Testing Queries

### Basic Federation Query

Test that federation is working by querying across subgraphs:

```graphql
query TestFederation {
  # From User subgraph
  me {
    id
    email
    # From Todo subgraph (through federation)
    todos {
      id
      title
      status
    }
  }
}
```

### User Operations

```graphql
# Get current user
query GetMe {
  me {
    id
    email
    createdAt
  }
}

# Get user by ID
query GetUser($id: ID!) {
  user(id: $id) {
    id
    email
    todos {
      id
      title
    }
  }
}
```

### Todo Operations

```graphql
# List todos
query ListTodos {
  todos {
    id
    title
    description
    status
    priority
    dueDate
    user {
      id
      email
    }
  }
}

# Create a todo
mutation CreateTodo($input: CreateTodoInput!) {
  createTodo(input: $input) {
    id
    title
    status
  }
}
```

### AI Operations (if enabled)

```graphql
# Search todos semantically
query SearchTodos($query: String!) {
  searchTodos(query: $query) {
    id
    title
    similarity
  }
}

# Get AI suggestions
query GetSuggestions {
  suggestTodos {
    title
    description
    priority
    estimatedTime
  }
}
```

## Development Workflow

1. **Making Schema Changes**:
   - Edit the subgraph schema files
   - The development gateway will automatically pick up changes
   - Refresh GraphiQL to see updated schema

2. **Adding New Subgraphs**:
   - Create a new subgraph in `src/subgraphs/`
   - Add it to the `subgraphs` array in `src/gateway/dev-gateway.ts`
   - Update the test script if needed

3. **Debugging**:
   - Each subgraph logs independently
   - Check individual subgraph endpoints to isolate issues
   - The gateway provides detailed error messages

## Architecture Overview

```
┌─────────────────────┐
│  GraphQL Client     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Dev Gateway :4000  │ (Schema Stitching)
└──────────┬──────────┘
           │
     ┌─────┴─────┬─────────────┐
     ▼           ▼             ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│User:4001│ │Todo:4002│ │ AI:4003 │
└─────────┘ └─────────┘ └─────────┘
```

## Differences from Production

The development gateway differs from the production Hive Gateway:

1. **Schema Stitching**: Uses `@graphql-tools/stitch` instead of Hive's federation
2. **No CDN**: Schemas are fetched directly from subgraphs
3. **No Monitoring**: Hive's built-in monitoring is not available
4. **Simplified Merging**: Basic type merging without advanced federation features

## Troubleshooting

### Port Already in Use

If you get a "port already in use" error:

```bash
# Find and kill processes on federation ports
lsof -ti:4000 -ti:4001 -ti:4002 -ti:4003 | xargs kill -9
```

### Subgraph Not Responding

1. Check if the subgraph is running
2. Verify the port number in the error message
3. Check subgraph logs for errors
4. Ensure database is accessible

### Schema Stitching Errors

1. Verify all subgraphs are running
2. Check that type definitions match across subgraphs
3. Ensure @key directives are properly defined
4. Check merge configurations in dev-gateway.ts

## Next Steps

Once you've verified the federation works locally:

1. Obtain Hive Platform credentials
2. Configure production gateway with Hive
3. Deploy subgraphs to your infrastructure
4. Update gateway configuration for production URLs