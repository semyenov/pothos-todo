import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class PulumiPreview extends Command {
  static override description = 'Preview infrastructure changes without applying them';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --stack production --diff',
    '<%= config.bin %> <%= command.id %> --detailed --json',
    '<%= config.bin %> <%= command.id %> --target-urn urn:pulumi:dev::my-app::aws:s3/bucket:Bucket::my-bucket',
  ];

  static override flags = {
    stack: Flags.string({
      char: 's',
      description: 'Target stack name',
    }),
    diff: Flags.boolean({
      char: 'd',
      description: 'Show detailed diff of changes',
      default: true,
    }),
    detailed: Flags.boolean({
      description: 'Show detailed resource information',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output in JSON format',
      default: false,
    }),
    'target-urn': Flags.string({
      char: 't',
      description: 'Preview changes for specific resource URN',
      multiple: true,
    }),
    'target-dependents': Flags.boolean({
      description: 'Include dependents of targeted resources',
      default: false,
    }),
    'config-file': Flags.string({
      description: 'Path to Pulumi configuration file',
    }),
    'policy-pack': Flags.string({
      description: 'Policy pack to validate against',
    }),
    refresh: Flags.boolean({
      char: 'r',
      description: 'Refresh state before preview',
      default: false,
    }),
    'show-config': Flags.boolean({
      description: 'Show configuration values',
      default: false,
    }),
    'show-replacement-steps': Flags.boolean({
      description: 'Show detailed replacement steps',
      default: false,
    }),
    'suppress-outputs': Flags.boolean({
      description: 'Suppress output values in preview',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PulumiPreview);
    
    this.log(chalk.blue('👁️ Pulumi Infrastructure Preview'));
    this.log('='.repeat(50));

    try {
      // Validate environment
      await this.validateEnvironment();
      
      // Show current state information
      await this.showCurrentState(flags);
      
      // Run preview
      await this.runPreview(flags);
      
      // Show summary and recommendations
      await this.showSummary(flags);

    } catch (error) {
      this.log(chalk.red('❌ Preview failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async validateEnvironment(): Promise<void> {
    this.log(chalk.yellow('🔍 Validating environment...'));

    // Check Pulumi CLI
    try {
      const result = await executeCommand('pulumi', ['version'], { silent: true });
      if (result.stdout) {
        this.log(chalk.green(`  ✅ Pulumi CLI: ${result.stdout.trim()}`));
      }
    } catch {
      throw new Error('Pulumi CLI not found. Please install Pulumi: https://www.pulumi.com/docs/get-started/install/');
    }

    // Check authentication
    try {
      const result = await executeCommand('pulumi', ['whoami'], { silent: true });
      if (result.stdout) {
        this.log(chalk.green(`  ✅ Logged in as: ${result.stdout.trim()}`));
      }
    } catch {
      throw new Error('Not logged into Pulumi. Run "pulumi login" first.');
    }

    // Check for Pulumi project
    try {
      await executeCommand('pulumi', ['stack', 'ls'], { silent: true });
      this.log(chalk.green('  ✅ Pulumi project detected'));
    } catch {
      throw new Error('No Pulumi project found. Run "pulumi new" to create a project.');
    }
  }

  private async showCurrentState(flags: any): Promise<void> {
    if (!flags.json) {
      this.log(chalk.blue('\n📊 Current State Information'));
      this.log('-'.repeat(40));

      try {
        // Show current stack
        const stackResult = await executeCommand('pulumi', ['stack'], { silent: true });
        if (stackResult.stdout) {
          this.log(chalk.cyan(`Current Stack: ${stackResult.stdout.trim()}`));
        }

        // Show stack info if specific stack is targeted
        if (flags.stack) {
          const stackInfo = await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: true });
          if (stackInfo.stdout) {
            const stacks = JSON.parse(stackInfo.stdout);
            const targetStack = stacks.find((s: any) => s.name === flags.stack);
            if (targetStack) {
              this.log(chalk.cyan(`Target Stack: ${targetStack.name}`));
              this.log(chalk.gray(`  Last Update: ${targetStack.lastUpdate || 'Never'}`));
              this.log(chalk.gray(`  Resource Count: ${targetStack.resourceCount || 0}`));
            }
          }
        }

        // Show configuration if requested
        if (flags['show-config']) {
          this.log(chalk.yellow('\n⚙️ Configuration:'));
          const configArgs = ['config', 'get'];
          if (flags.stack) configArgs.push('--stack', flags.stack);
          
          try {
            await executeCommand('pulumi', configArgs, { silent: false });
          } catch {
            this.log(chalk.gray('  No configuration set'));
          }
        }

      } catch (error) {
        this.log(chalk.yellow('  ⚠️  Could not retrieve current state information'));
      }
    }
  }

  private async runPreview(flags: any): Promise<void> {
    this.log(chalk.blue('\n🔍 Analyzing Changes...'));
    
    // Refresh state if requested
    if (flags.refresh) {
      this.log(chalk.yellow('🔄 Refreshing state first...'));
      const refreshArgs = ['refresh', '--yes'];
      if (flags.stack) refreshArgs.push('--stack', flags.stack);
      
      await executeCommand('pulumi', refreshArgs, { silent: false });
    }

    // Build preview command
    const args = ['preview'];
    
    // Stack selection
    if (flags.stack) args.push('--stack', flags.stack);
    
    // Output format
    if (flags.json) {
      args.push('--json');
    } else {
      if (flags.diff) args.push('--diff');
      if (flags.detailed) args.push('--show-config');
      if (flags['show-replacement-steps']) args.push('--show-replacement-steps');
      if (flags['suppress-outputs']) args.push('--suppress-outputs');
    }
    
    // Targeting
    if (flags['target-urn']) {
      for (const urn of flags['target-urn']) {
        args.push('--target', urn);
      }
      if (flags['target-dependents']) {
        args.push('--target-dependents');
      }
    }
    
    // Configuration
    if (flags['config-file']) {
      args.push('--config-file', flags['config-file']);
    }
    
    // Policy validation
    if (flags['policy-pack']) {
      args.push('--policy-pack', flags['policy-pack']);
    }

    // Execute preview
    try {
      const result = await executeCommand('pulumi', args, { 
        silent: false,
        captureOutput: flags.json 
      });

      if (flags.json && result.stdout) {
        this.outputJsonPreview(result.stdout);
      }

    } catch (error) {
      if (error instanceof Error && error.message.includes('no changes')) {
        this.log(chalk.green('✅ No changes detected - infrastructure is up to date'));
      } else {
        throw error;
      }
    }
  }

  private outputJsonPreview(jsonOutput: string): void {
    try {
      const preview = JSON.parse(jsonOutput);
      
      // Pretty print the JSON with highlights
      this.log(chalk.blue('\n📋 Preview Results (JSON):'));
      this.log('='.repeat(50));
      
      // Summary
      if (preview.summary) {
        this.log(chalk.yellow('Summary:'));
        this.log(JSON.stringify(preview.summary, null, 2));
      }
      
      // Changes
      if (preview.changes) {
        this.log(chalk.yellow('\nChanges:'));
        this.log(JSON.stringify(preview.changes, null, 2));
      }
      
      // Full output
      this.log(chalk.gray('\nFull Preview:'));
      this.log(JSON.stringify(preview, null, 2));
      
    } catch {
      this.log(jsonOutput);
    }
  }

  private async showSummary(flags: any): Promise<void> {
    if (flags.json) return;
    
    this.log(chalk.blue('\n📋 Preview Summary'));
    this.log('='.repeat(40));

    try {
      // Get resource summary
      const args = ['stack', 'ls', '--json'];
      if (flags.stack) args.push('--stack', flags.stack);
      
      const result = await executeCommand('pulumi', args, { silent: true });
      if (result.stdout) {
        const stacks = JSON.parse(result.stdout);
        const currentStack = flags.stack ? 
          stacks.find((s: any) => s.name === flags.stack) : 
          stacks.find((s: any) => s.current);
        
        if (currentStack) {
          this.log(chalk.cyan(`Stack: ${currentStack.name}`));
          this.log(chalk.gray(`Resources: ${currentStack.resourceCount || 0}`));
          this.log(chalk.gray(`Last Update: ${currentStack.lastUpdate || 'Never'}`));
        }
      }

      // Show next steps
      this.log(chalk.blue('\n🚀 Next Steps:'));
      this.log(chalk.yellow('  • Review the changes above'));
      this.log(chalk.yellow('  • Run "pulumi up" to apply changes'));
      this.log(chalk.yellow('  • Use "pulumi up --target <urn>" for selective updates'));
      
      if (flags['policy-pack']) {
        this.log(chalk.yellow('  • Policy validation will be enforced during deployment'));
      }

    } catch (error) {
      this.log(chalk.yellow('⚠️  Could not generate summary'));
    }

    // Show helpful tips
    this.log(chalk.blue('\n💡 Tips:'));
    this.log(chalk.gray('  • Use --diff to see detailed changes'));
    this.log(chalk.gray('  • Use --target-urn to preview specific resources'));
    this.log(chalk.gray('  • Use --json for machine-readable output'));
    this.log(chalk.gray('  • Use --refresh to sync state before preview'));
  }
}