import { defineConfig } from 'tsdown'

// Load build configuration from environment variables with fallbacks
const buildConfig = {
  minify: process.env.BUILD_MINIFY === 'true' || process.env.NODE_ENV === 'production',
  sourcemap: process.env.BUILD_SOURCEMAP !== 'false' && process.env.NODE_ENV !== 'production',
  target: process.env.BUILD_TARGET || 'ES2022',
  platform: process.env.BUILD_PLATFORM || 'node',
  outDir: process.env.BUILD_OUT_DIR || 'dist',
  clean: process.env.BUILD_CLEAN !== 'false',
  dts: false, // Temporarily disabled due to type generation issues
  treeshake: process.env.BUILD_TREESHAKE !== 'false',
  report: process.env.BUILD_REPORT !== 'false',
  watch: process.env.BUILD_WATCH === 'true',
}

export default defineConfig({
  outputOptions: {
    exports: 'named',
  },
  // Entry points for different usage scenarios
  entry: {
    // Main server entry point
    index: './index.ts',
    // API server for library usage
    'api/server': './src/api/server/server.ts',
    // GraphQL schema for library usage
    'api/schema': './src/api/schema/schema.ts',
    'api/schema/queries': './src/api/schema/queries/index.ts',
    'api/schema/mutations': './src/api/schema/mutations/index.ts',
    // Domain layer for library usage
    'domain/index': './src/domain/index.ts',
    // Application layer for library usage
    'application/index': './src/application/index.ts',
    // Infrastructure layer for library usage
    'infrastructure/index': './src/infrastructure/index.ts',
    // CLI commands
    'commands/index': './src/commands/index.ts',
    'commands/interactive': './src/commands/interactive.ts',
    'commands/status': './src/commands/status.ts',
    'commands/build/index': './src/commands/build/index.ts',
    'commands/build/menu': './src/commands/build/menu.ts',
    'commands/check/index': './src/commands/check/index.ts',
    'commands/check/menu': './src/commands/check/menu.ts',
    'commands/config/show': './src/commands/config/show.ts',
    'commands/config/validate': './src/commands/config/validate.ts',
    'commands/config/menu': './src/commands/config/menu.ts',
    'commands/db/index': './src/commands/db/index.ts',
    'commands/db/menu': './src/commands/db/menu.ts',
    'commands/dev/start': './src/commands/dev/start.ts',
    'commands/dev/dist': './src/commands/dev/dist.ts',
    'commands/dev/menu': './src/commands/dev/menu.ts',
    'commands/services/index': './src/commands/services/index.ts',
    'commands/services/menu': './src/commands/services/menu.ts',
    // Federation commands
    'commands/federation/dev': './src/commands/federation/dev.ts',
    'commands/federation/docker': './src/commands/federation/docker.ts',
    'commands/federation/test': './src/commands/federation/test.ts',
    'commands/federation/subgraph': './src/commands/federation/subgraph.ts',
    'commands/federation/menu': './src/commands/federation/menu.ts',
    // Refactor commands
    'commands/refactor/analyze': './src/commands/refactor/analyze.ts',
    'commands/refactor/migrate': './src/commands/refactor/migrate.ts',
    'commands/refactor/benchmark': './src/commands/refactor/benchmark.ts',
    'commands/refactor/compare': './src/commands/refactor/compare.ts',
    'commands/refactor/menu': './src/commands/refactor/menu.ts',
    // Generate commands
    'commands/generate/domain': './src/commands/generate/domain.ts',
    'commands/generate/schema': './src/commands/generate/schema.ts',
    'commands/generate/repository': './src/commands/generate/repository.ts',
    'commands/generate/service': './src/commands/generate/service.ts',
    'commands/generate/scaffold': './src/commands/generate/scaffold.ts',
    'commands/generate/menu': './src/commands/generate/menu.ts',
    // Pulumi commands
    'commands/pulumi/deploy': './src/commands/pulumi/deploy.ts',
    'commands/pulumi/preview': './src/commands/pulumi/preview.ts',
    'commands/pulumi/stack': './src/commands/pulumi/stack.ts',
    'commands/pulumi/menu': './src/commands/pulumi/menu.ts',
    // Monitoring commands
    'commands/monitoring/health': './src/commands/monitoring/health.ts',
    'commands/monitoring/metrics': './src/commands/monitoring/metrics.ts',
    'commands/monitoring/menu': './src/commands/monitoring/menu.ts',
    // Hooks commands
    'commands/hooks/setup': './src/commands/hooks/setup.ts',
    'commands/hooks/validate': './src/commands/hooks/validate.ts',
    'commands/hooks/menu': './src/commands/hooks/menu.ts',
    'lib/utils': './src/lib/utils.ts',
    'logger': './src/logger.ts',
    // Configuration files
    'config/index': './src/config/index.ts'
  },

  // Output formats
  format: ['esm', 'cjs'],

  // Platform and target (from configuration)
  platform: buildConfig.platform as any,
  target: buildConfig.target,

  // Output configuration (from configuration)
  outDir: buildConfig.outDir,
  clean: buildConfig.clean,

  // TypeScript settings
  dts: true, // Temporarily disabled due to type generation issues
  tsconfig: './tsconfig.json',

  // Development settings (from configuration)
  sourcemap: buildConfig.sourcemap,

  // Optimization settings (from configuration)
  treeshake: buildConfig.treeshake,
  minify: buildConfig.minify,

  // Validation (disabled for private packages)
  publint: false,

  // External dependencies (don't bundle these)
  external: [
    // Node.js built-ins
    /^node:/,

    // Configuration
    'c12',

    // Database
    '@prisma/client',
    'prisma',

    // GraphQL ecosystem
    'graphql',
    'graphql-yoga',
    '@apollo/subgraph',

    // Pothos plugins
    /@pothos\/.*/,

    // CLI dependencies
    /@oclif\/.*/,
    'execa',
    'inquirer',
    'chalk',
    'boxen',
    'figlet',
    'ora',
    'listr2',
    'winston',

    // UnJS packages
    'ofetch',
    'consola',
    'defu',
    'ohash',
    'ufo',
    'pathe',
    'unstorage',
    'scule',
    'jiti',
    'mlly',
    'unconfig',
    'unhead',
    'uncrypto',
    'listhen',
    'nypm',
    'pkg-types'
  ],

  // Skip bundling node_modules for server usage
  skipNodeModulesBundle: true,

  // Reporting (from configuration)
  report: buildConfig.report,

  // Watch mode configuration (from configuration)
  watch: buildConfig.watch,

  // Hooks for custom build steps
  hooks: {
    'build:prepare': async () => {
      console.log('🔧 Preparing build...')
      console.log('Build configuration:', buildConfig)
    },
    'build:done': async () => {
      console.log('✅ Build completed successfully!')
    }
  }
})
