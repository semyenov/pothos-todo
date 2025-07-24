import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export default class RefactorAnalyze extends Command {
  static override description = 'Analyze codebase for refactoring opportunities';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --path src/infrastructure',
    '<%= config.bin %> <%= command.id %> --type singleton',
    '<%= config.bin %> <%= command.id %> --output report.json',
  ];

  static override flags = {
    path: Flags.string({
      char: 'p',
      description: 'Path to analyze (default: src)',
      default: 'src',
    }),
    type: Flags.string({
      char: 't',
      description: 'Type of analysis: singleton, repository, aggregate, auth, all',
      options: ['singleton', 'repository', 'aggregate', 'auth', 'all'],
      default: 'all',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output results to JSON file',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RefactorAnalyze);
    
    this.log(chalk.blue('🔍 Analyzing codebase for refactoring opportunities'));
    this.log(chalk.gray(`Analyzing: ${flags.path}`));
    this.log(chalk.gray(`Type: ${flags.type}\n`));

    try {
      const analyzer = new RefactoringAnalyzer();
      const results = await analyzer.analyze(flags.path, flags.type as any, flags.verbose);
      
      if (flags.output) {
        await this.saveResults(flags.output, results);
      }

    } catch (error) {
      this.log(chalk.red('❌ Analysis failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async saveResults(outputPath: string, results: AnalysisResult): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
    this.log(chalk.green(`💾 Results saved to ${outputPath}`));
  }
}

interface AnalysisResult {
  singletons: FileAnalysis[];
  repositories: FileAnalysis[];
  aggregates: FileAnalysis[];
  graphqlAuth: FileAnalysis[];
  summary: {
    totalFiles: number;
    totalLinesReduced: number;
    singletonCount: number;
    repositoryCount: number;
    aggregateCount: number;
    authCheckCount: number;
  };
}

interface FileAnalysis {
  file: string;
  lineCount: number;
  estimatedReduction: number;
  patterns: string[];
  migrationComplexity: 'easy' | 'medium' | 'hard';
}

class RefactoringAnalyzer {
  private result: AnalysisResult = {
    singletons: [],
    repositories: [],
    aggregates: [],
    graphqlAuth: [],
    summary: {
      totalFiles: 0,
      totalLinesReduced: 0,
      singletonCount: 0,
      repositoryCount: 0,
      aggregateCount: 0,
      authCheckCount: 0
    }
  };

  async analyze(basePath: string, type: string, verbose: boolean): Promise<AnalysisResult> {
    console.log('🔍 Analyzing codebase for refactoring opportunities...\n');
    
    const files = await this.findAllFiles(basePath);
    
    for (const file of files) {
      await this.analyzeFile(file, type);
    }
    
    this.printResults(verbose);
    return this.result;
  }

  private async analyzeFile(file: string, analysisType: string): Promise<void> {
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n');
      
      // Skip test files and already migrated files
      if (file.includes('.test.') || file.includes('.spec.') || 
          content.includes('extends SingletonService') ||
          content.includes('extends BaseRepository') ||
          content.includes('extends BaseAggregate')) {
        return;
      }
      
      this.result.summary.totalFiles++;
      
      // Analyze for singleton pattern
      if ((analysisType === 'all' || analysisType === 'singleton') && this.isSingletonCandidate(content)) {
        const analysis = this.analyzeSingleton(file, content, lines);
        this.result.singletons.push(analysis);
        this.result.summary.singletonCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for repository pattern
      if ((analysisType === 'all' || analysisType === 'repository') && this.isRepositoryCandidate(file, content)) {
        const analysis = this.analyzeRepository(file, content, lines);
        this.result.repositories.push(analysis);
        this.result.summary.repositoryCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for aggregate pattern
      if ((analysisType === 'all' || analysisType === 'aggregate') && this.isAggregateCandidate(file, content)) {
        const analysis = this.analyzeAggregate(file, content, lines);
        this.result.aggregates.push(analysis);
        this.result.summary.aggregateCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for GraphQL auth patterns
      if (analysisType === 'all' || analysisType === 'auth') {
        const authChecks = this.countAuthChecks(content);
        if (authChecks > 0) {
          const analysis = this.analyzeGraphQLAuth(file, content, lines, authChecks);
          this.result.graphqlAuth.push(analysis);
          this.result.summary.authCheckCount += authChecks;
          this.result.summary.totalLinesReduced += analysis.estimatedReduction;
        }
      }
      
    } catch (error) {
      console.error(`Error analyzing ${file}:`, error instanceof Error ? error.message : String(error));
    }
  }

  private isSingletonCandidate(content: string): boolean {
    return content.includes('private static instance') &&
           content.includes('getInstance()') &&
           content.includes('private constructor()');
  }

  private isRepositoryCandidate(file: string, content: string): boolean {
    return file.includes('Repository') &&
           (content.includes('findById') || 
            content.includes('findAll') || 
            content.includes('save') ||
            content.includes('delete'));
  }

  private isAggregateCandidate(file: string, content: string): boolean {
    return (file.includes('domain') || file.includes('aggregate')) &&
           (content.includes('_id') && content.includes('_createdAt')) ||
           content.includes('addDomainEvent');
  }

  private countAuthChecks(content: string): number {
    const patterns = [
      /if\s*\(!context\.user\)/g,
      /throw\s+new\s+GraphQLError\(['"]Not authenticated/g,
      /extensions:\s*{\s*code:\s*['"]UNAUTHENTICATED/g
    ];
    
    let count = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      count += matches ? matches.length : 0;
    }
    
    return count;
  }

  private analyzeSingleton(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    if (content.includes('private static instance')) {
      patterns.push('Static instance property');
      reduction += 1;
    }
    
    if (/if\s*\(!.*\.instance\)/.test(content)) {
      patterns.push('Instance null check');
      reduction += 3;
    }
    
    if (content.includes('return') && content.includes('.instance')) {
      patterns.push('Instance return statement');
      reduction += 1;
    }
    
    if (content.includes('async') && content.includes('initialize')) {
      patterns.push('Async initialization');
      complexity = 'medium';
      reduction += 5;
    }
    
    if (/getInstance\([^)]+\)/.test(content)) {
      patterns.push('Parameterized getInstance');
      complexity = 'hard';
    }
    
    return {
      file,
      lineCount: lines.length,
      estimatedReduction: reduction,
      patterns,
      migrationComplexity: complexity
    };
  }

  private analyzeRepository(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    const crudMethods = ['findById', 'findAll', 'save', 'update', 'delete', 'create'];
    for (const method of crudMethods) {
      if (content.includes(`async ${method}`)) {
        patterns.push(`${method} method`);
        reduction += 8; // Estimated lines per CRUD method
      }
    }
    
    if (content.includes('createMany') || content.includes('updateMany')) {
      patterns.push('Batch operations');
      reduction += 10;
    }
    
    if (content.includes('$transaction')) {
      patterns.push('Transaction support');
      complexity = 'medium';
    }
    
    if (content.includes('include:') || content.includes('orderBy:')) {
      patterns.push('Complex queries');
      complexity = 'medium';
    }
    
    return {
      file,
      lineCount: lines.length,
      estimatedReduction: reduction,
      patterns,
      migrationComplexity: complexity
    };
  }

  private analyzeAggregate(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    const baseProps = ['_id', '_createdAt', '_updatedAt', '_version'];
    for (const prop of baseProps) {
      if (content.includes(`private ${prop}:`)) {
        patterns.push(`${prop} property`);
        reduction += 1;
      }
    }
    
    if (content.includes('this._updatedAt = new Date()')) {
      patterns.push('Manual timestamp updates');
      reduction += 3;
    }
    
    if (content.includes('this._version++')) {
      patterns.push('Manual version increment');
      reduction += 1;
    }
    
    if (content.includes('_events')) {
      patterns.push('Domain events');
      reduction += 5;
      complexity = 'medium';
    }
    
    if (content.includes('validate()')) {
      patterns.push('Validation logic');
    }
    
    return {
      file,
      lineCount: lines.length,
      estimatedReduction: reduction,
      patterns,
      migrationComplexity: complexity
    };
  }

  private analyzeGraphQLAuth(file: string, content: string, lines: string[], authChecks: number): FileAnalysis {
    const patterns: string[] = [];
    let reduction = authChecks * 4;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    patterns.push(`${authChecks} authentication checks`);
    
    if (content.includes('role') || content.includes('permission')) {
      patterns.push('Permission checks');
      complexity = 'medium';
    }
    
    if (content.includes('userId') && content.includes('ownerId')) {
      patterns.push('Ownership verification');
      complexity = 'medium';
    }
    
    if (content.includes('rate') || content.includes('limit')) {
      patterns.push('Rate limiting');
      complexity = 'medium';
    }
    
    return {
      file,
      lineCount: lines.length,
      estimatedReduction: reduction,
      patterns,
      migrationComplexity: complexity
    };
  }

  private async findAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && 
            entry.name !== 'node_modules' && entry.name !== 'dist') {
          files.push(...await this.findAllFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error instanceof Error ? error.message : String(error));
    }
    
    return files;
  }

  private printResults(verbose: boolean): void {
    console.log('📊 Refactoring Analysis Results');
    console.log('=' .repeat(80));
    
    // Summary
    console.log('\n📈 Summary:');
    console.log(`  Total files analyzed: ${this.result.summary.totalFiles}`);
    console.log(`  Estimated lines to be reduced: ${this.result.summary.totalLinesReduced}`);
    console.log(`  Singleton services found: ${this.result.summary.singletonCount}`);
    console.log(`  Repositories found: ${this.result.summary.repositoryCount}`);
    console.log(`  Aggregates found: ${this.result.summary.aggregateCount}`);
    console.log(`  GraphQL auth checks found: ${this.result.summary.authCheckCount}`);
    
    if (verbose) {
      this.printDetailedResults();
    }
    
    console.log('\n💡 Recommendations:');
    console.log('  1. Run migration with --dry-run first to see planned changes');
    console.log('  2. Start with "easy" complexity files for quick wins');
    console.log('  3. Review "hard" complexity files manually before migration');
    console.log('  4. Run tests after each batch of migrations');
    
    console.log('\n🚀 Next Steps:');
    console.log('  pothos-cli refactor:migrate --dry-run --type=singleton');
    console.log('  pothos-cli refactor:migrate --type=singleton');
    
    console.log('\n' + '=' .repeat(80));
  }

  private printDetailedResults(): void {
    const categories = [
      { name: 'Singletons', items: this.result.singletons, icon: '🔧' },
      { name: 'Repositories', items: this.result.repositories, icon: '🗄️' },
      { name: 'Aggregates', items: this.result.aggregates, icon: '🏗️' },
      { name: 'GraphQL Auth', items: this.result.graphqlAuth, icon: '🔐' },
    ];

    for (const category of categories) {
      if (category.items.length > 0) {
        console.log(`\n${category.icon} ${category.name}:`);
        const sorted = category.items.sort((a, b) => b.estimatedReduction - a.estimatedReduction);
        
        for (const item of sorted.slice(0, 10)) {
          const relativePath = item.file.replace(process.cwd() + '/', '');
          const complexityIcon = item.migrationComplexity === 'easy' ? '🟢' : 
                                 item.migrationComplexity === 'medium' ? '🟡' : '🔴';
          
          console.log(`\n  ${complexityIcon} ${relativePath}`);
          console.log(`     Lines: ${item.lineCount} | Reduction: ~${item.estimatedReduction} lines`);
          console.log(`     Patterns: ${item.patterns.join(', ')}`);
        }
        
        if (sorted.length > 10) {
          console.log(`\n  ... and ${sorted.length - 10} more files`);
        }
      }
    }
  }
}