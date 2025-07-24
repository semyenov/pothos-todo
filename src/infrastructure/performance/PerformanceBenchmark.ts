import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { ServiceMetrics } from '../core/ServiceMetrics.js';
import { EnhancedServiceRegistry } from '../core/ServiceRegistry.enhanced.js';
import { logger } from '@/lib/unjs-utils.js';

export interface BenchmarkResult {
  id: string;
  name: string;
  timestamp: Date;
  duration: number;
  iterations: number;
  metrics: {
    throughput: number; // ops/sec
    averageLatency: number; // ms
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    errorRate: number; // %
    memoryUsage: number; // MB
    cpuUsage: number; // %
  };
  baseline?: BenchmarkResult;
  improvement?: number; // % improvement over baseline
}

export interface BenchmarkConfig {
  name: string;
  iterations: number;
  warmupIterations?: number;
  concurrency?: number;
  duration?: number; // ms
  target: {
    service: string;
    method: string;
    payload?: any;
  };
  assertions?: Array<{
    metric: keyof BenchmarkResult['metrics'];
    operator: 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
    value: number;
  }>;
}

interface BenchmarkEventMap {
  'benchmark:started': { config: BenchmarkConfig; timestamp: Date };
  'benchmark:completed': { result: BenchmarkResult; timestamp: Date };
  'benchmark:failed': { config: BenchmarkConfig; error: Error; timestamp: Date };
  'assertion:failed': { assertion: any; actual: number; expected: number };
  'baseline:updated': { benchmarkName: string; oldBaseline?: BenchmarkResult; newBaseline: BenchmarkResult };
}

export class PerformanceBenchmark extends TypedEventEmitter<BenchmarkEventMap> {
  private static instance: PerformanceBenchmark;
  private metrics: ServiceMetrics;
  private registry: EnhancedServiceRegistry;
  private baselines = new Map<string, BenchmarkResult>();
  private results = new Map<string, BenchmarkResult[]>();

  private constructor() {
    super();
    this.metrics = ServiceMetrics.getInstance();
    this.registry = EnhancedServiceRegistry.getInstance();
  }

  static getInstance(): PerformanceBenchmark {
    if (!PerformanceBenchmark.instance) {
      PerformanceBenchmark.instance = new PerformanceBenchmark();
    }
    return PerformanceBenchmark.instance;
  }

  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const benchmarkId = `bench_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info(`🏁 Starting benchmark: ${config.name}`, {
      iterations: config.iterations,
      concurrency: config.concurrency || 1,
      target: config.target,
    });

    this.emit('benchmark:started', { config, timestamp: new Date() });

    try {
      // Warmup phase
      if (config.warmupIterations && config.warmupIterations > 0) {
        await this.performWarmup(config);
      }

      // Main benchmark
      const result = await this.executeBenchmark(benchmarkId, config);

      // Compare with baseline if available
      const baseline = this.baselines.get(config.name);
      if (baseline) {
        result.baseline = baseline;
        result.improvement = this.calculateImprovement(result, baseline);
      }

      // Run assertions
      await this.runAssertions(config, result);

      // Store result
      if (!this.results.has(config.name)) {
        this.results.set(config.name, []);
      }
      this.results.get(config.name)!.push(result);

      this.emit('benchmark:completed', { result, timestamp: new Date() });

      logger.info(`✅ Benchmark completed: ${config.name}`, {
        throughput: `${result.metrics.throughput.toFixed(1)} ops/sec`,
        averageLatency: `${result.metrics.averageLatency.toFixed(2)}ms`,
        errorRate: `${result.metrics.errorRate.toFixed(2)}%`,
        improvement: result.improvement ? `${result.improvement.toFixed(1)}%` : 'N/A',
      });

      return result;

    } catch (error) {
      this.emit('benchmark:failed', { config, error: error as Error, timestamp: new Date() });
      logger.error(`❌ Benchmark failed: ${config.name}`, { error });
      throw error;
    }
  }

  async runBenchmarkSuite(configs: BenchmarkConfig[]): Promise<BenchmarkResult[]> {
    logger.info(`🏃 Running benchmark suite: ${configs.length} benchmarks`);
    
    const results: BenchmarkResult[] = [];
    
    for (const config of configs) {
      try {
        const result = await this.runBenchmark(config);
        results.push(result);
        
        // Brief pause between benchmarks
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Benchmark failed in suite: ${config.name}`, { error });
      }
    }

    logger.info(`✅ Benchmark suite completed: ${results.length}/${configs.length} successful`);
    return results;
  }

  setBaseline(benchmarkName: string, result?: BenchmarkResult): void {
    if (!result) {
      // Use latest result as baseline
      const results = this.results.get(benchmarkName);
      if (!results || results.length === 0) {
        throw new Error(`No results found for benchmark: ${benchmarkName}`);
      }
      result = results[results.length - 1];
    }

    const oldBaseline = this.baselines.get(benchmarkName);
    this.baselines.set(benchmarkName, result);

    this.emit('baseline:updated', {
      benchmarkName,
      oldBaseline,
      newBaseline: result,
    });

    logger.info(`📊 Baseline updated for ${benchmarkName}`, {
      throughput: `${result.metrics.throughput.toFixed(1)} ops/sec`,
      latency: `${result.metrics.averageLatency.toFixed(2)}ms`,
    });
  }

  getResults(benchmarkName?: string): BenchmarkResult[] {
    if (benchmarkName) {
      return this.results.get(benchmarkName) || [];
    }
    
    const allResults: BenchmarkResult[] = [];
    for (const results of this.results.values()) {
      allResults.push(...results);
    }
    return allResults;
  }

  getBaseline(benchmarkName: string): BenchmarkResult | undefined {
    return this.baselines.get(benchmarkName);
  }

  generateReport(benchmarkName?: string): string {
    const results = this.getResults(benchmarkName);
    
    if (results.length === 0) {
      return 'No benchmark results available.';
    }

    let report = `# Performance Benchmark Report\n\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    if (benchmarkName) {
      report += `## ${benchmarkName}\n\n`;
      report += this.generateBenchmarkSection(benchmarkName, results);
    } else {
      const benchmarkGroups = new Map<string, BenchmarkResult[]>();
      for (const result of results) {
        if (!benchmarkGroups.has(result.name)) {
          benchmarkGroups.set(result.name, []);
        }
        benchmarkGroups.get(result.name)!.push(result);
      }

      for (const [name, groupResults] of benchmarkGroups) {
        report += `## ${name}\n\n`;
        report += this.generateBenchmarkSection(name, groupResults);
        report += '\n';
      }
    }

    return report;
  }

  exportResults(format: 'json' | 'csv' = 'json'): string {
    const allResults = this.getResults();
    
    if (format === 'csv') {
      let csv = 'Name,Timestamp,Duration,Iterations,Throughput,AvgLatency,P95Latency,P99Latency,ErrorRate,MemoryUsage,CPUUsage,Improvement\n';
      
      for (const result of allResults) {
        csv += [
          result.name,
          result.timestamp.toISOString(),
          result.duration,
          result.iterations,
          result.metrics.throughput.toFixed(2),
          result.metrics.averageLatency.toFixed(2),
          result.metrics.p95Latency.toFixed(2),
          result.metrics.p99Latency.toFixed(2),
          result.metrics.errorRate.toFixed(2),
          result.metrics.memoryUsage.toFixed(2),
          result.metrics.cpuUsage.toFixed(2),
          result.improvement?.toFixed(2) || 'N/A',
        ].join(',') + '\n';
      }
      
      return csv;
    }

    return JSON.stringify(allResults, null, 2);
  }

  private async performWarmup(config: BenchmarkConfig): Promise<void> {
    logger.debug(`🔥 Warming up: ${config.warmupIterations} iterations`);
    
    const warmupConfig = {
      ...config,
      iterations: config.warmupIterations!,
      warmupIterations: 0,
    };

    // Run warmup without storing results
    await this.executeBenchmark('warmup', warmupConfig, false);
  }

  private async executeBenchmark(
    benchmarkId: string,
    config: BenchmarkConfig,
    record = true
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const concurrency = config.concurrency || 1;
    const latencies: number[] = [];
    let totalErrors = 0;
    let totalMemory = 0;
    let totalCpu = 0;
    let memoryMeasurements = 0;

    // Memory monitoring
    const memoryMonitor = setInterval(() => {
      const usage = process.memoryUsage();
      totalMemory += usage.heapUsed / 1024 / 1024; // MB
      totalCpu += process.cpuUsage().user / 1000; // Simplified CPU usage
      memoryMeasurements++;
    }, 100);

    try {
      // Execute iterations with specified concurrency
      const promises: Promise<void>[] = [];
      let completed = 0;

      for (let i = 0; i < concurrency; i++) {
        promises.push(this.executeWorker(config, latencies, (error) => {
          if (error) totalErrors++;
          completed++;
        }));
      }

      await Promise.all(promises);

      clearInterval(memoryMonitor);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Calculate metrics
      latencies.sort((a, b) => a - b);
      const throughput = (config.iterations / duration) * 1000; // ops/sec
      const averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const p50Latency = latencies[Math.floor(latencies.length * 0.5)] || 0;
      const p95Latency = latencies[Math.floor(latencies.length * 0.95)] || 0;
      const p99Latency = latencies[Math.floor(latencies.length * 0.99)] || 0;
      const errorRate = (totalErrors / config.iterations) * 100;
      const memoryUsage = memoryMeasurements > 0 ? totalMemory / memoryMeasurements : 0;
      const cpuUsage = memoryMeasurements > 0 ? totalCpu / memoryMeasurements : 0;

      const result: BenchmarkResult = {
        id: benchmarkId,
        name: config.name,
        timestamp: new Date(startTime),
        duration,
        iterations: config.iterations,
        metrics: {
          throughput,
          averageLatency,
          p50Latency,
          p95Latency,
          p99Latency,
          errorRate,
          memoryUsage,
          cpuUsage,
        },
      };

      if (record) {
        // Record metrics in the metrics system
        this.metrics.record(config.target.service, 'benchmark_throughput', throughput, 'gauge');
        this.metrics.record(config.target.service, 'benchmark_latency_avg', averageLatency, 'gauge');
        this.metrics.record(config.target.service, 'benchmark_error_rate', errorRate, 'gauge');
      }

      return result;

    } finally {
      clearInterval(memoryMonitor);
    }
  }

  private async executeWorker(
    config: BenchmarkConfig,
    latencies: number[],
    onComplete: (error?: Error) => void
  ): Promise<void> {
    const iterationsPerWorker = Math.ceil(config.iterations / (config.concurrency || 1));
    
    for (let i = 0; i < iterationsPerWorker; i++) {
      const startTime = performance.now();
      
      try {
        // Execute the actual operation
        await this.executeOperation(config.target);
        
        const endTime = performance.now();
        latencies.push(endTime - startTime);
        onComplete();
        
      } catch (error) {
        const endTime = performance.now();
        latencies.push(endTime - startTime);
        onComplete(error as Error);
      }
    }
  }

  private async executeOperation(target: BenchmarkConfig['target']): Promise<any> {
    // Get the service from the registry
    const service = this.registry.get(target.service);
    if (!service) {
      throw new Error(`Service not found: ${target.service}`);
    }

    // Call the method on the service
    if (typeof service[target.method] === 'function') {
      return await service[target.method](target.payload);
    } else {
      throw new Error(`Method not found: ${target.method} on service ${target.service}`);
    }
  }

  private calculateImprovement(current: BenchmarkResult, baseline: BenchmarkResult): number {
    // Calculate improvement based on throughput (higher is better)
    const improvement = ((current.metrics.throughput - baseline.metrics.throughput) / baseline.metrics.throughput) * 100;
    return improvement;
  }

  private async runAssertions(config: BenchmarkConfig, result: BenchmarkResult): Promise<void> {
    if (!config.assertions) return;

    for (const assertion of config.assertions) {
      const actual = result.metrics[assertion.metric];
      const expected = assertion.value;

      let passed = false;
      switch (assertion.operator) {
        case 'lt': passed = actual < expected; break;
        case 'gt': passed = actual > expected; break;
        case 'lte': passed = actual <= expected; break;
        case 'gte': passed = actual >= expected; break;
        case 'eq': passed = Math.abs(actual - expected) < 0.01; break;
      }

      if (!passed) {
        this.emit('assertion:failed', { assertion, actual, expected });
        logger.warn(`Assertion failed: ${assertion.metric} ${assertion.operator} ${expected}`, {
          actual,
          expected,
        });
      }
    }
  }

  private generateBenchmarkSection(name: string, results: BenchmarkResult[]): string {
    const latest = results[results.length - 1];
    const baseline = this.baselines.get(name);
    
    let section = `**Latest Run:** ${latest.timestamp.toISOString()}\n\n`;
    
    section += `| Metric | Value |\n`;
    section += `|--------|-------|\n`;
    section += `| Throughput | ${latest.metrics.throughput.toFixed(1)} ops/sec |\n`;
    section += `| Avg Latency | ${latest.metrics.averageLatency.toFixed(2)}ms |\n`;
    section += `| P95 Latency | ${latest.metrics.p95Latency.toFixed(2)}ms |\n`;
    section += `| P99 Latency | ${latest.metrics.p99Latency.toFixed(2)}ms |\n`;
    section += `| Error Rate | ${latest.metrics.errorRate.toFixed(2)}% |\n`;
    section += `| Memory Usage | ${latest.metrics.memoryUsage.toFixed(1)}MB |\n`;
    section += `| CPU Usage | ${latest.metrics.cpuUsage.toFixed(1)}% |\n`;
    
    if (baseline && latest.improvement !== undefined) {
      section += `| Improvement | ${latest.improvement > 0 ? '+' : ''}${latest.improvement.toFixed(1)}% |\n`;
    }
    
    section += '\n';
    
    if (results.length > 1) {
      section += `**Historical Trend (${results.length} runs):**\n\n`;
      
      const throughputTrend = results.slice(-5).map(r => r.metrics.throughput.toFixed(1)).join(' → ');
      const latencyTrend = results.slice(-5).map(r => r.metrics.averageLatency.toFixed(1)).join(' → ');
      
      section += `- Throughput: ${throughputTrend} ops/sec\n`;
      section += `- Latency: ${latencyTrend}ms\n\n`;
    }
    
    return section;
  }
}