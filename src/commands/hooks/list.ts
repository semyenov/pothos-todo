import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export default class HooksList extends Command {
    static override description = 'List installed Git hooks';

    static override examples = [
        '<%= config.bin %> <%= command.id %> --format table',
        '<%= config.bin %> <%= command.id %> --format json --details',
    ];

    static override flags = {
        format: Flags.string({
            description: 'Output format',
            options: ['table', 'json', 'summary'],
            default: 'table',
        }),
        details: Flags.boolean({
            description: 'Show detailed hook information',
            default: false,
        }),
        hooksDir: Flags.string({
            description: 'Hooks directory path',
            default: '.git/hooks',
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(HooksList);

        try {
            await this.listHooks(flags);
        } catch (error) {
            this.error(`Failed to list hooks: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async listHooks(flags: any): Promise<void> {
        const { format, details, hooksDir } = flags;

        this.log(chalk.blue('📋 Git Hooks List'));
        this.log('='.repeat(50));

        try {
            const hooks = await this.getInstalledHooks(hooksDir);

            if (format === 'json') {
                this.log(JSON.stringify(hooks, null, 2));
            } else if (format === 'summary') {
                this.showSummary(hooks);
            } else {
                this.showTable(hooks, details);
            }
        } catch (error) {
            this.log(chalk.red('Failed to list hooks'));
            this.log(chalk.gray('Make sure you are in a Git repository'));
        }
    }

    private async getInstalledHooks(hooksDir: string): Promise<any[]> {
        const hooks: any[] = [];
        const standardHooks = [
            'applypatch-msg', 'pre-applypatch', 'post-applypatch',
            'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
            'pre-rebase', 'post-checkout', 'post-merge', 'pre-receive',
            'update', 'post-receive', 'post-update', 'push-to-checkout',
            'pre-auto-gc', 'post-rewrite', 'pre-push', 'pre-merge-commit',
            'post-index-change'
        ];

        for (const hookName of standardHooks) {
            const hookPath = path.join(hooksDir, hookName);
            try {
                const stats = await fs.stat(hookPath);
                const content = await fs.readFile(hookPath, 'utf-8');

                hooks.push({
                    name: hookName,
                    path: hookPath,
                    size: stats.size,
                    modified: stats.mtime,
                    executable: (stats.mode & 0o111) !== 0,
                    content: content.substring(0, 500), // First 500 chars
                    fullContent: content,
                    isCustom: !this.isStandardHook(content),
                    configuration: this.extractConfiguration(content)
                });
            } catch {
                // Hook doesn't exist
            }
        }

        return hooks;
    }

    private isStandardHook(content: string): boolean {
        // Check if this is a standard Git hook or a custom one
        const standardIndicators = [
            '#!/bin/sh',
            '#!/bin/bash',
            'exec git',
            'git-'
        ];

        return standardIndicators.some(indicator => content.includes(indicator));
    }

    private extractConfiguration(content: string): any {
        const config: any = {};

        // Extract checks from pre-commit hook
        const checksMatch = content.match(/CHECKS="([^"]+)"/);
        if (checksMatch) {
            config.checks = checksMatch[1].split(' ').filter(Boolean);
        }

        // Extract skip checks
        const skipChecksMatch = content.match(/SKIP_CHECKS="([^"]+)"/);
        if (skipChecksMatch) {
            config.skipChecks = skipChecksMatch[1].split(' ').filter(Boolean);
        }

        // Extract patterns from commit-msg hook
        const patternsMatch = content.match(/PATTERNS="([^"]+)"/);
        if (patternsMatch) {
            config.patterns = patternsMatch[1].split('|');
        }

        // Extract max length
        const maxLengthMatch = content.match(/MAX_LENGTH=(\d+)/);
        if (maxLengthMatch) {
            config.maxLength = parseInt(maxLengthMatch[1]);
        }

        // Extract options
        const optionsMatch = content.match(/HOOK_OPTIONS='([^']+)'/);
        if (optionsMatch) {
            try {
                config.options = JSON.parse(optionsMatch[1]);
            } catch {
                config.options = [];
            }
        }

        return config;
    }

    private showTable(hooks: any[], details: boolean): void {
        if (hooks.length === 0) {
            this.log(chalk.yellow('No hooks installed'));
            return;
        }

        this.log(chalk.cyan('\n📊 Installed Hooks:'));
        this.log('-'.repeat(80));

        // Header
        const header = [
            'Hook Name',
            'Status',
            'Size',
            'Modified',
            'Type'
        ];

        if (details) {
            header.push('Configuration');
        }

        this.log(this.formatRow(header, true));

        // Rows
        hooks.forEach(hook => {
            const status = hook.executable ? chalk.green('✅ Active') : chalk.red('❌ Inactive');
            const size = this.formatBytes(hook.size);
            const modified = hook.modified.toLocaleDateString();
            const type = hook.isCustom ? chalk.blue('Custom') : chalk.gray('Standard');

            const row = [
                hook.name,
                status,
                size,
                modified,
                type
            ];

            if (details) {
                const config = Object.keys(hook.configuration).length > 0
                    ? JSON.stringify(hook.configuration, null, 2)
                    : 'None';
                row.push(config);
            }

            this.log(this.formatRow(row));
        });

        this.log('-'.repeat(80));
        this.log(chalk.gray(`Total hooks: ${hooks.length}`));
    }

    private showSummary(hooks: any[]): void {
        if (hooks.length === 0) {
            this.log(chalk.yellow('No hooks installed'));
            return;
        }

        this.log(chalk.cyan('\n📈 Hooks Summary:'));
        this.log('-'.repeat(40));

        const activeHooks = hooks.filter(h => h.executable);
        const customHooks = hooks.filter(h => h.isCustom);
        const standardHooks = hooks.filter(h => !h.isCustom);

        this.log(`Total hooks: ${hooks.length}`);
        this.log(`Active hooks: ${activeHooks.length}`);
        this.log(`Custom hooks: ${customHooks.length}`);
        this.log(`Standard hooks: ${standardHooks.length}`);

        if (customHooks.length > 0) {
            this.log(chalk.cyan('\n🔧 Custom Hooks:'));
            customHooks.forEach(hook => {
                this.log(`  - ${hook.name}`);
            });
        }

        if (activeHooks.length > 0) {
            this.log(chalk.cyan('\n✅ Active Hooks:'));
            activeHooks.forEach(hook => {
                const type = hook.isCustom ? chalk.blue('(Custom)') : chalk.gray('(Standard)');
                this.log(`  - ${hook.name} ${type}`);
            });
        }

        // Show configuration summary
        const hooksWithConfig = hooks.filter(h => Object.keys(h.configuration).length > 0);
        if (hooksWithConfig.length > 0) {
            this.log(chalk.cyan('\n⚙️ Configured Hooks:'));
            hooksWithConfig.forEach(hook => {
                const configKeys = Object.keys(hook.configuration);
                this.log(`  - ${hook.name}: ${configKeys.join(', ')}`);
            });
        }
    }

    private formatRow(cells: string[], isHeader = false): string {
        const widths = [20, 12, 10, 12, 10];
        if (cells.length > 5) {
            widths.push(30); // Configuration column
        }

        const formattedCells = cells.map((cell, index) => {
            const width = widths[index] || 10;
            return cell.padEnd(width).substring(0, width);
        });

        return formattedCells.join(' | ');
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
} 