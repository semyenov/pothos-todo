import { createHash } from 'crypto';
import { logger } from '@/logger.js';
import { EdgeComputingSystem, type EdgeLocation, type EdgeRequest, type EdgeResponse } from './EdgeComputing.js';
import { MetricsSystem } from '../observability/Metrics.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface CDNConfig {
  defaultTTL: number;
  maxCacheSize: number; // bytes per edge location
  cacheStrategies: CacheStrategy[];
  purgeStrategy: 'lru' | 'lfu' | 'fifo' | 'ttl';
  enableSmartCaching: boolean;
  enablePredictivePrefetch: boolean;
}

export interface CacheStrategy {
  pattern: string | RegExp;
  ttl: number;
  vary?: string[];
  staleWhileRevalidate?: number;
  staleIfError?: number;
  private?: boolean;
  conditions?: CacheCondition[];
}

export interface CacheCondition {
  type: 'header' | 'query' | 'cookie' | 'custom';
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'regex';
  value: any;
}

export interface CacheEntry {
  key: string;
  data: any;
  headers: Record<string, string>;
  metadata: {
    size: number;
    created: Date;
    expires: Date;
    hits: number;
    lastAccessed: Date;
    etag: string;
    revalidating?: boolean;
  };
}

export interface GraphQLCacheEntry extends CacheEntry {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
  dependencies: string[]; // Entity types this query depends on
}

export interface CacheStats {
  totalSize: number;
  entryCount: number;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  bandwidthSaved: number;
}

export interface PurgeRequest {
  type: 'tag' | 'pattern' | 'all';
  target?: string | RegExp;
  locations?: string[];
}

/**
 * Intelligent CDN with GraphQL-aware caching
 * Provides smart caching, predictive prefetching, and optimized delivery
 */
export class IntelligentCDN extends EventEmitterSingletonService<IntelligentCDN> {
  private config: CDNConfig | null = null;
  private caches: Map<string, Map<string, CacheEntry>> = new Map(); // locationId -> cache
  private cacheStats: Map<string, CacheStats> = new Map();
  private edgeSystem: EdgeComputingSystem | null = null;
  private metrics: MetricsSystem | null = null;
  private mlPredictor?: CachePredictionModel;

  protected constructor() {
    super();
  }

  public async initialize(config: CDNConfig): Promise<void> {
    this.config = config;
    this.edgeSystem = await EdgeComputingSystem.getInstance();
    this.metrics = await MetricsSystem.getInstance();
    
    if (config.enablePredictivePrefetch) {
      this.mlPredictor = new CachePredictionModel();
    }
    
    this.initializeCaches();
  }

  private ensureConfig(): CDNConfig {
    if (!this.config) {
      throw new Error('IntelligentCDN not initialized');
    }
    return this.config;
  }

  private ensureEdgeSystem(): EdgeComputingSystem {
    if (!this.edgeSystem) {
      throw new Error('IntelligentCDN not initialized');
    }
    return this.edgeSystem;
  }

  private ensureMetrics(): MetricsSystem {
    if (!this.metrics) {
      throw new Error('IntelligentCDN not initialized');
    }
    return this.metrics;
  }

  static getInstance(): IntelligentCDN {
    return super.getInstance();
  }

  /**
   * Handle CDN request
   */
  async handleRequest(request: EdgeRequest): Promise<EdgeResponse> {
    const cacheKey = this.generateCacheKey(request);
    const location = await this.ensureEdgeSystem().findOptimalLocation(request);
    
    if (!location) {
      throw new Error('No available edge location');
    }

    // Check cache
    const cached = await this.getFromCache(cacheKey, location.id);
    if (cached) {
      // Update hit statistics
      this.updateCacheStats(location.id, 'hit');
      
      // Check if stale-while-revalidate
      if (this.shouldRevalidate(cached)) {
        this.revalidateInBackground(request, cached, location);
      }

      return this.createCachedResponse(cached, location);
    }

    // Cache miss
    this.updateCacheStats(location.id, 'miss');

    // Fetch from origin or edge compute
    const response = await this.fetchContent(request, location);

    // Cache if appropriate
    if (this.shouldCache(request, response)) {
      await this.cacheResponse(request, response, location);
    }

    // Predictive prefetch
    if (this.ensureConfig().enablePredictivePrefetch) {
      this.predictivePrefetch(request, location);
    }

    return response;
  }

  /**
   * Handle GraphQL request with intelligent caching
   */
  async handleGraphQLRequest(
    operation: {
      query: string;
      variables?: Record<string, any>;
      operationName?: string;
    },
    request: EdgeRequest
  ): Promise<EdgeResponse> {
    // Parse query to understand dependencies
    const queryInfo = this.parseGraphQLQuery(operation.query);
    
    if (!queryInfo.isCacheable) {
      // Forward to origin for mutations/subscriptions
      return this.ensureEdgeSystem().handleGraphQLAtEdge(operation, request);
    }

    const cacheKey = this.generateGraphQLCacheKey(operation);
    const location = await this.ensureEdgeSystem().findOptimalLocation(request);
    
    if (!location) {
      throw new Error('No available edge location');
    }

    // Check cache with smart invalidation
    const cached = await this.getGraphQLFromCache(cacheKey, location.id);
    if (cached && !this.isInvalidated(cached, queryInfo.dependencies)) {
      this.updateCacheStats(location.id, 'hit');
      return this.createCachedResponse(cached, location);
    }

    // Execute query
    const response = await this.ensureEdgeSystem().handleGraphQLAtEdge(operation, request);

    // Cache with dependencies
    if (response.status === 200) {
      await this.cacheGraphQLResponse(
        operation,
        response,
        location,
        queryInfo.dependencies
      );
    }

    return response;
  }

  /**
   * Purge cache entries
   */
  async purge(request: PurgeRequest): Promise<number> {
    let purgedCount = 0;
    const targetLocations = request.locations || Array.from(this.caches.keys());

    for (const locationId of targetLocations) {
      const cache = this.caches.get(locationId);
      if (!cache) continue;

      switch (request.type) {
        case 'all':
          purgedCount += cache.size;
          cache.clear();
          break;
          
        case 'pattern':
          if (request.target) {
            const pattern = request.target instanceof RegExp ? 
              request.target : new RegExp(request.target);
            
            for (const [key, entry] of cache) {
              if (pattern.test(key)) {
                cache.delete(key);
                purgedCount++;
              }
            }
          }
          break;
          
        case 'tag':
          // Purge by dependency tag (for GraphQL)
          for (const [key, entry] of cache) {
            if (entry instanceof GraphQLCacheEntry && 
                entry.dependencies.includes(request.target as string)) {
              cache.delete(key);
              purgedCount++;
            }
          }
          break;
      }
    }

    logger.info(`Purged ${purgedCount} cache entries`, { request });
    this.emit('cache:purged', { request, count: purgedCount });

    return purgedCount;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(locationId?: string): Map<string, CacheStats> | CacheStats | null {
    if (locationId) {
      return this.cacheStats.get(locationId) || null;
    }
    return this.cacheStats;
  }

  /**
   * Warm up cache with predicted content
   */
  async warmupCache(
    predictions: Array<{
      url: string;
      probability: number;
      locations: string[];
    }>
  ): Promise<void> {
    const warmupPromises = predictions
      .filter(p => p.probability > 0.7) // Only high probability
      .map(async (prediction) => {
        for (const locationId of prediction.locations) {
          const location = this.ensureEdgeSystem().getLocation(locationId);
          if (location) {
            try {
              const request: EdgeRequest = {
                id: `warmup_${Date.now()}`,
                url: prediction.url,
                method: 'GET',
                headers: {},
                clientIp: '0.0.0.0',
              };
              
              await this.fetchAndCache(request, location);
            } catch (error) {
              logger.error('Cache warmup failed', { url: prediction.url, error });
            }
          }
        }
      });

    await Promise.all(warmupPromises);
  }

  /**
   * Initialize caches for all edge locations
   */
  private initializeCaches(): void {
    // This would integrate with actual edge locations
    const locations = ['edge-us-east', 'edge-us-west', 'edge-eu-west', 'edge-ap-south'];
    
    for (const locationId of locations) {
      this.caches.set(locationId, new Map());
      this.cacheStats.set(locationId, {
        totalSize: 0,
        entryCount: 0,
        hitRate: 0,
        missRate: 0,
        evictionRate: 0,
        bandwidthSaved: 0,
      });
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(request: EdgeRequest): string {
    const vary = this.getVaryHeaders(request);
    const parts = [
      request.method,
      request.url,
      ...vary.map(h => `${h}:${request.headers[h] || ''}`),
    ];
    
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * Generate GraphQL cache key
   */
  private generateGraphQLCacheKey(operation: any): string {
    const normalized = this.normalizeGraphQLQuery(operation.query);
    const parts = [
      normalized,
      JSON.stringify(operation.variables || {}),
      operation.operationName || '',
    ];
    
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * Get from cache
   */
  private async getFromCache(
    key: string,
    locationId: string
  ): Promise<CacheEntry | null> {
    const cache = this.caches.get(locationId);
    if (!cache) return null;

    const entry = cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (entry.metadata.expires < new Date()) {
      cache.delete(key);
      return null;
    }

    // Update access statistics
    entry.metadata.hits++;
    entry.metadata.lastAccessed = new Date();

    return entry;
  }

  /**
   * Get GraphQL from cache
   */
  private async getGraphQLFromCache(
    key: string,
    locationId: string
  ): Promise<GraphQLCacheEntry | null> {
    const entry = await this.getFromCache(key, locationId);
    return entry as GraphQLCacheEntry;
  }

  /**
   * Cache response
   */
  private async cacheResponse(
    request: EdgeRequest,
    response: EdgeResponse,
    location: EdgeLocation
  ): Promise<void> {
    const key = this.generateCacheKey(request);
    const cache = this.caches.get(location.id);
    if (!cache) return;

    const ttl = this.determineTTL(request, response);
    const size = JSON.stringify(response.body).length;

    // Check cache size limit
    if (await this.ensureCacheSpace(location.id, size)) {
      const entry: CacheEntry = {
        key,
        data: response.body,
        headers: response.headers,
        metadata: {
          size,
          created: new Date(),
          expires: new Date(Date.now() + ttl * 1000),
          hits: 0,
          lastAccessed: new Date(),
          etag: this.generateETag(response.body),
        },
      };

      cache.set(key, entry);
      this.updateCacheSize(location.id, size);
    }
  }

  /**
   * Cache GraphQL response
   */
  private async cacheGraphQLResponse(
    operation: any,
    response: EdgeResponse,
    location: EdgeLocation,
    dependencies: string[]
  ): Promise<void> {
    const key = this.generateGraphQLCacheKey(operation);
    const cache = this.caches.get(location.id);
    if (!cache) return;

    const ttl = this.determineTTL({ url: 'graphql' } as EdgeRequest, response);
    const size = JSON.stringify(response.body).length;

    if (await this.ensureCacheSpace(location.id, size)) {
      const entry: GraphQLCacheEntry = {
        key,
        data: response.body,
        headers: response.headers,
        query: operation.query,
        variables: operation.variables,
        operationName: operation.operationName,
        dependencies,
        metadata: {
          size,
          created: new Date(),
          expires: new Date(Date.now() + ttl * 1000),
          hits: 0,
          lastAccessed: new Date(),
          etag: this.generateETag(response.body),
        },
      };

      cache.set(key, entry);
      this.updateCacheSize(location.id, size);
    }
  }

  /**
   * Determine TTL for response
   */
  private determineTTL(request: EdgeRequest, response: EdgeResponse): number {
    // Check cache control headers
    const cacheControl = response.headers['cache-control'];
    if (cacheControl) {
      const maxAge = cacheControl.match(/max-age=(\d+)/);
      if (maxAge) {
        return parseInt(maxAge[1], 10);
      }
    }

    // Apply cache strategies
    for (const strategy of this.ensureConfig().cacheStrategies) {
      if (this.matchesStrategy(request, strategy)) {
        return strategy.ttl;
      }
    }

    return this.ensureConfig().defaultTTL;
  }

  /**
   * Check if request matches cache strategy
   */
  private matchesStrategy(request: EdgeRequest, strategy: CacheStrategy): boolean {
    const pattern = strategy.pattern instanceof RegExp ? 
      strategy.pattern : new RegExp(strategy.pattern);
    
    if (!pattern.test(request.url)) {
      return false;
    }

    // Check conditions
    if (strategy.conditions) {
      for (const condition of strategy.conditions) {
        if (!this.evaluateCondition(request, condition)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate cache condition
   */
  private evaluateCondition(request: EdgeRequest, condition: CacheCondition): boolean {
    let value: any;
    
    switch (condition.type) {
      case 'header':
        value = request.headers[condition.field];
        break;
      case 'query':
        // Parse query params
        const url = new URL(request.url, 'http://example.com');
        value = url.searchParams.get(condition.field);
        break;
      default:
        return false;
    }

    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'ne':
        return value !== condition.value;
      case 'contains':
        return value && value.includes(condition.value);
      case 'regex':
        return condition.value.test(value);
      default:
        return false;
    }
  }

  /**
   * Get vary headers for request
   */
  private getVaryHeaders(request: EdgeRequest): string[] {
    // Default vary headers
    const vary = ['accept', 'accept-encoding'];
    
    // Add from cache strategies
    for (const strategy of this.ensureConfig().cacheStrategies) {
      if (this.matchesStrategy(request, strategy) && strategy.vary) {
        vary.push(...strategy.vary);
      }
    }

    return [...new Set(vary)];
  }

  /**
   * Parse GraphQL query
   */
  private parseGraphQLQuery(query: string): {
    isCacheable: boolean;
    dependencies: string[];
  } {
    const normalized = query.toLowerCase();
    
    // Not cacheable if mutation or subscription
    if (normalized.includes('mutation') || normalized.includes('subscription')) {
      return { isCacheable: false, dependencies: [] };
    }

    // Extract entity types from query
    const dependencies: string[] = [];
    const typePattern = /\b(\w+)\s*\{/g;
    let match;
    
    while ((match = typePattern.exec(query)) !== null) {
      const type = match[1];
      if (type && !['query', 'fragment'].includes(type.toLowerCase())) {
        dependencies.push(type);
      }
    }

    return { isCacheable: true, dependencies: [...new Set(dependencies)] };
  }

  /**
   * Normalize GraphQL query
   */
  private normalizeGraphQLQuery(query: string): string {
    // Remove whitespace and comments
    return query
      .replace(/\s+/g, ' ')
      .replace(/#.*$/gm, '')
      .trim();
  }

  /**
   * Check if cached entry is invalidated
   */
  private isInvalidated(entry: GraphQLCacheEntry, currentDeps: string[]): boolean {
    // Check if any dependencies have been invalidated
    // In real implementation, would track entity version numbers
    return false;
  }

  /**
   * Should revalidate cached entry
   */
  private shouldRevalidate(entry: CacheEntry): boolean {
    const now = new Date();
    const age = (now.getTime() - entry.metadata.created.getTime()) / 1000;
    const ttl = (entry.metadata.expires.getTime() - entry.metadata.created.getTime()) / 1000;
    
    // Revalidate if in last 10% of TTL
    return age > ttl * 0.9 && !entry.metadata.revalidating;
  }

  /**
   * Revalidate in background
   */
  private async revalidateInBackground(
    request: EdgeRequest,
    cached: CacheEntry,
    location: EdgeLocation
  ): Promise<void> {
    cached.metadata.revalidating = true;
    
    try {
      const response = await this.fetchContent(request, location);
      
      if (response.status === 200) {
        await this.cacheResponse(request, response, location);
      }
    } catch (error) {
      logger.error('Background revalidation failed', error);
    } finally {
      cached.metadata.revalidating = false;
    }
  }

  /**
   * Create cached response
   */
  private createCachedResponse(entry: CacheEntry, location: EdgeLocation): EdgeResponse {
    return {
      status: 200,
      headers: {
        ...entry.headers,
        'x-cache': 'HIT',
        'x-cache-hits': entry.metadata.hits.toString(),
        'x-served-by': location.id,
        'age': Math.floor((Date.now() - entry.metadata.created.getTime()) / 1000).toString(),
      },
      body: entry.data,
      servedFrom: location.id,
      latency: 1, // Cache hit is fast
      cached: true,
    };
  }

  /**
   * Fetch content
   */
  private async fetchContent(
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<EdgeResponse> {
    // Use edge computing system to fetch
    return this.ensureEdgeSystem().executeFunction('origin-fetch', request);
  }

  /**
   * Fetch and cache
   */
  private async fetchAndCache(
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<void> {
    const response = await this.fetchContent(request, location);
    
    if (response.status === 200) {
      await this.cacheResponse(request, response, location);
    }
  }

  /**
   * Should cache response
   */
  private shouldCache(request: EdgeRequest, response: EdgeResponse): boolean {
    // Don't cache non-2xx responses
    if (response.status < 200 || response.status >= 300) {
      return false;
    }

    // Don't cache if no-store
    const cacheControl = response.headers['cache-control'];
    if (cacheControl && cacheControl.includes('no-store')) {
      return false;
    }

    // Check if matches any cache strategy
    return this.ensureConfig().cacheStrategies.some(s => this.matchesStrategy(request, s));
  }

  /**
   * Ensure cache space
   */
  private async ensureCacheSpace(locationId: string, requiredSize: number): Promise<boolean> {
    const stats = this.cacheStats.get(locationId);
    if (!stats) return false;

    const maxSize = this.ensureConfig().maxCacheSize;
    
    if (stats.totalSize + requiredSize <= maxSize) {
      return true;
    }

    // Need to evict
    const cache = this.caches.get(locationId);
    if (!cache) return false;

    const bytesToFree = (stats.totalSize + requiredSize) - maxSize;
    await this.evictEntries(locationId, bytesToFree);

    return true;
  }

  /**
   * Evict cache entries
   */
  private async evictEntries(locationId: string, bytesToFree: number): Promise<void> {
    const cache = this.caches.get(locationId);
    if (!cache) return;

    let freedBytes = 0;
    const entries = Array.from(cache.entries());

    // Sort by eviction strategy
    switch (this.ensureConfig().purgeStrategy) {
      case 'lru':
        entries.sort((a, b) => 
          a[1].metadata.lastAccessed.getTime() - b[1].metadata.lastAccessed.getTime()
        );
        break;
      case 'lfu':
        entries.sort((a, b) => a[1].metadata.hits - b[1].metadata.hits);
        break;
      case 'ttl':
        entries.sort((a, b) => 
          a[1].metadata.expires.getTime() - b[1].metadata.expires.getTime()
        );
        break;
      case 'fifo':
        entries.sort((a, b) => 
          a[1].metadata.created.getTime() - b[1].metadata.created.getTime()
        );
        break;
    }

    // Evict until we have enough space
    for (const [key, entry] of entries) {
      cache.delete(key);
      freedBytes += entry.metadata.size;
      this.updateCacheStats(locationId, 'eviction');
      
      if (freedBytes >= bytesToFree) {
        break;
      }
    }

    this.updateCacheSize(locationId, -freedBytes);
  }

  /**
   * Update cache statistics
   */
  private updateCacheStats(locationId: string, event: 'hit' | 'miss' | 'eviction'): void {
    const stats = this.cacheStats.get(locationId);
    if (!stats) return;

    switch (event) {
      case 'hit':
        stats.hitRate = (stats.hitRate * stats.entryCount + 1) / (stats.entryCount + 1);
        stats.missRate = 1 - stats.hitRate;
        break;
      case 'miss':
        stats.missRate = (stats.missRate * stats.entryCount + 1) / (stats.entryCount + 1);
        stats.hitRate = 1 - stats.missRate;
        break;
      case 'eviction':
        stats.evictionRate++;
        break;
    }

    // Record metrics
    this.ensureMetrics().record('cacheHits', event === 'hit' ? 1 : 0, {
      location: locationId,
    });
    this.ensureMetrics().record('cacheMisses', event === 'miss' ? 1 : 0, {
      location: locationId,
    });
  }

  /**
   * Update cache size
   */
  private updateCacheSize(locationId: string, sizeDelta: number): void {
    const stats = this.cacheStats.get(locationId);
    if (stats) {
      stats.totalSize += sizeDelta;
      stats.entryCount += sizeDelta > 0 ? 1 : -1;
    }
  }

  /**
   * Generate ETag
   */
  private generateETag(data: any): string {
    return createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Predictive prefetch
   */
  private async predictivePrefetch(
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<void> {
    if (!this.mlPredictor) return;

    const predictions = await this.mlPredictor.predict(request);
    
    for (const prediction of predictions) {
      if (prediction.probability > 0.8) {
        // Prefetch in background
        const prefetchRequest: EdgeRequest = {
          ...request,
          url: prediction.url,
        };
        
        this.fetchAndCache(prefetchRequest, location).catch(error => {
          logger.debug('Prefetch failed', { url: prediction.url, error });
        });
      }
    }
  }
}

/**
 * ML model for cache prediction
 */
class CachePredictionModel {
  async predict(request: EdgeRequest): Promise<Array<{
    url: string;
    probability: number;
  }>> {
    // Simplified prediction - in reality would use trained model
    const predictions: Array<{ url: string; probability: number }> = [];
    
    // Predict related resources
    if (request.url.includes('/api/todos')) {
      predictions.push({
        url: '/api/users/me',
        probability: 0.9,
      });
    }

    return predictions;
  }
}