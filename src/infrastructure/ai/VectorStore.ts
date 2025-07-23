import { logger } from '@/logger';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingResult } from './EmbeddingService.js';
import { AsyncSingletonService, SingletonService } from '@/infrastructure/core/SingletonService.js';
import type { PrismaClient } from '@prisma/client';

export interface VectorSearchOptions {
  limit?: number;
  filter?: Record<string, any>;
  scoreThreshold?: number;
}

export interface VectorDocument {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

export interface VectorStoreConfig {
  url: string;
}

export class VectorStore extends AsyncSingletonService {
  private client: QdrantClient | null = null;
  private isConnected = false;

  protected constructor() {
    super();
  }


  public async configure(config: VectorStoreConfig): Promise<void> {
    await this.connect(config.url);
  }

  public async connect(url: string = 'http://localhost:6333'): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = new QdrantClient({ url });

      // Test connection
      await this.client.getCollections();

      this.isConnected = true;
      logger.info('Vector store connected');

      // Ensure collections exist
      await this.ensureCollections();
    } catch (error) {
      logger.error('Failed to connect to vector store:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      this.client = null;
      this.isConnected = false;
      logger.info('Vector store disconnected');
    }
  }

  private async ensureCollections(): Promise<void> {
    if (!this.client) throw new Error('Vector store not connected');

    const collections = [
      { name: 'todos', vectorSize: 1536 },
      { name: 'todoLists', vectorSize: 1536 }
    ];

    for (const { name, vectorSize } of collections) {
      try {
        await this.client.getCollection(name);
        logger.info(`Collection ${name} already exists`);
      } catch (error) {
        // Collection doesn't exist, create it
        await this.client.createCollection(name, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        });
        logger.info(`Created collection ${name}`);
      }
    }
  }

  public async upsert(
    collectionName: string,
    documents: VectorDocument[]
  ): Promise<void> {
    if (!this.client) throw new Error('Vector store not connected');

    const points = documents.map(doc => ({
      id: doc.id,
      vector: doc.vector,
      payload: doc.payload,
    }));

    await this.client.upsert(collectionName, {
      wait: true,
      points,
    });

    logger.info(`Upserted ${documents.length} vectors to ${collectionName}`);
  }

  public async search(
    collectionName: string,
    queryVector: number[],
    options: VectorSearchOptions = {}
  ): Promise<Array<{ id: string; score: number; payload: Record<string, any> }>> {
    if (!this.client) throw new Error('Vector store not connected');

    const { limit = 10, filter, scoreThreshold = 0.7 } = options;

    const searchResult = await this.client.search(collectionName, {
      vector: queryVector,
      limit,
      filter,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    return searchResult.map(result => ({
      id: result.id as string,
      score: result.score,
      payload: result.payload || {},
    }));
  }

  public async delete(collectionName: string, ids: string[]): Promise<void> {
    if (!this.client) throw new Error('Vector store not connected');

    await this.client.delete(collectionName, {
      wait: true,
      points: ids,
    });

    logger.info(`Deleted ${ids.length} vectors from ${collectionName}`);
  }

  public async getById(
    collectionName: string,
    id: string
  ): Promise<{ id: string; vector: number[]; payload: Record<string, any> } | null> {
    if (!this.client) throw new Error('Vector store not connected');

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
        id: point?.id as string,
        vector: point?.vector as number[],
        payload: point?.payload || {},
      };
    } catch (error) {
      logger.error(`Failed to get vector by id ${id}:`, error);
      return null;
    }
  }

  public async getCollection(name: string) {
    if (!this.client) throw new Error('Vector store not connected');
    const collection = await this.client.getCollection(name);
    return collection;
  }

  public async listCollections() {
    if (!this.client) throw new Error('Vector store not connected');
    const collections = await this.client.getCollections();
    return collections.collections.map((collection: { name: string }) => collection.name);
  }
}