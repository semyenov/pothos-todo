import { createConsola, type ConsolaInstance } from 'consola';
import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'pathe';
import { env } from '@/config/env.validation.js';
import { SingletonService } from '../core/SingletonService.js';

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  sessionId?: string;
  operationName?: string;
  operationType?: string;
  userAgent?: string;
  ip?: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  context?: LogContext;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
  performance?: {
    duration: number;
    startTime: number;
    endTime: number;
  };
  security?: {
    event: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details?: Record<string, any>;
  };
}

export class StructuredLogger extends SingletonService<StructuredLogger> {
  private logger: ConsolaInstance;
  private contextStorage = new AsyncLocalStorage<LogContext>();
  private logBuffer: StructuredLogEntry[] = [];
  private bufferSize = 1000;
  private flushInterval: NodeJS.Timeout | null = null;

  protected constructor() {
    super();
    this.logger = createConsola({
      level: this.mapLogLevel(env.LOG_LEVEL),
      formatOptions: {
        colors: env.NODE_ENV === 'development',
        compact: env.NODE_ENV === 'production',
        date: true,
      },
    });

    // Setup log file rotation if in production
    if (env.NODE_ENV === 'production') {
      this.setupLogRotation();
    }

    // Setup periodic buffer flush
    this.flushInterval = setInterval(() => {
      this.flushBuffer();
    }, 5000); // Flush every 5 seconds
  }

  public static async getInstance(): Promise<StructuredLogger> {
    return super.getInstance();
  }

  /**
   * Set log context for the current execution
   */
  public setContext(context: LogContext): void {
    const current = this.contextStorage.getStore() || {};
    this.contextStorage.enterWith({ ...current, ...context });
  }

  /**
   * Get current log context
   */
  public getContext(): LogContext | undefined {
    return this.contextStorage.getStore();
  }

  /**
   * Run code with specific log context
   */
  public withContext<T>(context: LogContext, fn: () => T): T {
    const current = this.contextStorage.getStore() || {};
    return this.contextStorage.run({ ...current, ...context }, fn);
  }

  /**
   * Log an info message
   */
  public info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata);
  }

  /**
   * Log a debug message
   */
  public debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata);
  }

  /**
   * Log a warning message
   */
  public warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata);
  }

  /**
   * Log an error message
   */
  public error(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorInfo = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : undefined;

    this.log('error', message, metadata, { error: errorInfo });
  }

  /**
   * Log a fatal error message
   */
  public fatal(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorInfo = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : undefined;

    this.log('fatal', message, metadata, { error: errorInfo });
  }

  /**
   * Log a security event
   */
  public security(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details?: Record<string, any>
  ): void {
    this.log('warn', `Security event: ${event}`, undefined, {
      security: {
        event,
        severity,
        details,
      },
    });
  }

  /**
   * Log a performance event
   */
  public performance(
    message: string,
    duration: number,
    startTime: number,
    metadata?: Record<string, any>
  ): void {
    this.log('info', message, metadata, {
      performance: {
        duration,
        startTime,
        endTime: startTime + duration,
      },
    });
  }

  /**
   * Log with timing (decorator style)
   */
  public async withTiming<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      this.performance(`${operation} completed`, duration, startTime, metadata);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.error(`${operation} failed`, error as Error, {
        ...metadata,
        duration,
      });
      throw error;
    }
  }

  /**
   * Core logging method
   */
  private log(
    level: StructuredLogEntry['level'],
    message: string,
    metadata?: Record<string, any>,
    additional?: Partial<StructuredLogEntry>
  ): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.getContext(),
      metadata: this.sanitizeMetadata(metadata),
      ...additional,
    };

    // Add to buffer for batch processing
    this.logBuffer.push(entry);

    // Flush buffer if it's getting full
    if (this.logBuffer.length >= this.bufferSize) {
      this.flushBuffer();
    }

    // Also log to console immediately for development
    if (env.NODE_ENV === 'development') {
      this.logToConsole(entry);
    }
  }

  /**
   * Log to console with formatting
   */
  private logToConsole(entry: StructuredLogEntry): void {
    const context = entry.context;
    const contextStr = context ? 
      `[${context.requestId || 'no-req'}${context.traceId ? `:${context.traceId.slice(-8)}` : ''}]` : 
      '';

    const metaStr = entry.metadata ? 
      Object.keys(entry.metadata).length > 0 ? JSON.stringify(entry.metadata, null, 2) : '' : 
      '';

    const logMessage = `${contextStr} ${entry.message}${metaStr ? `\n${metaStr}` : ''}`;

    switch (entry.level) {
      case 'trace':
      case 'debug':
        this.logger.debug(logMessage);
        break;
      case 'info':
        this.logger.info(logMessage);
        break;
      case 'warn':
        this.logger.warn(logMessage);
        break;
      case 'error':
      case 'fatal':
        this.logger.error(logMessage, entry.error);
        break;
    }
  }

  /**
   * Flush log buffer to file
   */
  private flushBuffer(): void {
    if (this.logBuffer.length === 0) return;

    const entries = [...this.logBuffer];
    this.logBuffer = [];

    if (env.NODE_ENV === 'production') {
      this.writeToFile(entries);
    }

    // Send to external logging service if configured
    this.sendToExternalService(entries);
  }

  /**
   * Write logs to file
   */
  private writeToFile(entries: StructuredLogEntry[]): void {
    try {
      const logDir = join(process.cwd(), 'logs');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const today = new Date().toISOString().split('T')[0];
      const logFile = join(logDir, `app-${today}.log`);

      const logLines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      writeFileSync(logFile, logLines, { flag: 'a' });
    } catch (error) {
      this.logger.error('Failed to write logs to file', error);
    }
  }

  /**
   * Send logs to external service (placeholder)
   */
  private sendToExternalService(entries: StructuredLogEntry[]): void {
    // This would send logs to services like:
    // - DataDog
    // - New Relic
    // - Elasticsearch
    // - Splunk
    // - CloudWatch
    
    // For now, just count them in metrics
    const MetricsCollector = require('../monitoring/MetricsCollector.js').MetricsCollector;
    const metrics = MetricsCollector.getInstance();
    
    entries.forEach(entry => {
      metrics.recordMetric('log.entry', 1, {
        level: entry.level,
        hasError: !!entry.error,
        hasContext: !!entry.context,
      });
    });
  }

  /**
   * Sanitize metadata to remove sensitive information
   */
  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;

    const sensitiveKeys = [
      'password', 'passwd', 'pwd',
      'secret', 'token', 'key', 'apikey', 'api_key',
      'authorization', 'auth', 'cookie', 'session',
      'credit_card', 'creditcard', 'cc', 'ssn',
    ];

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      const keyLower = key.toLowerCase();
      const isSensitive = sensitiveKeys.some(sensitive => keyLower.includes(sensitive));

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item => 
            typeof item === 'object' ? '[Object]' : item
          );
        } else {
          sanitized[key] = this.sanitizeMetadata(value as Record<string, any>);
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Setup log rotation for production
   */
  private setupLogRotation(): void {
    // Rotate logs daily at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.rotateLog();
      
      // Set up daily rotation
      setInterval(() => {
        this.rotateLog();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilMidnight);
  }

  /**
   * Rotate log files
   */
  private rotateLog(): void {
    try {
      const logDir = join(process.cwd(), 'logs');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      // Archive old logs (could compress or move to archive location)
      this.info('Log rotation completed', { date: yesterdayStr });
    } catch (error) {
      this.logger.error('Failed to rotate logs', error);
    }
  }

  /**
   * Map log level string to consola level
   */
  private mapLogLevel(level: string): number {
    switch (level.toLowerCase()) {
      case 'trace': return 0;
      case 'debug': return 1;
      case 'info': return 2;
      case 'warn': return 3;
      case 'error': return 4;
      case 'fatal': return 5;
      default: return 2; // info
    }
  }

  /**
   * Shutdown logger and flush remaining logs
   */
  public async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining logs
    this.flushBuffer();

    this.info('Logger shutdown completed');
  }
}

/**
 * Create middleware for automatic request logging
 */
export function createRequestLoggingMiddleware() {
  const structuredLogger = StructuredLogger.getInstance();

  return (event: any) => {
    const startTime = Date.now();
    const requestId = event.context.requestId || 'unknown';
    const correlationId = event.context.correlationId || 'unknown';
    const method = event.node.req.method;
    const url = event.node.req.url;
    const userAgent = event.node.req.headers['user-agent'];
    const ip = event.node.req.headers['x-forwarded-for'] || 
               event.node.req.connection?.remoteAddress;

    // Set request context
    structuredLogger.setContext({
      requestId,
      correlationId,
      userAgent,
      ip,
    });

    // Log request start
    structuredLogger.info('Request started', {
      method,
      url,
      userAgent,
      ip,
    });

    // Log response on finish
    event.node.res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = event.node.res.statusCode;

      structuredLogger.performance(
        'Request completed',
        duration,
        startTime,
        {
          method,
          url,
          statusCode,
          userAgent,
          ip,
        }
      );
    });
  };
}

/**
 * Logging decorator for methods
 */
export function LogMethod(message?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const logger = StructuredLogger.getInstance();
    
    descriptor.value = async function (...args: any[]) {
      const logMessage = message || `${target.constructor.name}.${propertyKey}`;
      
      return logger.withTiming(logMessage, async () => {
        return originalMethod.apply(this, args);
      }, {
        class: target.constructor.name,
        method: propertyKey,
      });
    };
    
    return descriptor;
  };
}

// Export singleton instance
export const structuredLogger = StructuredLogger.getInstance();