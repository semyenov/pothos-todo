import { createConsola, type ConsolaInstance, type LogObject } from 'consola';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'pathe';
import { AsyncLocalStorage } from 'node:async_hooks';
import { nanoid } from 'nanoid';

export interface LoggerConfig {
  level?: string;
  service?: string;
  version?: string;
  dir?: string;
  files?: {
    debug?: string;
    error?: string;
  };
}

export type Logger = ConsolaInstance;

// AsyncLocalStorage for correlation IDs
const correlationStore = new AsyncLocalStorage<{ correlationId: string; requestId?: string }>();

export function createLogger(config?: LoggerConfig): ConsolaInstance {
  // Get logger configuration
  const loggerConfig = config || {
    level: 'info',
    service: 'pothos-todo',
    version: '1.0.0',
    dir: '.out/logs',
    files: {
      debug: 'debug.log',
      error: 'errors.log',
    },
    console: {
      enabled: true,
    },
  };

  // Ensure log directory exists
  if (loggerConfig.dir && !existsSync(loggerConfig.dir)) {
    mkdirSync(loggerConfig.dir, { recursive: true });
  }

  // Create consola instance with configuration
  const logger = createConsola({
    level: mapLogLevel(loggerConfig.level),
    formatOptions: {
      date: true,
      colors: true,
      compact: false,
    },
    // Add custom reporters for file logging
    reporters: [
      // Default reporter for console output
      ...(loggerConfig.console?.enabled !== false ? [{
        log: (logObj: unknown) => {
          // Use consola's default console reporter
          return;
        }
      }] : []),
      // File reporter for errors
      {
        log: (logObj: LogObject) => {
          if (!loggerConfig.dir || !loggerConfig.files) return;

          const context = correlationStore.getStore();
          const timestamp = new Date().toISOString();
          const logEntry = {
            timestamp,
            level: logObj.level,
            type: logObj.type,
            tag: logObj.tag,
            message: logObj.args.join(' '),
            service: loggerConfig.service,
            version: loggerConfig.version,
            correlationId: context?.correlationId,
            requestId: context?.requestId,
          };

          // Write errors to error log
          if (logObj.level === 0) { // error level
            const errorPath = join(loggerConfig.dir, loggerConfig.files.error);
            appendFileSync(errorPath, JSON.stringify(logEntry) + '\n');
          }

          // Write all logs to debug log
          const debugPath = join(loggerConfig.dir, loggerConfig.files.debug);
          appendFileSync(debugPath, JSON.stringify(logEntry) + '\n');
        },
      },
    ],
  });

  // Add service metadata to all logs
  logger.withTag(loggerConfig.service);

  return logger;
}

// Map winston log levels to consola levels
function mapLogLevel(level: string): number {
  const levelMap: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 3,
    debug: 4,
    silent: -999,
  };
  return levelMap[level] || 3; // default to info
}

// Create and export the default logger instance
export const logger = createLogger();

// Re-export common log methods for convenience
// Using any to bypass type inference issues with consola's LogFn
export const error: any = logger.error.bind(logger);
export const warn: any = logger.warn.bind(logger);
export const info: any = logger.info.bind(logger);
export const debug: any = logger.debug.bind(logger);
export const success: any = logger.success.bind(logger);
export const log: any = logger.log.bind(logger);
export const start: any = logger.start.bind(logger);
export const ready: any = logger.ready.bind(logger);
export const box: any = logger.box.bind(logger);

// Correlation ID management
export function withCorrelationId<T>(
  correlationId: string,
  requestId: string | undefined,
  fn: () => T
): T {
  return correlationStore.run({ correlationId, requestId }, fn);
}

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function getRequestId(): string | undefined {
  return correlationStore.getStore()?.requestId;
}

export function generateCorrelationId(): string {
  return nanoid(16);
}
