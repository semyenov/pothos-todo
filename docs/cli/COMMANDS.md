# CLI Commands Reference

Complete reference for all available CLI commands with examples and flags.

## Table of Contents

- [Main Commands](#main-commands)
- [Development Commands](#development-commands)
- [Build Commands](#build-commands)
- [Check Commands](#check-commands)
- [Database Commands](#database-commands)
- [Services Commands](#services-commands)
- [Federation Commands](#federation-commands)
- [Refactoring Commands](#refactoring-commands)
- [Generation Commands](#generation-commands)
- [Infrastructure Commands](#infrastructure-commands)
- [Monitoring Commands](#monitoring-commands)
- [Hooks Commands](#hooks-commands)
- [Status Commands](#status-commands)
- [Utility Commands](#utility-commands)

## Main Commands

### `./bin/run.js`
Opens the main interactive menu with all available options.

**Features:**
- ASCII art banner
- Colored menu options
- Easy navigation
- Quick access to all functionality

**Example:**
```bash
./bin/run.js
```

## Development Commands

### `./bin/run.js dev:menu`
Interactive development menu with server options.

**Options:**
- Start development server (hot reload)
- Start built server from dist/
- Watch mode development
- Build and start workflow

**Example:**
```bash
./bin/run.js dev:menu
```

### `./bin/run.js dev:start`
Start development server with hot reload using Bun.

**Description:** Starts the development server with automatic reloading when files change.

**Example:**
```bash
./bin/run.js dev:start
```

### `./bin/run.js dev:dist`
Start server from built dist/ directory.

**Description:** Runs the built server from the dist/ directory. Builds first if needed.

**Example:**
```bash
./bin/run.js dev:dist
```

### `./bin/run.js dev:watch`
Start development server in watch mode.

**Description:** Similar to dev:start but with explicit watch mode configuration.

**Example:**
```bash
./bin/run.js dev:watch
```

## Build Commands

### `./bin/run.js build:menu`
Interactive build menu with comprehensive options.

**Options:**
- Standard build
- Watch mode build
- Production build
- Clean build
- Build info display
- Build validation

**Example:**
```bash
./bin/run.js build:menu
```

### `./bin/run.js build`
Build the project using tsdown.

**Flags:**
- `--watch, -w`: Watch for file changes and rebuild
- `--prod, -p`: Build for production
- `--clean, -c`: Clean build (remove dist/ first)

**Examples:**
```bash
./bin/run.js build
./bin/run.js build --watch
./bin/run.js build --prod
./bin/run.js build --clean
```

## Check Commands

### `./bin/run.js check:menu`
Interactive validation menu with custom check selection.

**Options:**
- TypeScript type check
- Package validation (publint)
- Type correctness check (attw)
- All checks
- Custom check selection

**Example:**
```bash
./bin/run.js check:menu
```

### `./bin/run.js check`
Run validation checks on the project.

**Flags:**
- `--types, -t`: Check TypeScript types only
- `--publint, -p`: Check package.json with publint only
- `--attw, -a`: Check if types are wrong only

**Examples:**
```bash
./bin/run.js check              # Run all checks
./bin/run.js check --types      # TypeScript only
./bin/run.js check --publint    # Package validation only
./bin/run.js check --attw       # Type correctness only
```

## Database Commands

### `./bin/run.js db:menu`
Interactive database management menu.

**Options:**
- Start/stop database containers
- Database status
- Migration management
- Database seeding
- Database studio
- Database reset

**Example:**
```bash
./bin/run.js db:menu
```

### `./bin/run.js db`
Database management commands.

**Flags:**
- `--up, -u`: Start database containers
- `--down, -d`: Stop database containers
- `--status, -s`: Show database status
- `--migrate, -m`: Run database migrations
- `--seed`: Seed database with test data
- `--studio`: Open database studio
- `--reset`: Reset database to clean state

**Examples:**
```bash
./bin/run.js db --up           # Start database
./bin/run.js db --down         # Stop database
./bin/run.js db --status       # Show status
./bin/run.js db --migrate      # Run migrations
./bin/run.js db --seed         # Seed data
./bin/run.js db --studio       # Open studio
./bin/run.js db --reset        # Reset database
```

## Services Commands

### `./bin/run.js services:menu`
Interactive Docker services management menu.

**Options:**
- Start/stop all services
- Services status
- View logs (static/live)
- Build services
- Restart services
- Clean services

**Example:**
```bash
./bin/run.js services:menu
```

### `./bin/run.js services`
Docker services management commands.

**Flags:**
- `--up, -u`: Start all services
- `--down, -d`: Stop all services
- `--status, -s`: Show services status
- `--logs, -l`: View service logs
- `--follow, -f`: Follow logs in real-time
- `--build, -b`: Build services
- `--rebuild`: Rebuild services (no cache)
- `--restart, -r`: Restart services
- `--clean`: Clean services (remove containers and volumes)

**Examples:**
```bash
./bin/run.js services --up        # Start all services
./bin/run.js services --down      # Stop all services
./bin/run.js services --status    # Show status
./bin/run.js services --logs      # View logs
./bin/run.js services --follow    # Follow live logs
./bin/run.js services --build     # Build services
./bin/run.js services --restart   # Restart services
```

## Federation Commands

### `./bin/run.js federation:menu`
Interactive GraphQL federation management menu.

**Options:**
- Start federation development environment
- Test federation setup
- Docker federation management
- Subgraph testing
- Gateway configuration

**Example:**
```bash
./bin/run.js federation:menu
```

### `./bin/run.js federation:dev`
Start federation development environment with all subgraphs.

**Description:** Automatically starts User, Todo, and AI subgraphs along with the development gateway.

**Example:**
```bash
./bin/run.js federation:dev
```

### `./bin/run.js federation:docker`
Start federation using Docker containers.

**Flags:**
- `--build, -b`: Build containers before starting
- `--dev, -d`: Start in development mode
- `--logs, -l`: Show container logs

**Examples:**
```bash
./bin/run.js federation:docker          # Start with docker compose
./bin/run.js federation:docker --build  # Build and start
./bin/run.js federation:docker --dev    # Development mode
```

### `./bin/run.js federation:test`
Test federation setup and run health checks.

**Description:** Validates that all subgraphs are running and gateway can compose schemas.

**Example:**
```bash
./bin/run.js federation:test
```

### `./bin/run.js subgraph`
Manage individual subgraphs.

**Flags:**
- `--user, -u`: Start User subgraph
- `--todo, -t`: Start Todo subgraph
- `--ai, -a`: Start AI subgraph
- `--all`: Start all subgraphs

**Examples:**
```bash
./bin/run.js subgraph --user    # Start User subgraph
./bin/run.js subgraph --all     # Start all subgraphs
```

## Refactoring Commands

### `./bin/run.js refactor:menu`
Interactive refactoring and migration menu.

**Options:**
- Analyze refactoring opportunities
- Run automated migrations
- Performance benchmarking
- Migration status and rollback

**Example:**
```bash
./bin/run.js refactor:menu
```

### `./bin/run.js refactor:analyze`
Analyze codebase for refactoring opportunities.

**Description:** Scans for singleton patterns, repositories, aggregates, and GraphQL auth patterns that can be migrated to base classes.

**Examples:**
```bash
./bin/run.js refactor:analyze               # Analyze entire codebase
./bin/run.js refactor:analyze --path src/   # Analyze specific path
```

### `./bin/run.js refactor:migrate`
Automated migration to base classes.

**Flags:**
- `--dry-run, -d`: Preview changes without modifying files
- `--type, -t`: Migration type (singleton, repository, aggregate, all)
- `--path, -p`: Specific path to migrate
- `--backup, -b`: Create backup files (default: true)

**Examples:**
```bash
./bin/run.js refactor:migrate --dry-run     # Preview changes
./bin/run.js refactor:migrate --type singleton  # Migrate singletons only
./bin/run.js refactor:migrate --path src/infrastructure  # Specific path
```

### `./bin/run.js refactor:benchmark`
Run performance benchmarks for refactored code.

**Description:** Compares performance before and after refactoring to ensure no significant regressions.

**Example:**
```bash
./bin/run.js refactor:benchmark
```

### `./bin/run.js refactor:compare`
Generate performance comparison reports.

**Description:** Creates HTML and Markdown reports comparing old vs new patterns.

**Example:**
```bash
./bin/run.js refactor:compare
```

## Generation Commands

### `./bin/run.js generate:menu`
Interactive code generation menu.

**Options:**
- Generate singleton services
- Generate repositories
- Generate domain aggregates
- Generate GraphQL middleware
- Generate with tests

**Example:**
```bash
./bin/run.js generate:menu
```

### `./bin/run.js generate`
Generate code from templates.

**Arguments:**
- `<type>`: Template type (singleton, async-singleton, repository, aggregate, middleware)
- `<name>`: Name for the generated component

**Flags:**
- `--path, -p`: Custom output path
- `--with-tests, -t`: Generate test file
- `--async, -a`: Generate async version (for singletons)

**Examples:**
```bash
./bin/run.js generate singleton EmailService          # Generate singleton
./bin/run.js generate repository Product --with-tests # Repository with tests
./bin/run.js generate aggregate Order --path src/domain/
./bin/run.js generate middleware requiresSubscription
```

## Infrastructure Commands

### `./bin/run.js pulumi:menu`
Interactive infrastructure deployment menu.

**Options:**
- Deploy infrastructure
- Destroy infrastructure
- Preview changes
- Manage configuration
- View deployment status

**Example:**
```bash
./bin/run.js pulumi:menu
```

### `./bin/run.js pulumi:deploy`
Deploy infrastructure using Pulumi.

**Flags:**
- `--stack, -s`: Target stack (dev, staging, prod)
- `--preview, -p`: Preview changes only
- `--force, -f`: Force deployment without confirmation
- `--verbose, -v`: Enable verbose output

**Examples:**
```bash
./bin/run.js pulumi:deploy --stack dev      # Deploy to development
./bin/run.js pulumi:deploy --preview        # Preview changes
./bin/run.js pulumi:deploy --stack prod --force  # Force production deploy
```

### `./bin/run.js pulumi:destroy`
Destroy infrastructure.

**Flags:**
- `--stack, -s`: Target stack to destroy
- `--force, -f`: Skip confirmation
- `--backup, -b`: Create state backup before destroying

**Examples:**
```bash
./bin/run.js pulumi:destroy --stack dev     # Destroy development
./bin/run.js pulumi:destroy --force --backup  # Force with backup
```

### `./bin/run.js pulumi:status`
Show infrastructure deployment status.

**Flags:**
- `--stack, -s`: Target stack
- `--json, -j`: Output as JSON
- `--resources, -r`: Show resource details

**Examples:**
```bash
./bin/run.js pulumi:status                  # Current stack status
./bin/run.js pulumi:status --stack prod    # Production status
./bin/run.js pulumi:status --json          # JSON output
```

### `./bin/run.js pulumi:config`
Manage infrastructure configuration.

**Description:** Interactive configuration management for Pulumi stacks.

**Example:**
```bash
./bin/run.js pulumi:config
```

## Monitoring Commands

### `./bin/run.js monitoring:menu`
Interactive monitoring and health check menu.

**Options:**
- Run health checks
- Start monitoring dashboard
- View service logs
- Check system diagnostics

**Example:**
```bash
./bin/run.js monitoring:menu
```

### `./bin/run.js health:check`
Run comprehensive health checks.

**Description:** Checks health of all federation services, databases, and external dependencies.

**Flags:**
- `--services, -s`: Check services only
- `--databases, -d`: Check databases only
- `--verbose, -v`: Detailed output
- `--json, -j`: JSON output

**Examples:**
```bash
./bin/run.js health:check                   # Full health check
./bin/run.js health:check --services       # Services only
./bin/run.js health:check --json           # JSON output
```

### `./bin/run.js monitoring:start`
Start monitoring and observability services.

**Description:** Starts Prometheus, Grafana, and other monitoring services.

**Example:**
```bash
./bin/run.js monitoring:start
```

### `./bin/run.js diagnostics`
Run system diagnostics.

**Flags:**
- `--performance, -p`: Performance diagnostics
- `--network, -n`: Network connectivity checks
- `--storage, -s`: Storage and disk checks

**Examples:**
```bash
./bin/run.js diagnostics                    # All diagnostics
./bin/run.js diagnostics --performance     # Performance only
```

## Hooks Commands

### `./bin/run.js hooks:menu`
Interactive Git hooks management menu.

**Options:**
- Setup Git hooks
- Configure pattern compliance
- Test hook functionality
- Remove hooks

**Example:**
```bash
./bin/run.js hooks:menu
```

### `./bin/run.js hooks:setup`
Setup Git hooks for pattern compliance.

**Description:** Installs pre-commit and commit-msg hooks for code quality and conventional commits.

**Flags:**
- `--force, -f`: Overwrite existing hooks
- `--compliance, -c`: Enable pattern compliance checks
- `--conventional, -v`: Enable conventional commit format

**Examples:**
```bash
./bin/run.js hooks:setup                    # Setup all hooks
./bin/run.js hooks:setup --force           # Overwrite existing
./bin/run.js hooks:setup --compliance      # Compliance only
```

### `./bin/run.js hooks:test`
Test Git hooks functionality.

**Description:** Validates that installed hooks work correctly.

**Example:**
```bash
./bin/run.js hooks:test
```

### `./bin/run.js hooks:remove`
Remove installed Git hooks.

**Flags:**
- `--all, -a`: Remove all hooks
- `--pre-commit`: Remove pre-commit hook only
- `--commit-msg`: Remove commit-msg hook only

**Examples:**
```bash
./bin/run.js hooks:remove --all            # Remove all hooks
./bin/run.js hooks:remove --pre-commit     # Remove pre-commit only
```

## Status Commands

### `./bin/run.js status`
Show comprehensive system status dashboard.

**Flags:**
- `--watch, -w`: Watch mode (refresh every 5 seconds)
- `--minimal, -m`: Show minimal status info
- `--json, -j`: Output status as JSON

**Features:**
- System information (Node.js, platform, architecture)
- Docker status and running services
- Build status and TypeScript validation
- Git status and branch information
- Package information
- Disk usage statistics

**Examples:**
```bash
./bin/run.js status           # Full status dashboard
./bin/run.js status --watch   # Watch mode
./bin/run.js status --minimal # Minimal info
./bin/run.js status --json    # JSON output
```

## Utility Commands

### Help Commands
Get help for any command:

```bash
./bin/run.js --help                    # General help
./bin/run.js build --help              # Build command help
./bin/run.js dev:start --help          # Dev start command help
./bin/run.js db --help                 # Database command help
./bin/run.js services --help           # Services command help
./bin/run.js status --help             # Status command help
```

## Command Patterns

### Interactive vs Direct Commands

**Interactive Commands:**
- Use `:menu` suffix (e.g., `dev:menu`, `build:menu`)
- Provide guided menus with options
- Include confirmations for destructive actions
- Show progress indicators

**Direct Commands:**
- Use flags for specific actions
- Suitable for scripting and automation
- Faster execution for known operations
- Exit with appropriate status codes

### Error Handling

All commands include:
- **Graceful error handling** with descriptive messages
- **Appropriate exit codes** (0 for success, 1 for failure)
- **Helpful suggestions** for common issues
- **Dependency checks** (Docker, build status, etc.)

### Output Formatting

Commands use:
- **Colored output** with chalk for better readability
- **Icons and emojis** for visual distinction
- **Boxed output** for important information
- **Consistent formatting** across all commands

## Examples by Use Case

### Development Workflow
```bash
# Start development
./bin/run.js dev:start

# Or use interactive menu
./bin/run.js dev:menu
```

### Build and Deploy
```bash
# Build for production
./bin/run.js build --prod

# Validate build
./bin/run.js check

# Check status
./bin/run.js status
```

### Database Management
```bash
# Start database
./bin/run.js db --up

# Run migrations
./bin/run.js db --migrate

# Seed data
./bin/run.js db --seed
```

### Service Management
```bash
# Start all services
./bin/run.js services --up

# Check status
./bin/run.js services --status

# View logs
./bin/run.js services --logs
```

### Monitoring
```bash
# Watch system status
./bin/run.js status --watch

# Get JSON status for scripts
./bin/run.js status --json
```

### Federation Development
```bash
# Start federation environment
./bin/run.js federation:dev

# Test federation setup
./bin/run.js federation:test

# Docker federation with build
./bin/run.js federation:docker --build
```

### Infrastructure Management
```bash
# Deploy to development
./bin/run.js pulumi:deploy --stack dev

# Preview production changes
./bin/run.js pulumi:deploy --stack prod --preview

# Check deployment status
./bin/run.js pulumi:status --stack prod --json
```

### Code Refactoring
```bash
# Analyze refactoring opportunities
./bin/run.js refactor:analyze

# Preview migration changes
./bin/run.js refactor:migrate --dry-run

# Migrate singleton services only
./bin/run.js refactor:migrate --type singleton

# Generate performance comparison
./bin/run.js refactor:compare
```

### Code Generation
```bash
# Generate singleton service
./bin/run.js generate singleton EmailService

# Generate repository with tests
./bin/run.js generate repository Product --with-tests

# Generate domain aggregate with custom path
./bin/run.js generate aggregate Order --path src/domain/orders/

# Generate GraphQL middleware
./bin/run.js generate middleware requiresSubscription
```

### Health and Monitoring
```bash
# Run comprehensive health checks
./bin/run.js health:check

# Check services only
./bin/run.js health:check --services --json

# Start monitoring dashboard
./bin/run.js monitoring:start

# Run system diagnostics
./bin/run.js diagnostics --performance
```

### Git Hooks Management
```bash
# Setup all Git hooks
./bin/run.js hooks:setup

# Setup with pattern compliance
./bin/run.js hooks:setup --compliance

# Test hook functionality
./bin/run.js hooks:test
```

## Advanced Usage

### Scripting
Commands can be used in scripts with proper error handling:

```bash
#!/bin/bash

# Build and check
./bin/run.js build --prod
if [ $? -eq 0 ]; then
    ./bin/run.js check
    if [ $? -eq 0 ]; then
        echo "Build and validation successful"
    else
        echo "Validation failed"
        exit 1
    fi
else
    echo "Build failed"
    exit 1
fi
```

### JSON Output
Use JSON output for integration with other tools:

```bash
# Get status as JSON
./bin/run.js status --json | jq '.docker.running'

# Check if build is successful
./bin/run.js status --json | jq '.build.status == "success"'
```

### Watch Mode
Use watch mode for continuous monitoring:

```bash
# Monitor system status
./bin/run.js status --watch

# Build in watch mode
./bin/run.js build --watch

# Follow service logs
./bin/run.js services --follow
```