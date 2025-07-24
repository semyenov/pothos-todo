import { Command } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import boxen from 'boxen';

export default class HooksMenu extends Command {
  static override description = 'Interactive Git hooks management menu';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.showHeader();
    await this.showMainMenu();
  }

  private showHeader(): void {
    const header = chalk.cyan.bold('Git Hooks Management Center');
    const subtitle = chalk.gray('Setup, configure, and manage Git hooks for code quality');

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
          name: '🚀 Quick Setup All Hooks',
          value: 'setup-all',
          short: 'Setup All'
        },
        {
          name: '⚙️ Custom Hook Installation',
          value: 'install',
          short: 'Install Hooks'
        },
        {
          name: '📋 List Hooks Status',
          value: 'list',
          short: 'List'
        },
        {
          name: '🔍 Validate Hook Configuration',
          value: 'validate',
          short: 'Validate'
        },
        new inquirer.Separator('━━━ Individual Hooks ━━━'),
        {
          name: '📝 Pre-commit Hook (Linting & Formatting)',
          value: 'pre-commit',
          short: 'Pre-commit'
        },
        {
          name: '💬 Commit Message Hook (Conventional Commits)',
          value: 'commit-msg',
          short: 'Commit Message'
        },
        {
          name: '🚀 Pre-push Hook (Tests & Build)',
          value: 'pre-push',
          short: 'Pre-push'
        },
        {
          name: '🎯 Post-commit Hook (Notifications)',
          value: 'post-commit',
          short: 'Post-commit'
        },
        new inquirer.Separator('━━━ Advanced Options ━━━'),
        {
          name: '🔧 Configure Hook Settings',
          value: 'configure',
          short: 'Configure'
        },
        {
          name: '❌ Remove Hooks',
          value: 'remove',
          short: 'Remove'
        },
        {
          name: '🔄 Reset Hooks to Default',
          value: 'reset',
          short: 'Reset'
        },
        {
          name: '🧪 Test Hooks',
          value: 'test',
          short: 'Test'
        },
        new inquirer.Separator('━━━ Quality Gates ━━━'),
        {
          name: '📊 Code Quality Report',
          value: 'quality-report',
          short: 'Quality Report'
        },
        {
          name: '🛡️ Security Scanning Setup',
          value: 'security',
          short: 'Security'
        },
        {
          name: '📈 Performance Checks',
          value: 'performance',
          short: 'Performance'
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
          message: 'What would you like to do with Git hooks?',
          choices,
          pageSize: 25,
        }
      ]);

      if (action === 'exit') {
        this.log(chalk.green('👋 Goodbye!'));
        break;
      }

      if (action === 'back') {
        // Return to main CLI menu
        const Command = (await import('../../commands/index.js')).default;
        await Command.run([]);
        break;
      }

      await this.handleAction(action);
    }
  }

  private async handleAction(action: string): Promise<void> {
    try {
      switch (action) {
        case 'setup-all':
          await this.setupAllHooks();
          break;
        case 'install':
          await this.customInstallation();
          break;
        case 'list':
          await this.listHooks();
          break;
        case 'validate':
          await this.validateHooks();
          break;
        case 'pre-commit':
          await this.setupSpecificHook('pre-commit');
          break;
        case 'commit-msg':
          await this.setupSpecificHook('commit-msg');
          break;
        case 'pre-push':
          await this.setupSpecificHook('pre-push');
          break;
        case 'post-commit':
          await this.setupSpecificHook('post-commit');
          break;
        case 'configure':
          await this.configureHooks();
          break;
        case 'remove':
          await this.removeHooks();
          break;
        case 'reset':
          await this.resetHooks();
          break;
        case 'test':
          await this.testHooks();
          break;
        case 'quality-report':
          await this.generateQualityReport();
          break;
        case 'security':
          await this.setupSecurityScanning();
          break;
        case 'performance':
          await this.setupPerformanceChecks();
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

  private async setupAllHooks(): Promise<void> {
    this.log(chalk.blue('🚀 Setting up all Git hooks'));

    const { skipExisting, level } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'skipExisting',
        message: 'Skip existing hooks?',
        default: true,
      },
      {
        type: 'list',
        name: 'level',
        message: 'Hook strictness level:',
        choices: [
          { name: '🟢 Basic (Essential checks only)', value: 'basic' },
          { name: '🟡 Standard (Recommended checks)', value: 'standard' },
          { name: '🔴 Strict (All quality gates)', value: 'strict' },
        ],
        default: 'standard',
      }
    ]);

    const HooksSetup = (await import('./setup.js')).default;
    const args = ['--all', '--level', level];
    if (skipExisting) args.push('--skip-existing');

    await HooksSetup.run(args);
  }

  private async customInstallation(): Promise<void> {
    const { hooks, options } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'hooks',
        message: 'Select hooks to install:',
        choices: [
          { name: '📝 Pre-commit (Code quality)', value: 'pre-commit', checked: true },
          { name: '💬 Commit message (Conventional commits)', value: 'commit-msg', checked: true },
          { name: '🚀 Pre-push (Tests & build)', value: 'pre-push', checked: false },
          { name: '🎯 Post-commit (Notifications)', value: 'post-commit', checked: false },
          { name: '🔄 Post-merge (Dependencies)', value: 'post-merge', checked: false },
        ],
      },
      {
        type: 'checkbox',
        name: 'options',
        message: 'Additional options:',
        choices: [
          { name: '🛡️ Security scanning', value: 'security' },
          { name: '📊 Performance checks', value: 'performance' },
          { name: '🧪 Test coverage validation', value: 'coverage' },
          { name: '📱 TypeScript strict mode', value: 'typescript-strict' },
        ],
      }
    ]);

    if (hooks.length === 0) {
      this.log(chalk.yellow('No hooks selected for installation'));
      return;
    }

    const HooksInstall = (await import('./install.js')).default;
    const args = ['--hooks', hooks.join(',')];
    if (options.length > 0) args.push('--options', options.join(','));

    await HooksInstall.run(args);
  }

  private async listHooks(): Promise<void> {
    const { format, showDetails } = await inquirer.prompt([
      {
        type: 'list',
        name: 'format',
        message: 'Output format:',
        choices: [
          { name: '📊 Table', value: 'table' },
          { name: '📋 JSON', value: 'json' },
          { name: '📝 Summary', value: 'summary' },
        ],
        default: 'table',
      },
      {
        type: 'confirm',
        name: 'showDetails',
        message: 'Show detailed hook information?',
        default: false,
      }
    ]);

    const HooksList = (await import('./list.js')).default;
    const args = ['--format', format];
    if (showDetails) args.push('--details');

    await HooksList.run(args);
  }

  private async validateHooks(): Promise<void> {
    const { fix, report } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'fix',
        message: 'Auto-fix issues where possible?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'report',
        message: 'Generate validation report?',
        default: false,
      }
    ]);

    const HooksValidate = (await import('./validate.js')).default;
    const args: string[] = [];
    if (fix) args.push('--fix');
    if (report) args.push('--report');

    await HooksValidate.run(args);
  }

  private async setupSpecificHook(hookName: string): Promise<void> {
    this.log(chalk.blue(`⚙️ Setting up ${hookName} hook`));

    const { force, configure } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'force',
        message: `Replace existing ${hookName} hook?`,
        default: false,
      },
      {
        type: 'confirm',
        name: 'configure',
        message: 'Configure hook options?',
        default: true,
      }
    ]);

    if (configure) {
      const config = await this.getHookConfiguration(hookName);
      const HooksInstall = (await import('./install.js')).default;
      const args = ['--hooks', hookName, '--config', JSON.stringify(config)];
      if (force) args.push('--force');

      await HooksInstall.run(args);
    } else {
      const HooksInstall = (await import('./install.js')).default;
      const args = ['--hooks', hookName];
      if (force) args.push('--force');

      await HooksInstall.run(args);
    }
  }

  private async getHookConfiguration(hookName: string): Promise<Record<string, any>> {
    switch (hookName) {
      case 'pre-commit':
        return await this.configurePreCommit();
      case 'commit-msg':
        return await this.configureCommitMsg();
      case 'pre-push':
        return await this.configurePrePush();
      default:
        return {};
    }
  }

  private async configurePreCommit(): Promise<Record<string, any>> {
    const config = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'checks',
        message: 'Pre-commit checks to enable:',
        choices: [
          { name: '🎨 Code formatting (Prettier)', value: 'format', checked: true },
          { name: '📏 Code linting (ESLint)', value: 'lint', checked: true },
          { name: '🔤 TypeScript checking', value: 'typecheck', checked: true },
          { name: '🧪 Unit tests', value: 'test', checked: false },
          { name: '🛡️ Security audit', value: 'audit', checked: false },
        ],
      },
      {
        type: 'confirm',
        name: 'autoFix',
        message: 'Auto-fix issues when possible?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'parallel',
        message: 'Run checks in parallel?',
        default: true,
      }
    ]);

    return config;
  }

  private async configureCommitMsg(): Promise<Record<string, any>> {
    const config = await inquirer.prompt([
      {
        type: 'list',
        name: 'standard',
        message: 'Commit message standard:',
        choices: [
          { name: '📝 Conventional Commits', value: 'conventional' },
          { name: '🎯 Angular Style', value: 'angular' },
          { name: '🔧 Custom Pattern', value: 'custom' },
        ],
        default: 'conventional',
      },
      {
        type: 'checkbox',
        name: 'allowedTypes',
        message: 'Allowed commit types:',
        choices: [
          { name: '✨ feat (new feature)', value: 'feat', checked: true },
          { name: '🐛 fix (bug fix)', value: 'fix', checked: true },
          { name: '📚 docs (documentation)', value: 'docs', checked: true },
          { name: '🎨 style (formatting)', value: 'style', checked: true },
          { name: '♻️ refactor (code changes)', value: 'refactor', checked: true },
          { name: '🧪 test (tests)', value: 'test', checked: true },
          { name: '🔧 chore (maintenance)', value: 'chore', checked: true },
        ],
        when: (answers) => answers.standard !== 'custom',
      },
      {
        type: 'confirm',
        name: 'requireScope',
        message: 'Require scope in commit messages?',
        default: false,
      }
    ]);

    return config;
  }

  private async configurePrePush(): Promise<Record<string, any>> {
    const config = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'checks',
        message: 'Pre-push checks to enable:',
        choices: [
          { name: '🧪 Full test suite', value: 'test', checked: true },
          { name: '🏗️ Build validation', value: 'build', checked: true },
          { name: '📊 Type checking', value: 'typecheck', checked: true },
          { name: '🛡️ Security scanning', value: 'security', checked: false },
          { name: '📈 Performance tests', value: 'performance', checked: false },
        ],
      },
      {
        type: 'number',
        name: 'timeout',
        message: 'Timeout for checks (minutes):',
        default: 10,
      },
      {
        type: 'confirm',
        name: 'allowSkip',
        message: 'Allow skipping with --no-verify?',
        default: true,
      }
    ]);

    return config;
  }

  private async configureHooks(): Promise<void> {
    this.log(chalk.blue('🔧 Global Hook Configuration'));
    this.log(chalk.yellow('Hook configuration will be implemented in a future release'));
  }

  private async removeHooks(): Promise<void> {
    this.log(chalk.red('❌ Remove Git Hooks'));

    const { hooks, confirm } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'hooks',
        message: 'Select hooks to remove:',
        choices: [
          { name: '📝 Pre-commit', value: 'pre-commit' },
          { name: '💬 Commit message', value: 'commit-msg' },
          { name: '🚀 Pre-push', value: 'pre-push' },
          { name: '🎯 Post-commit', value: 'post-commit' },
          { name: '🔄 Post-merge', value: 'post-merge' },
          { name: '🗑️ All hooks', value: 'all' },
        ],
      },
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to remove the selected hooks?',
        default: false,
      }
    ]);

    if (!confirm) {
      this.log(chalk.yellow('Hook removal cancelled'));
      return;
    }

    const { executeCommand } = await import('../../lib/utils.js');

    if (hooks.includes('all')) {
      this.log(chalk.yellow('Removing all Git hooks...'));
      await executeCommand('rm', ['-rf', '.git/hooks/*'], { silent: false });
    } else {
      for (const hook of hooks) {
        this.log(chalk.yellow(`Removing ${hook} hook...`));
        await executeCommand('rm', ['-f', `.git/hooks/${hook}`], { silent: false });
      }
    }

    this.log(chalk.green('✅ Selected hooks removed successfully'));
  }

  private async resetHooks(): Promise<void> {
    this.log(chalk.blue('🔄 Reset Hooks to Default'));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This will reset all hooks to their default configuration. Continue?',
        default: false,
      }
    ]);

    if (!confirm) {
      this.log(chalk.yellow('Reset cancelled'));
      return;
    }

    // Remove all existing hooks and reinstall defaults
    const { executeCommand } = await import('../../lib/utils.js');
    await executeCommand('rm', ['-rf', '.git/hooks/*'], { silent: false });

    const HooksSetup = (await import('./setup.js')).default;
    await HooksSetup.run(['--all', '--level', 'standard']);

    this.log(chalk.green('✅ Hooks reset to default configuration'));
  }

  private async testHooks(): Promise<void> {
    this.log(chalk.blue('🧪 Testing Git Hooks'));

    const { hooks } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'hooks',
        message: 'Select hooks to test:',
        choices: [
          { name: '📝 Pre-commit', value: 'pre-commit' },
          { name: '💬 Commit message', value: 'commit-msg' },
          { name: '🚀 Pre-push', value: 'pre-push' },
          { name: '🧪 All hooks', value: 'all' },
        ],
        default: ['all'],
      }
    ]);

    const HooksValidate = (await import('./validate.js')).default;
    const args = ['--test'];
    if (!hooks.includes('all')) {
      args.push('--hooks', hooks.join(','));
    }

    await HooksValidate.run(args);
  }

  private async generateQualityReport(): Promise<void> {
    this.log(chalk.blue('📊 Generating Code Quality Report'));

    const { executeCommand } = await import('../../lib/utils.js');

    try {
      this.log(chalk.yellow('Running quality checks...'));

      // TypeScript check
      this.log(chalk.cyan('\n🔤 TypeScript Check:'));
      await executeCommand('bun', ['run', 'check:types'], { silent: false });

      // Linting
      this.log(chalk.cyan('\n📏 ESLint Check:'));
      await executeCommand('bun', ['run', 'lint'], { silent: false });

      // Test coverage (if available)
      this.log(chalk.cyan('\n🧪 Test Coverage:'));
      try {
        await executeCommand('bun', ['test', '--coverage'], { silent: false });
      } catch {
        this.log(chalk.gray('Test coverage not available'));
      }

      this.log(chalk.green('\n✅ Quality report completed'));

    } catch (error) {
      this.log(chalk.red(`❌ Quality checks failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async setupSecurityScanning(): Promise<void> {
    this.log(chalk.blue('🛡️ Security Scanning Setup'));
    this.log(chalk.yellow('Security scanning setup will be implemented in a future release'));
  }

  private async setupPerformanceChecks(): Promise<void> {
    this.log(chalk.blue('📈 Performance Checks Setup'));
    this.log(chalk.yellow('Performance checks setup will be implemented in a future release'));
  }
}