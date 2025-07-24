import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export default class PulumiConfig extends Command {
    static override description = 'Manage Pulumi configuration';

    static override examples = [
        '<%= config.bin %> <%= command.id %> --operation list',
        '<%= config.bin %> <%= command.id %> --operation set --key aws:region --value us-east-1',
    ];

    static override flags = {
        operation: Flags.string({
            description: 'Configuration operation',
            options: ['list', 'set', 'remove', 'set-secret', 'export', 'import'],
            required: true,
        }),
        key: Flags.string({
            description: 'Configuration key',
        }),
        value: Flags.string({
            description: 'Configuration value',
        }),
        stack: Flags.string({
            description: 'Stack name',
        }),
        file: Flags.string({
            description: 'File path for import/export operations',
        }),
        output: Flags.string({
            description: 'Output format',
            options: ['text', 'json', 'yaml'],
            default: 'text',
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(PulumiConfig);

        try {
            await this.handleConfigOperation(flags);
        } catch (error) {
            this.error(`Failed to handle config operation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleConfigOperation(flags: any): Promise<void> {
        const { operation, key, value, stack, file, output } = flags;

        switch (operation) {
            case 'list':
                await this.listConfig(stack, output);
                break;
            case 'set':
                await this.setConfig(key, value, stack);
                break;
            case 'remove':
                await this.removeConfig(key, stack);
                break;
            case 'set-secret':
                await this.setSecret(key, value, stack);
                break;
            case 'export':
                await this.exportConfig(stack, file, output);
                break;
            case 'import':
                await this.importConfig(stack, file);
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    }

    private async listConfig(stack?: string, output?: string): Promise<void> {
        this.log(chalk.blue('📋 Pulumi Configuration'));
        this.log('='.repeat(50));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            const args = ['config'];
            if (stack) args.push('--stack', stack);
            if (output === 'json') args.push('--json');
            if (output === 'yaml') args.push('--show-urns');

            const result = await executeCommand('pulumi', args, { silent: true });

            if (output === 'json') {
                this.log(result);
            } else {
                this.log(this.formatConfigOutput(result));
            }
        } catch (error) {
            this.log(chalk.red('Failed to list configuration'));
            this.log(chalk.gray('Make sure you are in a Pulumi project directory'));
        }
    }

    private async setConfig(key?: string, value?: string, stack?: string): Promise<void> {
        if (!key || !value) {
            this.log(chalk.red('Key and value are required for set operation'));
            return;
        }

        this.log(chalk.blue('🔧 Setting Configuration'));
        this.log('='.repeat(50));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            const args = ['config', 'set', key, value];
            if (stack) args.push('--stack', stack);

            await executeCommand('pulumi', args, { silent: false });
            this.log(chalk.green(`✅ Configuration set: ${key} = ${value}`));
        } catch (error) {
            this.log(chalk.red('Failed to set configuration'));
        }
    }

    private async removeConfig(key?: string, stack?: string): Promise<void> {
        if (!key) {
            this.log(chalk.red('Key is required for remove operation'));
            return;
        }

        this.log(chalk.blue('🗑️ Removing Configuration'));
        this.log('='.repeat(50));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            const args = ['config', 'rm', key];
            if (stack) args.push('--stack', stack);

            await executeCommand('pulumi', args, { silent: false });
            this.log(chalk.green(`✅ Configuration removed: ${key}`));
        } catch (error) {
            this.log(chalk.red('Failed to remove configuration'));
        }
    }

    private async setSecret(key?: string, value?: string, stack?: string): Promise<void> {
        if (!key || !value) {
            this.log(chalk.red('Key and value are required for set-secret operation'));
            return;
        }

        this.log(chalk.blue('🔐 Setting Secret Configuration'));
        this.log('='.repeat(50));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            const args = ['config', 'set', '--secret', key, value];
            if (stack) args.push('--stack', stack);

            await executeCommand('pulumi', args, { silent: false });
            this.log(chalk.green(`✅ Secret configuration set: ${key} = [SECRET]`));
        } catch (error) {
            this.log(chalk.red('Failed to set secret configuration'));
        }
    }

    private async exportConfig(stack?: string, file?: string, output?: string): Promise<void> {
        this.log(chalk.blue('📤 Exporting Configuration'));
        this.log('='.repeat(50));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            // Get current configuration
            const args = ['config'];
            if (stack) args.push('--stack', stack);
            if (output === 'json') args.push('--json');

            const configData = await executeCommand('pulumi', args, { silent: true });

            // Determine output file
            const outputFile = file || `pulumi-config-${stack || 'default'}-${new Date().toISOString().split('T')[0]}.${output || 'json'}`;

            let content = '';
            if (output === 'json') {
                content = configData;
            } else if (output === 'yaml') {
                content = this.convertToYaml(configData);
            } else {
                content = this.formatConfigOutput(configData);
            }

            await fs.writeFile(outputFile, content);
            this.log(chalk.green(`✅ Configuration exported to: ${outputFile}`));
        } catch (error) {
            this.log(chalk.red('Failed to export configuration'));
        }
    }

    private async importConfig(stack?: string, file?: string): Promise<void> {
        if (!file) {
            this.log(chalk.red('File is required for import operation'));
            return;
        }

        this.log(chalk.blue('📥 Importing Configuration'));
        this.log('='.repeat(50));

        try {
            // Check if file exists
            await fs.access(file);

            const { executeCommand } = await import('../../lib/utils.js');

            // Read and parse configuration file
            const content = await fs.readFile(file, 'utf-8');
            const config = this.parseConfigFile(content, path.extname(file));

            // Import each configuration item
            for (const [key, value] of Object.entries(config)) {
                const args = ['config', 'set', key, value as string];
                if (stack) args.push('--stack', stack);

                await executeCommand('pulumi', args, { silent: false });
                this.log(chalk.green(`✅ Imported: ${key} = ${value}`));
            }

            this.log(chalk.green(`✅ Configuration imported from: ${file}`));
        } catch (error) {
            this.log(chalk.red('Failed to import configuration'));
            this.log(chalk.gray('Make sure the file exists and is in the correct format'));
        }
    }

    private formatConfigOutput(output: string): string {
        // Parse and format the Pulumi config output
        const lines = output.split('\n').filter(line => line.trim());

        if (lines.length === 0) {
            return chalk.yellow('No configuration found');
        }

        let formatted = chalk.cyan('📋 Configuration:\n');

        lines.forEach(line => {
            if (line.includes(':')) {
                const [key, value] = line.split(':').map(s => s.trim());
                if (key && value) {
                    formatted += `  ${chalk.blue(key)}: ${chalk.green(value)}\n`;
                }
            } else {
                formatted += `  ${line}\n`;
            }
        });

        return formatted;
    }

    private convertToYaml(jsonData: string): string {
        try {
            const config = JSON.parse(jsonData);
            let yaml = '# Pulumi Configuration\n';
            yaml += `# Exported on ${new Date().toISOString()}\n\n`;

            Object.entries(config).forEach(([key, value]) => {
                yaml += `${key}: ${value}\n`;
            });

            return yaml;
        } catch {
            return jsonData; // Return as-is if not valid JSON
        }
    }

    private parseConfigFile(content: string, extension: string): Record<string, string> {
        const config: Record<string, string> = {};

        if (extension === '.json') {
            try {
                const jsonConfig = JSON.parse(content);
                Object.entries(jsonConfig).forEach(([key, value]) => {
                    config[key] = String(value);
                });
            } catch {
                throw new Error('Invalid JSON format');
            }
        } else if (extension === '.yaml' || extension === '.yml') {
            // Simple YAML parsing for key-value pairs
            const lines = content.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const colonIndex = trimmed.indexOf(':');
                    if (colonIndex > 0) {
                        const key = trimmed.substring(0, colonIndex).trim();
                        const value = trimmed.substring(colonIndex + 1).trim();
                        if (key && value) {
                            config[key] = value;
                        }
                    }
                }
            });
        } else {
            // Assume simple key=value format
            const lines = content.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const equalIndex = trimmed.indexOf('=');
                    if (equalIndex > 0) {
                        const key = trimmed.substring(0, equalIndex).trim();
                        const value = trimmed.substring(equalIndex + 1).trim();
                        if (key && value) {
                            config[key] = value;
                        }
                    }
                }
            });
        }

        return config;
    }
} 