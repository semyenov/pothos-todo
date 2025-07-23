# Refactoring Best Practices Guide

This guide provides best practices for using the new refactored patterns and base classes introduced to eliminate code duplication.

## Table of Contents
1. [SingletonService Pattern](#singletonservice-pattern)
2. [BaseRepository Pattern](#baserepository-pattern)
3. [BaseAggregate Pattern](#baseaggregate-pattern)
4. [Error Handling](#error-handling)
5. [GraphQL Middleware](#graphql-middleware)
6. [Cache Management](#cache-management)
7. [DataLoader Usage](#dataloader-usage)
8. [Testing Guidelines](#testing-guidelines)

## SingletonService Pattern

### When to Use
- Infrastructure services that should have only one instance
- Services that manage connections (databases, external APIs)
- Services with expensive initialization

### Best Practices

```typescript
// ✅ GOOD: Simple singleton service
export class ConfigService extends SingletonService<ConfigService> {
  private config: Config;

  protected constructor() {
    super();
    this.config = this.loadConfig();
  }

  static getInstance(): ConfigService {
    return super.getInstance();
  }

  private loadConfig(): Config {
    // Load configuration
  }
}

// ✅ GOOD: Async singleton with initialization
export class DatabaseService extends AsyncSingletonService<DatabaseService> {
  private connection: Connection;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<DatabaseService> {
    return super.getInstanceAsync(async (instance) => {
      await instance.connect();
    });
  }

  private async connect(): Promise<void> {
    this.connection = await createConnection();
  }
}

// ❌ BAD: Don't expose initialization methods
export class BadService extends AsyncSingletonService<BadService> {
  // This should be private!
  public async initialize(): Promise<void> {
    // Initialization logic
  }
}
```

### Testing Singletons

```typescript
describe('MyService', () => {
  beforeEach(() => {
    // Always clear instances in tests
    SingletonService.clearAllInstances();
  });

  it('should maintain singleton instance', () => {
    const instance1 = MyService.getInstance();
    const instance2 = MyService.getInstance();
    expect(instance1).toBe(instance2);
  });
});
```

## BaseRepository Pattern

### When to Use
- All repository implementations
- When you need standard CRUD operations
- When you want consistent error handling

### Best Practices

```typescript
// ✅ GOOD: Focused repository with clear mappings
export class UserRepository extends BaseRepository<User, PrismaUser> {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected getModelName(): string {
    return 'user';
  }

  protected mapToDomain(data: PrismaUser): User {
    return new User(
      data.id,
      data.email,
      data.name,
      data.createdAt,
      data.updatedAt
    );
  }

  protected mapToCreateInput(user: User): any {
    return {
      email: user.email,
      name: user.name,
    };
  }

  protected mapToUpdateInput(user: User): any {
    // Only include fields that can be updated
    return {
      name: user.name,
      updatedAt: user.updatedAt,
    };
  }

  // ✅ GOOD: Add domain-specific methods
  async findByEmail(email: string): Promise<User | null> {
    const data = await this.getModel().findUnique({
      where: { email },
    });
    return data ? this.mapToDomain(data) : null;
  }

  // ✅ GOOD: Use protected helpers for common patterns
  async findActive(): Promise<User[]> {
    return this.findByField('isActive', true, {
      orderBy: { createdAt: 'desc' },
    });
  }
}

// ❌ BAD: Don't bypass the base class methods
export class BadRepository extends BaseRepository<Entity, PrismaEntity> {
  async save(entity: Entity): Promise<void> {
    // Don't reimplement base methods unless absolutely necessary
    await this.prisma.entity.create({ data: entity });
  }
}
```

### Transaction Support

```typescript
// ✅ GOOD: Use transaction helper
export class OrderRepository extends BaseRepository<Order, PrismaOrder> {
  async createWithItems(order: Order, items: OrderItem[]): Promise<void> {
    await this.transaction(async (tx) => {
      // Use tx instead of this.prisma inside transaction
      await tx.order.create({ data: this.mapToCreateInput(order) });
      await tx.orderItem.createMany({
        data: items.map(item => this.mapItemToCreate(item)),
      });
    });
  }
}
```

## BaseAggregate Pattern

### When to Use
- All domain aggregates
- When you need automatic timestamp management
- When you need version tracking
- When you need consistent update patterns

### Best Practices

```typescript
// ✅ GOOD: Proper aggregate with validation
export class Product extends BaseAggregate {
  private _name: string;
  private _price: number;
  private _stock: number;

  constructor(
    id: string,
    name: string,
    price: number,
    stock: number,
    createdAt = new Date(),
    updatedAt = new Date(),
    version = 0
  ) {
    super(id, createdAt, updatedAt, version);
    this._name = name;
    this._price = price;
    this._stock = stock;
    this.validate();
  }

  // ✅ GOOD: Use updateFields for bulk updates
  update(updates: { name?: string; price?: number }): void {
    const hasChanges = this.updateFields(updates);
    
    if (hasChanges) {
      this.validate();
      this.addDomainEvent(new ProductUpdated(this.id, updates, this.version));
    }
  }

  // ✅ GOOD: Implement validation
  protected validate(): void {
    this.ensureNotEmpty(this._name, 'name');
    this.ensureInRange(this._price, 0, 1000000, 'price');
    this.ensureInRange(this._stock, 0, 99999, 'stock');
  }

  // ✅ GOOD: Business logic methods
  adjustStock(quantity: number): void {
    if (this._stock + quantity < 0) {
      throw new Error('Insufficient stock');
    }
    
    this.updateFields({ stock: this._stock + quantity });
    this.addDomainEvent(new StockAdjusted(this.id, quantity, this._stock));
  }
}

// ❌ BAD: Don't manually manage timestamps
export class BadAggregate extends BaseAggregate {
  update(name: string): void {
    this._name = name;
    this._updatedAt = new Date(); // Don't do this! Use updateFields()
  }
}
```

### Using Extensions

```typescript
// ✅ GOOD: Soft-deletable aggregate
export class Article extends SoftDeletableAggregate {
  delete(userId: string): void {
    this.softDelete(new ArticleDeleted(this.id, userId, this.version));
  }

  restore(userId: string): void {
    super.restore(new ArticleRestored(this.id, userId, this.version));
  }
}

// ✅ GOOD: Auditable aggregate
export class Document extends AuditableAggregate {
  update(changes: any, userId: string): void {
    const hasChanges = this.updateFieldsWithAudit(changes, userId);
    if (hasChanges) {
      this.addDomainEvent(new DocumentUpdated(this.id, changes, userId));
    }
  }
}
```

## Error Handling

### Best Practices

```typescript
// ✅ GOOD: Use domain-specific errors
import { NotFoundError, ValidationError, ConflictError } from '@/infrastructure/core/ErrorHandler';

export class TodoService {
  async findById(id: string): Promise<Todo> {
    const todo = await this.repository.findById(id);
    if (!todo) {
      throw new NotFoundError('Todo', id);
    }
    return todo;
  }

  async create(data: CreateTodoDto): Promise<Todo> {
    if (!data.title) {
      throw new ValidationError('Title is required');
    }
    
    const existing = await this.repository.findByTitle(data.title);
    if (existing) {
      throw new ConflictError('Todo with this title already exists');
    }
    
    return this.repository.save(todo);
  }
}

// ✅ GOOD: Wrap risky operations
export class ExternalService {
  private errorHandler = ErrorHandler.getInstance();

  async fetchData(id: string): Promise<Data> {
    return this.errorHandler.handleAsync(
      async () => {
        const response = await fetch(`/api/data/${id}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        return response.json();
      },
      { operation: 'fetchData', resourceId: id }
    );
  }
}

// ❌ BAD: Don't catch and hide errors
export class BadService {
  async process(): Promise<void> {
    try {
      await this.riskyOperation();
    } catch (error) {
      // Don't swallow errors silently!
      console.log('Error occurred');
    }
  }
}
```

## GraphQL Middleware

### Best Practices

```typescript
// ✅ GOOD: Layer middleware appropriately
const resolver = compose(
  rateLimit({ window: 60000, max: 100 }), // Outermost - check rate limit first
  authenticated,                          // Then check authentication
  withPermissions(['admin']),            // Then check permissions
  ownsResource({ getOwnerId })          // Finally check ownership
)(async (parent, args, context) => {
  // Your resolver logic
});

// ✅ GOOD: Use specific middleware for specific needs
builder.mutationField('createTodo', (t) =>
  t.field({
    type: Todo,
    resolve: authenticated(         // Only needs authentication
      withCacheInvalidation(
        CachePatterns.TODO,
        (result) => ({ entityId: result.id })
      )(resolver)
    ),
  })
);

// ✅ GOOD: Create custom middleware for repeated patterns
const requireTodoOwnership = ownsResource({
  getOwnerId: async (args) => {
    const todo = await todoService.findById(args.id);
    return todo?.userId;
  },
  allowAdmin: true,
});

// ❌ BAD: Don't over-middleware simple operations
const overEngineered = compose(
  authenticated,
  withPermissions(['user']), // Redundant - all authenticated users have 'user' permission
  rateLimit({ window: 60000, max: 1000 }), // Too permissive to be useful
)(resolver);
```

## Cache Management

### Best Practices

```typescript
// ✅ GOOD: Use cache patterns consistently
export class TodoMutations {
  async createTodo(input: CreateTodoInput, userId: string): Promise<Todo> {
    const todo = await this.todoService.create(input, userId);
    
    // Use helper for consistent invalidation
    await invalidateTodoCaches(todo, userId);
    
    return todo;
  }

  // ✅ GOOD: Batch invalidation for bulk operations
  async deleteTodos(ids: string[], userId: string): Promise<boolean> {
    const todos = await Promise.all(
      ids.map(id => this.todoService.findById(id))
    );
    
    await this.todoService.deleteMany(ids);
    
    // Batch invalidate
    await batchInvalidate(
      todos.map(todo => ({
        pattern: CachePatterns.TODO,
        data: {
          entityId: todo.id,
          parentId: todo.todoListId,
          userId,
        }
      }))
    );
    
    return true;
  }
}

// ✅ GOOD: Create custom cache patterns
export const CustomCachePatterns = {
  USER_STATS: {
    entity: 'UserStats',
    user: true,
    custom: ['Dashboard'],
  },
  SEARCH_RESULTS: {
    entity: 'Search',
    custom: ['Query'],
  },
};

// ❌ BAD: Don't manually invalidate caches
export class BadService {
  async update(todo: Todo): Promise<void> {
    await this.repository.save(todo);
    
    // Don't do this manually!
    await invalidateCache('Todo', todo.id);
    await invalidateCache('User', todo.userId);
    await invalidateCache('TodoList', todo.listId);
  }
}
```

## DataLoader Usage

### Best Practices

```typescript
// ✅ GOOD: Create loaders in context
export function createContext(req: Request): Context {
  const prisma = new PrismaClient();
  
  return {
    prisma,
    loaders: {
      users: createBatchLoader(prisma, { modelName: 'user' }),
      todos: createBatchLoader(prisma, { modelName: 'todo' }),
      todosByUser: createRelationLoader(prisma, {
        modelName: 'todo',
        relationField: 'userId',
        orderBy: { createdAt: 'desc' },
      }),
    },
  };
}

// ✅ GOOD: Use loaders in resolvers
export const userResolvers = {
  todos: async (parent: User, args, context) => {
    // Batches requests automatically
    return context.loaders.todosByUser.load(parent.id);
  },
  
  todoCount: async (parent: User, args, context) => {
    const todos = await context.loaders.todosByUser.load(parent.id);
    return todos.length;
  },
};

// ✅ GOOD: Prime loaders when you have data
export async function fetchUsersWithTodos(): Promise<User[]> {
  const users = await prisma.user.findMany({
    include: { todos: true },
  });
  
  // Prime the loaders to avoid N+1 queries
  users.forEach(user => {
    context.loaders.users.prime(user.id, user);
    user.todos.forEach(todo => {
      context.loaders.todos.prime(todo.id, todo);
    });
  });
  
  return users;
}

// ❌ BAD: Don't create loaders inside resolvers
export const badResolver = {
  todos: async (parent: User, args, context) => {
    // Creates a new loader each time!
    const loader = createBatchLoader(context.prisma, { modelName: 'todo' });
    return loader.load(parent.id);
  },
};
```

## Testing Guidelines

### Unit Testing Base Classes

```typescript
// ✅ GOOD: Test custom methods, not base functionality
describe('UserRepository', () => {
  let repository: UserRepository;
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = new PrismaClient();
    repository = new UserRepository(prisma);
  });

  // Test custom methods
  it('should find user by email', async () => {
    const mockUser = { id: '1', email: 'test@example.com', name: 'Test' };
    prisma.user.findUnique = jest.fn().mockResolvedValue(mockUser);
    
    const result = await repository.findByEmail('test@example.com');
    
    expect(result).toBeDefined();
    expect(result?.email).toBe('test@example.com');
  });

  // Don't test base class methods - they're already tested
});
```

### Integration Testing

```typescript
// ✅ GOOD: Test the full flow
describe('Todo Creation Flow', () => {
  it('should create todo with proper validation and events', async () => {
    // 1. Create user
    const user = User.create('1', 'test@example.com', 'Test User');
    await userRepo.save(user);
    
    // 2. Create todo
    const todo = Todo.create(
      '1',
      'Test Todo',
      user.id,
      null,
      Priority.HIGH,
      new Date()
    );
    
    // 3. Verify domain events
    const events = todo.getUncommittedEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: 'TodoCreated' })
    );
    
    // 4. Save and verify
    await todoRepo.save(todo);
    const saved = await todoRepo.findById(todo.id);
    expect(saved).toBeDefined();
    expect(saved?.title).toBe('Test Todo');
  });
});
```

### Performance Testing

```typescript
// ✅ GOOD: Test performance characteristics
describe('Repository Performance', () => {
  it('should handle bulk operations efficiently', async () => {
    const entities = Array.from({ length: 1000 }, (_, i) => 
      User.create(`${i}`, `user${i}@example.com`, `User ${i}`)
    );
    
    const start = performance.now();
    await repository.createMany(entities);
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(1000); // Should complete within 1 second
    console.log(`Bulk insert of 1000 entities: ${duration}ms`);
  });
});
```

## Migration Checklist

When migrating existing code to use the new patterns:

- [ ] Identify all singleton services and migrate to `SingletonService`
- [ ] Identify async services and migrate to `AsyncSingletonService`
- [ ] Replace manual repository implementations with `BaseRepository`
- [ ] Update aggregates to extend `BaseAggregate`
- [ ] Replace manual auth checks with middleware
- [ ] Use cache invalidation helpers
- [ ] Replace manual DataLoaders with factory functions
- [ ] Update tests to use new patterns
- [ ] Remove duplicated code
- [ ] Update documentation

## Common Pitfalls

1. **Forgetting to clear singletons in tests** - Always clear instances in `beforeEach`
2. **Not awaiting async singletons** - Remember `getInstance()` returns a Promise
3. **Manually managing timestamps** - Let `BaseAggregate` handle it
4. **Over-engineering simple operations** - Not everything needs all middleware
5. **Creating DataLoaders in resolvers** - Create them once in context
6. **Swallowing errors** - Use ErrorHandler for consistent error handling
7. **Manual cache invalidation** - Use the helper functions

## Performance Considerations

1. **Singleton initialization** - Expensive operations should use `AsyncSingletonService`
2. **DataLoader batch size** - Configure `maxBatchSize` for large datasets
3. **Cache TTL** - Set appropriate TTLs based on data volatility
4. **Transaction scope** - Keep transactions as small as possible
5. **Event handling** - Process domain events asynchronously when possible

## Conclusion

These patterns significantly reduce code duplication while improving maintainability and consistency. Follow these best practices to get the most benefit from the refactoring work.