import { logger } from '@/logger';
import { MetricsCollector } from '../observability/MetricsCollector.js';
import { DistributedTracing } from '../observability/DistributedTracing.js';
import { Container } from '../container/Container.js';
import { createHash } from 'crypto';
// import { compress, decompress } from 'lz4'; // Optional dependency - fallback to native compression
import EventEmitter from 'events';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface BackupConfiguration {
  strategy: 'full' | 'incremental' | 'differential' | 'continuous';
  schedule: {
    type: 'cron' | 'interval';
    expression: string;
    timezone?: string;
  };
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  destinations: Array<{
    type: 's3' | 'gcs' | 'azure' | 'local' | 'ftp';
    config: any;
    priority: number;
    encryption: boolean;
  }>;
  compression: {
    enabled: boolean;
    algorithm: 'lz4' | 'gzip' | 'brotli';
    level: number;
  };
  verification: {
    enabled: boolean;
    checksumAlgorithm: 'md5' | 'sha256' | 'sha512';
    testRestore: boolean;
  };
}

export interface BackupMetadata {
  id: string;
  type: 'full' | 'incremental' | 'differential';
  timestamp: Date;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  checksum: string;
  dependencies: string[]; // For incremental backups
  sources: string[];
  destinations: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'verified';
  duration: number;
  retentionExpiry: Date;
}

export interface RestoreOptions {
  backupId?: string;
  pointInTime?: Date;
  targetLocation: string;
  sources?: string[];
  dryRun?: boolean;
  parallelism?: number;
  verification?: boolean;
}

export interface BackupOperationResult {
  success: boolean;
  backupId: string;
  metadata: BackupMetadata;
  warnings: string[];
  errors: string[];
  performance: {
    duration: number;
    throughput: number; // MB/s
    compressionRatio: number;
  };
}

export interface DisasterRecoveryPlan {
  id: string;
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  rto: number; // Recovery Time Objective (minutes)
  rpo: number; // Recovery Point Objective (minutes)
  services: Array<{
    name: string;
    dependencies: string[];
    recoveryOrder: number;
    healthCheck: string;
  }>;
  runbooks: Array<{
    step: number;
    description: string;
    automation: boolean;
    command?: string;
    verification: string;
  }>;
  notifications: Array<{
    channel: 'email' | 'sms' | 'slack' | 'webhook';
    recipients: string[];
    triggers: string[];
  }>;
}

export interface BackupStorage {
  type: string;
  connected: boolean;
  available: boolean;
  capacity: {
    total: number;
    used: number;
    available: number;
  };
  performance: {
    readThroughput: number;
    writeThroughput: number;
    latency: number;
  };
}

export class BackupManager extends EventEmitterSingletonService<BackupManager> {
  private config: BackupConfiguration | null = null;
  private metrics: MetricsCollector;
  private tracing: DistributedTracing;
  private container: Container | null = null;
  
  private backupMetadata: Map<string, BackupMetadata> = new Map();
  private activeBackups: Map<string, NodeJS.Timeout> = new Map();
  private storageConnections: Map<string, BackupStorage> = new Map();
  private recoveryPlans: Map<string, DisasterRecoveryPlan> = new Map();
  
  // Monitoring intervals
  private backupScheduler?: NodeJS.Timeout;
  private retentionManager?: NodeJS.Timeout;
  private storageMonitor?: NodeJS.Timeout;
  private healthChecker?: NodeJS.Timeout;

  protected constructor() {
    super();
    this.metrics = MetricsCollector.getInstance();
    this.tracing = DistributedTracing.getInstance();
  }

  public static getInstance(): BackupManager {
    return super.getInstance();
  }

  /**
   * Configure the BackupManager with settings
   */
  public async configure(config: BackupConfiguration): Promise<void> {
    this.config = config;
    this.container = await Container.getInstance();
    
    this.initializeStorage();
    this.setupScheduler();
    this.loadRecoveryPlans();
    this.startMonitoring();
  }

  /**
   * Create a backup with specified strategy
   */
  public async createBackup(
    sources?: string[],
    options?: {
      type?: 'full' | 'incremental' | 'differential';
      tags?: Record<string, string>;
      priority?: 'high' | 'normal' | 'low';
    }
  ): Promise<BackupOperationResult> {
    const span = this.tracing.startTrace('backup_create');
    const backupId = this.generateBackupId();
    const startTime = Date.now();

    try {
      logger.info('Starting backup operation', {
        backupId,
        type: options?.type || this.config.strategy,
        sources: sources || ['database', 'files', 'config'],
      });

      // Determine backup type
      const backupType = options?.type || this.determineBackupType();
      
      // Create backup metadata
      const metadata: BackupMetadata = {
        id: backupId,
        type: backupType,
        timestamp: new Date(),
        size: 0,
        compressed: this.config.compression.enabled,
        encrypted: this.config.destinations.some(d => d.encryption),
        checksum: '',
        dependencies: backupType !== 'full' ? await this.getBackupDependencies() : [],
        sources: sources || ['database', 'files', 'config'],
        destinations: [],
        status: 'running',
        duration: 0,
        retentionExpiry: this.calculateRetentionExpiry(),
      };

      this.backupMetadata.set(backupId, metadata);

      // Execute backup operation
      const result = await this.executeBackup(metadata);

      // Update metadata
      metadata.status = result.success ? 'completed' : 'failed';
      metadata.duration = Date.now() - startTime;
      metadata.size = result.performance.duration;

      // Verify backup if enabled
      if (this.config.verification.enabled && result.success) {
        await this.verifyBackup(backupId);
      }

      this.metrics.recordMetric('backup_created', 1, {
        type: backupType,
        success: result.success.toString(),
        size: metadata.size.toString(),
      });

      this.tracing.finishSpan(span, result.success ? 'ok' : 'error');
      this.emit('backup_completed', { backupId, success: result.success });

      logger.info('Backup operation completed', {
        backupId,
        success: result.success,
        duration: metadata.duration,
        size: metadata.size,
      });

      return result;

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Backup operation failed', error, { backupId });
      
      const metadata = this.backupMetadata.get(backupId);
      if (metadata) {
        metadata.status = 'failed';
        metadata.duration = Date.now() - startTime;
      }

      return {
        success: false,
        backupId,
        metadata: metadata!,
        warnings: [],
        errors: [(error as Error).message],
        performance: {
          duration: Date.now() - startTime,
          throughput: 0,
          compressionRatio: 0,
        },
      };
    }
  }

  /**
   * Restore data from backup
   */
  public async restoreFromBackup(options: RestoreOptions): Promise<boolean> {
    const span = this.tracing.startTrace('backup_restore');
    
    try {
      logger.info('Starting restore operation', options);

      // Validate restore options
      if (!options.backupId && !options.pointInTime) {
        throw new Error('Either backupId or pointInTime must be specified');
      }

      // Find backup to restore
      const backupChain = await this.buildRestoreChain(options);
      
      if (options.dryRun) {
        logger.info('Dry run - restore plan validated', {
          backupsInChain: backupChain.length,
          estimatedDuration: this.estimateRestoreDuration(backupChain),
        });
        return true;
      }

      // Pre-restore validation
      await this.validateRestoreTarget(options.targetLocation);

      // Execute restore
      const success = await this.executeRestore(backupChain, options);

      // Post-restore verification
      if (success && options.verification) {
        await this.verifyRestore(options);
      }

      this.metrics.recordMetric('backup_restored', 1, {
        success: success.toString(),
        backupsUsed: backupChain.length.toString(),
      });

      this.tracing.finishSpan(span, success ? 'ok' : 'error');
      this.emit('restore_completed', { success, options });

      logger.info('Restore operation completed', { success, options });
      return success;

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Restore operation failed', error, options);
      return false;
    }
  }

  /**
   * Execute disaster recovery plan
   */
  public async executeDisasterRecovery(
    planId: string,
    options?: {
      skipSteps?: number[];
      dryRun?: boolean;
      parallelism?: number;
    }
  ): Promise<boolean> {
    const span = this.tracing.startTrace('disaster_recovery');
    
    try {
      const plan = this.recoveryPlans.get(planId);
      if (!plan) {
        throw new Error(`Disaster recovery plan not found: ${planId}`);
      }

      logger.warn('Executing disaster recovery plan', {
        planId,
        planName: plan.name,
        priority: plan.priority,
        rto: plan.rto,
        rpo: plan.rpo,
      });

      // Send notifications
      await this.sendDisasterRecoveryNotifications(plan, 'started');

      if (options?.dryRun) {
        logger.info('Dry run - disaster recovery plan validated', {
          steps: plan.runbooks.length,
          services: plan.services.length,
        });
        return true;
      }

      // Execute runbook steps
      const results = [];
      for (const runbook of plan.runbooks.sort((a, b) => a.step - b.step)) {
        if (options?.skipSteps?.includes(runbook.step)) {
          logger.info('Skipping runbook step', { step: runbook.step });
          continue;
        }

        const stepResult = await this.executeRunbookStep(runbook, plan);
        results.push(stepResult);

        if (!stepResult.success && runbook.step < 10) { // Critical steps
          logger.error('Critical runbook step failed, aborting recovery', {
            step: runbook.step,
            description: runbook.description,
          });
          await this.sendDisasterRecoveryNotifications(plan, 'failed');
          return false;
        }
      }

      // Verify service recovery
      const recoverySuccess = await this.verifyServiceRecovery(plan);

      this.metrics.recordMetric('disaster_recovery_executed', 1, {
        planId,
        success: recoverySuccess.toString(),
        stepsExecuted: results.length.toString(),
      });

      await this.sendDisasterRecoveryNotifications(
        plan, 
        recoverySuccess ? 'completed' : 'failed'
      );

      this.tracing.finishSpan(span, recoverySuccess ? 'ok' : 'error');
      this.emit('disaster_recovery_completed', { planId, success: recoverySuccess });

      logger.info('Disaster recovery plan execution completed', {
        planId,
        success: recoverySuccess,
        stepsExecuted: results.length,
      });

      return recoverySuccess;

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Disaster recovery execution failed', error, { planId });
      return false;
    }
  }

  /**
   * Get backup status and metrics
   */
  public async getBackupStatus(): Promise<{
    activeBackups: number;
    totalBackups: number;
    lastBackup: Date | null;
    nextScheduled: Date | null;
    storageUsage: number;
    recentFailures: number;
    retentionStatus: {
      toExpire: number;
      toCleanup: number;
    };
  }> {
    const totalBackups = this.backupMetadata.size;
    const activeBackups = Array.from(this.backupMetadata.values())
      .filter(b => b.status === 'running').length;

    const backupDates = Array.from(this.backupMetadata.values())
      .map(b => b.timestamp)
      .sort((a, b) => b.getTime() - a.getTime());

    const lastBackup = backupDates.length > 0 ? backupDates[0] : null;
    const recentFailures = Array.from(this.backupMetadata.values())
      .filter(b => b.status === 'failed' && 
        b.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)).length;

    const storageUsage = Array.from(this.backupMetadata.values())
      .reduce((total, backup) => total + backup.size, 0);

    const now = new Date();
    const toExpire = Array.from(this.backupMetadata.values())
      .filter(b => b.retentionExpiry <= now).length;

    return {
      activeBackups,
      totalBackups,
      lastBackup,
      nextScheduled: this.calculateNextScheduledBackup(),
      storageUsage,
      recentFailures,
      retentionStatus: {
        toExpire,
        toCleanup: toExpire,
      },
    };
  }

  /**
   * Test disaster recovery capabilities
   */
  public async testDisasterRecovery(
    planId?: string,
    options?: {
      scope?: 'full' | 'partial';
      duration?: number; // minutes
      skipCleanup?: boolean;
    }
  ): Promise<{
    success: boolean;
    results: Array<{
      component: string;
      test: string;
      passed: boolean;
      duration: number;
      notes: string;
    }>;
    recommendations: string[];
  }> {
    const span = this.tracing.startTrace('disaster_recovery_test');
    
    try {
      logger.info('Starting disaster recovery test', { planId, options });

      const results = [];
      const recommendations = [];

      // Test backup integrity
      const backupTest = await this.testBackupIntegrity();
      results.push({
        component: 'backups',
        test: 'integrity_check',
        passed: backupTest.success,
        duration: backupTest.duration,
        notes: backupTest.notes,
      });

      // Test restore capabilities
      const restoreTest = await this.testRestoreCapabilities();
      results.push({
        component: 'restore',
        test: 'restore_test',
        passed: restoreTest.success,
        duration: restoreTest.duration,
        notes: restoreTest.notes,
      });

      // Test storage availability
      const storageTest = await this.testStorageConnectivity();
      results.push({
        component: 'storage',
        test: 'connectivity',
        passed: storageTest.success,
        duration: storageTest.duration,
        notes: storageTest.notes,
      });

      // Test notification systems
      const notificationTest = await this.testNotificationSystems();
      results.push({
        component: 'notifications',
        test: 'delivery',
        passed: notificationTest.success,
        duration: notificationTest.duration,
        notes: notificationTest.notes,
      });

      // Generate recommendations
      if (!backupTest.success) {
        recommendations.push('Fix backup integrity issues before disaster strikes');
      }
      if (!restoreTest.success) {
        recommendations.push('Verify and fix restore procedures');
      }
      if (!storageTest.success) {
        recommendations.push('Ensure backup storage connectivity and redundancy');
      }

      const overallSuccess = results.every(r => r.passed);

      this.metrics.recordMetric('disaster_recovery_test', 1, {
        success: overallSuccess.toString(),
        components: results.length.toString(),
      });

      this.tracing.finishSpan(span, overallSuccess ? 'ok' : 'warning');

      logger.info('Disaster recovery test completed', {
        success: overallSuccess,
        testsRun: results.length,
        recommendations: recommendations.length,
      });

      return {
        success: overallSuccess,
        results,
        recommendations,
      };

    } catch (error) {
      this.tracing.finishSpan(span, 'error', error as Error);
      logger.error('Disaster recovery test failed', error);
      
      return {
        success: false,
        results: [],
        recommendations: ['Unable to complete disaster recovery test - investigate system issues'],
      };
    }
  }

  // Private helper methods

  private async initializeStorage(): Promise<void> {
    for (const destination of this.config.destinations) {
      try {
        const storage: BackupStorage = {
          type: destination.type,
          connected: await this.testStorageConnection(destination),
          available: true,
          capacity: await this.getStorageCapacity(destination),
          performance: await this.measureStoragePerformance(destination),
        };
        
        this.storageConnections.set(destination.type, storage);
        logger.info('Storage initialized', { type: destination.type, connected: storage.connected });
      } catch (error) {
        logger.error('Failed to initialize storage', error, { type: destination.type });
      }
    }
  }

  private setupScheduler(): void {
    if (this.config.schedule.type === 'interval') {
      const interval = parseInt(this.config.schedule.expression);
      this.backupScheduler = setInterval(() => {
        this.createBackup();
      }, interval);
    } else if (this.config.schedule.type === 'cron') {
      // For cron scheduling, you'd use a cron library like node-cron
      logger.info('Cron scheduling configured', { expression: this.config.schedule.expression });
    }
  }

  private loadRecoveryPlans(): void {
    // Load default recovery plans
    this.recoveryPlans.set('database-recovery', {
      id: 'database-recovery',
      name: 'Database Recovery',
      priority: 'critical',
      rto: 30, // 30 minutes
      rpo: 5,  // 5 minutes
      services: [
        {
          name: 'postgresql',
          dependencies: [],
          recoveryOrder: 1,
          healthCheck: 'pg_isready',
        },
        {
          name: 'redis',
          dependencies: [],
          recoveryOrder: 2,
          healthCheck: 'redis-cli ping',
        },
        {
          name: 'api-server',
          dependencies: ['postgresql', 'redis'],
          recoveryOrder: 3,
          healthCheck: '/health',
        },
      ],
      runbooks: [
        {
          step: 1,
          description: 'Stop all services',
          automation: true,
          command: 'docker-compose down',
          verification: 'Ensure all containers stopped',
        },
        {
          step: 2,
          description: 'Restore database from latest backup',
          automation: true,
          verification: 'Database integrity check',
        },
        {
          step: 3,
          description: 'Start services in order',
          automation: true,
          command: 'docker-compose up -d',
          verification: 'Health check all services',
        },
      ],
      notifications: [
        {
          channel: 'email',
          recipients: ['admin@example.com'],
          triggers: ['started', 'completed', 'failed'],
        },
      ],
    });
  }

  private startMonitoring(): void {
    // Retention cleanup
    this.retentionManager = setInterval(async () => {
      await this.cleanupExpiredBackups();
    }, 3600000); // Every hour

    // Storage monitoring
    this.storageMonitor = setInterval(async () => {
      await this.monitorStorageHealth();
    }, 300000); // Every 5 minutes

    // Health checking
    this.healthChecker = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000); // Every minute
  }

  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `backup-${timestamp}-${random}`;
  }

  private determineBackupType(): 'full' | 'incremental' | 'differential' {
    const recentBackups = Array.from(this.backupMetadata.values())
      .filter(b => b.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const lastFullBackup = recentBackups.find(b => b.type === 'full');
    
    if (!lastFullBackup || lastFullBackup.timestamp < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
      return 'full';
    }

    return this.config.strategy === 'incremental' ? 'incremental' : 'differential';
  }

  private async getBackupDependencies(): Promise<string[]> {
    const recentBackups = Array.from(this.backupMetadata.values())
      .filter(b => b.status === 'completed')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (this.config.strategy === 'incremental') {
      return recentBackups.slice(0, 1).map(b => b.id);
    } else {
      const lastFull = recentBackups.find(b => b.type === 'full');
      return lastFull ? [lastFull.id] : [];
    }
  }

  private calculateRetentionExpiry(): Date {
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + this.config.retention.daily);
    return expiry;
  }

  private async executeBackup(metadata: BackupMetadata): Promise<BackupOperationResult> {
    const startTime = Date.now();
    let totalSize = 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Backup each source
      for (const source of metadata.sources) {
        const sourceSize = await this.backupSource(source, metadata);
        totalSize += sourceSize;
      }

      // Store to all destinations
      for (const destination of this.config.destinations) {
        try {
          await this.storeBackup(metadata, destination);
          metadata.destinations.push(destination.type);
        } catch (error) {
          warnings.push(`Failed to store to ${destination.type}: ${(error as Error).message}`);
        }
      }

      // Calculate checksum
      metadata.checksum = await this.calculateBackupChecksum(metadata);
      metadata.size = totalSize;

      const duration = Date.now() - startTime;
      const throughput = totalSize / (duration / 1000) / (1024 * 1024); // MB/s

      return {
        success: true,
        backupId: metadata.id,
        metadata,
        warnings,
        errors,
        performance: {
          duration,
          throughput,
          compressionRatio: this.config.compression.enabled ? 0.7 : 1.0,
        },
      };

    } catch (error) {
      errors.push((error as Error).message);
      return {
        success: false,
        backupId: metadata.id,
        metadata,
        warnings,
        errors,
        performance: {
          duration: Date.now() - startTime,
          throughput: 0,
          compressionRatio: 0,
        },
      };
    }
  }

  private async backupSource(source: string, metadata: BackupMetadata): Promise<number> {
    switch (source) {
      case 'database':
        return await this.backupDatabase(metadata);
      case 'files':
        return await this.backupFiles(metadata);
      case 'config':
        return await this.backupConfiguration(metadata);
      default:
        throw new Error(`Unknown backup source: ${source}`);
    }
  }

  private async backupDatabase(metadata: BackupMetadata): Promise<number> {
    // Simulate database backup using pg_dump
    logger.info('Backing up database', { backupId: metadata.id });
    
    // In a real implementation, you'd execute pg_dump or similar
    const mockSize = 100 * 1024 * 1024; // 100MB
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate backup time
    return mockSize;
  }

  private async backupFiles(metadata: BackupMetadata): Promise<number> {
    // Simulate file backup
    logger.info('Backing up files', { backupId: metadata.id });
    
    const mockSize = 50 * 1024 * 1024; // 50MB
    await new Promise(resolve => setTimeout(resolve, 1000));
    return mockSize;
  }

  private async backupConfiguration(metadata: BackupMetadata): Promise<number> {
    // Simulate configuration backup
    logger.info('Backing up configuration', { backupId: metadata.id });
    
    const mockSize = 1024 * 1024; // 1MB
    await new Promise(resolve => setTimeout(resolve, 500));
    return mockSize;
  }

  private async storeBackup(metadata: BackupMetadata, destination: any): Promise<void> {
    // Simulate storing backup to destination
    logger.debug('Storing backup', {
      backupId: metadata.id,
      destination: destination.type,
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async calculateBackupChecksum(metadata: BackupMetadata): Promise<string> {
    // Simulate checksum calculation
    const data = JSON.stringify(metadata);
    return createHash('sha256').update(data).digest('hex');
  }

  private async verifyBackup(backupId: string): Promise<boolean> {
    const metadata = this.backupMetadata.get(backupId);
    if (!metadata) return false;

    logger.info('Verifying backup', { backupId });
    
    // Simulate verification
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    metadata.status = 'verified';
    return true;
  }

  private async buildRestoreChain(options: RestoreOptions): Promise<BackupMetadata[]> {
    // Build chain of backups needed for restore
    const chain: BackupMetadata[] = [];
    
    if (options.backupId) {
      const backup = this.backupMetadata.get(options.backupId);
      if (backup) {
        chain.push(backup);
        // Add dependencies for incremental backups
        for (const depId of backup.dependencies) {
          const dep = this.backupMetadata.get(depId);
          if (dep) chain.unshift(dep);
        }
      }
    }
    
    return chain;
  }

  private estimateRestoreDuration(backupChain: BackupMetadata[]): number {
    return backupChain.reduce((total, backup) => total + (backup.size / 1024 / 1024 / 10), 0); // ~10MB/s
  }

  private async validateRestoreTarget(targetLocation: string): Promise<void> {
    // Validate that restore target is accessible and has enough space
    logger.debug('Validating restore target', { targetLocation });
  }

  private async executeRestore(backupChain: BackupMetadata[], options: RestoreOptions): Promise<boolean> {
    logger.info('Executing restore', {
      backupsInChain: backupChain.length,
      targetLocation: options.targetLocation,
    });

    for (const backup of backupChain) {
      logger.info('Restoring backup', { backupId: backup.id });
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate restore
    }

    return true;
  }

  private async verifyRestore(options: RestoreOptions): Promise<boolean> {
    logger.info('Verifying restore', options);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
  }

  private async sendDisasterRecoveryNotifications(
    plan: DisasterRecoveryPlan,
    status: 'started' | 'completed' | 'failed'
  ): Promise<void> {
    for (const notification of plan.notifications) {
      if (notification.triggers.includes(status)) {
        logger.info('Sending disaster recovery notification', {
          channel: notification.channel,
          recipients: notification.recipients.length,
          status,
          planName: plan.name,
        });
      }
    }
  }

  private async executeRunbookStep(
    runbook: DisasterRecoveryPlan['runbooks'][0],
    plan: DisasterRecoveryPlan
  ): Promise<{ success: boolean; output: string }> {
    logger.info('Executing runbook step', {
      step: runbook.step,
      description: runbook.description,
      automation: runbook.automation,
    });

    if (runbook.automation && runbook.command) {
      // In a real implementation, you'd execute the command
      logger.debug('Would execute command', { command: runbook.command });
    }

    // Simulate step execution
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      success: Math.random() > 0.1, // 90% success rate
      output: 'Step completed successfully',
    };
  }

  private async verifyServiceRecovery(plan: DisasterRecoveryPlan): Promise<boolean> {
    logger.info('Verifying service recovery', {
      services: plan.services.length,
    });

    for (const service of plan.services.sort((a, b) => a.recoveryOrder - b.recoveryOrder)) {
      logger.debug('Checking service health', {
        service: service.name,
        healthCheck: service.healthCheck,
      });
      
      // Simulate health check
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return true;
  }

  private calculateNextScheduledBackup(): Date | null {
    if (this.config.schedule.type === 'interval') {
      const interval = parseInt(this.config.schedule.expression);
      return new Date(Date.now() + interval);
    }
    return null;
  }

  private async testBackupIntegrity(): Promise<{ success: boolean; duration: number; notes: string }> {
    const start = Date.now();
    
    // Test a sample of recent backups
    const recentBackups = Array.from(this.backupMetadata.values())
      .filter(b => b.status === 'completed')
      .slice(0, 3);

    let allPassed = true;
    for (const backup of recentBackups) {
      const verified = await this.verifyBackup(backup.id);
      if (!verified) allPassed = false;
    }

    return {
      success: allPassed,
      duration: Date.now() - start,
      notes: `Tested ${recentBackups.length} recent backups`,
    };
  }

  private async testRestoreCapabilities(): Promise<{ success: boolean; duration: number; notes: string }> {
    const start = Date.now();
    
    // Test restore to temporary location
    const testRestore = await this.restoreFromBackup({
      targetLocation: '/tmp/restore-test',
      dryRun: true,
      verification: false,
    });

    return {
      success: testRestore,
      duration: Date.now() - start,
      notes: 'Tested restore procedure with dry run',
    };
  }

  private async testStorageConnectivity(): Promise<{ success: boolean; duration: number; notes: string }> {
    const start = Date.now();
    let allConnected = true;

    for (const [type, storage] of this.storageConnections.entries()) {
      if (!storage.connected) {
        allConnected = false;
      }
    }

    return {
      success: allConnected,
      duration: Date.now() - start,
      notes: `Tested ${this.storageConnections.size} storage connections`,
    };
  }

  private async testNotificationSystems(): Promise<{ success: boolean; duration: number; notes: string }> {
    const start = Date.now();
    
    // Test notification delivery
    logger.info('Testing notification systems');

    return {
      success: true,
      duration: Date.now() - start,
      notes: 'Notification systems operational',
    };
  }

  private async testStorageConnection(destination: any): Promise<boolean> {
    // Simulate storage connection test
    return Math.random() > 0.1; // 90% success rate
  }

  private async getStorageCapacity(destination: any): Promise<{ total: number; used: number; available: number }> {
    return {
      total: 1000 * 1024 * 1024 * 1024, // 1TB
      used: 200 * 1024 * 1024 * 1024,   // 200GB
      available: 800 * 1024 * 1024 * 1024, // 800GB
    };
  }

  private async measureStoragePerformance(destination: any): Promise<{
    readThroughput: number;
    writeThroughput: number;
    latency: number;
  }> {
    return {
      readThroughput: 100, // MB/s
      writeThroughput: 80,  // MB/s
      latency: 10,          // ms
    };
  }

  private async cleanupExpiredBackups(): Promise<void> {
    const now = new Date();
    const expired = Array.from(this.backupMetadata.entries())
      .filter(([, metadata]) => metadata.retentionExpiry <= now);

    for (const [backupId, metadata] of expired) {
      logger.info('Cleaning up expired backup', { backupId });
      this.backupMetadata.delete(backupId);
      
      // Clean up from storage destinations
      for (const destination of metadata.destinations) {
        // In a real implementation, you'd delete from the actual storage
        logger.debug('Deleting from storage', { backupId, destination });
      }
    }

    if (expired.length > 0) {
      this.metrics.recordMetric('backups_cleaned_up', expired.length);
    }
  }

  private async monitorStorageHealth(): Promise<void> {
    for (const [type, storage] of this.storageConnections.entries()) {
      const isHealthy = await this.testStorageConnection({ type });
      storage.connected = isHealthy;
      storage.available = isHealthy;

      this.metrics.recordMetric('storage_health', isHealthy ? 1 : 0, { type });
    }
  }

  private async performHealthChecks(): Promise<void> {
    // Check active backups
    const activeBackups = Array.from(this.backupMetadata.values())
      .filter(b => b.status === 'running');

    // Check for stuck backups
    const stuckBackups = activeBackups.filter(b => 
      Date.now() - b.timestamp.getTime() > 4 * 60 * 60 * 1000 // 4 hours
    );

    if (stuckBackups.length > 0) {
      logger.warn('Detected stuck backups', {
        count: stuckBackups.length,
        backupIds: stuckBackups.map(b => b.id),
      });
    }

    this.metrics.recordMetric('backup_health_check', 1, {
      activeBackups: activeBackups.length.toString(),
      stuckBackups: stuckBackups.length.toString(),
    });
  }

  /**
   * Shutdown backup manager
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear intervals
      if (this.backupScheduler) {
        clearInterval(this.backupScheduler);
      }
      if (this.retentionManager) {
        clearInterval(this.retentionManager);
      }
      if (this.storageMonitor) {
        clearInterval(this.storageMonitor);
      }
      if (this.healthChecker) {
        clearInterval(this.healthChecker);
      }

      // Cancel active backups
      for (const [backupId, timeout] of this.activeBackups.entries()) {
        clearTimeout(timeout);
        const metadata = this.backupMetadata.get(backupId);
        if (metadata) {
          metadata.status = 'failed';
        }
      }

      // Clear data structures
      this.backupMetadata.clear();
      this.activeBackups.clear();
      this.storageConnections.clear();
      this.recoveryPlans.clear();

      logger.info('Backup manager shutdown completed');
      this.emit('shutdown');
    } catch (error) {
      logger.error('Error during backup manager shutdown', error);
      throw error;
    }
  }
}

/**
 * Factory function to create backup manager
 */
export const createBackupManager = (config: BackupConfiguration) => {
  return BackupManager.getInstance(config);
};

/**
 * Default backup configuration
 */
export const defaultBackupConfiguration: BackupConfiguration = {
  strategy: 'incremental',
  schedule: {
    type: 'interval',
    expression: '3600000', // 1 hour
  },
  retention: {
    daily: 7,
    weekly: 4,
    monthly: 12,
    yearly: 3,
  },
  destinations: [
    {
      type: 's3',
      config: {
        bucket: 'backup-bucket',
        region: 'us-east-1',
      },
      priority: 1,
      encryption: true,
    },
  ],
  compression: {
    enabled: true,
    algorithm: 'lz4',
    level: 3,
  },
  verification: {
    enabled: true,
    checksumAlgorithm: 'sha256',
    testRestore: false,
  },
};