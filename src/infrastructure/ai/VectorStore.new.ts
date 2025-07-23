import { QdrantClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import type { VectorStoreEventMap } from '../core/ServiceEventMaps.ai.js';
import { 
  ServiceConfig, 
  Retry, 
  CircuitBreaker, 
  Metric, 
  HealthCheck,
  RateLimit 
} from '../core/decorators/ServiceDecorators.js';
import { 
  VectorSearch, 
  AIPerformance,
  EmbeddingCache 
} from '../core/decorators/AIServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Vector store configuration schema
 */
const VectorStoreConfigSchema = z.object({
  url: z.string().url().default('http://localhost:6333'),
  apiKey: z.string().optional(),
  collections: z.array(z.object({
    name: z.string(),
    vectorSize: z.number(),
    distance: z.enum(['Cosine', 'Euclid', 'Dot']).default('Cosine'),
    onDiskPayload: z.boolean().default(true),
    optimizersConfig: z.object({
      deletedThreshold: z.number().default(0.2),
      vacuumMinVectorNumber: z.number().default(1000),
      defaultSegmentNumber: z.number().default(0),
      maxSegmentSize: z.number().optional(),
      memmapThreshold: z.number().optional(),
      indexingThreshold: z.number().default(20000),
      flushIntervalSec: z.number().default(5),
      maxOptimizationThreads: z.number().default(1),
    }).optional(),
  })).default([
    { name: 'todos', vectorSize: 1536 },
    { name: 'todoLists', vectorSize: 1536 },
    { name: 'users', vectorSize: 1536 },
    { name: 'knowledge', vectorSize: 1536 },
  ]),
  indexingThreshold: z.number().default(10000),
  searchTimeout: z.number().default(5000),
  batchSize: z.number().default(100),
  retryConfig: z.object({
    maxAttempts: z.number().default(3),
    initialDelay: z.number().default(1000),
    maxDelay: z.number().default(30000),
  }).optional(),
});

export type VectorStoreConfig = z.infer<typeof VectorStoreConfigSchema>;

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  limit?: number;
  filter?: Record<string, any>;
  scoreThreshold?: number;
  offset?: number;
  includeVector?: boolean;
  exact?: boolean; // For exact search without approximation
}

/**
 * Vector document structure
 */
export interface VectorDocument {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

/**
 * Search result structure
 */
export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, any>;
  vector?: number[];
}

/**
 * Collection statistics
 */
export interface CollectionStats {
  name: string;
  vectorsCount: number;
  indexedVectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  status: 'green' | 'yellow' | 'red';
  config: {
    vectorSize: number;
    distance: string;
  };
}

/**
 * Enhanced Vector Store Service using the new base service architecture
 * 
 * Features:
 * - Automatic connection management with retry
 * - Type-safe vector operations with events
 * - Built-in health checks and metrics
 * - Collection management and optimization
 * - Batch operations support
 * - Search result caching
 * - Performance monitoring
 * 
 * @example
 * ```typescript
 * const vectorStore = await VectorStore.getInstance();
 * 
 * // Listen to vector events
 * vectorStore.on('vector:search-performed', ({ collection, results, duration }) => {
 *   console.log(`Search in ${collection} found ${results} results in ${duration}ms`);
 * });
 * 
 * // Store embeddings
 * await vectorStore.upsert('todos', [{
 *   id: 'todo-123',
 *   vector: embedding,
 *   payload: { title: 'My Todo', userId: 'user-123' }
 * }]);
 * 
 * // Search similar vectors
 * const results = await vectorStore.search('todos', queryVector, {
 *   limit: 5,
 *   filter: { userId: 'user-123' }
 * });
 * ```
 */
@ServiceConfig({
  schema: VectorStoreConfigSchema,
  prefix: 'vector',
  hot: false, // Vector DB connections shouldn't hot reload
})
export class VectorStore extends BaseAsyncService<VectorStoreConfig, VectorStoreEventMap> {
  private client!: QdrantClient;
  private collectionCache: Map<string, CollectionStats> = new Map();
  private searchCount = 0;
  private storeCount = 0;
  private errorCount = 0;

  /**
   * Get the singleton instance
   */
  static override async getInstance(): Promise<VectorStore> {
    return super.getInstance();
  }

  protected override getServiceName(): string {
    return 'vector-store';
  }

  protected override getServiceVersion(): string {
    return '2.0.0';
  }

  protected override getServiceDescription(): string {
    return 'High-performance vector database service with Qdrant backend';
  }

  /**
   * Initialize the service
   */
  protected override async onInitialize(): Promise<void> {
    logger.info('VectorStore initializing with config:', {
      url: this.config.url,
      collections: this.config.collections.map(c => c.name),
      indexingThreshold: this.config.indexingThreshold,
    });
  }

  /**
   * Start the vector store connection
   */
  protected override async onStart(): Promise<void> {
    // Create Qdrant client as a tracked resource
    this.client = this.createResource({
      resource: new QdrantClient({
        url: this.config.url,
        apiKey: this.config.apiKey,
      }),
      dispose: async () => {
        // Qdrant client doesn't have explicit disconnect
        logger.info('VectorStore client disposed');
      },
    } as any);

    // Connect and ensure collections
    await this.connectWithRetry();
    await this.ensureCollections();

    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Stop the service
   */
  protected override async onStop(): Promise<void> {
    // Clear caches
    this.collectionCache.clear();
    logger.info('VectorStore stopped');
  }

  /**
   * Connect to Qdrant with retry logic
   */
  @Retry({
    attempts: 3,
    delay: 1000,
    backoff: 'exponential',
    retryIf: (error) => {
      const message = error.message.toLowerCase();
      return message.includes('connect') || message.includes('econnrefused');
    },
  })
  private async connectWithRetry(): Promise<void> {
    const start = Date.now();
    
    // Test connection
    const collections = await this.client.getCollections();
    const duration = Date.now() - start;

    this.emit('vector:connected', {
      url: this.config.url,
      collections: collections.collections.map(c => c.name),
    });

    logger.info('Vector store connected successfully', { 
      duration,
      collectionsFound: collections.collections.length,
    });
  }

  /**
   * Ensure all configured collections exist
   */
  @Metric({ name: 'vector.collections.ensure', recordDuration: true })
  private async ensureCollections(): Promise<void> {
    for (const collectionConfig of this.config.collections) {
      try {
        await this.client.getCollection(collectionConfig.name);
        logger.info(`Collection ${collectionConfig.name} already exists`);
      } catch (error) {
        // Collection doesn't exist, create it
        await this.createCollection(collectionConfig);
      }
    }

    // Cache collection stats
    await this.refreshCollectionStats();
  }

  /**
   * Create a new collection
   */
  @Metric({ name: 'vector.collection.create', recordDuration: true })
  private async createCollection(config: typeof this.config.collections[0]): Promise<void> {
    await this.client.createCollection(config.name, {
      vectors: {
        size: config.vectorSize,
        distance: config.distance,
      },
      on_disk_payload: config.onDiskPayload,
      optimizers_config: config.optimizersConfig,
    });

    this.emit('vector:collection-created', {
      name: config.name,
      dimension: config.vectorSize,
    });

    logger.info(`Created collection ${config.name} with vector size ${config.vectorSize}`);
  }

  /**
   * Health check for vector store connection
   */
  @HealthCheck({
    name: 'vector:connection',
    critical: true,
    interval: 30000,
    timeout: 5000,
  })
  async checkConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      const start = Date.now();
      const info = await this.client.getCollections();
      const latency = Date.now() - start;

      if (latency > 1000) {
        return {
          status: 'unhealthy',
          message: `Vector store latency too high: ${latency}ms`,
        };
      }

      return {
        status: 'healthy',
        message: `Vector store healthy with ${info.collections.length} collections (latency: ${latency}ms)`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Vector store connection failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Health check for collection status
   */
  @HealthCheck({
    name: 'vector:collections',
    critical: false,
    interval: 60000,
  })
  async checkCollections(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    const stats = await this.refreshCollectionStats();
    const unhealthyCollections = Array.from(stats.values())
      .filter(s => s.status !== 'green');

    if (unhealthyCollections.length > 0) {
      return {
        status: 'degraded',
        message: `${unhealthyCollections.length} collections in non-green state`,
      };
    }

    return {
      status: 'healthy',
      message: `All ${stats.size} collections are healthy`,
    };
  }

  /**
   * Upsert vectors into collection
   */
  @Metric({ name: 'vector.upsert', recordDuration: true })
  @CircuitBreaker({
    threshold: 5,
    timeout: 30000,
    resetTime: 60000,
  })
  @AIPerformance({
    operation: 'vector.upsert',
    trackMemory: true,
    trackLatency: true,
  })
  async upsert(
    collectionName: string,
    documents: VectorDocument[]
  ): Promise<void> {
    if (documents.length === 0) return;

    const start = Date.now();

    // Batch upsert for better performance
    const batches = this.batchDocuments(documents, this.config.batchSize);
    
    for (const batch of batches) {
      const points = batch.map(doc => ({
        id: doc.id,
        vector: doc.vector,
        payload: doc.payload,
      }));

      await this.client.upsert(collectionName, {
        wait: true,
        points,
      });
    }

    const duration = Date.now() - start;
    this.storeCount += documents.length;

    this.emit('vector:embeddings-stored', {
      collection: collectionName,
      count: documents.length,
      dimension: documents[0]?.vector.length || 0,
      metadata: {
        batchCount: batches.length,
        duration,
      },
    });

    logger.info(`Upserted ${documents.length} vectors to ${collectionName}`, {
      duration,
      batchCount: batches.length,
    });
  }

  /**
   * Search for similar vectors
   */
  @Metric({ name: 'vector.search', recordDuration: true })
  @VectorSearch({
    preFilter: true,
    hybridSearch: false,
    cacheResults: true,
    cacheTTL: 300, // 5 minutes
  })
  async search(
    collectionName: string,
    queryVector: number[],
    options: VectorSearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      limit = 10,
      filter,
      scoreThreshold = 0.7,
      offset = 0,
      includeVector = false,
      exact = false,
    } = options;

    const start = Date.now();

    const searchResult = await this.client.search(collectionName, {
      vector: queryVector,
      limit,
      offset,
      filter,
      score_threshold: scoreThreshold,
      with_payload: true,
      with_vector: includeVector,
      params: exact ? { exact: true } : undefined,
    });

    const duration = Date.now() - start;
    this.searchCount++;

    const results: SearchResult[] = searchResult.map(result => ({
      id: result.id as string,
      score: result.score,
      payload: result.payload || {},
      vector: includeVector ? (result.vector as number[]) : undefined,
    }));

    this.emit('vector:search-performed', {
      collection: collectionName,
      query: queryVector,
      results: results.length,
      duration,
      filters: filter,
    });

    return results;
  }

  /**
   * Delete vectors by IDs
   */
  @Metric({ name: 'vector.delete', recordDuration: true })
  async delete(collectionName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.client.delete(collectionName, {
      wait: true,
      points: ids,
    });

    logger.info(`Deleted ${ids.length} vectors from ${collectionName}`);
  }

  /**
   * Get vector by ID
   */
  @Metric({ name: 'vector.get-by-id', recordDuration: true })
  async getById(
    collectionName: string,
    id: string
  ): Promise<VectorDocument | null> {
    try {
      const points = await this.client.retrieve(collectionName, {
        ids: [id],
        with_vector: true,
        with_payload: true,
      });

      if (points.length === 0) {
        return null;
      }

      const point = points[0];
      return {
        id: point.id as string,
        vector: point.vector as number[],
        payload: point.payload || {},
      };
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to get vector by id ${id}:`, error);
      return null;
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(name: string): Promise<CollectionStats | null> {
    try {
      const collection = await this.client.getCollection(name);
      
      const stats: CollectionStats = {
        name,
        vectorsCount: collection.vectors_count || 0,
        indexedVectorsCount: collection.indexed_vectors_count || 0,
        pointsCount: collection.points_count || 0,
        segmentsCount: collection.segments_count || 0,
        status: collection.status as 'green' | 'yellow' | 'red',
        config: {
          vectorSize: collection.config?.params?.vectors?.size || 0,
          distance: collection.config?.params?.vectors?.distance || 'Cosine',
        },
      };

      this.collectionCache.set(name, stats);
      return stats;
    } catch (error) {
      logger.error(`Failed to get collection stats for ${name}:`, error);
      return null;
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    const collections = await this.client.getCollections();
    return collections.collections.map(c => c.name);
  }

  /**
   * Get service statistics
   */
  public getStats() {
    const uptime = Date.now() - this.metadata.startTime.getTime();
    const avgSearchTime = this.searchCount > 0
      ? Math.round(uptime / this.searchCount)
      : 0;

    return {
      searchCount: this.searchCount,
      storeCount: this.storeCount,
      errorCount: this.errorCount,
      collections: this.collectionCache.size,
      uptime,
      avgSearchTime,
      errorRate: this.searchCount > 0
        ? (this.errorCount / this.searchCount * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Scroll through collection points
   */
  @Metric({ name: 'vector.scroll', recordDuration: true })
  async scroll(
    collectionName: string,
    options: {
      limit?: number;
      offset?: string | number;
      filter?: Record<string, any>;
      withVector?: boolean;
    } = {}
  ): Promise<{
    points: VectorDocument[];
    nextOffset: string | number | null;
  }> {
    const result = await this.client.scroll(collectionName, {
      limit: options.limit || 100,
      offset: options.offset,
      filter: options.filter,
      with_vector: options.withVector || false,
      with_payload: true,
    });

    const points: VectorDocument[] = result.points.map(point => ({
      id: point.id as string,
      vector: (point.vector as number[]) || [],
      payload: point.payload || {},
    }));

    return {
      points,
      nextOffset: result.next_page_offset || null,
    };
  }

  /**
   * Update payload for existing vectors
   */
  @Metric({ name: 'vector.update-payload', recordDuration: true })
  async updatePayload(
    collectionName: string,
    updates: Array<{ id: string; payload: Record<string, any> }>
  ): Promise<void> {
    for (const update of updates) {
      await this.client.setPayload(collectionName, {
        payload: update.payload,
        points: [update.id],
        wait: true,
      });
    }

    logger.info(`Updated payload for ${updates.length} vectors in ${collectionName}`);
  }

  /**
   * Create snapshot of collection
   */
  @Metric({ name: 'vector.create-snapshot', recordDuration: true })
  async createSnapshot(collectionName: string): Promise<string> {
    const result = await this.client.createSnapshot(collectionName);
    logger.info(`Created snapshot for collection ${collectionName}`, result);
    return result.name;
  }

  /**
   * Private helper methods
   */

  private batchDocuments<T>(documents: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < documents.length; i += batchSize) {
      batches.push(documents.slice(i, i + batchSize));
    }
    return batches;
  }

  private async refreshCollectionStats(): Promise<Map<string, CollectionStats>> {
    this.collectionCache.clear();
    
    for (const config of this.config.collections) {
      const stats = await this.getCollectionStats(config.name);
      if (stats) {
        this.collectionCache.set(config.name, stats);
      }
    }

    return this.collectionCache;
  }

  private startMonitoring(): void {
    // Periodic metrics reporting
    setInterval(() => {
      const stats = this.getStats();
      
      this.emit('vector:metrics', {
        collections: this.collectionCache.size,
        totalPoints: Array.from(this.collectionCache.values())
          .reduce((sum, c) => sum + c.pointsCount, 0),
      });

      // Update metrics
      this.recordMetric('vector.searches.total', this.searchCount);
      this.recordMetric('vector.stores.total', this.storeCount);
      this.recordMetric('vector.errors.total', this.errorCount);
    }, 60000); // Every minute
  }
}