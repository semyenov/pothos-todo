import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class RefactorMenu extends Command {
  static override description = 'Interactive code refactoring and migration menu';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('Code Refactoring & Migration Tools');
    const subtitle = chalk.gray('Automated migration to base classes and performance optimization');
    
    this.log(boxen(`${header}\n${subtitle}`, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }));
  }

  private async showMainMenu(): Promise<void> {
    while (true) {
      const choices = [
        {
          name: '🔍 Analyze Codebase for Refactoring Opportunities',
          value: 'analyze',
          short: 'Analyze'
        },
        {
          name: '🔄 Run Automated Migration to Base Classes',
          value: 'migrate',
          short: 'Migrate'
        },
        {
          name: '🏃 Run Performance Benchmarks',
          value: 'benchmark',
          short: 'Benchmark'
        },
        {
          name: '📊 Compare Performance Results',
          value: 'compare',
          short: 'Compare'
        },
        new inquirer.Separator('━━━ Advanced Options ━━━'),
        {
          name: '🎯 Targeted Migration Workflow',
          value: 'workflow',
          short: 'Workflow'
        },
        {
          name: '📈 Performance Analysis Report',
          value: 'report',
          short: 'Report'
        },
        {
          name: '🧹 Cleanup and Validation',
          value: 'cleanup',
          short: 'Cleanup'
        },
        new inquirer.Separator(),
        {
          name: '🔙 Back to Main Menu',
          value: 'back',
          short: 'Back'
        },
        {
          name: '❌ Exit',
          value: 'exit',
          short: 'Exit'
        }
      ];

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices,
          pageSize: 15,
        }
      ]);

      if (action === 'exit') {
        this.log(chalk.green('👋 Goodbye!'));
        break;
      }

      if (action === 'back') {
        // Return to main CLI menu
        const { Command } = await import('../index.js');
        await Command.run([]);
        break;
      }

      await this.handleAction(action);
    }
  }

  private async handleAction(action: string): Promise<void> {
    try {
      switch (action) {
        case 'analyze':
          await this.runAnalysis();
          break;
        case 'migrate':
          await this.runMigration();
          break;
        case 'benchmark':
          await this.runBenchmark();
          break;
        case 'compare':
          await this.runComparison();
          break;
        case 'workflow':
          await this.runTargetedWorkflow();
          break;
        case 'report':
          await this.generateReport();
          break;
        case 'cleanup':
          await this.runCleanup();
          break;
        default:
          this.log(chalk.red('Unknown action'));
      }
    } catch (error) {
      this.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }

    // Pause before returning to menu
    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...',
    }]);
  }

  private async runAnalysis(): Promise<void> {
    const { path, type, output, verbose } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: 'Path to analyze:',
        default: 'src',
      },
      {
        type: 'list',
        name: 'type',
        message: 'Analysis type:',
        choices: [
          { name: '🔄 All patterns', value: 'all' },
          { name: '📦 Singleton services only', value: 'singleton' },
          { name: '🗄️ Repositories only', value: 'repository' },
          { name: '🏗️ Aggregates only', value: 'aggregate' },
          { name: '🔐 GraphQL auth patterns', value: 'auth' },
        ],
        default: 'all',
      },
      {
        type: 'confirm',
        name: 'verbose',
        message: 'Show verbose output?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'output',
        message: 'Save results to JSON file?',
        default: false,
      }
    ]);

    const args = ['--path', path, '--type', type];
    if (verbose) args.push('--verbose');
    if (output) args.push('--output', 'refactor-analysis.json');

    const RefactorAnalyze = (await import('./analyze.js')).default;
    await RefactorAnalyze.run(args);
  }

  private async runMigration(): Promise<void> {
    const { dryRun, type, path, backup, force } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'dryRun',
        message: 'Run in dry-run mode first (recommended)?',
        default: true,
      },
      {
        type: 'list',
        name: 'type',
        message: 'Migration type:',
        choices: [
          { name: '🔄 All patterns', value: 'all' },
          { name: '📦 Singleton services', value: 'singleton' },
          { name: '🗄️ Repositories', value: 'repository' },
          { name: '🏗️ Aggregates', value: 'aggregate' },
        ],
        default: 'all',
      },
      {
        type: 'input',
        name: 'path',
        message: 'Path to migrate:',
        default: 'src',
      },
      {
        type: 'confirm',
        name: 'backup',
        message: 'Create backup files?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'force',
        message: 'Skip confirmation prompts?',
        default: false,
      }
    ]);

    const args = ['--type', type, '--path', path];
    if (dryRun) args.push('--dry-run');
    if (backup) args.push('--backup');
    if (force) args.push('--force');

    const RefactorMigrate = (await import('./migrate.js')).default;
    await RefactorMigrate.run(args);

    if (dryRun) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Apply the migration for real?',
        default: false,
      }]);

      if (proceed) {
        // Remove --dry-run and run again
        const realArgs = args.filter(arg => arg !== '--dry-run');
        await RefactorMigrate.run(realArgs);
      }
    }
  }

  private async runBenchmark(): Promise<void> {
    const { iterations, warmUp, output, compare } = await inquirer.prompt([
      {
        type: 'number',
        name: 'iterations',
        message: 'Number of benchmark iterations:',
        default: 100,
      },
      {
        type: 'number',
        name: 'warmUp',
        message: 'Number of warm-up iterations:',
        default: 10,
      },
      {
        type: 'confirm',
        name: 'output',
        message: 'Save benchmark results?',
        default: true,
      },
      {
        type: 'input',
        name: 'compare',
        message: 'Compare with baseline file (optional):',
        default: '',
      }
    ]);

    const args = ['--iterations', iterations.toString(), '--warm-up', warmUp.toString()];
    if (output) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      args.push('--output', `benchmark-${timestamp}.json`);
    }
    if (compare) args.push('--compare', compare);

    const RefactorBenchmark = (await import('./benchmark.js')).default;
    await RefactorBenchmark.run(args);
  }

  private async runComparison(): Promise<void> {
    const { baseline, current, detailed, format } = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseline',
        message: 'Baseline results file:',
        validate: (input) => input.length > 0 || 'Baseline file is required',
      },
      {
        type: 'input',
        name: 'current',
        message: 'Current results file:',
        validate: (input) => input.length > 0 || 'Current file is required',
      },
      {
        type: 'confirm',
        name: 'detailed',
        message: 'Show detailed comparison?',
        default: false,
      },
      {
        type: 'list',
        name: 'format',
        message: 'Output format:',
        choices: [
          { name: '📊 Table (console)', value: 'table' },
          { name: '📋 JSON', value: 'json' },
          { name: '📝 Markdown', value: 'markdown' },
        ],
        default: 'table',
      }
    ]);

    const args = [baseline, current, '--format', format];
    if (detailed) args.push('--detailed');

    const RefactorCompare = (await import('./compare.js')).default;
    await RefactorCompare.run(args);
  }

  private async runTargetedWorkflow(): Promise<void> {
    this.log(chalk.blue('🎯 Targeted Migration Workflow'));
    this.log(chalk.gray('This workflow will run analysis first, then guided migration\n'));

    // Step 1: Analysis
    this.log(chalk.yellow('Step 1: Running analysis...'));
    const RefactorAnalyze = (await import('./analyze.js')).default;
    await RefactorAnalyze.run(['--verbose']);

    // Step 2: Choose specific targets
    const { targets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'targets',
      message: 'Select specific patterns to migrate:',
      choices: [
        { name: '📦 Singleton Services', value: 'singleton' },
        { name: '🗄️ Repositories', value: 'repository' },
        { name: '🏗️ Domain Aggregates', value: 'aggregate' },
      ],
    }]);

    if (targets.length === 0) {
      this.log(chalk.yellow('No targets selected, workflow cancelled'));
      return;
    }

    // Step 3: Run targeted migrations
    for (const target of targets) {
      this.log(chalk.yellow(`\nStep 2.${targets.indexOf(target) + 1}: Migrating ${target} pattern...`));
      
      const RefactorMigrate = (await import('./migrate.js')).default;
      await RefactorMigrate.run(['--type', target, '--dry-run']);

      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: `Apply ${target} migration?`,
        default: true,
      }]);

      if (proceed) {
        await RefactorMigrate.run(['--type', target, '--backup']);
      }
    }

    // Step 4: Run benchmark if requested
    const { benchmark } = await inquirer.prompt([{
      type: 'confirm',
      name: 'benchmark',
      message: 'Run performance benchmark after migration?',
      default: true,
    }]);

    if (benchmark) {
      this.log(chalk.yellow('\nStep 3: Running performance benchmark...'));
      const RefactorBenchmark = (await import('./benchmark.js')).default;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await RefactorBenchmark.run(['--output', `workflow-benchmark-${timestamp}.json`]);
    }

    this.log(chalk.green('\n✅ Targeted migration workflow completed!'));
  }

  private async generateReport(): Promise<void> {
    this.log(chalk.blue('📈 Generating Performance Analysis Report'));
    this.log(chalk.yellow('This feature will be implemented in a future release'));
    
    // TODO: Implement comprehensive report generation
    // - Analyze multiple benchmark files
    // - Generate trend analysis
    // - Create performance regression alerts
    // - Output detailed HTML/PDF reports
  }

  private async runCleanup(): Promise<void> {
    this.log(chalk.blue('🧹 Cleanup and Validation'));
    
    const { actions } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'actions',
      message: 'Select cleanup actions:',
      choices: [
        { name: '🗑️ Remove backup files (.backup)', value: 'backup' },
        { name: '📄 Remove benchmark result files', value: 'benchmarks' },
        { name: '🔍 Validate migrated code', value: 'validate' },
        { name: '🧪 Run type checking', value: 'typecheck' },
      ],
    }]);

    if (actions.includes('backup')) {
      this.log(chalk.yellow('Removing backup files...'));
      const { executeCommand } = await import('../../lib/utils.js');
      await executeCommand('find', ['.', '-name', '*.backup', '-delete'], { silent: false });
    }

    if (actions.includes('benchmarks')) {
      this.log(chalk.yellow('Removing old benchmark files...'));
      const { executeCommand } = await import('../../lib/utils.js');
      await executeCommand('find', ['.', '-name', 'benchmark-*.json', '-mtime', '+7', '-delete'], { silent: false });
    }

    if (actions.includes('validate')) {
      this.log(chalk.yellow('Validating migrated code...'));
      const { executeCommand } = await import('../../lib/utils.js');
      await executeCommand('bun', ['run', 'validate'], { silent: false });
    }

    if (actions.includes('typecheck')) {
      this.log(chalk.yellow('Running type checking...'));
      const { executeCommand } = await import('../../lib/utils.js');
      await executeCommand('bun', ['run', 'check:types'], { silent: false });
    }

    if (actions.length > 0) {
      this.log(chalk.green('✅ Cleanup completed!'));
    } else {
      this.log(chalk.gray('No cleanup actions selected'));
    }
  }
}