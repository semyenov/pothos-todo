import { loadConfig, watchConfig } from 'c12';
import { defu } from 'defu';
import { isDevelopment as isDevEnv, isProduction as isProdEnv, isTest as isTestEnv } from 'std-env';
import type { AppConfig, ConfigWatchOptions } from '../../config/types.js';

// Configuration loader instance
let configInstance: AppConfig | null = null;
let configWatcher: any = null;

/**
 * Load configuration using c12
 * @param reload - Force reload configuration
 * @returns Promise with loaded configuration
 */
export async function loadAppConfig(reload = false): Promise<AppConfig> {
  if (configInstance && !reload) {
    return configInstance;
  }

  try {
    const result = await loadConfig<AppConfig>({
      name: 'config',
      cwd: process.cwd(),
      configFile: 'config.ts',
      dotenv: true,
      packageJson: true,
      envName: process.env.NODE_ENV || 'development',
      defaults: {
        server: {
          port: 4000,
          host: 'localhost',
          cors: {
            origin: 'http://localhost:3000',
            credentials: true,
          },
        },
        database: {
          url: 'postgresql://postgres:password@localhost:5432/pothos_todo',
        },
        logger: {
          level: 'info' as const,
          service: 'pothos-todo',
        },
        env: {
          name: process.env.NODE_ENV || 'development',
          isDevelopment: isDevEnv,
          isProduction: isProdEnv,
          isTest: isTestEnv,
        },
      },
    });

    configInstance = result.config as AppConfig;
    return configInstance;
  } catch (error) {
    console.error('Failed to load configuration:', error);
    throw new Error(`Configuration loading failed: ${error}`);
  }
}

/**
 * Get current configuration without reloading
 * @returns Current configuration instance or null
 */
export function getCurrentConfig(): AppConfig | null {
  return configInstance;
}

/**
 * Watch configuration files for changes
 * @param options - Watch options
 * @returns Promise with watcher instance
 */
export async function watchAppConfig(options: ConfigWatchOptions = {}) {
  if (configWatcher) {
    await configWatcher.unwatch();
  }

  try {
    configWatcher = watchConfig<AppConfig>({
      name: 'config',
      cwd: process.cwd(),
      configFile: 'config.ts',
      dotenv: true,
      packageJson: true,
      envName: process.env.NODE_ENV || 'development',
      debounce: options.debounce || 100,
      onWatch: (event) => {
        console.log(`[config] ${event.type}: ${event.path}`);
        if (options.onWatch) {
          options.onWatch(event);
        }
      },
      onUpdate: ({ newConfig }) => {
        configInstance = newConfig as AppConfig;
        console.log('[config] Configuration updated');
        if (options.onUpdate) {
          options.onUpdate(newConfig as AppConfig);
        }
      },
    });

    return configWatcher;
  } catch (error) {
    console.error('Failed to watch configuration:', error);
    throw new Error(`Configuration watching failed: ${error}`);
  }
}

/**
 * Stop watching configuration files
 */
export async function stopWatchingConfig() {
  if (configWatcher) {
    await configWatcher.unwatch();
    configWatcher = null;
  }
}

/**
 * Validate configuration structure
 * @param config - Configuration to validate
 * @returns Validation result
 */
export function validateConfig(config: AppConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Server validation
  if (config.server) {
    if (config.server.port && (config.server.port < 1 || config.server.port > 65535)) {
      errors.push('Server port must be between 1 and 65535');
    }

    if (config.server.cors?.origin === undefined) {
      errors.push('Server CORS origin is undefined - please set FRONTEND_URL environment variable');
    }
  }

  // Database validation
  if (config.database && !config.database.url) {
    errors.push('Database URL is required when database config is provided');
  }

  // Logger validation
  if (config.logger) {
    if (config.logger.level && !['error', 'warn', 'info', 'debug', 'silent'].includes(config.logger.level)) {
      errors.push('Logger level must be one of: error, warn, info, debug, silent');
    }

    if (!config.logger.service) {
      errors.push('Logger service name is required when logger config is provided');
    }
  }

  // Build validation
  if (config.build) {
    if (config.build.outDir === '') {
      errors.push('Build output directory cannot be empty');
    }

    if (config.build.target === '') {
      errors.push('Build target cannot be empty');
    }
  }

  // Environment validation
  if (config.env) {
    if (!config.env.name) {
      errors.push('Environment name is required when env config is provided');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get configuration value by key path
 * @param keyPath - Dot-separated key path (e.g., 'server.port')
 * @param defaultValue - Default value if key not found
 * @returns Configuration value
 */
export function getConfigValue<T = any>(keyPath: string, defaultValue?: T): T {
  if (!configInstance) {
    throw new Error('Configuration not loaded. Call loadAppConfig() first.');
  }

  const keys = keyPath.split('.');
  let value: any = configInstance;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue as T;
    }
  }

  return value as T;
}

/**
 * Type-safe configuration getter with defaults
 * @param keyPath - Dot-separated key path 
 * @param defaultValue - Default value if key not found
 * @returns Configuration value
 */
export function getConfigValueSafe<T>(keyPath: string, defaultValue: T): T {
  try {
    return getConfigValue(keyPath, defaultValue);
  } catch (error) {
    console.warn(`Configuration value not found for key: ${keyPath}, using default`);
    return defaultValue;
  }
}

/**
 * Get server configuration
 */
export function getServerConfig() {
  const defaults = {
    port: 4000,
    host: 'localhost',
    cors: {
      origin: 'http://localhost:3000',
      credentials: true,
    },
    session: {
      secret: 'fallback-key',
      name: 'h3-session',
      maxAge: 60 * 60 * 24 * 7,
      secure: false,
      sameSite: 'lax' as const,
    },
  } as const;
  return defu(getConfigValue('server', {}), defaults);
}

/**
 * Get session configuration
 */
export function getSessionConfig() {
  const defaults = {
    secret: 'fallback-key',
    name: 'h3-session',
    maxAge: 60 * 60 * 24 * 7,
    secure: false,
    sameSite: 'lax' as const,
  };
  return defu(getConfigValue('server.session', {}), defaults);
}

/**
 * Get OAuth configuration
 */
export function getOAuthConfig() {
  const defaults = {
    google: {
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://localhost:4000/auth/google/callback',
    },
    github: {
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://localhost:4000/auth/github/callback',
    },
  };
  return defu(getConfigValue('server.oauth', {}), defaults);
}

/**
 * Get database configuration
 */
export function getDatabaseConfig() {
  const defaults = {
    url: 'postgresql://postgres:password@localhost:5432/pothos_todo',
  };
  return defu(getConfigValue('database', {}), defaults);
}

/**
 * Get logger configuration
 */
export function getLoggerConfig() {
  const defaults = {
    level: 'info' as const,
    service: 'pothos-todo',
  };
  return defu(getConfigValue('logger', {}), defaults);
}

/**
 * Get build configuration
 */
export function getBuildConfig() {
  return getConfigValue('build');
}

/**
 * Get CLI configuration
 */
export function getCLIConfig() {
  return getConfigValue('cli');
}

/**
 * Get Docker configuration
 */
export function getDockerConfig() {
  return getConfigValue('docker');
}

/**
 * Get GraphQL configuration
 */
export function getGraphQLConfig() {
  return getConfigValue('graphql');
}

/**
 * Get environment configuration
 */
export function getEnvironmentConfig() {
  return getConfigValue('env');
}

/**
 * Get telemetry configuration
 */
export function getTelemetryConfig() {
  const defaults = {
    enabled: false,
    serviceName: 'pothos-todo-api',
    serviceVersion: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    exporterUrl: undefined,
    exporterHeaders: undefined,
    samplingRate: 1.0,
  };
  return defu(getConfigValue('telemetry', {}), defaults);
}

/**
 * Get cache configuration
 */
export function getCacheConfig() {
  const defaults = {
    enabled: true,
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0,
      keyPrefix: 'pothos:',
      ttl: 3600,
    },
  };
  return defu(getConfigValue('cache', {}), defaults);
}

/**
 * Get AI configuration
 */
export function getAIConfig() {
  const defaults = {
    enabled: true,
    openai: {
      apiKey: '',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    vectorStore: {
      url: 'http://localhost:6333',
      apiKey: undefined,
    },
  };
  return defu(getConfigValue('ai', {}), defaults);
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return isDevEnv;
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return isProdEnv;
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return isTestEnv;
}

/**
 * Export configuration for CLI usage
 */
export async function exportConfig(): Promise<AppConfig> {
  return await loadAppConfig();
}

// Default export for convenience
export default {
  loadAppConfig,
  getCurrentConfig,
  watchAppConfig,
  stopWatchingConfig,
  validateConfig,
  getConfigValue,
  getServerConfig,
  getDatabaseConfig,
  getLoggerConfig,
  getBuildConfig,
  getCLIConfig,
  getDockerConfig,
  getGraphQLConfig,
  getEnvironmentConfig,
  isDevelopment,
  isProduction,
  isTest,
  exportConfig,
};