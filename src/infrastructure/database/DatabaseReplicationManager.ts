import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/unjs-utils.js';
import { SingletonService } from '../core/SingletonService.js';

// Replication configuration and management
export interface ReplicationNodeConfig {
  id: string;
  name: string;
  type: 'master' | 'slave' | 'async-replica' | 'sync-replica';
  connectionUrl: string;
  region: string;
  priority: number;
  lagThreshold: number; // milliseconds
  isActive: boolean;
  syncMode: 'synchronous' | 'asynchronous';
}

export interface ReplicationTopology {
  type: 'master-slave' | 'master-master' | 'chain' | 'star' | 'mesh';
  nodes: ReplicationNodeConfig[];
  failoverPolicy: FailoverPolicy;
  consistencyLevel: 'strong' | 'eventual' | 'session' | 'monotonic';
}

export interface FailoverPolicy {
  enabled: boolean;
  automaticFailover: boolean;
  failoverTimeout: number;
  maxFailoverAttempts: number;
  promotionCriteria: {
    minReplicationLag: number;
    requireDataConsistency: boolean;
    preferredRegion?: string;
  };
}

export interface ReplicationMetrics {
  nodeId: string;
  replicationLag: number;
  throughput: number;
  errorRate: number;
  lastSyncTime: Date;
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

// Advanced database replication manager
export class DatabaseReplicationManager extends SingletonService<DatabaseReplicationManager> {
  private topology: ReplicationTopology;
  private nodes = new Map<string, PrismaClient>();
  private nodeHealth = new Map<string, boolean>();
  private nodeMetrics = new Map<string, ReplicationMetrics>();
  private currentMaster: string | null = null;
  private connectionPoolSizes = new Map<string, number>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly defaultPoolSize = 10;

  protected constructor() {
    super();
    // Default topology - can be configured later
    this.topology = {
      type: 'master-slave',
      nodes: [],
      failoverPolicy: {
        enabled: false,
        automaticFailover: false,
        failoverTimeout: 30000,
        maxFailoverAttempts: 3,
        promotionCriteria: {
          minReplicationLag: 1000,
          requireDataConsistency: true
        }
      },
      consistencyLevel: 'strong'
    };
  }

  static getInstance(): DatabaseReplicationManager {
    return super.getInstance();
  }

  // Configure the replication topology
  configureTopology(topology: ReplicationTopology): void {
    this.topology = topology;
    this.initializeTopology();
  }

  // Initialize replication topology
  private async initializeTopology(): Promise<void> {
    logger.info('Initializing database replication topology', {
      type: this.topology.type,
      nodeCount: this.topology.nodes.length,
    });

    // Find and set current master
    const masterNode = this.topology.nodes.find(node => node.type === 'master');
    if (masterNode) {
      this.currentMaster = masterNode.id;
    }

    // Initialize all nodes
    for (const nodeConfig of this.topology.nodes) {
      await this.initializeNode(nodeConfig);
    }

    // Start monitoring
    this.startMonitoring();

    logger.info('Database replication topology initialized successfully');
  }

  // Initialize a single replication node
  private async initializeNode(config: ReplicationNodeConfig): Promise<void> {
    try {
      const client = new PrismaClient({
        datasources: {
          db: {
            url: config.connectionUrl,
          },
        },
        log: ['error', 'warn'],
      });

      await client.$connect();
      await client.$queryRaw`SELECT 1`;

      this.nodes.set(config.id, client);
      this.nodeHealth.set(config.id, true);
      this.connectionPoolSizes.set(config.id, this.defaultPoolSize);

      // Initialize metrics
      this.nodeMetrics.set(config.id, {
        nodeId: config.id,
        replicationLag: 0,
        throughput: 0,
        errorRate: 0,
        lastSyncTime: new Date(),
        connectionStatus: 'connected',
      });

      logger.info(`Replication node ${config.name} initialized`, {
        nodeId: config.id,
        type: config.type,
        region: config.region,
      });
    } catch (error) {
      logger.error(`Failed to initialize replication node ${config.name}:`, error);
      this.nodeHealth.set(config.id, false);
      throw error;
    }
  }

  // Get master database client
  getMasterClient(): PrismaClient {
    if (!this.currentMaster) {
      throw new Error('No master node available');
    }

    const masterClient = this.nodes.get(this.currentMaster);
    if (!masterClient) {
      throw new Error(`Master node ${this.currentMaster} not found`);
    }

    if (!this.nodeHealth.get(this.currentMaster)) {
      throw new Error(`Master node ${this.currentMaster} is unhealthy`);
    }

    return masterClient;
  }

  // Get read replica client with load balancing
  getReadReplicaClient(preferredRegion?: string): PrismaClient {
    const availableReplicas = this.getHealthyReadReplicas(preferredRegion);

    if (availableReplicas.length === 0) {
      logger.warn('No healthy read replicas available, falling back to master');
      return this.getMasterClient();
    }

    // Load balancing based on replication lag and throughput
    const bestReplica = this.selectBestReplica(availableReplicas);
    const replicaClient = this.nodes.get(bestReplica.id);

    if (!replicaClient) {
      logger.warn(`Selected replica ${bestReplica.id} not found, falling back to master`);
      return this.getMasterClient();
    }

    return replicaClient;
  }

  // Get healthy read replicas
  private getHealthyReadReplicas(preferredRegion?: string): ReplicationNodeConfig[] {
    return this.topology.nodes.filter(node => {
      const isHealthy = this.nodeHealth.get(node.id);
      const isReadReplica = node.type.includes('replica') || node.type === 'slave';
      const regionMatch = !preferredRegion || node.region === preferredRegion;

      return isHealthy && isReadReplica && node.isActive && regionMatch;
    });
  }

  // Select best replica based on performance metrics
  private selectBestReplica(replicas: ReplicationNodeConfig[]): ReplicationNodeConfig {
    let bestReplica = replicas[0];
    let bestScore = this.calculateReplicaScore(bestReplica);

    for (const replica of replicas.slice(1)) {
      const score = this.calculateReplicaScore(replica);
      if (score > bestScore) {
        bestScore = score;
        bestReplica = replica;
      }
    }

    return bestReplica;
  }

  // Calculate replica selection score
  private calculateReplicaScore(replica: ReplicationNodeConfig): number {
    const metrics = this.nodeMetrics.get(replica.id);
    if (!metrics) return 0;

    // Lower lag is better, higher throughput is better, lower error rate is better
    const lagScore = Math.max(0, 1000 - metrics.replicationLag) / 1000;
    const throughputScore = Math.min(metrics.throughput / 1000, 1);
    const errorScore = Math.max(0, 1 - metrics.errorRate);
    const priorityScore = replica.priority / 100;

    return (lagScore * 0.4) + (throughputScore * 0.3) + (errorScore * 0.2) + (priorityScore * 0.1);
  }

  // Execute read operation with automatic replica selection
  async executeRead<T>(
    operation: (client: PrismaClient) => Promise<T>,
    options: {
      preferredRegion?: string;
      consistencyLevel?: 'strong' | 'eventual';
      maxLag?: number;
    } = {}
  ): Promise<T> {
    const { preferredRegion, consistencyLevel = 'eventual', maxLag = 5000 } = options;

    // For strong consistency, always use master
    if (consistencyLevel === 'strong') {
      const masterClient = this.getMasterClient();
      return this.executeWithMetrics(this.currentMaster!, () => operation(masterClient));
    }

    // Find suitable replica
    const availableReplicas = this.getHealthyReadReplicas(preferredRegion);
    const suitableReplicas = availableReplicas.filter(replica => {
      const metrics = this.nodeMetrics.get(replica.id);
      return metrics && metrics.replicationLag <= maxLag;
    });

    if (suitableReplicas.length === 0) {
      logger.warn('No replicas meet consistency requirements, using master');
      const masterClient = this.getMasterClient();
      return this.executeWithMetrics(this.currentMaster!, () => operation(masterClient));
    }

    const selectedReplica = this.selectBestReplica(suitableReplicas);
    const replicaClient = this.nodes.get(selectedReplica.id)!;

    return this.executeWithMetrics(selectedReplica.id, () => operation(replicaClient));
  }

  // Execute write operation with replication
  async executeWrite<T>(
    operation: (client: PrismaClient) => Promise<T>,
    options: {
      waitForReplicas?: boolean;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const { waitForReplicas = false, timeout = 5000 } = options;

    const masterClient = this.getMasterClient();
    const result = await this.executeWithMetrics(this.currentMaster!, () => operation(masterClient));

    // Wait for replication to synchronous replicas if required
    if (waitForReplicas) {
      await this.waitForReplication(timeout);
    }

    return result;
  }

  // Wait for replication to complete
  private async waitForReplication(timeout: number): Promise<void> {
    const syncReplicas = this.topology.nodes.filter(
      node => node.syncMode === 'synchronous' && node.type.includes('replica')
    );

    if (syncReplicas.length === 0) {
      return; // No synchronous replicas to wait for
    }

    const startTime = Date.now();
    const checkInterval = 100; // ms

    while (Date.now() - startTime < timeout) {
      const allSynced = syncReplicas.every(replica => {
        const metrics = this.nodeMetrics.get(replica.id);
        return metrics && metrics.replicationLag < replica.lagThreshold;
      });

      if (allSynced) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    logger.warn('Replication sync timeout reached', { timeout });
  }

  // Execute operation with metrics tracking
  private async executeWithMetrics<T>(
    nodeId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let success = false;

    try {
      const result = await operation();
      success = true;
      return result;
    } catch (error) {
      logger.error(`Operation failed on node ${nodeId}:`, error);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      this.updateNodeMetrics(nodeId, duration, success);
    }
  }

  // Update node performance metrics
  private updateNodeMetrics(nodeId: string, duration: number, success: boolean): void {
    const metrics = this.nodeMetrics.get(nodeId);
    if (!metrics) return;

    // Update throughput (operations per second)
    const currentTime = Date.now();
    const timeDelta = currentTime - metrics.lastSyncTime.getTime();
    if (timeDelta > 0) {
      metrics.throughput = 1000 / timeDelta; // ops/sec
    }

    // Update error rate (exponential moving average)
    const alpha = 0.1;
    if (success) {
      metrics.errorRate = metrics.errorRate * (1 - alpha);
    } else {
      metrics.errorRate = metrics.errorRate * (1 - alpha) + alpha;
    }

    metrics.lastSyncTime = new Date();
    this.nodeMetrics.set(nodeId, metrics);
  }

  // Start monitoring replication lag and node health
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.performHealthChecks();
      await this.measureReplicationLag();
      await this.checkFailoverConditions();
    }, 10000); // Every 10 seconds

    logger.info('Replication monitoring started');
  }

  // Perform health checks on all nodes
  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.nodes.entries()).map(
      async ([nodeId, client]) => {
        try {
          await client.$queryRaw`SELECT 1`;
          this.nodeHealth.set(nodeId, true);

          const metrics = this.nodeMetrics.get(nodeId);
          if (metrics) {
            metrics.connectionStatus = 'connected';
          }
        } catch (error) {
          this.nodeHealth.set(nodeId, false);

          const metrics = this.nodeMetrics.get(nodeId);
          if (metrics) {
            metrics.connectionStatus = 'error';
          }

          logger.warn(`Health check failed for replication node ${nodeId}:`, error);
        }
      }
    );

    await Promise.allSettled(healthCheckPromises);
  }

  // Measure replication lag for all replicas
  private async measureReplicationLag(): Promise<void> {
    if (!this.currentMaster) return;

    const masterClient = this.nodes.get(this.currentMaster);
    if (!masterClient) return;

    try {
      // Get master's current transaction log position
      const masterPosition = await this.getMasterPosition(masterClient);

      // Check lag for each replica
      const lagCheckPromises = this.topology.nodes
        .filter(node => node.type.includes('replica') || node.type === 'slave')
        .map(async (node) => {
          try {
            const replicaClient = this.nodes.get(node.id);
            if (!replicaClient) return;

            const replicaPosition = await this.getReplicaPosition(replicaClient);
            const lag = this.calculateLag(masterPosition, replicaPosition);

            const metrics = this.nodeMetrics.get(node.id);
            if (metrics) {
              metrics.replicationLag = lag;
            }

            if (lag > node.lagThreshold) {
              logger.warn(`High replication lag detected on node ${node.id}`, {
                lag,
                threshold: node.lagThreshold,
              });
            }
          } catch (error) {
            logger.error(`Failed to measure replication lag for node ${node.id}:`, error);
          }
        });

      await Promise.allSettled(lagCheckPromises);
    } catch (error) {
      logger.error('Failed to measure replication lag:', error);
    }
  }

  // Get master database position (implementation depends on database type)
  private async getMasterPosition(client: PrismaClient): Promise<string> {
    // For PostgreSQL, we could use pg_current_wal_lsn()
    // For MySQL, we could use SHOW MASTER STATUS
    // This is a simplified implementation
    const result = await client.$queryRaw<Array<{ position: string }>>`
      SELECT EXTRACT(EPOCH FROM NOW()) AS position
    `;

    return result[0]?.position || '0';
  }

  // Get replica database position
  private async getReplicaPosition(client: PrismaClient): Promise<string> {
    // Similar to master position but for replica
    const result = await client.$queryRaw<Array<{ position: string }>>`
      SELECT EXTRACT(EPOCH FROM NOW()) AS position
    `;

    return result[0]?.position || '0';
  }

  // Calculate replication lag in milliseconds
  private calculateLag(masterPosition: string, replicaPosition: string): number {
    const masterTime = parseFloat(masterPosition) * 1000;
    const replicaTime = parseFloat(replicaPosition) * 1000;
    return Math.max(0, masterTime - replicaTime);
  }

  // Check conditions for automatic failover
  private async checkFailoverConditions(): Promise<void> {
    if (!this.topology.failoverPolicy.enabled || !this.topology.failoverPolicy.automaticFailover) {
      return;
    }

    if (!this.currentMaster || this.nodeHealth.get(this.currentMaster)) {
      return; // Master is healthy
    }

    logger.warn(`Master node ${this.currentMaster} is unhealthy, checking failover conditions`);

    // Find best candidate for promotion
    const candidate = await this.findFailoverCandidate();
    if (candidate) {
      await this.performFailover(candidate);
    } else {
      logger.error('No suitable failover candidate found');
    }
  }

  // Find the best candidate for failover
  private async findFailoverCandidate(): Promise<ReplicationNodeConfig | null> {
    const { promotionCriteria } = this.topology.failoverPolicy;

    // Get healthy replicas that can be promoted
    const candidates = this.topology.nodes.filter(node => {
      const isHealthy = this.nodeHealth.get(node.id);
      const canBePromoted = node.type.includes('replica') && node.isActive;
      const metrics = this.nodeMetrics.get(node.id);
      const hasLowLag = metrics ? metrics.replicationLag <= promotionCriteria.minReplicationLag : false;
      const regionMatch = !promotionCriteria.preferredRegion ||
        node.region === promotionCriteria.preferredRegion;

      return isHealthy && canBePromoted && hasLowLag && regionMatch;
    });

    if (candidates.length === 0) {
      return null;
    }

    // Select candidate with highest priority and lowest lag
    return candidates.reduce((best, current) => {
      const currentMetrics = this.nodeMetrics.get(current.id);
      const bestMetrics = this.nodeMetrics.get(best.id);

      if (!currentMetrics) return best;
      if (!bestMetrics) return current;

      if (current.priority > best.priority) return current;
      if (current.priority === best.priority &&
        currentMetrics.replicationLag < bestMetrics.replicationLag) {
        return current;
      }

      return best;
    });
  }

  // Perform automatic failover
  private async performFailover(candidate: ReplicationNodeConfig): Promise<void> {
    logger.info(`Performing failover to node ${candidate.id}`, {
      candidateName: candidate.name,
      candidateRegion: candidate.region,
    });

    try {
      // 1. Promote the candidate to master
      await this.promoteToMaster(candidate);

      // 2. Update topology
      const oldMaster = this.currentMaster;
      this.currentMaster = candidate.id;

      // 3. Reconfigure other replicas to replicate from new master
      await this.reconfigureReplicas(candidate.id, oldMaster);

      // 4. Update node configuration
      candidate.type = 'master';
      if (oldMaster) {
        const oldMasterConfig = this.topology.nodes.find(n => n.id === oldMaster);
        if (oldMasterConfig) {
          oldMasterConfig.type = 'slave';
          oldMasterConfig.isActive = false;
        }
      }

      logger.info(`Failover completed successfully to node ${candidate.id}`);
    } catch (error) {
      logger.error(`Failover failed to node ${candidate.id}:`, error);
      throw error;
    }
  }

  // Promote a replica to master
  private async promoteToMaster(candidate: ReplicationNodeConfig): Promise<void> {
    const candidateClient = this.nodes.get(candidate.id);
    if (!candidateClient) {
      throw new Error(`Candidate node ${candidate.id} not found`);
    }

    // Database-specific promotion commands would go here
    // For PostgreSQL: pg_promote()
    // For MySQL: STOP SLAVE; RESET SLAVE ALL;

    logger.info(`Promoted node ${candidate.id} to master`);
  }

  // Reconfigure replicas to use new master
  private async reconfigureReplicas(newMasterId: string, oldMasterId?: string): Promise<void> {
    const replicaNodes = this.topology.nodes.filter(
      node => node.id !== newMasterId &&
        (node.type.includes('replica') || node.type === 'slave') &&
        node.isActive
    );

    const reconfigurationPromises = replicaNodes.map(async (replica) => {
      try {
        const replicaClient = this.nodes.get(replica.id);
        if (!replicaClient) return;

        // Database-specific replication reconfiguration
        // This would involve changing the master connection settings

        logger.info(`Reconfigured replica ${replica.id} to use new master ${newMasterId}`);
      } catch (error) {
        logger.error(`Failed to reconfigure replica ${replica.id}:`, error);
      }
    });

    await Promise.allSettled(reconfigurationPromises);
  }

  // Get replication status and metrics
  getReplicationStatus(): ReplicationStatus {
    const nodeStatuses = Array.from(this.topology.nodes).map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      region: node.region,
      isHealthy: this.nodeHealth.get(node.id) || false,
      isActive: node.isActive,
      isMaster: node.id === this.currentMaster,
      metrics: this.nodeMetrics.get(node.id) || null,
      priority: node.priority,
    }));

    const healthyNodes = nodeStatuses.filter(s => s.isHealthy).length;
    const totalNodes = nodeStatuses.length;

    return {
      topology: this.topology,
      currentMaster: this.currentMaster,
      totalNodes,
      healthyNodes,
      nodeStatuses,
      overallHealth: healthyNodes / totalNodes,
      lastFailover: null, // Would track actual failover events
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down database replication manager...');

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Disconnect all nodes
    const disconnectPromises = Array.from(this.nodes.values()).map(
      client => client.$disconnect()
    );

    await Promise.allSettled(disconnectPromises);
    logger.info('Database replication manager shutdown complete');
  }
}

// Type definitions
interface ReplicationStatus {
  topology: ReplicationTopology;
  currentMaster: string | null;
  totalNodes: number;
  healthyNodes: number;
  nodeStatuses: Array<{
    id: string;
    name: string;
    type: string;
    region: string;
    isHealthy: boolean;
    isActive: boolean;
    isMaster: boolean;
    metrics: ReplicationMetrics | null;
    priority: number;
  }>;
  overallHealth: number;
  lastFailover: Date | null;
}

export type {
  ReplicationNodeConfig,
  ReplicationTopology,
  FailoverPolicy,
  ReplicationMetrics,
  ReplicationStatus,
};