import { AsyncSingletonService } from '@/infrastructure/core/SingletonService.js';
import { KafkaEventStream, type StreamEvent } from '@/infrastructure/streaming/KafkaEventStream.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { logger } from '@/logger.js';
import { ErrorHandler } from '@/infrastructure/core/ErrorHandler';
import { nanoid } from 'nanoid';
import { OpenAI } from 'openai';

export interface AIWorkflow {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: AIWorkflowStep[];
  config: {
    timeout: number; // milliseconds
    retryAttempts: number;
    parallelExecution: boolean;
    errorHandling: 'fail-fast' | 'continue' | 'retry';
  };
  triggers: AIWorkflowTrigger[];
  metadata: Record<string, any>;
}

export interface AIWorkflowStep {
  id: string;
  name: string;
  type: 'llm' | 'embedding' | 'vector-search' | 'classification' | 'data-extraction' | 'custom';
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  config: Record<string, any>;
  inputs: AIWorkflowInput[];
  outputs: AIWorkflowOutput[];
  conditions?: AIWorkflowCondition[];
  dependencies?: string[]; // step IDs this step depends on
  timeout?: number;
  retryConfig?: {
    attempts: number;
    backoffMultiplier: number;
    maxDelay: number;
  };
}

export interface AIWorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  source: 'context' | 'previous-step' | 'static' | 'user-input';
  value?: any;
  required: boolean;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: any[];
  };
}

export interface AIWorkflowOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  schema?: Record<string, any>;
}

export interface AIWorkflowCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'matches';
  value: any;
  action: 'skip' | 'fail' | 'retry' | 'goto';
  target?: string; // step ID for 'goto' action
}

export interface AIWorkflowTrigger {
  type: 'event' | 'schedule' | 'manual' | 'webhook';
  config: Record<string, any>;
  enabled: boolean;
}

export interface AIWorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  context: Record<string, any>;
  results: Map<string, any>; // step results
  errors: AIWorkflowError[];
  startedAt: Date;
  completedAt?: Date;
  executionTime?: number;
  triggeredBy: {
    type: string;
    userId?: string;
    eventId?: string;
  };
  metrics: {
    stepsCompleted: number;
    stepsTotal: number;
    tokensUsed: number;
    cost: number;
  };
}

export interface AIWorkflowError {
  stepId: string;
  stepName: string;
  error: string;
  timestamp: Date;
  attempt: number;
  recoverable: boolean;
}

// AI Provider interfaces
export interface AIProvider {
  name: string;
  type: string;
  isAvailable(): Promise<boolean>;
  executeStep(step: AIWorkflowStep, inputs: Record<string, any>): Promise<any>;
  estimateCost(step: AIWorkflowStep, inputs: Record<string, any>): number;
  getCapabilities(): string[];
}

// OpenAI Provider implementation
class OpenAIProvider implements AIProvider {
  name = 'openai';
  type = 'llm';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async executeStep(step: AIWorkflowStep, inputs: Record<string, any>): Promise<any> {
    switch (step.type) {
      case 'llm':
        return this.executeLLMStep(step, inputs);
      case 'embedding':
        return this.executeEmbeddingStep(step, inputs);
      case 'classification':
        return this.executeClassificationStep(step, inputs);
      default:
        throw new Error(`Unsupported step type: ${step.type}`);
    }
  }

  private async executeLLMStep(step: AIWorkflowStep, inputs: Record<string, any>): Promise<any> {
    const { model = 'gpt-4', temperature = 0.7, maxTokens = 1000, systemPrompt } = step.config;
    
    const messages: any[] = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({
      role: 'user',
      content: this.interpolateTemplate(step.config.prompt || '', inputs),
    });

    const response = await this.client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: step.config.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });

    const result = response.choices[0]?.message?.content || '';
    
    if (step.config.responseFormat === 'json') {
      try {
        return JSON.parse(result);
      } catch {
        throw new Error('Invalid JSON response from LLM');
      }
    }

    return result;
  }

  private async executeEmbeddingStep(step: AIWorkflowStep, inputs: Record<string, any>): Promise<any> {
    const { model = 'text-embedding-3-small' } = step.config;
    const text = inputs.text || '';

    const response = await this.client.embeddings.create({
      model,
      input: text,
    });

    return {
      embedding: response.data[0].embedding,
      dimensions: response.data[0].embedding.length,
    };
  }

  private async executeClassificationStep(step: AIWorkflowStep, inputs: Record<string, any>): Promise<any> {
    const { categories, model = 'gpt-4' } = step.config;
    const text = inputs.text || '';

    const systemPrompt = `You are a text classifier. Classify the following text into one of these categories: ${categories.join(', ')}. Respond with only the category name.`;

    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 50,
    });

    const category = response.choices[0]?.message?.content?.trim() || '';
    
    return {
      category,
      confidence: categories.includes(category) ? 0.9 : 0.1,
    };
  }

  estimateCost(step: AIWorkflowStep, inputs: Record<string, any>): number {
    // Simplified cost estimation - in practice, this would be more sophisticated
    const inputTokens = JSON.stringify(inputs).length / 4; // rough token estimation
    
    switch (step.type) {
      case 'llm':
        return inputTokens * 0.00003; // $0.03 per 1K tokens for GPT-4
      case 'embedding':
        return inputTokens * 0.0000001; // $0.0001 per 1K tokens for embeddings
      default:
        return 0;
    }
  }

  getCapabilities(): string[] {
    return ['llm', 'embedding', 'classification', 'data-extraction'];
  }

  private interpolateTemplate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(context, path);
      return value !== undefined ? String(value) : match;
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

export class AdvancedAIOrchestrator extends AsyncSingletonService<AdvancedAIOrchestrator> {
  private workflows: Map<string, AIWorkflow> = new Map();
  private executions: Map<string, AIWorkflowExecution> = new Map();
  private providers: Map<string, AIProvider> = new Map();
  private eventStream: KafkaEventStream | null = null;
  private redis: RedisClusterManager | null = null;
  private errorHandler = ErrorHandler.getInstance();
  private schedulerRunning = false;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<AdvancedAIOrchestrator> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing Advanced AI Orchestrator...');
      
      this.eventStream = await KafkaEventStream.getInstance();
      this.redis = await RedisClusterManager.getInstance();
      
      // Initialize AI providers
      await this.initializeProviders();
      
      // Load existing workflows
      await this.loadWorkflows();
      
      // Start event consumer
      await this.startEventConsumer();
      
      // Start execution scheduler
      await this.startScheduler();
      
      logger.info('Advanced AI Orchestrator initialized');
    } catch (error) {
      logger.error('Failed to initialize Advanced AI Orchestrator', error);
      throw error;
    }
  }

  async registerWorkflow(workflow: AIWorkflow): Promise<void> {
    logger.info('Registering AI workflow', {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
      stepsCount: workflow.steps.length,
    });

    // Validate workflow
    this.validateWorkflow(workflow);

    this.workflows.set(workflow.id, workflow);
    
    // Persist workflow
    await this.redis!.set(
      `ai:workflow:${workflow.id}`,
      JSON.stringify(workflow),
      24 * 60 * 60 // 24 hours TTL
    );

    logger.info('AI workflow registered', { id: workflow.id });
  }

  async executeWorkflow(
    workflowId: string,
    context: Record<string, any> = {},
    triggeredBy: { type: string; userId?: string; eventId?: string }
  ): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const execution: AIWorkflowExecution = {
      id: nanoid(),
      workflowId,
      status: 'pending',
      context,
      results: new Map(),
      errors: [],
      startedAt: new Date(),
      triggeredBy,
      metrics: {
        stepsCompleted: 0,
        stepsTotal: workflow.steps.length,
        tokensUsed: 0,
        cost: 0,
      },
    };

    this.executions.set(execution.id, execution);

    // Store execution
    await this.redis!.set(
      `ai:execution:${execution.id}`,
      JSON.stringify(this.serializeExecution(execution)),
      60 * 60 // 1 hour TTL
    );

    // Start execution asynchronously
    this.runWorkflow(execution).catch(error => {
      logger.error('Workflow execution failed', {
        executionId: execution.id,
        workflowId,
        error,
      });
    });

    logger.info('AI workflow execution started', {
      executionId: execution.id,
      workflowId,
    });

    return execution.id;
  }

  async getExecution(executionId: string): Promise<AIWorkflowExecution | null> {
    let execution = this.executions.get(executionId);
    
    if (!execution) {
      const cached = await this.redis!.get(`ai:execution:${executionId}`);
      if (cached) {
        execution = this.deserializeExecution(JSON.parse(cached));
        this.executions.set(executionId, execution);
      }
    }
    
    return execution || null;
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status === 'running') {
      execution.status = 'cancelled';
      execution.completedAt = new Date();
      execution.executionTime = execution.completedAt.getTime() - execution.startedAt.getTime();

      await this.updateExecution(execution);
      
      logger.info('AI workflow execution cancelled', { executionId });
    }
  }

  async getWorkflowStats(): Promise<Array<{
    workflowId: string;
    name: string;
    executions: number;
    successRate: number;
    averageExecutionTime: number;
    totalCost: number;
  }>> {
    const stats = [];

    for (const [workflowId, workflow] of this.workflows) {
      const executionKeys = await this.redis!.scan(`ai:execution:*`);
      const executions = await Promise.all(
        executionKeys.map(async key => {
          const data = await this.redis!.get(key);
          return data ? JSON.parse(data) : null;
        })
      );

      const workflowExecutions = executions
        .filter(e => e && e.workflowId === workflowId);

      const successful = workflowExecutions
        .filter(e => e.status === 'completed').length;

      const totalTime = workflowExecutions
        .filter(e => e.executionTime)
        .reduce((sum, e) => sum + e.executionTime, 0);

      const totalCost = workflowExecutions
        .reduce((sum, e) => sum + (e.metrics?.cost || 0), 0);

      stats.push({
        workflowId,
        name: workflow.name,
        executions: workflowExecutions.length,
        successRate: workflowExecutions.length > 0 ? (successful / workflowExecutions.length) * 100 : 0,
        averageExecutionTime: workflowExecutions.length > 0 ? totalTime / workflowExecutions.length : 0,
        totalCost,
      });
    }

    return stats;
  }

  private async runWorkflow(execution: AIWorkflowExecution): Promise<void> {
    const workflow = this.workflows.get(execution.workflowId)!;
    
    try {
      execution.status = 'running';
      await this.updateExecution(execution);

      // Build dependency graph
      const dependencyGraph = this.buildDependencyGraph(workflow.steps);
      
      // Execute steps based on dependencies
      if (workflow.config.parallelExecution) {
        await this.executeStepsParallel(workflow, execution, dependencyGraph);
      } else {
        await this.executeStepsSequential(workflow, execution, dependencyGraph);
      }

      execution.status = 'completed';
      execution.completedAt = new Date();
      execution.executionTime = execution.completedAt.getTime() - execution.startedAt.getTime();

      logger.info('AI workflow execution completed', {
        executionId: execution.id,
        executionTime: execution.executionTime,
        cost: execution.metrics.cost,
      });
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.executionTime = execution.completedAt.getTime() - execution.startedAt.getTime();
      
      execution.errors.push({
        stepId: 'workflow',
        stepName: 'workflow',
        error: error.message,
        timestamp: new Date(),
        attempt: 1,
        recoverable: false,
      });

      logger.error('AI workflow execution failed', {
        executionId: execution.id,
        error: error.message,
      });
    }

    await this.updateExecution(execution);
  }

  private async executeStepsSequential(
    workflow: AIWorkflow,
    execution: AIWorkflowExecution,
    dependencyGraph: Map<string, string[]>
  ): Promise<void> {
    const completedSteps = new Set<string>();
    
    for (const step of this.topologicalSort(workflow.steps, dependencyGraph)) {
      if (execution.status === 'cancelled') {
        break;
      }

      // Check if dependencies are met
      const dependencies = dependencyGraph.get(step.id) || [];
      if (!dependencies.every(dep => completedSteps.has(dep))) {
        throw new Error(`Dependencies not met for step ${step.id}`);
      }

      await this.executeStep(workflow, execution, step);
      completedSteps.add(step.id);
      execution.metrics.stepsCompleted++;
    }
  }

  private async executeStepsParallel(
    workflow: AIWorkflow,
    execution: AIWorkflowExecution,
    dependencyGraph: Map<string, string[]>
  ): Promise<void> {
    const completedSteps = new Set<string>();
    const runningSteps = new Set<string>();
    const stepPromises = new Map<string, Promise<void>>();

    const executeStepWithDependencies = async (step: AIWorkflowStep): Promise<void> => {
      const dependencies = dependencyGraph.get(step.id) || [];
      
      // Wait for dependencies
      await Promise.all(
        dependencies.map(depId => stepPromises.get(depId) || Promise.resolve())
      );

      if (execution.status === 'cancelled') {
        return;
      }

      runningSteps.add(step.id);
      await this.executeStep(workflow, execution, step);
      runningSteps.delete(step.id);
      completedSteps.add(step.id);
      execution.metrics.stepsCompleted++;
    };

    // Start all steps
    for (const step of workflow.steps) {
      stepPromises.set(step.id, executeStepWithDependencies(step));
    }

    // Wait for all steps to complete
    await Promise.all(Array.from(stepPromises.values()));
  }

  private async executeStep(
    workflow: AIWorkflow,
    execution: AIWorkflowExecution,
    step: AIWorkflowStep
  ): Promise<void> {
    const maxAttempts = step.retryConfig?.attempts || workflow.config.retryAttempts || 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        attempt++;
        
        // Prepare inputs
        const inputs = await this.prepareStepInputs(step, execution);
        
        // Check conditions
        if (step.conditions && !this.evaluateConditions(step.conditions, inputs)) {
          logger.debug('Step conditions not met, skipping', {
            stepId: step.id,
            executionId: execution.id,
          });
          return;
        }

        // Get provider
        const provider = this.providers.get(step.provider);
        if (!provider) {
          throw new Error(`Provider ${step.provider} not found`);
        }

        // Estimate cost
        const estimatedCost = provider.estimateCost(step, inputs);
        execution.metrics.cost += estimatedCost;

        // Execute step
        const startTime = Date.now();
        const result = await Promise.race([
          provider.executeStep(step, inputs),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Step timeout')), step.timeout || workflow.config.timeout)
          ),
        ]);
        const executionTime = Date.now() - startTime;

        // Store result
        execution.results.set(step.id, result);

        logger.debug('AI workflow step completed', {
          stepId: step.id,
          stepName: step.name,
          executionId: execution.id,
          executionTime,
          cost: estimatedCost,
        });

        return; // Success, exit retry loop
      } catch (error) {
        const workflowError: AIWorkflowError = {
          stepId: step.id,
          stepName: step.name,
          error: error.message,
          timestamp: new Date(),
          attempt,
          recoverable: attempt < maxAttempts,
        };

        execution.errors.push(workflowError);

        if (attempt >= maxAttempts) {
          if (workflow.config.errorHandling === 'fail-fast') {
            throw error;
          } else if (workflow.config.errorHandling === 'continue') {
            logger.warn('Step failed but continuing workflow', {
              stepId: step.id,
              executionId: execution.id,
              error: error.message,
            });
            return;
          }
        }

        // Wait before retry
        if (attempt < maxAttempts && step.retryConfig) {
          const delay = Math.min(
            step.retryConfig.backoffMultiplier ** attempt * 1000,
            step.retryConfig.maxDelay || 30000
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  private async prepareStepInputs(
    step: AIWorkflowStep,
    execution: AIWorkflowExecution
  ): Promise<Record<string, any>> {
    const inputs: Record<string, any> = {};

    for (const input of step.inputs) {
      let value: any;

      switch (input.source) {
        case 'context':
          value = execution.context[input.name];
          break;
        case 'previous-step':
          const [stepId, outputName] = input.name.split('.');
          const stepResult = execution.results.get(stepId);
          value = outputName ? stepResult?.[outputName] : stepResult;
          break;
        case 'static':
          value = input.value;
          break;
        case 'user-input':
          value = execution.context[`user_input_${input.name}`];
          break;
      }

      if (input.required && value === undefined) {
        throw new Error(`Required input ${input.name} not provided for step ${step.id}`);
      }

      // Validate input
      if (value !== undefined && input.validation) {
        this.validateInput(value, input);
      }

      inputs[input.name] = value;
    }

    return inputs;
  }

  private validateInput(value: any, input: AIWorkflowInput): void {
    const { validation } = input;
    if (!validation) return;

    if (input.type === 'string' && typeof value === 'string') {
      if (validation.minLength && value.length < validation.minLength) {
        throw new Error(`Input ${input.name} too short`);
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        throw new Error(`Input ${input.name} too long`);
      }
      if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
        throw new Error(`Input ${input.name} doesn't match pattern`);
      }
    }

    if (validation.enum && !validation.enum.includes(value)) {
      throw new Error(`Input ${input.name} not in allowed values`);
    }
  }

  private evaluateConditions(conditions: AIWorkflowCondition[], inputs: Record<string, any>): boolean {
    return conditions.every(condition => {
      const value = inputs[condition.field];
      
      switch (condition.operator) {
        case 'eq':
          return value === condition.value;
        case 'ne':
          return value !== condition.value;
        case 'gt':
          return value > condition.value;
        case 'gte':
          return value >= condition.value;
        case 'lt':
          return value < condition.value;
        case 'lte':
          return value <= condition.value;
        case 'contains':
          return typeof value === 'string' && value.includes(condition.value);
        case 'matches':
          return typeof value === 'string' && new RegExp(condition.value).test(value);
        default:
          return true;
      }
    });
  }

  private buildDependencyGraph(steps: AIWorkflowStep[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    for (const step of steps) {
      graph.set(step.id, step.dependencies || []);
    }
    
    return graph;
  }

  private topologicalSort(steps: AIWorkflowStep[], dependencyGraph: Map<string, string[]>): AIWorkflowStep[] {
    const visited = new Set<string>();
    const result: AIWorkflowStep[] = [];
    const stepMap = new Map(steps.map(step => [step.id, step]));

    const visit = (stepId: string): void => {
      if (visited.has(stepId)) return;
      
      const dependencies = dependencyGraph.get(stepId) || [];
      dependencies.forEach(visit);
      
      visited.add(stepId);
      const step = stepMap.get(stepId);
      if (step) {
        result.push(step);
      }
    };

    steps.forEach(step => visit(step.id));
    return result;
  }

  private validateWorkflow(workflow: AIWorkflow): void {
    if (!workflow.id || !workflow.name || !workflow.steps.length) {
      throw new Error('Invalid workflow: missing required fields');
    }

    // Check for circular dependencies
    const dependencyGraph = this.buildDependencyGraph(workflow.steps);
    this.detectCircularDependencies(dependencyGraph);

    // Validate each step
    for (const step of workflow.steps) {
      if (!step.id || !step.name || !step.type) {
        throw new Error(`Invalid step: ${step.id}`);
      }

      const provider = this.providers.get(step.provider);
      if (!provider) {
        throw new Error(`Provider ${step.provider} not found for step ${step.id}`);
      }

      if (!provider.getCapabilities().includes(step.type)) {
        throw new Error(`Provider ${step.provider} doesn't support step type ${step.type}`);
      }
    }
  }

  private detectCircularDependencies(dependencyGraph: Map<string, string[]>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const dependencies = dependencyGraph.get(nodeId) || [];
      for (const depId of dependencies) {
        if (hasCycle(depId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of dependencyGraph.keys()) {
      if (hasCycle(nodeId)) {
        throw new Error('Circular dependency detected in workflow');
      }
    }
  }

  private async initializeProviders(): Promise<void> {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      const openaiProvider = new OpenAIProvider(openaiApiKey);
      if (await openaiProvider.isAvailable()) {
        this.providers.set('openai', openaiProvider);
        logger.info('OpenAI provider initialized');
      }
    }

    logger.info('AI providers initialized', {
      providers: Array.from(this.providers.keys()),
    });
  }

  private async loadWorkflows(): Promise<void> {
    try {
      const workflowKeys = await this.redis!.scan('ai:workflow:*');
      
      for (const key of workflowKeys) {
        const workflowData = await this.redis!.get(key);
        if (workflowData) {
          const workflow: AIWorkflow = JSON.parse(workflowData);
          this.workflows.set(workflow.id, workflow);
        }
      }

      logger.debug('AI workflows loaded', { count: this.workflows.size });
    } catch (error) {
      logger.error('Failed to load AI workflows', error);
    }
  }

  private async startEventConsumer(): Promise<void> {
    // Implementation for consuming events that trigger workflows
    // This would listen for events and execute matching workflows
  }

  private async startScheduler(): Promise<void> {
    // Implementation for scheduled workflow execution
    // This would handle cron-like scheduling for workflows
  }

  private async updateExecution(execution: AIWorkflowExecution): Promise<void> {
    await this.redis!.set(
      `ai:execution:${execution.id}`,
      JSON.stringify(this.serializeExecution(execution)),
      60 * 60 // 1 hour TTL
    );
  }

  private serializeExecution(execution: AIWorkflowExecution): any {
    return {
      ...execution,
      results: Object.fromEntries(execution.results),
    };
  }

  private deserializeExecution(data: any): AIWorkflowExecution {
    return {
      ...data,
      results: new Map(Object.entries(data.results || {})),
    };
  }
}