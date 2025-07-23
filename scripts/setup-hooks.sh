#!/bin/bash

# Setup Git Hooks for Pattern Compliance
# This script sets up pre-commit hooks to check for pattern compliance

echo "🔧 Setting up Git hooks for pattern compliance..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

echo "🔍 Running pattern compliance check..."

# Run type check first
echo "📝 Checking TypeScript types..."
if ! bun run check:types > /dev/null 2>&1; then
    echo "❌ TypeScript type errors found. Please fix them before committing."
    echo "   Run 'bun run check:types' to see the errors."
    exit 1
fi

# Get list of staged TypeScript files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js)$')

if [ -n "$STAGED_FILES" ]; then
    # Run pattern analysis on staged files
    echo "🔍 Analyzing code patterns..."
    
    # Create a temporary directory for analysis
    TEMP_DIR=$(mktemp -d)
    
    # Copy staged files to temp directory maintaining structure
    for file in $STAGED_FILES; do
        mkdir -p "$TEMP_DIR/$(dirname $file)"
        git show ":$file" > "$TEMP_DIR/$file"
    done
    
    # Run analysis on temp directory
    ANALYSIS_OUTPUT=$(bun scripts/analyze-refactoring-opportunities.ts "$TEMP_DIR/src" 2>/dev/null || echo "")
    
    # Clean up temp directory
    rm -rf "$TEMP_DIR"
    
    # Extract counts
    SINGLETON_COUNT=$(echo "$ANALYSIS_OUTPUT" | grep "Singleton services found:" | grep -o '[0-9]\+' || echo "0")
    MANUAL_AUTH_COUNT=$(echo "$ANALYSIS_OUTPUT" | grep "GraphQL auth checks found:" | grep -o '[0-9]\+' || echo "0")
    
    # Check if new non-compliant patterns are being added
    if [ "$SINGLETON_COUNT" -gt "0" ]; then
        echo "⚠️  Warning: Found $SINGLETON_COUNT singleton(s) that should use SingletonService base class"
        echo "   Consider using 'bun run refactor:migrate --dry-run' to see how to fix this"
        echo ""
        read -p "Do you want to continue with the commit anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    if [ "$MANUAL_AUTH_COUNT" -gt "0" ]; then
        echo "⚠️  Warning: Found $MANUAL_AUTH_COUNT manual authentication check(s)"
        echo "   Consider using the authenticated middleware instead"
        echo ""
        read -p "Do you want to continue with the commit anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

echo "✅ Pattern compliance check passed"
EOF

# Make the hook executable
chmod +x .git/hooks/pre-commit

# Create commit-msg hook for conventional commits
cat > .git/hooks/commit-msg << 'EOF'
#!/bin/bash

# Check commit message format
commit_regex='^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\(.+\))?: .{1,80}$'

if ! grep -qE "$commit_regex" "$1"; then
    echo "❌ Invalid commit message format!"
    echo ""
    echo "Commit message must follow the Conventional Commits format:"
    echo "  <type>(<scope>): <subject>"
    echo ""
    echo "Examples:"
    echo "  feat: add new singleton base class"
    echo "  fix(auth): resolve middleware composition issue"
    echo "  refactor(repository): migrate to BaseRepository pattern"
    echo ""
    echo "Types: feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert"
    exit 1
fi
EOF

# Make the hook executable
chmod +x .git/hooks/commit-msg

echo "✅ Git hooks setup complete!"
echo ""
echo "The following hooks have been installed:"
echo "  - pre-commit: Checks for pattern compliance and type errors"
echo "  - commit-msg: Enforces conventional commit format"
echo ""
echo "To bypass hooks (not recommended), use: git commit --no-verify"