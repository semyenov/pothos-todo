/**
 * Advanced HTTP client using UnJS utilities
 * Provides comprehensive HTTP operations with caching, retries, and validation
 */

import { 
  $fetch, 
  httpClient, 
  urlUtils, 
  objectUtils, 
  logger,
  storage,
  cryptoUtils 
} from '@/lib/unjs-utils.js';
import { validationService } from '@/infrastructure/validation/UnJSValidation.js';
import { z } from 'zod';

export interface HttpClientOptions {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  cache?: boolean;
  cacheTTL?: number;
  validateResponse?: boolean;
  headers?: Record<string, string>;
  interceptors?: {
    request?: (options: any) => any;
    response?: (response: any) => any;
    error?: (error: any) => any;
  };
}

export interface RequestOptions extends HttpClientOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  body?: any;
  query?: Record<string, any>;
  schema?: string | z.ZodSchema;
  cacheKey?: string;
  skipCache?: boolean;
  transform?: (data: any) => any;
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  cached?: boolean;
  duration: number;
  retries?: number;
}

export interface RequestMetrics {
  url: string;
  method: string;
  duration: number;
  status: number;
  cached: boolean;
  size: number;
  retries: number;
  timestamp: Date;
}

/**
 * Enhanced HTTP client with advanced features
 */
export class UnJSHttpClient {
  private client: typeof $fetch;
  private metrics: RequestMetrics[] = [];
  private cache = storage;
  
  constructor(private options: HttpClientOptions = {}) {
    const {
      baseURL = '',
      timeout = 30000,
      retries = 3,
      retryDelay = 500,
      headers = {},
    } = options;

    this.client = $fetch.create({
      baseURL,
      timeout,
      retry: retries,
      retryDelay,
      headers: {
        'User-Agent': 'UnJS-HTTP-Client/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      onRequest: async ({ request, options }) => {
        if (this.options.interceptors?.request) {
          return this.options.interceptors.request({ request, options });
        }
      },
      onResponse: async ({ response }) => {
        if (this.options.interceptors?.response) {
          return this.options.interceptors.response(response);
        }
      },
      onResponseError: async ({ error }) => {
        if (this.options.interceptors?.error) {
          return this.options.interceptors.error(error);
        }
        throw error;
      },
    });
  }

  /**
   * Make HTTP request with advanced features
   */
  async request<T = any>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const startTime = Date.now();
    const {
      method = 'GET',
      body,
      query,
      schema,
      cacheKey,
      skipCache = false,
      transform,
      cache = this.options.cache ?? true,
      cacheTTL = this.options.cacheTTL ?? 300000, // 5 minutes
      validateResponse = this.options.validateResponse ?? false,
    } = options;

    // Build final URL with query parameters
    const finalUrl = query ? urlUtils.withQuery(url, query) : url;
    
    // Generate cache key
    const requestCacheKey = cacheKey || await this.generateCacheKey(finalUrl, method, body);
    
    // Try to get from cache first
    if (cache && !skipCache && method === 'GET') {
      const cached = await this.getCachedResponse<T>(requestCacheKey);
      if (cached) {
        this.recordMetrics({
          url: finalUrl,
          method,
          duration: Date.now() - startTime,
          status: cached.status,
          cached: true,
          size: JSON.stringify(cached.data).length,
          retries: 0,
          timestamp: new Date(),
        });

        return cached;
      }
    }

    let retryCount = 0;
    let lastError: any;

    const maxRetries = this.options.retries ?? 3;
    const retryDelay = this.options.retryDelay ?? 500;

    while (retryCount <= maxRetries) {
      try {
        logger.debug('Making HTTP request', {
          url: finalUrl,
          method,
          attempt: retryCount + 1,
          hasBody: !!body,
        });

        const response = await this.client<T>(finalUrl, {
          method,
          body,
          ...options,
        });

        // Transform response if needed
        let transformedData = response;
        if (transform) {
          transformedData = transform(response);
        }

        // Validate response if schema provided
        if (validateResponse && schema) {
          const validationResult = typeof schema === 'string' 
            ? await validationService.validate(schema, transformedData)
            : await schema.parseAsync(transformedData);
            
          if (typeof schema === 'string' && !validationResult.success) {
            throw new Error(`Response validation failed: ${validationResult.errors?.map(e => e.message).join(', ')}`);
          }
        }

        const httpResponse: HttpResponse<T> = {
          data: transformedData,
          status: 200, // $fetch doesn't expose status easily
          statusText: 'OK',
          headers: {},
          duration: Date.now() - startTime,
          retries: retryCount,
        };

        // Cache successful GET requests
        if (cache && method === 'GET') {
          await this.setCachedResponse(requestCacheKey, httpResponse, cacheTTL);
        }

        this.recordMetrics({
          url: finalUrl,
          method,
          duration: httpResponse.duration,
          status: httpResponse.status,
          cached: false,
          size: JSON.stringify(httpResponse.data).length,
          retries: retryCount,
          timestamp: new Date(),
        });

        logger.debug('HTTP request completed', {
          url: finalUrl,
          method,
          status: httpResponse.status,
          duration: httpResponse.duration,
          retries: retryCount,
        });

        return httpResponse;

      } catch (error) {
        lastError = error;
        retryCount++;

        if (retryCount <= maxRetries && this.shouldRetry(error, method)) {
          logger.warn('HTTP request failed, retrying', {
            url: finalUrl,
            method,
            attempt: retryCount,
            error: String(error),
            nextRetryDelay: retryDelay * retryCount,
          });

          await this.delay(retryDelay * retryCount);
          continue;
        }

        break;
      }
    }

    // Record failed request metrics
    this.recordMetrics({
      url: finalUrl,
      method,
      duration: Date.now() - startTime,
      status: lastError?.status || 0,
      cached: false,
      size: 0,
      retries: retryCount - 1,
      timestamp: new Date(),
    });

    logger.error('HTTP request failed after retries', {
      url: finalUrl,
      method,
      retries: retryCount - 1,
      error: String(lastError),
    });

    throw lastError;
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, options?: Omit<RequestOptions, 'method'>): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T = any>(url: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T = any>(url: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PUT', body });
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, options?: Omit<RequestOptions, 'method'>): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }

  /**
   * PATCH request
   */
  async patch<T = any>(url: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PATCH', body });
  }

  /**
   * Upload file with progress tracking
   */
  async upload<T = any>(
    url: string, 
    file: File | Blob | Buffer, 
    options: RequestOptions & {
      fieldName?: string;
      fileName?: string;
      onProgress?: (progress: number) => void;
    } = {}
  ): Promise<HttpResponse<T>> {
    const { fieldName = 'file', fileName, onProgress, ...requestOptions } = options;
    
    const formData = new FormData();
    
    if (file instanceof File) {
      formData.append(fieldName, file, fileName || file.name);
    } else if (file instanceof Blob) {
      formData.append(fieldName, file, fileName || 'blob');
    } else {
      // Buffer
      const blob = new Blob([file]);
      formData.append(fieldName, blob, fileName || 'file');
    }

    // TODO: Add progress tracking when supported by $fetch
    
    return this.request<T>(url, {
      ...requestOptions,
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Download file with progress tracking
   */
  async download(
    url: string,
    options: RequestOptions & {
      onProgress?: (progress: number) => void;
    } = {}
  ): Promise<HttpResponse<ArrayBuffer>> {
    const { onProgress, ...requestOptions } = options;
    
    // TODO: Add progress tracking when supported by $fetch
    
    return this.request<ArrayBuffer>(url, {
      ...requestOptions,
      method: 'GET',
    });
  }

  /**
   * GraphQL request
   */
  async graphql<T = any>(
    url: string,
    query: string,
    variables?: Record<string, any>,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<HttpResponse<{ data: T; errors?: any[] }>> {
    return this.request<{ data: T; errors?: any[] }>(url, {
      ...options,
      method: 'POST',
      body: {
        query,
        variables,
      },
    });
  }

  /**
   * Batch requests
   */
  async batch<T = any>(
    requests: Array<{
      url: string;
      options?: RequestOptions;
      id?: string;
    }>
  ): Promise<Array<HttpResponse<T> & { id?: string; error?: any }>> {
    const results = await Promise.allSettled(
      requests.map(async ({ url, options, id }) => {
        try {
          const response = await this.request<T>(url, options);
          return { ...response, id };
        } catch (error) {
          return { id, error };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          id: requests[index].id,
          error: result.reason,
        } as any;
      }
    });
  }

  /**
   * Generate cache key for request
   */
  private async generateCacheKey(url: string, method: string, body?: any): Promise<string> {
    const keyData = {
      url,
      method,
      body: body ? objectUtils.hash(body) : null,
    };
    
    return await cryptoUtils.hash(JSON.stringify(keyData));
  }

  /**
   * Get cached response
   */
  private async getCachedResponse<T>(cacheKey: string): Promise<HttpResponse<T> | null> {
    try {
      const cached = await this.cache.get<HttpResponse<T>>(`http:${cacheKey}`);
      if (cached) {
        cached.cached = true;
        return cached;
      }
    } catch (error) {
      logger.warn('Failed to get cached response', { cacheKey, error });
    }
    return null;
  }

  /**
   * Set cached response
   */
  private async setCachedResponse<T>(
    cacheKey: string, 
    response: HttpResponse<T>, 
    ttl: number
  ): Promise<void> {
    try {
      // Don't cache the cached flag
      const { cached, ...responseToCache } = response;
      await this.cache.set(`http:${cacheKey}`, responseToCache);
      
      // Set expiration
      setTimeout(async () => {
        await this.cache.del(`http:${cacheKey}`);
      }, ttl);
      
    } catch (error) {
      logger.warn('Failed to cache response', { cacheKey, error });
    }
  }

  /**
   * Check if request should be retried
   */
  private shouldRetry(error: any, method: string): boolean {
    // Don't retry non-idempotent methods by default
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      return false;
    }

    // Retry on network errors or 5xx status codes
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      return true;
    }

    const status = error.status || error.statusCode;
    return status >= 500 && status < 600;
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Record request metrics
   */
  private recordMetrics(metrics: RequestMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }

  /**
   * Get request metrics
   */
  getMetrics(since?: Date): RequestMetrics[] {
    if (since) {
      return this.metrics.filter(m => m.timestamp >= since);
    }
    return [...this.metrics];
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(since?: Date): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    cachedRequests: number;
    averageDuration: number;
    totalRetries: number;
    errorRate: number;
    cacheHitRate: number;
  } {
    const metrics = this.getMetrics(since);
    
    const totalRequests = metrics.length;
    const successfulRequests = metrics.filter(m => m.status >= 200 && m.status < 400).length;
    const failedRequests = totalRequests - successfulRequests;
    const cachedRequests = metrics.filter(m => m.cached).length;
    const totalRetries = metrics.reduce((sum, m) => sum + m.retries, 0);
    const averageDuration = totalRequests > 0 
      ? metrics.reduce((sum, m) => sum + m.duration, 0) / totalRequests 
      : 0;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      cachedRequests,
      averageDuration,
      totalRetries,
      errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
      cacheHitRate: totalRequests > 0 ? cachedRequests / totalRequests : 0,
    };
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    const keys = await this.cache.keys('http:');
    await Promise.all(keys.map(key => this.cache.del(key)));
    logger.debug('HTTP client cache cleared', { keysCleared: keys.length });
  }
}

// Singleton instances for common use cases
export const httpClient = new UnJSHttpClient();

export const apiClient = new UnJSHttpClient({
  baseURL: process.env.API_BASE_URL || '',
  timeout: 10000,
  cache: true,
  cacheTTL: 300000, // 5 minutes
  validateResponse: true,
  headers: {
    'X-Client': 'UnJS-GraphQL-API',
  },
});

export const externalApiClient = new UnJSHttpClient({
  timeout: 30000,
  retries: 5,
  retryDelay: 1000,
  cache: true,
  cacheTTL: 600000, // 10 minutes
});

// Export for external use
export { HttpClientOptions, RequestOptions, HttpResponse, RequestMetrics };