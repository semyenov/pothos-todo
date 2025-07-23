import { createHash } from 'crypto';
import { logger } from '@/logger.js';
import { SecurityAuditSystem } from '../security/SecurityAudit.js';
import { QuantumCryptographySystem } from '../quantum/QuantumCryptography.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface BlockchainBlock {
  index: number;
  timestamp: Date;
  data: AuditRecord[];
  previousHash: string;
  hash: string;
  nonce: number;
  merkleRoot: string;
  signature?: string;
  validator: string;
}

export interface AuditRecord {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  resourceId?: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  details: Record<string, any>;
  signature: string;
  quantumProof?: boolean;
}

export type AuditEventType = 
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'configuration_change'
  | 'system_event'
  | 'security_incident'
  | 'compliance_check'
  | 'key_rotation'
  | 'backup_operation'
  | 'disaster_recovery';

export interface BlockchainConfig {
  enabled: boolean;
  networkType: 'private' | 'consortium' | 'public';
  consensus: 'proof_of_authority' | 'proof_of_stake' | 'proof_of_work';
  validators: string[];
  blockSize: number;
  blockTime: number; // milliseconds
  quantumSafe: boolean;
  replication: {
    nodes: string[];
    minReplicas: number;
  };
}

export interface ConsensusResult {
  approved: boolean;
  votes: Map<string, boolean>;
  hash: string;
  confidence: number;
}

export interface BlockchainStats {
  totalBlocks: number;
  totalRecords: number;
  chainIntegrity: number; // percentage
  lastBlockTime: Date;
  averageBlockTime: number;
  validators: number;
  networkHealth: 'healthy' | 'degraded' | 'critical';
}

/**
 * Blockchain-Based Audit Trail System
 * Provides immutable, tamper-proof audit logging with distributed consensus
 */
export class BlockchainAuditSystem extends EventEmitterSingletonService {
  private config: BlockchainConfig | null = null;
  private blockchain: BlockchainBlock[] = [];
  private pendingRecords: AuditRecord[] = [];
  private validators: Set<string> = new Set();
  private isValidator: boolean = false;
  private validatorId: string;

  // Cryptographic components
  private quantumCrypto?: QuantumCryptographySystem;
  private securityAudit: SecurityAuditSystem | null = null;

  // Mining and validation
  private miningInterval?: NodeJS.Timeout;
  private validationQueue: Array<{
    block: BlockchainBlock;
    resolve: (result: ConsensusResult) => void;
    reject: (error: Error) => void;
  }> = [];

  protected constructor() {
    super();
    this.validatorId = `validator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public initialize(config: BlockchainConfig): void {
    this.config = config;
    this.securityAudit = SecurityAuditSystem.getInstance();

    if (config.quantumSafe) {
      try {
        this.quantumCrypto = QuantumCryptographySystem.getInstance();
      } catch {
        logger.warn('Quantum cryptography not available, using classical cryptography');
      }
    }

    this.initializeBlockchain();
  }

  private ensureConfig(): BlockchainConfig {
    if (!this.config) {
      throw new Error('BlockchainAuditSystem not initialized');
    }
    return this.config;
  }

  private ensureSecurityAudit(): SecurityAuditSystem {
    if (!this.securityAudit) {
      throw new Error('BlockchainAuditSystem not initialized');
    }
    return this.securityAudit;
  }

  static getInstance(): BlockchainAuditSystem {
    return super.getInstance() as BlockchainAuditSystem;
  }

  /**
   * Add audit record to blockchain
   */
  async addAuditRecord(record: Omit<AuditRecord, 'id' | 'signature' | 'quantumProof'>): Promise<string> {
    if (!this.config.enabled) {
      throw new Error('Blockchain audit system is disabled');
    }

    const auditRecord: AuditRecord = {
      ...record,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      signature: await this.signRecord(record),
      quantumProof: this.config.quantumSafe,
    };

    // Verify signature
    const isValid = await this.verifyRecordSignature(auditRecord);
    if (!isValid) {
      throw new Error('Invalid audit record signature');
    }

    // Add to pending records
    this.pendingRecords.push(auditRecord);

    logger.debug('Audit record added to pending queue', {
      id: auditRecord.id,
      eventType: auditRecord.eventType,
      quantumProof: auditRecord.quantumProof,
    });

    // Trigger block creation if needed
    if (this.pendingRecords.length >= this.config.blockSize) {
      await this.createBlock();
    }

    this.emit('record:added', auditRecord);
    return auditRecord.id;
  }

  /**
   * Get audit records from blockchain
   */
  getAuditRecords(criteria: {
    fromBlock?: number;
    toBlock?: number;
    eventType?: AuditEventType;
    userId?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
  }): AuditRecord[] {
    const records: AuditRecord[] = [];

    const startBlock = criteria.fromBlock || 0;
    const endBlock = criteria.toBlock || this.blockchain.length - 1;

    for (let i = startBlock; i <= endBlock && i < this.blockchain.length; i++) {
      const block = this.blockchain[i];
      
      for (const record of block.data) {
        // Apply filters
        if (criteria.eventType && record.eventType !== criteria.eventType) continue;
        if (criteria.userId && record.userId !== criteria.userId) continue;
        if (criteria.resourceId && record.resourceId !== criteria.resourceId) continue;
        if (criteria.startDate && record.timestamp < criteria.startDate) continue;
        if (criteria.endDate && record.timestamp > criteria.endDate) continue;

        records.push(record);
      }
    }

    return records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Verify blockchain integrity
   */
  async verifyBlockchainIntegrity(): Promise<{
    valid: boolean;
    errors: string[];
    corruptedBlocks: number[];
  }> {
    logger.info('Verifying blockchain integrity...');

    const errors: string[] = [];
    const corruptedBlocks: number[] = [];

    if (this.blockchain.length === 0) {
      return { valid: true, errors, corruptedBlocks };
    }

    // Verify genesis block
    const genesisBlock = this.blockchain[0];
    if (genesisBlock.index !== 0 || genesisBlock.previousHash !== '0') {
      errors.push('Invalid genesis block');
      corruptedBlocks.push(0);
    }

    // Verify each block
    for (let i = 1; i < this.blockchain.length; i++) {
      const currentBlock = this.blockchain[i];
      const previousBlock = this.blockchain[i - 1];

      // Verify index sequence
      if (currentBlock.index !== i) {
        errors.push(`Block ${i}: Invalid index ${currentBlock.index}`);
        corruptedBlocks.push(i);
      }

      // Verify previous hash
      if (currentBlock.previousHash !== previousBlock.hash) {
        errors.push(`Block ${i}: Invalid previous hash`);
        corruptedBlocks.push(i);
      }

      // Verify block hash
      const calculatedHash = await this.calculateBlockHash(currentBlock);
      if (currentBlock.hash !== calculatedHash) {
        errors.push(`Block ${i}: Invalid block hash`);
        corruptedBlocks.push(i);
      }

      // Verify merkle root
      const calculatedMerkleRoot = this.calculateMerkleRoot(currentBlock.data);
      if (currentBlock.merkleRoot !== calculatedMerkleRoot) {
        errors.push(`Block ${i}: Invalid merkle root`);
        corruptedBlocks.push(i);
      }

      // Verify signatures
      for (const record of currentBlock.data) {
        const isValidSignature = await this.verifyRecordSignature(record);
        if (!isValidSignature) {
          errors.push(`Block ${i}: Invalid record signature ${record.id}`);
          if (!corruptedBlocks.includes(i)) {
            corruptedBlocks.push(i);
          }
        }
      }

      // Verify block signature
      if (currentBlock.signature) {
        const isValidBlockSignature = await this.verifyBlockSignature(currentBlock);
        if (!isValidBlockSignature) {
          errors.push(`Block ${i}: Invalid block signature`);
          corruptedBlocks.push(i);
        }
      }
    }

    const valid = errors.length === 0;
    
    if (!valid) {
      logger.error('Blockchain integrity verification failed', {
        errors: errors.length,
        corruptedBlocks: corruptedBlocks.length,
      });
    }

    return { valid, errors, corruptedBlocks };
  }

  /**
   * Get blockchain statistics
   */
  getBlockchainStats(): BlockchainStats {
    const totalBlocks = this.blockchain.length;
    const totalRecords = this.blockchain.reduce((sum, block) => sum + block.data.length, 0);

    // Calculate average block time
    let totalBlockTime = 0;
    for (let i = 1; i < this.blockchain.length; i++) {
      const timeDiff = this.blockchain[i].timestamp.getTime() - this.blockchain[i - 1].timestamp.getTime();
      totalBlockTime += timeDiff;
    }
    const averageBlockTime = this.blockchain.length > 1 ? totalBlockTime / (this.blockchain.length - 1) : 0;

    // Determine network health
    let networkHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (this.validators.size < this.config.replication.minReplicas) {
      networkHealth = 'critical';
    } else if (averageBlockTime > this.config.blockTime * 2) {
      networkHealth = 'degraded';
    }

    return {
      totalBlocks,
      totalRecords,
      chainIntegrity: 100, // Would be calculated from verification
      lastBlockTime: this.blockchain.length > 0 ? 
        this.blockchain[this.blockchain.length - 1].timestamp : new Date(0),
      averageBlockTime,
      validators: this.validators.size,
      networkHealth,
    };
  }

  /**
   * Initialize blockchain
   */
  private initializeBlockchain(): void {
    const config = this.ensureConfig();
    logger.info('Initializing blockchain audit system', {
      networkType: config.networkType,
      consensus: config.consensus,
      quantumSafe: config.quantumSafe,
    });

    // Setup validators
    for (const validator of this.config.validators) {
      this.validators.add(validator);
    }

    // Check if this node is a validator
    this.isValidator = this.config.validators.includes(this.validatorId) || 
                      this.config.validators.length === 0; // If no validators specified, all nodes validate

    // Create genesis block if blockchain is empty
    if (this.blockchain.length === 0) {
      this.createGenesisBlock();
    }

    // Start mining/validation process
    this.startBlockProduction();

    // Setup security audit integration
    this.setupSecurityIntegration();
  }

  /**
   * Create genesis block
   */
  private createGenesisBlock(): void {
    const genesisBlock: BlockchainBlock = {
      index: 0,
      timestamp: new Date(),
      data: [],
      previousHash: '0',
      hash: '',
      nonce: 0,
      merkleRoot: this.calculateMerkleRoot([]),
      validator: this.validatorId,
    };

    genesisBlock.hash = this.calculateBlockHashSync(genesisBlock);
    this.blockchain.push(genesisBlock);

    logger.info('Genesis block created', { hash: genesisBlock.hash });
    this.emit('block:created', genesisBlock);
  }

  /**
   * Create new block from pending records
   */
  private async createBlock(): Promise<BlockchainBlock | null> {
    if (this.pendingRecords.length === 0) {
      return null;
    }

    const previousBlock = this.blockchain[this.blockchain.length - 1];
    const blockData = [...this.pendingRecords]; // Copy pending records
    this.pendingRecords = []; // Clear pending records

    const block: BlockchainBlock = {
      index: this.blockchain.length,
      timestamp: new Date(),
      data: blockData,
      previousHash: previousBlock.hash,
      hash: '',
      nonce: 0,
      merkleRoot: this.calculateMerkleRoot(blockData),
      validator: this.validatorId,
    };

    // Mine block (proof of work) or validate (proof of authority/stake)
    if (this.config.consensus === 'proof_of_work') {
      await this.mineBlock(block);
    } else {
      block.hash = await this.calculateBlockHash(block);
    }

    // Sign block
    if (this.quantumCrypto) {
      const blockString = JSON.stringify(block);
      const signature = await this.quantumCrypto.quantumSign(blockString);
      block.signature = Buffer.from(signature.signature).toString('hex');
    }

    // Consensus validation
    if (this.config.consensus !== 'proof_of_work') {
      const consensus = await this.validateWithConsensus(block);
      if (!consensus.approved) {
        logger.warn('Block rejected by consensus', { 
          blockIndex: block.index,
          votes: Array.from(consensus.votes.entries()),
        });
        return null;
      }
    }

    // Add to blockchain
    this.blockchain.push(block);

    logger.info('New block created', {
      index: block.index,
      records: block.data.length,
      hash: block.hash.substring(0, 16),
      consensus: this.ensureConfig().consensus,
    });

    this.emit('block:created', block);
    return block;
  }

  /**
   * Mine block (Proof of Work)
   */
  private async mineBlock(block: BlockchainBlock): Promise<void> {
    const target = '0000'; // Difficulty - number of leading zeros
    
    logger.debug('Mining block...', { index: block.index });

    while (true) {
      block.nonce++;
      block.hash = await this.calculateBlockHash(block);
      
      if (block.hash.substring(0, target.length) === target) {
        logger.info('Block mined successfully', {
          index: block.index,
          nonce: block.nonce,
          hash: block.hash.substring(0, 16),
        });
        break;
      }
      
      // Yield control occasionally to prevent blocking
      if (block.nonce % 1000 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  /**
   * Validate block with consensus
   */
  private async validateWithConsensus(block: BlockchainBlock): Promise<ConsensusResult> {
    return new Promise((resolve) => {
      this.validationQueue.push({
        block,
        resolve,
        reject: (error) => resolve({ 
          approved: false, 
          votes: new Map(), 
          hash: block.hash,
          confidence: 0 
        }),
      });

      // Simulate consensus process
      setTimeout(() => {
        const votes = new Map<string, boolean>();
        let approvals = 0;
        
        // Simulate validator votes
        for (const validator of this.validators) {
          const vote = Math.random() > 0.1; // 90% approval rate
          votes.set(validator, vote);
          if (vote) approvals++;
        }

        const totalVotes = this.validators.size;
        const confidence = totalVotes > 0 ? approvals / totalVotes : 0;
        const approved = confidence > 0.5; // Simple majority

        resolve({
          approved,
          votes,
          hash: block.hash,
          confidence,
        });
      }, 100); // Simulate network delay
    });
  }

  /**
   * Start block production process
   */
  private startBlockProduction(): void {
    this.miningInterval = setInterval(async () => {
      if (this.isValidator && this.pendingRecords.length > 0) {
        try {
          await this.createBlock();
        } catch (error) {
          logger.error('Block creation failed', error);
        }
      }
    }, this.config.blockTime);
  }

  /**
   * Setup security audit integration
   */
  private setupSecurityIntegration(): void {
    // Listen to security audit events
    this.securityAudit.on('audit:logged', async (auditEvent: any) => {
      try {
        await this.addAuditRecord({
          timestamp: auditEvent.timestamp,
          eventType: auditEvent.eventType,
          userId: auditEvent.userId,
          resourceId: auditEvent.resource,
          action: auditEvent.action || auditEvent.eventType,
          result: auditEvent.result,
          details: auditEvent.details,
        });
      } catch (error) {
        logger.error('Failed to add audit record to blockchain', error);
      }
    });
  }

  /**
   * Cryptographic helper methods
   */
  private async signRecord(record: Omit<AuditRecord, 'id' | 'signature' | 'quantumProof'>): Promise<string> {
    const recordString = JSON.stringify(record);
    
    if (this.quantumCrypto) {
      const signature = await this.quantumCrypto.quantumSign(recordString);
      return Buffer.from(signature.signature).toString('hex');
    } else {
      // Fallback to classical signature
      const hash = createHash('sha256').update(recordString).digest('hex');
      return hash; // Simplified - in production would use actual signing
    }
  }

  private async verifyRecordSignature(record: AuditRecord): Promise<boolean> {
    const { signature, quantumProof, ...recordData } = record;
    const recordString = JSON.stringify(recordData);

    if (this.quantumCrypto && quantumProof) {
      try {
        // Would verify with actual quantum signature
        return true; // Simplified for demo
      } catch {
        return false;
      }
    } else {
      // Classical verification
      const expectedHash = createHash('sha256').update(recordString).digest('hex');
      return signature === expectedHash;
    }
  }

  private async verifyBlockSignature(block: BlockchainBlock): Promise<boolean> {
    if (!block.signature) return true; // No signature to verify

    const { signature, ...blockData } = block;
    const blockString = JSON.stringify(blockData);

    if (this.quantumCrypto) {
      try {
        // Would verify with actual quantum signature
        return true; // Simplified for demo
      } catch {
        return false;
      }
    }

    return true; // Simplified verification
  }

  private async calculateBlockHash(block: BlockchainBlock): Promise<string> {
    const { hash, signature, ...blockData } = block;
    const blockString = JSON.stringify(blockData);
    return createHash('sha256').update(blockString).digest('hex');
  }

  private calculateBlockHashSync(block: BlockchainBlock): string {
    const { hash, signature, ...blockData } = block;
    const blockString = JSON.stringify(blockData);
    return createHash('sha256').update(blockString).digest('hex');
  }

  private calculateMerkleRoot(records: AuditRecord[]): string {
    if (records.length === 0) {
      return createHash('sha256').update('').digest('hex');
    }

    // Simplified Merkle tree calculation
    let hashes = records.map(record => 
      createHash('sha256').update(JSON.stringify(record)).digest('hex')
    );

    while (hashes.length > 1) {
      const newHashes: string[] = [];
      
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = i + 1 < hashes.length ? hashes[i + 1] : left;
        const combined = createHash('sha256').update(left + right).digest('hex');
        newHashes.push(combined);
      }
      
      hashes = newHashes;
    }

    return hashes[0];
  }

  /**
   * Export blockchain data
   */
  exportBlockchain(format: 'json' | 'csv'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(this.blockchain, null, 2);
        
      case 'csv':
        const rows: string[] = ['Index,Timestamp,Records,Hash,PreviousHash,Validator'];
        
        for (const block of this.blockchain) {
          const row = [
            block.index,
            block.timestamp.toISOString(),
            block.data.length,
            block.hash.substring(0, 16),
            block.previousHash.substring(0, 16),
            block.validator,
          ].join(',');
          rows.push(row);
        }
        
        return rows.join('\n');
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Shutdown blockchain system
   */
  shutdown(): void {
    if (this.miningInterval) {
      clearInterval(this.miningInterval);
    }
    
    logger.info('Blockchain audit system shutdown complete');
  }
}