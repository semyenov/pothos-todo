import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/unjs-utils.js';
import { ohash } from 'ohash';

// Sharding configuration interface
export interface ShardConfig {
  id: string;
  name: string;
  connectionUrl: string;
  weight: number;
  isReadOnly: boolean;
  region: string;
  priority: number;
  maxConnections: number;
  healthCheckInterval: number;
}

export interface ShardingStrategy {
  type: 'hash' | 'range' | 'directory' | 'geographic';
  keyField: string;
  rules?: ShardingRule[];
}

export interface ShardingRule {
  condition: string;
  shardId: string;
  weight?: number;
}

export interface ReplicationConfig {
  enabled: boolean;
  strategy: 'master-slave' | 'master-master' | 'multi-master';
  readPreference: 'primary' | 'secondary' | 'nearest' | 'load-balanced';
  writeConsistency: 'strong' | 'eventual' | 'session';
  failoverTimeout: number;
  syncInterval: number;
}

// Database shard manager with enterprise-grade features
export class DatabaseShardingManager {
  private static instance: DatabaseShardingManager | null = null;
  private shards = new Map<string, PrismaClient>();
  private shardConfigs = new Map<string, ShardConfig>();
  private shardHealth = new Map<string, boolean>();
  private connectionPools = new Map<string, PrismaClient[]>();
  private readReplicas = new Map<string, PrismaClient[]>();
  private writeQueues = new Map<string, Array<() => Promise<any>>>();
  private metrics = new Map<string, ShardMetrics>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  private strategy: ShardingStrategy;
  private replicationConfig: ReplicationConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor(
    strategy: ShardingStrategy,
    replicationConfig: ReplicationConfig
  ) {
    this.strategy = strategy;
    this.replicationConfig = replicationConfig;
    this.startHealthChecking();
  }

  static getInstance(
    strategy?: ShardingStrategy,
    replicationConfig?: ReplicationConfig
  ): DatabaseShardingManager {
    if (!DatabaseShardingManager.instance) {
      if (!strategy || !replicationConfig) {
        throw new Error('ShardingStrategy and ReplicationConfig required for first initialization');
      }
      DatabaseShardingManager.instance = new DatabaseShardingManager(strategy, replicationConfig);
    }
    return DatabaseShardingManager.instance;
  }

  // Initialize database shards
  async initializeShards(shardConfigs: ShardConfig[]): Promise<void> {
    logger.info('Initializing database shards', { count: shardConfigs.length });

    for (const config of shardConfigs) {
      try {
        await this.addShard(config);
        logger.info(`Shard ${config.name} initialized successfully`);
      } catch (error) {
        logger.error(`Failed to initialize shard ${config.name}:`, error);
        throw error;
      }
    }

    logger.info('All database shards initialized successfully');
  }

  // Add a new shard to the cluster
  async addShard(config: ShardConfig): Promise<void> {
    try {
      // Create primary connection
      const prisma = new PrismaClient({
        datasources: {
          db: {
            url: config.connectionUrl,
          },
        },
        log: ['error', 'warn'],
      });

      // Test connection
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;

      // Store shard configuration and client
      this.shardConfigs.set(config.id, config);
      this.shards.set(config.id, prisma);
      this.shardHealth.set(config.id, true);
      this.metrics.set(config.id, new ShardMetrics(config.id));
      this.circuitBreakers.set(config.id, new CircuitBreaker(config.id));

      // Initialize connection pool
      await this.initializeConnectionPool(config);

      // Initialize read replicas if replication is enabled
      if (this.replicationConfig.enabled && !config.isReadOnly) {
        await this.initializeReadReplicas(config);
      }

      logger.info(`Shard ${config.name} added successfully`, {
        shardId: config.id,
        region: config.region,
        isReadOnly: config.isReadOnly,
      });
    } catch (error) {
      logger.error(`Failed to add shard ${config.name}:`, error);
      throw error;
    }
  }

  // Initialize connection pool for a shard
  private async initializeConnectionPool(config: ShardConfig): Promise<void> {
    const pool: PrismaClient[] = [];

    for (let i = 0; i < config.maxConnections; i++) {
      const client = new PrismaClient({
        datasources: {
          db: {
            url: config.connectionUrl,
          },
        },
        log: ['error'],
      });

      await client.$connect();
      pool.push(client);
    }

    this.connectionPools.set(config.id, pool);
    logger.info(`Connection pool initialized for shard ${config.name}`, {
      poolSize: config.maxConnections,
    });
  }

  // Initialize read replicas for a shard
  private async initializeReadReplicas(config: ShardConfig): Promise<void> {
    // In a real implementation, this would connect to actual read replicas
    // For now, we simulate with the same connection
    const replicas: PrismaClient[] = [];

    const replicaUrl = config.connectionUrl.replace('?', '?application_name=read_replica&');
    
    for (let i = 0; i < 2; i++) {
      const replica = new PrismaClient({
        datasources: {
          db: {
            url: replicaUrl,
          },
        },
        log: ['error'],
      });

      await replica.$connect();
      replicas.push(replica);
    }

    this.readReplicas.set(config.id, replicas);
    logger.info(`Read replicas initialized for shard ${config.name}`, {
      replicaCount: replicas.length,
    });
  }

  // Get the appropriate shard for a given key
  getShardForKey(key: string, operation: 'read' | 'write' = 'read'): PrismaClient {
    const shardId = this.determineShardId(key);
    const shard = this.getShardClient(shardId, operation);

    if (!shard) {
      throw new Error(`No available shard found for key: ${key}`);
    }

    return shard;
  }

  // Determine shard ID based on sharding strategy
  private determineShardId(key: string): string {
    switch (this.strategy.type) {
      case 'hash':
        return this.hashBasedSharding(key);
      case 'range':
        return this.rangeBasedSharding(key);
      case 'directory':
        return this.directoryBasedSharding(key);
      case 'geographic':
        return this.geographicSharding(key);
      default:
        throw new Error(`Unknown sharding strategy: ${this.strategy.type}`);
    }
  }

  // Hash-based sharding implementation
  private hashBasedSharding(key: string): string {
    const hash = ohash(key);
    const shardConfigs = Array.from(this.shardConfigs.values())
      .filter(config => !config.isReadOnly);
    
    if (shardConfigs.length === 0) {
      throw new Error('No write-capable shards available');
    }

    const index = Math.abs(hash) % shardConfigs.length;
    return shardConfigs[index].id;
  }

  // Range-based sharding implementation
  private rangeBasedSharding(key: string): string {
    if (!this.strategy.rules) {
      throw new Error('Range-based sharding requires rules configuration');
    }

    for (const rule of this.strategy.rules) {
      if (this.evaluateShardingRule(key, rule)) {
        return rule.shardId;
      }
    }

    // Fallback to first available shard
    const firstShard = Array.from(this.shardConfigs.values())
      .find(config => !config.isReadOnly);
    
    if (!firstShard) {
      throw new Error('No available shard found for range-based sharding');
    }

    return firstShard.id;
  }

  // Directory-based sharding implementation
  private directoryBasedSharding(key: string): string {
    // Simple directory lookup - in production this would use a distributed directory service
    const userId = key.split(':')[0];
    const userHash = ohash(userId);
    
    const shardConfigs = Array.from(this.shardConfigs.values())
      .filter(config => !config.isReadOnly);
    
    const index = Math.abs(userHash) % shardConfigs.length;
    return shardConfigs[index].id;
  }

  // Geographic sharding implementation
  private geographicSharding(key: string): string {
    // Extract region from key or use default
    const region = this.extractRegionFromKey(key) || 'us-west-2';
    
    // Find shard in the same region
    const regionalShard = Array.from(this.shardConfigs.values())
      .find(config => config.region === region && !config.isReadOnly);
    
    if (regionalShard) {
      return regionalShard.id;
    }

    // Fallback to nearest region
    const fallbackShard = Array.from(this.shardConfigs.values())
      .find(config => !config.isReadOnly);
    
    if (!fallbackShard) {
      throw new Error('No available shard found for geographic sharding');
    }

    return fallbackShard.id;
  }

  // Extract region from key (implement based on your key format)
  private extractRegionFromKey(key: string): string | null {
    // Example: user:us-west-2:12345
    const parts = key.split(':');
    if (parts.length >= 2 && parts[1].includes('-')) {
      return parts[1];
    }
    return null;
  }

  // Evaluate sharding rule
  private evaluateShardingRule(key: string, rule: ShardingRule): boolean {
    // Simple condition evaluation - extend as needed
    const [field, operator, value] = rule.condition.split(' ');
    
    switch (operator) {
      case '>=':
        return key >= value;
      case '<=':
        return key <= value;
      case '=':
        return key === value;
      case 'contains':
        return key.includes(value);
      default:
        return false;
    }
  }

  // Get shard client with load balancing and failover
  private getShardClient(shardId: string, operation: 'read' | 'write'): PrismaClient | null {
    // Check circuit breaker
    const circuitBreaker = this.circuitBreakers.get(shardId);
    if (circuitBreaker && circuitBreaker.isOpen()) {
      logger.warn(`Circuit breaker open for shard ${shardId}, using fallback`);
      return this.getFallbackShard(operation);
    }

    // Check shard health
    if (!this.shardHealth.get(shardId)) {
      logger.warn(`Shard ${shardId} is unhealthy, using fallback`);
      return this.getFallbackShard(operation);
    }

    // Handle read operations with replica support
    if (operation === 'read' && this.replicationConfig.enabled) {
      return this.getReadClient(shardId);
    }

    // Handle write operations
    return this.getWriteClient(shardId);
  }

  // Get read client with load balancing across replicas
  private getReadClient(shardId: string): PrismaClient | null {
    const replicas = this.readReplicas.get(shardId);
    const primary = this.shards.get(shardId);

    switch (this.replicationConfig.readPreference) {
      case 'primary':
        return primary || null;
      
      case 'secondary':
        if (replicas && replicas.length > 0) {
          const randomIndex = Math.floor(Math.random() * replicas.length);
          return replicas[randomIndex];
        }
        return primary || null;
      
      case 'nearest':
        // In production, implement actual latency-based selection
        return replicas && replicas.length > 0 ? replicas[0] : primary || null;
      
      case 'load-balanced':
        const allClients = [primary, ...(replicas || [])].filter(Boolean);
        if (allClients.length === 0) return null;
        
        const randomIndex = Math.floor(Math.random() * allClients.length);
        return allClients[randomIndex];
      
      default:
        return primary || null;
    }
  }

  // Get write client
  private getWriteClient(shardId: string): PrismaClient | null {
    return this.shards.get(shardId) || null;
  }

  // Get fallback shard when primary is unavailable
  private getFallbackShard(operation: 'read' | 'write'): PrismaClient | null {
    const availableShards = Array.from(this.shardConfigs.entries())
      .filter(([id, config]) => {
        const isHealthy = this.shardHealth.get(id);
        const isWritable = operation === 'read' || !config.isReadOnly;
        return isHealthy && isWritable;
      })
      .sort(([, a], [, b]) => b.priority - a.priority);

    if (availableShards.length === 0) {
      logger.error('No available fallback shards found');
      return null;
    }

    const [fallbackId] = availableShards[0];
    return this.getShardClient(fallbackId, operation);
  }

  // Execute query with automatic sharding
  async executeQuery<T>(
    key: string,
    operation: 'read' | 'write',
    query: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    const client = this.getShardForKey(key, operation);
    const shardId = this.getShardIdForClient(client);
    const metrics = this.metrics.get(shardId);
    const circuitBreaker = this.circuitBreakers.get(shardId);

    const startTime = Date.now();
    let result: T;

    try {
      result = await query(client);
      
      // Update metrics
      if (metrics) {
        metrics.recordSuccess(Date.now() - startTime);
      }
      
      // Reset circuit breaker on success
      if (circuitBreaker) {
        circuitBreaker.recordSuccess();
      }

      return result;
    } catch (error) {
      // Update metrics and circuit breaker
      if (metrics) {
        metrics.recordError();
      }
      
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }

      logger.error(`Query failed on shard ${shardId}:`, error);
      throw error;
    }
  }

  // Get shard ID for a client (reverse lookup)
  private getShardIdForClient(client: PrismaClient): string {
    for (const [shardId, shardClient] of this.shards.entries()) {
      if (shardClient === client) {
        return shardId;
      }
    }
    return 'unknown';
  }

  // Execute transaction across multiple shards (distributed transaction)
  async executeDistributedTransaction<T>(
    operations: Array<{
      key: string;
      operation: 'read' | 'write';
      query: (client: PrismaClient) => Promise<any>;
    }>
  ): Promise<T[]> {
    const results: T[] = [];
    const compensations: Array<() => Promise<void>> = [];

    try {
      for (const op of operations) {
        const client = this.getShardForKey(op.key, op.operation);
        const result = await op.query(client);
        results.push(result);

        // Add compensation action for rollback
        compensations.push(async () => {
          // Implement compensation logic based on operation type
          logger.info(`Compensating operation for key: ${op.key}`);
        });
      }

      return results;
    } catch (error) {
      // Execute compensations in reverse order
      for (let i = compensations.length - 1; i >= 0; i--) {
        try {
          await compensations[i]();
        } catch (compensationError) {
          logger.error('Compensation failed:', compensationError);
        }
      }

      throw error;
    }
  }

  // Start health checking for all shards
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000); // Check every 30 seconds
  }

  // Perform health checks on all shards
  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.shards.entries()).map(
      async ([shardId, client]) => {
        try {
          await client.$queryRaw`SELECT 1`;
          this.shardHealth.set(shardId, true);
          
          const metrics = this.metrics.get(shardId);
          if (metrics) {
            metrics.recordHealthCheck(true);
          }
        } catch (error) {
          this.shardHealth.set(shardId, false);
          
          const metrics = this.metrics.get(shardId);
          if (metrics) {
            metrics.recordHealthCheck(false);
          }

          logger.warn(`Health check failed for shard ${shardId}:`, error);
        }
      }
    );

    await Promise.allSettled(healthCheckPromises);
  }

  // Get cluster status and metrics
  getClusterStatus(): ClusterStatus {
    const shardStatuses = Array.from(this.shardConfigs.entries()).map(
      ([shardId, config]) => ({
        id: shardId,
        name: config.name,
        region: config.region,
        isHealthy: this.shardHealth.get(shardId) || false,
        isReadOnly: config.isReadOnly,
        metrics: this.metrics.get(shardId)?.getMetrics() || null,
        circuitBreakerState: this.circuitBreakers.get(shardId)?.getState() || 'closed',
      })
    );

    const healthyShards = shardStatuses.filter(s => s.isHealthy).length;
    const totalShards = shardStatuses.length;

    return {
      strategy: this.strategy,
      replicationConfig: this.replicationConfig,
      totalShards,
      healthyShards,
      shardStatuses,
      overallHealth: healthyShards / totalShards,
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down database sharding manager...');

    // Stop health checking
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Disconnect all clients
    const disconnectPromises: Promise<void>[] = [];

    // Disconnect primary shards
    for (const client of this.shards.values()) {
      disconnectPromises.push(client.$disconnect());
    }

    // Disconnect connection pools
    for (const pool of this.connectionPools.values()) {
      for (const client of pool) {
        disconnectPromises.push(client.$disconnect());
      }
    }

    // Disconnect read replicas
    for (const replicas of this.readReplicas.values()) {
      for (const replica of replicas) {
        disconnectPromises.push(replica.$disconnect());
      }
    }

    await Promise.allSettled(disconnectPromises);
    logger.info('Database sharding manager shutdown complete');
  }
}

// Shard metrics tracking
class ShardMetrics {
  private shardId: string;
  private queryCount = 0;
  private errorCount = 0;
  private totalLatency = 0;
  private lastHealthCheck: boolean = true;
  private healthCheckCount = 0;

  constructor(shardId: string) {
    this.shardId = shardId;
  }

  recordSuccess(latency: number): void {
    this.queryCount++;
    this.totalLatency += latency;
  }

  recordError(): void {
    this.errorCount++;
  }

  recordHealthCheck(success: boolean): void {
    this.lastHealthCheck = success;
    this.healthCheckCount++;
  }

  getMetrics() {
    return {
      shardId: this.shardId,
      queryCount: this.queryCount,
      errorCount: this.errorCount,
      errorRate: this.queryCount > 0 ? this.errorCount / this.queryCount : 0,
      averageLatency: this.queryCount > 0 ? this.totalLatency / this.queryCount : 0,
      lastHealthCheck: this.lastHealthCheck,
      healthCheckCount: this.healthCheckCount,
    };
  }
}

// Circuit breaker implementation
class CircuitBreaker {
  private shardId: string;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  // Configuration
  private readonly failureThreshold = 5;
  private readonly recoveryTimeout = 60000; // 1 minute
  private readonly halfOpenMaxRequests = 3;

  constructor(shardId: string) {
    this.shardId = shardId;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxRequests) {
        this.state = 'closed';
        this.successCount = 0;
        logger.info(`Circuit breaker closed for shard ${this.shardId}`);
      }
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'closed' && this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      logger.warn(`Circuit breaker opened for shard ${this.shardId}`);
    } else if (this.state === 'half-open') {
      this.state = 'open';
      this.successCount = 0;
    }
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
        this.state = 'half-open';
        this.successCount = 0;
        logger.info(`Circuit breaker half-open for shard ${this.shardId}`);
        return false;
      }
      return true;
    }
    
    return false;
  }

  getState(): string {
    return this.state;
  }
}

// Type definitions
interface ClusterStatus {
  strategy: ShardingStrategy;
  replicationConfig: ReplicationConfig;
  totalShards: number;
  healthyShards: number;
  shardStatuses: Array<{
    id: string;
    name: string;
    region: string;
    isHealthy: boolean;
    isReadOnly: boolean;
    metrics: any;
    circuitBreakerState: string;
  }>;
  overallHealth: number;
}

export type {
  ShardConfig,
  ShardingStrategy,
  ShardingRule,
  ReplicationConfig,
  ClusterStatus,
};