# CLI Examples

Practical examples and workflows for using the Pothos CLI in different scenarios.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Workflows](#development-workflows)
- [Build and Deployment](#build-and-deployment)
- [Database Management](#database-management)
- [Service Management](#service-management)
- [Federation Development](#federation-development)
- [Infrastructure Deployment](#infrastructure-deployment)
- [Code Refactoring](#code-refactoring)
- [Code Generation](#code-generation)
- [Testing and Validation](#testing-and-validation)
- [Monitoring and Debugging](#monitoring-and-debugging)
- [Git Hooks and Compliance](#git-hooks-and-compliance)
- [Advanced Scenarios](#advanced-scenarios)

## Quick Start

### First Time Setup
```bash
# Install dependencies
bun install

# Start the interactive CLI
./bin/run.js

# Or check system status
./bin/run.js status
```

### Common Commands
```bash
# Start development server
./bin/run.js dev:start

# Build project
./bin/run.js build

# Check everything
./bin/run.js check

# Start database
./bin/run.js db --up
```

## Development Workflows

### Standard Development Flow
```bash
# 1. Start database services
./bin/run.js db --up

# 2. Start development server
./bin/run.js dev:start

# 3. In another terminal, monitor status
./bin/run.js status --watch
```

### Interactive Development
```bash
# Use the main menu for guided workflow
./bin/run.js

# Select "Development" -> "Start Development Server"
# The CLI will handle everything with confirmation prompts
```

### Hot Reload Development
```bash
# Start with hot reload (default)
./bin/run.js dev:start

# Or explicitly use watch mode
./bin/run.js dev:watch
```

### Test Built Version
```bash
# Build first
./bin/run.js build

# Start from dist/
./bin/run.js dev:dist
```

## Build and Deployment

### Production Build
```bash
# Clean production build
./bin/run.js build --clean --prod

# Validate the build
./bin/run.js check

# Check build status
./bin/run.js status
```

### Continuous Build
```bash
# Watch mode build
./bin/run.js build --watch

# Monitor in another terminal
./bin/run.js status --watch
```

### Build Pipeline
```bash
#!/bin/bash
# build-pipeline.sh

echo "Starting build pipeline..."

# Clean build
./bin/run.js build --clean
if [ $? -ne 0 ]; then
    echo "Build failed"
    exit 1
fi

# Run all checks
./bin/run.js check
if [ $? -ne 0 ]; then
    echo "Validation failed"
    exit 1
fi

echo "Build pipeline completed successfully"
```

### Interactive Build Management
```bash
# Use build menu for guided experience
./bin/run.js build:menu

# Options include:
# - Standard build
# - Watch mode
# - Production build
# - Clean build
# - Build info
# - Build validation
```

## Database Management

### Database Setup
```bash
# Start database containers
./bin/run.js db --up

# Run migrations
./bin/run.js db --migrate

# Seed with test data
./bin/run.js db --seed

# Open database studio
./bin/run.js db --studio
```

### Database Development Workflow
```bash
# Interactive database menu
./bin/run.js db:menu

# Quick status check
./bin/run.js db --status

# Reset database for clean state
./bin/run.js db --reset
```

### Migration Management
```bash
# Interactive migration menu
./bin/run.js db:menu
# Select "Migration Menu"

# Available options:
# - Run migrations
# - Migration status
# - Create new migration
# - Rollback migration
# - Reset migrations
```

### Database Troubleshooting
```bash
# Check database status
./bin/run.js db --status

# If issues, try restarting
./bin/run.js services --restart

# Or reset completely
./bin/run.js db --reset
```

## Service Management

### Start All Services
```bash
# Start all Docker services
./bin/run.js services --up

# Check status
./bin/run.js services --status

# View logs
./bin/run.js services --logs
```

### Service Monitoring
```bash
# Follow live logs
./bin/run.js services --follow

# Or use interactive menu
./bin/run.js services:menu
# Select "Follow Logs" -> Choose service
```

### Service Development
```bash
# Build services
./bin/run.js services --build

# Rebuild without cache
./bin/run.js services --rebuild

# Restart services
./bin/run.js services --restart
```

### Service Cleanup
```bash
# Stop all services
./bin/run.js services --down

# Clean everything (containers + volumes)
./bin/run.js services --clean
```

## Federation Development

### Setting Up Federation Environment
```bash
# Start all federation services
./bin/run.js federation:dev

# In another terminal, test the setup
./bin/run.js federation:test

# Check health of all services
./bin/run.js health:check --services
```

### Federation Development Workflow
```bash
# Interactive federation menu
./bin/run.js federation:menu

# Development flow:
# 1. Start federation development
# 2. Test individual subgraphs
# 3. Validate gateway composition
# 4. Run integration tests
```

### Docker Federation Development
```bash
# Start with clean containers
./bin/run.js services --clean
./bin/run.js federation:docker --build

# Monitor logs
./bin/run.js services --follow

# Test the federation
curl http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name } } }"}'
```

### Subgraph Development
```bash
# Start specific subgraphs for development
./bin/run.js subgraph --user    # User subgraph only
./bin/run.js subgraph --todo    # Todo subgraph only
./bin/run.js subgraph --ai      # AI subgraph only

# Start all subgraphs
./bin/run.js subgraph --all

# Test individual subgraph
curl http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users { id email } }"}'
```

### Federation Troubleshooting
```bash
# Check federation health
./bin/run.js health:check

# View gateway logs
./bin/run.js services --logs | grep gateway

# Restart federation components
./bin/run.js federation:docker --build
```

## Infrastructure Deployment

### Development Environment Setup
```bash
# Deploy development infrastructure
./bin/run.js pulumi:deploy --stack dev

# Check deployment status
./bin/run.js pulumi:status --stack dev

# View infrastructure configuration
./bin/run.js pulumi:config
```

### Staging Deployment
```bash
# Preview staging deployment
./bin/run.js pulumi:deploy --stack staging --preview

# Deploy to staging
./bin/run.js pulumi:deploy --stack staging

# Monitor deployment
./bin/run.js pulumi:status --stack staging --json | jq '.resources'
```

### Production Deployment
```bash
# Interactive deployment menu for safety
./bin/run.js pulumi:menu

# Follow the guided workflow:
# 1. Select "Deploy Infrastructure"
# 2. Choose "Production" stack
# 3. Review preview
# 4. Confirm deployment

# Alternative: Direct deployment with confirmation
./bin/run.js pulumi:deploy --stack prod
```

### Infrastructure Management
```bash
# Create state backup before changes
./bin/run.js pulumi:status --stack prod --backup

# Update configuration
./bin/run.js pulumi:config

# Roll back if needed
./bin/run.js pulumi:destroy --stack staging
./bin/run.js pulumi:deploy --stack staging
```

### Multi-Stack Deployment
```bash
#!/bin/bash
# deploy-all-environments.sh

# Deploy to all environments
for stack in dev staging prod; do
    echo "Deploying to $stack..."
    ./bin/run.js pulumi:deploy --stack $stack --preview
    
    if [ "$stack" = "prod" ]; then
        read -p "Deploy to production? [y/N] " confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            ./bin/run.js pulumi:deploy --stack $stack
        fi
    else
        ./bin/run.js pulumi:deploy --stack $stack
    fi
    
    echo "Deployment to $stack completed"
done
```

## Code Refactoring

### Refactoring Analysis Workflow
```bash
# Analyze entire codebase
./bin/run.js refactor:analyze

# Analyze specific directory
./bin/run.js refactor:analyze --path src/infrastructure

# Interactive refactoring menu
./bin/run.js refactor:menu
```

### Step-by-Step Migration
```bash
# 1. Preview all changes
./bin/run.js refactor:migrate --dry-run

# 2. Start with singletons (usually safest)
./bin/run.js refactor:migrate --type singleton --dry-run
./bin/run.js refactor:migrate --type singleton

# 3. Validate changes
./bin/run.js check --types

# 4. Migrate repositories
./bin/run.js refactor:migrate --type repository --dry-run
./bin/run.js refactor:migrate --type repository

# 5. Final validation
./bin/run.js check
```

### Incremental Migration
```bash
# Migrate specific paths incrementally
./bin/run.js refactor:migrate --path src/infrastructure/services --type singleton
./bin/run.js refactor:migrate --path src/infrastructure/repositories --type repository
./bin/run.js refactor:migrate --path src/domain/aggregates --type aggregate

# Check progress after each migration
./bin/run.js refactor:analyze
```

### Performance Benchmarking
```bash
# Run performance benchmarks
./bin/run.js refactor:benchmark

# Generate comparison reports
./bin/run.js refactor:compare

# Review reports
open reports/performance-comparison.html
cat reports/performance-comparison.md
```

### Migration Troubleshooting
```bash
# If migration fails, restore from backup
find . -name "*.backup" -exec bash -c 'mv "$0" "${0%.backup}"' {} \;

# Or use git to reset
git checkout .

# Fix specific issues manually, then retry
./bin/run.js refactor:migrate --type singleton --path src/specific/file.ts
```

## Code Generation

### Service Generation Workflow
```bash
# Interactive generation menu
./bin/run.js generate:menu

# Generate singleton service
./bin/run.js generate singleton EmailService --with-tests

# Generate async singleton for external integrations
./bin/run.js generate async-singleton PaymentService --with-tests
```

### Repository Generation
```bash
# Generate repository for new entity
./bin/run.js generate repository Product --with-tests

# Generate with custom path
./bin/run.js generate repository Order \
  --path src/infrastructure/repositories/OrderRepository.ts \
  --with-tests
```

### Domain Model Generation
```bash
# Generate domain aggregate
./bin/run.js generate aggregate Customer --with-tests

# Generate with custom path
./bin/run.js generate aggregate Invoice \
  --path src/domain/billing/Invoice.ts \
  --with-tests
```

### Middleware Generation
```bash
# Generate GraphQL middleware
./bin/run.js generate middleware requiresSubscription

# Generate rate limiting middleware
./bin/run.js generate middleware rateLimit --with-tests
```

### Batch Generation Workflow
```bash
#!/bin/bash
# generate-feature.sh - Generate all components for a new feature

FEATURE_NAME=$1

# Generate domain aggregate
./bin/run.js generate aggregate $FEATURE_NAME --with-tests

# Generate repository
./bin/run.js generate repository $FEATURE_NAME --with-tests

# Generate service
./bin/run.js generate singleton ${FEATURE_NAME}Service --with-tests

echo "Generated complete feature: $FEATURE_NAME"
echo "Next steps:"
echo "1. Update Prisma schema"
echo "2. Run migrations"
echo "3. Add GraphQL types and resolvers"
```

## Testing and Validation

### Complete Validation
```bash
# Run all checks
./bin/run.js check

# Or use interactive menu
./bin/run.js check:menu
```

### Specific Checks
```bash
# Only TypeScript
./bin/run.js check --types

# Only package validation
./bin/run.js check --publint

# Only type correctness
./bin/run.js check --attw
```

### Custom Validation
```bash
# Interactive custom selection
./bin/run.js check:menu
# Select "Custom Check"
# Choose specific checks to run
```

### Pre-commit Workflow
```bash
#!/bin/bash
# pre-commit.sh

echo "Running pre-commit checks..."

# Type check
./bin/run.js check --types
if [ $? -ne 0 ]; then
    echo "TypeScript errors found"
    exit 1
fi

# Package validation
./bin/run.js check --publint
if [ $? -ne 0 ]; then
    echo "Package validation failed"
    exit 1
fi

echo "Pre-commit checks passed"
```

## Monitoring and Debugging

### System Status Dashboard
```bash
# Full status dashboard
./bin/run.js status

# Watch mode (auto-refresh every 5 seconds)
./bin/run.js status --watch

# Minimal status
./bin/run.js status --minimal
```

### JSON Status for Scripts
```bash
# Get JSON status
./bin/run.js status --json

# Parse with jq
./bin/run.js status --json | jq '.docker.running'
./bin/run.js status --json | jq '.build.status'
./bin/run.js status --json | jq '.git.branch'
```

### Debugging Services
```bash
# Check service status
./bin/run.js services --status

# View logs
./bin/run.js services --logs

# Follow specific service logs
./bin/run.js services:menu
# Select "Follow Logs" -> Choose service
```

### Build Debugging
```bash
# Check build status
./bin/run.js build:menu
# Select "Build Info"

# Or use status dashboard
./bin/run.js status

# Validate build
./bin/run.js build:menu
# Select "Validate Build"
```

## Git Hooks and Compliance

### Setting Up Git Hooks
```bash
# Interactive hooks setup
./bin/run.js hooks:menu

# Direct setup with all features
./bin/run.js hooks:setup --compliance --conventional

# Setup specific hooks
./bin/run.js hooks:setup --compliance  # Pattern compliance only
./bin/run.js hooks:setup --conventional # Conventional commits only
```

### Pattern Compliance Workflow
```bash
# Setup compliance hooks
./bin/run.js hooks:setup --compliance

# Test the hooks
./bin/run.js hooks:test

# Try making a commit with non-compliant code
git add .
git commit -m "test: add new feature"

# The hook will:
# 1. Run TypeScript type checks
# 2. Analyze code patterns
# 3. Warn about manual singleton patterns
# 4. Ask for confirmation if issues found
```

### Conventional Commits Enforcement
```bash
# Setup conventional commit hooks
./bin/run.js hooks:setup --conventional

# Valid commit messages:
git commit -m "feat: add new federation support"
git commit -m "fix(auth): resolve middleware composition issue"
git commit -m "refactor(repository): migrate to BaseRepository pattern"
git commit -m "docs: update CLI documentation"
git commit -m "chore: update dependencies"

# Invalid commit messages (will be rejected):
git commit -m "added new feature"
git commit -m "fix stuff"
git commit -m "WIP"
```

### Hook Testing and Debugging
```bash
# Test hook functionality
./bin/run.js hooks:test

# If hooks are causing issues, disable temporarily
git commit --no-verify -m "emergency fix"

# Remove problematic hooks
./bin/run.js hooks:remove --pre-commit

# Reinstall with different configuration
./bin/run.js hooks:setup --force
```

### Team Compliance Workflow
```bash
#!/bin/bash
# team-setup.sh - Setup for new team members

echo "Setting up development environment..."

# Install dependencies
bun install

# Setup Git hooks for compliance
./bin/run.js hooks:setup --compliance --conventional

# Setup development environment
./bin/run.js services --up
./bin/run.js db --migrate

echo "Environment ready! Commit guidelines:"
echo "1. Use conventional commit format"
echo "2. Run './bin/run.js check' before commits"
echo "3. Follow established patterns"
echo "4. Use './bin/run.js refactor:analyze' to check compliance"
```

### Compliance Checking Workflow
```bash
# Check current compliance status
./bin/run.js refactor:analyze

# Before making changes, analyze patterns
./bin/run.js refactor:analyze --path src/new-feature/

# After development, validate patterns
./bin/run.js check --types
./bin/run.js refactor:analyze

# If non-compliant patterns found, migrate them
./bin/run.js refactor:migrate --dry-run --path src/new-feature/
./bin/run.js refactor:migrate --path src/new-feature/
```

## Advanced Scenarios

### CI/CD Integration
```bash
#!/bin/bash
# ci-cd.sh

# Set up environment
export NODE_ENV=production

# Install dependencies
bun install

# Start services
./bin/run.js services --up

# Wait for services to be ready
sleep 10

# Run migrations
./bin/run.js db --migrate

# Build
./bin/run.js build --prod

# Run tests/validation
./bin/run.js check

# Check final status
./bin/run.js status --json

# Cleanup
./bin/run.js services --down
```

### Development Team Workflow
```bash
# Morning routine
./bin/run.js services --up
./bin/run.js db --migrate
./bin/run.js dev:start

# Before commits
./bin/run.js check

# End of day
./bin/run.js services --down
```

### Docker Development
```bash
# Start with fresh containers
./bin/run.js services --clean
./bin/run.js services --up

# Build services
./bin/run.js services --build

# Monitor logs
./bin/run.js services --follow
```

### Performance Monitoring
```bash
# Watch system status
./bin/run.js status --watch

# Monitor services
./bin/run.js services:menu
# Select "View Logs" for performance logs
```

### Automation Scripts

#### Health Check Script
```bash
#!/bin/bash
# health-check.sh

echo "Performing health check..."

# Get status as JSON
STATUS=$(./bin/run.js status --json)

# Check Docker
DOCKER_RUNNING=$(echo $STATUS | jq -r '.docker.running')
if [ "$DOCKER_RUNNING" != "true" ]; then
    echo "❌ Docker not running"
    exit 1
fi

# Check build
BUILD_STATUS=$(echo $STATUS | jq -r '.build.status')
if [ "$BUILD_STATUS" != "success" ]; then
    echo "❌ Build issues detected"
    exit 1
fi

echo "✅ Health check passed"
```

#### Setup Script
```bash
#!/bin/bash
# setup.sh

echo "Setting up development environment..."

# Install dependencies
bun install

# Start services
./bin/run.js services --up

# Wait for services
sleep 5

# Run migrations
./bin/run.js db --migrate

# Seed data
./bin/run.js db --seed

# Build project
./bin/run.js build

# Verify everything
./bin/run.js status

echo "Setup complete!"
```

#### Cleanup Script
```bash
#!/bin/bash
# cleanup.sh

echo "Cleaning up development environment..."

# Stop services
./bin/run.js services --down

# Clean containers and volumes
./bin/run.js services --clean

# Remove build artifacts
rm -rf dist/

echo "Cleanup complete!"
```

### Interactive Workflows

#### New Developer Onboarding
```bash
# 1. Start main CLI
./bin/run.js

# 2. Follow menu prompts:
#    - Select "Services" -> "Start All Services"
#    - Select "Database" -> "Migration Menu" -> "Run Migrations"
#    - Select "Database" -> "Seed Database"
#    - Select "Development" -> "Start Development Server"
```

#### Daily Development
```bash
# Start with interactive menu
./bin/run.js

# Common flow:
# 1. Check status
# 2. Start services if needed
# 3. Run any pending migrations
# 4. Start development server
```

#### Pre-deployment Checklist
```bash
# Interactive build menu
./bin/run.js build:menu

# Build for production
# Validate build
# Run all checks
# Confirm everything is ready
```

### Error Handling Examples

#### Build Failure Recovery
```bash
# If build fails
./bin/run.js build --clean  # Clean build
./bin/run.js check --types  # Check TypeScript
./bin/run.js status         # Check overall status
```

#### Service Issues
```bash
# If services won't start
./bin/run.js services --clean    # Clean everything
./bin/run.js services --build    # Rebuild
./bin/run.js services --up       # Start fresh
```

#### Database Issues
```bash
# If database issues
./bin/run.js db --down     # Stop database
./bin/run.js db --up       # Start fresh
./bin/run.js db --migrate  # Run migrations
```

These examples demonstrate the flexibility and power of the Pothos CLI for various development scenarios. The interactive menus provide guidance for new users, while direct commands offer efficiency for experienced developers and automation scripts.