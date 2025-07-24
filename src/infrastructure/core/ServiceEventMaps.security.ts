/**
 * Security Service Event Maps
 * 
 * Type-safe event definitions for all security and compliance services.
 * These event maps provide compile-time type safety for event-driven
 * security operations.
 */

/**
 * Threat detection events for security monitoring
 */
export interface ThreatDetectionEventMap {
  'threat:detected': { 
    threatId: string; 
    type: 'malware' | 'intrusion' | 'anomaly' | 'vulnerability' | 'data_exfiltration' | 'privilege_escalation';
    severity: 'low' | 'medium' | 'high' | 'critical';
    source: string;
    target?: string;
    description: string;
    indicators: Array<{
      type: string;
      value: string;
      confidence: number;
    }>;
    timestamp: number;
    metadata: Record<string, any>;
  };
  'threat:mitigated': { 
    threatId: string; 
    mitigation: string;
    automaticResponse: boolean;
    duration: number;
    success: boolean;
  };
  'threat:escalated': { 
    threatId: string; 
    escalationLevel: string;
    reason: string;
    assignedTo?: string;
    urgency: number;
  };
  'threat:analysis-completed': { 
    threatId: string; 
    analysis: {
      riskScore: number;
      attackVector: string[];
      potentialImpact: string;
      recommendedActions: string[];
    };
    duration: number;
  };
  'threat:intelligence-updated': { 
    sourceId: string;
    indicators: number;
    rules: number;
    lastUpdate: number;
    coverage: string[];
  };
  'threat:false-positive': { 
    threatId: string; 
    reason: string;
    analyst: string;
    feedback: Record<string, any>;
  };
  'threat:error': { 
    error: Error; 
    operation: string;
    context?: Record<string, any>;
  };
}

/**
 * Data encryption events for cryptographic operations
 */
export interface DataEncryptionEventMap {
  'encryption:key-generated': { 
    keyId: string; 
    algorithm: string;
    keySize: number;
    purpose: string;
    expiryDate?: number;
  };
  'encryption:key-rotated': { 
    oldKeyId: string; 
    newKeyId: string;
    algorithm: string;
    rotationReason: string;
    scheduledRotation: boolean;
  };
  'encryption:data-encrypted': { 
    dataId: string; 
    algorithm: string;
    keyId: string;
    dataSize: number;
    duration: number;
  };
  'encryption:data-decrypted': { 
    dataId: string; 
    keyId: string;
    requestor: string;
    authorized: boolean;
    duration: number;
  };
  'encryption:key-access-denied': { 
    keyId: string; 
    requestor: string;
    reason: string;
    timestamp: number;
  };
  'encryption:key-compromised': { 
    keyId: string; 
    detectionMethod: string;
    impactAssessment: {
      affectedData: string[];
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      mitigationRequired: boolean;
    };
  };
  'encryption:compliance-check': { 
    standard: string;
    status: 'compliant' | 'non-compliant' | 'partial';
    findings: Array<{
      requirement: string;
      status: 'pass' | 'fail' | 'warning';
      details: string;
    }>;
  };
  'encryption:error': { 
    error: Error; 
    operation: string;
    keyId?: string;
  };
}

/**
 * API key management events for authentication
 */
export interface ApiKeyManagerEventMap {
  'apikey:created': { 
    keyId: string; 
    name: string;
    scopes: string[];
    expiryDate?: number;
    userId?: string;
    serviceAccount?: string;
  };
  'apikey:revoked': { 
    keyId: string; 
    reason: string;
    revokedBy: string;
    immediate: boolean;
  };
  'apikey:accessed': { 
    keyId: string; 
    endpoint: string;
    method: string;
    timestamp: number;
    clientIP: string;
    userAgent?: string;
  };
  'apikey:rate-limited': { 
    keyId: string; 
    endpoint: string;
    currentRate: number;
    limit: number;
    windowMs: number;
  };
  'apikey:expired': { 
    keyId: string; 
    name: string;
    lastUsed?: number;
    gracePeriodDays: number;
  };
  'apikey:suspicious-activity': { 
    keyId: string; 
    activity: string;
    indicators: Array<{
      type: string;
      value: any;
      confidence: number;
    }>;
    riskScore: number;
  };
  'apikey:scope-violation': { 
    keyId: string; 
    requestedScope: string;
    allowedScopes: string[];
    endpoint: string;
    blocked: boolean;
  };
  'apikey:error': { 
    error: Error; 
    operation: string;
    keyId?: string;
  };
}

/**
 * Policy engine events for access control
 */
export interface PolicyEngineEventMap {
  'policy:created': { 
    policyId: string; 
    name: string;
    type: 'rbac' | 'abac' | 'custom';
    version: string;
    createdBy: string;
  };
  'policy:updated': { 
    policyId: string; 
    changes: Array<{
      field: string;
      oldValue: any;
      newValue: any;
    }>;
    version: string;
    updatedBy: string;
  };
  'policy:evaluated': { 
    policyId: string; 
    subject: string;
    resource: string;
    action: string;
    decision: 'permit' | 'deny' | 'indeterminate';
    duration: number;
    context: Record<string, any>;
  };
  'policy:violation': { 
    policyId: string; 
    subject: string;
    resource: string;
    action: string;
    violation: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
  'policy:conflict-detected': { 
    policies: Array<{
      id: string;
      name: string;
      decision: string;
    }>;
    resolution: string;
    resolutionStrategy: 'first-applicable' | 'deny-override' | 'permit-override';
  };
  'policy:deployment': { 
    policyId: string; 
    environment: string;
    deploymentStrategy: string;
    rollbackPlan: boolean;
    testResults?: Record<string, any>;
  };
  'policy:compliance-check': { 
    framework: string;
    policies: number;
    compliant: number;
    violations: number;
    score: number;
  };
  'policy:error': { 
    error: Error; 
    operation: string;
    policyId?: string;
  };
}

/**
 * Security audit events for compliance tracking
 */
export interface SecurityAuditEventMap {
  'audit:event-logged': { 
    eventId: string; 
    eventType: string;
    userId?: string;
    sessionId?: string;
    timestamp: number;
    resource: string;
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    metadata: Record<string, any>;
  };
  'audit:trail-exported': { 
    exportId: string; 
    format: 'json' | 'csv' | 'xml' | 'pdf';
    timeRange: {
      start: number;
      end: number;
    };
    events: number;
    destination: string;
  };
  'audit:anomaly-detected': { 
    anomalyId: string; 
    type: 'unusual_access' | 'privilege_escalation' | 'data_access' | 'time_based';
    description: string;
    riskScore: number;
    events: Array<{
      eventId: string;
      timestamp: number;
      significance: number;
    }>;
  };
  'audit:compliance-report': { 
    reportId: string; 
    framework: string;
    period: {
      start: number;
      end: number;
    };
    findings: Array<{
      requirement: string;
      status: 'compliant' | 'non-compliant' | 'partial';
      evidence: string[];
      gaps?: string[];
    }>;
    score: number;
  };
  'audit:retention-applied': { 
    policy: string;
    eventsArchived: number;
    eventsDeleted: number;
    retentionPeriod: number;
    complianceFramework?: string;
  };
  'audit:integrity-check': { 
    checkId: string; 
    eventsChecked: number;
    integrityViolations: number;
    tampering: boolean;
    details?: Array<{
      eventId: string;
      issue: string;
      severity: string;
    }>;
  };
  'audit:error': { 
    error: Error; 
    operation: string;
    eventId?: string;
  };
}

/**
 * Data privacy events for GDPR/CCPA compliance
 */
export interface DataPrivacyEventMap {
  'privacy:consent-given': { 
    userId: string; 
    consentId: string;
    purposes: string[];
    timestamp: number;
    method: 'explicit' | 'implicit' | 'granular';
    version: string;
  };
  'privacy:consent-withdrawn': { 
    userId: string; 
    consentId: string;
    purposes: string[];
    reason?: string;
    effectiveDate: number;
  };
  'privacy:data-accessed': { 
    userId: string; 
    dataTypes: string[];
    purpose: string;
    legalBasis: string;
    requestor: string;
    authorized: boolean;
  };
  'privacy:data-exported': { 
    userId: string; 
    exportId: string;
    dataTypes: string[];
    format: string;
    destination: string;
    requestType: 'subject_access' | 'portability' | 'legal_request';
  };
  'privacy:data-deleted': { 
    userId: string; 
    deletionId: string;
    dataTypes: string[];
    reason: 'right_to_erasure' | 'retention_expired' | 'consent_withdrawn';
    verification: boolean;
  };
  'privacy:data-anonymized': { 
    datasetId: string; 
    records: number;
    technique: string;
    riskAssessment: {
      reidentificationRisk: 'low' | 'medium' | 'high';
      dataUtility: number;
    };
  };
  'privacy:breach-detected': { 
    breachId: string; 
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedUsers: number;
    dataTypes: string[];
    cause: string;
    notificationRequired: boolean;
  };
  'privacy:error': { 
    error: Error; 
    operation: string;
    userId?: string;
  };
}

/**
 * Advanced security manager events for enterprise security
 */
export interface AdvancedSecurityManagerEventMap {
  'security:posture-assessed': { 
    assessmentId: string; 
    score: number;
    categories: Array<{
      name: string;
      score: number;
      status: 'excellent' | 'good' | 'fair' | 'poor';
    }>;
    recommendations: string[];
    nextAssessment: number;
  };
  'security:vulnerability-discovered': { 
    vulnerabilityId: string; 
    type: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    cvssScore?: number;
    component: string;
    description: string;
    remediation: string[];
  };
  'security:incident-declared': { 
    incidentId: string; 
    type: string;
    severity: 'minor' | 'major' | 'critical' | 'catastrophic';
    status: 'open' | 'investigating' | 'contained' | 'resolved';
    assignee?: string;
    timeline: Array<{
      timestamp: number;
      action: string;
      details: string;
    }>;
  };
  'security:control-implemented': { 
    controlId: string; 
    framework: string;
    type: 'preventive' | 'detective' | 'corrective' | 'compensating';
    status: 'planned' | 'implemented' | 'tested' | 'operational';
    effectiveness: number;
  };
  'security:risk-identified': { 
    riskId: string; 
    category: string;
    probability: number;
    impact: number;
    riskScore: number;
    mitigation: Array<{
      strategy: string;
      cost: number;
      effectiveness: number;
    }>;
  };
  'security:training-completed': { 
    userId: string; 
    trainingType: string;
    completionDate: number;
    score?: number;
    certificateId?: string;
    nextDue?: number;
  };
  'security:error': { 
    error: Error; 
    operation: string;
    context?: Record<string, any>;
  };
}

/**
 * Quantum cryptography events for future-proof security
 */
export interface QuantumCryptographyServiceEventMap {
  'quantum:key-distribution': { 
    sessionId: string; 
    algorithm: 'bb84' | 'e91' | 'sarg04';
    participants: string[];
    keyLength: number;
    errorRate: number;
    security: 'secure' | 'compromised' | 'eavesdropping-detected';
  };
  'quantum:entropy-generated': { 
    entropyId: string; 
    source: 'quantum_random' | 'atmospheric_noise' | 'hardware_rng';
    bits: number;
    quality: number;
    tests: Array<{
      test: string;
      passed: boolean;
      pValue: number;
    }>;
  };
  'quantum:resistant-encryption': { 
    operationId: string; 
    algorithm: 'lattice' | 'code' | 'multivariate' | 'hash' | 'isogeny';
    keySize: number;
    performance: {
      encryptionTime: number;
      decryptionTime: number;
      keyGenerationTime: number;
    };
  };
  'quantum:threat-assessment': { 
    assessmentId: string; 
    quantumReadiness: number;
    vulnerableAlgorithms: string[];
    migrationPlan: Array<{
      system: string;
      priority: 'low' | 'medium' | 'high' | 'critical';
      timeline: number;
    }>;
  };
  'quantum:circuit-executed': { 
    circuitId: string; 
    qubits: number;
    gates: number;
    depth: number;
    fidelity: number;
    errorRate: number;
  };
  'quantum:error-corrected': { 
    operationId: string; 
    logicalQubits: number;
    physicalQubits: number;
    errorsSyndromes: number;
    corrections: number;
    success: boolean;
  };
  'quantum:error': { 
    error: Error; 
    operation: string;
    quantumContext?: Record<string, any>;
  };
}

/**
 * Enterprise security manager events for comprehensive security
 */
export interface EnterpriseSecurityManagerEventMap {
  'enterprise:governance-updated': { 
    policyId: string; 
    domain: string;
    changes: Array<{
      policy: string;
      impact: 'low' | 'medium' | 'high';
      stakeholders: string[];
    }>;
    approvalRequired: boolean;
  };
  'enterprise:compliance-audit': { 
    auditId: string; 
    frameworks: string[];
    scope: string[];
    findings: Array<{
      framework: string;
      requirement: string;
      status: 'compliant' | 'non-compliant' | 'partial' | 'not-applicable';
      evidence: string[];
      gaps?: string[];
      remediation?: string[];
    }>;
    overallScore: number;
  };
  'enterprise:security-training': { 
    programId: string; 
    participants: number;
    completionRate: number;
    effectiveness: number;
    topics: string[];
    nextScheduled?: number;
  };
  'enterprise:third-party-assessment': { 
    vendorId: string; 
    assessmentType: 'onboarding' | 'periodic' | 'incident-driven';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    findings: Array<{
      category: string;
      risk: string;
      mitigation: string;
    }>;
    approved: boolean;
  };
  'enterprise:business-continuity-test': { 
    testId: string; 
    scenario: string;
    duration: number;
    participants: string[];
    objectives: Array<{
      objective: string;
      met: boolean;
      metrics: Record<string, number>;
    }>;
    improvements: string[];
  };
  'enterprise:security-metrics': { 
    reportingPeriod: {
      start: number;
      end: number;
    };
    metrics: Array<{
      name: string;
      value: number;
      target: number;
      trend: 'improving' | 'stable' | 'declining';
    }>;
    kpis: Record<string, number>;
  };
  'enterprise:error': { 
    error: Error; 
    operation: string;
    businessImpact?: 'low' | 'medium' | 'high' | 'critical';
  };
}

/**
 * Aggregate type for all security service event maps
 */
export type SecurityServiceEventMap = 
  | ThreatDetectionEventMap
  | DataEncryptionEventMap
  | ApiKeyManagerEventMap
  | PolicyEngineEventMap
  | SecurityAuditEventMap
  | DataPrivacyEventMap
  | AdvancedSecurityManagerEventMap
  | QuantumCryptographyServiceEventMap
  | EnterpriseSecurityManagerEventMap;

/**
 * Helper type to get event map for a specific security service
 */
export type GetSecurityServiceEventMap<T extends string> = 
  T extends 'threat-detection' ? ThreatDetectionEventMap :
  T extends 'data-encryption' ? DataEncryptionEventMap :
  T extends 'api-key-manager' ? ApiKeyManagerEventMap :
  T extends 'policy-engine' ? PolicyEngineEventMap :
  T extends 'security-audit' ? SecurityAuditEventMap :
  T extends 'data-privacy' ? DataPrivacyEventMap :
  T extends 'advanced-security-manager' ? AdvancedSecurityManagerEventMap :
  T extends 'quantum-cryptography' ? QuantumCryptographyServiceEventMap :
  T extends 'enterprise-security-manager' ? EnterpriseSecurityManagerEventMap :
  never;