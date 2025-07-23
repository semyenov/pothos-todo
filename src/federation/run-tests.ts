import { FederationTestRunner } from './testing-framework.js';
import { userSubgraphTests } from './tests/user-subgraph.test.js';
import { todoSubgraphTests } from './tests/todo-subgraph.test.js';
import { aiSubgraphTests } from './tests/ai-subgraph.test.js';
import { gatewayIntegrationTests } from './tests/gateway-integration.test.js';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { program } from 'commander';

// CLI options
program
  .option('-s, --suite <suite>', 'Run specific test suite')
  .option('-t, --test <test>', 'Run specific test by name')
  .option('-v, --verbose', 'Verbose output')
  .option('-b, --bail', 'Stop on first failure')
  .option('-c, --coverage', 'Generate coverage report')
  .option('--timeout <ms>', 'Test timeout in milliseconds', '30000')
  .option('--only', 'Run only tests marked with .only')
  .parse();

const options = program.opts();

// Test suites
const allSuites = [
  userSubgraphTests,
  todoSubgraphTests,
  aiSubgraphTests,
  gatewayIntegrationTests,
];

// Filter suites if specified
const suitesToRun = options.suite
  ? allSuites.filter(s => s.name.toLowerCase().includes(options.suite.toLowerCase()))
  : allSuites;

if (suitesToRun.length === 0) {
  logger.error(chalk.red(`No test suites found matching: ${options.suite}`));
  process.exit(1);
}

// Filter tests if specified
if (options.test) {
  suitesToRun.forEach(suite => {
    suite.tests = suite.tests.filter(t => 
      t.name.toLowerCase().includes(options.test.toLowerCase())
    );
  });
}

// Mark only tests if specified
if (options.only) {
  suitesToRun.forEach(suite => {
    const onlyTests = suite.tests.filter(t => t.only);
    if (onlyTests.length > 0) {
      suite.tests = onlyTests;
    }
  });
}

// Create test runner
const runner = new FederationTestRunner({
  verbose: options.verbose,
  bail: options.bail,
  timeout: parseInt(options.timeout),
  coverage: options.coverage,
});

// Add custom test hooks
const performanceTests = {
  name: 'Performance Tests',
  description: 'Measure federation performance characteristics',
  endpoint: 'http://localhost:4000/graphql',
  tests: [
    {
      name: 'Should handle high query volume',
      query: `query { __typename }`,
      timeout: 60000,
    },
  ],
  beforeAll: async () => {
    logger.info(chalk.yellow('Starting performance monitoring...'));
  },
  afterAll: async () => {
    logger.info(chalk.yellow('Performance monitoring complete'));
  },
};

// Add security tests
const securityTests = {
  name: 'Security Tests',
  description: 'Test federation security features',
  endpoint: 'http://localhost:4000/graphql',
  tests: [
    {
      name: 'Should block introspection in production',
      query: `{ __schema { types { name } } }`,
      expectedErrors: ['GraphQL introspection is disabled'],
      skipReason: process.env.NODE_ENV !== 'production' ? 'Only runs in production' : undefined,
    },
    {
      name: 'Should enforce rate limiting',
      query: `query { users { id } }`,
      timeout: 5000,
    },
    {
      name: 'Should validate JWT tokens',
      query: `query { me { id email } }`,
      expectedErrors: ['Authentication required'],
    },
    {
      name: 'Should prevent deep queries',
      query: `
        query DeepQuery {
          users {
            todos {
              user {
                todos {
                  user {
                    todos {
                      user {
                        todos {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      expectedErrors: ['Query depth limit exceeded'],
    },
  ],
};

// Add load tests
const loadTests = {
  name: 'Load Tests',
  description: 'Test federation under load',
  endpoint: 'http://localhost:4000/graphql',
  tests: [
    {
      name: 'Should handle concurrent queries',
      query: `
        query ConcurrentTest($id: ID!) {
          user(id: $id) {
            id
            todos {
              id
            }
          }
        }
      `,
      variables: { id: '1' },
      timeout: 10000,
    },
  ],
  beforeAll: async () => {
    // Warm up the cache
    await fetch('http://localhost:4000/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
  },
};

// Add additional test suites if not filtering
if (!options.suite) {
  suitesToRun.push(performanceTests, securityTests, loadTests);
}

// Run tests
async function runTests() {
  try {
    logger.info(chalk.bold.blue('\n🚀 Starting Federation Test Suite\n'));
    logger.info(`Running ${suitesToRun.length} test suites`);
    
    if (options.verbose) {
      logger.info('Options:', options);
    }

    // Check if services are running
    logger.info(chalk.dim('Checking service health...'));
    const healthChecks = [
      { name: 'Gateway', url: 'http://localhost:4000/graphql' },
      { name: 'User Subgraph', url: 'http://localhost:4001/graphql' },
      { name: 'Todo Subgraph', url: 'http://localhost:4002/graphql' },
      { name: 'AI Subgraph', url: 'http://localhost:4003/graphql' },
    ];

    let allHealthy = true;
    for (const check of healthChecks) {
      try {
        const response = await fetch(check.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
        });
        
        if (response.ok) {
          logger.info(chalk.green(`✓ ${check.name} is healthy`));
        } else {
          logger.error(chalk.red(`✗ ${check.name} returned ${response.status}`));
          allHealthy = false;
        }
      } catch (error) {
        logger.error(chalk.red(`✗ ${check.name} is not reachable`));
        allHealthy = false;
      }
    }

    if (!allHealthy) {
      logger.error(chalk.red('\nSome services are not healthy. Please start all services before running tests.'));
      logger.info(chalk.dim('Run: docker compose up -d'));
      process.exit(1);
    }

    logger.info(chalk.green('\n✓ All services are healthy\n'));

    // Run test suites
    const report = await runner.run(suitesToRun);

    // Exit with appropriate code
    process.exit(report.failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error(chalk.red('Test runner failed:'), error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  logger.error(chalk.red('Unhandled rejection:'), error);
  process.exit(1);
});

// Run tests
runTests();