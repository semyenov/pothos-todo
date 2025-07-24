import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { writeFile, mkdir, chmod, access } from 'fs/promises';
import { join, dirname } from 'path';
import { executeCommand } from '../../lib/utils.js';

export default class HooksSetup extends Command {
  static override description = 'Setup Git hooks for code quality, testing, and automation';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --hooks pre-commit,commit-msg',
    '<%= config.bin %> <%= command.id %> --all --level strict',
    '<%= config.bin %> <%= command.id %> --hooks pre-push --force',
  ];

  static override flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Setup all recommended hooks',
      default: false,
    }),
    hooks: Flags.string({
      char: 'h',
      description: 'Comma-separated list of hooks to setup',
    }),
    level: Flags.string({
      char: 'l',
      description: 'Hook strictness level',
      options: ['basic', 'standard', 'strict'],
      default: 'standard',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force overwrite existing hooks',
      default: false,
    }),
    'skip-existing': Flags.boolean({
      char: 's',
      description: 'Skip hooks that already exist',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be done without making changes',
      default: false,
    }),
    config: Flags.string({
      char: 'c',
      description: 'Path to hook configuration file',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
  };

  private installedHooks: string[] = [];

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksSetup);
    
    this.log(chalk.blue('🚀 Git Hooks Setup'));
    this.log('='.repeat(40));

    try {
      // Validate Git repository
      await this.validateGitRepository();
      
      // Determine which hooks to setup
      const hooksToSetup = this.getHooksToSetup(flags);
      
      if (hooksToSetup.length === 0) {
        this.log(chalk.yellow('No hooks specified for setup'));
        return;
      }

      this.log(chalk.cyan(`Setting up hooks: ${hooksToSetup.join(', ')}`));
      this.log(chalk.gray(`Strictness level: ${flags.level}`));
      
      if (flags['dry-run']) {
        this.log(chalk.yellow('\n🔍 DRY RUN MODE - No changes will be made\n'));
      }

      // Setup hooks directory
      await this.setupHooksDirectory(flags);
      
      // Install each hook
      for (const hook of hooksToSetup) {
        await this.setupHook(hook, flags);
      }

      // Generate hook configuration
      await this.generateHookConfig(flags);
      
      this.printSummary(flags);

    } catch (error) {
      this.log(chalk.red('❌ Hook setup failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async validateGitRepository(): Promise<void> {
    try {
      await executeCommand('git', ['rev-parse', '--git-dir'], { silent: true });
    } catch {
      throw new Error('Not a Git repository. Please run this command in a Git repository.');
    }
  }

  private getHooksToSetup(flags: any): string[] {
    if (flags.all) {
      return this.getAllHooks(flags.level);
    }
    
    if (flags.hooks) {
      return flags.hooks.split(',').map((h: string) => h.trim());
    }
    
    return [];
  }

  private getAllHooks(level: string): string[] {
    const basicHooks = ['pre-commit', 'commit-msg'];
    const standardHooks = [...basicHooks, 'pre-push'];
    const strictHooks = [...standardHooks, 'post-commit', 'post-merge'];
    
    switch (level) {
      case 'basic':
        return basicHooks;
      case 'standard':
        return standardHooks;
      case 'strict':
        return strictHooks;
      default:
        return standardHooks;
    }
  }

  private async setupHooksDirectory(flags: any): Promise<void> {
    const hooksDir = '.git/hooks';
    
    try {
      await access(hooksDir);
      if (flags.verbose) {
        this.log(chalk.green(`✅ Hooks directory exists: ${hooksDir}`));
      }
    } catch {
      if (!flags['dry-run']) {
        await mkdir(hooksDir, { recursive: true });
      }
      this.log(chalk.green(`📁 Created hooks directory: ${hooksDir}`));
    }
  }

  private async setupHook(hookName: string, flags: any): Promise<void> {
    const hookPath = `.git/hooks/${hookName}`;
    
    // Check if hook already exists
    try {
      await access(hookPath);
      
      if (flags['skip-existing']) {
        this.log(chalk.yellow(`⏭️  Skipping existing hook: ${hookName}`));
        return;
      }
      
      if (!flags.force) {
        this.log(chalk.yellow(`⚠️  Hook already exists: ${hookName} (use --force to overwrite)`));
        return;
      }
      
      this.log(chalk.yellow(`🔄 Overwriting existing hook: ${hookName}`));
    } catch {
      // Hook doesn't exist, continue with creation
    }

    // Generate hook content
    const hookContent = this.generateHookContent(hookName, flags);
    
    if (flags['dry-run']) {
      this.log(chalk.blue(`📝 Would create ${hookName} hook`));
      if (flags.verbose) {
        this.log(chalk.gray('Hook content:'));
        this.log(chalk.gray(hookContent));
      }
      return;
    }

    // Write hook file
    await writeFile(hookPath, hookContent, 'utf-8');
    
    // Make hook executable
    await chmod(hookPath, 0o755);
    
    this.installedHooks.push(hookName);
    this.log(chalk.green(`✅ Installed ${hookName} hook`));
  }

  private generateHookContent(hookName: string, flags: any): string {
    switch (hookName) {
      case 'pre-commit':
        return this.generatePreCommitHook(flags);
      case 'commit-msg':
        return this.generateCommitMsgHook(flags);
      case 'pre-push':
        return this.generatePrePushHook(flags);
      case 'post-commit':
        return this.generatePostCommitHook(flags);
      case 'post-merge':
        return this.generatePostMergeHook(flags);
      default:
        return this.generateGenericHook(hookName, flags);
    }
  }

  private generatePreCommitHook(flags: any): string {
    const strictChecks = flags.level === 'strict';
    
    return `#!/bin/sh
#
# Pre-commit hook for code quality checks
# Generated by Pothos CLI (${new Date().toISOString()})
#

set -e

echo "🔍 Running pre-commit checks..."

# Check if staged files exist
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E "\\.(js|jsx|ts|tsx)$" || true)

if [ -z "$STAGED_FILES" ]; then
  echo "✅ No JavaScript/TypeScript files to check"
  exit 0
fi

echo "📁 Checking files: $STAGED_FILES"

# TypeScript type checking
echo "🔤 Running TypeScript checks..."
if ! bun run check:types; then
  echo "❌ TypeScript errors found. Please fix before committing."
  exit 1
fi

# ESLint checking
echo "📏 Running ESLint..."
if ! bun run lint ${strictChecks ? '--max-warnings 0' : ''}; then
  echo "❌ Linting errors found. Please fix before committing."
  exit 1
fi

# Prettier formatting check
echo "🎨 Checking code formatting..."
if ! bunx prettier --check $STAGED_FILES; then
  echo "❌ Code formatting issues found. Running Prettier..."
  bunx prettier --write $STAGED_FILES
  git add $STAGED_FILES
  echo "✅ Code formatted and re-staged"
fi

${strictChecks ? `
# Run unit tests for changed files
echo "🧪 Running unit tests..."
if ! bun test --passWithNoTests; then
  echo "❌ Tests failed. Please fix before committing."
  exit 1
fi

# Security audit
echo "🛡️ Running security audit..."
if ! bun audit; then
  echo "⚠️ Security vulnerabilities found. Please review."
fi
` : ''}

echo "✅ Pre-commit checks passed!"
exit 0
`;
  }

  private generateCommitMsgHook(flags: any): string {
    return `#!/bin/sh
#
# Commit message hook for conventional commits
# Generated by Pothos CLI (${new Date().toISOString()})
#

commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\\(.+\\))?: .{1,50}'

error_msg="❌ Invalid commit message format!

Commit message should follow Conventional Commits specification:
  type(scope): description

Examples:
  feat: add user authentication
  fix(api): resolve cors issue
  docs: update readme
  refactor(auth): simplify token validation

Allowed types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert
"

if ! grep -qE "$commit_regex" "$1"; then
  echo "$error_msg" >&2
  exit 1
fi

echo "✅ Commit message format is valid"
exit 0
`;
  }

  private generatePrePushHook(flags: any): string {
    const strictChecks = flags.level === 'strict';
    
    return `#!/bin/sh
#
# Pre-push hook for comprehensive testing
# Generated by Pothos CLI (${new Date().toISOString()})
#

set -e

echo "🚀 Running pre-push checks..."

# Check if we're pushing to protected branches
protected_branch='main'
current_branch=$(git symbolic-ref HEAD | sed -e 's,.*/\\(.*\\),\\1,')

if [ "$current_branch" = "$protected_branch" ]; then
  echo "⚠️ Pushing to protected branch: $protected_branch"
fi

# Full test suite
echo "🧪 Running full test suite..."
if ! bun test; then
  echo "❌ Tests failed. Push aborted."
  exit 1
fi

# Build verification
echo "🏗️ Verifying build..."
if ! bun run build; then
  echo "❌ Build failed. Push aborted."
  exit 1
fi

# Type checking
echo "🔤 Final TypeScript check..."
if ! bun run check:types; then
  echo "❌ TypeScript errors found. Push aborted."
  exit 1
fi

${strictChecks ? `
# Performance tests
echo "📈 Running performance tests..."
if ! bun test src/tests/performance/; then
  echo "⚠️ Performance tests failed"
fi

# Security scan
echo "🛡️ Running security scan..."
if ! bun audit; then
  echo "⚠️ Security vulnerabilities found"
fi
` : ''}

echo "✅ All pre-push checks passed!"
exit 0
`;
  }

  private generatePostCommitHook(flags: any): string {
    return `#!/bin/sh
#
# Post-commit hook for notifications and cleanup
# Generated by Pothos CLI (${new Date().toISOString()})
#

# Get commit information
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)
AUTHOR=$(git log -1 --pretty=%an)

echo "📝 Commit $COMMIT_HASH by $AUTHOR"

# Optional: Send notification (uncomment if needed)
# echo "New commit: $COMMIT_MSG" | mail -s "Git Commit Notification" developer@example.com

# Optional: Trigger CI/CD (uncomment if needed)
# curl -X POST "https://api.ci-service.com/trigger" -d "commit=$COMMIT_HASH"

exit 0
`;
  }

  private generatePostMergeHook(flags: any): string {
    return `#!/bin/sh
#
# Post-merge hook for dependency updates
# Generated by Pothos CLI (${new Date().toISOString()})
#

echo "🔄 Post-merge cleanup..."

# Check if package.json changed
if git diff HEAD@{1} --name-only | grep -q "package.json"; then
  echo "📦 package.json changed, updating dependencies..."
  bun install
fi

# Check if schema.prisma changed
if git diff HEAD@{1} --name-only | grep -q "prisma/schema.prisma"; then
  echo "🗄️ Prisma schema changed, regenerating client..."
  bun run db:generate
fi

echo "✅ Post-merge tasks completed"
exit 0
`;
  }

  private generateGenericHook(hookName: string, flags: any): string {
    return `#!/bin/sh
#
# ${hookName} hook
# Generated by Pothos CLI (${new Date().toISOString()})
#

echo "🪝 ${hookName} hook executed"

# Add your custom logic here

exit 0
`;
  }

  private async generateHookConfig(flags: any): Promise<void> {
    const config = {
      version: '1.0.0',
      generated: new Date().toISOString(),
      level: flags.level,
      hooks: this.installedHooks,
      settings: {
        strictMode: flags.level === 'strict',
        autoFix: true,
        parallel: true,
      },
    };

    const configPath = '.git/hooks/config.json';
    
    if (!flags['dry-run']) {
      await writeFile(configPath, JSON.stringify(config, null, 2));
      this.log(chalk.green(`📄 Generated hook configuration: ${configPath}`));
    }
  }

  private printSummary(flags: any): void {
    this.log(chalk.blue('\n📊 Hook Setup Summary'));
    this.log('='.repeat(40));
    
    if (flags['dry-run']) {
      this.log(chalk.yellow('🔍 DRY RUN - No changes were made'));
      this.log(chalk.cyan(`Would install ${this.getHooksToSetup(flags).length} hooks`));
    } else {
      this.log(chalk.green(`✅ Successfully installed ${this.installedHooks.length} hooks:`));
      for (const hook of this.installedHooks) {
        this.log(chalk.gray(`  • ${hook}`));
      }
    }
    
    this.log(chalk.blue('\n🚀 Next Steps:'));
    this.log(chalk.yellow('  1. Test hooks with a sample commit'));
    this.log(chalk.yellow('  2. Configure IDE integration for pre-commit checks'));
    this.log(chalk.yellow('  3. Share hook configuration with team members'));
    this.log(chalk.yellow('  4. Consider setting up CI/CD pipeline integration'));
    
    if (flags.level !== 'strict') {
      this.log(chalk.blue('\n💡 Tip:'));
      this.log(chalk.gray('  Use --level strict for maximum code quality enforcement'));
    }
    
    this.log(chalk.blue('\n📚 Hook Management:'));
    this.log(chalk.gray('  • List hooks: pothos-cli hooks list'));
    this.log(chalk.gray('  • Validate hooks: pothos-cli hooks validate'));
    this.log(chalk.gray('  • Test hooks: pothos-cli hooks test'));
  }
}