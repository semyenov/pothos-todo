import { GraphQLError } from 'graphql';
import type { Context } from '../context.js';

/**
 * Authentication middleware for GraphQL resolvers.
 * This eliminates the need for 33+ repeated authentication checks across the codebase.
 * 
 * @example
 * ```typescript
 * // In your GraphQL resolver
 * resolve: authenticated((parent, args, context) => {
 *   // User is guaranteed to be authenticated here
 *   return todoService.create(context.user.id, args.input);
 * })
 * ```
 */
export function authenticated<TSource, TArgs, TReturn>(
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
): (source: TSource, args: TArgs, context: Context) => TReturn {
  return (source: TSource, args: TArgs, context: Context): TReturn => {
    if (!context.user) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED' }
      });
    }
    return resolver(source, args, context);
  };
}

/**
 * Authentication middleware that also checks for specific permissions.
 * 
 * @example
 * ```typescript
 * resolve: withPermissions(['admin', 'moderator'])((parent, args, context) => {
 *   // User is authenticated and has required permissions
 *   return adminService.performAction(args);
 * })
 * ```
 */
export function withPermissions<TSource, TArgs, TReturn>(
  requiredPermissions: string[]
): (
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
) => (source: TSource, args: TArgs, context: Context) => TReturn {
  return (resolver) => {
    return authenticated((source: TSource, args: TArgs, context: Context): TReturn => {
      // Check if user has required permissions
      const userPermissions = context.user?.permissions || [];
      const hasPermission = requiredPermissions.some(permission => 
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        throw new GraphQLError('Insufficient permissions', {
          extensions: { 
            code: 'FORBIDDEN',
            requiredPermissions,
            userPermissions
          }
        });
      }

      return resolver(source, args, context);
    });
  };
}

/**
 * Optional authentication middleware.
 * Allows both authenticated and unauthenticated access.
 * 
 * @example
 * ```typescript
 * resolve: optionalAuth((parent, args, context) => {
 *   if (context.user) {
 *     // Show personalized content
 *     return todoService.getPersonalized(context.user.id);
 *   } else {
 *     // Show public content
 *     return todoService.getPublic();
 *   }
 * })
 * ```
 */
export function optionalAuth<TSource, TArgs, TReturn>(
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
): (source: TSource, args: TArgs, context: Context) => TReturn {
  return resolver;
}

/**
 * Rate limiting middleware for authenticated users.
 * 
 * @example
 * ```typescript
 * resolve: rateLimit({ 
 *   window: 60 * 1000, // 1 minute
 *   max: 10 // 10 requests per minute
 * })(authenticated((parent, args, context) => {
 *   return expensiveOperation(args);
 * }))
 * ```
 */
export function rateLimit<TSource, TArgs, TReturn>(
  options: {
    window: number; // Time window in milliseconds
    max: number; // Maximum requests in window
    keyGenerator?: (context: Context) => string; // Custom key generator
  }
): (
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
) => (source: TSource, args: TArgs, context: Context) => TReturn {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return (resolver) => {
    return (source: TSource, args: TArgs, context: Context): TReturn => {
      const key = options.keyGenerator 
        ? options.keyGenerator(context)
        : context.user?.id || context.ip || 'anonymous';
      
      const now = Date.now();
      const record = requests.get(key);

      if (!record || record.resetAt < now) {
        // Create new record
        requests.set(key, {
          count: 1,
          resetAt: now + options.window
        });
      } else {
        // Check rate limit
        if (record.count >= options.max) {
          const retryAfter = Math.ceil((record.resetAt - now) / 1000);
          throw new GraphQLError('Rate limit exceeded', {
            extensions: {
              code: 'RATE_LIMITED',
              retryAfter,
              limit: options.max,
              window: options.window
            }
          });
        }
        record.count++;
      }

      // Clean up old entries periodically
      if (Math.random() < 0.01) { // 1% chance
        for (const [k, v] of requests.entries()) {
          if (v.resetAt < now) {
            requests.delete(k);
          }
        }
      }

      return resolver(source, args, context);
    };
  };
}

/**
 * Ownership check middleware.
 * Ensures the authenticated user owns the requested resource.
 * 
 * @example
 * ```typescript
 * resolve: authenticated(ownsResource({
 *   getOwnerId: async (args) => {
 *     const todo = await todoService.findById(args.id);
 *     return todo?.userId;
 *   }
 * })((parent, args, context) => {
 *   // User owns the resource
 *   return todoService.update(args.id, args.input);
 * }))
 * ```
 */
export function ownsResource<TSource, TArgs, TReturn>(
  options: {
    getOwnerId: (args: TArgs, context: Context) => string | Promise<string | null | undefined>;
    allowAdmin?: boolean; // Allow admin users to bypass ownership check
  }
): (
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
) => (source: TSource, args: TArgs, context: Context) => TReturn | Promise<TReturn> {
  return (resolver) => {
    return async (source: TSource, args: TArgs, context: Context) => {
      if (!context.user) {
        throw new GraphQLError('Not authenticated', {
          extensions: { code: 'UNAUTHENTICATED' }
        });
      }

      // Check admin bypass
      if (options.allowAdmin && context.user.permissions?.includes('admin')) {
        return resolver(source, args, context);
      }

      // Get owner ID
      const ownerId = await options.getOwnerId(args, context);
      
      if (!ownerId) {
        throw new GraphQLError('Resource not found', {
          extensions: { code: 'NOT_FOUND' }
        });
      }

      if (ownerId !== context.user.id) {
        throw new GraphQLError('You do not have permission to access this resource', {
          extensions: { code: 'FORBIDDEN' }
        });
      }

      return resolver(source, args, context);
    };
  };
}

/**
 * Combine multiple middleware functions.
 * 
 * @example
 * ```typescript
 * resolve: compose(
 *   rateLimit({ window: 60000, max: 10 }),
 *   authenticated,
 *   ownsResource({ getOwnerId: (args) => getTodoOwnerId(args.id) })
 * )((parent, args, context) => {
 *   return todoService.update(args.id, args.input);
 * })
 * ```
 */
export function compose<TSource, TArgs, TReturn>(
  ...middlewares: Array<
    (resolver: (source: TSource, args: TArgs, context: Context) => TReturn) => 
    (source: TSource, args: TArgs, context: Context) => TReturn
  >
): (
  resolver: (source: TSource, args: TArgs, context: Context) => TReturn
) => (source: TSource, args: TArgs, context: Context) => TReturn {
  return (resolver) => {
    return middlewares.reduceRight(
      (prev, middleware) => middleware(prev),
      resolver
    );
  };
}