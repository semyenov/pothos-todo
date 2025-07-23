import DataLoader from 'dataloader';
import { PrismaClient } from '@prisma/client';
import { logger } from '@/logger.js';

/**
 * Options for creating a DataLoader
 */
export interface DataLoaderOptions<T> {
  /**
   * The Prisma model name (e.g., 'user', 'todo', 'todoList')
   */
  modelName: string;
  
  /**
   * Field to batch by (defaults to 'id')
   */
  batchField?: string;
  
  /**
   * Additional where conditions
   */
  where?: Record<string, any>;
  
  /**
   * Include relations
   */
  include?: Record<string, any>;
  
  /**
   * Custom key extractor (defaults to 'id')
   */
  keyExtractor?: (item: T) => string;
  
  /**
   * Maximum batch size (defaults to 100)
   */
  maxBatchSize?: number;
  
  /**
   * Cache results (defaults to true)
   */
  cache?: boolean;
}

/**
 * Factory function to create DataLoaders with consistent configuration.
 * This eliminates the need for 6 identical DataLoader implementations.
 * 
 * @example
 * ```typescript
 * const userLoader = createBatchLoader<User>(prisma, {
 *   modelName: 'user',
 * });
 * 
 * const todosByUserLoader = createBatchLoader<Todo>(prisma, {
 *   modelName: 'todo',
 *   batchField: 'userId',
 *   where: { deletedAt: null },
 *   include: { tags: true }
 * });
 * ```
 */
export function createBatchLoader<T extends { id: string }>(
  prisma: PrismaClient,
  options: DataLoaderOptions<T>
): DataLoader<string, T | null> {
  const {
    modelName,
    batchField = 'id',
    where = {},
    include,
    keyExtractor = (item) => item.id,
    maxBatchSize = 100,
    cache = true,
  } = options;

  const loader = new DataLoader<string, T | null>(
    async (keys: readonly string[]) => {
      logger.debug(`Loading ${modelName} batch`, {
        modelName,
        batchField,
        count: keys.length,
      });

      try {
        // Get the model from Prisma client
        const model = prisma[modelName as keyof PrismaClient] as any;
        
        // Build the query
        const query: any = {
          where: {
            ...where,
            [batchField]: { in: [...keys] },
          },
        };

        if (include) {
          query.include = include;
        }

        // Execute the query
        const items: T[] = await model.findMany(query);

        // Create a map for O(1) lookups
        const itemMap = new Map<string, T>();
        
        // When batching by 'id', we expect unique results
        if (batchField === 'id') {
          items.forEach((item) => {
            itemMap.set(item.id, item);
          });
          // Return items in the same order as the keys
          return keys.map((key) => itemMap.get(key) || null);
        } else {
          // When batching by other fields, return first match for each key
          const keyToItem = new Map<string, T>();
          items.forEach((item) => {
            const key = item[batchField as keyof T] as unknown as string;
            if (!keyToItem.has(key)) {
              keyToItem.set(key, item);
            }
          });
          // Return items in the same order as the keys
          return keys.map((key) => keyToItem.get(key) || null);
        }
      } catch (error) {
        logger.error(`Error loading ${modelName} batch:`, error);
        throw error;
      }
    },
    {
      maxBatchSize,
      cache,
    }
  );

  return loader;
}

/**
 * Create a DataLoader that loads by a relation field (one-to-many)
 * 
 * @example
 * ```typescript
 * const todosByListLoader = createRelationLoader<Todo>(prisma, {
 *   modelName: 'todo',
 *   relationField: 'todoListId',
 *   orderBy: { createdAt: 'desc' }
 * });
 * ```
 */
export function createRelationLoader<T>(
  prisma: PrismaClient,
  options: {
    modelName: string;
    relationField: string;
    where?: Record<string, any>;
    include?: Record<string, any>;
    orderBy?: Record<string, any>;
    take?: number;
  }
): DataLoader<string, T[]> {
  const {
    modelName,
    relationField,
    where = {},
    include,
    orderBy,
    take,
  } = options;

  return new DataLoader<string, T[]>(
    async (keys: readonly string[]) => {
      logger.debug(`Loading ${modelName} relation batch`, {
        modelName,
        relationField,
        count: keys.length,
      });

      try {
        const model = prisma[modelName as keyof PrismaClient] as any;
        
        // Build the query
        const query: any = {
          where: {
            ...where,
            [relationField]: { in: [...keys] },
          },
        };

        if (include) {
          query.include = include;
        }

        if (orderBy) {
          query.orderBy = orderBy;
        }

        if (take) {
          query.take = take;
        }

        // Execute the query
        const items: T[] = await model.findMany(query);

        // Group items by relation field
        const itemGroups = new Map<string, T[]>();
        keys.forEach((key) => itemGroups.set(key, []));
        
        items.forEach((item) => {
          const key = item[relationField as keyof T] as unknown as string;
          const group = itemGroups.get(key);
          if (group) {
            group.push(item);
          }
        });

        // Return groups in the same order as the keys
        return keys.map((key) => itemGroups.get(key) || []);
      } catch (error) {
        logger.error(`Error loading ${modelName} relation batch:`, error);
        throw error;
      }
    }
  );
}

/**
 * Create a set of standard DataLoaders for an entity
 * 
 * @example
 * ```typescript
 * const { byId, byUserId } = createStandardLoaders<Todo>(prisma, {
 *   modelName: 'todo',
 *   userField: 'userId',
 *   include: { tags: true }
 * });
 * ```
 */
export function createStandardLoaders<T extends { id: string }>(
  prisma: PrismaClient,
  options: {
    modelName: string;
    userField?: string;
    include?: Record<string, any>;
    where?: Record<string, any>;
  }
): {
  byId: DataLoader<string, T | null>;
  byUserId?: DataLoader<string, T[]>;
} {
  const result: any = {
    byId: createBatchLoader<T>(prisma, {
      modelName: options.modelName,
      include: options.include,
      where: options.where,
    }),
  };

  if (options.userField) {
    result.byUserId = createRelationLoader<T>(prisma, {
      modelName: options.modelName,
      relationField: options.userField,
      include: options.include,
      where: options.where,
      orderBy: { createdAt: 'desc' },
    });
  }

  return result;
}

/**
 * Clear all DataLoader caches
 * Useful for tests or after mutations
 */
export function clearDataLoaderCaches(loaders: Record<string, DataLoader<any, any>>): void {
  Object.values(loaders).forEach((loader) => {
    loader.clearAll();
  });
}

/**
 * Prime a DataLoader with known data
 * Useful for avoiding N+1 queries when you already have the data
 * 
 * @example
 * ```typescript
 * const users = await prisma.user.findMany();
 * primeLoader(userLoader, users);
 * ```
 */
export function primeLoader<T extends { id: string }>(
  loader: DataLoader<string, T | null>,
  items: T[],
  keyField: keyof T = 'id' as keyof T
): void {
  items.forEach((item) => {
    const key = item[keyField] as unknown as string;
    loader.prime(key, item);
  });
}

/**
 * Create a DataLoader with custom batch function
 * For cases that don't fit the standard patterns
 */
export function createCustomLoader<K, V>(
  batchFn: (keys: readonly K[]) => Promise<(V | Error)[]>,
  options?: DataLoader.Options<K, V>
): DataLoader<K, V> {
  return new DataLoader<K, V>(batchFn, options);
}