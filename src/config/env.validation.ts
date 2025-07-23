import { z } from 'zod';
import { config } from 'dotenv';
import { join } from 'pathe';
import { existsSync } from 'fs';
import { logger } from '@/logger';
import type { $ZodIssue } from 'zod/v4/core';

// Load environment variables
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

// Environment variable schema
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server configuration
  PORT: z.string().regex(/^\d+$/).transform(Number).default(4000),
  HOST: z.string().default('localhost'),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DATABASE_POOL_SIZE: z.string().regex(/^\d+$/).transform(Number).default(10),

  // Session
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters'),

  // OAuth (optional in development)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),

  // Frontend URL
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Redis (optional)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().regex(/^\d+$/).transform(Number).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().regex(/^\d+$/).transform(Number).default(0),
  REDIS_KEY_PREFIX: z.string().default('pothos:'),

  // Cache
  CACHE_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default(true),
  CACHE_DEFAULT_TTL: z.string().regex(/^\d+$/).transform(Number).default(3600),

  // AI Services (optional)
  AI_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default(true),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_EMBEDDING_DIMENSIONS: z.string().regex(/^\d+$/).transform(Number).default(1536),

  // Vector Store (optional)
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),

  // Telemetry (optional)
  TELEMETRY_ENABLED: z.string().transform(v => v === 'true').default(false),
  TELEMETRY_SERVICE_NAME: z.string().default('pothos-todo-api'),
  TELEMETRY_SERVICE_VERSION: z.string().default('1.0.0'),
  TELEMETRY_SAMPLING_RATE: z.string().regex(/^[0-9.]+$/).transform(Number).default(1.0),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),

  // Security
  CSP_REPORT_URI: z.url().optional(),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  TLS_CA_PATH: z.string().optional(),
  TLS_PFX_PATH: z.string().optional(),
  HTTPS_PORT: z.string().regex(/^\d+$/).transform(Number).default(8443),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Parse and validate environment variables
export function validateEnv() {
  try {
    const env = envSchema.parse(process.env);

    // Additional validation logic
    if (env.NODE_ENV === 'production') {
      // Required in production
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
        throw new Error('SESSION_SECRET must be set and at least 32 characters in production');
      }

      // OAuth should be configured in production
      if (!env.GOOGLE_CLIENT_ID || !env.GITHUB_CLIENT_ID) {
        logger.warn('OAuth providers not fully configured for production');
      }

      // HTTPS should be enabled in production
      if (!env.TLS_CERT_PATH && !env.TLS_PFX_PATH) {
        logger.warn('TLS/HTTPS not configured for production');
      }
    }

    // AI features validation
    if (env.AI_ENABLED && !env.OPENAI_API_KEY) {
      logger.warn('AI is enabled but OPENAI_API_KEY is not set. AI features will be disabled.');
      env.AI_ENABLED = false;
    }

    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.issues.forEach((err: $ZodIssue) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

// Export validated environment variables
export const env = validateEnv();

// Type-safe environment access
export type Env = z.infer<typeof envSchema>;

// Helper to check if we're in production
export const isProduction = () => env.NODE_ENV === 'production';
export const isDevelopment = () => env.NODE_ENV === 'development';
export const isTest = () => env.NODE_ENV === 'test';

// Export individual config sections for convenience
export const getServerConfig = () => ({
  port: env.PORT,
  host: env.HOST,
  httpsPort: env.HTTPS_PORT,
});

export const getDatabaseConfig = () => ({
  url: env.DATABASE_URL,
  poolSize: env.DATABASE_POOL_SIZE,
});

export const getRedisConfig = () => ({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
  keyPrefix: env.REDIS_KEY_PREFIX,
});

export const getOAuthConfig = () => ({
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${env.FRONTEND_URL}/auth/google/callback`,
  },
  github: {
    clientId: env.GITHUB_CLIENT_ID || '',
    clientSecret: env.GITHUB_CLIENT_SECRET || '',
    redirectUri: env.GITHUB_REDIRECT_URI || `${env.FRONTEND_URL}/auth/github/callback`,
  },
});

export const getAIConfig = () => ({
  enabled: env.AI_ENABLED,
  openai: {
    apiKey: env.OPENAI_API_KEY || '',
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    embeddingDimensions: env.OPENAI_EMBEDDING_DIMENSIONS,
  },
  vectorStore: {
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
  },
});