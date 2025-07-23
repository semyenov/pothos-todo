# Migration Scripts for Base Class Refactoring

This directory contains automated scripts to help migrate the codebase to use the new base classes that eliminate code duplication.

## Scripts Overview

### 1. `analyze-refactoring-opportunities.ts`
Analyzes the codebase to identify refactoring opportunities and estimate the impact of migration.

**Usage:**
```bash
# Analyze entire codebase
bun run refactor:analyze

# Analyze specific directory
bun scripts/analyze-refactoring-opportunities.ts src/infrastructure
```

**Output:**
- Identifies singleton services, repositories, aggregates, and GraphQL auth patterns
- Estimates lines of code reduction
- Categorizes migration complexity (🟢 easy, 🟡 medium, 🔴 hard)
- Provides migration recommendations

### 2. `migrate-to-base-classes.ts`
Automatically migrates existing code to use the new base classes.

**Usage:**
```bash
# Dry run (preview changes without modifying files)
bun run refactor:migrate:dry

# Migrate all patterns
bun run refactor:migrate

# Migrate specific type with options
bun scripts/migrate-to-base-classes.ts --type=singleton --path=src/infrastructure --dry-run
```

**Options:**
- `--dry-run`: Show what would be changed without modifying files
- `--type`: Type of migration: `singleton`, `repository`, `aggregate`, or `all` (default: all)
- `--path`: Specific path to migrate (default: entire codebase)
- `--backup`: Create backup files before migration (default: true)

## Migration Workflow

### Step 1: Analyze
First, run the analyzer to understand the scope of changes:

```bash
bun run refactor:analyze
```

This will show you:
- How many files can be migrated
- Estimated code reduction
- Migration complexity for each file

### Step 2: Dry Run
Always start with a dry run to preview changes:

```bash
bun run refactor:migrate:dry
```

Review the output to ensure the changes look correct.

### Step 3: Migrate by Type
It's recommended to migrate one type at a time:

```bash
# 1. Start with singletons (usually easiest)
bun scripts/migrate-to-base-classes.ts --type=singleton

# 2. Then repositories
bun scripts/migrate-to-base-classes.ts --type=repository

# 3. Then aggregates
bun scripts/migrate-to-base-classes.ts --type=aggregate
```

### Step 4: Test
After each migration batch:

```bash
# Run type checking
bun run check:types

# Run tests
bun test
```

### Step 5: Manual Review
For files marked with 🔴 (hard complexity), manual review and adjustment may be needed.

## What Gets Migrated

### Singleton Services
**Before:**
```typescript
export class MyService {
  private static instance: MyService | null = null;
  
  private constructor() {}
  
  static getInstance(): MyService {
    if (!MyService.instance) {
      MyService.instance = new MyService();
    }
    return MyService.instance;
  }
}
```

**After:**
```typescript
export class MyService extends SingletonService<MyService> {
  protected constructor() {
    super();
  }
  
  static getInstance(): MyService {
    return super.getInstance();
  }
}
```

### Repositories
**Before:**
```typescript
export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({ where: { id } });
    return data ? this.mapToDomain(data) : null;
  }
  
  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: this.mapToCreate(user),
      update: this.mapToUpdate(user),
    });
  }
}
```

**After:**
```typescript
export class UserRepository extends BaseRepository<User, PrismaUser> {
  protected getModelName(): string {
    return 'user';
  }
  
  protected mapToDomain(data: PrismaUser): User {
    return new User(data.id, data.email, data.name);
  }
}
```

### Aggregates
**Before:**
```typescript
export class Todo {
  private _id: string;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _version: number;
  
  update(title: string): void {
    this._title = title;
    this._updatedAt = new Date();
    this._version++;
  }
}
```

**After:**
```typescript
export class Todo extends BaseAggregate {
  update(updates: { title?: string }): void {
    const hasChanges = this.updateFields(updates);
    if (hasChanges) {
      this.addDomainEvent(new TodoUpdated(this.id, updates));
    }
  }
}
```

## Safety Features

1. **Backup Files**: By default, the script creates `.backup` files before modifying
2. **Dry Run**: Always preview changes before applying
3. **Skip Already Migrated**: Won't touch files already using base classes
4. **Skip Test Files**: Ignores `.test.ts` and `.spec.ts` files
5. **Type Safety**: Maintains TypeScript compatibility

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors after migration**
   - Ensure all imports are added correctly
   - Run `bun run check:types` to identify import issues

2. **Tests failing after migration**
   - Check that `super()` calls are added in constructors
   - Verify that method signatures match base class requirements

3. **Async initialization issues**
   - Services with async initialization need `AsyncSingletonService`
   - Update all callers to await `getInstance()`

### Manual Fixes May Be Needed For:

- Services with complex initialization parameters
- Repositories with custom transaction handling
- Aggregates with non-standard update patterns
- Files with multiple classes

## Best Practices

1. **Commit before migrating**: Ensure you have a clean git state
2. **Migrate incrementally**: Don't try to migrate everything at once
3. **Review generated code**: The script is helpful but not perfect
4. **Run tests frequently**: Catch issues early
5. **Update imports**: Some imports may need manual adjustment

## Rollback

If something goes wrong:

1. **With backups enabled** (default):
   ```bash
   # Restore from backup files
   find . -name "*.backup" -exec bash -c 'mv "$0" "${0%.backup}"' {} \;
   ```

2. **Using git**:
   ```bash
   # Discard all changes
   git checkout .
   ```

## Next Steps After Migration

1. Run the analyzer again to verify reduction:
   ```bash
   bun run refactor:analyze
   ```

2. Update documentation to reflect new patterns

3. Set up linting rules to enforce new patterns

4. Consider creating custom snippets/templates for new patterns

## Support

If you encounter issues or need help with complex migrations:

1. Check the `REFACTORING_BEST_PRACTICES.md` guide
2. Review the example migrations in `examples/migrations/`
3. For complex cases, consider manual migration following the patterns