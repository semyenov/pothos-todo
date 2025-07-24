#!/usr/bin/env bun

/**
 * Refactoring Analysis Script
 * 
 * This script analyzes the codebase to identify refactoring opportunities
 * and estimate the impact of migrating to base classes.
 * 
 * Usage: bun scripts/analyze-refactoring-opportunities.ts [path]
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

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

  async analyze(basePath: string = './src'): Promise<void> {
    console.log('🔍 Analyzing codebase for refactoring opportunities...\n');
    
    const files = await this.findAllFiles(basePath);
    
    for (const file of files) {
      await this.analyzeFile(file);
    }
    
    this.printResults();
  }

  private async analyzeFile(file: string): Promise<void> {
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
      if (this.isSingletonCandidate(content)) {
        const analysis = this.analyzeSingleton(file, content, lines);
        this.result.singletons.push(analysis);
        this.result.summary.singletonCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for repository pattern
      if (this.isRepositoryCandidate(file, content)) {
        const analysis = this.analyzeRepository(file, content, lines);
        this.result.repositories.push(analysis);
        this.result.summary.repositoryCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for aggregate pattern
      if (this.isAggregateCandidate(file, content)) {
        const analysis = this.analyzeAggregate(file, content, lines);
        this.result.aggregates.push(analysis);
        this.result.summary.aggregateCount++;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
      }
      
      // Analyze for GraphQL auth patterns
      const authChecks = this.countAuthChecks(content);
      if (authChecks > 0) {
        const analysis = this.analyzeGraphQLAuth(file, content, lines, authChecks);
        this.result.graphqlAuth.push(analysis);
        this.result.summary.authCheckCount += authChecks;
        this.result.summary.totalLinesReduced += analysis.estimatedReduction;
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

  private analyzeSingleton(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    // Count singleton boilerplate lines
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
    
    // Check for async patterns
    if (content.includes('async') && content.includes('initialize')) {
      patterns.push('Async initialization');
      complexity = 'medium';
      reduction += 5;
    }
    
    // Check for complex initialization
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

  private isRepositoryCandidate(file: string, content: string): boolean {
    return file.includes('Repository') &&
           (content.includes('findById') || 
            content.includes('findAll') || 
            content.includes('save') ||
            content.includes('delete'));
  }

  private analyzeRepository(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    // Count CRUD methods
    const crudMethods = ['findById', 'findAll', 'save', 'update', 'delete', 'create'];
    for (const method of crudMethods) {
      if (content.includes(`async ${method}`)) {
        patterns.push(`${method} method`);
        reduction += this.countMethodLines(content, method);
      }
    }
    
    // Check for batch operations
    if (content.includes('createMany') || content.includes('updateMany')) {
      patterns.push('Batch operations');
      reduction += 10;
    }
    
    // Check for transaction support
    if (content.includes('$transaction')) {
      patterns.push('Transaction support');
      complexity = 'medium';
    }
    
    // Check for complex queries
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

  private isAggregateCandidate(file: string, content: string): boolean {
    return (file.includes('domain') || file.includes('aggregate')) &&
           (content.includes('_id') && content.includes('_createdAt')) ||
           content.includes('addDomainEvent');
  }

  private analyzeAggregate(file: string, content: string, lines: string[]): FileAnalysis {
    const patterns: string[] = [];
    let reduction = 0;
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    // Count base properties
    const baseProps = ['_id', '_createdAt', '_updatedAt', '_version'];
    for (const prop of baseProps) {
      if (content.includes(`private ${prop}:`)) {
        patterns.push(`${prop} property`);
        reduction += 1;
      }
    }
    
    // Check for manual timestamp updates
    if (content.includes('this._updatedAt = new Date()')) {
      patterns.push('Manual timestamp updates');
      reduction += 3;
    }
    
    // Check for version management
    if (content.includes('this._version++')) {
      patterns.push('Manual version increment');
      reduction += 1;
    }
    
    // Check for domain events
    if (content.includes('_events')) {
      patterns.push('Domain events');
      reduction += 5;
      complexity = 'medium';
    }
    
    // Check for validation
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

  private analyzeGraphQLAuth(file: string, content: string, lines: string[], authChecks: number): FileAnalysis {
    const patterns: string[] = [];
    let reduction = authChecks * 4; // Approximately 4 lines per auth check
    let complexity: FileAnalysis['migrationComplexity'] = 'easy';
    
    patterns.push(`${authChecks} authentication checks`);
    
    // Check for permission checks
    if (content.includes('role') || content.includes('permission')) {
      patterns.push('Permission checks');
      complexity = 'medium';
    }
    
    // Check for ownership checks
    if (content.includes('userId') && content.includes('ownerId')) {
      patterns.push('Ownership verification');
      complexity = 'medium';
    }
    
    // Check for rate limiting
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

  private countMethodLines(content: string, methodName: string): number {
    const methodRegex = new RegExp(`async ${methodName}\\([^)]*\\).*?{`, 's');
    const startMatch = content.match(methodRegex);
    
    if (!startMatch || startMatch.index === undefined) return 0;
    
    let braceCount = 1;
    let i = startMatch.index + startMatch[0].length;
    let lines = 1;
    
    while (i < content.length && braceCount > 0) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      if (content[i] === '\n') lines++;
      i++;
    }
    
    return lines;
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

  private printResults(): void {
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
    
    // Singletons
    if (this.result.singletons.length > 0) {
      console.log('\n🔧 Singleton Services:');
      this.printFileAnalysis(this.result.singletons);
    }
    
    // Repositories
    if (this.result.repositories.length > 0) {
      console.log('\n🗄️  Repositories:');
      this.printFileAnalysis(this.result.repositories);
    }
    
    // Aggregates
    if (this.result.aggregates.length > 0) {
      console.log('\n🏗️  Domain Aggregates:');
      this.printFileAnalysis(this.result.aggregates);
    }
    
    // GraphQL Auth
    if (this.result.graphqlAuth.length > 0) {
      console.log('\n🔐 GraphQL Authentication:');
      this.printFileAnalysis(this.result.graphqlAuth);
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    console.log('  1. Run the migration script with --dry-run first to see planned changes');
    console.log('  2. Start with "easy" complexity files for quick wins');
    console.log('  3. Review "hard" complexity files manually before migration');
    console.log('  4. Run tests after each batch of migrations');
    console.log('  5. Use --backup flag to create backup files');
    
    console.log('\n🚀 Next Steps:');
    console.log('  bun scripts/migrate-to-base-classes.ts --dry-run --type=singleton');
    console.log('  bun scripts/migrate-to-base-classes.ts --type=singleton --path=src/infrastructure');
    
    console.log('\n' + '=' .repeat(80));
  }

  private printFileAnalysis(analyses: FileAnalysis[]): void {
    // Sort by estimated reduction (descending)
    const sorted = analyses.sort((a, b) => b.estimatedReduction - a.estimatedReduction);
    
    for (const analysis of sorted.slice(0, 10)) { // Show top 10
      const relativePath = analysis.file.replace(process.cwd() + '/', '');
      const reduction = analysis.estimatedReduction;
      const complexity = analysis.migrationComplexity;
      const complexityIcon = complexity === 'easy' ? '🟢' : complexity === 'medium' ? '🟡' : '🔴';
      
      console.log(`\n  ${complexityIcon} ${relativePath}`);
      console.log(`     Lines: ${analysis.lineCount} | Reduction: ~${reduction} lines`);
      console.log(`     Patterns: ${analysis.patterns.join(', ')}`);
    }
    
    if (analyses.length > 10) {
      console.log(`\n  ... and ${analyses.length - 10} more files`);
    }
  }
}

// Run the analyzer
const analyzer = new RefactoringAnalyzer();
const targetPath = process.argv[2] || './src';

analyzer.analyze(targetPath).catch(console.error);