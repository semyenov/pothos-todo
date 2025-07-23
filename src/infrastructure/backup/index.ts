/**
 * Enterprise-Grade Backup and Disaster Recovery Infrastructure
 * 
 * This module provides comprehensive backup, disaster recovery, and business continuity
 * capabilities for enterprise applications. It includes:
 * 
 * - Automated backup management with multiple strategies (full, incremental, differential)
 * - Point-in-time recovery and cross-region replication
 * - Disaster recovery orchestration with automated failover
 * - Business continuity planning and compliance management
 * - Executive dashboards and comprehensive reporting
 * 
 * Key Features:
 * - Multi-destination backup support (S3, GCS, Azure, local, FTP)
 * - Intelligent backup scheduling and retention policies
 * - Automated disaster recovery testing and validation
 * - Compliance framework support (SOX, ISO 22301, etc.)
 * - Business impact analysis and risk assessment
 * - Real-time monitoring and alerting
 * - Executive reporting and KPI tracking
 */

import { type BackupConfiguration, createBackupManager, defaultBackupConfiguration, type RestoreOptions } from './BackupManager.js';
import { createBusinessContinuityManager } from './BusinessContinuityManager.js';
import { createDisasterRecoveryOrchestrator } from './DisasterRecoveryOrchestrator.js';

// Core backup and recovery services
export {
  BackupManager,
  type BackupConfiguration,
  type BackupMetadata,
  type RestoreOptions,
  type BackupOperationResult,
  type DisasterRecoveryPlan,
  createBackupManager,
  defaultBackupConfiguration,
} from './BackupManager.js';

export {
  DisasterRecoveryOrchestrator,
  type RecoveryScenario,
  type RecoveryExecution,
  type FailureDetection,
  type RecoveryTestSuite,
  type BusinessContinuityMetrics,
  createDisasterRecoveryOrchestrator,
} from './DisasterRecoveryOrchestrator.js';

export {
  BusinessContinuityManager,
  createBusinessContinuityManager,
} from './BusinessContinuityManager.js';

/**
 * Initialize enterprise backup and disaster recovery infrastructure
 */
export function initializeEnterpriseBackupInfrastructure(config?: {
  backup?: BackupConfiguration;
  enableAutomatedTesting?: boolean;
  complianceFrameworks?: string[];
}) {
  const backupManager = createBackupManager(
    config?.backup || defaultBackupConfiguration
  );

  const recoveryOrchestrator = createDisasterRecoveryOrchestrator();

  const continuityManager = createBusinessContinuityManager();

  // Setup automated testing if enabled
  if (config?.enableAutomatedTesting) {
    // Schedule regular DR tests
    setInterval(async () => {
      try {
        await recoveryOrchestrator.runRecoveryTest('component', {
          dryRun: true,
        });
      } catch (error) {
        console.error('Automated DR test failed:', error);
      }
    }, 7 * 24 * 60 * 60 * 1000); // Weekly
  }

  return {
    backupManager,
    recoveryOrchestrator,
    continuityManager,

    // Convenience methods
    async createBackup(sources?: string[]) {
      return backupManager.createBackup(sources);
    },

    async restoreFromBackup(options: RestoreOptions) {
      return backupManager.restoreFromBackup(options);
    },

    async triggerDisasterRecovery(scenarioId: string) {
      return recoveryOrchestrator.triggerRecovery(scenarioId);
    },

    async getExecutiveDashboard() {
      return continuityManager.generateExecutiveDashboard();
    },

    async generateComplianceReport(framework: string, period: { start: Date; end: Date }) {
      return continuityManager.generateComplianceReport(framework, period);
    },

    async shutdown() {
      await Promise.all([
        backupManager.shutdown(),
        recoveryOrchestrator.shutdown(),
        continuityManager.shutdown(),
      ]);
    },
  };
}

/**
 * Default enterprise backup and disaster recovery configuration
 */
export const defaultEnterpriseConfig = {
  backup: defaultBackupConfiguration,
  enableAutomatedTesting: true,
  complianceFrameworks: ['SOX', 'ISO-22301'],
};

/**
 * Enterprise backup and disaster recovery best practices
 */
export const bestPractices = {
  backup: {
    // Use the 3-2-1 rule: 3 copies, 2 different media, 1 offsite
    retention: '3-2-1 rule implementation',
    testing: 'Regular restore testing',
    encryption: 'Always encrypt backups',
    verification: 'Verify backup integrity',
  },

  disasterRecovery: {
    planning: 'Comprehensive DR planning',
    testing: 'Regular DR testing',
    automation: 'Automate recovery procedures',
    documentation: 'Maintain current runbooks',
  },

  businessContinuity: {
    governance: 'Establish BC governance',
    riskAssessment: 'Regular risk assessments',
    training: 'Staff training and awareness',
    compliance: 'Maintain compliance posture',
  },
};

/**
 * Compliance frameworks supported
 */
export const supportedComplianceFrameworks = [
  'SOX', // Sarbanes-Oxley Act
  'ISO-22301', // Business Continuity Management
  'NIST', // National Institute of Standards and Technology
  'GDPR', // General Data Protection Regulation
  'HIPAA', // Health Insurance Portability and Accountability Act
  'PCI-DSS', // Payment Card Industry Data Security Standard
];

/**
 * Recovery Time Objectives (RTO) guidelines
 */
export const rtoGuidelines = {
  critical: '< 15 minutes',
  high: '< 30 minutes',
  medium: '< 2 hours',
  low: '< 8 hours',
};

/**
 * Recovery Point Objectives (RPO) guidelines
 */
export const rpoGuidelines = {
  critical: '< 5 minutes',
  high: '< 15 minutes',
  medium: '< 1 hour',
  low: '< 4 hours',
};