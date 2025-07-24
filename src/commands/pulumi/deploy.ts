import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { executeCommand } from '../../lib/utils.js';

export default class PulumiDeploy extends Command {
  static override description = 'Deploy infrastructure to cloud providers using Pulumi';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --stack dev --skip-preview',
    '<%= config.bin %> <%= command.id %> --cloud aws --region us-west-2',
    '<%= config.bin %> <%= command.id %> --parallel --refresh',
  ];

  static override flags = {
    stack: Flags.string({
      char: 's',
      description: 'Target stack name',
    }),
    cloud: Flags.string({
      char: 'c',
      description: 'Cloud provider',
      options: ['aws', 'azure', 'gcp', 'kubernetes'],
    }),
    region: Flags.string({
      char: 'r',
      description: 'Cloud region',
    }),
    'skip-preview': Flags.boolean({
      description: 'Skip preview and deploy directly',
      default: false,
    }),
    parallel: Flags.boolean({
      char: 'p',
      description: 'Enable parallel resource updates',
      default: true,
    }),
    refresh: Flags.boolean({
      description: 'Refresh state before deployment',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be deployed without making changes',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force deployment without confirmations',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
    'config-file': Flags.string({
      description: 'Path to Pulumi configuration file',
    }),
    'policy-pack': Flags.string({
      description: 'Policy pack to validate against',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PulumiDeploy);
    
    this.log(chalk.blue('🚀 Pulumi Infrastructure Deployment'));
    this.log('='.repeat(50));

    try {
      // Pre-deployment checks
      await this.preDeploymentChecks(flags);
      
      // Configure deployment
      const deploymentConfig = await this.configureDeployment(flags);
      
      // Execute deployment
      if (flags['dry-run']) {
        await this.dryRunDeployment(deploymentConfig);
      } else {
        await this.executeDeployment(deploymentConfig);
      }

    } catch (error) {
      this.log(chalk.red('❌ Deployment failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async preDeploymentChecks(flags: any): Promise<void> {
    this.log(chalk.yellow('🔍 Running pre-deployment checks...'));

    // Check Pulumi CLI
    try {
      await executeCommand('pulumi', ['version'], { silent: true });
      this.log(chalk.green('  ✅ Pulumi CLI available'));
    } catch {
      throw new Error('Pulumi CLI not found. Please install Pulumi: https://www.pulumi.com/docs/get-started/install/');
    }

    // Check if logged in
    try {
      await executeCommand('pulumi', ['whoami'], { silent: true });
      this.log(chalk.green('  ✅ Pulumi authentication verified'));
    } catch {
      this.log(chalk.yellow('  ⚠️  Not logged into Pulumi. Running login...'));
      await executeCommand('pulumi', ['login'], { silent: false });
    }

    // Check for Pulumi project
    try {
      await executeCommand('pulumi', ['stack', 'ls'], { silent: true });
      this.log(chalk.green('  ✅ Pulumi project detected'));
    } catch {
      throw new Error('No Pulumi project found. Run "pulumi new" to create a project.');
    }

    // Check cloud provider credentials
    if (flags.cloud) {
      await this.checkCloudCredentials(flags.cloud);
    }

    this.log(chalk.green('✅ Pre-deployment checks passed\n'));
  }

  private async checkCloudCredentials(cloud: string): Promise<void> {
    this.log(chalk.yellow(`  🔑 Checking ${cloud.toUpperCase()} credentials...`));
    
    try {
      switch (cloud) {
        case 'aws':
          await executeCommand('aws', ['sts', 'get-caller-identity'], { silent: true });
          this.log(chalk.green(`    ✅ AWS credentials verified`));
          break;
        case 'azure':
          await executeCommand('az', ['account', 'show'], { silent: true });
          this.log(chalk.green(`    ✅ Azure credentials verified`));
          break;
        case 'gcp':
          await executeCommand('gcloud', ['auth', 'list', '--filter=status:ACTIVE'], { silent: true });
          this.log(chalk.green(`    ✅ GCP credentials verified`));
          break;
        case 'kubernetes':
          await executeCommand('kubectl', ['cluster-info'], { silent: true });
          this.log(chalk.green(`    ✅ Kubernetes cluster access verified`));
          break;
      }
    } catch {
      this.log(chalk.yellow(`    ⚠️  ${cloud.toUpperCase()} credentials not configured`));
    }
  }

  private async configureDeployment(flags: any): Promise<DeploymentConfig> {
    const config: DeploymentConfig = {
      stack: flags.stack,
      cloud: flags.cloud,
      region: flags.region,
      skipPreview: flags['skip-preview'],
      parallel: flags.parallel,
      refresh: flags.refresh,
      force: flags.force,
      verbose: flags.verbose,
      configFile: flags['config-file'],
      policyPack: flags['policy-pack'],
    };

    // Interactive configuration if stack not specified
    if (!config.stack) {
      const { stackName } = await inquirer.prompt([{
        type: 'input',
        name: 'stackName',
        message: 'Enter stack name:',
        validate: (input) => input.length > 0 || 'Stack name is required',
      }]);
      config.stack = stackName;
    }

    // Set up stack if it doesn't exist
    await this.ensureStackExists(config.stack);

    // Apply configuration
    if (config.cloud || config.region) {
      await this.applyCloudConfiguration(config);
    }

    return config;
  }

  private async ensureStackExists(stackName: string): Promise<void> {
    try {
      await executeCommand('pulumi', ['stack', 'select', stackName], { silent: true });
      this.log(chalk.green(`✅ Using existing stack: ${stackName}`));
    } catch {
      this.log(chalk.yellow(`🆕 Creating new stack: ${stackName}`));
      await executeCommand('pulumi', ['stack', 'init', stackName], { silent: false });
    }
  }

  private async applyCloudConfiguration(config: DeploymentConfig): Promise<void> {
    this.log(chalk.yellow('⚙️ Applying cloud configuration...'));

    if (config.cloud) {
      await executeCommand('pulumi', ['config', 'set', 'cloud:provider', config.cloud], { silent: false });
    }

    if (config.region) {
      const regionKey = this.getRegionConfigKey(config.cloud);
      await executeCommand('pulumi', ['config', 'set', regionKey, config.region], { silent: false });
    }

    this.log(chalk.green('✅ Cloud configuration applied'));
  }

  private getRegionConfigKey(cloud?: string): string {
    switch (cloud) {
      case 'aws': return 'aws:region';
      case 'azure': return 'azure:location';
      case 'gcp': return 'gcp:region';
      default: return 'region';
    }
  }

  private async dryRunDeployment(config: DeploymentConfig): Promise<void> {
    this.log(chalk.blue('🔍 Dry Run - Preview Changes'));
    this.log('='.repeat(40));

    const args = ['preview'];
    
    if (config.stack) args.push('--stack', config.stack);
    if (config.verbose) args.push('--verbose');
    if (config.policyPack) args.push('--policy-pack', config.policyPack);
    
    args.push('--diff');

    await executeCommand('pulumi', args, { silent: false });

    this.log(chalk.blue('\n📊 Dry run completed. No changes were made.'));
  }

  private async executeDeployment(config: DeploymentConfig): Promise<void> {
    // Show preview unless skipped
    if (!config.skipPreview) {
      await this.showPreview(config);
      
      if (!config.force) {
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Proceed with deployment?',
          default: true,
        }]);

        if (!proceed) {
          this.log(chalk.yellow('Deployment cancelled'));
          return;
        }
      }
    }

    // Refresh state if requested
    if (config.refresh) {
      this.log(chalk.yellow('🔄 Refreshing state...'));
      await executeCommand('pulumi', ['refresh', '--yes'], { silent: false });
    }

    // Execute deployment
    this.log(chalk.blue('🚀 Starting deployment...'));
    
    const startTime = Date.now();
    const args = ['up'];
    
    if (config.stack) args.push('--stack', config.stack);
    if (config.parallel) args.push('--parallel', '10');
    if (config.verbose) args.push('--verbose');
    if (config.policyPack) args.push('--policy-pack', config.policyPack);
    if (config.force) args.push('--yes');

    try {
      await executeCommand('pulumi', args, { silent: false });
      
      const duration = Math.round((Date.now() - startTime) / 1000);
      this.log(chalk.green(`\n🎉 Deployment completed successfully in ${duration}s`));
      
      // Show outputs
      await this.showOutputs(config.stack);
      
      // Show next steps
      this.showNextSteps(config);

    } catch (error) {
      this.log(chalk.red('\n💥 Deployment failed'));
      await this.handleDeploymentFailure(config, error);
      throw error;
    }
  }

  private async showPreview(config: DeploymentConfig): Promise<void> {
    this.log(chalk.yellow('👁️ Previewing changes...'));
    
    const args = ['preview', '--diff'];
    if (config.stack) args.push('--stack', config.stack);
    if (config.verbose) args.push('--verbose');

    await executeCommand('pulumi', args, { silent: false });
  }

  private async showOutputs(stack?: string): Promise<void> {
    this.log(chalk.blue('\n📤 Stack Outputs:'));
    
    try {
      const args = ['stack', 'output'];
      if (stack) args.push('--stack', stack);
      
      await executeCommand('pulumi', args, { silent: false });
    } catch {
      this.log(chalk.gray('No outputs available'));
    }
  }

  private showNextSteps(config: DeploymentConfig): void {
    this.log(chalk.blue('\n🚀 Next Steps:'));
    this.log(chalk.yellow('  1. Verify deployment in cloud console'));
    this.log(chalk.yellow('  2. Test application endpoints'));
    this.log(chalk.yellow('  3. Monitor infrastructure health'));
    
    if (config.stack) {
      this.log(chalk.yellow(`  4. View stack details: pulumi stack --stack ${config.stack}`));
    }
  }

  private async handleDeploymentFailure(config: DeploymentConfig, error: any): Promise<void> {
    this.log(chalk.red('🔍 Deployment failure analysis:'));
    
    // Show stack trace if available
    if (error instanceof Error && error.stack) {
      this.log(chalk.gray(error.stack));
    }

    // Show recovery options
    this.log(chalk.yellow('\n🛠️ Recovery options:'));
    this.log(chalk.yellow('  1. Check cloud provider credentials'));
    this.log(chalk.yellow('  2. Verify resource quotas and limits'));
    this.log(chalk.yellow('  3. Review Pulumi program for errors'));
    this.log(chalk.yellow('  4. Run "pulumi refresh" to sync state'));
    this.log(chalk.yellow('  5. Use "pulumi stack --show-urns" to debug'));

    // Offer to show logs
    const { showLogs } = await inquirer.prompt([{
      type: 'confirm',
      name: 'showLogs',
      message: 'Show detailed logs?',
      default: false,
    }]);

    if (showLogs) {
      try {
        await executeCommand('pulumi', ['logs', '--follow=false'], { silent: false });
      } catch {
        this.log(chalk.gray('No logs available'));
      }
    }
  }
}

interface DeploymentConfig {
  stack?: string;
  cloud?: string;
  region?: string;
  skipPreview: boolean;
  parallel: boolean;
  refresh: boolean;
  force: boolean;
  verbose: boolean;
  configFile?: string;
  policyPack?: string;
}