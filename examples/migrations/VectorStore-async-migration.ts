/**
 * Migration Example: VectorStore (Async Initialization)
 * 
 * This example shows how to migrate a service that requires async initialization
 * to use the AsyncSingletonService base class.
 */

// ============================================
// BEFORE: Original VectorStore implementation
// ============================================
/*
export class VectorStore {
  private static instance: VectorStore | null = null;
  private client: QdrantClient | null = null;
  private isConnected = false;

  private constructor() { }

  public static getInstance(): VectorStore {
    if (!VectorStore.instance) {
      VectorStore.instance = new VectorStore();
    }
    return VectorStore.instance;
  }

  public async connect(url: string = 'http://localhost:6333'): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = new QdrantClient({ url });
      await this.client.getCollections();
      this.isConnected = true;
      logger.info('Vector store connected');
      await this.ensureCollections();
    } catch (error) {
      logger.error('Failed to connect to vector store:', error);
      throw error;
    }
  }

  // ... rest of the implementation
}

// Usage before:
const vectorStore = VectorStore.getInstance();
await vectorStore.connect(); // Manual connection required
*/

// ============================================
// AFTER: Migrated to use AsyncSingletonService
// ============================================

import { logger } from '@/logger';
import { QdrantClient } from '@qdrant/js-client-rest';
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';

export interface VectorSearchOptions {
  limit?: number;
  filter?: Record<string, any>;
  scoreThreshold?: number;
}

export class VectorStore extends AsyncSingletonService<VectorStore> {
  private client: QdrantClient | null = null;
  private isConnected = false;
  private readonly defaultUrl = 'http://localhost:6333';

  protected constructor() {
    super();
  }

  public static async getInstance(url?: string): Promise<VectorStore> {
    return super.getInstanceAsync(async (instance) => {
      await instance.connect(url);
    });
  }

  private async connect(url: string = this.defaultUrl): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = new QdrantClient({ url });
      await this.client.getCollections();
      this.isConnected = true;
      logger.info('Vector store connected');
      await this.ensureCollections();
    } catch (error) {
      logger.error('Failed to connect to vector store:', error);
      throw error;
    }
  }

  private async ensureCollections(): Promise<void> {
    // Implementation...
  }

  // ... rest of the implementation
}

// ============================================
// USAGE COMPARISON:
// ============================================

// Before (manual initialization):
const vectorStore1 = VectorStore.getInstance();
await vectorStore1.connect();
await vectorStore1.search('query');

// After (automatic initialization):
const vectorStore2 = await VectorStore.getInstance();
await vectorStore2.search('query'); // Already connected!

// With custom URL:
const vectorStore3 = await VectorStore.getInstance('http://custom:6333');

// ============================================
// MIGRATION STEPS:
// ============================================
/*
1. Import AsyncSingletonService instead of SingletonService
2. Change getInstance() to be async and return Promise<YourClass>
3. Use getInstanceAsync() with initialization callback
4. Move connection logic into the initialization callback
5. Make connect() method private if it shouldn't be called externally
6. Update all callers to await getInstance()

Benefits:
- Automatic initialization on first use
- No need to manually call connect()
- Prevents using service before it's ready
- Handles concurrent initialization requests
- Built-in initialization state tracking
*/

// ============================================
// TESTING EXAMPLE:
// ============================================
/*
import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';

describe('VectorStore', () => {
  beforeEach(() => {
    // Clear singleton instance for clean test state
    AsyncSingletonService.clearAllInstances();
  });

  it('should initialize only once', async () => {
    const instance1 = await VectorStore.getInstance();
    const instance2 = await VectorStore.getInstance();
    
    expect(instance1).toBe(instance2);
    expect(AsyncSingletonService.isInitialized('VectorStore')).toBe(true);
  });
});
*/