import { logger } from '@/logger.js';
import { PrismaClientKnownRequestError, PrismaClientValidationError } from '@prisma/client/runtime/library';
import { GraphQLError } from 'graphql';

/**
 * Base error class for domain-specific errors
 */
export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * Base error class for infrastructure errors
 */
export class InfrastructureError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

/**
 * Common domain errors
 */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} with id ${id} not found`, 'NOT_FOUND');
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT');
  }
}

/**
 * Error context for logging and debugging
 */
export interface ErrorContext {
  userId?: string;
  operation?: string;
  resource?: string;
  [key: string]: any;
}

/**
 * Centralized error handler for consistent error handling across the application
 */
export class ErrorHandler {
  private static instance: ErrorHandler;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error and throw an appropriate exception
   */
  handle(error: unknown, context: ErrorContext): never {
    // Log the error with context
    this.logError(error, context);

    // Convert to appropriate error type and throw
    throw this.convertError(error, context);
  }

  /**
   * Handle an error asynchronously with a callback
   */
  async handleAsync<T>(
    operation: () => Promise<T>,
    context: ErrorContext
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handle(error, context);
    }
  }

  /**
   * Handle an error synchronously with a callback
   */
  handleSync<T>(
    operation: () => T,
    context: ErrorContext
  ): T {
    try {
      return operation();
    } catch (error) {
      this.handle(error, context);
    }
  }

  /**
   * Convert various error types to appropriate domain/infrastructure errors
   */
  private convertError(error: unknown, context: ErrorContext): Error {
    // Already a domain error, return as-is
    if (error instanceof DomainError) {
      return error;
    }

    // Already an infrastructure error, return as-is
    if (error instanceof InfrastructureError) {
      return error;
    }

    // GraphQL errors
    if (error instanceof GraphQLError) {
      return error;
    }

    // Prisma errors
    if (error instanceof PrismaClientKnownRequestError) {
      return this.handlePrismaError(error, context);
    }

    if (error instanceof PrismaClientValidationError) {
      return new ValidationError('Invalid data provided');
    }

    // Generic errors
    if (error instanceof Error) {
      return new InfrastructureError(error.message, error);
    }

    // Unknown errors
    return new InfrastructureError('An unexpected error occurred', error);
  }

  /**
   * Handle Prisma-specific errors
   */
  private handlePrismaError(
    error: PrismaClientKnownRequestError,
    context: ErrorContext
  ): Error {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation
        const field = error.meta?.target as string[] | undefined;
        return new ConflictError(
          `${context.resource || 'Resource'} with ${field?.join(', ') || 'field'} already exists`
        );

      case 'P2025':
        // Record not found
        return new NotFoundError(
          context.resource || 'Resource',
          context.id || 'unknown'
        );

      case 'P2003':
        // Foreign key constraint violation
        return new ValidationError('Related resource does not exist');

      case 'P2014':
        // Relation violation
        return new ValidationError('Invalid relation');

      default:
        return new InfrastructureError('Database operation failed', error);
    }
  }

  /**
   * Log error with appropriate level and context
   */
  private logError(error: unknown, context: ErrorContext): void {
    const errorInfo = {
      ...context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : error,
    };

    // Choose log level based on error type
    if (error instanceof DomainError) {
      // Domain errors are expected, log as warning
      logger.warn('Domain error occurred', errorInfo);
    } else if (error instanceof GraphQLError) {
      // GraphQL errors might be client errors
      logger.info('GraphQL error occurred', errorInfo);
    } else {
      // Unexpected errors, log as error
      logger.error('Unexpected error occurred', errorInfo);
    }
  }

  /**
   * Create a GraphQL-friendly error response
   */
  toGraphQLError(error: unknown, context?: ErrorContext): GraphQLError {
    if (error instanceof GraphQLError) {
      return error;
    }

    if (error instanceof DomainError) {
      return new GraphQLError(error.message, {
        extensions: {
          code: error.code,
          ...context,
        },
      });
    }

    if (error instanceof Error) {
      return new GraphQLError(error.message, {
        extensions: {
          code: 'INTERNAL_ERROR',
          ...context,
        },
      });
    }

    return new GraphQLError('An unexpected error occurred', {
      extensions: {
        code: 'UNKNOWN_ERROR',
        ...context,
      },
    });
  }

  /**
   * Wrap a function with error handling
   */
  wrap<TArgs extends any[], TReturn>(
    fn: (...args: TArgs) => TReturn,
    context: ErrorContext | ((args: TArgs) => ErrorContext)
  ): (...args: TArgs) => TReturn {
    return (...args: TArgs): TReturn => {
      const errorContext = typeof context === 'function' ? context(args) : context;
      return this.handleSync(() => fn(...args), errorContext);
    };
  }

  /**
   * Wrap an async function with error handling
   */
  wrapAsync<TArgs extends any[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn>,
    context: ErrorContext | ((args: TArgs) => ErrorContext)
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      const errorContext = typeof context === 'function' ? context(args) : context;
      return this.handleAsync(() => fn(...args), errorContext);
    };
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();