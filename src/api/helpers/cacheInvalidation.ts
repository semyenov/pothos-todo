import { invalidateCache } from '../plugins/responseCache.js';
import type { Context } from '../schema/builder.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Cache invalidation patterns for different entity types.
 * This eliminates 34 repeated cache invalidation calls across mutations.
 */
export interface CacheInvalidationPattern {
  entity: string;
  parent?: string;
  user?: boolean;
  custom?: string[];
}

/**
 * Standard cache invalidation patterns for common entities
 */
export const CachePatterns = {
  TODO: {
    entity: 'Todo',
    parent: 'TodoList',
    user: true,
  },
  TODO_LIST: {
    entity: 'TodoList',
    user: true,
  },
  USER: {
    entity: 'User',
  },
} as const;

/**
 * Invalidate caches based on a pattern.
 * 
 * @example
 * ```typescript
 * // In a mutation resolver
 * await invalidateCaches(CachePatterns.TODO, {
 *   entityId: todo.id,
 *   parentId: todo.todoListId,
 *   userId: context.user.id
 * });
 * ```
 */
export async function invalidateCaches(
  pattern: CacheInvalidationPattern,
  data: {
    entityId: string;
    parentId?: string | null;
    userId?: string | null;
    customIds?: Record<string, string>;
  }
): Promise<void> {
  const invalidations: Promise<void>[] = [];

  // Invalidate main entity
  if (pattern.entity && data.entityId) {
    invalidations.push(
      invalidateCache(pattern.entity, data.entityId)
        .catch(err => logger.error(`Failed to invalidate ${pattern.entity} cache:`, err))
    );
  }

  // Invalidate parent entity
  if (pattern.parent && data.parentId) {
    invalidations.push(
      invalidateCache(pattern.parent, data.parentId)
        .catch(err => logger.error(`Failed to invalidate ${pattern.parent} cache:`, err))
    );
  }

  // Invalidate user cache
  if (pattern.user && data.userId) {
    invalidations.push(
      invalidateCache('User', data.userId)
        .catch(err => logger.error('Failed to invalidate User cache:', err))
    );
  }

  // Invalidate custom caches
  if (pattern.custom && data.customIds) {
    for (const cacheType of pattern.custom) {
      const id = data.customIds[cacheType];
      if (id) {
        invalidations.push(
          invalidateCache(cacheType, id)
            .catch(err => logger.error(`Failed to invalidate ${cacheType} cache:`, err))
        );
      }
    }
  }

  await Promise.all(invalidations);
}

/**
 * Helper to invalidate caches after a Todo mutation
 */
export async function invalidateTodoCaches(
  todo: {
    id: string;
    todoListId?: string | null;
  },
  userId: string
): Promise<void> {
  await invalidateCaches(CachePatterns.TODO, {
    entityId: todo.id,
    parentId: todo.todoListId,
    userId,
  });
}

/**
 * Helper to invalidate caches after a TodoList mutation
 */
export async function invalidateTodoListCaches(
  todoList: {
    id: string;
  },
  userId: string
): Promise<void> {
  await invalidateCaches(CachePatterns.TODO_LIST, {
    entityId: todoList.id,
    userId,
  });
}

/**
 * Helper to invalidate all user-related caches
 */
export async function invalidateUserCaches(userId: string): Promise<void> {
  await invalidateCaches(CachePatterns.USER, {
    entityId: userId,
  });
}

/**
 * Batch invalidate multiple cache entries
 */
export async function batchInvalidate(
  invalidations: Array<{
    pattern: CacheInvalidationPattern;
    data: {
      entityId: string;
      parentId?: string | null;
      userId?: string | null;
      customIds?: Record<string, string>;
    };
  }>
): Promise<void> {
  await Promise.all(
    invalidations.map(({ pattern, data }) => 
      invalidateCaches(pattern, data)
    )
  );
}

/**
 * Create a cache invalidation handler for a specific pattern
 */
export function createCacheInvalidator<T extends { id: string }>(
  pattern: CacheInvalidationPattern
) {
  return async (
    entity: T,
    context: Context,
    additionalData?: {
      parentId?: string | null;
      customIds?: Record<string, string>;
    }
  ): Promise<void> => {
    await invalidateCaches(pattern, {
      entityId: entity.id,
      parentId: additionalData?.parentId,
      userId: pattern.user ? context.user?.id || null : null,
      customIds: additionalData?.customIds,
    });
  };
}

/**
 * Decorator to automatically invalidate caches after a mutation
 * 
 * @example
 * ```typescript
 * const resolver = withCacheInvalidation(
 *   CachePatterns.TODO,
 *   (result) => ({
 *     entityId: result.id,
 *     parentId: result.todoListId,
 *   })
 * )(async (parent, args, context) => {
 *   const todo = await todoService.create(args.input);
 *   return todo;
 * });
 * ```
 */
export function withCacheInvalidation<TSource, TArgs, TReturn extends { id: string }>(
  pattern: CacheInvalidationPattern,
  dataExtractor: (result: TReturn, args: TArgs, context: Context) => {
    entityId?: string;
    parentId?: string | null;
    customIds?: Record<string, string>;
  }
) {
  return (
    resolver: (source: TSource, args: TArgs, context: Context) => Promise<TReturn>
  ) => {
    return async (source: TSource, args: TArgs, context: Context): Promise<TReturn> => {
      const result = await resolver(source, args, context);
      
      const data = dataExtractor(result, args, context);
      
      await invalidateCaches(pattern, {
        entityId: data.entityId || result.id,
        parentId: data.parentId,
        userId: pattern.user ? context.user?.id || null : null,
        customIds: data.customIds,
      });
      
      return result;
    };
  };
}

/**
 * Clear all caches for a user (useful for logout or major updates)
 */
export async function clearAllUserCaches(userId: string): Promise<void> {
  const cacheTypes = ['User', 'Todo', 'TodoList'];
  
  await Promise.all(
    cacheTypes.map(type => 
      invalidateCache(type, userId)
        .catch(err => logger.error(`Failed to clear ${type} cache for user:`, err))
    )
  );
}