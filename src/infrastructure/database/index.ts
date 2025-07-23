// Advanced Database Infrastructure
export { DatabaseShardingManager } from './DatabaseShardingManager.js';
export { DatabaseReplicationManager } from './DatabaseReplicationManager.js';

export type {
  ShardConfig,
  ShardingStrategy,
  ShardingRule,
  ReplicationConfig,
  ClusterStatus,
} from './DatabaseShardingManager.js';

export type {
  ReplicationNodeConfig,
  ReplicationTopology,
  FailoverPolicy,
  ReplicationMetrics,
  ReplicationStatus,
} from './DatabaseReplicationManager.js';

// Advanced database service that combines sharding and replication
import { DatabaseShardingManager, type ShardingStrategy, type ReplicationConfig } from './DatabaseShardingManager.js';
import { DatabaseReplicationManager, type ReplicationTopology } from './DatabaseReplicationManager.js';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/unjs-utils.js';

export interface AdvancedDatabaseConfig {
  sharding: {
    enabled: boolean;
    strategy: ShardingStrategy;
    replicationConfig: ReplicationConfig;
  };
  replication: {
    enabled: boolean;
    topology: ReplicationTopology;
  };
  performance: {
    connectionPoolSize: number;
    queryTimeout: number;
    retryAttempts: number;
    cacheEnabled: boolean;
  };
  monitoring: {
    metricsEnabled: boolean;
    healthCheckInterval: number;
    alertThresholds: {
      replicationLag: number;
      errorRate: number;
      responseTime: number;
    };
  };
}

export class AdvancedDatabaseService {
  private static instance: AdvancedDatabaseService | null = null;
  private shardingManager: DatabaseShardingManager | null = null;
  private replicationManager: DatabaseReplicationManager | null = null;
  private config: AdvancedDatabaseConfig;
  private queryCache = new Map<string, { result: any; timestamp: number; ttl: number }>();
  private isInitialized = false;

  private constructor(config: AdvancedDatabaseConfig) {
    this.config = config;
  }

  static getInstance(config?: AdvancedDatabaseConfig): AdvancedDatabaseService {
    if (!AdvancedDatabaseService.instance) {
      if (!config) {
        throw new Error('AdvancedDatabaseConfig required for first initialization');
      }
      AdvancedDatabaseService.instance = new AdvancedDatabaseService(config);
    }
    return AdvancedDatabaseService.instance;
  }

  // Initialize the advanced database service
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info('Initializing advanced database service...');

    try {
      // Initialize sharding if enabled
      if (this.config.sharding.enabled) {
        this.shardingManager = DatabaseShardingManager.getInstance(
          this.config.sharding.strategy,
          this.config.sharding.replicationConfig
        );
        logger.info('Database sharding manager initialized');
      }

      // Initialize replication if enabled
      if (this.config.replication.enabled) {
        this.replicationManager = DatabaseReplicationManager.getInstance(
          this.config.replication.topology
        );
        logger.info('Database replication manager initialized');
      }

      this.isInitialized = true;
      logger.info('Advanced database service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize advanced database service:', error);
      throw error;
    }
  }

  // Execute a read query with intelligent routing
  async executeRead<T>(
    key: string,
    query: (client: PrismaClient) => Promise<T>,
    options: {
      useCache?: boolean;
      cacheTtl?: number;
      consistencyLevel?: 'strong' | 'eventual';
      preferredRegion?: string;
    } = {}
  ): Promise<T> {
    const {
      useCache = this.config.performance.cacheEnabled,
      cacheTtl = 300000, // 5 minutes
      consistencyLevel = 'eventual',
      preferredRegion,
    } = options;

    // Check cache first
    if (useCache) {
      const cacheKey = this.generateCacheKey(key, query.toString());
      const cached = this.queryCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        logger.debug('Query result served from cache', { key: cacheKey });
        return cached.result;
      }
    }

    let result: T;

    // Route query based on configuration
    if (this.config.sharding.enabled && this.shardingManager) {
      // Use sharding manager
      result = await this.shardingManager.executeQuery(key, 'read', query);
    } else if (this.config.replication.enabled && this.replicationManager) {
      // Use replication manager
      result = await this.replicationManager.executeRead(query, {
        consistencyLevel,
        preferredRegion,
      });
    } else {
      // Fallback to default client
      const client = new PrismaClient();
      try {
        await client.$connect();
        result = await query(client);
      } finally {
        await client.$disconnect();
      }
    }

    // Cache the result
    if (useCache && result !== undefined) {
      const cacheKey = this.generateCacheKey(key, query.toString());
      this.queryCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
        ttl: cacheTtl,
      });
    }

    return result;
  }

  // Execute a write query with replication awareness
  async executeWrite<T>(
    key: string,
    query: (client: PrismaClient) => Promise<T>,
    options: {
      waitForReplicas?: boolean;
      invalidateCache?: boolean;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const {
      waitForReplicas = false,
      invalidateCache = true,
      timeout = this.config.performance.queryTimeout,
    } = options;

    let result: T;

    // Route write query
    if (this.config.sharding.enabled && this.shardingManager) {
      // Use sharding manager
      result = await this.shardingManager.executeQuery(key, 'write', query);
    } else if (this.config.replication.enabled && this.replicationManager) {
      // Use replication manager
      result = await this.replicationManager.executeWrite(query, {
        waitForReplicas,
        timeout,
      });
    } else {
      // Fallback to default client
      const client = new PrismaClient();
      try {
        await client.$connect();
        result = await query(client);
      } finally {
        await client.$disconnect();
      }
    }

    // Invalidate cache for write operations
    if (invalidateCache) {
      this.invalidateCacheByKey(key);
    }

    return result;
  }

  // Execute distributed transaction across multiple shards
  async executeDistributedTransaction<T>(
    operations: Array<{
      key: string;
      operation: 'read' | 'write';
      query: (client: PrismaClient) => Promise<any>;
    }>
  ): Promise<T[]> {
    if (!this.config.sharding.enabled || !this.shardingManager) {
      throw new Error('Distributed transactions require sharding to be enabled');
    }

    return this.shardingManager.executeDistributedTransaction<T>(operations);
  }

  // Get database cluster status
  getClusterStatus(): DatabaseClusterStatus {
    const status: DatabaseClusterStatus = {
      sharding: null,
      replication: null,
      performance: {
        cacheHitRate: this.calculateCacheHitRate(),
        activeConnections: 0, // Would track actual connections
        averageResponseTime: 0, // Would track actual response times
      },
      health: {
        overall: 'healthy',
        components: [],
      },
    };

    // Get sharding status
    if (this.config.sharding.enabled && this.shardingManager) {
      status.sharding = this.shardingManager.getClusterStatus();
      status.health.components.push({
        name: 'sharding',
        status: status.sharding.overallHealth > 0.8 ? 'healthy' : 'degraded',
        details: `${status.sharding.healthyShards}/${status.sharding.totalShards} shards healthy`,
      });
    }

    // Get replication status
    if (this.config.replication.enabled && this.replicationManager) {
      status.replication = this.replicationManager.getReplicationStatus();
      status.health.components.push({
        name: 'replication',
        status: status.replication.overallHealth > 0.8 ? 'healthy' : 'degraded',
        details: `${status.replication.healthyNodes}/${status.replication.totalNodes} nodes healthy`,
      });
    }

    // Determine overall health
    const unhealthyComponents = status.health.components.filter(c => c.status !== 'healthy');
    if (unhealthyComponents.length === 0) {
      status.health.overall = 'healthy';
    } else if (unhealthyComponents.length === status.health.components.length) {
      status.health.overall = 'unhealthy';
    } else {
      status.health.overall = 'degraded';
    }

    return status;
  }

  // Generate cache key from query parameters
  private generateCacheKey(key: string, queryString: string): string {
    return `${key}:${Buffer.from(queryString).toString('base64')}`;
  }

  // Invalidate cache entries by key pattern
  private invalidateCacheByKey(keyPattern: string): void {
    const keysToDelete: string[] = [];
    
    for (const [cacheKey] of this.queryCache) {
      if (cacheKey.startsWith(keyPattern)) {
        keysToDelete.push(cacheKey);
      }
    }

    keysToDelete.forEach(key => this.queryCache.delete(key));
    
    if (keysToDelete.length > 0) {
      logger.debug(`Invalidated ${keysToDelete.length} cache entries for pattern: ${keyPattern}`);
    }
  }

  // Calculate cache hit rate
  private calculateCacheHitRate(): number {
    // This would be implemented with actual hit/miss tracking
    return 0.85; // Placeholder
  }

  // Perform maintenance tasks
  async performMaintenance(): Promise<void> {
    logger.info('Performing database maintenance...');

    // Clean expired cache entries
    this.cleanExpiredCache();

    // Additional maintenance tasks would go here
    // - Vacuum/optimize databases
    // - Update statistics
    // - Rotate logs
    // - Backup operations

    logger.info('Database maintenance completed');
  }

  // Clean expired cache entries
  private cleanExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, cached] of this.queryCache) {
      if (now - cached.timestamp >= cached.ttl) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.queryCache.delete(key));
    
    if (expiredKeys.length > 0) {
      logger.debug(`Cleaned ${expiredKeys.length} expired cache entries`);
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down advanced database service...');

    const shutdownPromises: Promise<void>[] = [];

    if (this.shardingManager) {
      shutdownPromises.push(this.shardingManager.shutdown());
    }

    if (this.replicationManager) {
      shutdownPromises.push(this.replicationManager.shutdown());
    }

    await Promise.allSettled(shutdownPromises);
    
    // Clear cache
    this.queryCache.clear();

    this.isInitialized = false;
    logger.info('Advanced database service shutdown complete');
  }
}

// Type definitions
interface DatabaseClusterStatus {
  sharding: any | null;
  replication: any | null;
  performance: {
    cacheHitRate: number;
    activeConnections: number;
    averageResponseTime: number;
  };
  health: {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'unhealthy';
      details: string;
    }>;
  };
}

export type { AdvancedDatabaseConfig, DatabaseClusterStatus };