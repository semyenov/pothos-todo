import crypto from 'crypto';
import { CacheManager } from '../cache/CacheManager.js';
import { logger } from '@/logger.js';
import { SingletonService } from '@/infrastructure/core/SingletonService.js';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  hashedKey: string;
  userId: string;
  scopes: string[];
  rateLimit: {
    rpm: number; // requests per minute
    daily: number; // requests per day
  };
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyUsage {
  keyId: string;
  requests: number;
  timestamp: Date;
  endpoint?: string;
  userAgent?: string;
  ip?: string;
}

/**
 * API Key Management System
 */
export class ApiKeyManager extends SingletonService<ApiKeyManager> {
  private cache: CacheManager | null = null;

  protected constructor() {
    super();
  }

  static getInstance(): ApiKeyManager {
    return super.getInstance();
  }

  private async getCache(): Promise<CacheManager> {
    if (!this.cache) {
      this.cache = await CacheManager.getInstance();
    }
    return this.cache;
  }

  /**
   * Generate a new API key
   */
  async generateApiKey(options: {
    name: string;
    userId: string;
    scopes: string[];
    rateLimit?: { rpm: number; daily: number };
    expiresAt?: Date;
  }): Promise<{ key: string; apiKey: ApiKey }> {
    // Generate random key
    const key = this.generateSecureKey();
    const keyPrefix = key.substring(0, 8);
    const hashedKey = this.hashKey(key);

    // Create API key record
    const apiKeyData = {
      id: crypto.randomUUID(),
      name: options.name,
      keyPrefix,
      hashedKey,
      userId: options.userId,
      scopes: options.scopes,
      rateLimit: options.rateLimit || { rpm: 60, daily: 1000 },
      expiresAt: options.expiresAt,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store in database (simulated with memory for now)
    const cacheKey = `api_key:${apiKeyData.id}`;
    const cache = await this.getCache();
    await cache.set(cacheKey, apiKeyData, { ttl: 0 }); // No expiration

    // Also store by prefix for quick lookup
    const prefixKey = `api_key_prefix:${keyPrefix}`;
    await cache.set(prefixKey, apiKeyData.id, { ttl: 0 });

    logger.info('API key generated', {
      keyId: apiKeyData.id,
      userId: options.userId,
      name: options.name,
      scopes: options.scopes,
    });

    return { key, apiKey: apiKeyData };
  }

  /**
   * Validate an API key
   */
  async validateApiKey(key: string): Promise<ApiKey | null> {
    try {
      // Extract prefix and hash the key
      const keyPrefix = key.substring(0, 8);
      const hashedKey = this.hashKey(key);

      // Get API key ID from prefix
      const prefixKey = `api_key_prefix:${keyPrefix}`;
      const cache = await this.getCache();
      const keyId = await cache.get<string>(prefixKey);

      if (!keyId) return null;

      // Get full API key data
      const cacheKey = `api_key:${keyId}`;
      const apiKey = await cache.get<ApiKey>(cacheKey);

      if (!apiKey) return null;

      // Verify the hash
      if (apiKey.hashedKey !== hashedKey) return null;

      // Check if active
      if (!apiKey.isActive) return null;

      // Check expiration
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        await this.deactivateApiKey(keyId);
        return null;
      }

      // Update last used timestamp
      apiKey.lastUsedAt = new Date();
      await cache.set(cacheKey, apiKey, { ttl: 0 });

      return apiKey;
    } catch (error) {
      logger.error('API key validation error', { error });
      return null;
    }
  }

  /**
   * Check rate limits for an API key
   */
  async checkRateLimit(apiKey: ApiKey, ip?: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: Date;
    limit: number;
  }> {
    const now = new Date();
    const cache = await this.getCache();
    const minuteKey = `rate_limit:${apiKey.id}:${now.getMinutes()}`;
    const dayKey = `rate_limit:${apiKey.id}:${now.toDateString()}`;

    // Check minute limit
    const minuteCount = await cache.get<number>(minuteKey) || 0;
    const minuteLimit = apiKey.rateLimit.rpm;

    if (minuteCount >= minuteLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(now.getTime() + (60 - now.getSeconds()) * 1000),
        limit: minuteLimit,
      };
    }

    // Check daily limit
    const dayCount = await cache.get<number>(dayKey) || 0;
    const dayLimit = apiKey.rateLimit.daily;

    if (dayCount >= dayLimit) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      return {
        allowed: false,
        remaining: 0,
        resetTime: tomorrow,
        limit: dayLimit,
      };
    }

    // Increment counters
    await Promise.all([
      cache.set(minuteKey, minuteCount + 1, { ttl: 60 }),
      cache.set(dayKey, dayCount + 1, { ttl: 86400 }), // 24 hours
    ]);

    // Track usage
    await this.trackUsage({
      keyId: apiKey.id,
      requests: 1,
      timestamp: now,
      ip,
    });

    return {
      allowed: true,
      remaining: Math.min(minuteLimit - minuteCount - 1, dayLimit - dayCount - 1),
      resetTime: new Date(now.getTime() + (60 - now.getSeconds()) * 1000),
      limit: minuteLimit,
    };
  }

  /**
   * List API keys for a user
   */
  async listApiKeys(userId: string): Promise<Omit<ApiKey, 'hashedKey'>[]> {
    // In a real implementation, this would query the database
    // For now, return empty array as we're using cache
    return [];
  }

  /**
   * Deactivate an API key
   */
  async deactivateApiKey(keyId: string): Promise<boolean> {
    const cacheKey = `api_key:${keyId}`;
    const apiKey = await this.cache.get<ApiKey>(cacheKey);

    if (!apiKey) return false;

    apiKey.isActive = false;
    apiKey.updatedAt = new Date();

    await this.cache.set(cacheKey, apiKey, { ttl: 0 });

    logger.info('API key deactivated', { keyId, userId: apiKey.userId });
    return true;
  }

  /**
   * Update API key permissions
   */
  async updateApiKey(keyId: string, updates: {
    name?: string;
    scopes?: string[];
    rateLimit?: { rpm: number; daily: number };
    expiresAt?: Date;
  }): Promise<boolean> {
    const cacheKey = `api_key:${keyId}`;
    const apiKey = await this.cache.get<ApiKey>(cacheKey);

    if (!apiKey) return false;

    Object.assign(apiKey, updates, { updatedAt: new Date() });
    await this.cache.set(cacheKey, apiKey, { ttl: 0 });

    logger.info('API key updated', { keyId, updates });
    return true;
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(keyId: string, days = 7): Promise<{
    totalRequests: number;
    averageDaily: number;
    recentUsage: Array<{ date: string; requests: number }>;
  }> {
    const usage: Array<{ date: string; requests: number }> = [];
    let totalRequests = 0;

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = `usage:${keyId}:${date.toDateString()}`;

      const requests = await this.cache.get<number>(dateKey) || 0;
      usage.push({ date: date.toDateString(), requests });
      totalRequests += requests;
    }

    return {
      totalRequests,
      averageDaily: totalRequests / days,
      recentUsage: usage.reverse(),
    };
  }

  private generateSecureKey(): string {
    // Generate a 32-byte random key and encode as base64
    return crypto.randomBytes(32).toString('base64url');
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private async trackUsage(usage: ApiKeyUsage): Promise<void> {
    const dateKey = `usage:${usage.keyId}:${usage.timestamp.toDateString()}`;
    const currentCount = await this.cache.get<number>(dateKey) || 0;
    await this.cache.set(dateKey, currentCount + usage.requests, { ttl: 86400 * 30 }); // 30 days
  }
}

export const apiKeyManager = ApiKeyManager.getInstance();