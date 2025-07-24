#!/usr/bin/env bun

/**
 * Automated Migration Script for Base Classes
 * 
 * This script helps migrate existing code to use the new base classes:
 * - SingletonService / AsyncSingletonService
 * - BaseRepository
 * - BaseAggregate
 * 
 * Usage: bun scripts/migrate-to-base-classes.ts [options]
 * 
 * Options:
 *   --dry-run    Show what would be changed without modifying files
 *   --type       Type of migration: singleton, repository, aggregate, all (default: all)
 *   --path       Specific path to migrate (default: entire codebase)
 *   --backup     Create backup files before migration (default: true)
 */

import { readdir, readFile, writeFile, copyFile } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { existsSync } from 'fs';
import { parseArgs } from 'util';

interface MigrationOptions {
  dryRun: boolean;
  type: 'singleton' | 'repository' | 'aggregate' | 'all';
  path?: string;
  backup: boolean;
}

interface MigrationResult {
  file: string;
  type: string;
  changes: string[];
  success: boolean;
  error?: string;
}

class MigrationScript {
  private results: MigrationResult[] = [];
  
  constructor(private options: MigrationOptions) {}

  async run(): Promise<void> {
    console.log('🚀 Starting migration with options:', this.options);
    
    const targetPath = this.options.path || './src';
    
    if (this.options.type === 'all' || this.options.type === 'singleton') {
      await this.migrateSingletons(targetPath);
    }
    
    if (this.options.type === 'all' || this.options.type === 'repository') {
      await this.migrateRepositories(targetPath);
    }
    
    if (this.options.type === 'all' || this.options.type === 'aggregate') {
      await this.migrateAggregates(targetPath);
    }
    
    this.printResults();
  }

  private async migrateSingletons(basePath: string): Promise<void> {
    console.log('\n📦 Migrating Singleton Services...');
    
    const files = await this.findFiles(basePath, /\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      // Check if it's a singleton pattern
      if (this.isSingletonPattern(content)) {
        await this.migrateSingletonFile(file, content);
      }
    }
  }

  private isSingletonPattern(content: string): boolean {
    return /private static instance:.*\|?\s*null/.test(content) &&
           /static getInstance\(\)/.test(content) &&
           /private constructor\(\)/.test(content);
  }

  private async migrateSingletonFile(file: string, content: string): Promise<void> {
    const className = this.extractClassName(content);
    if (!className) return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Determine if it needs async initialization
      const needsAsync = this.needsAsyncInitialization(content);
      const baseClass = needsAsync ? 'AsyncSingletonService' : 'SingletonService';

      // Add import for base class
      if (!content.includes('SingletonService')) {
        const importStatement = `import { ${baseClass} } from '@/infrastructure/core/SingletonService';\n`;
        newContent = this.addImport(newContent, importStatement);
        changes.push(`Added import for ${baseClass}`);
      }

      // Change class declaration
      const classRegex = new RegExp(`class ${className}\\s*{`);
      if (classRegex.test(newContent)) {
        newContent = newContent.replace(
          classRegex,
          `class ${className} extends ${baseClass}<${className}> {`
        );
        changes.push(`Extended ${baseClass}<${className}>`);
      }

      // Remove static instance property
      const instanceRegex = /private static instance:.*\|?\s*null\s*=\s*null;?\s*/;
      if (instanceRegex.test(newContent)) {
        newContent = newContent.replace(instanceRegex, '');
        changes.push('Removed static instance property');
      }

      // Change constructor visibility
      newContent = newContent.replace(
        /private constructor\(\)/,
        'protected constructor()'
      );
      changes.push('Changed constructor to protected');

      // Add super() call if not present
      const constructorMatch = newContent.match(/protected constructor\(\)\s*{([^}]*)/);
      if (constructorMatch && constructorMatch[1] && !constructorMatch[1].includes('super()')) {
        newContent = newContent.replace(
          /protected constructor\(\)\s*{/,
          'protected constructor() {\n    super();'
        );
        changes.push('Added super() call to constructor');
      }

      // Update getInstance method
      if (needsAsync) {
        await this.migrateAsyncGetInstance(newContent, className, changes);
      } else {
        newContent = this.migrateSyncGetInstance(newContent, className, changes);
      }

      await this.saveFile(file, newContent, changes);

    } catch (error) {
      this.results.push({
        file,
        type: 'singleton',
        changes: [],
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private needsAsyncInitialization(content: string): boolean {
    // Check for patterns indicating async initialization
    return /async\s+initialize/.test(content) ||
           /async\s+connect/.test(content) ||
           /await.*getInstance/.test(content);
  }

  private migrateSyncGetInstance(content: string, className: string, changes: string[]): string {
    const getInstanceRegex = new RegExp(
      `static getInstance\\(\\).*?{[\\s\\S]*?return ${className}\\.instance;\\s*}`,
      'g'
    );
    
    if (getInstanceRegex.test(content)) {
      content = content.replace(
        getInstanceRegex,
        `static getInstance(): ${className} {\n    return super.getInstance();\n  }`
      );
      changes.push('Simplified getInstance() method');
    }
    
    return content;
  }

  private async migrateAsyncGetInstance(content: string, className: string, changes: string[]): Promise<string> {
    // This would be more complex in practice, handling various async patterns
    // For now, we'll add a TODO comment
    changes.push('Added TODO for async getInstance migration');
    return content.replace(
      /static getInstance\(\)/,
      `// TODO: Migrate to async getInstance pattern
  static async getInstance(): Promise<${className}>`
    );
  }

  private async migrateRepositories(basePath: string): Promise<void> {
    console.log('\n🗄️  Migrating Repositories...');
    
    const files = await this.findFiles(basePath, /Repository\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      if (this.isRepositoryPattern(content)) {
        await this.migrateRepositoryFile(file, content);
      }
    }
  }

  private isRepositoryPattern(content: string): boolean {
    return /implements.*Repository/.test(content) &&
           (content.includes('findById') || content.includes('save') || content.includes('findAll'));
  }

  private async migrateRepositoryFile(file: string, content: string): Promise<void> {
    const className = this.extractClassName(content);
    if (!className || className === 'BaseRepository') return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Add import for BaseRepository
      if (!content.includes('BaseRepository')) {
        const importStatement = `import { BaseRepository } from '@/infrastructure/core/BaseRepository';\n`;
        newContent = this.addImport(newContent, importStatement);
        changes.push('Added import for BaseRepository');
      }

      // Extract domain and Prisma types
      const types = this.extractRepositoryTypes(content);
      if (types) {
        // Change class declaration
        const classRegex = new RegExp(`class ${className}.*?{`);
        newContent = newContent.replace(
          classRegex,
          `class ${className} extends BaseRepository<${types.domain}, ${types.prisma}> {`
        );
        changes.push(`Extended BaseRepository<${types.domain}, ${types.prisma}>`);

        // Add required abstract methods if not present
        if (!content.includes('getModelName')) {
          const modelName = this.inferModelName(className);
          const getModelNameMethod = `
  protected getModelName(): string {
    return '${modelName}';
  }
`;
          newContent = this.addMethodToClass(newContent, className, getModelNameMethod);
          changes.push('Added getModelName() method');
        }

        // Remove duplicate CRUD methods
        newContent = this.removeDuplicateCrudMethods(newContent, changes);
      }

      await this.saveFile(file, newContent, changes);

    } catch (error) {
      this.results.push({
        file,
        type: 'repository',
        changes: [],
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private extractRepositoryTypes(content: string): { domain: string; prisma: string } | null {
    // Try to extract from existing method signatures
    const findByIdMatch = content.match(/findById\(.*?\):\s*Promise<(\w+)\s*\|/);
    if (findByIdMatch) {
      const domain = findByIdMatch[1];
      // Try to infer Prisma type (often Prisma + domain name)
      const prisma = `Prisma${domain}`;
      return { domain: domain || '', prisma };
    }
    return null;
  }

  private removeDuplicateCrudMethods(content: string, changes: string[]): string {
    const methodsToRemove = ['findById', 'findAll', 'save', 'delete', 'update'];
    
    for (const method of methodsToRemove) {
      const methodRegex = new RegExp(
        `async ${method}\\([^)]*\\)[^{]*{[^}]*}`,
        'gs'
      );
      
      if (methodRegex.test(content) && !content.includes(`super.${method}`)) {
        content = content.replace(methodRegex, '');
        changes.push(`Removed duplicate ${method}() method`);
      }
    }
    
    return content;
  }

  private async migrateAggregates(basePath: string): Promise<void> {
    console.log('\n🏗️  Migrating Aggregates...');
    
    const files = await this.findFiles(basePath, /\/(aggregates|domain)\/.*\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      if (this.isAggregatePattern(content)) {
        await this.migrateAggregateFile(file, content);
      }
    }
  }

  private isAggregatePattern(content: string): boolean {
    return content.includes('_events') ||
           content.includes('addDomainEvent') ||
           (content.includes('_id') && content.includes('_createdAt') && content.includes('_updatedAt'));
  }

  private async migrateAggregateFile(file: string, content: string): Promise<void> {
    const className = this.extractClassName(content);
    if (!className || className === 'BaseAggregate') return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Add import for BaseAggregate
      if (!content.includes('BaseAggregate')) {
        const importStatement = `import { BaseAggregate } from '@/domain/core/BaseAggregate';\n`;
        newContent = this.addImport(newContent, importStatement);
        changes.push('Added import for BaseAggregate');
      }

      // Change class declaration
      const classRegex = new RegExp(`class ${className}\\s*{`);
      if (classRegex.test(newContent)) {
        newContent = newContent.replace(
          classRegex,
          `class ${className} extends BaseAggregate {`
        );
        changes.push('Extended BaseAggregate');
      }

      // Remove duplicate properties
      const propertiesToRemove = ['_id', '_createdAt', '_updatedAt', '_version', '_events'];
      for (const prop of propertiesToRemove) {
        const propRegex = new RegExp(`private ${prop}:.*?;\\s*`, 'g');
        if (propRegex.test(newContent)) {
          newContent = newContent.replace(propRegex, '');
          changes.push(`Removed duplicate ${prop} property`);
        }
      }

      // Update constructor to call super
      newContent = this.updateAggregateConstructor(newContent, className, changes);

      // Replace manual update patterns with updateFields
      newContent = this.replaceUpdatePatterns(newContent, changes);

      await this.saveFile(file, newContent, changes);

    } catch (error) {
      this.results.push({
        file,
        type: 'aggregate',
        changes: [],
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private updateAggregateConstructor(content: string, className: string, changes: string[]): string {
    const constructorRegex = new RegExp(
      `constructor\\s*\\([^)]*\\)\\s*{([^}]+)}`,
      's'
    );
    
    const match = content.match(constructorRegex);
    if (match) {
      const constructorBody = match[1];
      
      // Check if super() is already called
      if (constructorBody && !constructorBody.includes('super(')) {
        // Find where to insert super() call
        const lines = constructorBody ? constructorBody.split('\n') : [];
        const superCall = '    super(id, createdAt, updatedAt, version);';
        
        // Insert after initial property assignments
        const insertIndex = lines.findIndex(line => 
          !line.trim().startsWith('this._') || line.includes('=')
        );
        
        if (insertIndex > 0) {
          lines.splice(insertIndex, 0, superCall);
          const newConstructorBody = lines.join('\n');
          
          content = content.replace(
            constructorRegex,
            `constructor(...args) {${newConstructorBody}}`
          );
          
          changes.push('Added super() call to constructor');
        }
      }
    }
    
    return content;
  }

  private replaceUpdatePatterns(content: string, changes: string[]): string {
    // Find update methods with manual timestamp updates
    const updateMethodRegex = /update\([^)]*\)\s*{([^}]+this\._updatedAt\s*=\s*new Date\(\)[^}]+)}/gs;
    
    const matches = content.matchAll(updateMethodRegex);
    for (const match of matches) {
      const methodBody = match[1];
      
      // Extract field updates
      const fieldUpdates = this.extractFieldUpdates(methodBody || '');
      
      if (fieldUpdates.length > 0) {
        const updateFieldsCall = `const hasChanges = this.updateFields({
${fieldUpdates.map(f => `      ${f}`).join(',\n')}
    });`;
        
        // Replace manual updates with updateFields
        const newMethodBody = (methodBody || '')
          .replace(/this\._\w+\s*=\s*[^;]+;/g, '')
          .replace(/this\._updatedAt\s*=\s*new Date\(\);?/, '')
          .replace(/this\._version\+\+;?/, '')
          .trim();
        
        const newMethod = `update(...args) {
    ${updateFieldsCall}
    ${newMethodBody}
  }`;
        
        content = content.replace(match[0], newMethod);
        changes.push('Replaced manual updates with updateFields()');
      }
    }
    
    return content;
  }

  private extractFieldUpdates(methodBody: string): string[] {
    const updates: string[] = [];
    const updateRegex = /this\.(_\w+)\s*=\s*([^;]+);/g;
    
    const matches = methodBody.matchAll(updateRegex);
    for (const match of matches) {
      const field = match[1] ? match[1].substring(1) : ''; // Remove underscore
      const value = match[2] ? match[2].trim() : '';
      
      // Skip internal fields
      if (!['id', 'createdAt', 'updatedAt', 'version', 'events'].includes(field)) {
        updates.push(`${field}: ${value}`);
      }
    }
    
    return updates;
  }

  // Utility methods

  private extractClassName(content: string): string | null {
    const match = content.match(/export\s+class\s+(\w+)/);
    return match && match[1] ? match[1] : null;
  }

  private inferModelName(className: string): string {
    // Remove 'Repository' suffix and convert to lowercase
    return className.replace(/Repository$/, '').toLowerCase();
  }

  private addImport(content: string, importStatement: string): string {
    // Find the last import statement
    const lastImportIndex = content.lastIndexOf('import ');
    if (lastImportIndex !== -1) {
      const endOfLastImport = content.indexOf('\n', lastImportIndex);
      return content.slice(0, endOfLastImport + 1) + 
             importStatement + 
             content.slice(endOfLastImport + 1);
    }
    
    // If no imports, add at the beginning
    return importStatement + '\n' + content;
  }

  private addMethodToClass(content: string, className: string, method: string): string {
    // Find the class body
    const classRegex = new RegExp(`class ${className}[^{]*{`);
    const match = content.match(classRegex);
    
    if (match) {
      const classStart = match.index! + match[0].length;
      
      // Find the constructor or first method
      const constructorIndex = content.indexOf('constructor', classStart);
      const insertPoint = constructorIndex > -1 
        ? content.indexOf('}', constructorIndex) + 1
        : classStart;
      
      return content.slice(0, insertPoint) + 
             '\n' + method + 
             content.slice(insertPoint);
    }
    
    return content;
  }

  private async findFiles(dir: string, pattern: RegExp): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...await this.findFiles(fullPath, pattern));
        } else if (entry.isFile() && pattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error instanceof Error ? error.message : String(error));
    }
    
    return files;
  }

  private async saveFile(file: string, content: string, changes: string[]): Promise<void> {
    if (changes.length === 0) return;

    if (this.options.dryRun) {
      this.results.push({
        file,
        type: this.detectFileType(file),
        changes,
        success: true
      });
      return;
    }

    try {
      // Create backup if requested
      if (this.options.backup) {
        const backupPath = `${file}.backup`;
        await copyFile(file, backupPath);
      }

      // Write the new content
      await writeFile(file, content, 'utf-8');

      this.results.push({
        file,
        type: this.detectFileType(file),
        changes,
        success: true
      });
    } catch (error) {
      this.results.push({
        file,
        type: this.detectFileType(file),
        changes,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private detectFileType(file: string): string {
    if (file.includes('Repository')) return 'repository';
    if (file.includes('aggregate') || file.includes('domain')) return 'aggregate';
    return 'singleton';
  }

  private printResults(): void {
    console.log('\n📊 Migration Results:');
    console.log('=' .repeat(80));

    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    console.log(`\n✅ Successful migrations: ${successful.length}`);
    for (const result of successful) {
      console.log(`\n  📄 ${relative(process.cwd(), result.file)} (${result.type})`);
      for (const change of result.changes) {
        console.log(`     • ${change}`);
      }
    }

    if (failed.length > 0) {
      console.log(`\n❌ Failed migrations: ${failed.length}`);
      for (const result of failed) {
        console.log(`\n  📄 ${relative(process.cwd(), result.file)}`);
        console.log(`     Error: ${result.error}`);
      }
    }

    if (this.options.dryRun) {
      console.log('\n⚠️  DRY RUN MODE - No files were modified');
      console.log('Remove --dry-run flag to apply changes');
    }

    console.log('\n' + '=' .repeat(80));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const parsedArgs = parseArgs({
  args,
  options: {
    'dry-run': { type: 'boolean', default: false },
    'type': { type: 'string', default: 'all' },
    'path': { type: 'string' },
    'backup': { type: 'boolean', default: true }
  }
});

const options: MigrationOptions = {
  dryRun: parsedArgs.values['dry-run'] as boolean,
  type: parsedArgs.values.type as MigrationOptions['type'],
  path: parsedArgs.values.path as string | undefined,
  backup: parsedArgs.values.backup as boolean
};

// Run the migration
const migration = new MigrationScript(options);
migration.run().catch(console.error);