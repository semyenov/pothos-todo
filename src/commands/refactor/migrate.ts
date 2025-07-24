import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { readdir, readFile, writeFile, copyFile } from 'fs/promises';
import { join, relative, dirname } from 'path';
import inquirer from 'inquirer';

export default class RefactorMigrate extends Command {
  static override description = 'Automated migration to base classes';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --type singleton',
    '<%= config.bin %> <%= command.id %> --path src/infrastructure --type singleton',
    '<%= config.bin %> <%= command.id %> --type repository --backup',
  ];

  static override flags = {
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Preview changes without modifying files',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Migration type: singleton, repository, aggregate, all',
      options: ['singleton', 'repository', 'aggregate', 'all'],
      default: 'all',
    }),
    path: Flags.string({
      char: 'p',
      description: 'Specific path to migrate (default: src)',
      default: 'src',
    }),
    backup: Flags.boolean({
      char: 'b',
      description: 'Create backup files before migration',
      default: true,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompts',
      default: false,
    }),
  };

  private results: MigrationResult[] = [];

  async run(): Promise<void> {
    const { flags } = await this.parse(RefactorMigrate);
    
    this.log(chalk.blue('🔄 Starting Automated Migration'));
    this.log(chalk.gray(`Type: ${flags.type}`));
    this.log(chalk.gray(`Path: ${flags.path}`));
    this.log(chalk.gray(`Dry run: ${flags['dry-run']}`));
    this.log(chalk.gray(`Backup: ${flags.backup}\n`));

    if (!flags.force && !flags['dry-run']) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'This will modify source files. Continue?',
        default: false,
      }]);

      if (!confirm) {
        this.log(chalk.yellow('Migration cancelled'));
        return;
      }
    }

    try {
      const targetPath = flags.path;
      
      if (flags.type === 'all' || flags.type === 'singleton') {
        await this.migrateSingletons(targetPath, flags);
      }
      
      if (flags.type === 'all' || flags.type === 'repository') {
        await this.migrateRepositories(targetPath, flags);
      }
      
      if (flags.type === 'all' || flags.type === 'aggregate') {
        await this.migrateAggregates(targetPath, flags);
      }
      
      this.printResults(flags['dry-run']);

    } catch (error) {
      this.log(chalk.red('❌ Migration failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async migrateSingletons(basePath: string, flags: any): Promise<void> {
    this.log(chalk.blue('📦 Migrating Singleton Services...'));
    
    const files = await this.findFiles(basePath, /\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      if (this.isSingletonPattern(content)) {
        await this.migrateSingletonFile(file, content, flags);
      }
    }
  }

  private async migrateRepositories(basePath: string, flags: any): Promise<void> {
    this.log(chalk.blue('🗄️ Migrating Repositories...'));
    
    const files = await this.findFiles(basePath, /Repository\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      if (this.isRepositoryPattern(content)) {
        await this.migrateRepositoryFile(file, content, flags);
      }
    }
  }

  private async migrateAggregates(basePath: string, flags: any): Promise<void> {
    this.log(chalk.blue('🏗️ Migrating Aggregates...'));
    
    const files = await this.findFiles(basePath, /\/(aggregates|domain)\/.*\.(ts|js)$/);
    
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      
      if (this.isAggregatePattern(content)) {
        await this.migrateAggregateFile(file, content, flags);
      }
    }
  }

  private isSingletonPattern(content: string): boolean {
    return /private static instance:.*\|?\s*null/.test(content) &&
           /static getInstance\(\)/.test(content) &&
           /private constructor\(\)/.test(content);
  }

  private isRepositoryPattern(content: string): boolean {
    return /implements.*Repository/.test(content) &&
           (content.includes('findById') || content.includes('save') || content.includes('findAll'));
  }

  private isAggregatePattern(content: string): boolean {
    return (content.includes('_id') && content.includes('_createdAt') && content.includes('_updatedAt')) ||
           content.includes('addDomainEvent');
  }

  private async migrateSingletonFile(file: string, content: string, flags: any): Promise<void> {
    const className = this.extractClassName(content);
    if (!className) return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Skip if already migrated
      if (content.includes('extends SingletonService') || content.includes('extends AsyncSingletonService')) {
        return;
      }

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
      if (constructorMatch && !constructorMatch[1].includes('super()')) {
        newContent = newContent.replace(
          /protected constructor\(\)\s*{/,
          'protected constructor() {\n    super();'
        );
        changes.push('Added super() call to constructor');
      }

      // Update getInstance method
      if (needsAsync) {
        newContent = this.migrateAsyncGetInstance(newContent, className, changes);
      } else {
        newContent = this.migrateSyncGetInstance(newContent, className, changes);
      }

      await this.saveFile(file, newContent, changes, flags);

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

  private async migrateRepositoryFile(file: string, content: string, flags: any): Promise<void> {
    const className = this.extractClassName(content);
    if (!className || className === 'BaseRepository') return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Skip if already migrated
      if (content.includes('extends BaseRepository')) {
        return;
      }

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

      await this.saveFile(file, newContent, changes, flags);

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

  private async migrateAggregateFile(file: string, content: string, flags: any): Promise<void> {
    const className = this.extractClassName(content);
    if (!className || className === 'BaseAggregate') return;

    const changes: string[] = [];
    let newContent = content;

    try {
      // Skip if already migrated
      if (content.includes('extends BaseAggregate')) {
        return;
      }

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

      await this.saveFile(file, newContent, changes, flags);

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

  private needsAsyncInitialization(content: string): boolean {
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

  private migrateAsyncGetInstance(content: string, className: string, changes: string[]): string {
    changes.push('Added TODO for async getInstance migration');
    return content.replace(
      /static getInstance\(\)/,
      `// TODO: Migrate to async getInstance pattern
  static async getInstance(): Promise<${className}>`
    );
  }

  private extractRepositoryTypes(content: string): { domain: string; prisma: string } | null {
    const findByIdMatch = content.match(/findById\(.*?\):\s*Promise<(\w+)\s*\|/);
    if (findByIdMatch) {
      const domain = findByIdMatch[1];
      const prisma = `Prisma${domain}`;
      return { domain, prisma };
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

  private updateAggregateConstructor(content: string, className: string, changes: string[]): string {
    const constructorRegex = new RegExp(
      `constructor\\s*\\([^)]*\\)\\s*{([^}]+)}`,
      's'
    );
    
    const match = content.match(constructorRegex);
    if (match) {
      const constructorBody = match[1];
      
      if (!constructorBody.includes('super(')) {
        const lines = constructorBody.split('\n');
        const superCall = '    super(id, createdAt, updatedAt, version);';
        
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
    const updateMethodRegex = /update\([^)]*\)\s*{([^}]+this\._updatedAt\s*=\s*new Date\(\)[^}]+)}/gs;
    
    const matches = content.matchAll(updateMethodRegex);
    for (const match of matches) {
      const methodBody = match[1];
      
      const fieldUpdates = this.extractFieldUpdates(methodBody);
      
      if (fieldUpdates.length > 0) {
        const updateFieldsCall = `const hasChanges = this.updateFields({
${fieldUpdates.map(f => `      ${f}`).join(',\n')}
    });`;
        
        const newMethodBody = methodBody
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
      const field = match[1].substring(1);
      const value = match[2].trim();
      
      if (!['id', 'createdAt', 'updatedAt', 'version', 'events'].includes(field)) {
        updates.push(`${field}: ${value}`);
      }
    }
    
    return updates;
  }

  // Utility methods

  private extractClassName(content: string): string | null {
    const match = content.match(/export\s+class\s+(\w+)/);
    return match ? match[1] : null;
  }

  private inferModelName(className: string): string {
    return className.replace(/Repository$/, '').toLowerCase();
  }

  private addImport(content: string, importStatement: string): string {
    const lastImportIndex = content.lastIndexOf('import ');
    if (lastImportIndex !== -1) {
      const endOfLastImport = content.indexOf('\n', lastImportIndex);
      return content.slice(0, endOfLastImport + 1) + 
             importStatement + 
             content.slice(endOfLastImport + 1);
    }
    
    return importStatement + '\n' + content;
  }

  private addMethodToClass(content: string, className: string, method: string): string {
    const classRegex = new RegExp(`class ${className}[^{]*{`);
    const match = content.match(classRegex);
    
    if (match) {
      const classStart = match.index! + match[0].length;
      
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

  private async saveFile(file: string, content: string, changes: string[], flags: any): Promise<void> {
    if (changes.length === 0) return;

    if (flags['dry-run']) {
      this.results.push({
        file,
        type: this.detectFileType(file),
        changes,
        success: true
      });
      return;
    }

    try {
      if (flags.backup) {
        const backupPath = `${file}.backup`;
        await copyFile(file, backupPath);
      }

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

  private printResults(dryRun: boolean): void {
    this.log('\n📊 Migration Results:');
    this.log('=' .repeat(80));

    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    this.log(chalk.green(`\n✅ Successful migrations: ${successful.length}`));
    for (const result of successful) {
      this.log(chalk.green(`\n  📄 ${relative(process.cwd(), result.file)} (${result.type})`));
      for (const change of result.changes) {
        this.log(chalk.gray(`     • ${change}`));
      }
    }

    if (failed.length > 0) {
      this.log(chalk.red(`\n❌ Failed migrations: ${failed.length}`));
      for (const result of failed) {
        this.log(chalk.red(`\n  📄 ${relative(process.cwd(), result.file)}`));
        this.log(chalk.red(`     Error: ${result.error}`));
      }
    }

    if (dryRun) {
      this.log(chalk.yellow('\n⚠️  DRY RUN MODE - No files were modified'));
      this.log(chalk.yellow('Remove --dry-run flag to apply changes'));
    }

    this.log('\n' + '=' .repeat(80));
  }
}

interface MigrationResult {
  file: string;
  type: string;
  changes: string[];
  success: boolean;
  error?: string;
}