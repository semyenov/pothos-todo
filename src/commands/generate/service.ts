import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export default class GenerateService extends Command {
  static override description = 'Generate service classes with different patterns and types';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --name EmailService --type infrastructure --singleton',
    '<%= config.bin %> <%= command.id %> --name ProductService --type application --interface',
    '<%= config.bin %> <%= command.id %> --name OrderDomainService --type domain',
    '<%= config.bin %> <%= command.id %> --name ImageAnalysisService --type ai --singleton --interface',
  ];

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'Service name (should end with "Service")',
      required: true,
    }),
    type: Flags.string({
      char: 't',
      description: 'Service type',
      options: ['application', 'domain', 'infrastructure', 'ai'],
      required: true,
    }),
    singleton: Flags.boolean({
      char: 's',
      description: 'Use singleton pattern',
      default: false,
    }),
    interface: Flags.boolean({
      char: 'i',
      description: 'Generate interface/contract',
      default: true,
    }),
    async: Flags.boolean({
      char: 'a',
      description: 'Use async initialization pattern',
      default: false,
    }),
    cache: Flags.boolean({
      char: 'c',
      description: 'Include caching capabilities',
      default: false,
    }),
    events: Flags.boolean({
      char: 'e',
      description: 'Include event emission capabilities',
      default: false,
    }),
    path: Flags.string({
      char: 'p',
      description: 'Custom output path',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateService);
    
    // Validate service name
    if (!flags.name.endsWith('Service')) {
      this.log(chalk.yellow('⚠️  Service name should end with "Service"'));
      flags.name += 'Service';
    }
    
    if (!/^[A-Z][a-zA-Z0-9]*Service$/.test(flags.name)) {
      this.log(chalk.red('❌ Service name must be PascalCase and end with "Service"'));
      process.exit(1);
    }

    this.log(chalk.blue(`⚡ Generating ${flags.type} service: ${flags.name}`));
    
    const outputPath = flags.path || this.getDefaultPath(flags.type);
    
    try {
      // Generate interface if requested
      if (flags.interface) {
        await this.generateServiceInterface(flags, outputPath);
      }
      
      // Generate service implementation
      await this.generateServiceImplementation(flags, outputPath);
      
      // Generate test file
      await this.generateServiceTests(flags);

      this.log(chalk.green(`✅ Successfully generated ${flags.type} service: ${flags.name}`));

    } catch (error) {
      this.log(chalk.red('❌ Service generation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private getDefaultPath(type: string): string {
    switch (type) {
      case 'application':
        return 'src/application/services';
      case 'domain':
        return 'src/domain/services';
      case 'infrastructure':
        return 'src/infrastructure/services';
      case 'ai':
        return 'src/infrastructure/ai';
      default:
        return 'src/services';
    }
  }

  private async generateServiceInterface(flags: any, outputPath: string): Promise<void> {
    const interfaceName = `I${flags.name}`;
    const interfacePath = join(outputPath, 'interfaces', `${interfaceName}.ts`);
    const content = this.generateInterfaceContent(flags);
    
    await this.writeFileWithDirectories(interfacePath, content);
    this.log(chalk.green(`📄 Generated interface: ${interfacePath}`));
  }

  private async generateServiceImplementation(flags: any, outputPath: string): Promise<void> {
    const servicePath = join(outputPath, `${flags.name}.ts`);
    const content = this.generateServiceContent(flags);
    
    await this.writeFileWithDirectories(servicePath, content);
    this.log(chalk.green(`📄 Generated service: ${servicePath}`));
  }

  private async generateServiceTests(flags: any): Promise<void> {
    const testPath = join('src/tests', flags.type, `${flags.name}.test.ts`);
    const content = this.generateTestContent(flags);
    
    await this.writeFileWithDirectories(testPath, content);
    this.log(chalk.green(`📄 Generated tests: ${testPath}`));
  }

  private generateInterfaceContent(flags: any): string {
    const interfaceName = `I${flags.name}`;
    const methods = this.generateInterfaceMethods(flags);
    
    const cacheMethod = flags.cache ? `
  clearCache(): Promise<void>;` : '';
    
    const eventMethod = flags.events ? `
  on(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;` : '';

    return `${this.generateImports(flags, true)}

export interface ${interfaceName} {${methods}${cacheMethod}${eventMethod}
}

${this.generateTypeDefinitions(flags)}
`;
  }

  private generateServiceContent(flags: any): string {
    const serviceName = flags.name;
    const interfaceImport = flags.interface ? `\nimport { I${serviceName} } from './interfaces/I${serviceName}.js';` : '';
    const baseClass = this.getBaseClass(flags);
    const implements = flags.interface ? ` implements I${serviceName}` : '';
    
    return `${this.generateImports(flags)}${interfaceImport}

export class ${serviceName}${baseClass}${implements} {
${this.generateConstructor(flags)}
${this.generateMethods(flags)}
${this.generateCacheMethods(flags)}
${this.generateEventMethods(flags)}
${this.generatePrivateMethods(flags)}
}

${this.generateTypeDefinitions(flags)}
`;
  }

  private generateImports(flags: any, isInterface = false): string {
    const imports: string[] = [];
    
    if (flags.singleton && !isInterface) {
      if (flags.async) {
        imports.push(`import { AsyncSingletonService } from '../core/AsyncSingletonService.js';`);
      } else {
        imports.push(`import { SingletonService } from '../core/SingletonService.js';`);
      }
    }
    
    if (flags.events && !isInterface) {
      imports.push(`import { EventEmitter } from 'events';`);
    }
    
    if (flags.cache && !isInterface) {
      imports.push(`import { CacheManager } from '../cache/CacheManager.js';`);
    }
    
    if (flags.type === 'ai' && !isInterface) {
      imports.push(`import { OpenAI } from 'openai';`);
      imports.push(`import { EmbeddingService } from './EmbeddingService.js';`);
    }
    
    return imports.join('\n');
  }

  private getBaseClass(flags: any): string {
    if (flags.singleton) {
      if (flags.async) {
        return ` extends AsyncSingletonService<${flags.name}>`;
      } else {
        return ` extends SingletonService<${flags.name}>`;
      }
    }
    return '';
  }

  private generateConstructor(flags: any): string {
    const dependencies = this.generateDependencies(flags);
    const visibility = flags.singleton ? 'protected' : 'public';
    const superCall = flags.singleton ? '\n    super();' : '';
    
    return `  ${visibility} constructor(${dependencies}
  ) {${superCall}
  }
`;
  }

  private generateDependencies(flags: any): string {
    const deps: string[] = [];
    
    if (flags.cache) {
      deps.push('private readonly cacheManager: CacheManager');
    }
    
    if (flags.type === 'ai') {
      deps.push('private readonly openai: OpenAI');
      deps.push('private readonly embeddingService: EmbeddingService');
    }
    
    if (flags.type === 'infrastructure') {
      deps.push('// Add infrastructure dependencies here');
    }
    
    return deps.length > 0 ? '\n    ' + deps.join(',\n    ') + '\n  ' : '';
  }

  private generateMethods(flags: any): string {
    const singletonMethods = flags.singleton ? this.generateSingletonMethods(flags) : '';
    const coreMethods = this.generateCoreMethods(flags);
    
    return singletonMethods + coreMethods;
  }

  private generateSingletonMethods(flags: any): string {
    if (flags.async) {
      return `
  static async getInstance(): Promise<${flags.name}> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    // Perform async initialization here
  }
`;
    } else {
      return `
  static getInstance(): ${flags.name} {
    return super.getInstance();
  }
`;
    }
  }

  private generateCoreMethods(flags: any): string {
    switch (flags.type) {
      case 'application':
        return this.generateApplicationMethods(flags);
      case 'domain':
        return this.generateDomainMethods(flags);
      case 'infrastructure':
        return this.generateInfrastructureMethods(flags);
      case 'ai':
        return this.generateAIMethods(flags);
      default:
        return this.generateGenericMethods(flags);
    }
  }

  private generateApplicationMethods(flags: any): string {
    return `
  async execute(command: ServiceCommand): Promise<ServiceResult> {
    // Validate command
    this.validateCommand(command);
    
    // Execute business logic
    const result = await this.performOperation(command);
    
    ${flags.events ? `// Emit completion event
    this.emit('operationCompleted', { command, result });` : ''}
    
    return result;
  }

  private validateCommand(command: ServiceCommand): void {
    if (!command) {
      throw new Error('Command is required');
    }
    // Add specific validation logic
  }

  private async performOperation(command: ServiceCommand): Promise<ServiceResult> {
    // Implement core business logic here
    throw new Error('performOperation not implemented');
  }
`;
  }

  private generateDomainMethods(flags: any): string {
    return `
  async processBusinessRule(data: BusinessRuleData): Promise<BusinessRuleResult> {
    // Validate business rules
    this.validateBusinessRules(data);
    
    // Apply domain logic
    const result = await this.applyDomainLogic(data);
    
    return result;
  }

  private validateBusinessRules(data: BusinessRuleData): void {
    // Implement domain validation
    if (!this.isValidData(data)) {
      throw new Error('Invalid business rule data');
    }
  }

  private isValidData(data: BusinessRuleData): boolean {
    // Implement validation logic
    return true;
  }

  private async applyDomainLogic(data: BusinessRuleData): Promise<BusinessRuleResult> {
    // Implement domain logic
    throw new Error('applyDomainLogic not implemented');
  }
`;
  }

  private generateInfrastructureMethods(flags: any): string {
    return `
  async connect(): Promise<void> {
    // Implement connection logic
    ${flags.events ? `this.emit('connected');` : ''}
  }

  async disconnect(): Promise<void> {
    // Implement disconnection logic
    ${flags.events ? `this.emit('disconnected');` : ''}
  }

  async healthCheck(): Promise<HealthStatus> {
    // Implement health check logic
    return {
      status: 'healthy',
      timestamp: new Date(),
      details: {}
    };
  }

  async getMetrics(): Promise<ServiceMetrics> {
    // Implement metrics collection
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      // Add service-specific metrics
    };
  }
`;
  }

  private generateAIMethods(flags: any): string {
    return `
  async generateCompletion(prompt: string, options?: CompletionOptions): Promise<string> {
    ${flags.cache ? `// Check cache first
    const cacheKey = \`completion:\${this.hashPrompt(prompt)}\`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) return cached;` : ''}

    // Generate completion using OpenAI
    const response = await this.openai.chat.completions.create({
      model: options?.model || 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens || 1000,
      temperature: options?.temperature || 0.7,
    });

    const completion = response.choices[0]?.message?.content || '';
    
    ${flags.cache ? `// Cache the result
    await this.cacheManager.set(cacheKey, completion, 3600);` : ''}
    
    ${flags.events ? `// Emit completion event
    this.emit('completionGenerated', { prompt, completion });` : ''}

    return completion;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return await this.embeddingService.generateEmbedding(text);
  }

  async analyzeText(text: string): Promise<TextAnalysis> {
    // Implement text analysis logic
    const completion = await this.generateCompletion(
      \`Analyze the following text and provide insights: \${text}\`
    );
    
    return {
      text,
      analysis: completion,
      timestamp: new Date(),
    };
  }

  ${flags.cache ? `private hashPrompt(prompt: string): string {
    // Simple hash function for cache keys
    return Buffer.from(prompt).toString('base64url').slice(0, 32);
  }` : ''}
`;
  }

  private generateGenericMethods(flags: any): string {
    return `
  async process(data: any): Promise<any> {
    // Implement processing logic
    ${flags.events ? `this.emit('processing', data);` : ''}
    
    const result = await this.performProcess(data);
    
    ${flags.events ? `this.emit('processed', { data, result });` : ''}
    
    return result;
  }

  private async performProcess(data: any): Promise<any> {
    // Implement core processing logic
    throw new Error('performProcess not implemented');
  }
`;
  }

  private generateCacheMethods(flags: any): string {
    if (!flags.cache) return '';
    
    return `
  async clearCache(): Promise<void> {
    await this.cacheManager.clear();
    ${flags.events ? `this.emit('cacheCleared');` : ''}
  }

  private async getCachedResult<T>(key: string): Promise<T | null> {
    return await this.cacheManager.get<T>(key);
  }

  private async setCachedResult<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }
`;
  }

  private generateEventMethods(flags: any): string {
    if (!flags.events) return '';
    
    return `
  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  emit(event: string, ...args: any[]): void {
    this.eventEmitter.emit(event, ...args);
  }

  private eventEmitter = new EventEmitter();
`;
  }

  private generatePrivateMethods(flags: any): string {
    return `
  private validateInput(input: any): void {
    if (!input) {
      throw new Error('Input is required');
    }
  }

  private handleError(error: Error): void {
    // Implement error handling logic
    console.error('Service error:', error);
    ${flags.events ? `this.emit('error', error);` : ''}
  }
`;
  }

  private generateInterfaceMethods(flags: any): string {
    switch (flags.type) {
      case 'application':
        return `
  execute(command: ServiceCommand): Promise<ServiceResult>;`;
      case 'domain':
        return `
  processBusinessRule(data: BusinessRuleData): Promise<BusinessRuleResult>;`;
      case 'infrastructure':
        return `
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  getMetrics(): Promise<ServiceMetrics>;`;
      case 'ai':
        return `
  generateCompletion(prompt: string, options?: CompletionOptions): Promise<string>;
  generateEmbedding(text: string): Promise<number[]>;
  analyzeText(text: string): Promise<TextAnalysis>;`;
      default:
        return `
  process(data: any): Promise<any>;`;
    }
  }

  private generateTypeDefinitions(flags: any): string {
    const baseTypes = `
export interface ServiceOptions {
  timeout?: number;
  retries?: number;
}`;

    switch (flags.type) {
      case 'application':
        return baseTypes + `

export interface ServiceCommand {
  id: string;
  type: string;
  payload: any;
  metadata?: Record<string, any>;
}

export interface ServiceResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}`;

      case 'domain':
        return baseTypes + `

export interface BusinessRuleData {
  id: string;
  rules: any[];
  context: Record<string, any>;
}

export interface BusinessRuleResult {
  valid: boolean;
  violations: string[];
  data?: any;
}`;

      case 'infrastructure':
        return baseTypes + `

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  details: Record<string, any>;
}

export interface ServiceMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  [key: string]: any;
}`;

      case 'ai':
        return baseTypes + `

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TextAnalysis {
  text: string;
  analysis: string;
  timestamp: Date;
}`;

      default:
        return baseTypes;
    }
  }

  private generateTestContent(flags: any): string {
    const serviceName = flags.name;
    const testType = flags.singleton ? 'Singleton ' : '';
    
    return `import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ${serviceName} } from '../../${flags.type}/services/${serviceName}.js';

describe('${testType}${serviceName}', () => {
  let service: ${serviceName};

  beforeEach(async () => {
    ${flags.singleton ? `service = ${serviceName}.getInstance();` : `service = new ${serviceName}();`}
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(service).toBeDefined();
    });

    ${flags.singleton ? `it('should return same instance', () => {
      const instance1 = ${serviceName}.getInstance();
      const instance2 = ${serviceName}.getInstance();
      expect(instance1).toBe(instance2);
    });` : ''}
  });

  describe('core functionality', () => {
    it('should process requests correctly', async () => {
      // TODO: Implement test cases
      expect(true).toBe(true);
    });

    ${flags.cache ? `it('should handle caching correctly', async () => {
      // TODO: Test caching functionality
      expect(service.clearCache).toBeDefined();
    });` : ''}

    ${flags.events ? `it('should emit events correctly', () => {
      // TODO: Test event emission
      expect(service.on).toBeDefined();
      expect(service.emit).toBeDefined();
    });` : ''}
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // TODO: Test error scenarios
      expect(true).toBe(true);
    });
  });
});
`;
  }

  private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}