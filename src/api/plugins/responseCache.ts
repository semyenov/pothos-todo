import type { Plugin } from 'graphql-yoga';
import { CacheManager } from '@/infrastructure/cache/CacheManager';
import { hash } from 'ohash';
import { logger } from '@/logger';
import type { Context } from '@/api/schema/builder.js';
import type { OperationDefinitionNode } from 'graphql';

export interface ResponseCacheOptions {
  /**
   * Time to live in seconds (default: 60)
   */
  ttl?: number;

  /**
   * Cache only successful responses (default: true)
   */
  cacheOnlySuccess?: boolean;

  /**
   * Include user context in cache key (default: true)
   */
  includeUserContext?: boolean;

  /**
   * Skip cache for these operation names
   */
  skipOperations?: string[];

  /**
   * Cache key prefix (default: 'gql:response:')
   */
  keyPrefix?: string;
}

/**
 * Create a response cache plugin for GraphQL Yoga
 */
export function createResponseCachePlugin(options: ResponseCacheOptions = {}): Plugin {
  const {
    ttl = 60,
    cacheOnlySuccess = true,
    includeUserContext = true,
    skipOperations = [],
    keyPrefix = 'gql:response:',
  } = options;

  // Cache manager will be initialized on first use
  let cacheManager: CacheManager | null = null;

  return {
    onExecute: ({ args }) => {
      // Skip mutations and subscriptions
      const operation = args.document.definitions.find(
        (def: OperationDefinitionNode) => def.kind === 'OperationDefinition'
      ) as OperationDefinitionNode;

      if (!operation || operation.operation !== 'query') {
        return;
      }

      // Skip if operation is in skip list
      const operationName = operation.name?.value;
      if (operationName && skipOperations.includes(operationName)) {
        return;
      }

      // Generate cache key
      const context = args.contextValue as unknown as Context;
      const cacheKeyData = {
        query: args.document.loc?.source.body || 'unknown', // Use query string instead of document object
        variables: args.variableValues,
        operationName: args.operationName,
        userId: context.user?.id,
        sessionId: context.session?.session?.id,
      };

      const cacheKey = `${keyPrefix}${hash(cacheKeyData)}`;

      return {
        onExecuteDone: async ({ result }) => {
          try {
            // Initialize cache manager if not already done
            if (!cacheManager) {
              cacheManager = await CacheManager.getInstance();
            }

            // Don't cache if cache is disabled
            if (!cacheManager.isConnected) {
              logger.debug('Cache is disabled', {
                operationName,
                cacheKey,
                ttl,
              });
              return;
            }

            // Cache the result if successful
            if (result && (!cacheOnlySuccess || !('errors' in result))) {
              await cacheManager.set(cacheKey, result, { ttl });
              logger.debug('GraphQL response cached', {
                operationName,
                cacheKey,
                ttl,
              });
            }
          } catch (error) {
            logger.error('Cache operation failed', { error, operationName, cacheKey });
          }
        },
      };
    },
  };
}

/**
 * Cache control directive implementation
 */
export const cacheControlDirective = `
  directive @cacheControl(
    maxAge: Int
    scope: CacheControlScope
    inheritMaxAge: Boolean
  ) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION

  enum CacheControlScope {
    PUBLIC
    PRIVATE
  }
`;

/**
 * Create cache tags for invalidation
 */
export function createCacheTags(type: string, id?: string): string[] {
  const tags = [`type:${type}`];
  if (id) {
    tags.push(`${type}:${id}`);
  }
  return tags;
}

/**
 * Invalidate cache by type or specific entity
 */
export async function invalidateCache(type: string, id?: string): Promise<void> {
  const cacheManager = await CacheManager.getInstance();
  const tags = createCacheTags(type, id);

  const invalidated = await cacheManager.invalidateByTags(tags);
  logger.info('Cache invalidated', {
    type,
    id,
    tags,
    invalidatedCount: invalidated,
  });
}