/**
 * Enhanced configuration management using UnJS utilities
 * Provides advanced configuration loading, validation, and management
 */

import { loadConfig } from "unconfig";
import { defu } from "defu";
import { pathUtils, objectUtils, logger } from "@/lib/unjs-utils.js";
import { z } from "zod";
import { validationService } from "@/infrastructure/validation/UnJSValidation.js";
import { isDevelopment, isProduction, isTest } from "std-env";
import { fileSystemService } from "@/infrastructure/filesystem/UnJSFileSystem.js";

export interface ConfigSource {
  source: string;
  data: any;
  priority: number;
  lastModified?: Date;
}

export interface ConfigLoadOptions {
  sources?: string[];
  defaults?: any;
  validate?: boolean;
  watch?: boolean;
  transform?: (config: any) => any;
  merge?: "shallow" | "deep";
}

export interface ConfigValidationSchema {
  server?: {
    port?: number;
    host?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
  };
  database?: {
    url?: string;
    poolSize?: number;
  };
  redis?: {
    host?: string;
    port?: number;
    password?: string;
  };
  ai?: {
    openaiApiKey?: string;
    embeddingModel?: string;
    qdrantUrl?: string;
  };
  security?: {
    sessionSecret?: string;
    rateLimitEnabled?: boolean;
    corsEnabled?: boolean;
  };
  logging?: {
    level?: string;
    format?: string;
    file?: string;
  };
}

/**
 * Advanced configuration manager using UnJS utilities
 */
export class UnJSConfigManager {
  private configs: Map<string, any> = new Map();
  private sources: Map<string, ConfigSource> = new Map();
  private watchers: Map<string, string> = new Map();
  private validationSchema?: z.ZodSchema;

  constructor() {
    this.setupValidationSchema();
  }

  /**
   * Setup configuration validation schema
   */
  private setupValidationSchema(): void {
    const configSchema = z.object({
      server: z
        .object({
          port: z.number().min(1).max(65535).default(4000),
          host: z.string().default("localhost"),
          cors: z
            .object({
              origin: z.union([z.string(), z.array(z.string())]).default("*"),
              credentials: z.boolean().default(true),
            })
            .optional(),
        })
        .optional(),

      database: z
        .object({
          url: z.string().url(),
          poolSize: z.number().min(1).max(100).default(10),
          ssl: z.boolean().default(false),
        })
        .optional(),

      redis: z
        .object({
          host: z.string().default("localhost"),
          port: z.number().min(1).max(65535).default(6379),
          password: z.string().optional(),
          db: z.number().min(0).default(0),
        })
        .optional(),

      ai: z
        .object({
          enabled: z.boolean().default(true),
          openaiApiKey: z.string().optional(),
          embeddingModel: z.string().default("text-embedding-3-small"),
          embeddingDimensions: z.number().default(1536),
          qdrantUrl: z.string().url().default("http://localhost:6333"),
          qdrantApiKey: z.string().optional(),
        })
        .optional(),

      security: z
        .object({
          sessionSecret: z.string().min(32),
          rateLimitEnabled: z.boolean().default(true),
          corsEnabled: z.boolean().default(true),
          csrfEnabled: z.boolean().default(true),
          helmetEnabled: z.boolean().default(true),
        })
        .optional(),

      logging: z
        .object({
          level: z
            .enum(["trace", "debug", "info", "warn", "error", "fatal"])
            .default("info"),
          format: z.enum(["json", "pretty", "minimal"]).default("pretty"),
          file: z.string().optional(),
          maxSize: z.string().default("10MB"),
          maxFiles: z.number().default(5),
        })
        .optional(),

      monitoring: z
        .object({
          enabled: z.boolean().default(true),
          prometheusEnabled: z.boolean().default(true),
          tracingEnabled: z.boolean().default(true),
          metricsEnabled: z.boolean().default(true),
          healthCheckEnabled: z.boolean().default(true),
        })
        .optional(),

      features: z
        .object({
          graphiql: z.boolean().default(isDevelopment),
          subscriptions: z.boolean().default(true),
          federationEnabled: z.boolean().default(false),
          cachingEnabled: z.boolean().default(true),
          aiEnabled: z.boolean().default(true),
        })
        .optional(),
    });

    this.validationSchema = configSchema;
    validationService.registerSchema("appConfig", configSchema);
  }

  /**
   * Load configuration from multiple sources
   */
  async loadConfiguration(
    name: string = "default",
    options: ConfigLoadOptions = {}
  ): Promise<{ config: any; sources: ConfigSource[] }> {
    const {
      sources = this.getDefaultSources(),
      defaults = this.getDefaultConfig(),
      validate = true,
      watch = isDevelopment,
      transform,
      merge = "deep",
    } = options;

    logger.debug("Loading configuration", { name, sources: sources.length });

    const loadedSources: ConfigSource[] = [];
    let mergedConfig = defaults;

    // Load from each source
    for (const source of sources) {
      try {
        const { config: sourceConfig } = await loadConfig({
          sources: [
            {
              files: [source],
              transform(code, filepath) {
                return code;
              },
            },
          ],
          defaults: {},
        });

        if (sourceConfig && Object.keys(sourceConfig).length > 0) {
          const configSource: ConfigSource = {
            source,
            data: sourceConfig,
            priority: this.getSourcePriority(source),
          };

          loadedSources.push(configSource);

          // Merge configuration based on strategy
          if (merge === "deep") {
            mergedConfig = defu(sourceConfig, mergedConfig);
          } else {
            mergedConfig = { ...mergedConfig, ...sourceConfig };
          }
        }
      } catch (error) {
        logger.warn("Failed to load config source", { source, error });
      }
    }

    // Apply transformation if provided
    if (transform) {
      mergedConfig = transform(mergedConfig);
    }

    // Validate configuration
    if (validate && this.validationSchema) {
      try {
        const validationResult = await validationService.validate(
          "appConfig",
          mergedConfig
        );
        if (!validationResult.success) {
          logger.error("Configuration validation failed", {
            errors: validationResult.errors,
          });
          throw new Error(
            `Configuration validation failed: ${validationResult.errors
              ?.map((e) => e.message)
              .join(", ")}`
          );
        }
        mergedConfig = validationResult.data;
      } catch (error) {
        logger.error("Configuration validation error", { error });
        throw error;
      }
    }

    // Store configuration
    this.configs.set(name, mergedConfig);
    loadedSources.forEach((source) => {
      this.sources.set(`${name}:${source.source}`, source);
    });

    // Setup file watching if enabled
    if (watch) {
      await this.setupConfigWatching(name, sources);
    }

    logger.info("Configuration loaded successfully", {
      name,
      sourcesLoaded: loadedSources.length,
      configKeys: Object.keys(mergedConfig).length,
    });

    return {
      config: mergedConfig,
      sources: loadedSources.sort((a, b) => b.priority - a.priority),
    };
  }

  /**
   * Get default configuration sources
   */
  private getDefaultSources(): string[] {
    const sources = [
      // Package.json
      "package.json",

      // Config files
      "config.json",
      "config.js",
      "config.ts",
      ".config.js",
      ".config.ts",

      // Environment-specific configs
      `config.${process.env.NODE_ENV}.json`,
      `config.${process.env.NODE_ENV}.js`,
      `config.${process.env.NODE_ENV}.ts`,

      // Local configs (ignored by git)
      "config.local.json",
      "config.local.js",
      "config.local.ts",

      // Environment variables
      "env:",
    ];

    return sources.filter((source) => {
      if (source.startsWith("env:")) return true;
      return fileSystemService.readFile(source) !== null;
    });
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): any {
    return {
      server: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4000,
        host: process.env.HOST || "localhost",
        cors: {
          origin: process.env.CORS_ORIGIN || (isDevelopment ? "*" : false),
          credentials: true,
        },
      },
      database: {
        url:
          process.env.DATABASE_URL ||
          "postgresql://postgres:password@localhost:5432/pothos_todo",
        poolSize: process.env.DATABASE_POOL_SIZE
          ? parseInt(process.env.DATABASE_POOL_SIZE)
          : 10,
      },
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD,
      },
      ai: {
        enabled: process.env.AI_ENABLED !== "false",
        openaiApiKey: process.env.OPENAI_API_KEY,
        embeddingModel:
          process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        embeddingDimensions: process.env.OPENAI_EMBEDDING_DIMENSIONS
          ? parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS)
          : 1536,
        qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
        qdrantApiKey: process.env.QDRANT_API_KEY,
      },
      security: {
        sessionSecret:
          process.env.SESSION_SECRET ||
          "default-session-secret-change-in-production",
        rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== "false",
        corsEnabled: process.env.CORS_ENABLED !== "false",
      },
      logging: {
        level: process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info"),
        format: process.env.LOG_FORMAT || (isDevelopment ? "pretty" : "json"),
        file: process.env.LOG_FILE,
      },
      environment: {
        name: process.env.NODE_ENV || "development",
        isDevelopment,
        isProduction,
        isTest,
      },
    };
  }

  /**
   * Get source priority for merging order
   */
  private getSourcePriority(source: string): number {
    if (source.startsWith("env:")) return 100;
    if (source.includes(".local.")) return 90;
    if (source.includes(`.${process.env.NODE_ENV}.`)) return 80;
    if (source === "package.json") return 10;
    return 50;
  }

  /**
   * Setup file watching for configuration changes
   */
  private async setupConfigWatching(
    name: string,
    sources: string[]
  ): Promise<void> {
    for (const source of sources) {
      if (source.startsWith("env:")) continue;

      try {
        const watchId = await fileSystemService.watch(
          source,
          async (event, filePath) => {
            if (event === "change") {
              logger.info("Configuration file changed, reloading", {
                source: filePath,
              });
              await this.reloadConfiguration(name);
            }
          },
          { persistent: false }
        );

        this.watchers.set(`${name}:${source}`, watchId);
      } catch (error) {
        logger.warn("Failed to setup config watching", { source, error });
      }
    }
  }

  /**
   * Reload configuration
   */
  async reloadConfiguration(name: string = "default"): Promise<any> {
    logger.info("Reloading configuration", { name });

    const { config } = await this.loadConfiguration(name, {
      watch: false, // Avoid re-setting up watchers
    });

    return config;
  }

  /**
   * Get configuration by name
   */
  getConfig<T = any>(name: string = "default"): T | null {
    return this.configs.get(name) || null;
  }

  /**
   * Get configuration value by path
   */
  getConfigValue<T = any>(
    path: string,
    name: string = "default",
    defaultValue?: T
  ): T {
    const config = this.getConfig(name);
    if (!config) return defaultValue as T;

    return this.getNestedValue(config, path, defaultValue);
  }

  /**
   * Set configuration value by path
   */
  setConfigValue(path: string, value: any, name: string = "default"): boolean {
    const config = this.getConfig(name);
    if (!config) return false;

    this.setNestedValue(config, path, value);
    this.configs.set(name, config);
    return true;
  }

  /**
   * Write configuration to file
   */
  async writeConfiguration(
    configName: string,
    filePath: string,
    format: "json" | "js" | "ts" = "json"
  ): Promise<boolean> {
    const config = this.getConfig(configName);
    if (!config) return false;

    try {
      let content: string;

      switch (format) {
        case "json":
          content = JSON.stringify(config, null, 2);
          break;
        case "js":
          content = `module.exports = ${JSON.stringify(config, null, 2)};`;
          break;
        case "ts":
          content = `export default ${JSON.stringify(
            config,
            null,
            2
          )} as const;`;
          break;
        default:
          content = JSON.stringify(config, null, 2);
      }

      const result = await fileSystemService.writeFile(filePath, content);
      return result.success;
    } catch (error) {
      logger.error("Failed to write configuration", {
        configName,
        filePath,
        error,
      });
      return false;
    }
  }

  /**
   * Get configuration sources info
   */
  getConfigSources(name: string = "default"): ConfigSource[] {
    const sources: ConfigSource[] = [];

    for (const [key, source] of this.sources.entries()) {
      if (key.startsWith(`${name}:`)) {
        sources.push(source);
      }
    }

    return sources.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Validate configuration
   */
  async validateConfiguration(name: string = "default"): Promise<{
    valid: boolean;
    errors?: any[];
    warnings?: string[];
  }> {
    const config = this.getConfig(name);
    if (!config) {
      return { valid: false, errors: ["Configuration not found"] };
    }

    const result = await validationService.validate("appConfig", config);

    return {
      valid: result.success,
      errors: result.errors,
      warnings: this.getConfigWarnings(config),
    };
  }

  /**
   * Get configuration warnings
   */
  private getConfigWarnings(config: any): string[] {
    const warnings: string[] = [];

    // Check for development secrets in production
    if (isProduction) {
      if (
        config.security?.sessionSecret ===
        "default-session-secret-change-in-production"
      ) {
        warnings.push("Using default session secret in production");
      }

      if (
        !config.database?.ssl &&
        config.database?.url?.includes("localhost")
      ) {
        warnings.push("Database SSL disabled in production");
      }
    }

    // Check for missing AI configuration
    if (config.ai?.enabled && !config.ai?.openaiApiKey) {
      warnings.push("AI features enabled but OpenAI API key not configured");
    }

    return warnings;
  }

  /**
   * Get nested configuration value
   */
  private getNestedValue(obj: any, path: string, defaultValue?: any): any {
    const keys = path.split(".");
    let current = obj;

    for (const key of keys) {
      if (current == null || typeof current !== "object") {
        return defaultValue;
      }
      current = current[key];
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * Set nested configuration value
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    const lastKey = keys.pop()!;
    let current = obj;

    for (const key of keys) {
      if (!(key in current) || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }

  /**
   * Clean up watchers
   */
  async cleanup(): Promise<void> {
    const watcherIds = Array.from(this.watchers.values());
    await Promise.all(watcherIds.map((id) => fileSystemService.unwatch(id)));
    this.watchers.clear();
    logger.info("Configuration manager cleaned up", {
      watchersRemoved: watcherIds.length,
    });
  }
}

// Singleton instance
export const configManager = new UnJSConfigManager();

// Initialize default configuration
let defaultConfig: any = null;

export async function initializeConfig(): Promise<any> {
  if (!defaultConfig) {
    const { config } = await configManager.loadConfiguration("default");
    defaultConfig = config;
  }
  return defaultConfig;
}

export function getConfig<T = any>(): T {
  return defaultConfig as T;
}

export function getConfigValue<T = any>(path: string, defaultValue?: T): T {
  return configManager.getConfigValue(path, "default", defaultValue);
}

// Export commonly used config getters (maintaining backward compatibility)
export const getServerConfig = () => getConfigValue("server", {});
export const getDatabaseConfig = () => getConfigValue("database", {});
export const getRedisConfig = () => getConfigValue("redis", {});
export const getAIConfig = () => getConfigValue("ai", {});
export const getSecurityConfig = () => getConfigValue("security", {});
export const getLoggingConfig = () => getConfigValue("logging", {});
export const getSessionConfig = () => getConfigValue("session", {});
export const getTelemetryConfig = () => getConfigValue("monitoring", {});
export const getCacheConfig = () => getConfigValue("cache", { enabled: true });
