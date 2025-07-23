import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import {
  ErrorHandler,
  DomainError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  errorHandler,
} from '../ErrorHandler.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { GraphQLError } from 'graphql';

// Mock the logger module before importing ErrorHandler
mock.module('@/logger', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }
}));

// Import logger after mocking
import { logger as mockLogger } from '@/logger';

describe('ErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = ErrorHandler.getInstance();
    // Clear mock calls
    (mockLogger.info as any).mockClear();
    (mockLogger.warn as any).mockClear();
    (mockLogger.error as any).mockClear();
  });

  describe('Singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ErrorHandler.getInstance();
      const instance2 = ErrorHandler.getInstance();
      expect(instance1).toBe(instance2);
      expect(errorHandler).toBe(instance1);
    });
  });

  describe('Error handling', () => {
    it('should handle and rethrow DomainError', () => {
      const error = new NotFoundError('User', '123');
      const context = { operation: 'findUser' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(error);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Domain error occurred',
        expect.objectContaining({
          operation: 'findUser',
          error: expect.objectContaining({
            name: 'DomainError',
            message: 'User with id 123 not found',
          }),
        })
      );
    });

    it('should handle GraphQLError', () => {
      const error = new GraphQLError('Invalid query');
      const context = { operation: 'query' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(error);

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should convert generic Error to InfrastructureError', () => {
      const error = new Error('Something went wrong');
      const context = { operation: 'process' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(InfrastructureError);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle unknown errors', () => {
      const error = 'string error';
      const context = { operation: 'unknown' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(InfrastructureError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Prisma error handling', () => {
    it('should handle unique constraint violation (P2002)', () => {
      const error = new PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', meta: { target: ['email'] } }
      );
      const context = { resource: 'User' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(ConflictError);
    });

    it('should handle record not found (P2025)', () => {
      const error = new PrismaClientKnownRequestError(
        'Record not found',
        { code: 'P2025' }
      );
      const context = { resource: 'Todo', id: '456' };

      expect(() => {
        handler.handle(error, context);
      }).toThrow(NotFoundError);
    });

    it('should handle foreign key constraint (P2003)', () => {
      const error = new PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003' }
      );
      const context = {};

      expect(() => {
        handler.handle(error, context);
      }).toThrow(ValidationError);
    });
  });

  describe('Async error handling', () => {
    it('should handle async operations that succeed', async () => {
      const result = await handler.handleAsync(
        async () => 'success',
        { operation: 'async' }
      );

      expect(result).toBe('success');
    });

    it('should handle async operations that fail', async () => {
      const error = new Error('Async error');

      await expect(
        handler.handleAsync(
          async () => { throw error; },
          { operation: 'async' }
        )
      ).rejects.toThrow(InfrastructureError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Sync error handling', () => {
    it('should handle sync operations that succeed', () => {
      const result = handler.handleSync(
        () => 'success',
        { operation: 'sync' }
      );

      expect(result).toBe('success');
    });

    it('should handle sync operations that fail', () => {
      const error = new Error('Sync error');

      expect(() => {
        handler.handleSync(
          () => { throw error; },
          { operation: 'sync' }
        );
      }).toThrow(InfrastructureError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('GraphQL error conversion', () => {
    it('should convert DomainError to GraphQLError', () => {
      const error = new ValidationError('Invalid input');
      const context = { field: 'email' };

      const graphQLError = handler.toGraphQLError(error, context);

      expect(graphQLError).toBeInstanceOf(GraphQLError);
      expect(graphQLError.message).toBe('Invalid input');
      expect(graphQLError.extensions).toEqual({
        code: 'VALIDATION_ERROR',
        field: 'email',
      });
    });

    it('should pass through existing GraphQLError', () => {
      const error = new GraphQLError('Test error');
      const result = handler.toGraphQLError(error);
      expect(result).toBe(error);
    });

    it('should convert unknown errors to GraphQLError', () => {
      const error = 'string error';
      const graphQLError = handler.toGraphQLError(error);

      expect(graphQLError).toBeInstanceOf(GraphQLError);
      expect(graphQLError.message).toBe('An unexpected error occurred');
      expect(graphQLError.extensions?.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Function wrapping', () => {
    it('should wrap sync function with error handling', () => {
      const fn = (value: number) => {
        if (value < 0) throw new Error('Negative value');
        return value * 2;
      };

      const wrapped = handler.wrap(fn, { operation: 'multiply' });

      expect(wrapped(5)).toBe(10);
      expect(() => wrapped(-1)).toThrow(InfrastructureError);
    });

    it('should wrap async function with error handling', async () => {
      const fn = async (value: number) => {
        if (value < 0) throw new Error('Negative value');
        return value * 2;
      };

      const wrapped = handler.wrapAsync(fn, { operation: 'multiplyAsync' });

      expect(await wrapped(5)).toBe(10);
      await expect(wrapped(-1)).rejects.toThrow(InfrastructureError);
    });

    it('should support dynamic context', () => {
      const fn = (id: string) => {
        if (!id) throw new Error('ID required');
        return { id };
      };

      const wrapped = handler.wrap(
        fn,
        (args) => ({ operation: 'getById', id: args[0] })
      );

      expect(() => wrapped('')).toThrow(InfrastructureError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error occurred',
        expect.objectContaining({
          operation: 'getById',
          id: '',
        })
      );
    });
  });

  describe('Domain error types', () => {
    it('should create NotFoundError correctly', () => {
      const error = new NotFoundError('Todo', '123');
      expect(error.message).toBe('Todo with id 123 not found');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create ValidationError correctly', () => {
      const error = new ValidationError('Email is required');
      expect(error.message).toBe('Email is required');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should create UnauthorizedError correctly', () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe('Unauthorized');
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should create ForbiddenError correctly', () => {
      const error = new ForbiddenError('Access denied');
      expect(error.message).toBe('Access denied');
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should create ConflictError correctly', () => {
      const error = new ConflictError('Email already exists');
      expect(error.message).toBe('Email already exists');
      expect(error.code).toBe('CONFLICT');
    });
  });
});