# Developer Guide - Pothos Todo API

This guide covers the standardized patterns and tools available for developing in this codebase.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Code Generation](#code-generation)
3. [Base Class Patterns](#base-class-patterns)
4. [GraphQL Development](#graphql-development)
5. [Testing Guidelines](#testing-guidelines)
6. [Refactoring Tools](#refactoring-tools)
7. [VS Code Integration](#vs-code-integration)
8. [Git Hooks](#git-hooks)

## Quick Start

### Setting Up Your Environment

```bash
# Install dependencies
bun install

# Set up git hooks for code quality
bun run hooks:setup

# Start services (PostgreSQL + Qdrant)
bun run services:up

# Run database migrations
bun run db:migrate

# Start development server
bun run dev
```

### Essential Commands

```bash
# Type checking (run before commits)
bun run check:types

# Analyze code for refactoring opportunities
bun run refactor:analyze

# Generate new components from templates
bun run generate <type> <name>

# Run tests
bun test
```

## Code Generation

The project includes a powerful code generator that creates boilerplate following our established patterns.

### Generate a Singleton Service

```bash
# Basic singleton
bun run generate singleton Email

# Async singleton (for services with async initialization)
bun run generate async-singleton Database

# With tests
bun run generate singleton Email --with-tests
```

### Generate a Repository

```bash
# Creates repository with BaseRepository
bun run generate repository Product

# Custom path
bun run generate repository Product --path src/modules/product/ProductRepository.ts
```

### Generate a Domain Aggregate

```bash
# Creates aggregate with domain events
bun run generate aggregate Order

# This creates:
# - src/domain/aggregates/order.ts
# - src/domain/events/order-events.ts
```

### Generate GraphQL Middleware

```bash
# Creates composable middleware function
bun run generate middleware requiresSubscription
```

## Base Class Patterns

### SingletonService Pattern

For services that should have only one instance:

```typescript
import { SingletonService } from '@/infrastructure/core/SingletonService';

export class CacheService extends SingletonService<CacheService> {
  protected constructor() {
    super();
  }

  static getInstance(): CacheService {
    return super.getInstance();
  }
}
```

**VS Code Snippet:** Type `singleton` and press Tab

### AsyncSingletonService Pattern

For services requiring async initialization:

```typescript
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';

export class VectorStore extends AsyncSingletonService<VectorStore> {
  static async getInstance(): Promise<VectorStore> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    // Async setup
  }
}
```

**VS Code Snippet:** Type `asyncsingleton` and press Tab

### BaseRepository Pattern

All repositories should extend BaseRepository:

```typescript
export class UserRepository extends BaseRepository<User, PrismaUser> {
  protected getModelName(): string {
    return 'user';
  }

  protected mapToDomain(data: PrismaUser): User {
    return new User(data.id, data.email, data.name);
  }

  // Add custom methods
  async findByEmail(email: string): Promise<User | null> {
    const data = await this.getModel().findUnique({ where: { email } });
    return data ? this.mapToDomain(data) : null;
  }
}
```

**VS Code Snippet:** Type `repository` and press Tab

### BaseAggregate Pattern

Domain aggregates with automatic timestamp and version management:

```typescript
export class Todo extends BaseAggregate {
  private _title: string;
  private _priority: Priority;

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

**VS Code Snippet:** Type `aggregate` and press Tab

## GraphQL Development

### Authentication Middleware

Simple authentication check:

```typescript
import { authenticated } from '@/api/middleware/authenticated';

const resolver = authenticated(async (parent, args, context) => {
  // context.user is guaranteed to exist
  return todoService.create(context.user.id, args.input);
});
```

**VS Code Snippet:** Type `authresolver` and press Tab

### Composed Middleware

Multiple middleware combined:

```typescript
import { compose, authenticated, withPermissions, rateLimit } from '@/api/middleware/authenticated';

const resolver = compose(
  authenticated,
  withPermissions(['admin']),
  rateLimit({ window: 60000, max: 100 })
)(async (parent, args, context) => {
  // Your resolver logic
});
```

**VS Code Snippet:** Type `composedresolver` and press Tab

### Cache Invalidation

Automatic cache invalidation after mutations:

```typescript
import { withCacheInvalidation, CachePatterns } from '@/api/helpers/cacheInvalidation';

const mutation = withCacheInvalidation(
  CachePatterns.TODO,
  (result) => ({ entityId: result.id, userId: result.userId })
)(resolver);
```

**VS Code Snippet:** Type `cacheinvalidation` and press Tab

### DataLoader Usage

Create DataLoaders for N+1 query prevention:

```typescript
// In context creation
const loaders = {
  users: createBatchLoader(prisma, { modelName: 'user' }),
  todosByUser: createRelationLoader(prisma, {
    modelName: 'todo',
    relationField: 'userId',
    orderBy: { createdAt: 'desc' }
  })
};

// In resolver
const todos = await context.loaders.todosByUser.load(userId);
```

**VS Code Snippet:** Type `dataloader` and press Tab

## Testing Guidelines

### Repository Tests

```typescript
describe('UserRepository', () => {
  let repository: UserRepository;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: mock(() => null),
        // ... other methods
      }
    };
    repository = new UserRepository(mockPrisma);
  });

  it('should find user by email', async () => {
    const mockUser = { id: '1', email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    
    const result = await repository.findByEmail('test@example.com');
    expect(result?.email).toBe('test@example.com');
  });
});
```

**VS Code Snippet:** Type `repotest` and press Tab

### Aggregate Tests

```typescript
describe('Todo', () => {
  it('should create with domain event', () => {
    const todo = Todo.create('1', 'Test Todo', 'user123');
    
    const events = todo.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(TodoCreated);
  });
});
```

**VS Code Snippet:** Type `aggregatetest` and press Tab

### Singleton Tests

Always clear instances before each test:

```typescript
beforeEach(() => {
  SingletonService.clearAllInstances();
});
```

## Refactoring Tools

### Analyze Codebase

Find opportunities to use base classes:

```bash
# Analyze entire codebase
bun run refactor:analyze

# Analyze specific directory
bun run refactor:analyze src/infrastructure
```

### Migrate to Base Classes

Automatically migrate existing code:

```bash
# Preview changes (dry run)
bun run refactor:migrate:dry

# Apply migrations
bun run refactor:migrate

# Migrate specific type
bun run refactor:migrate --type=singleton
```

### Performance Comparison

Compare performance before and after refactoring:

```bash
# Run benchmarks
bun run refactor:benchmark

# Generate comparison report
bun run refactor:compare
```

## VS Code Integration

### Available Snippets

The project includes VS Code snippets for all patterns:

- `singleton` - SingletonService
- `asyncsingleton` - AsyncSingletonService
- `repository` - BaseRepository
- `aggregate` - BaseAggregate
- `authresolver` - Authenticated resolver
- `composedresolver` - Composed middleware
- `cacheinvalidation` - Cache invalidation
- `dataloader` - DataLoader creation
- `domainevent` - Domain event
- `errorhandler` - Error handling
- `repotest` - Repository test
- `aggregatetest` - Aggregate test

### Recommended Extensions

- **Prisma** - For schema highlighting and formatting
- **GraphQL** - For GraphQL syntax support
- **Error Lens** - To see TypeScript errors inline
- **GitLens** - For better git integration

## Git Hooks

The project includes git hooks for code quality:

### Pre-commit Hook
- Runs TypeScript type checking
- Analyzes for non-compliant patterns
- Warns about code that should use base classes

### Commit Message Hook
- Enforces conventional commit format
- Examples:
  - `feat: add user authentication`
  - `fix(repository): resolve caching issue`
  - `refactor: migrate to BaseRepository`

### Setup

```bash
# Install git hooks
bun run hooks:setup

# Bypass hooks (not recommended)
git commit --no-verify
```

## Best Practices

### DO ✅

1. **Use code generation** for new components
2. **Extend base classes** instead of writing boilerplate
3. **Use middleware composition** for GraphQL resolvers
4. **Run type checks** before committing
5. **Follow the established patterns** for consistency
6. **Write tests** for custom logic
7. **Use VS Code snippets** for faster development

### DON'T ❌

1. **Don't create manual singletons** - use SingletonService
2. **Don't write auth checks in resolvers** - use middleware
3. **Don't manually update timestamps** - BaseAggregate handles it
4. **Don't skip type checking** - it catches errors early
5. **Don't bypass git hooks** without good reason

## Common Patterns

### Error Handling

```typescript
import { NotFoundError, ValidationError } from '@/infrastructure/core/ErrorHandler';

// Throw domain errors
if (!todo) {
  throw new NotFoundError('Todo', id);
}

// Wrap risky operations
const result = await errorHandler.handleAsync(
  async () => await externalApi.call(),
  { operation: 'externalApiCall' }
);
```

### Batch Operations

```typescript
// In repository
async createMany(entities: User[]): Promise<void> {
  await this.batchCreate(entities);
}

// Cache invalidation
await batchInvalidate([
  { pattern: CachePatterns.TODO, data: { entityId: id1 } },
  { pattern: CachePatterns.TODO, data: { entityId: id2 } }
]);
```

### Transaction Support

```typescript
await repository.transaction(async (tx) => {
  await tx.todo.create({ data: todoData });
  await tx.todoList.update({ where: { id }, data: updateData });
});
```

## Getting Help

1. **Check the examples** in `examples/migrations/`
2. **Read the best practices** in `REFACTORING_BEST_PRACTICES.md`
3. **Use the analyzer** to find similar patterns: `bun run refactor:analyze`
4. **Generate from templates** to see the correct pattern

## Contributing

When contributing to this codebase:

1. Use the established patterns and base classes
2. Run `bun run check:types` before committing
3. Add tests for new functionality
4. Follow conventional commit messages
5. Update documentation if adding new patterns

Happy coding! 🚀