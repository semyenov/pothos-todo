/**
 * Performance Benchmarking and Optimization Tools
 * 
 * This module provides comprehensive performance testing and optimization capabilities:
 * - PerformanceBenchmark: Run detailed performance benchmarks with metrics collection
 * - OptimizationEngine: Automated optimization strategies and execution plans
 * - Built-in optimization strategies for common performance improvements
 * - Baseline tracking and performance regression detection
 * 
 * @example Basic Benchmarking
 * ```typescript
 * import { PerformanceBenchmark } from '@/infrastructure/performance';
 * 
 * const benchmark = PerformanceBenchmark.getInstance();
 * 
 * const result = await benchmark.runBenchmark({
 *   name: 'Cache Performance Test',
 *   iterations: 1000,
 *   target: { service: 'cache-manager', method: 'get', payload: { key: 'test' } },
 *   assertions: [
 *     { metric: 'averageLatency', operator: 'lt', value: 50 },
 *     { metric: 'throughput', operator: 'gt', value: 1000 }
 *   ]
 * });
 * 
 * benchmark.setBaseline('Cache Performance Test', result);
 * ```
 * 
 * @example Automated Optimization
 * ```typescript
 * import { OptimizationEngine } from '@/infrastructure/performance';
 * 
 * const optimizer = OptimizationEngine.getInstance();
 * 
 * // Create optimization plan
 * const plan = await optimizer.createOptimizationPlan({
 *   service: 'api-service',
 *   metric: 'throughput',
 *   improvementGoal: 25, // 25% improvement target
 *   riskTolerance: 'medium'
 * });
 * 
 * // Execute optimization
 * const results = await optimizer.executeOptimizationPlan(plan);
 * ```
 * 
 * @example Performance Analysis
 * ```typescript
 * import { analyzePerformance } from '@/infrastructure/performance';
 * 
 * const analysis = await analyzePerformance('user-service');
 * 
 * for (const bottleneck of analysis.bottlenecks) {
 *   console.log(`${bottleneck.severity}: ${bottleneck.description}`);
 * }
 * ```
 */

// Core Performance Tools
export {
  PerformanceBenchmark,
  type BenchmarkResult,
  type BenchmarkConfig,
} from './PerformanceBenchmark.js';

export {
  OptimizationEngine,
  type OptimizationStrategy,
  type OptimizationResult,
  type OptimizationPlan,
} from './OptimizationEngine.js';

/**
 * Quick performance analysis for a service
 */
export async function analyzePerformance(serviceName: string): Promise<{
  currentMetrics: BenchmarkResult;
  bottlenecks: Array<{
    area: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    recommendedStrategies: string[];
  }>;
  opportunities: Array<{
    type: string;
    impact: number;
    effort: string;
    description: string;
  }>;
  recommendations: {
    quickWins: string[];
    longTerm: string[];
    critical: string[];
  };
}> {
  const benchmark = PerformanceBenchmark.getInstance();
  const optimizer = OptimizationEngine.getInstance();

  // Get current performance metrics
  const currentMetrics = await benchmark.runBenchmark({
    name: `${serviceName}-analysis`,
    iterations: 50,
    warmupIterations: 10,
    target: { service: serviceName, method: 'getHealth' },
  });

  // Analyze bottlenecks
  const analysis = await optimizer.analyzePerformanceBottlenecks(serviceName);

  // Generate recommendations
  const recommendations = {
    quickWins: analysis.opportunities
      .filter(o => o.effort === 'low' && o.impact > 10)
      .map(o => o.description),
    longTerm: analysis.opportunities
      .filter(o => o.effort === 'high' && o.impact > 20)
      .map(o => o.description),
    critical: analysis.bottlenecks
      .filter(b => b.severity === 'critical')
      .map(b => `CRITICAL: ${b.description}`),
  };

  return {
    currentMetrics,
    bottlenecks: analysis.bottlenecks,
    opportunities: analysis.opportunities,
    recommendations,
  };
}

/**
 * Run a comprehensive performance test suite
 */
export async function runPerformanceTestSuite(services: string[]): Promise<{
  results: BenchmarkResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    averageThroughput: number;
    averageLatency: number;
    worstPerformer: string;
    bestPerformer: string;
  };
}> {
  const benchmark = PerformanceBenchmark.getInstance();
  const configs: BenchmarkConfig[] = [];

  // Create benchmark configs for each service
  for (const service of services) {
    configs.push({
      name: `${service} Performance Test`,
      iterations: 100,
      warmupIterations: 10,
      concurrency: 5,
      target: { service, method: 'getHealth' },
      assertions: [
        { metric: 'averageLatency', operator: 'lt', value: 1000 },
        { metric: 'errorRate', operator: 'lt', value: 5 },
      ],
    });
  }

  // Run the test suite
  const results = await benchmark.runBenchmarkSuite(configs);

  // Calculate summary statistics
  const passed = results.filter(r => r.metrics.errorRate < 5).length;
  const failed = results.length - passed;
  
  const totalThroughput = results.reduce((sum, r) => sum + r.metrics.throughput, 0);
  const totalLatency = results.reduce((sum, r) => sum + r.metrics.averageLatency, 0);
  
  const averageThroughput = results.length > 0 ? totalThroughput / results.length : 0;
  const averageLatency = results.length > 0 ? totalLatency / results.length : 0;

  // Find best and worst performers
  const sortedByThroughput = [...results].sort((a, b) => b.metrics.throughput - a.metrics.throughput);
  const bestPerformer = sortedByThroughput[0]?.name || 'None';
  const worstPerformer = sortedByThroughput[sortedByThroughput.length - 1]?.name || 'None';

  return {
    results,
    summary: {
      totalTests: results.length,
      passed,
      failed,
      averageThroughput,
      averageLatency,
      bestPerformer,
      worstPerformer,
    },
  };
}

/**
 * Auto-optimize a service with safe defaults
 */
export async function autoOptimizeService(serviceName: string, options?: {
  improvementGoal?: number;
  riskTolerance?: 'low' | 'medium' | 'high';
  maxStrategies?: number;
}): Promise<{
  originalMetrics: BenchmarkResult;
  finalMetrics: BenchmarkResult;
  improvement: number;
  appliedStrategies: string[];
  executionTime: number;
}> {
  const {
    improvementGoal = 20,
    riskTolerance = 'medium',
    maxStrategies = 3,
  } = options || {};

  const benchmark = PerformanceBenchmark.getInstance();
  const optimizer = OptimizationEngine.getInstance();

  const startTime = Date.now();

  // Get baseline performance
  const originalMetrics = await benchmark.runBenchmark({
    name: `${serviceName}-baseline`,
    iterations: 50,
    target: { service: serviceName, method: 'getHealth' },
  });

  // Create and execute optimization plan
  const plan = await optimizer.createOptimizationPlan({
    service: serviceName,
    metric: 'throughput',
    improvementGoal,
    riskTolerance,
    maxStrategies,
  });

  const results = await optimizer.executeOptimizationPlan(plan);

  // Get final performance
  const finalMetrics = await benchmark.runBenchmark({
    name: `${serviceName}-optimized`,
    iterations: 50,
    target: { service: serviceName, method: 'getHealth' },
  });

  const improvement = ((finalMetrics.metrics.throughput - originalMetrics.metrics.throughput) / originalMetrics.metrics.throughput) * 100;
  const appliedStrategies = results.filter(r => r.success).map(r => r.strategy.name);
  const executionTime = Date.now() - startTime;

  return {
    originalMetrics,
    finalMetrics,
    improvement,
    appliedStrategies,
    executionTime,
  };
}

/**
 * Generate a comprehensive performance report
 */
export async function generatePerformanceReport(services?: string[]): Promise<string> {
  const benchmark = PerformanceBenchmark.getInstance();
  
  if (services && services.length > 0) {
    const suiteResults = await runPerformanceTestSuite(services);
    
    let report = `# Performance Test Suite Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += `## Summary\n\n`;
    report += `- **Total Tests:** ${suiteResults.summary.totalTests}\n`;
    report += `- **Passed:** ${suiteResults.summary.passed}\n`;
    report += `- **Failed:** ${suiteResults.summary.failed}\n`;
    report += `- **Average Throughput:** ${suiteResults.summary.averageThroughput.toFixed(1)} ops/sec\n`;
    report += `- **Average Latency:** ${suiteResults.summary.averageLatency.toFixed(2)}ms\n`;
    report += `- **Best Performer:** ${suiteResults.summary.bestPerformer}\n`;
    report += `- **Worst Performer:** ${suiteResults.summary.worstPerformer}\n\n`;
    
    report += `## Detailed Results\n\n`;
    for (const result of suiteResults.results) {
      report += `### ${result.name}\n\n`;
      report += `| Metric | Value |\n`;
      report += `|--------|-------|\n`;
      report += `| Throughput | ${result.metrics.throughput.toFixed(1)} ops/sec |\n`;
      report += `| Avg Latency | ${result.metrics.averageLatency.toFixed(2)}ms |\n`;
      report += `| P95 Latency | ${result.metrics.p95Latency.toFixed(2)}ms |\n`;
      report += `| Error Rate | ${result.metrics.errorRate.toFixed(2)}% |\n`;
      report += `| Status | ${result.metrics.errorRate < 5 ? '✅ PASS' : '❌ FAIL'} |\n\n`;
    }
    
    return report;
  } else {
    return benchmark.generateReport();
  }
}