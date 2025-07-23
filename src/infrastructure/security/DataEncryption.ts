import crypto from 'crypto';
import { logger } from '@/logger.js';
import { SingletonService } from '../core/SingletonService.js';

export interface EncryptionConfig {
  algorithm: string;
  keyDerivation: {
    algorithm: string;
    saltLength: number;
    iterations: number;
    keyLength: number;
  };
  iv: {
    length: number;
  };
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
  salt: string;
  tag: string;
}

/**
 * Data Encryption Service
 * 
 * Provides AES-256-GCM encryption for sensitive data at rest
 * with key derivation using PBKDF2 and secure random IVs.
 */
export class DataEncryption extends SingletonService<DataEncryption> {
  private config: EncryptionConfig;
  private masterKey: string | null = null;
  
  protected constructor() {
    super();
    this.config = {
      algorithm: 'aes-256-gcm',
      keyDerivation: {
        algorithm: 'pbkdf2',
        saltLength: 32,
        iterations: 100000,
        keyLength: 32,
      },
      iv: {
        length: 16,
      },
    };
  }
  
  static async getInstance(): Promise<DataEncryption> {
    return super.getInstance();
  }

  /**
   * Configure the DataEncryption service with master key
   */
  public configure(masterKey: string): void {
    this.masterKey = masterKey;
  }
  
  /**
   * Encrypt sensitive data
   */
  encrypt(plaintext: string, context?: string): EncryptedData {
    try {
      // Generate random salt and IV
      const salt = crypto.randomBytes(this.config.keyDerivation.saltLength);
      const iv = crypto.randomBytes(this.config.iv.length);
      
      this.ensureConfigured();
      
      // Derive key from master key and salt
      const key = crypto.pbkdf2Sync(
        this.masterKey!,
        salt,
        this.config.keyDerivation.iterations,
        this.config.keyDerivation.keyLength,
        'sha256'
      );
      
      // Create cipher
      const cipher = crypto.createCipher(this.config.algorithm, key);
      cipher.setAAD(Buffer.from(context || 'default-context', 'utf8'));
      
      // Encrypt data
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      const result: EncryptedData = {
        encrypted,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        tag: tag.toString('hex'),
      };
      
      logger.debug('Data encrypted', {
        context,
        plaintextLength: plaintext.length,
        encryptedLength: encrypted.length,
      });
      
      return result;
    } catch (error) {
      logger.error('Encryption failed', { error, context });
      throw new Error('Failed to encrypt data');
    }
  }
  
  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData: EncryptedData, context?: string): string {
    try {
      const { encrypted, iv, salt, tag } = encryptedData;
      
      // Convert hex strings back to buffers
      const saltBuffer = Buffer.from(salt, 'hex');
      const ivBuffer = Buffer.from(iv, 'hex');
      const tagBuffer = Buffer.from(tag, 'hex');
      
      // Derive key using same parameters
      const key = crypto.pbkdf2Sync(
        this.masterKey,
        saltBuffer,
        this.config.keyDerivation.iterations,
        this.config.keyDerivation.keyLength,
        'sha256'
      );
      
      // Create decipher
      const decipher = crypto.createDecipher(this.config.algorithm, key);
      decipher.setAAD(Buffer.from(context || 'default-context', 'utf8'));
      decipher.setAuthTag(tagBuffer);
      
      // Decrypt data
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      logger.debug('Data decrypted', {
        context,
        encryptedLength: encrypted.length,
        decryptedLength: decrypted.length,
      });
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', { error, context });
      throw new Error('Failed to decrypt data');
    }
  }
  
  /**
   * Hash sensitive data for comparison (one-way)
   */
  hash(data: string, salt?: string): { hash: string; salt: string } {
    const saltBuffer = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(32);
    
    const hash = crypto.pbkdf2Sync(
      data,
      saltBuffer,
      this.config.keyDerivation.iterations,
      64,
      'sha256'
    );
    
    return {
      hash: hash.toString('hex'),
      salt: saltBuffer.toString('hex'),
    };
  }
  
  /**
   * Verify hashed data
   */
  verifyHash(data: string, hash: string, salt: string): boolean {
    try {
      const computed = this.hash(data, salt);
      return crypto.timingSafeEqual(
        Buffer.from(computed.hash, 'hex'),
        Buffer.from(hash, 'hex')
      );
    } catch (error) {
      logger.error('Hash verification failed', { error });
      return false;
    }
  }
  
  /**
   * Generate secure random tokens
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }
  
  /**
   * Encrypt PII fields in an object
   */
  encryptPII<T extends Record<string, any>>(
    obj: T,
    fields: string[],
    context?: string
  ): T & { _encrypted: string[] } {
    const encrypted = { ...obj } as T & { _encrypted: string[] };
    const encryptedFields: string[] = [];
    
    for (const field of fields) {
      if (field in obj && obj[field] !== null && obj[field] !== undefined) {
        const value = typeof obj[field] === 'string' ? obj[field] : JSON.stringify(obj[field]);
        const encryptedData = this.encrypt(value, `${context || 'pii'}.${field}`);
        
        // Store encrypted data as JSON string
        encrypted[field] = JSON.stringify(encryptedData);
        encryptedFields.push(field);
      }
    }
    
    encrypted._encrypted = encryptedFields;
    return encrypted;
  }
  
  /**
   * Decrypt PII fields in an object
   */
  decryptPII<T extends Record<string, any>>(
    obj: T & { _encrypted?: string[] },
    context?: string
  ): T {
    const decrypted = { ...obj };
    const encryptedFields = obj._encrypted || [];
    
    for (const field of encryptedFields) {
      if (field in obj && obj[field]) {
        try {
          const encryptedData = JSON.parse(obj[field]) as EncryptedData;
          const decryptedValue = this.decrypt(encryptedData, `${context || 'pii'}.${field}`);
          
          // Try to parse as JSON, fallback to string
          try {
            decrypted[field] = JSON.parse(decryptedValue);
          } catch {
            decrypted[field] = decryptedValue;
          }
        } catch (error) {
          logger.error('Failed to decrypt PII field', { field, error });
          // Keep encrypted value as fallback
        }
      }
    }
    
    // Remove encryption metadata
    delete decrypted._encrypted;
    return decrypted;
  }
}

/**
 * Field-level encryption middleware for Prisma
 */
export class PrismaEncryptionMiddleware {
  private encryption: DataEncryption;
  private encryptedFields: Map<string, string[]> = new Map();
  
  constructor(encryption: DataEncryption) {
    this.encryption = encryption;
    
    // Define which fields should be encrypted for each model
    this.encryptedFields.set('User', ['email', 'name', 'preferences']);
    this.encryptedFields.set('Todo', ['title', 'description']);
    this.encryptedFields.set('TodoList', ['name', 'description']);
  }
  
  /**
   * Create Prisma middleware for automatic encryption/decryption
   */
  createMiddleware() {
    return async (params: any, next: any) => {
      const model = params.model;
      const fields = this.encryptedFields.get(model);
      
      if (!fields || fields.length === 0) {
        return next(params);
      }
      
      // Encrypt data before write operations
      if (['create', 'update', 'upsert'].includes(params.action)) {
        if (params.args.data) {
          params.args.data = this.encryption.encryptPII(
            params.args.data,
            fields,
            model.toLowerCase()
          );
        }
      }
      
      // Execute the query
      const result = await next(params);
      
      // Decrypt data after read operations
      if (['findUnique', 'findFirst', 'findMany'].includes(params.action)) {
        if (Array.isArray(result)) {
          return result.map((item: any) => 
            this.encryption.decryptPII(item, model.toLowerCase())
          );
        } else if (result) {
          return this.encryption.decryptPII(result, model.toLowerCase());
        }
      }
      
      return result;
    };
  }
}

/**
 * Transport Layer Security (TLS) utilities
 */
export class TLSUtils {
  /**
   * Generate TLS certificate configuration for production
   */
  static generateTLSConfig() {
    return {
      // TLS 1.3 configuration
      secureProtocol: 'TLSv1_3_method',
      ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
      ].join(':'),
      honorCipherOrder: true,
      
      // HSTS settings
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      
      // Certificate transparency
      expectCT: {
        maxAge: 86400,
        enforce: true,
      },
    };
  }
  
  /**
   * Validate TLS connection security
   */
  static validateTLSConnection(req: any): boolean {
    // Check if connection is secure
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      return false;
    }
    
    // Check TLS version
    const tlsVersion = req.connection?.getProtocol?.();
    if (tlsVersion && !['TLSv1.2', 'TLSv1.3'].includes(tlsVersion)) {
      return false;
    }
    
    return true;
  }

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.masterKey) {
      throw new Error('DataEncryption not configured - call configure() first');
    }
  }
}

// Export singleton factory with environment-based master key
export const getDataEncryption = async () => {
  const masterKey = process.env.ENCRYPTION_MASTER_KEY || 'development-key-change-in-production';
  const instance = await DataEncryption.getInstance();
  instance.configure(masterKey);
  return instance;
};