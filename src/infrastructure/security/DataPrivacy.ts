import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes, 
  scrypt, 
  createHash,
  publicEncrypt,
  privateDecrypt,
  generateKeyPairSync,
} from 'crypto';
import { promisify } from 'util';
import { logger } from '@/logger.js';
import { SingletonService } from '../core/SingletonService.js';

const scryptAsync = promisify(scrypt);

export interface EncryptionConfig {
  algorithm: string;
  keyDerivation: {
    saltLength: number;
    keyLength: number;
    iterations: number;
  };
  dataClassification: {
    public: string[];
    internal: string[];
    confidential: string[];
    restricted: string[];
  };
}

export interface EncryptedData {
  data: string;
  iv: string;
  salt: string;
  algorithm: string;
  timestamp: Date;
  keyId?: string;
}

export interface DataClassification {
  field: string;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  encryptionRequired: boolean;
  retentionDays: number;
  piiType?: 'name' | 'email' | 'phone' | 'ssn' | 'financial' | 'health' | 'other';
}

export interface PrivacyPolicy {
  dataSubject: string;
  purpose: string;
  legalBasis: string;
  retentionPeriod: number;
  dataCategories: string[];
  recipients: string[];
  internationalTransfers: boolean;
}

export interface DataSubjectRequest {
  id: string;
  type: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction';
  subjectId: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requestDate: Date;
  completionDate?: Date;
  data?: any;
}

/**
 * Data Privacy and Encryption System
 * Implements encryption, anonymization, and privacy controls
 */
export class DataPrivacySystem extends SingletonService<DataPrivacySystem> {
  private config: EncryptionConfig | null = null;
  private encryptionKeys: Map<string, Buffer> = new Map();
  private dataClassifications: Map<string, DataClassification> = new Map();
  private privacyPolicies: Map<string, PrivacyPolicy> = new Map();
  private keyPair: { publicKey: string; privateKey: string } | null = null;

  protected constructor() {
    super();
  }

  public configure(config: Partial<EncryptionConfig> = {}): void {
    this.config = {
      algorithm: 'aes-256-gcm',
      keyDerivation: {
        saltLength: 32,
        keyLength: 32,
        iterations: 100000,
      },
      dataClassification: {
        public: [],
        internal: ['userId', 'timestamp'],
        confidential: ['email', 'name', 'phone'],
        restricted: ['ssn', 'creditCard', 'healthData'],
      },
      ...config,
    };

    // Generate RSA key pair for asymmetric encryption
    this.keyPair = generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    this.initializeDataClassifications();
  }

  private ensureConfig(): EncryptionConfig {
    if (!this.config) {
      throw new Error('DataPrivacySystem not configured');
    }
    return this.config;
  }

  private ensureKeyPair(): { publicKey: string; privateKey: string } {
    if (!this.keyPair) {
      throw new Error('DataPrivacySystem keyPair not initialized');
    }
    return this.keyPair;
  }

  static initialize(config?: Partial<EncryptionConfig>): DataPrivacySystem {
    const instance = super.getInstance();
    if (!instance.config) {
      instance.configure(config);
    }
    return instance;
  }

  static getInstance(): DataPrivacySystem {
    const instance = super.getInstance();
    if (!instance.config) {
      instance.configure();
    }
    return instance;
  }

  /**
   * Encrypt sensitive data
   */
  async encrypt(data: string, classification: DataClassification['classification'] = 'confidential'): Promise<EncryptedData> {
    if (classification === 'public') {
      throw new Error('Public data should not be encrypted');
    }

    const salt = randomBytes(this.ensureConfig().keyDerivation.saltLength);
    const key = await this.deriveKey('master-key', salt);
    const iv = randomBytes(16);

    const cipher = createCipheriv(this.ensureConfig().algorithm, key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = (cipher as any).getAuthTag();
    
    return {
      data: encrypted + '.' + authTag.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      algorithm: this.ensureConfig().algorithm,
      timestamp: new Date(),
      keyId: 'master-key',
    };
  }

  /**
   * Decrypt data
   */
  async decrypt(encryptedData: EncryptedData): Promise<string> {
    const salt = Buffer.from(encryptedData.salt, 'base64');
    const key = await this.deriveKey(encryptedData.keyId || 'master-key', salt);
    const iv = Buffer.from(encryptedData.iv, 'base64');

    const [encrypted, authTag] = encryptedData.data.split('.');
    
    const decipher = createDecipheriv(encryptedData.algorithm, key, iv);
    (decipher as any).setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt with public key (asymmetric)
   */
  encryptAsymmetric(data: string): string {
    const encrypted = publicEncrypt(this.ensureKeyPair().publicKey, Buffer.from(data));
    return encrypted.toString('base64');
  }

  /**
   * Decrypt with private key (asymmetric)
   */
  decryptAsymmetric(encryptedData: string): string {
    const decrypted = privateDecrypt(
      this.ensureKeyPair().privateKey,
      Buffer.from(encryptedData, 'base64')
    );
    return decrypted.toString('utf8');
  }

  /**
   * Anonymize PII data
   */
  anonymize(data: any, fields?: string[]): any {
    const toAnonymize = fields || this.getFieldsToAnonymize(data);
    const anonymized = { ...data };

    for (const field of toAnonymize) {
      if (field in anonymized) {
        const classification = this.dataClassifications.get(field);
        
        if (classification?.piiType) {
          anonymized[field] = this.anonymizeByType(
            anonymized[field],
            classification.piiType
          );
        } else {
          anonymized[field] = this.hashValue(anonymized[field]);
        }
      }
    }

    return anonymized;
  }

  /**
   * Pseudonymize data (reversible anonymization)
   */
  async pseudonymize(data: any, fields?: string[]): Promise<{ data: any; tokens: Map<string, string> }> {
    const toPseudonymize = fields || this.getFieldsToAnonymize(data);
    const pseudonymized = { ...data };
    const tokens = new Map<string, string>();

    for (const field of toPseudonymize) {
      if (field in pseudonymized) {
        const token = this.generateToken();
        tokens.set(field, token);
        
        // Store original value encrypted
        const encrypted = await this.encrypt(
          JSON.stringify({ field, value: pseudonymized[field] }),
          'restricted'
        );
        
        // Store mapping securely
        await this.storePseudonymMapping(token, encrypted);
        
        pseudonymized[field] = token;
      }
    }

    return { data: pseudonymized, tokens };
  }

  /**
   * Handle data subject request (GDPR Article 15-22)
   */
  async handleDataSubjectRequest(request: DataSubjectRequest): Promise<DataSubjectRequest> {
    logger.info('Processing data subject request', {
      type: request.type,
      subjectId: request.subjectId,
    });

    request.status = 'processing';

    try {
      switch (request.type) {
        case 'access':
          request.data = await this.handleAccessRequest(request.subjectId);
          break;
          
        case 'erasure':
          await this.handleErasureRequest(request.subjectId);
          request.data = { message: 'Data erased successfully' };
          break;
          
        case 'portability':
          request.data = await this.handlePortabilityRequest(request.subjectId);
          break;
          
        case 'rectification':
          request.data = await this.handleRectificationRequest(request.subjectId, request.data);
          break;
          
        case 'restriction':
          await this.handleRestrictionRequest(request.subjectId);
          request.data = { message: 'Processing restricted' };
          break;
      }

      request.status = 'completed';
      request.completionDate = new Date();
    } catch (error) {
      logger.error('Data subject request failed', error);
      request.status = 'rejected';
      request.data = { error: 'Request processing failed' };
    }

    return request;
  }

  /**
   * Apply data retention policies
   */
  async applyRetentionPolicies(): Promise<{ deleted: number; retained: number }> {
    let deleted = 0;
    let retained = 0;

    // This would be implemented to scan data stores and apply retention
    // For demonstration, we'll simulate the process
    
    for (const [field, classification] of this.dataClassifications) {
      if (classification.retentionDays > 0) {
        // Check data age and delete if expired
        // In real implementation, would query database
        const expired = await this.findExpiredData(field, classification.retentionDays);
        
        if (expired.length > 0) {
          await this.deleteData(expired);
          deleted += expired.length;
          
          logger.info(`Deleted ${expired.length} expired ${field} records`);
        }
      }
    }

    return { deleted, retained };
  }

  /**
   * Encrypt database field
   */
  async encryptField(value: any, fieldName: string): Promise<string | null> {
    if (value === null || value === undefined) return null;

    const classification = this.dataClassifications.get(fieldName);
    if (!classification || !classification.encryptionRequired) {
      return value;
    }

    const encrypted = await this.encrypt(
      JSON.stringify(value),
      classification.classification
    );

    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt database field
   */
  async decryptField(encryptedValue: string | null, fieldName: string): Promise<any> {
    if (!encryptedValue) return null;

    try {
      const encryptedData = JSON.parse(encryptedValue) as EncryptedData;
      const decrypted = await this.decrypt(encryptedData);
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('Failed to decrypt field', { fieldName, error });
      throw new Error('Decryption failed');
    }
  }

  /**
   * Generate secure token
   */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Initialize data classifications
   */
  private initializeDataClassifications(): void {
    // User data classifications
    this.dataClassifications.set('email', {
      field: 'email',
      classification: 'confidential',
      encryptionRequired: true,
      retentionDays: 365 * 3, // 3 years
      piiType: 'email',
    });

    this.dataClassifications.set('name', {
      field: 'name',
      classification: 'confidential',
      encryptionRequired: true,
      retentionDays: 365 * 3,
      piiType: 'name',
    });

    this.dataClassifications.set('phone', {
      field: 'phone',
      classification: 'confidential',
      encryptionRequired: true,
      retentionDays: 365 * 3,
      piiType: 'phone',
    });

    this.dataClassifications.set('creditCard', {
      field: 'creditCard',
      classification: 'restricted',
      encryptionRequired: true,
      retentionDays: 90, // PCI compliance
      piiType: 'financial',
    });

    this.dataClassifications.set('ssn', {
      field: 'ssn',
      classification: 'restricted',
      encryptionRequired: true,
      retentionDays: 365 * 7, // Legal requirement
      piiType: 'ssn',
    });

    // Todo data classifications
    this.dataClassifications.set('todoContent', {
      field: 'todoContent',
      classification: 'internal',
      encryptionRequired: false,
      retentionDays: 365, // 1 year
    });
  }

  /**
   * Derive encryption key
   */
  private async deriveKey(keyId: string, salt: Buffer): Promise<Buffer> {
    const cached = this.encryptionKeys.get(keyId + salt.toString('base64'));
    if (cached) return cached;

    const masterKey = this.getMasterKey(keyId);
    const key = (await scryptAsync(
      masterKey,
      salt,
      this.ensureConfig().keyDerivation.keyLength
    )) as Buffer;

    this.encryptionKeys.set(keyId + salt.toString('base64'), key);
    return key;
  }

  /**
   * Get master key (in production, would use KMS)
   */
  private getMasterKey(keyId: string): string {
    // In production, retrieve from secure key management service
    return process.env.MASTER_ENCRYPTION_KEY || 'default-insecure-key';
  }

  /**
   * Get fields that need anonymization
   */
  private getFieldsToAnonymize(data: any): string[] {
    const fields: string[] = [];
    
    for (const [field, classification] of this.dataClassifications) {
      if (classification.classification !== 'public' && field in data) {
        fields.push(field);
      }
    }

    return fields;
  }

  /**
   * Anonymize by PII type
   */
  private anonymizeByType(value: string, piiType: string): string {
    switch (piiType) {
      case 'email':
        const [local, domain] = value.split('@');
        return `${local.substring(0, 2)}****@${domain}`;
        
      case 'phone':
        return value.substring(0, 3) + '****' + value.substring(value.length - 2);
        
      case 'name':
        return value.split(' ').map(part => 
          part.charAt(0) + '*'.repeat(part.length - 1)
        ).join(' ');
        
      case 'ssn':
        return '***-**-' + value.substring(value.length - 4);
        
      case 'financial':
        return '**** **** **** ' + value.substring(value.length - 4);
        
      default:
        return this.hashValue(value);
    }
  }

  /**
   * Hash value for anonymization
   */
  private hashValue(value: string): string {
    return createHash('sha256')
      .update(value + 'anonymization-salt')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Store pseudonym mapping
   */
  private async storePseudonymMapping(token: string, encrypted: EncryptedData): Promise<void> {
    // In production, store in secure database
    // For now, store in memory
    this.encryptionKeys.set(`pseudonym_${token}`, Buffer.from(JSON.stringify(encrypted)));
  }

  /**
   * Handle access request
   */
  private async handleAccessRequest(subjectId: string): Promise<any> {
    // In real implementation, gather all data about the subject
    return {
      userData: {
        id: subjectId,
        // Would include all personal data
      },
      processingActivities: await this.getProcessingActivities(subjectId),
      dataRecipients: await this.getDataRecipients(subjectId),
    };
  }

  /**
   * Handle erasure request
   */
  private async handleErasureRequest(subjectId: string): Promise<void> {
    // In real implementation, delete or anonymize all personal data
    logger.info(`Processing erasure request for subject ${subjectId}`);
    
    // Check if erasure is allowed (no legal obligations to retain)
    const canErase = await this.checkErasureEligibility(subjectId);
    
    if (!canErase) {
      throw new Error('Cannot erase data due to legal obligations');
    }

    // Perform erasure
    await this.eraseSubjectData(subjectId);
  }

  /**
   * Handle portability request
   */
  private async handlePortabilityRequest(subjectId: string): Promise<any> {
    // Export data in machine-readable format
    const data = await this.gatherSubjectData(subjectId);
    
    return {
      format: 'json',
      data,
      exportDate: new Date(),
    };
  }

  /**
   * Handle rectification request
   */
  private async handleRectificationRequest(subjectId: string, corrections: any): Promise<any> {
    // Apply corrections to personal data
    logger.info(`Processing rectification request for subject ${subjectId}`);
    
    // Validate and apply corrections
    const applied = await this.applyCorrections(subjectId, corrections);
    
    return {
      corrected: applied,
      timestamp: new Date(),
    };
  }

  /**
   * Handle restriction request
   */
  private async handleRestrictionRequest(subjectId: string): Promise<void> {
    // Mark data as restricted from processing
    logger.info(`Restricting processing for subject ${subjectId}`);
    
    // In real implementation, set flags in database
    await this.restrictProcessing(subjectId);
  }

  // Placeholder methods for data operations
  private async findExpiredData(field: string, retentionDays: number): Promise<any[]> {
    return [];
  }

  private async deleteData(data: any[]): Promise<void> {
    // Delete data
  }

  private async getProcessingActivities(subjectId: string): Promise<any[]> {
    return [];
  }

  private async getDataRecipients(subjectId: string): Promise<any[]> {
    return [];
  }

  private async checkErasureEligibility(subjectId: string): Promise<boolean> {
    return true;
  }

  private async eraseSubjectData(subjectId: string): Promise<void> {
    // Erase data
  }

  private async gatherSubjectData(subjectId: string): Promise<any> {
    return {};
  }

  private async applyCorrections(subjectId: string, corrections: any): Promise<any[]> {
    return [];
  }

  private async restrictProcessing(subjectId: string): Promise<void> {
    // Restrict processing
  }
}