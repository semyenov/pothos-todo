import type { SpanOptions } from '@opentelemetry/api';
import { AsyncSingletonService } from '@/lib/base/AsyncSingletonService.js';
import { createLogger } from '@/lib/logger.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { DistributedTracing } from '@/infrastructure/observability/DistributedTracing.js';

const logger = createLogger('PipelineOrchestrator');

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  triggers: PipelineTrigger[];
  variables: PipelineVariable[];
  configuration: PipelineConfiguration;
  metadata: PipelineMetadata;
}

export interface PipelineStage {
  id: string;
  name: string;
  type: StageType;
  dependsOn: string[];
  jobs: PipelineJob[];
  conditions: StageCondition[];
  configuration: StageConfiguration;
  parallelism?: number;
  timeout?: number;
}

export enum StageType {
  BUILD = 'build',
  TEST = 'test',
  SECURITY = 'security',
  DEPLOY = 'deploy',
  VERIFY = 'verify',
  ROLLBACK = 'rollback',
  CLEANUP = 'cleanup',
  NOTIFICATION = 'notification'
}

export interface PipelineJob {
  id: string;
  name: string;
  type: JobType;
  script?: string;
  image?: string;
  environment: Record<string, string>;
  artifacts?: JobArtifact[];
  cache?: CacheConfig;
  resources: ResourceRequirements;
  retryPolicy: RetryPolicy;
  timeout: number;
}

export enum JobType {
  SHELL = 'shell',
  DOCKER = 'docker',
  KUBERNETES = 'kubernetes',
  LAMBDA = 'lambda',
  API_CALL = 'api_call',
  NOTIFICATION = 'notification',
  APPROVAL = 'approval'
}

export interface JobArtifact {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'archive';
  retention: number; // days
  downloadable: boolean;
}

export interface CacheConfig {
  key: string;
  paths: string[];
  policy: 'pull' | 'push' | 'pull-push';
  fallbackKeys?: string[];
}

export interface ResourceRequirements {
  cpu: string;
  memory: string;
  storage?: string;
  gpu?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  backoffMultiplier?: number;
  maxBackoffTime?: number;
  retryableExitCodes?: number[];
}

export interface StageCondition {
  type: 'variable' | 'expression' | 'manual_approval' | 'external_check';
  condition: string;
  required: boolean;
}

export interface StageConfiguration {
  strategy: DeploymentStrategy;
  rollbackPolicy: RollbackPolicy;
  notifications: NotificationConfig[];
  approvals: ApprovalConfig[];
}

export enum DeploymentStrategy {
  ROLLING = 'rolling',
  BLUE_GREEN = 'blue_green',
  CANARY = 'canary',
  RECREATE = 'recreate',
  A_B_TEST = 'a_b_test'
}

export interface RollbackPolicy {
  enabled: boolean;
  automatic: boolean;
  conditions: RollbackCondition[];
  timeout: number;
}

export interface RollbackCondition {
  metric: string;
  threshold: number;
  operator: 'greater_than' | 'less_than' | 'equals';
  duration: number;
}

export interface NotificationConfig {
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'sms';
  recipients: string[];
  events: NotificationEvent[];
  template?: string;
  config: Record<string, any>;
}

export enum NotificationEvent {
  PIPELINE_START = 'pipeline_start',
  PIPELINE_SUCCESS = 'pipeline_success',
  PIPELINE_FAILURE = 'pipeline_failure',
  STAGE_START = 'stage_start',
  STAGE_SUCCESS = 'stage_success',
  STAGE_FAILURE = 'stage_failure',
  APPROVAL_REQUIRED = 'approval_required',
  DEPLOYMENT_SUCCESS = 'deployment_success',
  DEPLOYMENT_FAILURE = 'deployment_failure',
  ROLLBACK_TRIGGERED = 'rollback_triggered'
}

export interface ApprovalConfig {
  id: string;
  name: string;
  approvers: string[];
  minApprovals: number;
  timeout: number; // minutes
  autoApprove?: boolean;
  conditions?: ApprovalCondition[];
}

export interface ApprovalCondition {
  environment: string;
  branch: string;
  user: string;
  time?: { start: string; end: string };
}

export interface PipelineTrigger {
  type: TriggerType;
  configuration: TriggerConfiguration;
  enabled: boolean;
  conditions?: TriggerCondition[];
}

export enum TriggerType {
  PUSH = 'push',
  PULL_REQUEST = 'pull_request',
  SCHEDULE = 'schedule',
  WEBHOOK = 'webhook',
  MANUAL = 'manual',
  API = 'api',
  TAG = 'tag',
  RELEASE = 'release'
}

export interface TriggerConfiguration {
  branches?: string[];
  tags?: string[];
  paths?: string[];
  schedule?: string; // cron expression
  webhook?: WebhookConfig;
  api?: ApiConfig;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

export interface ApiConfig {
  authentication: 'none' | 'token' | 'oauth';
  permissions: string[];
}

export interface TriggerCondition {
  type: 'branch' | 'tag' | 'path' | 'user' | 'time';
  pattern: string;
  exclude?: boolean;
}

export interface PipelineVariable {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  scope: 'global' | 'stage' | 'job';
  required: boolean;
  description?: string;
}

export interface PipelineConfiguration {
  concurrency: number;
  timeout: number;
  retryPolicy: RetryPolicy;
  cleanupPolicy: CleanupPolicy;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
}

export interface CleanupPolicy {
  retainBuilds: number;
  retainArtifacts: number; // days
  retainLogs: number; // days
  cleanupSchedule: string; // cron expression
}

export interface SecurityConfig {
  scanArtifacts: boolean;
  scanImages: boolean;
  enforceSignatures: boolean;
  allowedRegistries: string[];
  secrets: SecretConfig[];
}

export interface SecretConfig {
  name: string;
  provider: 'vault' | 'k8s' | 'aws' | 'azure' | 'gcp';
  path: string;
  key?: string;
}

export interface MonitoringConfig {
  enableMetrics: boolean;
  enableTracing: boolean;
  enableLogging: boolean;
  alerts: AlertConfig[];
}

export interface AlertConfig {
  metric: string;
  threshold: number;
  operator: 'greater_than' | 'less_than' | 'equals';
  recipients: string[];
}

export interface PipelineMetadata {
  version: string;
  created: Date;
  lastModified: Date;
  createdBy: string;
  lastModifiedBy: string;
  tags: string[];
  repository?: RepositoryInfo;
}

export interface RepositoryInfo {
  url: string;
  branch: string;
  commit: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure';
}

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  number: number;
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  stages: StageExecution[];
  variables: Record<string, string>;
  artifacts: ExecutionArtifact[];
  metrics: ExecutionMetrics;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

export enum ExecutionStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILURE = 'failure',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
  APPROVAL_REQUIRED = 'approval_required'
}

export interface ExecutionTrigger {
  type: TriggerType;
  user?: string;
  event?: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface StageExecution {
  id: string;
  stageId: string;
  name: string;
  status: ExecutionStatus;
  jobs: JobExecution[];
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  logs: string[];
  artifacts: ExecutionArtifact[];
}

export interface JobExecution {
  id: string;
  jobId: string;
  name: string;
  status: ExecutionStatus;
  exitCode?: number;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  logs: string[];
  artifacts: ExecutionArtifact[];
  retryCount: number;
  resources: ResourceUsage;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  storage: number;
  networkIn: number;
  networkOut: number;
}

export interface ExecutionArtifact {
  name: string;
  path: string;
  size: number;
  type: string;
  checksum: string;
  downloadUrl?: string;
}

export interface ExecutionMetrics {
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  testsPassed: number;
  testsFailed: number;
  codeCoverage: number;
  securityIssues: number;
  performanceScore: number;
  costEstimate: number;
}

export interface DeploymentTarget {
  id: string;
  name: string;
  type: TargetType;
  environment: string;
  configuration: TargetConfiguration;
  healthChecks: HealthCheck[];
  rollbackConfig: RollbackConfig;
}

export enum TargetType {
  KUBERNETES = 'kubernetes',
  DOCKER = 'docker',
  VM = 'vm',
  SERVERLESS = 'serverless',
  CDN = 'cdn',
  DATABASE = 'database'
}

export interface TargetConfiguration {
  endpoint: string;
  credentials: string;
  namespace?: string;
  region?: string;
  cluster?: string;
  version?: string;
  config: Record<string, any>;
}

export interface HealthCheck {
  type: 'http' | 'tcp' | 'command' | 'custom';
  endpoint?: string;
  command?: string;
  timeout: number;
  interval: number;
  retries: number;
  expectedStatus?: number;
  expectedOutput?: string;
}

export interface RollbackConfig {
  enabled: boolean;
  strategy: 'immediate' | 'gradual' | 'manual';
  healthCheckTimeout: number;
  rollbackTimeout: number;
  preserveData: boolean;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: TemplateParameter[];
  pipeline: Pipeline;
  usage: TemplateUsage;
}

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: any;
  description: string;
  options?: any[];
}

export interface TemplateUsage {
  count: number;
  lastUsed: Date;
  rating: number;
  feedback: TemplateFeedback[];
}

export interface TemplateFeedback {
  user: string;
  rating: number;
  comment: string;
  timestamp: Date;
}

export interface PipelineReport {
  pipelineId: string;
  timeRange: { start: Date; end: Date };
  executions: ReportExecution[];
  metrics: ReportMetrics;
  trends: ReportTrend[];
  recommendations: string[];
}

export interface ReportExecution {
  id: string;
  number: number;
  status: ExecutionStatus;
  duration: number;
  timestamp: Date;
  trigger: ExecutionTrigger;
}

export interface ReportMetrics {
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  avgCost: number;
  totalCost: number;
  failureReasons: Array<{ reason: string; count: number }>;
  stageMetrics: Array<{ stage: string; avgDuration: number; successRate: number }>;
}

export interface ReportTrend {
  metric: string;
  trend: 'up' | 'down' | 'stable';
  change: number;
  period: string;
}

export class PipelineOrchestrator extends AsyncSingletonService<PipelineOrchestrator> {
  private redis!: RedisClusterManager;
  private tracing!: DistributedTracing;
  private pipelines: Map<string, Pipeline> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();
  private templates: Map<string, PipelineTemplate> = new Map();
  private targets: Map<string, DeploymentTarget> = new Map();
  private executionQueue: string[] = [];
  private workers: Set<NodeJS.Timeout> = new Set();
  private maxConcurrentExecutions = 5;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<PipelineOrchestrator> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.redis = RedisClusterManager.getInstance();
      this.tracing = await DistributedTracing.getInstance();
      
      await this.loadPipelines();
      await this.loadTemplates();
      await this.loadDeploymentTargets();
      await this.startWorkers();
      
      logger.info('PipelineOrchestrator initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PipelineOrchestrator:', error);
      throw error;
    }
  }

  async createPipeline(pipeline: Pipeline): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'pipeline.id': pipeline.id,
        'pipeline.name': pipeline.name,
        'pipeline.stage_count': pipeline.stages.length
      }
    };

    return this.tracing.traceAsync('create_pipeline', spanOptions, async () => {
      try {
        await this.validatePipeline(pipeline);
        
        pipeline.metadata.created = new Date();
        pipeline.metadata.lastModified = new Date();
        
        this.pipelines.set(pipeline.id, pipeline);
        await this.redis.setObject(`cicd:pipeline:${pipeline.id}`, pipeline, 86400000 * 30); // 30 days
        
        logger.info(`Pipeline created: ${pipeline.name} (${pipeline.id})`);
      } catch (error) {
        logger.error(`Failed to create pipeline ${pipeline.id}:`, error);
        throw error;
      }
    });
  }

  async executePipeline(pipelineId: string, trigger: ExecutionTrigger, variables?: Record<string, string>): Promise<PipelineExecution> {
    const spanOptions: SpanOptions = {
      attributes: {
        'pipeline.id': pipelineId,
        'pipeline.trigger_type': trigger.type
      }
    };

    return this.tracing.traceAsync('execute_pipeline', spanOptions, async () => {
      try {
        const pipeline = this.pipelines.get(pipelineId);
        if (!pipeline) {
          throw new Error(`Pipeline not found: ${pipelineId}`);
        }

        // Create execution
        const execution: PipelineExecution = {
          id: this.generateExecutionId(),
          pipelineId,
          number: await this.getNextExecutionNumber(pipelineId),
          status: ExecutionStatus.QUEUED,
          trigger,
          stages: pipeline.stages.map(stage => this.createStageExecution(stage)),
          variables: { ...this.resolveVariables(pipeline.variables), ...variables },
          artifacts: [],
          metrics: {
            totalJobs: pipeline.stages.reduce((sum, stage) => sum + stage.jobs.length, 0),
            successfulJobs: 0,
            failedJobs: 0,
            testsPassed: 0,
            testsFailed: 0,
            codeCoverage: 0,
            securityIssues: 0,
            performanceScore: 0,
            costEstimate: 0
          },
          startTime: new Date()
        };

        this.executions.set(execution.id, execution);
        await this.storeExecution(execution);

        // Add to execution queue
        this.executionQueue.push(execution.id);
        
        logger.info(`Pipeline execution queued: ${pipelineId} (${execution.id})`);
        
        return execution;
      } catch (error) {
        logger.error(`Failed to execute pipeline ${pipelineId}:`, error);
        throw error;
      }
    });
  }

  async cancelExecution(executionId: string): Promise<void> {
    try {
      const execution = this.executions.get(executionId);
      if (!execution) {
        throw new Error(`Execution not found: ${executionId}`);
      }

      if (execution.status === ExecutionStatus.RUNNING) {
        // Cancel running jobs
        for (const stage of execution.stages) {
          for (const job of stage.jobs) {
            if (job.status === ExecutionStatus.RUNNING) {
              await this.cancelJob(job);
            }
          }
        }
      }

      execution.status = ExecutionStatus.CANCELLED;
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      await this.storeExecution(execution);
      
      logger.info(`Pipeline execution cancelled: ${executionId}`);
    } catch (error) {
      logger.error(`Failed to cancel execution ${executionId}:`, error);
      throw error;
    }
  }

  async getExecutionStatus(executionId: string): Promise<PipelineExecution | null> {
    try {
      let execution = this.executions.get(executionId);
      
      if (!execution) {
        // Try to load from storage
        execution = await this.redis.getObject<PipelineExecution>(`cicd:execution:${executionId}`);
        if (execution) {
          this.executions.set(executionId, execution);
        }
      }

      return execution || null;
    } catch (error) {
      logger.error(`Failed to get execution status for ${executionId}:`, error);
      return null;
    }
  }

  async getPipelineExecutions(pipelineId: string, limit: number = 50): Promise<PipelineExecution[]> {
    try {
      // Get execution IDs for this pipeline
      const executionIds = await this.redis.getList<string>(`cicd:pipeline:${pipelineId}:executions`) || [];
      
      // Load executions
      const executions: PipelineExecution[] = [];
      
      for (const executionId of executionIds.slice(-limit)) {
        const execution = await this.getExecutionStatus(executionId);
        if (execution) {
          executions.push(execution);
        }
      }
      
      return executions.sort((a, b) => b.number - a.number);
    } catch (error) {
      logger.error(`Failed to get pipeline executions for ${pipelineId}:`, error);
      return [];
    }
  }

  async createTemplate(template: PipelineTemplate): Promise<void> {
    try {
      await this.validateTemplate(template);
      
      this.templates.set(template.id, template);
      await this.redis.setObject(`cicd:template:${template.id}`, template, 86400000 * 30); // 30 days
      
      logger.info(`Pipeline template created: ${template.name} (${template.id})`);
    } catch (error) {
      logger.error(`Failed to create template ${template.id}:`, error);
      throw error;
    }
  }

  async createPipelineFromTemplate(templateId: string, parameters: Record<string, any>): Promise<Pipeline> {
    try {
      const template = this.templates.get(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Validate parameters
      await this.validateTemplateParameters(template, parameters);

      // Substitute parameters in template
      const pipeline = this.substituteTemplateParameters(template.pipeline, parameters);
      
      // Generate new ID for pipeline
      pipeline.id = this.generatePipelineId();
      pipeline.metadata.created = new Date();
      pipeline.metadata.lastModified = new Date();

      await this.createPipeline(pipeline);
      
      // Update template usage
      template.usage.count++;
      template.usage.lastUsed = new Date();
      await this.redis.setObject(`cicd:template:${templateId}`, template, 86400000 * 30);

      return pipeline;
    } catch (error) {
      logger.error(`Failed to create pipeline from template ${templateId}:`, error);
      throw error;
    }
  }

  async addDeploymentTarget(target: DeploymentTarget): Promise<void> {
    try {
      await this.validateDeploymentTarget(target);
      
      this.targets.set(target.id, target);
      await this.redis.setObject(`cicd:target:${target.id}`, target, 86400000 * 30); // 30 days
      
      logger.info(`Deployment target added: ${target.name} (${target.id})`);
    } catch (error) {
      logger.error(`Failed to add deployment target ${target.id}:`, error);
      throw error;
    }
  }

  async generateReport(pipelineId: string, timeRange: { start: Date; end: Date }): Promise<PipelineReport> {
    try {
      const executions = await this.getPipelineExecutions(pipelineId);
      const filteredExecutions = executions.filter(e => 
        e.startTime >= timeRange.start && e.startTime <= timeRange.end
      );

      const reportExecutions: ReportExecution[] = filteredExecutions.map(e => ({
        id: e.id,
        number: e.number,
        status: e.status,
        duration: e.duration || 0,
        timestamp: e.startTime,
        trigger: e.trigger
      }));

      const metrics = this.calculateReportMetrics(filteredExecutions);
      const trends = this.calculateReportTrends(filteredExecutions);
      const recommendations = this.generateRecommendations(metrics, trends);

      return {
        pipelineId,
        timeRange,
        executions: reportExecutions,
        metrics,
        trends,
        recommendations
      };
    } catch (error) {
      logger.error(`Failed to generate report for pipeline ${pipelineId}:`, error);
      throw error;
    }
  }

  private async executeStage(execution: PipelineExecution, stage: StageExecution): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'pipeline.execution_id': execution.id,
        'pipeline.stage_id': stage.stageId,
        'pipeline.stage_name': stage.name
      }
    };

    return this.tracing.traceAsync('execute_stage', spanOptions, async () => {
      try {
        stage.status = ExecutionStatus.RUNNING;
        stage.startTime = new Date();
        
        await this.storeExecution(execution);

        // Check stage conditions
        const pipeline = this.pipelines.get(execution.pipelineId)!;
        const stageDefinition = pipeline.stages.find(s => s.id === stage.stageId)!;
        
        const conditionsPass = await this.evaluateStageConditions(stageDefinition.conditions, execution);
        if (!conditionsPass) {
          stage.status = ExecutionStatus.SUCCESS; // Skip stage
          stage.endTime = new Date();
          stage.duration = stage.endTime.getTime() - stage.startTime.getTime();
          return;
        }

        // Execute jobs
        if (stageDefinition.parallelism && stageDefinition.parallelism > 1) {
          await this.executeJobsInParallel(stage.jobs, stageDefinition.parallelism);
        } else {
          await this.executeJobsSequentially(stage.jobs);
        }

        // Check if all jobs succeeded
        const allJobsSucceeded = stage.jobs.every(job => job.status === ExecutionStatus.SUCCESS);
        stage.status = allJobsSucceeded ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILURE;
        
        stage.endTime = new Date();
        stage.duration = stage.endTime.getTime() - stage.startTime.getTime();

        // Send notifications
        await this.sendStageNotifications(execution, stage, stageDefinition);

      } catch (error) {
        stage.status = ExecutionStatus.FAILURE;
        stage.endTime = new Date();
        stage.duration = stage.startTime ? stage.endTime.getTime() - stage.startTime.getTime() : 0;
        
        logger.error(`Stage execution failed: ${stage.name}`, error);
        throw error;
      }
    });
  }

  private async executeJob(job: JobExecution): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'pipeline.job_id': job.jobId,
        'pipeline.job_name': job.name,
        'pipeline.job_type': job.jobId // This should be job.type if available
      }
    };

    return this.tracing.traceAsync('execute_job', spanOptions, async () => {
      try {
        job.status = ExecutionStatus.RUNNING;
        job.startTime = new Date();
        job.logs.push(`Job started at ${job.startTime.toISOString()}`);

        // Execute job based on type
        const exitCode = await this.executeJobByType(job);
        
        job.exitCode = exitCode;
        job.status = exitCode === 0 ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILURE;
        job.endTime = new Date();
        job.duration = job.endTime.getTime() - job.startTime.getTime();

        job.logs.push(`Job completed with exit code ${exitCode} at ${job.endTime.toISOString()}`);

        // Collect artifacts
        await this.collectJobArtifacts(job);

        // Record resource usage
        job.resources = await this.collectResourceUsage(job);

      } catch (error) {
        job.status = ExecutionStatus.FAILURE;
        job.endTime = new Date();
        job.duration = job.startTime ? job.endTime.getTime() - job.startTime.getTime() : 0;
        job.logs.push(`Job failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        logger.error(`Job execution failed: ${job.name}`, error);
      }
    });
  }

  private async executeJobByType(job: JobExecution): Promise<number> {
    // Simulate job execution based on type
    // In a real implementation, this would execute actual jobs
    
    const simulatedDuration = Math.random() * 30000 + 5000; // 5-35 seconds
    await this.wait(simulatedDuration);
    
    // Simulate 90% success rate
    return Math.random() < 0.9 ? 0 : 1;
  }

  private async executeJobsSequentially(jobs: JobExecution[]): Promise<void> {
    for (const job of jobs) {
      await this.executeJob(job);
      
      if (job.status === ExecutionStatus.FAILURE) {
        // Stop execution on first failure
        break;
      }
    }
  }

  private async executeJobsInParallel(jobs: JobExecution[], parallelism: number): Promise<void> {
    const jobQueue = [...jobs];
    const runningJobs: Promise<void>[] = [];

    while (jobQueue.length > 0 || runningJobs.length > 0) {
      // Start new jobs up to parallelism limit
      while (runningJobs.length < parallelism && jobQueue.length > 0) {
        const job = jobQueue.shift()!;
        const jobPromise = this.executeJob(job);
        runningJobs.push(jobPromise);
      }

      // Wait for at least one job to complete
      if (runningJobs.length > 0) {
        await Promise.race(runningJobs);
        
        // Remove completed jobs
        for (let i = runningJobs.length - 1; i >= 0; i--) {
          const isSettled = await Promise.allSettled([runningJobs[i]]);
          if (isSettled[0].status === 'fulfilled' || isSettled[0].status === 'rejected') {
            runningJobs.splice(i, 1);
          }
        }
      }
    }
  }

  private async evaluateStageConditions(conditions: StageCondition[], execution: PipelineExecution): Promise<boolean> {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition, execution);
      if (condition.required && !result) {
        return false;
      }
    }

    return true;
  }

  private async evaluateCondition(condition: StageCondition, execution: PipelineExecution): Promise<boolean> {
    switch (condition.type) {
      case 'variable':
        return this.evaluateVariableCondition(condition.condition, execution.variables);
      case 'expression':
        return this.evaluateExpression(condition.condition, execution);
      case 'manual_approval':
        return await this.checkManualApproval(execution.id);
      case 'external_check':
        return await this.performExternalCheck(condition.condition);
      default:
        return true;
    }
  }

  private evaluateVariableCondition(condition: string, variables: Record<string, string>): boolean {
    // Simple variable condition evaluation
    // Format: "variable_name=value" or "variable_name!=value"
    const [left, operator, right] = condition.split(/([=!]=?)/);
    const value = variables[left.trim()];
    const expected = right.trim();

    switch (operator) {
      case '=':
      case '==':
        return value === expected;
      case '!=':
        return value !== expected;
      default:
        return false;
    }
  }

  private evaluateExpression(expression: string, execution: PipelineExecution): boolean {
    // Simplified expression evaluation
    // In a real implementation, you would use a proper expression parser
    return true;
  }

  private async checkManualApproval(executionId: string): Promise<boolean> {
    // Check if manual approval has been granted
    const approval = await this.redis.get(`cicd:approval:${executionId}`);
    return approval === 'approved';
  }

  private async performExternalCheck(checkUrl: string): Promise<boolean> {
    // Perform external API check
    // This is a simplified implementation
    return true;
  }

  private createStageExecution(stage: PipelineStage): StageExecution {
    return {
      id: this.generateStageExecutionId(),
      stageId: stage.id,
      name: stage.name,
      status: ExecutionStatus.QUEUED,
      jobs: stage.jobs.map(job => this.createJobExecution(job)),
      logs: [],
      artifacts: []
    };
  }

  private createJobExecution(job: PipelineJob): JobExecution {
    return {
      id: this.generateJobExecutionId(),
      jobId: job.id,
      name: job.name,
      status: ExecutionStatus.QUEUED,
      logs: [],
      artifacts: [],
      retryCount: 0,
      resources: {
        cpu: 0,
        memory: 0,
        storage: 0,
        networkIn: 0,
        networkOut: 0
      }
    };
  }

  private resolveVariables(variables: PipelineVariable[]): Record<string, string> {
    const resolved: Record<string, string> = {};
    
    for (const variable of variables) {
      resolved[variable.name] = variable.value;
    }
    
    return resolved;
  }

  private async collectJobArtifacts(job: JobExecution): Promise<void> {
    // Simulate artifact collection
    // In a real implementation, this would collect actual artifacts
    logger.debug(`Collecting artifacts for job: ${job.name}`);
  }

  private async collectResourceUsage(job: JobExecution): Promise<ResourceUsage> {
    // Simulate resource usage collection
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 1024,
      storage: Math.random() * 10,
      networkIn: Math.random() * 100,
      networkOut: Math.random() * 50
    };
  }

  private async cancelJob(job: JobExecution): Promise<void> {
    job.status = ExecutionStatus.CANCELLED;
    job.endTime = new Date();
    job.duration = job.startTime ? job.endTime.getTime() - job.startTime.getTime() : 0;
    job.logs.push(`Job cancelled at ${job.endTime.toISOString()}`);
  }

  private async sendStageNotifications(execution: PipelineExecution, stage: StageExecution, stageDefinition: PipelineStage): Promise<void> {
    // Send notifications based on stage configuration
    for (const notification of stageDefinition.configuration.notifications) {
      const event = stage.status === ExecutionStatus.SUCCESS ? NotificationEvent.STAGE_SUCCESS : NotificationEvent.STAGE_FAILURE;
      
      if (notification.events.includes(event)) {
        await this.sendNotification(notification, execution, stage);
      }
    }
  }

  private async sendNotification(config: NotificationConfig, execution: PipelineExecution, stage?: StageExecution): Promise<void> {
    try {
      const message = this.buildNotificationMessage(config, execution, stage);
      
      switch (config.type) {
        case 'email':
          await this.sendEmailNotification(config, message);
          break;
        case 'slack':
          await this.sendSlackNotification(config, message);
          break;
        case 'webhook':
          await this.sendWebhookNotification(config, message);
          break;
        default:
          logger.warn(`Unsupported notification type: ${config.type}`);
      }
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  private buildNotificationMessage(config: NotificationConfig, execution: PipelineExecution, stage?: StageExecution): string {
    const pipeline = this.pipelines.get(execution.pipelineId);
    const pipelineName = pipeline?.name || execution.pipelineId;
    
    if (stage) {
      return `Stage "${stage.name}" in pipeline "${pipelineName}" has ${stage.status}`;
    } else {
      return `Pipeline "${pipelineName}" has ${execution.status}`;
    }
  }

  private async sendEmailNotification(config: NotificationConfig, message: string): Promise<void> {
    // Implement email notification
    logger.debug('Sending email notification:', { recipients: config.recipients, message });
  }

  private async sendSlackNotification(config: NotificationConfig, message: string): Promise<void> {
    // Implement Slack notification
    logger.debug('Sending Slack notification:', { recipients: config.recipients, message });
  }

  private async sendWebhookNotification(config: NotificationConfig, message: string): Promise<void> {
    // Implement webhook notification
    logger.debug('Sending webhook notification:', { message });
  }

  private calculateReportMetrics(executions: PipelineExecution[]): ReportMetrics {
    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.status === ExecutionStatus.SUCCESS).length;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;
    
    const durations = executions.filter(e => e.duration).map(e => e.duration!);
    const avgDuration = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;
    
    // Calculate other metrics...
    
    return {
      totalExecutions,
      successRate,
      avgDuration,
      avgCost: 0, // Would calculate based on actual costs
      totalCost: 0,
      failureReasons: [],
      stageMetrics: []
    };
  }

  private calculateReportTrends(executions: PipelineExecution[]): ReportTrend[] {
    // Calculate trends based on execution history
    return [
      {
        metric: 'success_rate',
        trend: 'stable',
        change: 0,
        period: '7d'
      }
    ];
  }

  private generateRecommendations(metrics: ReportMetrics, trends: ReportTrend[]): string[] {
    const recommendations: string[] = [];
    
    if (metrics.successRate < 80) {
      recommendations.push('Consider improving pipeline stability - success rate is below 80%');
    }
    
    if (metrics.avgDuration > 3600000) { // 1 hour
      recommendations.push('Pipeline duration is high - consider optimizing job execution');
    }
    
    return recommendations;
  }

  private async startWorkers(): Promise<void> {
    // Start worker processes to execute pipelines
    for (let i = 0; i < this.maxConcurrentExecutions; i++) {
      const worker = setInterval(async () => {
        await this.processExecutionQueue();
      }, 5000); // Check every 5 seconds
      
      this.workers.add(worker);
    }
  }

  private async processExecutionQueue(): Promise<void> {
    if (this.executionQueue.length === 0) {
      return;
    }

    const executionId = this.executionQueue.shift()!;
    const execution = this.executions.get(executionId);
    
    if (!execution || execution.status !== ExecutionStatus.QUEUED) {
      return;
    }

    try {
      execution.status = ExecutionStatus.RUNNING;
      await this.storeExecution(execution);

      const pipeline = this.pipelines.get(execution.pipelineId)!;
      
      // Execute stages in dependency order
      const sortedStages = this.topologicalSort(pipeline.stages);
      
      for (const stageId of sortedStages) {
        const stageExecution = execution.stages.find(s => s.stageId === stageId)!;
        
        await this.executeStage(execution, stageExecution);
        
        if (stageExecution.status === ExecutionStatus.FAILURE) {
          execution.status = ExecutionStatus.FAILURE;
          break;
        }
      }

      if (execution.status === ExecutionStatus.RUNNING) {
        execution.status = ExecutionStatus.SUCCESS;
      }

      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      await this.storeExecution(execution);

      logger.info(`Pipeline execution completed: ${executionId} (${execution.status})`);

    } catch (error) {
      execution.status = ExecutionStatus.FAILURE;
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      
      await this.storeExecution(execution);
      
      logger.error(`Pipeline execution failed: ${executionId}`, error);
    }
  }

  private topologicalSort(stages: PipelineStage[]): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    
    const visit = (stageId: string) => {
      if (visited.has(stageId)) return;
      
      const stage = stages.find(s => s.id === stageId);
      if (!stage) return;
      
      for (const dependency of stage.dependsOn) {
        visit(dependency);
      }
      
      visited.add(stageId);
      result.push(stageId);
    };
    
    for (const stage of stages) {
      visit(stage.id);
    }
    
    return result;
  }

  private async validatePipeline(pipeline: Pipeline): Promise<void> {
    if (!pipeline.id || !pipeline.name || pipeline.stages.length === 0) {
      throw new Error('Pipeline ID, name, and stages are required');
    }
    
    // Validate stage dependencies
    const stageIds = new Set(pipeline.stages.map(s => s.id));
    for (const stage of pipeline.stages) {
      for (const dependency of stage.dependsOn) {
        if (!stageIds.has(dependency)) {
          throw new Error(`Invalid stage dependency: ${dependency}`);
        }
      }
    }
  }

  private async validateTemplate(template: PipelineTemplate): Promise<void> {
    if (!template.id || !template.name || !template.pipeline) {
      throw new Error('Template ID, name, and pipeline are required');
    }
  }

  private async validateTemplateParameters(template: PipelineTemplate, parameters: Record<string, any>): Promise<void> {
    for (const param of template.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Required parameter missing: ${param.name}`);
      }
    }
  }

  private substituteTemplateParameters(pipeline: Pipeline, parameters: Record<string, any>): Pipeline {
    // Deep clone and substitute parameters
    const pipelineJson = JSON.stringify(pipeline);
    let substituted = pipelineJson;
    
    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = `{{${key}}}`;
      substituted = substituted.replace(new RegExp(placeholder, 'g'), JSON.stringify(value));
    }
    
    return JSON.parse(substituted);
  }

  private async validateDeploymentTarget(target: DeploymentTarget): Promise<void> {
    if (!target.id || !target.name || !target.configuration.endpoint) {
      throw new Error('Target ID, name, and endpoint are required');
    }
  }

  private async storeExecution(execution: PipelineExecution): Promise<void> {
    await this.redis.setObject(`cicd:execution:${execution.id}`, execution, 86400000 * 7); // 7 days
    
    // Add to pipeline execution list
    await this.redis.listPush(`cicd:pipeline:${execution.pipelineId}:executions`, execution.id);
  }

  private async getNextExecutionNumber(pipelineId: string): Promise<number> {
    const executions = await this.getPipelineExecutions(pipelineId);
    return executions.length > 0 ? Math.max(...executions.map(e => e.number)) + 1 : 1;
  }

  private async loadPipelines(): Promise<void> {
    // Load pipelines from Redis
    logger.info('Loading CI/CD pipelines');
  }

  private async loadTemplates(): Promise<void> {
    // Load templates from Redis
    logger.info('Loading pipeline templates');
  }

  private async loadDeploymentTargets(): Promise<void> {
    // Load deployment targets from Redis
    logger.info('Loading deployment targets');
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateStageExecutionId(): string {
    return `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateJobExecutionId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePipelineId(): string {
    return `pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    // Stop all workers
    for (const worker of this.workers) {
      clearInterval(worker);
    }
    this.workers.clear();
    
    // Cancel any running executions
    for (const execution of this.executions.values()) {
      if (execution.status === ExecutionStatus.RUNNING) {
        await this.cancelExecution(execution.id);
      }
    }
    
    logger.info('PipelineOrchestrator shutdown completed');
  }
}