import { describe, it, expect, beforeEach } from 'bun:test';
import { GraphQLError } from 'graphql';
import {
  authenticated,
  withPermissions,
  optionalAuth,
  rateLimit,
  ownsResource,
  compose,
} from '../authenticated';
import type { Context } from '../../schema/builder.js';

// Mock context factory
function createContext(overrides?: Partial<Context>): Context {
  return {
    user: null,
    ip: '127.0.0.1',
    ...overrides,
  } as Context;
}

// Mock resolver
const mockResolver = (source: any, args: any, context: Context) => {
  return { success: true, userId: context.user?.id };
};

describe('Authentication Middleware', () => {
  describe('authenticated', () => {
    it('should allow access for authenticated users', () => {
      const context = createContext({
        user: { id: '123', email: 'test@example.com' }
      });
      
      const wrappedResolver = authenticated(mockResolver);
      const result = wrappedResolver({}, {}, context);
      
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should throw GraphQLError for unauthenticated users', () => {
      const context = createContext({ user: null });
      
      const wrappedResolver = authenticated(mockResolver);
      
      expect(() => {
        wrappedResolver({}, {}, context);
      }).toThrow(GraphQLError);
      
      try {
        wrappedResolver({}, {}, context);
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).message).toBe('Not authenticated');
        expect((error as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  describe('withPermissions', () => {
    it('should allow access for users with required permissions', () => {
      const context = createContext({
        user: {
          id: '123',
          email: 'admin@example.com',
          permissions: ['admin', 'user']
        }
      });
      
      const wrappedResolver = withPermissions(['admin'])(mockResolver);
      const result = wrappedResolver({}, {}, context);
      
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should allow access when user has any of the required permissions', () => {
      const context = createContext({
        user: {
          id: '123',
          email: 'mod@example.com',
          permissions: ['moderator', 'user']
        }
      });
      
      const wrappedResolver = withPermissions(['admin', 'moderator'])(mockResolver);
      const result = wrappedResolver({}, {}, context);
      
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should deny access for users without required permissions', () => {
      const context = createContext({
        user: {
          id: '123',
          email: 'user@example.com',
          permissions: ['user']
        }
      });
      
      const wrappedResolver = withPermissions(['admin'])(mockResolver);
      
      expect(() => {
        wrappedResolver({}, {}, context);
      }).toThrow(GraphQLError);
      
      try {
        wrappedResolver({}, {}, context);
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).message).toBe('Insufficient permissions');
        expect((error as GraphQLError).extensions?.code).toBe('FORBIDDEN');
        expect((error as GraphQLError).extensions?.requiredPermissions).toEqual(['admin']);
      }
    });

    it('should require authentication first', () => {
      const context = createContext({ user: null });
      
      const wrappedResolver = withPermissions(['admin'])(mockResolver);
      
      expect(() => {
        wrappedResolver({}, {}, context);
      }).toThrow('Not authenticated');
    });
  });

  describe('optionalAuth', () => {
    it('should allow access for authenticated users', () => {
      const context = createContext({
        user: { id: '123', email: 'test@example.com' }
      });
      
      const wrappedResolver = optionalAuth(mockResolver);
      const result = wrappedResolver({}, {}, context);
      
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should allow access for unauthenticated users', () => {
      const context = createContext({ user: null });
      
      const wrappedResolver = optionalAuth(mockResolver);
      const result = wrappedResolver({}, {}, context);
      
      expect(result).toEqual({ success: true, userId: undefined });
    });
  });

  describe('rateLimit', () => {
    beforeEach(() => {
      // Rate limit uses internal state, so tests may affect each other
      // Using unique keys for each test to avoid conflicts
    });

    it('should allow requests within rate limit', () => {
      const context = createContext({
        user: { id: '123', email: 'test@example.com' }
      });
      
      const wrappedResolver = rateLimit({
        window: 60000, // 1 minute
        max: 3
      })(mockResolver);
      
      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const result = wrappedResolver({}, {}, context);
        expect(result).toEqual({ success: true, userId: '123' });
      }
    });

    it('should block requests exceeding rate limit', () => {
      const context = createContext({
        user: { id: '123', email: 'test@example.com' }
      });
      
      const wrappedResolver = rateLimit({
        window: 60000,
        max: 2
      })(mockResolver);
      
      // First 2 requests succeed
      wrappedResolver({}, {}, context);
      wrappedResolver({}, {}, context);
      
      // Third request should be blocked
      expect(() => {
        wrappedResolver({}, {}, context);
      }).toThrow('Rate limit exceeded');
    });

    it('should use custom key generator', () => {
      const contexts = [
        createContext({ user: { id: '123', email: 'test1@example.com' } }),
        createContext({ user: { id: '456', email: 'test2@example.com' } })
      ];
      
      const wrappedResolver = rateLimit({
        window: 60000,
        max: 1,
        keyGenerator: (ctx) => ctx.user?.email || 'anonymous'
      })(mockResolver);
      
      // Different users should have separate limits
      wrappedResolver({}, {}, contexts[0]);
      wrappedResolver({}, {}, contexts[1]);
      
      // Second request for first user should fail
      expect(() => {
        wrappedResolver({}, {}, contexts[0]);
      }).toThrow('Rate limit exceeded');
    });

    it('should use IP for anonymous users', () => {
      const context = createContext({ user: null, ip: '192.168.1.1' });
      
      const wrappedResolver = rateLimit({
        window: 60000,
        max: 1
      })(mockResolver);
      
      wrappedResolver({}, {}, context);
      
      expect(() => {
        wrappedResolver({}, {}, context);
      }).toThrow('Rate limit exceeded');
    });
  });

  describe('ownsResource', () => {
    it('should allow access to resource owner', async () => {
      const context = createContext({
        user: { id: '123', email: 'owner@example.com' }
      });
      
      const wrappedResolver = ownsResource({
        getOwnerId: async (args: any) => '123'
      })(mockResolver);
      
      const result = await wrappedResolver({}, { id: 'resource1' }, context);
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should deny access to non-owner', async () => {
      const context = createContext({
        user: { id: '456', email: 'other@example.com' }
      });
      
      const wrappedResolver = ownsResource({
        getOwnerId: async (args: any) => '123'
      })(mockResolver);
      
      await expect(
        wrappedResolver({}, { id: 'resource1' }, context)
      ).rejects.toThrow('You do not have permission to access this resource');
    });

    it('should allow admin bypass when enabled', async () => {
      const context = createContext({
        user: {
          id: '999',
          email: 'admin@example.com',
          permissions: ['admin']
        }
      });
      
      const wrappedResolver = ownsResource({
        getOwnerId: async (args: any) => '123',
        allowAdmin: true
      })(mockResolver);
      
      const result = await wrappedResolver({}, { id: 'resource1' }, context);
      expect(result).toEqual({ success: true, userId: '999' });
    });

    it('should throw NOT_FOUND when resource does not exist', async () => {
      const context = createContext({
        user: { id: '123', email: 'user@example.com' }
      });
      
      const wrappedResolver = ownsResource({
        getOwnerId: async (args: any) => null
      })(mockResolver);
      
      await expect(
        wrappedResolver({}, { id: 'nonexistent' }, context)
      ).rejects.toThrow('Resource not found');
    });

    it('should require authentication', async () => {
      const context = createContext({ user: null });
      
      const wrappedResolver = ownsResource({
        getOwnerId: async (args: any) => '123'
      })(mockResolver);
      
      await expect(
        wrappedResolver({}, { id: 'resource1' }, context)
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('compose', () => {
    it('should apply middlewares in correct order', () => {
      const order: string[] = [];
      
      const middleware1 = (resolver: any) => (source: any, args: any, context: any) => {
        order.push('middleware1');
        return resolver(source, args, context);
      };
      
      const middleware2 = (resolver: any) => (source: any, args: any, context: any) => {
        order.push('middleware2');
        return resolver(source, args, context);
      };
      
      const finalResolver = (source: any, args: any, context: any) => {
        order.push('resolver');
        return { success: true };
      };
      
      const context = createContext({
        user: { id: '123', email: 'test@example.com' }
      });
      
      const composed = compose(middleware1, middleware2)(finalResolver);
      const result = composed({}, {}, context);
      
      expect(order).toEqual(['middleware1', 'middleware2', 'resolver']);
      expect(result).toEqual({ success: true });
    });

    it('should work with authentication middlewares', async () => {
      const context = createContext({
        user: {
          id: '123',
          email: 'owner@example.com',
          permissions: ['user']
        }
      });
      
      const composed = compose(
        rateLimit({ window: 60000, max: 10 }),
        authenticated,
        ownsResource({ 
          getOwnerId: async () => '123'
        })
      )(mockResolver);
      
      const result = await composed({}, { id: 'resource1' }, context);
      expect(result).toEqual({ success: true, userId: '123' });
    });

    it('should short-circuit on middleware failure', () => {
      const context = createContext({ user: null });
      
      const composed = compose(
        authenticated,
        withPermissions(['admin'])
      )(mockResolver);
      
      // Should fail at authenticated middleware
      expect(() => {
        composed({}, {}, context);
      }).toThrow('Not authenticated');
    });
  });
});