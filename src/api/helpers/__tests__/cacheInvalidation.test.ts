import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  invalidateCaches,
  invalidateTodoCaches,
  invalidateTodoListCaches,
  invalidateUserCaches,
  batchInvalidate,
  createCacheInvalidator,
  withCacheInvalidation,
  clearAllUserCaches,
  CachePatterns,
} from '../cacheInvalidation';
import type { Context } from '../../context';

// Mock the cache module
mock.module('@/api/plugins/responseCache', () => ({
  invalidateCache: mock(async (type: string, id: string) => {
    // Track calls for testing
    return Promise.resolve();
  }),
}));

// Import after mocking
import { invalidateCache } from '../../plugins/responseCache';

describe('Cache Invalidation Helpers', () => {
  beforeEach(() => {
    // Clear mock calls
    (invalidateCache as any).mockClear();
  });

  describe('invalidateCaches', () => {
    it('should invalidate entity cache', async () => {
      await invalidateCaches(
        { entity: 'Todo' },
        { entityId: '123' }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(1);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
    });

    it('should invalidate entity and parent caches', async () => {
      await invalidateCaches(
        { entity: 'Todo', parent: 'TodoList' },
        { entityId: '123', parentId: '456' }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(2);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '456');
    });

    it('should invalidate entity, parent, and user caches', async () => {
      await invalidateCaches(
        { entity: 'Todo', parent: 'TodoList', user: true },
        { entityId: '123', parentId: '456', userId: '789' }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '456');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });

    it('should handle null values gracefully', async () => {
      await invalidateCaches(
        { entity: 'Todo', parent: 'TodoList', user: true },
        { entityId: '123', parentId: null, userId: null }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(1);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
    });

    it('should invalidate custom caches', async () => {
      await invalidateCaches(
        { entity: 'Todo', custom: ['Tag', 'Category'] },
        { 
          entityId: '123',
          customIds: { Tag: 'tag1', Category: 'cat1' }
        }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('Tag', 'tag1');
      expect(invalidateCache).toHaveBeenCalledWith('Category', 'cat1');
    });

    it('should handle cache invalidation errors gracefully', async () => {
      (invalidateCache as any).mockRejectedValueOnce(new Error('Cache error'));

      // Should not throw
      await expect(
        invalidateCaches(
          { entity: 'Todo' },
          { entityId: '123' }
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('invalidateTodoCaches', () => {
    it('should use TODO pattern', async () => {
      const todo = { id: '123', todoListId: '456' };
      await invalidateTodoCaches(todo, '789');

      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '456');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });

    it('should handle todos without list', async () => {
      const todo = { id: '123', todoListId: null };
      await invalidateTodoCaches(todo, '789');

      expect(invalidateCache).toHaveBeenCalledTimes(2);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });
  });

  describe('invalidateTodoListCaches', () => {
    it('should use TODO_LIST pattern', async () => {
      const todoList = { id: '123' };
      await invalidateTodoListCaches(todoList, '789');

      expect(invalidateCache).toHaveBeenCalledTimes(2);
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '123');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });
  });

  describe('invalidateUserCaches', () => {
    it('should use USER pattern', async () => {
      await invalidateUserCaches('789');

      expect(invalidateCache).toHaveBeenCalledTimes(1);
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });
  });

  describe('batchInvalidate', () => {
    it('should invalidate multiple patterns', async () => {
      await batchInvalidate([
        {
          pattern: CachePatterns.TODO,
          data: { entityId: '1', parentId: '2', userId: '3' }
        },
        {
          pattern: CachePatterns.TODO_LIST,
          data: { entityId: '4', userId: '3' }
        },
        {
          pattern: CachePatterns.USER,
          data: { entityId: '3' }
        }
      ]);

      expect(invalidateCache).toHaveBeenCalledTimes(6);
      // TODO pattern calls
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '1');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '2');
      expect(invalidateCache).toHaveBeenCalledWith('User', '3');
      // TODO_LIST pattern calls
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '4');
      // USER pattern call (User '3' called multiple times is ok)
    });
  });

  describe('createCacheInvalidator', () => {
    it('should create a reusable invalidator', async () => {
      const invalidator = createCacheInvalidator(CachePatterns.TODO);
      const context: Context = { user: { id: '789' } } as any;
      
      await invalidator(
        { id: '123' },
        context,
        { parentId: '456' }
      );

      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '456');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });

    it('should work without additional data', async () => {
      const invalidator = createCacheInvalidator({ entity: 'Todo' });
      const context: Context = { user: null } as any;
      
      await invalidator({ id: '123' }, context);

      expect(invalidateCache).toHaveBeenCalledTimes(1);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
    });
  });

  describe('withCacheInvalidation', () => {
    it('should invalidate caches after resolver execution', async () => {
      const resolver = async (source: any, args: any, context: any) => {
        return { id: '123', todoListId: '456' };
      };

      const wrapped = withCacheInvalidation(
        CachePatterns.TODO,
        (result) => ({
          entityId: result.id,
          parentId: result.todoListId,
        })
      )(resolver);

      const context: Context = { user: { id: '789' } } as any;
      const result = await wrapped({}, {}, context);

      expect(result).toEqual({ id: '123', todoListId: '456' });
      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '456');
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
    });

    it('should use result.id as default entityId', async () => {
      const resolver = async () => ({ id: '123' });

      const wrapped = withCacheInvalidation(
        { entity: 'Todo' },
        () => ({}) // Empty extractor
      )(resolver);

      await wrapped({}, {}, {} as Context);

      expect(invalidateCache).toHaveBeenCalledWith('Todo', '123');
    });

    it('should propagate resolver errors', async () => {
      const resolver = async () => {
        throw new Error('Resolver error');
      };

      const wrapped = withCacheInvalidation(
        CachePatterns.TODO,
        () => ({})
      )(resolver);

      await expect(wrapped({}, {}, {} as Context))
        .rejects.toThrow('Resolver error');
      
      // No cache invalidation should occur
      expect(invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('clearAllUserCaches', () => {
    it('should clear all cache types for a user', async () => {
      await clearAllUserCaches('789');

      expect(invalidateCache).toHaveBeenCalledTimes(3);
      expect(invalidateCache).toHaveBeenCalledWith('User', '789');
      expect(invalidateCache).toHaveBeenCalledWith('Todo', '789');
      expect(invalidateCache).toHaveBeenCalledWith('TodoList', '789');
    });

    it('should handle errors gracefully', async () => {
      (invalidateCache as any).mockRejectedValue(new Error('Cache error'));

      // Should not throw
      await expect(clearAllUserCaches('789'))
        .resolves.toBeUndefined();
    });
  });

  describe('CachePatterns', () => {
    it('should have correct TODO pattern', () => {
      expect(CachePatterns.TODO).toEqual({
        entity: 'Todo',
        parent: 'TodoList',
        user: true,
      });
    });

    it('should have correct TODO_LIST pattern', () => {
      expect(CachePatterns.TODO_LIST).toEqual({
        entity: 'TodoList',
        user: true,
      });
    });

    it('should have correct USER pattern', () => {
      expect(CachePatterns.USER).toEqual({
        entity: 'User',
      });
    });
  });
});