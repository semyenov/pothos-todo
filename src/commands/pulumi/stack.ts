import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { executeCommand } from '../../lib/utils.js';

export default class PulumiStack extends Command {
  static override description = 'Manage Pulumi stacks (create, list, switch, delete)';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --operation list',
    '<%= config.bin %> <%= command.id %> --operation create --name dev',
    '<%= config.bin %> <%= command.id %> --operation select --name production',
    '<%= config.bin %> <%= command.id %> --operation outputs --format json',
  ];

  static override flags = {
    operation: Flags.string({
      char: 'o',
      description: 'Stack operation to perform',
      options: ['list', 'create', 'select', 'delete', 'outputs', 'history', 'import', 'export'],
      required: true,
    }),
    name: Flags.string({
      char: 'n',
      description: 'Stack name for create/select/delete operations',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format for outputs command',
      options: ['table', 'json', 'yaml'],
      default: 'table',
    }),
    'show-ids': Flags.boolean({
      description: 'Show stack IDs in list output',
      default: false,
    }),
    'show-secrets': Flags.boolean({
      description: 'Show secret values in outputs',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force operation without confirmation',
      default: false,
    }),
    file: Flags.string({
      description: 'File path for import/export operations',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PulumiStack);
    
    this.log(chalk.blue('📊 Pulumi Stack Management'));
    this.log('='.repeat(50));

    try {
      switch (flags.operation) {
        case 'list':
          await this.listStacks(flags);
          break;
        case 'create':
          await this.createStack(flags);
          break;
        case 'select':
          await this.selectStack(flags);
          break;
        case 'delete':
          await this.deleteStack(flags);
          break;
        case 'outputs':
          await this.showOutputs(flags);
          break;
        case 'history':
          await this.showHistory(flags);
          break;
        case 'import':
          await this.importStack(flags);
          break;
        case 'export':
          await this.exportStack(flags);
          break;
        default:
          throw new Error(`Unknown operation: ${flags.operation}`);
      }

    } catch (error) {
      this.log(chalk.red('❌ Stack operation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async listStacks(flags: any): Promise<void> {
    this.log(chalk.blue('📋 Available Stacks'));
    this.log('-'.repeat(30));

    try {
      const args = ['stack', 'ls'];
      if (flags['show-ids']) args.push('--show-ids');
      if (flags.format === 'json') args.push('--json');

      const result = await executeCommand('pulumi', args, { silent: true });
      
      if (flags.format === 'json' && result.stdout) {
        const stacks = JSON.parse(result.stdout);
        this.displayStacksAsJson(stacks);
      } else {
        // Display the raw output from pulumi stack ls
        this.log(result.stdout);
        
        // Add additional information
        this.log(chalk.blue('\n💡 Stack Management Tips:'));
        this.log(chalk.gray('  • Use "select" to switch active stack'));
        this.log(chalk.gray('  • Use "create" to add new environment'));
        this.log(chalk.gray('  • Current stack is marked with "*"'));
      }

    } catch (error) {
      throw new Error(`Failed to list stacks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private displayStacksAsJson(stacks: any[]): void {
    this.log(JSON.stringify(stacks, null, 2));
    
    // Summary
    this.log(chalk.blue(`\n📊 Summary: ${stacks.length} stacks found`));
    
    const current = stacks.find(s => s.current);
    if (current) {
      this.log(chalk.cyan(`🎯 Current: ${current.name}`));
    }
  }

  private async createStack(flags: any): Promise<void> {
    let stackName = flags.name;
    
    if (!stackName) {
      const { name } = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'Enter new stack name:',
        validate: (input) => {
          if (!input) return 'Stack name is required';
          if (!/^[a-zA-Z0-9-_]+$/.test(input)) return 'Stack name can only contain letters, numbers, hyphens, and underscores';
          return true;
        },
      }]);
      stackName = name;
    }

    this.log(chalk.yellow(`🆕 Creating stack: ${stackName}`));

    try {
      await executeCommand('pulumi', ['stack', 'init', stackName], { silent: false });
      this.log(chalk.green(`✅ Stack "${stackName}" created successfully`));
      
      // Offer to set initial configuration
      const { setConfig } = await inquirer.prompt([{
        type: 'confirm',
        name: 'setConfig',
        message: 'Would you like to set initial configuration?',
        default: true,
      }]);

      if (setConfig) {
        await this.setInitialConfiguration(stackName);
      }

    } catch (error) {
      throw new Error(`Failed to create stack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async setInitialConfiguration(stackName: string): Promise<void> {
    const { configs } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'configs',
      message: 'Select configurations to set:',
      choices: [
        { name: 'Cloud Region', value: 'region' },
        { name: 'Environment (dev/staging/prod)', value: 'environment' },
        { name: 'Instance Size', value: 'instanceSize' },
        { name: 'Custom Config', value: 'custom' },
      ],
    }]);

    for (const config of configs) {
      await this.setConfigValue(stackName, config);
    }
  }

  private async setConfigValue(stackName: string, configType: string): Promise<void> {
    let key: string;
    let defaultValue: string;
    let choices: string[] | undefined;

    switch (configType) {
      case 'region':
        key = 'aws:region';
        defaultValue = 'us-east-1';
        choices = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];
        break;
      case 'environment':
        key = 'app:environment';
        defaultValue = 'dev';
        choices = ['dev', 'staging', 'prod'];
        break;
      case 'instanceSize':
        key = 'app:instanceSize';
        defaultValue = 't3.micro';
        choices = ['t3.micro', 't3.small', 't3.medium', 't3.large'];
        break;
      case 'custom':
        const { customKey } = await inquirer.prompt([{
          type: 'input',
          name: 'customKey',
          message: 'Enter configuration key:',
          validate: (input) => input.length > 0 || 'Key is required',
        }]);
        key = customKey;
        defaultValue = '';
        break;
      default:
        return;
    }

    const prompt: any = {
      type: choices ? 'list' : 'input',
      name: 'value',
      message: `Set ${key}:`,
      default: defaultValue,
    };

    if (choices) {
      prompt.choices = choices;
    }

    const { value } = await inquirer.prompt([prompt]);

    try {
      await executeCommand('pulumi', ['config', 'set', key, value, '--stack', stackName], { silent: false });
      this.log(chalk.green(`  ✅ Set ${key} = ${value}`));
    } catch (error) {
      this.log(chalk.red(`  ❌ Failed to set ${key}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async selectStack(flags: any): Promise<void> {
    let stackName = flags.name;

    if (!stackName) {
      // Get list of available stacks
      const result = await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: true });
      const stacks = JSON.parse(result.stdout);
      
      const { selectedStack } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedStack',
        message: 'Select stack:',
        choices: stacks.map((s: any) => ({
          name: s.current ? `${s.name} (current)` : s.name,
          value: s.name,
        })),
      }]);
      stackName = selectedStack;
    }

    this.log(chalk.yellow(`🎯 Switching to stack: ${stackName}`));

    try {
      await executeCommand('pulumi', ['stack', 'select', stackName], { silent: false });
      this.log(chalk.green(`✅ Active stack is now: ${stackName}`));
      
      // Show stack info
      await this.showStackInfo(stackName);

    } catch (error) {
      throw new Error(`Failed to select stack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async showStackInfo(stackName: string): Promise<void> {
    try {
      this.log(chalk.blue('\n📊 Stack Information:'));
      
      // Get stack details
      const result = await executeCommand('pulumi', ['stack', '--show-urns'], { silent: true });
      this.log(result.stdout);
      
    } catch {
      this.log(chalk.gray('  Could not retrieve stack information'));
    }
  }

  private async deleteStack(flags: any): Promise<void> {
    let stackName = flags.name;

    if (!stackName) {
      const result = await executeCommand('pulumi', ['stack', 'ls', '--json'], { silent: true });
      const stacks = JSON.parse(result.stdout);
      
      const { selectedStack } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedStack',
        message: 'Select stack to delete:',
        choices: stacks
          .filter((s: any) => !s.current) // Don't allow deleting current stack
          .map((s: any) => ({ name: s.name, value: s.name })),
      }]);
      stackName = selectedStack;
    }

    if (!flags.force) {
      this.log(chalk.red(`⚠️  WARNING: This will permanently delete stack "${stackName}"`));
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to delete this stack?',
        default: false,
      }]);

      if (!confirm) {
        this.log(chalk.yellow('Stack deletion cancelled'));
        return;
      }

      // Double confirmation for production-like stacks
      if (stackName.includes('prod') || stackName.includes('production')) {
        const { confirmProd } = await inquirer.prompt([{
          type: 'input',
          name: 'confirmProd',
          message: `Type "${stackName}" to confirm deletion:`,
        }]);

        if (confirmProd !== stackName) {
          this.log(chalk.red('Stack name mismatch. Deletion cancelled.'));
          return;
        }
      }
    }

    this.log(chalk.yellow(`🗑️ Deleting stack: ${stackName}`));

    try {
      const args = ['stack', 'rm', stackName];
      if (flags.force) args.push('--yes');

      await executeCommand('pulumi', args, { silent: false });
      this.log(chalk.green(`✅ Stack "${stackName}" deleted successfully`));

    } catch (error) {
      throw new Error(`Failed to delete stack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async showOutputs(flags: any): Promise<void> {
    this.log(chalk.blue('📤 Stack Outputs'));
    this.log('-'.repeat(25));

    try {
      const args = ['stack', 'output'];
      
      if (flags.format === 'json') args.push('--json');
      if (flags['show-secrets']) args.push('--show-secrets');

      const result = await executeCommand('pulumi', args, { silent: true });
      
      if (flags.format === 'json') {
        const outputs = JSON.parse(result.stdout);
        this.log(JSON.stringify(outputs, null, 2));
      } else {
        this.log(result.stdout || chalk.gray('No outputs available'));
      }

    } catch (error) {
      this.log(chalk.yellow('⚠️  No outputs available or stack not deployed'));
    }
  }

  private async showHistory(flags: any): Promise<void> {
    this.log(chalk.blue('📚 Stack History'));
    this.log('-'.repeat(25));

    try {
      const result = await executeCommand('pulumi', ['stack', 'history'], { silent: true });
      this.log(result.stdout);

    } catch (error) {
      this.log(chalk.yellow('⚠️  No deployment history available'));
    }
  }

  private async importStack(flags: any): Promise<void> {
    const filePath = flags.file || await this.promptForFile('import');
    
    this.log(chalk.yellow(`📥 Importing stack from: ${filePath}`));

    try {
      await executeCommand('pulumi', ['stack', 'import', '--file', filePath], { silent: false });
      this.log(chalk.green('✅ Stack imported successfully'));

    } catch (error) {
      throw new Error(`Failed to import stack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async exportStack(flags: any): Promise<void> {
    const filePath = flags.file || await this.promptForFile('export');
    
    this.log(chalk.yellow(`📤 Exporting stack to: ${filePath}`));

    try {
      await executeCommand('pulumi', ['stack', 'export', '--file', filePath], { silent: false });
      this.log(chalk.green(`✅ Stack exported to: ${filePath}`));

    } catch (error) {
      throw new Error(`Failed to export stack: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async promptForFile(operation: 'import' | 'export'): Promise<string> {
    const { filePath } = await inquirer.prompt([{
      type: 'input',
      name: 'filePath',
      message: `Enter file path for ${operation}:`,
      default: `stack-${operation}-${new Date().toISOString().split('T')[0]}.json`,
      validate: (input) => input.length > 0 || 'File path is required',
    }]);

    return filePath;
  }
}