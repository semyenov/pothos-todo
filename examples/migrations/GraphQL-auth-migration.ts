/**
 * Migration Example: GraphQL Authentication
 * 
 * This example shows how to migrate GraphQL resolvers from manual authentication
 * checks to using the new authentication middleware.
 */

// ============================================
// BEFORE: Manual authentication checks
// ============================================
/*
// In todo mutations (repeated 14 times across mutations)
builder.mutationField('createTodo', (t) =>
  t.field({
    type: Todo,
    args: {
      input: t.arg({ type: CreateTodoInput, required: true }),
    },
    resolve: async (parent, { input }, context) => {
      // Manual authentication check
      if (!context.user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' }
        });
      }

      const todo = await todoService.create(context.user.id, input);
      
      // Manual cache invalidation
      await invalidateCache('Todo', todo.id);
      await invalidateCache('TodoList', todo.todoListId);
      await invalidateCache('User', context.user.id);
      
      return todo;
    },
  })
);

// In queries (repeated 9 times)
builder.queryField('myTodos', (t) =>
  t.field({
    type: [Todo],
    resolve: async (parent, args, context) => {
      if (!context.user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' }
        });
      }

      return todoService.findByUserId(context.user.id);
    },
  })
);
*/

// ============================================
// AFTER: Using authentication middleware
// ============================================

import { authenticated, withPermissions, compose, ownsResource } from '@/api/middleware/authenticated';
import { withCacheInvalidation, invalidateTodoCaches, CachePatterns } from '@/api/helpers/cacheInvalidation';

// Simple authentication
builder.mutationField('createTodo', (t) =>
  t.field({
    type: Todo,
    args: {
      input: t.arg({ type: CreateTodoInput, required: true }),
    },
    resolve: authenticated(
      withCacheInvalidation(
        CachePatterns.TODO,
        (result) => ({
          entityId: result.id,
          parentId: result.todoListId,
        })
      )(async (parent, { input }, context) => {
        // No need for auth check - user is guaranteed
        return todoService.create(context.user.id, input);
        // No need for cache invalidation - handled by decorator
      })
    ),
  })
);

// With permissions
builder.mutationField('deleteAllTodos', (t) =>
  t.field({
    type: Boolean,
    resolve: withPermissions(['admin'])(
      async (parent, args, context) => {
        await todoService.deleteAll();
        return true;
      }
    ),
  })
);

// With ownership check
builder.mutationField('updateTodo', (t) =>
  t.field({
    type: Todo,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateTodoInput, required: true }),
    },
    resolve: compose(
      authenticated,
      ownsResource({
        getOwnerId: async (args) => {
          const todo = await todoService.findById(args.id);
          return todo?.userId;
        },
        allowAdmin: true,
      })
    )(async (parent, { id, input }, context) => {
      return todoService.update(id, input);
    }),
  })
);

// ============================================
// ADVANCED PATTERNS
// ============================================

// 1. Rate limiting for expensive operations
builder.queryField('searchTodos', (t) =>
  t.field({
    type: [Todo],
    args: {
      query: t.arg.string({ required: true }),
    },
    resolve: compose(
      authenticated,
      rateLimit({ 
        window: 60000, // 1 minute
        max: 10 // 10 searches per minute
      })
    )(async (parent, { query }, context) => {
      return todoService.search(query, context.user.id);
    }),
  })
);

// 2. Batch operations with cache invalidation
builder.mutationField('completeTodos', (t) =>
  t.field({
    type: [Todo],
    args: {
      ids: t.arg.stringList({ required: true }),
    },
    resolve: authenticated(async (parent, { ids }, context) => {
      const todos = await Promise.all(
        ids.map(id => todoService.complete(id, context.user.id))
      );
      
      // Batch cache invalidation
      await batchInvalidate(
        todos.map(todo => ({
          pattern: CachePatterns.TODO,
          data: {
            entityId: todo.id,
            parentId: todo.todoListId,
            userId: context.user.id,
          }
        }))
      );
      
      return todos;
    }),
  })
);

// 3. Optional authentication
builder.queryField('publicTodos', (t) =>
  t.field({
    type: [Todo],
    resolve: optionalAuth(async (parent, args, context) => {
      if (context.user) {
        // Show user's todos and public todos
        return todoService.findForUser(context.user.id);
      } else {
        // Show only public todos
        return todoService.findPublic();
      }
    }),
  })
);

// ============================================
// MIGRATION STEPS:
// ============================================
/*
1. Import authentication middleware functions
2. Wrap resolver functions with appropriate middleware
3. Remove manual authentication checks
4. Remove manual cache invalidation (use helpers)
5. Use compose() for multiple middleware
6. Update TypeScript types if needed

Benefits:
- 33 authentication checks reduced to imports
- Consistent error messages
- Easier to add new auth patterns
- Composable middleware
- Better separation of concerns

Common Patterns:
- authenticated(): Basic auth check
- withPermissions(['role']): Role-based access
- ownsResource(): Ownership verification
- rateLimit(): Request throttling
- compose(): Combine multiple middleware
*/

// ============================================
// TESTING EXAMPLE:
// ============================================
/*
import { authenticated } from '@/api/middleware/authenticated';

describe('Todo Mutations', () => {
  it('should require authentication', () => {
    const resolver = authenticated((p, a, ctx) => 'success');
    
    // No user - should fail
    expect(() => resolver({}, {}, { user: null }))
      .toThrow('Not authenticated');
    
    // With user - should succeed
    const result = resolver({}, {}, { user: { id: '123' } });
    expect(result).toBe('success');
  });
});
*/