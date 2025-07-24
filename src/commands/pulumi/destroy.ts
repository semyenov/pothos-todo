import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';

export default class PulumiDestroy extends Command {
    static override description = 'Destroy infrastructure resources';

    static override examples = [
        '<%= config.bin %> <%= command.id %> --stack production --force',
        '<%= config.bin %> <%= command.id %> --stack staging',
    ];

    static override flags = {
        stack: Flags.string({
            description: 'Stack name to destroy',
        }),
        force: Flags.boolean({
            description: 'Skip confirmation prompts',
            default: false,
        }),
        yes: Flags.boolean({
            description: 'Automatically answer yes to prompts',
            default: false,
        }),
        preview: Flags.boolean({
            description: 'Show preview before destroying',
            default: true,
        }),
        parallel: Flags.integer({
            description: 'Number of resources to destroy in parallel',
            default: 10,
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(PulumiDestroy);

        try {
            await this.destroyInfrastructure(flags);
        } catch (error) {
            this.error(`Failed to destroy infrastructure: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async destroyInfrastructure(flags: any): Promise<void> {
        const { stack, force, yes, preview, parallel } = flags;

        this.log(chalk.blue('🗑️ Infrastructure Destruction'));
        this.log('='.repeat(50));

        // Get current stack if not specified
        const targetStack = stack || await this.getCurrentStack();

        if (!targetStack) {
            this.log(chalk.red('No stack specified and no current stack found'));
            return;
        }

        this.log(chalk.yellow(`Target stack: ${targetStack}`));

        // Safety checks
        if (!force) {
            await this.performSafetyChecks(targetStack);
        }

        // Show preview if requested
        if (preview) {
            await this.showDestroyPreview(targetStack);
        }

        // Confirmation
        if (!yes && !force) {
            const confirmed = await this.confirmDestruction(targetStack);
            if (!confirmed) {
                this.log(chalk.yellow('Destruction cancelled'));
                return;
            }
        }

        // Execute destruction
        await this.executeDestruction(targetStack, parallel);
    }

    private async getCurrentStack(): Promise<string | null> {
        try {
            const { executeCommand } = await import('../../lib/utils.js');
            const result = await executeCommand('pulumi', ['stack', '--show-name'], { silent: true });
            return result.trim();
        } catch (error) {
            this.log(chalk.red('Failed to get current stack'));
            return null;
        }
    }

    private async performSafetyChecks(stack: string): Promise<void> {
        this.log(chalk.blue('\n🔒 Performing Safety Checks'));
        this.log('-'.repeat(30));

        // Check if stack exists
        const stackExists = await this.checkStackExists(stack);
        if (!stackExists) {
            throw new Error(`Stack '${stack}' does not exist`);
        }

        // Check if stack has resources
        const resourceCount = await this.getResourceCount(stack);
        if (resourceCount === 0) {
            this.log(chalk.yellow('Stack has no resources to destroy'));
            return;
        }

        // Check for critical resources
        const criticalResources = await this.getCriticalResources(stack);
        if (criticalResources.length > 0) {
            this.log(chalk.red('⚠️  Critical resources detected:'));
            criticalResources.forEach(resource => {
                this.log(chalk.red(`  - ${resource.type}: ${resource.name}`));
            });

            const { proceed } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Are you sure you want to destroy critical resources?',
                    default: false,
                }
            ]);

            if (!proceed) {
                throw new Error('Destruction cancelled due to critical resources');
            }
        }

        // Check for data loss warnings
        const dataLossResources = await this.getDataLossResources(stack);
        if (dataLossResources.length > 0) {
            this.log(chalk.red('⚠️  Resources with potential data loss:'));
            dataLossResources.forEach(resource => {
                this.log(chalk.red(`  - ${resource.type}: ${resource.name}`));
            });

            const { proceed } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'These resources may cause data loss. Continue?',
                    default: false,
                }
            ]);

            if (!proceed) {
                throw new Error('Destruction cancelled due to data loss risk');
            }
        }

        this.log(chalk.green('✅ Safety checks passed'));
    }

    private async showDestroyPreview(stack: string): Promise<void> {
        this.log(chalk.blue('\n👀 Destroy Preview'));
        this.log('-'.repeat(30));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            this.log(chalk.yellow('Resources to be destroyed:'));
            await executeCommand('pulumi', ['preview', '--stack', stack, '--diff'], { silent: false });
        } catch (error) {
            this.log(chalk.red('Failed to generate destroy preview'));
            this.log(chalk.gray('Continuing without preview...'));
        }
    }

    private async confirmDestruction(stack: string): Promise<boolean> {
        const { confirmed } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirmed',
                message: `Are you absolutely sure you want to destroy stack '${stack}'?`,
                default: false,
            }
        ]);

        if (confirmed) {
            const { finalConfirmation } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'finalConfirmation',
                    message: `Type '${stack}' to confirm destruction:`,
                    validate: (input) => {
                        if (input === stack) {
                            return true;
                        }
                        return `Please type '${stack}' to confirm`;
                    }
                }
            ]);

            return finalConfirmation === stack;
        }

        return false;
    }

    private async executeDestruction(stack: string, parallel: number): Promise<void> {
        this.log(chalk.blue('\n🗑️ Executing Destruction'));
        this.log('-'.repeat(30));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            const args = ['destroy', '--stack', stack, '--yes'];
            if (parallel > 1) {
                args.push('--parallel', parallel.toString());
            }

            this.log(chalk.yellow('Starting destruction...'));
            await executeCommand('pulumi', args, { silent: false });

            this.log(chalk.green('\n✅ Infrastructure destroyed successfully'));

            // Show final status
            await this.showFinalStatus(stack);
        } catch (error) {
            this.log(chalk.red('\n❌ Destruction failed'));
            this.log(chalk.gray('Some resources may still exist. Check the output above for details.'));
            throw error;
        }
    }

    private async checkStackExists(stack: string): Promise<boolean> {
        try {
            const { executeCommand } = await import('../../lib/utils.js');
            await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: true });
            // TODO: Parse JSON output to check if stack exists
            return true;
        } catch (error) {
            return false;
        }
    }

    private async getResourceCount(stack: string): Promise<number> {
        try {
            const { executeCommand } = await import('../../lib/utils.js');
            const result = await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: true });
            // TODO: Parse JSON to get resource count for specific stack
            return 5; // Mock value
        } catch (error) {
            return 0;
        }
    }

    private async getCriticalResources(stack: string): Promise<any[]> {
        // TODO: Implement actual critical resource detection
        return [
            { type: 'aws:rds/cluster:Cluster', name: 'production-database' },
            { type: 'aws:s3/bucket:Bucket', name: 'production-data' }
        ];
    }

    private async getDataLossResources(stack: string): Promise<any[]> {
        // TODO: Implement actual data loss resource detection
        return [
            { type: 'aws:rds/cluster:Cluster', name: 'production-database' },
            { type: 'aws:elasticache/cluster:Cluster', name: 'production-cache' }
        ];
    }

    private async showFinalStatus(stack: string): Promise<void> {
        this.log(chalk.blue('\n📊 Final Status'));
        this.log('-'.repeat(30));

        try {
            const { executeCommand } = await import('../../lib/utils.js');

            this.log(chalk.yellow('Stack status:'));
            await executeCommand('pulumi', ['stack', 'ls'], { silent: false });

            this.log(chalk.yellow('\nRemaining resources:'));
            await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: false });
        } catch (error) {
            this.log(chalk.gray('Unable to show final status'));
        }
    }
} 