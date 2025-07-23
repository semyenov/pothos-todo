# 🚀 Quick Reference - Pothos Todo API

## Essential Commands

```bash
# Development
bun run dev                    # Start dev server
bun run check:types           # Type check (run before commit!)
bun test                      # Run tests

# Database
bun run db:migrate            # Run migrations
bun run db:generate           # Generate Prisma client
bun run db:studio             # Open Prisma Studio

# Code Generation
bun run generate singleton EmailService --with-tests
bun run generate repository Product
bun run generate aggregate Order
bun run generate middleware requiresAdmin

# Refactoring Tools
bun run refactor:analyze      # Find refactoring opportunities
bun run refactor:migrate:dry  # Preview migrations
bun run refactor:migrate      # Apply migrations
```

## Base Class Cheat Sheet

### SingletonService
```typescript
class MyService extends SingletonService<MyService> {
  protected constructor() { super(); }
  static getInstance(): MyService { return super.getInstance(); }
}
```
**Snippet:** `singleton` + Tab

### AsyncSingletonService
```typescript
class MyService extends AsyncSingletonService<MyService> {
  static async getInstance(): Promise<MyService> {
    return super.getInstanceAsync(async (i) => await i.init());
  }
}
```
**Snippet:** `asyncsingleton` + Tab

### BaseRepository
```typescript
class UserRepo extends BaseRepository<User, PrismaUser> {
  protected getModelName(): string { return 'user'; }
  protected mapToDomain(data: PrismaUser): User { /*...*/ }
}
```
**Snippet:** `repository` + Tab

### BaseAggregate
```typescript
class Todo extends BaseAggregate {
  update(updates: {...}): void {
    if (this.updateFields(updates)) {
      this.validate();
      this.addDomainEvent(new TodoUpdated(...));
    }
  }
}
```
**Snippet:** `aggregate` + Tab

## GraphQL Patterns

### Authentication
```typescript
// Simple auth
authenticated(resolver)

// With permissions
withPermissions(['admin'])(resolver)

// Composed
compose(
  authenticated,
  withPermissions(['admin']),
  rateLimit({ window: 60000, max: 10 })
)(resolver)
```
**Snippets:** `authresolver`, `composedresolver`

### Cache Invalidation
```typescript
withCacheInvalidation(
  CachePatterns.TODO,
  (result) => ({ entityId: result.id })
)(resolver)
```
**Snippet:** `cacheinvalidation`

### DataLoaders
```typescript
createBatchLoader(prisma, { modelName: 'user' })
createRelationLoader(prisma, { 
  modelName: 'todo', 
  relationField: 'userId' 
})
```
**Snippet:** `dataloader`

## Error Handling

```typescript
// Domain errors
throw new NotFoundError('Todo', id);
throw new ValidationError('Title required');
throw new ConflictError('Email exists');

// Wrap risky ops
await errorHandler.handleAsync(
  async () => await riskyOp(),
  { operation: 'riskyOp' }
);
```
**Snippet:** `errorhandler`

## Testing Patterns

```typescript
// Always clear singletons
beforeEach(() => {
  SingletonService.clearAllInstances();
});

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: mock(() => null),
    create: mock(() => ({}))
  }
};
```
**Snippets:** `repotest`, `aggregatetest`

## Git Workflow

```bash
# Setup hooks (one time)
bun run hooks:setup

# Commit format
git commit -m "feat: add new feature"
git commit -m "fix(auth): resolve login issue"
git commit -m "refactor: migrate to BaseRepository"

# Skip hooks (emergency only)
git commit --no-verify
```

## VS Code Snippets

| Snippet | Creates |
|---------|---------|
| `singleton` | SingletonService |
| `asyncsingleton` | AsyncSingletonService |
| `repository` | BaseRepository |
| `aggregate` | BaseAggregate |
| `authresolver` | Authenticated resolver |
| `composedresolver` | Composed middleware |
| `cacheinvalidation` | Cache invalidation |
| `dataloader` | DataLoader |
| `domainevent` | Domain event |
| `errorhandler` | Error handling |
| `repotest` | Repository test |
| `aggregatetest` | Aggregate test |

## File Structure

```
src/
├── domain/
│   ├── aggregates/     # BaseAggregate implementations
│   ├── events/         # Domain events
│   └── core/           # BaseAggregate
├── infrastructure/
│   ├── core/           # SingletonService, BaseRepository
│   ├── repositories/   # Repository implementations
│   └── services/       # Service implementations
├── api/
│   ├── middleware/     # GraphQL middleware
│   ├── helpers/        # Cache invalidation
│   └── dataloaders/    # DataLoader factory
└── tests/
    ├── unit/           # Unit tests
    ├── integration/    # Integration tests
    └── performance/    # Performance benchmarks
```

## Common Issues

**"Cannot find module"**
```bash
bun run db:generate  # Regenerate Prisma client
```

**"Type error in resolver"**
```typescript
// Ensure context type is imported
import type { Context } from '@/api/context';
```

**"Singleton already exists"**
```typescript
// Clear in tests
SingletonService.clearAllInstances();
```

**"Repository method not found"**
```typescript
// Check if using correct base method
await this.findById(id);  // ✅
await this.getById(id);   // ❌
```

---

**Remember:** 
- 🔍 `bun run check:types` before committing
- 🚀 Use code generation for new files
- 📝 Follow the patterns for consistency
- ✅ Write tests for custom logic