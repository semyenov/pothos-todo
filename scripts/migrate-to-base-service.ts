#!/usr/bin/env bun

import { readFile, writeFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { parseArgs } from 'util';

/**
 * Automated migration script for converting services to new BaseService architecture
 * 
 * Usage:
 *   bun scripts/migrate-to-base-service.ts --path src/infrastructure --dry-run
 *   bun scripts/migrate-to-base-service.ts --path src/infrastructure/ai --type async
 *   bun scripts/migrate-to-base-service.ts --file src/infrastructure/cache/CacheService.ts
 */

interface MigrationOptions {
  path?: string;
  file?: string;
  type?: 'sync' | 'async';
  dryRun?: boolean;
  verbose?: boolean;
}

interface ServiceInfo {
  filePath: string;
  className: string;
  currentBase?: string;
  hasEventEmitter: boolean;
  hasAsyncInit: boolean;
  hasSingleton: boolean;
  hasConfig: boolean;
  dependencies: string[];
}

const SERVICE_PATTERNS = {
  singleton: /extends\s+(SingletonService|AsyncSingletonService|EventEmitterSingletonService|AsyncEventEmitterSingletonService)/,
  getInstance: /static\s+(?:async\s+)?getInstance\s*\([^)]*\)\s*(?::\s*\w+|\s*\{)/,
  eventEmitter: /extends\s+.*EventEmitter|emit\s*\(|on\s*\(|once\s*\(/,
  asyncInit: /async\s+initialize|async\s+init|async\s+connect|await\s+.*\.connect/,
  config: /this\.config\s*=|config:\s*\w+Config/,
};

const MIGRATION_TEMPLATES = {
  imports: `import { BaseService } from '../core/BaseService.js';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';
import { ServiceEventMap } from '../core/ServiceEventMaps.js';
import { z } from 'zod';`,

  configSchema: (serviceName: string) => `
// Configuration schema
const ${serviceName}ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  // Add service-specific configuration here
});

export type ${serviceName}Config = z.infer<typeof ${serviceName}ConfigSchema>;`,

  eventMap: (serviceName: string) => `
// Event map for type-safe event emissions
export interface ${serviceName}EventMap extends ServiceEventMap {
  // Add service-specific events here
  // 'event:name': { property: type };
}`,

  serviceDecorator: (serviceName: string) => `@ServiceConfig({
  schema: ${serviceName}ConfigSchema,
  prefix: '${serviceName.toLowerCase().replace(/service$/, '')}',
  hot: true,
})`,

  classDeclaration: (className: string, baseClass: string, configType: string, eventMap: string) => 
    `export class ${className} extends ${baseClass}<${configType}, ${eventMap}>`,

  getInstance: (isAsync: boolean) => isAsync ? `
  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<${className}> {
    return super.getInstance();
  }` : `
  /**
   * Get the singleton instance
   */
  static getInstance(): ${className} {
    return super.getInstance();
  }`,

  serviceMethods: `
  protected getServiceName(): string {
    return '${serviceName}';
  }

  protected getServiceVersion(): string {
    return '2.0.0';
  }

  protected getServiceDescription(): string {
    return 'Service description';
  }`,

  healthCheck: `
  @HealthCheck({
    name: '${serviceName}:health',
    critical: true,
    interval: 30000,
  })
  async checkHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    // Implement health check logic
    return { status: 'healthy', message: 'Service is healthy' };
  }`,
};

async function parseArguments(): Promise<MigrationOptions> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      path: { type: 'string' },
      file: { type: 'string' },
      type: { type: 'string' },
      'dry-run': { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  });

  return {
    path: values.path as string,
    file: values.file as string,
    type: values.type as 'sync' | 'async',
    dryRun: values['dry-run'] || false,
    verbose: values.verbose || false,
  };
}

async function findServiceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      files.push(...await findServiceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      const content = await readFile(fullPath, 'utf-8');
      if (SERVICE_PATTERNS.singleton.test(content) || SERVICE_PATTERNS.getInstance.test(content)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function analyzeService(filePath: string): Promise<ServiceInfo> {
  const content = await readFile(filePath, 'utf-8');
  
  // Extract class name
  const classMatch = content.match(/export\s+class\s+(\w+)/);
  const className = classMatch?.[1] || 'UnknownService';
  
  // Check current base class
  const baseMatch = content.match(/extends\s+(\w+)/);
  const currentBase = baseMatch?.[1];
  
  // Analyze service characteristics
  const hasEventEmitter = SERVICE_PATTERNS.eventEmitter.test(content);
  const hasAsyncInit = SERVICE_PATTERNS.asyncInit.test(content);
  const hasSingleton = SERVICE_PATTERNS.singleton.test(content);
  const hasConfig = SERVICE_PATTERNS.config.test(content);
  
  // Extract dependencies
  const dependencies: string[] = [];
  const depMatches = content.matchAll(/private\s+(\w+):\s*(\w+);/g);
  for (const match of depMatches) {
    dependencies.push(match[1]);
  }

  return {
    filePath,
    className,
    currentBase,
    hasEventEmitter,
    hasAsyncInit,
    hasSingleton,
    hasConfig,
    dependencies,
  };
}

function determineTargetBase(info: ServiceInfo, preferredType?: 'sync' | 'async'): string {
  if (preferredType === 'async' || info.hasAsyncInit) {
    return 'BaseAsyncService';
  }
  return 'BaseService';
}

async function generateMigratedCode(info: ServiceInfo, originalContent: string): Promise<string> {
  const baseClass = determineTargetBase(info);
  const isAsync = baseClass === 'BaseAsyncService';
  const serviceName = info.className.replace(/Service$/, '');
  const configType = `${info.className}Config`;
  const eventMap = info.hasEventEmitter ? `${info.className}EventMap` : 'ServiceEventMap';

  let migratedCode = originalContent;

  // Add imports
  if (!migratedCode.includes("from '../core/BaseService")) {
    const importIndex = migratedCode.indexOf('import');
    migratedCode = MIGRATION_TEMPLATES.imports + '\n' + migratedCode.substring(importIndex);
  }

  // Add config schema if needed
  if (info.hasConfig && !migratedCode.includes('ConfigSchema')) {
    const classIndex = migratedCode.indexOf(`export class ${info.className}`);
    migratedCode = migratedCode.substring(0, classIndex) + 
                  MIGRATION_TEMPLATES.configSchema(serviceName) + '\n' +
                  migratedCode.substring(classIndex);
  }

  // Add event map if needed
  if (info.hasEventEmitter && !migratedCode.includes('EventMap extends ServiceEventMap')) {
    const classIndex = migratedCode.indexOf(`export class ${info.className}`);
    migratedCode = migratedCode.substring(0, classIndex) + 
                  MIGRATION_TEMPLATES.eventMap(info.className) + '\n' +
                  migratedCode.substring(classIndex);
  }

  // Replace class declaration
  const classRegex = new RegExp(`export\\s+class\\s+${info.className}\\s+extends\\s+\\w+(?:<[^>]+>)?`);
  migratedCode = migratedCode.replace(
    classRegex,
    MIGRATION_TEMPLATES.serviceDecorator(serviceName) + '\n' +
    MIGRATION_TEMPLATES.classDeclaration(info.className, baseClass, configType, eventMap)
  );

  // Update getInstance method
  const getInstanceRegex = /static\s+(?:async\s+)?getInstance\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{[^}]+\}/;
  migratedCode = migratedCode.replace(
    getInstanceRegex,
    MIGRATION_TEMPLATES.getInstance(isAsync).replace(/\${className}/g, info.className)
  );

  // Add required service methods if not present
  if (!migratedCode.includes('getServiceName()')) {
    const constructorIndex = migratedCode.indexOf('constructor');
    if (constructorIndex > -1) {
      const constructorEnd = findMatchingBrace(migratedCode, constructorIndex);
      migratedCode = migratedCode.substring(0, constructorEnd + 1) + '\n' +
                    MIGRATION_TEMPLATES.serviceMethods.replace(/\${serviceName}/g, serviceName) + '\n' +
                    migratedCode.substring(constructorEnd + 1);
    }
  }

  // Add health check if not present
  if (!migratedCode.includes('@HealthCheck')) {
    const lastMethodIndex = migratedCode.lastIndexOf('}');
    migratedCode = migratedCode.substring(0, lastMethodIndex) +
                  MIGRATION_TEMPLATES.healthCheck.replace(/\${serviceName}/g, serviceName) + '\n' +
                  migratedCode.substring(lastMethodIndex);
  }

  // Update lifecycle methods
  migratedCode = migratedCode
    .replace(/private\s+async\s+initialize\s*\(/g, 'protected async onInitialize(')
    .replace(/private\s+async\s+start\s*\(/g, 'protected async onStart(')
    .replace(/private\s+async\s+stop\s*\(/g, 'protected async onStop(');

  return migratedCode;
}

function findMatchingBrace(content: string, startIndex: number): number {
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    
    if (!inString) {
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return i;
        }
      }
    } else if (char === stringChar && content[i - 1] !== '\\') {
      inString = false;
    }
  }
  
  return -1;
}

async function migrateService(info: ServiceInfo, options: MigrationOptions): Promise<void> {
  console.log(`\n📄 Migrating ${info.className} (${relative(process.cwd(), info.filePath)})`);
  console.log(`  Current base: ${info.currentBase || 'none'}`);
  console.log(`  Has EventEmitter: ${info.hasEventEmitter}`);
  console.log(`  Has Async Init: ${info.hasAsyncInit}`);
  console.log(`  Target base: ${determineTargetBase(info, options.type)}`);

  if (options.dryRun) {
    console.log('  ✅ Would migrate (dry run)');
    return;
  }

  try {
    const originalContent = await readFile(info.filePath, 'utf-8');
    const migratedContent = await generateMigratedCode(info, originalContent);
    
    // Create backup
    const backupPath = info.filePath.replace('.ts', '.backup.ts');
    await writeFile(backupPath, originalContent);
    
    // Write migrated content
    await writeFile(info.filePath, migratedContent);
    
    console.log('  ✅ Migrated successfully');
    console.log(`  📦 Backup saved to ${relative(process.cwd(), backupPath)}`);
  } catch (error) {
    console.error(`  ❌ Migration failed: ${error}`);
  }
}

async function main() {
  const options = await parseArguments();
  
  console.log('🚀 Service Migration Tool');
  console.log('========================');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  
  let files: string[] = [];
  
  if (options.file) {
    files = [options.file];
  } else if (options.path) {
    files = await findServiceFiles(options.path);
  } else {
    console.error('❌ Please specify --path or --file');
    process.exit(1);
  }
  
  console.log(`\nFound ${files.length} service(s) to migrate`);
  
  const serviceInfos: ServiceInfo[] = [];
  for (const file of files) {
    const info = await analyzeService(file);
    serviceInfos.push(info);
  }
  
  // Group by migration complexity
  const simple = serviceInfos.filter(s => !s.hasEventEmitter && !s.hasAsyncInit);
  const medium = serviceInfos.filter(s => s.hasEventEmitter || s.hasAsyncInit);
  const complex = serviceInfos.filter(s => s.hasEventEmitter && s.hasAsyncInit);
  
  console.log(`\nMigration Complexity:`);
  console.log(`  Simple: ${simple.length} services`);
  console.log(`  Medium: ${medium.length} services`);
  console.log(`  Complex: ${complex.length} services`);
  
  // Migrate services
  for (const info of serviceInfos) {
    await migrateService(info, options);
  }
  
  console.log('\n✨ Migration complete!');
  
  if (!options.dryRun) {
    console.log('\n📋 Next steps:');
    console.log('  1. Review the migrated files');
    console.log('  2. Update configuration schemas in src/config/schemas/');
    console.log('  3. Define event maps in src/infrastructure/core/InfrastructureEventMaps.ts');
    console.log('  4. Run type checking: bun run check:types');
    console.log('  5. Remove backup files after verification');
  }
}

main().catch(console.error);