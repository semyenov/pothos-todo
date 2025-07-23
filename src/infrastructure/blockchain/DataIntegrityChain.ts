import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';
import { KafkaEventStream, StreamEvent } from '@/infrastructure/streaming/KafkaEventStream';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager';
import { logger } from '@/logger';
import { ErrorHandler } from '@/infrastructure/core/ErrorHandler';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

export interface BlockchainConfig {
  enabled: boolean;
  networkId: string;
  nodeUrl?: string;
  contractAddress?: string;
  privateKey?: string;
  gasLimit: number;
  gasPrice: string;
  confirmationBlocks: number;
}

export interface DataBlock {
  id: string;
  index: number;
  timestamp: Date;
  previousHash: string;
  hash: string;
  nonce: number;
  data: BlockData;
  merkleRoot: string;
  signature: string;
  validator: string;
}

export interface BlockData {
  type: 'todo_created' | 'todo_updated' | 'todo_deleted' | 'user_created' | 'audit_log';
  entityId: string;
  userId: string;
  operation: string;
  payload: any;
  metadata: {
    timestamp: Date;
    version: number;
    correlationId: string;
    checksum: string;
  };
}

export interface IntegrityProof {
  blockId: string;
  blockHash: string;
  merkleProof: string[];
  transactionIndex: number;
  blockHeight: number;
  valid: boolean;
  verificationTime: Date;
}

export interface AuditTrail {
  entityId: string;
  entityType: string;
  operations: Array<{
    blockId: string;
    timestamp: Date;
    operation: string;
    userId: string;
    hash: string;
    verified: boolean;
  }>;
  integrityScore: number;
  lastVerified: Date;
}

export interface ConsensusNode {
  id: string;
  address: string;
  publicKey: string;
  stake: number;
  reputation: number;
  lastSeen: Date;
  active: boolean;
}

export class DataIntegrityChain extends AsyncSingletonService<DataIntegrityChain> {
  private config: BlockchainConfig;
  private blockchain: DataBlock[] = [];
  private pendingTransactions: BlockData[] = [];
  private consensusNodes: Map<string, ConsensusNode> = new Map();
  private eventStream: KafkaEventStream | null = null;
  private redis: RedisClusterManager | null = null;
  private errorHandler = ErrorHandler.getInstance();
  private miningInProgress = false;
  private validatorId: string;

  protected constructor() {
    super();
    this.validatorId = nanoid();
    this.config = this.loadConfig();
  }

  static async getInstance(): Promise<DataIntegrityChain> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Blockchain data integrity disabled by configuration');
      return;
    }

    try {
      logger.info('Initializing Data Integrity Blockchain...');
      
      this.eventStream = await KafkaEventStream.getInstance();
      this.redis = await RedisClusterManager.getInstance();
      
      // Load existing blockchain
      await this.loadBlockchain();
      
      // Initialize consensus nodes
      await this.initializeConsensusNodes();
      
      // Start event consumer
      await this.startEventConsumer();
      
      // Start mining process
      await this.startMiningProcess();
      
      // Start integrity verification
      await this.startIntegrityVerification();
      
      logger.info('Data Integrity Blockchain initialized', {
        blockCount: this.blockchain.length,
        pendingTransactions: this.pendingTransactions.length,
        consensusNodes: this.consensusNodes.size,
      });
    } catch (error) {
      logger.error('Failed to initialize Data Integrity Blockchain', error);
      throw error;
    }
  }

  async addTransaction(data: BlockData): Promise<string> {
    if (!this.config.enabled) {
      return '';
    }

    // Add checksum to metadata
    data.metadata.checksum = this.calculateChecksum(data.payload);
    data.metadata.correlationId = nanoid();

    this.pendingTransactions.push(data);
    
    logger.debug('Transaction added to pending pool', {
      type: data.type,
      entityId: data.entityId,
      correlationId: data.metadata.correlationId,
    });

    return data.metadata.correlationId;
  }

  async verifyIntegrity(entityId: string, entityType: string): Promise<IntegrityProof[]> {
    const proofs: IntegrityProof[] = [];
    
    // Find all blocks containing the entity
    const entityBlocks = this.blockchain.filter(block => 
      block.data.entityId === entityId
    );

    for (const block of entityBlocks) {
      const proof = await this.generateIntegrityProof(block);
      proofs.push(proof);
    }

    logger.info('Integrity verification completed', {
      entityId,
      entityType,
      proofsGenerated: proofs.length,
      allValid: proofs.every(p => p.valid),
    });

    return proofs;
  }

  async getAuditTrail(entityId: string, entityType: string): Promise<AuditTrail> {
    const operations = this.blockchain
      .filter(block => block.data.entityId === entityId)
      .map(block => ({
        blockId: block.id,
        timestamp: block.timestamp,
        operation: block.data.operation,
        userId: block.data.userId,
        hash: block.hash,
        verified: this.verifyBlockHash(block),
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const integrityScore = this.calculateIntegrityScore(operations);

    return {
      entityId,
      entityType,
      operations,
      integrityScore,
      lastVerified: new Date(),
    };
  }

  async validateChain(): Promise<{
    valid: boolean;
    invalidBlocks: string[];
    brokenLinks: Array<{ blockId: string; expectedHash: string; actualHash: string }>;
    consensusReached: boolean;
  }> {
    const invalidBlocks: string[] = [];
    const brokenLinks: Array<{ blockId: string; expectedHash: string; actualHash: string }> = [];

    // Validate each block
    for (let i = 0; i < this.blockchain.length; i++) {
      const block = this.blockchain[i];
      
      // Verify block hash
      if (!this.verifyBlockHash(block)) {
        invalidBlocks.push(block.id);
      }

      // Verify link to previous block
      if (i > 0) {
        const previousBlock = this.blockchain[i - 1];
        if (block.previousHash !== previousBlock.hash) {
          brokenLinks.push({
            blockId: block.id,
            expectedHash: previousBlock.hash,
            actualHash: block.previousHash,
          });
        }
      }
    }

    // Check consensus
    const consensusReached = await this.checkConsensus();

    const valid = invalidBlocks.length === 0 && brokenLinks.length === 0 && consensusReached;

    logger.info('Blockchain validation completed', {
      valid,
      totalBlocks: this.blockchain.length,
      invalidBlocks: invalidBlocks.length,
      brokenLinks: brokenLinks.length,
      consensusReached,
    });

    return {
      valid,
      invalidBlocks,
      brokenLinks,
      consensusReached,
    };
  }

  async getBlockchainStats(): Promise<{
    totalBlocks: number;
    totalTransactions: number;
    pendingTransactions: number;
    averageBlockTime: number;
    hashRate: number;
    consensusNodes: number;
    lastBlockTime: Date;
    integrityScore: number;
  }> {
    const totalBlocks = this.blockchain.length;
    const pendingTransactions = this.pendingTransactions.length;
    
    let averageBlockTime = 0;
    if (totalBlocks > 1) {
      const timeSpan = this.blockchain[totalBlocks - 1].timestamp.getTime() - 
                      this.blockchain[0].timestamp.getTime();
      averageBlockTime = timeSpan / (totalBlocks - 1);
    }

    const hashRate = this.calculateHashRate();
    const integrityScore = this.calculateOverallIntegrityScore();

    return {
      totalBlocks,
      totalTransactions: totalBlocks,
      pendingTransactions,
      averageBlockTime,
      hashRate,
      consensusNodes: this.consensusNodes.size,
      lastBlockTime: totalBlocks > 0 ? this.blockchain[totalBlocks - 1].timestamp : new Date(0),
      integrityScore,
    };
  }

  private async mineBlock(): Promise<DataBlock | null> {
    if (this.pendingTransactions.length === 0 || this.miningInProgress) {
      return null;
    }

    this.miningInProgress = true;

    try {
      const previousBlock = this.blockchain[this.blockchain.length - 1];
      const transactions = this.pendingTransactions.splice(0, 10); // Take up to 10 transactions
      
      if (transactions.length === 0) {
        return null;
      }

      const block: DataBlock = {
        id: nanoid(),
        index: this.blockchain.length,
        timestamp: new Date(),
        previousHash: previousBlock ? previousBlock.hash : '0',
        hash: '',
        nonce: 0,
        data: transactions[0], // Simplified: one transaction per block
        merkleRoot: this.calculateMerkleRoot(transactions),
        signature: '',
        validator: this.validatorId,
      };

      // Proof of Work
      const target = '0000'; // Difficulty: 4 leading zeros
      let attempts = 0;
      const maxAttempts = 1000000;

      while (attempts < maxAttempts) {
        block.nonce = attempts;
        block.hash = this.calculateBlockHash(block);
        
        if (block.hash.startsWith(target)) {
          break;
        }
        
        attempts++;
      }

      if (attempts >= maxAttempts) {
        logger.warn('Failed to mine block: maximum attempts reached');
        return null;
      }

      // Sign the block
      block.signature = this.signBlock(block);

      // Validate with consensus
      if (await this.validateWithConsensus(block)) {
        this.blockchain.push(block);
        await this.saveBlock(block);

        logger.info('Block mined successfully', {
          blockId: block.id,
          index: block.index,
          hash: block.hash,
          nonce: block.nonce,
          attempts,
          transactions: transactions.length,
        });

        // Emit block mined event
        await this.eventStream?.publishEvent({
          id: nanoid(),
          type: 'BlockMined',
          aggregateId: block.id,
          payload: {
            blockId: block.id,
            index: block.index,
            hash: block.hash,
            validator: this.validatorId,
          },
          metadata: {
            timestamp: new Date(),
          },
        }, { topic: 'blockchain-events' });

        return block;
      } else {
        logger.warn('Block validation failed, discarding', { blockId: block.id });
        return null;
      }
    } finally {
      this.miningInProgress = false;
    }
  }

  private calculateBlockHash(block: DataBlock): string {
    const data = {
      index: block.index,
      timestamp: block.timestamp.toISOString(),
      previousHash: block.previousHash,
      data: block.data,
      merkleRoot: block.merkleRoot,
      nonce: block.nonce,
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private calculateMerkleRoot(transactions: BlockData[]): string {
    if (transactions.length === 0) {
      return '';
    }

    let hashes = transactions.map(tx => 
      crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex')
    );

    while (hashes.length > 1) {
      const newHashes = [];
      
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = hashes[i + 1] || left; // If odd number, duplicate last hash
        
        const combined = crypto
          .createHash('sha256')
          .update(left + right)
          .digest('hex');
        
        newHashes.push(combined);
      }
      
      hashes = newHashes;
    }

    return hashes[0];
  }

  private signBlock(block: DataBlock): string {
    // In a real implementation, this would use private key cryptography
    const blockData = JSON.stringify({
      id: block.id,
      hash: block.hash,
      validator: block.validator,
    });

    return crypto
      .createHash('sha256')
      .update(blockData + this.validatorId)
      .digest('hex');
  }

  private verifyBlockHash(block: DataBlock): boolean {
    const calculatedHash = this.calculateBlockHash(block);
    return calculatedHash === block.hash;
  }

  private calculateChecksum(data: any): string {
    return crypto
      .createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private async generateIntegrityProof(block: DataBlock): Promise<IntegrityProof> {
    const merkleProof: string[] = []; // Simplified
    
    return {
      blockId: block.id,
      blockHash: block.hash,
      merkleProof,
      transactionIndex: 0,
      blockHeight: block.index,
      valid: this.verifyBlockHash(block),
      verificationTime: new Date(),
    };
  }

  private calculateIntegrityScore(operations: any[]): number {
    if (operations.length === 0) return 100;
    
    const verifiedOperations = operations.filter(op => op.verified).length;
    return Math.round((verifiedOperations / operations.length) * 100);
  }

  private calculateHashRate(): number {
    // Simplified hash rate calculation
    if (this.blockchain.length < 2) return 0;
    
    const recentBlocks = this.blockchain.slice(-10);
    const totalTime = recentBlocks[recentBlocks.length - 1].timestamp.getTime() - 
                     recentBlocks[0].timestamp.getTime();
    
    return recentBlocks.length / (totalTime / 1000); // blocks per second
  }

  private calculateOverallIntegrityScore(): number {
    if (this.blockchain.length === 0) return 100;
    
    const validBlocks = this.blockchain.filter(block => this.verifyBlockHash(block)).length;
    return Math.round((validBlocks / this.blockchain.length) * 100);
  }

  private async validateWithConsensus(block: DataBlock): Promise<boolean> {
    // Simplified consensus validation
    // In a real implementation, this would involve network consensus
    
    const activeNodes = Array.from(this.consensusNodes.values()).filter(node => node.active);
    if (activeNodes.length === 0) {
      return true; // No consensus nodes, accept block
    }

    // Simulate consensus validation (majority approval)
    const approvals = Math.floor(Math.random() * activeNodes.length) + 1;
    const required = Math.ceil(activeNodes.length * 0.67); // 67% approval required
    
    return approvals >= required;
  }

  private async checkConsensus(): Promise<boolean> {
    const activeNodes = Array.from(this.consensusNodes.values()).filter(node => node.active);
    return activeNodes.length >= 1; // Simplified consensus check
  }

  private loadConfig(): BlockchainConfig {
    return {
      enabled: process.env.BLOCKCHAIN_ENABLED === 'true',
      networkId: process.env.BLOCKCHAIN_NETWORK_ID || 'pothos-todo-testnet',
      nodeUrl: process.env.BLOCKCHAIN_NODE_URL,
      contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS,
      privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
      gasLimit: parseInt(process.env.BLOCKCHAIN_GAS_LIMIT || '100000'),
      gasPrice: process.env.BLOCKCHAIN_GAS_PRICE || '20000000000',
      confirmationBlocks: parseInt(process.env.BLOCKCHAIN_CONFIRMATION_BLOCKS || '6'),
    };
  }

  private async loadBlockchain(): Promise<void> {
    try {
      if (!this.redis) return;

      const blockIds = await this.redis.lrange('blockchain:blocks', 0, -1);
      
      for (const blockId of blockIds) {
        const blockData = await this.redis.get(`blockchain:block:${blockId}`);
        if (blockData) {
          const block: DataBlock = JSON.parse(blockData);
          this.blockchain.push(block);
        }
      }

      this.blockchain.sort((a, b) => a.index - b.index);
      
      logger.debug('Blockchain loaded from storage', {
        blocks: this.blockchain.length,
      });
    } catch (error) {
      logger.error('Failed to load blockchain', error);
    }
  }

  private async saveBlock(block: DataBlock): Promise<void> {
    try {
      if (!this.redis) return;

      await this.redis.set(
        `blockchain:block:${block.id}`,
        JSON.stringify(block),
        7 * 24 * 60 * 60 // 7 days TTL
      );

      await this.redis.lpush('blockchain:blocks', block.id);
      
      // Keep only recent blocks
      await this.redis.ltrim('blockchain:blocks', 0, 9999);
    } catch (error) {
      logger.error('Failed to save block', error);
    }
  }

  private async initializeConsensusNodes(): Promise<void> {
    // Initialize with self as a consensus node
    const selfNode: ConsensusNode = {
      id: this.validatorId,
      address: 'localhost',
      publicKey: crypto.randomBytes(32).toString('hex'),
      stake: 100,
      reputation: 100,
      lastSeen: new Date(),
      active: true,
    };

    this.consensusNodes.set(this.validatorId, selfNode);
  }

  private async startEventConsumer(): Promise<void> {
    if (!this.eventStream) return;

    // Consumer for domain events that should be recorded on blockchain
    const consumer = await this.eventStream.subscribe({
      groupId: 'blockchain-integrity',
      topics: ['domain-events', 'todo-events', 'user-events'],
      handler: async (event: StreamEvent) => {
        await this.processEventForBlockchain(event);
      },
    });
  }

  private async processEventForBlockchain(event: StreamEvent): Promise<void> {
    try {
      // Only record certain high-value events
      const recordableEvents = [
        'TodoCreated',
        'TodoCompleted',
        'TodoDeleted',
        'UserCreated',
        'UserDeleted',
        'AuditLogCreated',
      ];

      if (!recordableEvents.includes(event.type)) {
        return;
      }

      const blockData: BlockData = {
        type: this.mapEventTypeToBlockType(event.type),
        entityId: event.aggregateId,
        userId: event.metadata.userId || 'system',
        operation: event.type,
        payload: event.payload,
        metadata: {
          timestamp: event.metadata.timestamp,
          version: 1,
          correlationId: event.id,
          checksum: '',
        },
      };

      await this.addTransaction(blockData);
    } catch (error) {
      logger.error('Failed to process event for blockchain', {
        eventType: event.type,
        eventId: event.id,
        error,
      });
    }
  }

  private mapEventTypeToBlockType(eventType: string): BlockData['type'] {
    switch (eventType) {
      case 'TodoCreated':
        return 'todo_created';
      case 'TodoCompleted':
      case 'TodoUpdated':
        return 'todo_updated';
      case 'TodoDeleted':
        return 'todo_deleted';
      case 'UserCreated':
        return 'user_created';
      default:
        return 'audit_log';
    }
  }

  private async startMiningProcess(): Promise<void> {
    const mineBlocks = async () => {
      try {
        await this.mineBlock();
      } catch (error) {
        logger.error('Error during block mining', error);
      }

      // Schedule next mining attempt
      setTimeout(mineBlocks, 10000); // Every 10 seconds
    };

    // Start mining
    setTimeout(mineBlocks, 5000); // Initial delay
  }

  private async startIntegrityVerification(): Promise<void> {
    const verifyIntegrity = async () => {
      try {
        const validation = await this.validateChain();
        
        if (!validation.valid) {
          logger.warn('Blockchain integrity issues detected', validation);
          
          // Emit integrity alert
          await this.eventStream?.publishEvent({
            id: nanoid(),
            type: 'BlockchainIntegrityAlert',
            aggregateId: 'blockchain',
            payload: validation,
            metadata: {
              timestamp: new Date(),
            },
          }, { topic: 'blockchain-events' });
        }
      } catch (error) {
        logger.error('Error during integrity verification', error);
      }

      // Schedule next verification
      setTimeout(verifyIntegrity, 60000); // Every minute
    };

    // Start verification
    setTimeout(verifyIntegrity, 30000); // Initial delay
  }
}

// Utility functions
export async function recordDataIntegrity(
  entityId: string,
  operation: string,
  payload: any,
  userId: string = 'system'
): Promise<string> {
  const blockchain = await DataIntegrityChain.getInstance();
  
  const blockData: BlockData = {
    type: 'audit_log',
    entityId,
    userId,
    operation,
    payload,
    metadata: {
      timestamp: new Date(),
      version: 1,
      correlationId: nanoid(),
      checksum: '',
    },
  };

  return await blockchain.addTransaction(blockData);
}

export async function verifyDataIntegrity(
  entityId: string,
  entityType: string
): Promise<{
  verified: boolean;
  proofs: IntegrityProof[];
  auditTrail: AuditTrail;
}> {
  const blockchain = await DataIntegrityChain.getInstance();
  
  const proofs = await blockchain.verifyIntegrity(entityId, entityType);
  const auditTrail = await blockchain.getAuditTrail(entityId, entityType);
  
  return {
    verified: proofs.every(p => p.valid),
    proofs,
    auditTrail,
  };
}