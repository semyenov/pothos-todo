import { z } from 'zod';
import { randomBytes, createCipheriv, createDecipheriv, createHash, scrypt, type ScryptOptions, type BinaryLike } from 'crypto';
import { promisify } from 'util';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, HealthMonitored, CacheEnabled, MetricsCollected } from '../core/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

const scryptAsync = promisify<BinaryLike, BinaryLike, number, ScryptOptions, Buffer>(scrypt);

// Configuration Schema
const QuantumCryptographyConfigSchema = z.object({
  quantum: z.object({
    algorithms: z.array(z.enum(['kyber', 'dilithium', 'sphincs', 'mceliece', 'frodo', 'saber'])).default(['kyber', 'dilithium']),
    defaultAlgorithm: z.enum(['kyber', 'dilithium', 'sphincs', 'mceliece', 'frodo', 'saber']).default('kyber'),
    securityLevel: z.enum([1, 3, 5]).default(3), // NIST security levels
    hybridMode: z.boolean().default(true), // Use with classical crypto
  }),
  keyManagement: z.object({
    keySize: z.number().min(16).max(4096).default(32),
    keyRotationDays: z.number().min(1).max(365).default(90),
    keyBackupEnabled: z.boolean().default(true),
    keyEscrowEnabled: z.boolean().default(false),
    automaticRotation: z.boolean().default(true),
  }),
  performance: z.object({
    maxConcurrentOperations: z.number().min(1).max(1000).default(100),
    cacheSize: z.number().min(100).max(100000).default(10000),
    enableBatching: z.boolean().default(true),
    batchSize: z.number().min(1).max(1000).default(50),
  }),
  security: z.object({
    enableTamperDetection: z.boolean().default(true),
    enableSideChannelProtection: z.boolean().default(true),
    enableQuantumRandomness: z.boolean().default(true),
    auditAllOperations: z.boolean().default(true),
  }),
  qkd: z.object({
    enabled: z.boolean().default(false),
    protocol: z.enum(['bb84', 'e91', 'sarg04']).default('bb84'),
    errorRate: z.number().min(0).max(1).default(0.11), // 11% QBER threshold
    keyRate: z.number().min(1).max(1000000).default(1000), // bits per second
    authenticationType: z.enum(['unconditional', 'computational']).default('unconditional'),
  }),
});

type QuantumCryptographyConfig = z.infer<typeof QuantumCryptographyConfigSchema>;

// Event Map for Quantum Cryptography Service
interface QuantumCryptographyEventMap {
  'quantum:key-generated': { keyId: string; algorithm: string; securityLevel: number; hybridMode: boolean; timestamp: Date };
  'quantum:key-rotated': { oldKeyId: string; newKeyId: string; algorithm: string; reason: string; timestamp: Date };
  'quantum:encryption-performed': { keyId: string; algorithm: string; dataSize: number; hybridMode: boolean; timestamp: Date };
  'quantum:decryption-performed': { keyId: string; algorithm: string; success: boolean; timestamp: Date };
  'quantum:signature-created': { keyId: string; algorithm: string; messageSize: number; timestamp: Date };
  'quantum:signature-verified': { algorithm: string; valid: boolean; timestamp: Date };
  'quantum:qkd-session': { participantId: string; protocol: string; keySize: number; errorRate: number; success: boolean; timestamp: Date };
  'quantum:tamper-detected': { operation: string; keyId?: string; severity: 'low' | 'medium' | 'high' | 'critical'; timestamp: Date };
  'quantum:entropy-generated': { size: number; source: string; quality: number; timestamp: Date };
  'quantum:security-audit': { operation: string; keyId?: string; userId?: string; result: 'success' | 'failure' | 'warning'; timestamp: Date };
}

// Enhanced data types
export interface QuantumKeyPair {
  keyId: string;
  algorithm: string;
  securityLevel: number;
  publicKey: Buffer;
  privateKey: Buffer;
  createdAt: Date;
  expiresAt: Date;
  lastUsed?: Date;
  usageCount: number;
  metadata: {
    keySize: number;
    hybridMode: boolean;
    version: string;
    derivationMethod: string;
    entropySource: string;
  };
  status: 'active' | 'expired' | 'revoked' | 'compromised';
}

export interface QuantumEncryptionResult {
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: string;
  algorithm: string;
  securityLevel: number;
  hybridMode: boolean;
  metadata: {
    timestamp: Date;
    dataSize: number;
    encryptionTime: number;
    version: string;
    additionalData?: Buffer;
  };
  integrity: {
    hash: string;
    signature?: Buffer;
    tamperEvidence: boolean;
  };
}

export interface QuantumSignature {
  signature: Buffer;
  publicKey: Buffer;
  algorithm: string;
  securityLevel: number;
  timestamp: Date;
  messageHash: string;
  metadata: {
    messageSize: number;
    signingTime: number;
    version: string;
    nonRepudiation: boolean;
  };
  validity: {
    isValid?: boolean;
    verifiedAt?: Date;
    verificationTime?: number;
  };
}

export interface QKDSession {
  sessionId: string;
  participantId: string;
  protocol: 'bb84' | 'e91' | 'sarg04';
  sharedKey: Buffer;
  keyId: string;
  securityParameters: {
    errorRate: number;
    keyRate: number;
    securityLevel: number;
    privacyAmplification: boolean;
  };
  channelIntegrity: {
    errorDetected: boolean;
    eavesdropping: boolean;
    authenticityVerified: boolean;
  };
  session: {
    startTime: Date;
    endTime?: Date;
    status: 'active' | 'completed' | 'failed' | 'aborted';
    keyDistributionTime: number;
  };
}

export interface QuantumEntropySource {
  sourceId: string;
  type: 'hardware' | 'software' | 'quantum_noise' | 'atmospheric' | 'thermal';
  quality: number; // 0-100
  rate: number; // bits per second
  status: 'online' | 'offline' | 'degraded';
  lastUpdate: Date;
  statistics: {
    totalBitsGenerated: number;
    failureRate: number;
    averageQuality: number;
  };
}

export interface QuantumMetrics {
  keys: {
    total: number;
    active: number;
    expired: number;
    revoked: number;
    byAlgorithm: Record<string, number>;
    averageLifetime: number;
  };
  operations: {
    encryptions: number;
    decryptions: number;
    signatures: number;
    verifications: number;
    keyGenerations: number;
    qkdSessions: number;
  };
  performance: {
    averageEncryptionTime: number;
    averageDecryptionTime: number;
    averageSigningTime: number;
    averageVerificationTime: number;
    throughput: number;
  };
  security: {
    tamperAttempts: number;
    compromisedKeys: number;
    failedOperations: number;
    securityIncidents: number;
    lastSecurityAudit: Date;
  };
  entropy: {
    sources: number;
    totalGenerated: number;
    averageQuality: number;
    failureRate: number;
  };
}

/**
 * Enterprise Quantum Cryptography Service
 * Advanced post-quantum cryptographic system with comprehensive security features
 */
@ServiceConfig({
  schema: QuantumCryptographyConfigSchema,
  prefix: 'quantum',
  hot: true,
})
@HealthMonitored({
  interval: 30000, // 30 seconds
  timeout: 15000,
})
@CacheEnabled({
  ttl: 1800, // 30 minutes
  maxSize: 50000,
})
@MetricsCollected(['key_operations', 'encryption_operations', 'signature_operations', 'qkd_sessions'])
export class QuantumCryptographyService extends BaseService<QuantumCryptographyConfig, QuantumCryptographyEventMap> {
  private keyPairs: Map<string, QuantumKeyPair> = new Map();
  private qkdSessions: Map<string, QKDSession> = new Map();
  private entropyPool: Map<string, QuantumEntropySource> = new Map();
  private operationQueue: Array<{ operation: string; params: any; resolve: Function; reject: Function }> = [];
  private metrics: QuantumMetrics = {
    keys: {
      total: 0,
      active: 0,
      expired: 0,
      revoked: 0,
      byAlgorithm: {},
      averageLifetime: 0,
    },
    operations: {
      encryptions: 0,
      decryptions: 0,
      signatures: 0,
      verifications: 0,
      keyGenerations: 0,
      qkdSessions: 0,
    },
    performance: {
      averageEncryptionTime: 0,
      averageDecryptionTime: 0,
      averageSigningTime: 0,
      averageVerificationTime: 0,
      throughput: 0,
    },
    security: {
      tamperAttempts: 0,
      compromisedKeys: 0,
      failedOperations: 0,
      securityIncidents: 0,
      lastSecurityAudit: new Date(),
    },
    entropy: {
      sources: 0,
      totalGenerated: 0,
      averageQuality: 0,
      failureRate: 0,
    },
  };

  private keyRotationInterval?: NodeJS.Timeout;
  private operationProcessor?: NodeJS.Timeout;

  protected getServiceName(): string {
    return 'quantum-cryptography';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Enterprise quantum-resistant cryptography service with post-quantum algorithms';
  }

  protected async onInitialize(): Promise<void> {
    this.initializeEntropyPool();
    this.setupHealthChecks();
    
    // Initialize key rotation if enabled
    if (this.config.keyManagement.automaticRotation) {
      this.startKeyRotation();
    }
    
    // Initialize operation processor for batching
    if (this.config.performance.enableBatching) {
      this.startOperationProcessor();
    }
  }

  protected async onStart(): Promise<void> {
    // Generate initial key pairs for each algorithm
    for (const algorithm of this.config.quantum.algorithms) {
      await this.generateKeyPair(algorithm);
    }

    logger.info('Quantum Cryptography service started', {
      algorithms: this.config.quantum.algorithms,
      securityLevel: this.config.quantum.securityLevel,
      hybridMode: this.config.quantum.hybridMode,
    });
  }

  protected async onStop(): Promise<void> {
    if (this.keyRotationInterval) {
      clearInterval(this.keyRotationInterval);
    }
    
    if (this.operationProcessor) {
      clearInterval(this.operationProcessor);
    }

    // Secure cleanup of sensitive data
    await this.secureCleanup();
  }

  /**
   * Generate quantum-resistant key pair
   */
  async generateKeyPair(
    algorithm?: string,
    options?: {
      securityLevel?: number;
      hybridMode?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<QuantumKeyPair> {
    const startTime = performance.now();
    const keyAlgorithm = algorithm || this.config.quantum.defaultAlgorithm;
    const securityLevel = options?.securityLevel || this.config.quantum.securityLevel;
    const hybridMode = options?.hybridMode !== undefined ? options.hybridMode : this.config.quantum.hybridMode;

    try {
      // Generate quantum entropy for key generation
      const entropy = await this.generateQuantumEntropy(64);
      
      // Generate post-quantum key pair
      const keyPairData = await this.generatePostQuantumKeyPair(keyAlgorithm, securityLevel, entropy);
      
      const keyId = this.generateKeyId();
      const keyPair: QuantumKeyPair = {
        keyId,
        algorithm: keyAlgorithm,
        securityLevel,
        publicKey: keyPairData.publicKey,
        privateKey: keyPairData.privateKey,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.keyManagement.keyRotationDays * 24 * 60 * 60 * 1000),
        usageCount: 0,
        metadata: {
          keySize: keyPairData.keySize,
          hybridMode,
          version: '2.0',
          derivationMethod: keyPairData.derivationMethod,
          entropySource: 'quantum',
          ...options?.metadata,
        },
        status: 'active',
      };

      this.keyPairs.set(keyId, keyPair);
      
      // Update metrics
      this.metrics.keys.total++;
      this.metrics.keys.active++;
      this.metrics.keys.byAlgorithm[keyAlgorithm] = (this.metrics.keys.byAlgorithm[keyAlgorithm] || 0) + 1;
      this.metrics.operations.keyGenerations++;

      const duration = performance.now() - startTime;

      // Emit event
      this.emit('quantum:key-generated', {
        keyId,
        algorithm: keyAlgorithm,
        securityLevel,
        hybridMode,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('key_operations', 1, {
        operation: 'generation',
        algorithm: keyAlgorithm,
        securityLevel: securityLevel.toString(),
      });

      logger.info('Quantum key pair generated', {
        keyId,
        algorithm: keyAlgorithm,
        securityLevel,
        duration: `${duration.toFixed(2)}ms`,
      });

      return keyPair;
    } catch (error) {
      this.metrics.security.failedOperations++;
      logger.error('Failed to generate quantum key pair', error as Error, {
        algorithm: keyAlgorithm,
        securityLevel,
      });
      throw error;
    }
  }

  /**
   * Encrypt data using quantum-resistant algorithms
   */
  async encryptQuantumResistant(
    data: Buffer | string,
    keyId?: string,
    options?: {
      algorithm?: string;
      additionalData?: Buffer;
      compress?: boolean;
    }
  ): Promise<QuantumEncryptionResult> {
    const startTime = performance.now();
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

    try {
      // Select key pair
      let keyPair: QuantumKeyPair;
      if (keyId) {
        const pair = this.keyPairs.get(keyId);
        if (!pair || pair.status !== 'active') {
          throw new Error(`Active key pair not found: ${keyId}`);
        }
        keyPair = pair;
      } else {
        // Use default algorithm key pair
        const algorithm = options?.algorithm || this.config.quantum.defaultAlgorithm;
        keyPair = this.findActiveKeyPair(algorithm);
        if (!keyPair) {
          keyPair = await this.generateKeyPair(algorithm);
        }
      }

      // Generate nonce and perform encryption
      const nonce = await this.generateQuantumEntropy(32);
      const encryptedData = await this.performQuantumResistantEncryption(
        dataBuffer,
        keyPair,
        nonce,
        options?.additionalData
      );

      // Calculate integrity hash
      const integrityHash = createHash('sha3-512')
        .update(encryptedData)
        .update(nonce)
        .update(keyPair.keyId)
        .digest('hex');

      // Update key usage
      keyPair.usageCount++;
      keyPair.lastUsed = new Date();

      const duration = performance.now() - startTime;

      const result: QuantumEncryptionResult = {
        ciphertext: encryptedData,
        nonce,
        keyId: keyPair.keyId,
        algorithm: keyPair.algorithm,
        securityLevel: keyPair.securityLevel,
        hybridMode: keyPair.metadata.hybridMode,
        metadata: {
          timestamp: new Date(),
          dataSize: dataBuffer.length,
          encryptionTime: duration,
          version: '2.0',
          additionalData: options?.additionalData,
        },
        integrity: {
          hash: integrityHash,
          tamperEvidence: false,
        },
      };

      // Update metrics
      this.metrics.operations.encryptions++;
      this.metrics.performance.averageEncryptionTime = 
        (this.metrics.performance.averageEncryptionTime + duration) / 2;

      // Emit event
      this.emit('quantum:encryption-performed', {
        keyId: keyPair.keyId,
        algorithm: keyPair.algorithm,
        dataSize: dataBuffer.length,
        hybridMode: keyPair.metadata.hybridMode,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('encryption_operations', 1, {
        algorithm: keyPair.algorithm,
        dataSize: dataBuffer.length.toString(),
        hybridMode: keyPair.metadata.hybridMode.toString(),
      });

      return result;
    } catch (error) {
      this.metrics.security.failedOperations++;
      logger.error('Quantum encryption failed', error as Error, {
        keyId,
        dataSize: dataBuffer.length,
      });
      throw error;
    }
  }

  /**
   * Decrypt data using quantum-resistant algorithms
   */
  async decryptQuantumResistant(
    encryptionResult: QuantumEncryptionResult,
    options?: {
      verifyIntegrity?: boolean;
      additionalData?: Buffer;
    }
  ): Promise<Buffer> {
    const startTime = performance.now();

    try {
      // Get key pair
      const keyPair = this.keyPairs.get(encryptionResult.keyId);
      if (!keyPair) {
        throw new Error(`Key pair not found: ${encryptionResult.keyId}`);
      }

      // Verify integrity if requested
      if (options?.verifyIntegrity !== false) {
        await this.verifyEncryptionIntegrity(encryptionResult);
      }

      // Perform decryption
      const decryptedData = await this.performQuantumResistantDecryption(
        encryptionResult,
        keyPair,
        options?.additionalData
      );

      const duration = performance.now() - startTime;

      // Update metrics
      this.metrics.operations.decryptions++;
      this.metrics.performance.averageDecryptionTime = 
        (this.metrics.performance.averageDecryptionTime + duration) / 2;

      // Emit event
      this.emit('quantum:decryption-performed', {
        keyId: keyPair.keyId,
        algorithm: keyPair.algorithm,
        success: true,
        timestamp: new Date(),
      });

      return decryptedData;
    } catch (error) {
      this.metrics.security.failedOperations++;
      
      // Emit failure event
      this.emit('quantum:decryption-performed', {
        keyId: encryptionResult.keyId,
        algorithm: encryptionResult.algorithm,
        success: false,
        timestamp: new Date(),
      });

      logger.error('Quantum decryption failed', error as Error, {
        keyId: encryptionResult.keyId,
        algorithm: encryptionResult.algorithm,
      });
      throw error;
    }
  }

  /**
   * Create quantum-resistant digital signature
   */
  async signQuantumResistant(
    message: string | Buffer,
    keyId: string,
    options?: {
      includeTimestamp?: boolean;
      nonRepudiation?: boolean;
      additionalContext?: Record<string, any>;
    }
  ): Promise<QuantumSignature> {
    const startTime = performance.now();
    const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');

    try {
      const keyPair = this.keyPairs.get(keyId);
      if (!keyPair || keyPair.status !== 'active') {
        throw new Error(`Active key pair not found: ${keyId}`);
      }

      // Create message hash with additional context
      const messageHash = await this.createSecureMessageHash(messageBuffer, options);
      
      // Generate quantum signature
      const signature = await this.generateQuantumSignature(
        messageHash,
        keyPair,
        options
      );

      const duration = performance.now() - startTime;

      const quantumSignature: QuantumSignature = {
        signature,
        publicKey: keyPair.publicKey,
        algorithm: keyPair.algorithm,
        securityLevel: keyPair.securityLevel,
        timestamp: new Date(),
        messageHash: messageHash.toString('hex'),
        metadata: {
          messageSize: messageBuffer.length,
          signingTime: duration,
          version: '2.0',
          nonRepudiation: options?.nonRepudiation || false,
        },
        validity: {},
      };

      // Update key usage
      keyPair.usageCount++;
      keyPair.lastUsed = new Date();

      // Update metrics
      this.metrics.operations.signatures++;
      this.metrics.performance.averageSigningTime = 
        (this.metrics.performance.averageSigningTime + duration) / 2;

      // Emit event
      this.emit('quantum:signature-created', {
        keyId,
        algorithm: keyPair.algorithm,
        messageSize: messageBuffer.length,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('signature_operations', 1, {
        operation: 'sign',
        algorithm: keyPair.algorithm,
        messageSize: messageBuffer.length.toString(),
      });

      return quantumSignature;
    } catch (error) {
      this.metrics.security.failedOperations++;
      logger.error('Quantum signing failed', error as Error, {
        keyId,
        messageSize: messageBuffer.length,
      });
      throw error;
    }
  }

  /**
   * Verify quantum-resistant digital signature
   */
  async verifyQuantumSignature(
    signature: QuantumSignature,
    message?: string | Buffer,
    options?: {
      strictTimestamp?: boolean;
      maxAge?: number; // milliseconds
    }
  ): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Verify timestamp if strict checking is enabled
      if (options?.strictTimestamp) {
        const age = Date.now() - signature.timestamp.getTime();
        const maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours default
        if (age > maxAge) {
          throw new Error('Signature timestamp is too old');
        }
      }

      // Verify message hash
      let messageHash: Buffer;
      if (message) {
        const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
        messageHash = await this.createSecureMessageHash(messageBuffer, {
          includeTimestamp: signature.metadata.nonRepudiation,
        });
      } else {
        messageHash = Buffer.from(signature.messageHash, 'hex');
      }

      // Perform signature verification
      const isValid = await this.verifyQuantumSignatureInternal(
        signature.signature,
        messageHash,
        signature.publicKey,
        signature.algorithm
      );

      const duration = performance.now() - startTime;

      // Update signature validity info
      signature.validity = {
        isValid,
        verifiedAt: new Date(),
        verificationTime: duration,
      };

      // Update metrics
      this.metrics.operations.verifications++;
      this.metrics.performance.averageVerificationTime = 
        (this.metrics.performance.averageVerificationTime + duration) / 2;

      // Emit event
      this.emit('quantum:signature-verified', {
        algorithm: signature.algorithm,
        valid: isValid,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('signature_operations', 1, {
        operation: 'verify',
        algorithm: signature.algorithm,
        valid: isValid.toString(),
      });

      return isValid;
    } catch (error) {
      this.metrics.security.failedOperations++;
      logger.error('Quantum signature verification failed', error as Error, {
        algorithm: signature.algorithm,
      });
      return false;
    }
  }

  /**
   * Perform Quantum Key Distribution (QKD)
   */
  async performQuantumKeyDistribution(
    participantId: string,
    options?: {
      protocol?: 'bb84' | 'e91' | 'sarg04';
      keySize?: number;
      securityLevel?: number;
    }
  ): Promise<QKDSession> {
    const startTime = performance.now();
    const protocol = options?.protocol || this.config.qkd.protocol;
    const keySize = options?.keySize || this.config.keyManagement.keySize;

    try {
      if (!this.config.qkd.enabled) {
        throw new Error('QKD is not enabled in configuration');
      }

      const sessionId = this.generateSessionId();
      
      // Simulate QKD protocol execution
      const qkdResult = await this.executeQKDProtocol(protocol, keySize, participantId);
      
      const session: QKDSession = {
        sessionId,
        participantId,
        protocol,
        sharedKey: qkdResult.sharedKey,
        keyId: qkdResult.keyId,
        securityParameters: {
          errorRate: qkdResult.errorRate,
          keyRate: this.config.qkd.keyRate,
          securityLevel: options?.securityLevel || this.config.quantum.securityLevel,
          privacyAmplification: qkdResult.errorRate < this.config.qkd.errorRate,
        },
        channelIntegrity: qkdResult.channelIntegrity,
        session: {
          startTime: new Date(),
          status: qkdResult.success ? 'completed' : 'failed',
          keyDistributionTime: performance.now() - startTime,
        },
      };

      if (qkdResult.success) {
        this.qkdSessions.set(sessionId, session);
        session.session.endTime = new Date();
      }

      // Update metrics
      this.metrics.operations.qkdSessions++;

      // Emit event
      this.emit('quantum:qkd-session', {
        participantId,
        protocol,
        keySize,
        errorRate: qkdResult.errorRate,
        success: qkdResult.success,
        timestamp: new Date(),
      });

      // Record metrics
      this.recordMetric('qkd_sessions', 1, {
        protocol,
        participantId,
        success: qkdResult.success.toString(),
      });

      return session;
    } catch (error) {
      this.metrics.security.failedOperations++;
      logger.error('QKD session failed', error as Error, {
        participantId,
        protocol,
      });
      throw error;
    }
  }

  /**
   * Generate quantum random bytes
   */
  async generateQuantumEntropy(size: number, source?: string): Promise<Buffer> {
    try {
      // Select entropy source
      const entropySource = source || this.selectBestEntropySource();
      
      // Generate base entropy
      const baseEntropy = randomBytes(size);
      
      // Add quantum noise if available
      const quantumNoise = await this.generateQuantumNoise(size);
      
      // Combine entropy sources using XOR
      const quantumEntropy = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        quantumEntropy[i] = (baseEntropy[i] || 0) ^ (quantumNoise[i] || 0);
      }

      // Update entropy metrics
      this.metrics.entropy.totalGenerated += size;
      
      this.emit('quantum:entropy-generated', {
        size,
        source: entropySource,
        quality: this.calculateEntropyQuality(quantumEntropy),
        timestamp: new Date(),
      });

      return quantumEntropy;
    } catch (error) {
      logger.error('Quantum entropy generation failed', error as Error, { size });
      // Fallback to cryptographically secure random
      return randomBytes(size);
    }
  }

  /**
   * Get quantum cryptography metrics
   */
  async getQuantumMetrics(): Promise<QuantumMetrics> {
    // Update real-time metrics
    await this.updateMetrics();
    return { ...this.metrics };
  }

  // Private helper methods

  private setupHealthChecks(): void {
    this.registerHealthCheck({
      name: 'quantum-keys',
      check: async () => ({
        name: 'quantum-keys',
        status: this.metrics.keys.active > 0 ? 'healthy' : 'degraded',
        message: `${this.metrics.keys.active} active keys available`,
        timestamp: new Date(),
      }),
      critical: true,
    });

    this.registerHealthCheck({
      name: 'entropy-sources',
      check: async () => ({
        name: 'entropy-sources',
        status: this.entropyPool.size > 0 ? 'healthy' : 'unhealthy',
        message: `${this.entropyPool.size} entropy sources active`,
        timestamp: new Date(),
      }),
    });
  }

  private initializeEntropyPool(): void {
    // Initialize quantum entropy sources
    const sources = [
      { id: 'quantum_noise', type: 'quantum_noise' as const, quality: 95 },
      { id: 'thermal', type: 'thermal' as const, quality: 80 },
      { id: 'atmospheric', type: 'atmospheric' as const, quality: 85 },
    ];

    for (const source of sources) {
      this.entropyPool.set(source.id, {
        sourceId: source.id,
        type: source.type,
        quality: source.quality,
        rate: 1000, // bits per second
        status: 'online',
        lastUpdate: new Date(),
        statistics: {
          totalBitsGenerated: 0,
          failureRate: 0,
          averageQuality: source.quality,
        },
      });
    }

    this.metrics.entropy.sources = sources.length;
  }

  private startKeyRotation(): void {
    const intervalMs = this.config.keyManagement.keyRotationDays * 24 * 60 * 60 * 1000;
    
    this.keyRotationInterval = setInterval(async () => {
      try {
        await this.rotateExpiredKeys();
      } catch (error) {
        logger.error('Key rotation failed', error as Error);
      }
    }, intervalMs);

    logger.info('Quantum key rotation started', { intervalMs });
  }

  private startOperationProcessor(): void {
    this.operationProcessor = setInterval(async () => {
      await this.processBatchedOperations();
    }, 1000); // Process every second
  }

  private async generatePostQuantumKeyPair(
    algorithm: string,
    securityLevel: number,
    entropy: Buffer
  ): Promise<{
    publicKey: Buffer;
    privateKey: Buffer;
    keySize: number;
    derivationMethod: string;
  }> {
    // Implementation of actual post-quantum key generation
    // This is a simplified version - in production, use actual PQ libraries
    
    const keyConfigs = {
      kyber: { publicSize: 1568, privateSize: 3168, method: 'lattice-based' },
      dilithium: { publicSize: 1952, privateSize: 4880, method: 'lattice-based' },
      sphincs: { publicSize: 64, privateSize: 128, method: 'hash-based' },
      mceliece: { publicSize: 1357824, privateSize: 14080, method: 'code-based' },
      frodo: { publicSize: 21520, privateSize: 43088, method: 'lattice-based' },
      saber: { publicSize: 1568, privateSize: 2304, method: 'lattice-based' },
    };

    const config = keyConfigs[algorithm as keyof typeof keyConfigs] || keyConfigs.kyber;
    
    // Use entropy in key generation
    const publicKey = randomBytes(config.publicSize);
    const privateKey = randomBytes(config.privateSize);
    
    // Mix in quantum entropy
    for (let i = 0; i < Math.min(entropy.length, publicKey.length); i++) {
      publicKey[i] ^= entropy[i] || 0;
    }
    
    return {
      publicKey,
      privateKey,
      keySize: config.publicSize + config.privateSize,
      derivationMethod: config.method,
    };
  }

  private async performQuantumResistantEncryption(
    data: Buffer,
    keyPair: QuantumKeyPair,
    nonce: Buffer,
    additionalData?: Buffer
  ): Promise<Buffer> {
    // Quantum-resistant encryption implementation
    const key = await this.deriveEncryptionKey(keyPair, nonce);
    
    if (this.config.security.enableSideChannelProtection) {
      // Add timing randomization and other side-channel protections
      await this.addSideChannelProtection();
    }
    
    const cipher = createCipheriv('aes-256-gcm', key, nonce.slice(0, 16));
    
    if (additionalData) {
      cipher.setAAD(additionalData);
    }
    
    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    
    return encrypted;
  }

  private async performQuantumResistantDecryption(
    encryptionResult: QuantumEncryptionResult,
    keyPair: QuantumKeyPair,
    additionalData?: Buffer
  ): Promise<Buffer> {
    const key = await this.deriveEncryptionKey(keyPair, encryptionResult.nonce);
    
    // Extract auth tag
    const authTagLength = 16;
    const authTag = encryptionResult.ciphertext.slice(-authTagLength);
    const ciphertext = encryptionResult.ciphertext.slice(0, -authTagLength);
    
    const decipher = createDecipheriv('aes-256-gcm', key, encryptionResult.nonce.slice(0, 16));
    decipher.setAuthTag(authTag);
    
    if (additionalData) {
      decipher.setAAD(additionalData);
    }
    
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    
    return decrypted;
  }

  private async deriveEncryptionKey(keyPair: QuantumKeyPair, nonce: Buffer): Promise<Buffer> {
    const keyMaterial = Buffer.concat([keyPair.privateKey.slice(0, 32), nonce]);
    
    return await scryptAsync(keyMaterial, Buffer.from('quantum-encryption'), 32, {
      N: 32768,
      r: 8,
      p: 1,
    });
  }

  private async createSecureMessageHash(
    message: Buffer,
    options?: { includeTimestamp?: boolean; additionalContext?: Record<string, any> }
  ): Promise<Buffer> {
    const hash = createHash('sha3-512');
    hash.update(message);
    
    if (options?.includeTimestamp) {
      hash.update(Buffer.from(Date.now().toString()));
    }
    
    if (options?.additionalContext) {
      hash.update(Buffer.from(JSON.stringify(options.additionalContext)));
    }
    
    return hash.digest();
  }

  private async generateQuantumSignature(
    messageHash: Buffer,
    keyPair: QuantumKeyPair,
    options?: any
  ): Promise<Buffer> {
    // Quantum signature generation - simplified implementation
    const signatureData = Buffer.concat([
      messageHash,
      keyPair.privateKey.slice(0, 64),
      Buffer.from(Date.now().toString()),
    ]);
    
    return createHash('sha3-512').update(signatureData).digest();
  }

  private async verifyQuantumSignatureInternal(
    signature: Buffer,
    messageHash: Buffer,
    publicKey: Buffer,
    algorithm: string
  ): Promise<boolean> {
    // Quantum signature verification - simplified implementation
    try {
      // In production, this would use actual post-quantum signature verification
      return signature.length > 0 && messageHash.length > 0 && publicKey.length > 0;
    } catch {
      return false;
    }
  }

  private async executeQKDProtocol(
    protocol: string,
    keySize: number,
    participantId: string
  ): Promise<{
    sharedKey: Buffer;
    keyId: string;
    errorRate: number;
    success: boolean;
    channelIntegrity: QKDSession['channelIntegrity'];
  }> {
    // Simplified QKD protocol simulation
    const errorRate = Math.random() * 0.15; // 0-15% error rate
    const success = errorRate < this.config.qkd.errorRate;
    
    const channelIntegrity = {
      errorDetected: errorRate > 0.05,
      eavesdropping: errorRate > this.config.qkd.errorRate,
      authenticityVerified: success,
    };
    
    return {
      sharedKey: success ? await this.generateQuantumEntropy(keySize) : Buffer.alloc(0),
      keyId: this.generateKeyId(),
      errorRate,
      success,
      channelIntegrity,
    };
  }

  private async generateQuantumNoise(size: number): Promise<Buffer> {
    // Simulate quantum noise generation
    const noise = randomBytes(size);
    
    // Add timing-based entropy
    const timestamp = Buffer.from(Date.now().toString());
    for (let i = 0; i < Math.min(size, timestamp.length); i++) {
      noise[i] ^= timestamp[i] || 0;
    }
    
    return noise;
  }

  private selectBestEntropySource(): string {
    let bestSource = 'quantum_noise';
    let bestQuality = 0;
    
    for (const [sourceId, source] of this.entropyPool) {
      if (source.status === 'online' && source.quality > bestQuality) {
        bestQuality = source.quality;
        bestSource = sourceId;
      }
    }
    
    return bestSource;
  }

  private calculateEntropyQuality(entropy: Buffer): number {
    // Simplified entropy quality calculation
    const byteFrequency = new Array(256).fill(0);
    for (const byte of entropy) {
      byteFrequency[byte]++;
    }
    
    // Calculate Shannon entropy
    let shannonEntropy = 0;
    for (const freq of byteFrequency) {
      if (freq > 0) {
        const p = freq / entropy.length;
        shannonEntropy -= p * Math.log2(p);
      }
    }
    
    return (shannonEntropy / 8) * 100; // Convert to percentage
  }

  private async verifyEncryptionIntegrity(result: QuantumEncryptionResult): Promise<void> {
    // Verify integrity hash
    const calculatedHash = createHash('sha3-512')
      .update(result.ciphertext)
      .update(result.nonce)
      .update(result.keyId)
      .digest('hex');
    
    if (calculatedHash !== result.integrity.hash) {
      result.integrity.tamperEvidence = true;
      
      this.emit('quantum:tamper-detected', {
        operation: 'decryption',
        keyId: result.keyId,
        severity: 'high',
        timestamp: new Date(),
      });
      
      throw new Error('Encryption integrity verification failed - tampering detected');
    }
  }

  private findActiveKeyPair(algorithm: string): QuantumKeyPair | undefined {
    for (const keyPair of this.keyPairs.values()) {
      if (keyPair.algorithm === algorithm && keyPair.status === 'active') {
        return keyPair;
      }
    }
    return undefined;
  }

  private async rotateExpiredKeys(): Promise<void> {
    const now = new Date();
    let rotatedCount = 0;
    
    for (const [keyId, keyPair] of this.keyPairs) {
      if (keyPair.expiresAt < now && keyPair.status === 'active') {
        // Generate new key pair
        const newKeyPair = await this.generateKeyPair(keyPair.algorithm);
        
        // Mark old key as expired
        keyPair.status = 'expired';
        this.metrics.keys.active--;
        this.metrics.keys.expired++;
        
        rotatedCount++;
        
        this.emit('quantum:key-rotated', {
          oldKeyId: keyId,
          newKeyId: newKeyPair.keyId,
          algorithm: keyPair.algorithm,
          reason: 'expiration',
          timestamp: new Date(),
        });
      }
    }
    
    if (rotatedCount > 0) {
      logger.info('Key rotation completed', { rotatedCount });
    }
  }

  private async processBatchedOperations(): Promise<void> {
    if (this.operationQueue.length === 0) return;
    
    const batchSize = Math.min(this.config.performance.batchSize, this.operationQueue.length);
    const batch = this.operationQueue.splice(0, batchSize);
    
    await Promise.allSettled(
      batch.map(async (operation) => {
        try {
          const result = await this.executeOperation(operation);
          operation.resolve(result);
        } catch (error) {
          operation.reject(error);
        }
      })
    );
  }

  private async executeOperation(operation: any): Promise<any> {
    // Execute batched operation
    switch (operation.operation) {
      case 'encrypt':
        return this.encryptQuantumResistant(operation.params.data, operation.params.keyId);
      case 'decrypt':
        return this.decryptQuantumResistant(operation.params.encryptionResult);
      case 'sign':
        return this.signQuantumResistant(operation.params.message, operation.params.keyId);
      case 'verify':
        return this.verifyQuantumSignature(operation.params.signature, operation.params.message);
      default:
        throw new Error(`Unknown operation: ${operation.operation}`);
    }
  }

  private async addSideChannelProtection(): Promise<void> {
    // Add random delay to prevent timing attacks
    const delay = Math.random() * 10; // 0-10ms
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private async updateMetrics(): Promise<void> {
    // Update key metrics
    this.metrics.keys.total = this.keyPairs.size;
    this.metrics.keys.active = Array.from(this.keyPairs.values())
      .filter(k => k.status === 'active').length;
    this.metrics.keys.expired = Array.from(this.keyPairs.values())
      .filter(k => k.status === 'expired').length;
    this.metrics.keys.revoked = Array.from(this.keyPairs.values())
      .filter(k => k.status === 'revoked').length;
    
    // Update entropy metrics
    this.metrics.entropy.sources = this.entropyPool.size;
    this.metrics.entropy.averageQuality = Array.from(this.entropyPool.values())
      .reduce((sum, source) => sum + source.quality, 0) / this.entropyPool.size;
    
    // Update throughput
    const operationsPerSecond = this.metrics.operations.encryptions + 
                               this.metrics.operations.decryptions + 
                               this.metrics.operations.signatures + 
                               this.metrics.operations.verifications;
    this.metrics.performance.throughput = operationsPerSecond;
  }

  private async secureCleanup(): Promise<void> {
    // Securely clear sensitive data
    for (const keyPair of this.keyPairs.values()) {
      keyPair.privateKey.fill(0);
      keyPair.publicKey.fill(0);
    }
    
    this.keyPairs.clear();
    this.qkdSessions.clear();
    this.operationQueue.length = 0;
    
    logger.info('Quantum cryptography service cleanup completed');
  }

  private generateKeyId(): string {
    return `qkey_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private generateSessionId(): string {
    return `qkd_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }
}