import autocannon from 'autocannon';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { writeFile } from 'fs/promises';
import { join } from 'path';

interface BenchmarkScenario {
  name: string;
  query: string;
  variables?: Record<string, any>;
  connections?: number;
  duration?: number;
  pipelining?: number;
}

interface BenchmarkResult {
  scenario: string;
  requests: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    total: number;
    sent: number;
  };
  latency: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  throughput: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    total: number;
  };
  errors: number;
  timeouts: number;
}

const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    name: 'Simple Query',
    query: `query { __typename }`,
    connections: 10,
    duration: 10,
  },
  {
    name: 'User List Query',
    query: `query { users { id email name createdAt } }`,
    connections: 10,
    duration: 10,
  },
  {
    name: 'Complex Federation Query',
    query: `query {
      users {
        id
        email
        todos {
          id
          title
          status
          priority
        }
        todoLists {
          id
          title
          todos {
            id
            title
          }
        }
      }
    }`,
    connections: 10,
    duration: 10,
  },
  {
    name: 'AI Suggestion Query',
    query: `query {
      suggestTodos(limit: 5) {
        title
        description
        priority
        estimatedTime
      }
    }`,
    connections: 10,
    duration: 10,
  },
  {
    name: 'Parallel Queries',
    query: `query {
      users { id email }
      todos { id title }
      todoLists { id title }
      suggestTodos(limit: 3) { title }
    }`,
    connections: 10,
    duration: 10,
  },
  {
    name: 'High Load Test',
    query: `query { users { id email name } }`,
    connections: 100,
    duration: 30,
    pipelining: 10,
  },
  {
    name: 'Mutation Performance',
    query: `mutation {
      _userSubgraphHealthCheck
    }`,
    connections: 10,
    duration: 10,
  },
];

async function runBenchmark(
  url: string,
  scenario: BenchmarkScenario
): Promise<BenchmarkResult> {
  logger.info(chalk.blue(`Running benchmark: ${scenario.name}`));

  const result = await autocannon({
    url,
    connections: scenario.connections || 10,
    duration: scenario.duration || 10,
    pipelining: scenario.pipelining || 1,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: scenario.query,
      variables: scenario.variables || {},
    }),
  });

  return {
    scenario: scenario.name,
    requests: {
      average: result.requests.average,
      mean: result.requests.mean,
      stddev: result.requests.stddev,
      min: result.requests.min,
      max: result.requests.max,
      total: result.requests.total,
      sent: result.requests.sent,
    },
    latency: {
      average: result.latency.average,
      mean: result.latency.mean,
      stddev: result.latency.stddev,
      min: result.latency.min,
      max: result.latency.max,
      p50: result.latency.p50,
      p90: result.latency.p90,
      p95: result.latency.p95,
      p99: result.latency.p99,
    },
    throughput: {
      average: result.throughput.average,
      mean: result.throughput.mean,
      stddev: result.throughput.stddev,
      min: result.throughput.min,
      max: result.throughput.max,
      total: result.throughput.total,
    },
    errors: result.errors,
    timeouts: result.timeouts,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

function printResults(results: BenchmarkResult[]): void {
  logger.info(chalk.bold('\n📊 Benchmark Results\n'));

  for (const result of results) {
    logger.info(chalk.yellow(`\n${result.scenario}`));
    logger.info(chalk.dim('─'.repeat(50)));

    // Requests
    logger.info(chalk.cyan('Requests:'));
    logger.info(`  Total: ${formatNumber(result.requests.total)}`);
    logger.info(`  Average: ${formatNumber(result.requests.average)} req/sec`);
    logger.info(`  Min: ${formatNumber(result.requests.min)} req/sec`);
    logger.info(`  Max: ${formatNumber(result.requests.max)} req/sec`);

    // Latency
    logger.info(chalk.cyan('\nLatency:'));
    logger.info(`  Average: ${result.latency.average.toFixed(2)} ms`);
    logger.info(`  P50: ${result.latency.p50.toFixed(2)} ms`);
    logger.info(`  P90: ${result.latency.p90.toFixed(2)} ms`);
    logger.info(`  P95: ${result.latency.p95.toFixed(2)} ms`);
    logger.info(`  P99: ${result.latency.p99.toFixed(2)} ms`);

    // Throughput
    logger.info(chalk.cyan('\nThroughput:'));
    logger.info(`  Average: ${formatBytes(result.throughput.average)}/sec`);
    logger.info(`  Total: ${formatBytes(result.throughput.total)}`);

    // Errors
    if (result.errors > 0 || result.timeouts > 0) {
      logger.info(chalk.red('\nErrors:'));
      logger.info(`  Errors: ${result.errors}`);
      logger.info(`  Timeouts: ${result.timeouts}`);
    }
  }
}

async function compareSubgraphs(): Promise<void> {
  const endpoints = [
    { name: 'Gateway', url: 'http://localhost:4000/graphql' },
    { name: 'User Subgraph', url: 'http://localhost:4001/graphql' },
    { name: 'Todo Subgraph', url: 'http://localhost:4002/graphql' },
    { name: 'AI Subgraph', url: 'http://localhost:4003/graphql' },
  ];

  const simpleQuery = {
    name: 'Simple Query Comparison',
    query: `query { __typename }`,
    connections: 10,
    duration: 10,
  };

  logger.info(chalk.bold('\n🔄 Comparing Subgraph Performance\n'));

  const comparisons: Record<string, BenchmarkResult> = {};

  for (const endpoint of endpoints) {
    try {
      const result = await runBenchmark(endpoint.url, simpleQuery);
      comparisons[endpoint.name] = result;
    } catch (error) {
      logger.error(`Failed to benchmark ${endpoint.name}:`, error);
    }
  }

  // Print comparison table
  logger.info(chalk.bold('\n📈 Performance Comparison\n'));
  logger.info(chalk.dim('Service'.padEnd(20) + 'Req/s'.padEnd(15) + 'Avg Latency'.padEnd(15) + 'P99 Latency'));
  logger.info(chalk.dim('─'.repeat(65)));

  for (const [name, result] of Object.entries(comparisons)) {
    logger.info(
      name.padEnd(20) +
      formatNumber(result.requests.average).padEnd(15) +
      `${result.latency.average.toFixed(2)} ms`.padEnd(15) +
      `${result.latency.p99.toFixed(2)} ms`
    );
  }
}

export async function runFederationBenchmark(): Promise<void> {
  const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:4000/graphql';

  logger.info(chalk.bold('🚀 GraphQL Federation Performance Benchmark\n'));
  logger.info(`Gateway URL: ${gatewayUrl}`);
  logger.info(`Scenarios: ${BENCHMARK_SCENARIOS.length}`);
  logger.info('');

  const results: BenchmarkResult[] = [];
  let failedScenarios = 0;

  // Run benchmarks
  for (const scenario of BENCHMARK_SCENARIOS) {
    try {
      const result = await runBenchmark(gatewayUrl, scenario);
      results.push(result);
      
      // Add delay between benchmarks
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error(chalk.red(`Failed to run "${scenario.name}":`, error));
      failedScenarios++;
    }
  }

  // Print results
  printResults(results);

  // Run comparison
  await compareSubgraphs();

  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    gatewayUrl,
    scenarios: BENCHMARK_SCENARIOS.length,
    failed: failedScenarios,
    results,
    summary: {
      averageLatency: results.reduce((sum, r) => sum + r.latency.average, 0) / results.length,
      averageRequestsPerSecond: results.reduce((sum, r) => sum + r.requests.average, 0) / results.length,
      totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
      totalTimeouts: results.reduce((sum, r) => sum + r.timeouts, 0),
    },
  };

  const reportPath = join(process.cwd(), 'federation-benchmark-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  logger.info(chalk.bold('\n📄 Report saved to:'), reportPath);
  logger.info(chalk.bold('\n✨ Benchmark Summary:'));
  logger.info(`Average Latency: ${report.summary.averageLatency.toFixed(2)} ms`);
  logger.info(`Average Requests/sec: ${formatNumber(report.summary.averageRequestsPerSecond)}`);
  logger.info(`Total Errors: ${report.summary.totalErrors}`);
  logger.info(`Total Timeouts: ${report.summary.totalTimeouts}`);

  if (failedScenarios > 0) {
    logger.warn(chalk.yellow(`\n⚠️  ${failedScenarios} scenarios failed`));
  }
}

// Run benchmark if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runFederationBenchmark().catch(error => {
    logger.error('Benchmark failed:', error);
    process.exit(1);
  });
}