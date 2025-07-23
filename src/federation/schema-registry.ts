import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { EventStreamManager } from './event-streaming.js';
import { createHash } from 'crypto';
import semver from 'semver';

// Schema registry types
export interface SchemaVersion {
  id: string;
  version: string;
  schema: string;
  subgraph: string;
  timestamp: Date;
  author: string;
  changelog: string;
  hash: string;
  tags: string[];
  metadata: {
    federationVersion: string;
    breaking: boolean;
    deprecated: string[];
    added: string[];
    removed: string[];
  };
}

export interface SchemaRegistry {
  schemas: Map<string, SchemaVersion[]>; // subgraph -> versions
  aliases: Map<string, string>; // alias -> version
  locks: Map<string, string>; // subgraph -> locked version
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: Array<{
    type: 'breaking_change' | 'syntax_error' | 'federation_error';
    message: string;
    line?: number;
    column?: number;
  }>;
  warnings: Array<{
    type: 'deprecation' | 'best_practice' | 'performance';
    message: string;
  }>;
  compatibility: {
    backward: boolean;
    forward: boolean;
  };
  migration?: {
    required: boolean;
    steps: string[];
    impact: 'low' | 'medium' | 'high';
  };
}

// Schema registry manager
export class SchemaRegistryManager {
  private registry: SchemaRegistry;
  private registryPath: string;
  private eventManager: EventStreamManager;

  constructor(
    registryPath: string = 'schemas/registry',
    eventManager: EventStreamManager
  ) {
    this.registryPath = registryPath;
    this.eventManager = eventManager;
    this.registry = {
      schemas: new Map(),
      aliases: new Map(),
      locks: new Map(),
    };
    
    this.initializeRegistry();
  }

  private async initializeRegistry(): Promise<void> {
    try {
      await mkdir(this.registryPath, { recursive: true });
      await this.loadRegistry();
      logger.info(chalk.green('✅ Schema registry initialized'));
    } catch (error) {
      logger.error('Failed to initialize schema registry:', error);
    }
  }

  // Load registry from disk
  private async loadRegistry(): Promise<void> {
    try {
      const registryFile = join(this.registryPath, 'registry.json');
      const data = await readFile(registryFile, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Convert arrays back to Maps and Date objects
      this.registry.schemas = new Map(parsed.schemas.map(([key, versions]: [string, any[]]) => [
        key,
        versions.map(v => ({ ...v, timestamp: new Date(v.timestamp) }))
      ]));
      this.registry.aliases = new Map(parsed.aliases);
      this.registry.locks = new Map(parsed.locks);
      
      logger.info(chalk.blue(`Loaded ${this.registry.schemas.size} subgraph schemas`));
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        logger.warn('Failed to load existing registry:', error);
      }
    }
  }

  // Save registry to disk
  private async saveRegistry(): Promise<void> {
    try {
      const registryFile = join(this.registryPath, 'registry.json');
      const data = {
        schemas: Array.from(this.registry.schemas.entries()),
        aliases: Array.from(this.registry.aliases.entries()),
        locks: Array.from(this.registry.locks.entries()),
        timestamp: new Date().toISOString(),
      };
      
      await writeFile(registryFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save registry:', error);
    }
  }

  // Register a new schema version
  async registerSchema(
    subgraph: string,
    schema: string,
    options: {
      version?: string;
      author: string;
      changelog: string;
      tags?: string[];
      federationVersion?: string;
    }
  ): Promise<SchemaVersion> {
    logger.info(chalk.blue(`📝 Registering schema for ${subgraph}...`));

    // Generate version if not provided
    const version = options.version || this.generateNextVersion(subgraph);
    
    // Validate schema
    const validation = await this.validateSchema(subgraph, schema, version);
    if (!validation.valid) {
      throw new Error(`Schema validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    // Create schema version
    const schemaVersion: SchemaVersion = {
      id: this.generateId(),
      version,
      schema,
      subgraph,
      timestamp: new Date(),
      author: options.author,
      changelog: options.changelog,
      hash: this.generateHash(schema),
      tags: options.tags || [],
      metadata: {
        federationVersion: options.federationVersion || '2.5',
        breaking: !validation.compatibility.backward,
        deprecated: this.extractDeprecated(schema),
        added: this.extractAdded(schema, subgraph),
        removed: this.extractRemoved(schema, subgraph),
      },
    };

    // Add to registry
    if (!this.registry.schemas.has(subgraph)) {
      this.registry.schemas.set(subgraph, []);
    }
    this.registry.schemas.get(subgraph)!.push(schemaVersion);

    // Save schema file
    const schemaFile = join(this.registryPath, subgraph, `${version}.graphql`);
    await mkdir(join(this.registryPath, subgraph), { recursive: true });
    await writeFile(schemaFile, schema);

    // Save registry
    await this.saveRegistry();

    // Publish event
    await this.eventManager.publishEvent({
      type: 'schema.registered',
      source: 'schema-registry',
      data: {
        subgraph,
        version: schemaVersion.version,
        hash: schemaVersion.hash,
        breaking: schemaVersion.metadata.breaking,
      },
      metadata: {
        userId: options.author,
      },
    });

    logger.info(chalk.green(`✅ Registered ${subgraph} v${version}`));
    return schemaVersion;
  }

  // Get schema by subgraph and version
  async getSchema(subgraph: string, version?: string): Promise<SchemaVersion | null> {
    const versions = this.registry.schemas.get(subgraph);
    if (!versions || versions.length === 0) {
      return null;
    }

    if (!version || version === 'latest') {
      // Return latest version
      return versions[versions.length - 1];
    }

    if (version === 'locked') {
      // Return locked version
      const lockedVersion = this.registry.locks.get(subgraph);
      if (lockedVersion) {
        return versions.find(v => v.version === lockedVersion) || null;
      }
      return versions[versions.length - 1];
    }

    // Check aliases
    const aliasedVersion = this.registry.aliases.get(`${subgraph}:${version}`);
    if (aliasedVersion) {
      version = aliasedVersion;
    }

    // Find specific version
    return versions.find(v => v.version === version) || null;
  }

  // List all versions for a subgraph
  listVersions(subgraph: string): SchemaVersion[] {
    return this.registry.schemas.get(subgraph) || [];
  }

  // Compare two schema versions
  async compareSchemas(
    subgraph: string,
    fromVersion: string,
    toVersion: string
  ): Promise<{
    breaking: boolean;
    changes: Array<{
      type: 'added' | 'removed' | 'modified';
      category: 'type' | 'field' | 'directive' | 'enum_value';
      path: string;
      description: string;
    }>;
    migration: {
      required: boolean;
      steps: string[];
    };
  }> {
    const fromSchema = await this.getSchema(subgraph, fromVersion);
    const toSchema = await this.getSchema(subgraph, toVersion);

    if (!fromSchema || !toSchema) {
      throw new Error('Schema version not found');
    }

    // Simple diff implementation
    // In production, use proper GraphQL schema diffing tools
    const changes = this.diffSchemas(fromSchema.schema, toSchema.schema);
    const breaking = changes.some(c => this.isBreakingChange(c));

    return {
      breaking,
      changes,
      migration: {
        required: breaking,
        steps: this.generateMigrationSteps(changes),
      },
    };
  }

  // Validate schema compatibility
  private async validateSchema(
    subgraph: string,
    schema: string,
    version: string
  ): Promise<SchemaValidationResult> {
    const errors: SchemaValidationResult['errors'] = [];
    const warnings: SchemaValidationResult['warnings'] = [];

    try {
      // Basic syntax validation
      // In production, use proper GraphQL schema validation
      if (!schema.includes('type ') && !schema.includes('extend type')) {
        errors.push({
          type: 'syntax_error',
          message: 'Schema must contain at least one type definition',
        });
      }

      // Federation directive validation
      if (!schema.includes('@key') && !schema.includes('extend schema @link')) {
        warnings.push({
          type: 'federation_error',
          message: 'Schema should include federation directives for proper federation support',
        });
      }

      // Check for breaking changes
      const existingVersions = this.registry.schemas.get(subgraph) || [];
      let backward = true;
      let forward = true;

      if (existingVersions.length > 0) {
        const latestVersion = existingVersions[existingVersions.length - 1];
        const diff = this.diffSchemas(latestVersion.schema, schema);
        
        for (const change of diff) {
          if (this.isBreakingChange(change)) {
            backward = false;
            errors.push({
              type: 'breaking_change',
              message: `Breaking change detected: ${change.description}`,
            });
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        compatibility: { backward, forward },
        migration: errors.length > 0 ? {
          required: true,
          steps: ['Review breaking changes', 'Update client applications', 'Deploy with migration strategy'],
          impact: 'high',
        } : undefined,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          type: 'syntax_error',
          message: `Schema validation error: ${error}`,
        }],
        warnings: [],
        compatibility: { backward: false, forward: false },
      };
    }
  }

  // Simple schema diffing
  private diffSchemas(fromSchema: string, toSchema: string): Array<{
    type: 'added' | 'removed' | 'modified';
    category: 'type' | 'field' | 'directive' | 'enum_value';
    path: string;
    description: string;
  }> {
    const changes = [];

    // Extract types from schemas (simplified)
    const fromTypes = this.extractTypes(fromSchema);
    const toTypes = this.extractTypes(toSchema);

    // Find added types
    for (const type of toTypes) {
      if (!fromTypes.includes(type)) {
        changes.push({
          type: 'added' as const,
          category: 'type' as const,
          path: type,
          description: `Added type: ${type}`,
        });
      }
    }

    // Find removed types
    for (const type of fromTypes) {
      if (!toTypes.includes(type)) {
        changes.push({
          type: 'removed' as const,
          category: 'type' as const,
          path: type,
          description: `Removed type: ${type}`,
        });
      }
    }

    return changes;
  }

  private extractTypes(schema: string): string[] {
    const typeMatches = schema.match(/type\s+(\w+)/g) || [];
    return typeMatches.map(match => match.replace('type ', ''));
  }

  private isBreakingChange(change: any): boolean {
    return change.type === 'removed' || 
           (change.type === 'modified' && change.category === 'field');
  }

  private generateMigrationSteps(changes: any[]): string[] {
    const steps = [];
    
    if (changes.some(c => c.type === 'removed')) {
      steps.push('Update client queries to remove deleted fields');
    }
    
    if (changes.some(c => c.type === 'added')) {
      steps.push('Consider updating clients to use new fields');
    }
    
    return steps;
  }

  // Lock schema version
  async lockVersion(subgraph: string, version: string): Promise<void> {
    const schema = await this.getSchema(subgraph, version);
    if (!schema) {
      throw new Error(`Schema version ${version} not found for ${subgraph}`);
    }

    this.registry.locks.set(subgraph, version);
    await this.saveRegistry();

    await this.eventManager.publishEvent({
      type: 'schema.locked',
      source: 'schema-registry',
      data: { subgraph, version },
    });

    logger.info(chalk.yellow(`🔒 Locked ${subgraph} to version ${version}`));
  }

  // Create alias
  async createAlias(subgraph: string, alias: string, version: string): Promise<void> {
    const schema = await this.getSchema(subgraph, version);
    if (!schema) {
      throw new Error(`Schema version ${version} not found for ${subgraph}`);
    }

    this.registry.aliases.set(`${subgraph}:${alias}`, version);
    await this.saveRegistry();

    logger.info(chalk.blue(`🏷️  Created alias ${alias} -> ${version} for ${subgraph}`));
  }

  // Generate next semantic version
  private generateNextVersion(subgraph: string): string {
    const versions = this.registry.schemas.get(subgraph) || [];
    if (versions.length === 0) {
      return '1.0.0';
    }

    const latestVersion = versions[versions.length - 1].version;
    const nextPatch = semver.inc(latestVersion, 'patch');
    return nextPatch || '1.0.0';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateHash(schema: string): string {
    return createHash('sha256').update(schema).digest('hex');
  }

  private extractDeprecated(schema: string): string[] {
    const deprecatedMatches = schema.match(/@deprecated\s*\(?\s*reason:\s*"([^"]+)"/g) || [];
    return deprecatedMatches.map(match => match.replace(/@deprecated\s*\(?\s*reason:\s*"([^"]+)"/, '$1'));
  }

  private extractAdded(schema: string, subgraph: string): string[] {
    // In a real implementation, this would compare with the previous version
    return [];
  }

  private extractRemoved(schema: string, subgraph: string): string[] {
    // In a real implementation, this would compare with the previous version
    return [];
  }

  // Export schema registry
  async exportRegistry(): Promise<{
    metadata: {
      version: string;
      timestamp: string;
      subgraphs: number;
      totalVersions: number;
    };
    registry: any;
  }> {
    const totalVersions = Array.from(this.registry.schemas.values())
      .reduce((sum, versions) => sum + versions.length, 0);

    return {
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        subgraphs: this.registry.schemas.size,
        totalVersions,
      },
      registry: {
        schemas: Object.fromEntries(this.registry.schemas),
        aliases: Object.fromEntries(this.registry.aliases),
        locks: Object.fromEntries(this.registry.locks),
      },
    };
  }

  // Import schema registry
  async importRegistry(data: any): Promise<void> {
    try {
      this.registry.schemas = new Map(Object.entries(data.registry.schemas));
      this.registry.aliases = new Map(Object.entries(data.registry.aliases));
      this.registry.locks = new Map(Object.entries(data.registry.locks));

      await this.saveRegistry();
      logger.info(chalk.green('✅ Registry imported successfully'));
    } catch (error) {
      logger.error('Failed to import registry:', error);
      throw error;
    }
  }

  // Get registry statistics
  getStatistics(): {
    subgraphs: number;
    totalVersions: number;
    averageVersionsPerSubgraph: number;
    latestVersions: Record<string, string>;
    lockedVersions: Record<string, string>;
    recentActivity: Array<{
      subgraph: string;
      version: string;
      timestamp: Date;
      author: string;
    }>;
  } {
    const subgraphs = Array.from(this.registry.schemas.keys());
    const totalVersions = Array.from(this.registry.schemas.values())
      .reduce((sum, versions) => sum + versions.length, 0);

    const latestVersions: Record<string, string> = {};
    const recentActivity: any[] = [];

    for (const [subgraph, versions] of this.registry.schemas.entries()) {
      if (versions.length > 0) {
        const latest = versions[versions.length - 1];
        latestVersions[subgraph] = latest.version;
        
        // Add recent versions to activity
        versions.slice(-3).forEach(version => {
          recentActivity.push({
            subgraph,
            version: version.version,
            timestamp: version.timestamp,
            author: version.author,
          });
        });
      }
    }

    // Sort by timestamp
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      subgraphs: subgraphs.length,
      totalVersions,
      averageVersionsPerSubgraph: totalVersions / subgraphs.length || 0,
      latestVersions,
      lockedVersions: Object.fromEntries(this.registry.locks.entries()),
      recentActivity: recentActivity.slice(0, 10),
    };
  }
}

// CLI for schema registry
export class SchemaRegistryCLI {
  constructor(private registry: SchemaRegistryManager) {}

  async executeCommand(command: string, args: string[]): Promise<string> {
    switch (command) {
      case 'register':
        return this.handleRegister(args);
      case 'list':
        return this.handleList(args);
      case 'get':
        return this.handleGet(args);
      case 'compare':
        return this.handleCompare(args);
      case 'lock':
        return this.handleLock(args);
      case 'alias':
        return this.handleAlias(args);
      case 'stats':
        return this.handleStats();
      default:
        return `Unknown command: ${command}`;
    }
  }

  private async handleRegister(args: string[]): Promise<string> {
    const [subgraph, schemaFile, version, author, changelog] = args;
    
    if (!subgraph || !schemaFile || !author) {
      return 'Usage: register <subgraph> <schema-file> [version] <author> [changelog]';
    }

    try {
      const schema = await readFile(schemaFile, 'utf-8');
      const result = await this.registry.registerSchema(subgraph, schema, {
        version,
        author,
        changelog: changelog || 'No changelog provided',
      });

      return `Successfully registered ${subgraph} v${result.version}`;
    } catch (error) {
      return `Failed to register schema: ${error}`;
    }
  }

  private async handleList(args: string[]): Promise<string> {
    const [subgraph] = args;
    
    if (subgraph) {
      const versions = this.registry.listVersions(subgraph);
      if (versions.length === 0) {
        return `No versions found for ${subgraph}`;
      }
      
      return versions.map(v => 
        `${v.version} (${v.timestamp.toISOString()}) by ${v.author}`
      ).join('\n');
    } else {
      const stats = this.registry.getStatistics();
      return Object.entries(stats.latestVersions)
        .map(([sg, ver]) => `${sg}: ${ver}`)
        .join('\n');
    }
  }

  private async handleGet(args: string[]): Promise<string> {
    const [subgraph, version] = args;
    
    if (!subgraph) {
      return 'Usage: get <subgraph> [version]';
    }

    const schema = await this.registry.getSchema(subgraph, version);
    if (!schema) {
      return `Schema not found: ${subgraph}${version ? ` v${version}` : ''}`;
    }

    return schema.schema;
  }

  private async handleCompare(args: string[]): Promise<string> {
    const [subgraph, fromVersion, toVersion] = args;
    
    if (!subgraph || !fromVersion || !toVersion) {
      return 'Usage: compare <subgraph> <from-version> <to-version>';
    }

    try {
      const comparison = await this.registry.compareSchemas(subgraph, fromVersion, toVersion);
      
      let result = `Comparison: ${subgraph} ${fromVersion} -> ${toVersion}\n`;
      result += `Breaking changes: ${comparison.breaking ? 'YES' : 'NO'}\n`;
      result += `Changes:\n`;
      
      for (const change of comparison.changes) {
        result += `  ${change.type}: ${change.description}\n`;
      }
      
      if (comparison.migration.required) {
        result += `\nMigration steps:\n`;
        for (const step of comparison.migration.steps) {
          result += `  - ${step}\n`;
        }
      }
      
      return result;
    } catch (error) {
      return `Failed to compare schemas: ${error}`;
    }
  }

  private async handleLock(args: string[]): Promise<string> {
    const [subgraph, version] = args;
    
    if (!subgraph || !version) {
      return 'Usage: lock <subgraph> <version>';
    }

    try {
      await this.registry.lockVersion(subgraph, version);
      return `Locked ${subgraph} to version ${version}`;
    } catch (error) {
      return `Failed to lock version: ${error}`;
    }
  }

  private async handleAlias(args: string[]): Promise<string> {
    const [subgraph, alias, version] = args;
    
    if (!subgraph || !alias || !version) {
      return 'Usage: alias <subgraph> <alias> <version>';
    }

    try {
      await this.registry.createAlias(subgraph, alias, version);
      return `Created alias ${alias} -> ${version} for ${subgraph}`;
    } catch (error) {
      return `Failed to create alias: ${error}`;
    }
  }

  private handleStats(): string {
    const stats = this.registry.getStatistics();
    
    let result = `Schema Registry Statistics\n`;
    result += `=========================\n`;
    result += `Subgraphs: ${stats.subgraphs}\n`;
    result += `Total versions: ${stats.totalVersions}\n`;
    result += `Average versions per subgraph: ${stats.averageVersionsPerSubgraph.toFixed(1)}\n\n`;
    
    result += `Latest versions:\n`;
    for (const [subgraph, version] of Object.entries(stats.latestVersions)) {
      result += `  ${subgraph}: ${version}\n`;
    }
    
    if (Object.keys(stats.lockedVersions).length > 0) {
      result += `\nLocked versions:\n`;
      for (const [subgraph, version] of Object.entries(stats.lockedVersions)) {
        result += `  ${subgraph}: ${version}\n`;
      }
    }
    
    result += `\nRecent activity:\n`;
    for (const activity of stats.recentActivity.slice(0, 5)) {
      result += `  ${activity.subgraph} v${activity.version} by ${activity.author}\n`;
    }
    
    return result;
  }
}

// Export instances
export const schemaRegistryManager = new SchemaRegistryManager(
  'schemas/registry',
  new EventStreamManager()
);

export const schemaRegistryCLI = new SchemaRegistryCLI(schemaRegistryManager);