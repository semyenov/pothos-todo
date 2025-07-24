/**
 * Performance Benchmarking and Optimization Demo
 * Demonstrates comprehensive performance testing and automated optimization
 */

import { logger } from '@/lib/unjs-utils.js';
import { 
  PerformanceBenchmark,
  OptimizationEngine,
  analyzePerformance,
  runPerformanceTestSuite,
  autoOptimizeService,
  generatePerformanceReport
} from '@/infrastructure/performance/index.js';

async function runPerformanceDemo(): Promise<void> {
  logger.info('🏁 Starting Performance Benchmarking and Optimization Demo...');

  const benchmark = PerformanceBenchmark.getInstance();
  const optimizer = OptimizationEngine.getInstance();

  try {
    // === PHASE 1: BASIC BENCHMARKING ===
    logger.info('\n📊 PHASE 1: Basic Performance Benchmarking...');

    const cacheTestResult = await benchmark.runBenchmark({
      name: 'Cache Performance Test',
      iterations: 200,
      warmupIterations: 20,
      concurrency: 5,
      target: { service: 'cache-manager', method: 'get', payload: { key: 'test-key' } },
      assertions: [
        { metric: 'averageLatency', operator: 'lt', value: 100 },
        { metric: 'throughput', operator: 'gt', value: 500 },
        { metric: 'errorRate', operator: 'lt', value: 2 }
      ]
    });

    logger.info('Cache benchmark results:', {
      throughput: `${cacheTestResult.metrics.throughput.toFixed(1)} ops/sec`,
      latency: `${cacheTestResult.metrics.averageLatency.toFixed(2)}ms`,
      errorRate: `${cacheTestResult.metrics.errorRate.toFixed(2)}%`
    });

    // Set as baseline
    benchmark.setBaseline('Cache Performance Test', cacheTestResult);

    // === PHASE 2: PERFORMANCE ANALYSIS ===
    logger.info('\n🔍 PHASE 2: Performance Analysis...');

    const analysis = await analyzePerformance('cache-manager');
    
    logger.info('Performance analysis results:', {
      bottlenecks: analysis.bottlenecks.length,
      opportunities: analysis.opportunities.length,
      quickWins: analysis.recommendations.quickWins.length,
      critical: analysis.recommendations.critical.length
    });

    if (analysis.recommendations.critical.length > 0) {
      logger.warn('Critical issues found:', analysis.recommendations.critical);
    }

    if (analysis.recommendations.quickWins.length > 0) {
      logger.info('Quick win opportunities:', analysis.recommendations.quickWins);
    }

    // === PHASE 3: AUTOMATED OPTIMIZATION ===
    logger.info('\n🔧 PHASE 3: Automated Optimization...');

    const optimizationResult = await autoOptimizeService('cache-manager', {
      improvementGoal: 25, // 25% improvement target
      riskTolerance: 'medium',
      maxStrategies: 3
    });

    logger.info('Optimization results:', {
      improvement: `${optimizationResult.improvement.toFixed(1)}%`,
      strategies: optimizationResult.appliedStrategies.length,
      executionTime: `${optimizationResult.executionTime}ms`,
      originalThroughput: `${optimizationResult.originalMetrics.metrics.throughput.toFixed(1)} ops/sec`,
      finalThroughput: `${optimizationResult.finalMetrics.metrics.throughput.toFixed(1)} ops/sec`
    });

    // === PHASE 4: CUSTOM OPTIMIZATION PLAN ===
    logger.info('\n🎯 PHASE 4: Custom Optimization Plan...');

    const customPlan = await optimizer.createOptimizationPlan({
      service: 'cache-manager',
      metric: 'latency',
      improvementGoal: 30,
      riskTolerance: 'high',
      maxStrategies: 5,
      allowedTypes: ['configuration', 'algorithm']
    });

    logger.info('Custom optimization plan:', {
      strategies: customPlan.strategies.length,
      estimatedImpact: `${customPlan.estimated.totalImpact.toFixed(1)}%`,
      duration: `${customPlan.estimated.duration} minutes`,
      risk: customPlan.estimated.risk
    });

    const customResults = await optimizer.executeOptimizationPlan(customPlan);
    const successfulOptimizations = customResults.filter(r => r.success);

    logger.info('Custom optimization execution:', {
      applied: successfulOptimizations.length,
      total: customResults.length,
      improvements: successfulOptimizations.map(r => 
        `${r.strategy.name}: ${r.actualImpact.toFixed(1)}%`
      )
    });

    // === PHASE 5: BENCHMARK SUITE ===
    logger.info('\n🏃 PHASE 5: Performance Test Suite...');

    const testServices = ['cache-manager', 'prisma-service', 'message-broker'];
    const suiteResults = await runPerformanceTestSuite(testServices);

    logger.info('Test suite summary:', {
      total: suiteResults.summary.totalTests,
      passed: suiteResults.summary.passed,
      failed: suiteResults.summary.failed,
      avgThroughput: `${suiteResults.summary.averageThroughput.toFixed(1)} ops/sec`,
      avgLatency: `${suiteResults.summary.averageLatency.toFixed(2)}ms`,
      bestPerformer: suiteResults.summary.bestPerformer,
      worstPerformer: suiteResults.summary.worstPerformer
    });

    // === PHASE 6: BASELINE COMPARISON ===
    logger.info('\n📈 PHASE 6: Baseline Comparison...');

    // Run another cache test to compare with baseline
    const newCacheResult = await benchmark.runBenchmark({
      name: 'Cache Performance Test',
      iterations: 200,
      target: { service: 'cache-manager', method: 'get', payload: { key: 'test-key' } }
    });

    if (newCacheResult.improvement !== undefined) {
      logger.info('Performance improvement over baseline:', {
        improvement: `${newCacheResult.improvement.toFixed(1)}%`,
        baselineThroughput: `${newCacheResult.baseline?.metrics.throughput.toFixed(1)} ops/sec`,
        currentThroughput: `${newCacheResult.metrics.throughput.toFixed(1)} ops/sec`
      });
    }

    // === PHASE 7: COMPREHENSIVE REPORTING ===
    logger.info('\n📋 PHASE 7: Report Generation...');

    const fullReport = await generatePerformanceReport(testServices);
    logger.info('Generated comprehensive performance report', {
      length: fullReport.length,
      sections: fullReport.split('\n##').length - 1
    });

    // Show benchmark history
    const benchmarkHistory = benchmark.getResults('Cache Performance Test');
    logger.info('Benchmark history:', {
      totalRuns: benchmarkHistory.length,
      latestRun: benchmarkHistory[benchmarkHistory.length - 1]?.timestamp,
      trend: benchmarkHistory.length >= 2 ? 
        `${((benchmarkHistory[benchmarkHistory.length - 1].metrics.throughput - 
            benchmarkHistory[0].metrics.throughput) / 
            benchmarkHistory[0].metrics.throughput * 100).toFixed(1)}% over time` : 'N/A'
    });

    // Show optimization history
    const optimizationHistory = optimizer.getOptimizationHistory();
    logger.info('Optimization history:', {
      totalOptimizations: optimizationHistory.length,
      successfulOptimizations: optimizationHistory.filter(o => o.success).length,
      averageImprovement: optimizationHistory.length > 0 ?
        `${(optimizationHistory.reduce((sum, o) => sum + o.actualImpact, 0) / optimizationHistory.length).toFixed(1)}%` : 'N/A'
    });

    // === PHASE 8: EXPORT AND CLEANUP ===
    logger.info('\n📤 PHASE 8: Export and Cleanup...');

    // Export results in different formats
    const jsonExport = benchmark.exportResults('json');
    const csvExport = benchmark.exportResults('csv');

    logger.info('Data export completed:', {
      jsonSize: jsonExport.length,
      csvLines: csvExport.split('\n').length - 1
    });

    logger.info('✅ Performance Demo completed successfully!');

    // Print final summary
    printFinalSummary(benchmark, optimizer);

  } catch (error) {
    logger.error('❌ Performance Demo failed', { error });
    throw error;
  }
}

function printFinalSummary(
  benchmark: PerformanceBenchmark, 
  optimizer: OptimizationEngine
): void {
  logger.info('\n🎯 PERFORMANCE DEMO SUMMARY:');
  logger.info('  ✅ Basic performance benchmarking with metrics collection');
  logger.info('  ✅ Automated performance analysis and bottleneck detection');
  logger.info('  ✅ Intelligent optimization strategy selection and execution');
  logger.info('  ✅ Custom optimization plans with risk management');
  logger.info('  ✅ Comprehensive test suites with pass/fail assertions');
  logger.info('  ✅ Baseline tracking and performance regression detection');
  logger.info('  ✅ Multi-format reporting and data export capabilities');
  logger.info('  ✅ Historical trend analysis and optimization tracking');
  logger.info('\n🚀 The Performance Optimization system is fully operational!');

  const allResults = benchmark.getResults();
  const allOptimizations = optimizer.getOptimizationHistory();

  logger.info('\n📊 Final Statistics:', {
    totalBenchmarks: allResults.length,
    totalOptimizations: allOptimizations.length,
    successfulOptimizations: allOptimizations.filter(o => o.success).length,
    averageImprovement: allOptimizations.length > 0 ?
      `${(allOptimizations.reduce((sum, o) => sum + o.actualImpact, 0) / allOptimizations.length).toFixed(1)}%` : 'N/A'
  });
}

if (import.meta.main) {
  runPerformanceDemo()
    .then(() => logger.info('🎉 Demo completed'))
    .catch(error => {
      logger.error('💥 Demo failed', { error });
      process.exit(1);
    });
}

export default runPerformanceDemo;