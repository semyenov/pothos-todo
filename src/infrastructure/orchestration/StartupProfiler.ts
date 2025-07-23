import { z } from 'zod';
import { BaseService } from '../core/BaseService.js';
import { ServiceConfig, Metric } from '../core/decorators/ServiceDecorators.js';
import { StartupProfile, ServiceStartupResult, GroupStartupResult } from './StartupOrchestrator.js';
import { ServiceDefinition } from './ServiceDependencyGraph.js';
import { logger } from '@/lib/unjs-utils.js';

/**
 * Profiler configuration schema
 */
const ProfilerConfigSchema = z.object({
  captureCallStacks: z.boolean().default(false),
  captureMemoryUsage: z.boolean().default(true),
  captureCpuUsage: z.boolean().default(true),
  sampleInterval: z.number().default(100), // ms
  exportFormat: z.enum(['json', 'flamegraph', 'timeline', 'all']).default('all'),
  performanceThresholds: z.object({
    startupTime: z.number().default(5000), // 5s per service
    memoryDelta: z.number().default(50), // 50MB
    cpuThreshold: z.number().default(80), // 80%
  }),
});

export type ProfilerConfig = z.infer<typeof ProfilerConfigSchema>;

/**
 * Performance sample point
 */
export interface PerformanceSample {
  timestamp: number;
  service: string;
  event: 'start' | 'init' | 'ready' | 'failed';
  metrics: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    cpuUsage?: number;
    eventLoopDelay?: number;
  };
  callStack?: string[];
}

/**
 * Service performance analysis
 */
export interface ServicePerformanceAnalysis {
  serviceName: string;
  startupDuration: number;
  memoryDelta: number;
  peakCpuUsage: number;
  avgCpuUsage: number;
  blockingTime: number;
  parallelizationScore: number;
  bottleneckFactors: string[];
  optimizationSuggestions: string[];
}

/**
 * Startup bottleneck analysis
 */
export interface BottleneckAnalysis {
  service: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  type: 'duration' | 'memory' | 'cpu' | 'blocking' | 'dependency';
  details: {
    actualValue: number;
    expectedValue: number;
    percentageOver: number;
  };
  recommendations: string[];
}

/**
 * Optimization recommendation
 */
export interface OptimizationRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'parallelization' | 'caching' | 'lazy-loading' | 'resource' | 'dependency';
  description: string;
  expectedImprovement: string;
  implementation: string;
}

/**
 * Profiler event map
 */
interface ProfilerEventMap {
  'profiler:sample-collected': { sample: PerformanceSample };
  'profiler:analysis-complete': { analysis: ServicePerformanceAnalysis };
  'profiler:bottleneck-detected': { bottleneck: BottleneckAnalysis };
  'profiler:export-ready': { format: string; path: string };
}

/**
 * Startup performance profiler for detailed analysis and optimization
 * 
 * Features:
 * - Real-time performance sampling
 * - Memory and CPU usage tracking
 * - Bottleneck identification
 * - Parallelization analysis
 * - Optimization recommendations
 * - Multiple export formats
 * - Comparative analysis
 */
@ServiceConfig({
  schema: ProfilerConfigSchema,
  prefix: 'profiler',
  hot: true,
})
export class StartupProfiler extends BaseService<ProfilerConfig, ProfilerEventMap> {
  private samples: PerformanceSample[] = [];
  private serviceAnalysis: Map<string, ServicePerformanceAnalysis> = new Map();
  private bottlenecks: BottleneckAnalysis[] = [];
  private recommendations: OptimizationRecommendation[] = [];
  private startTime: number = 0;
  private sampleInterval?: NodeJS.Timeout;
  private currentService?: string;
  private serviceStartTimes: Map<string, number> = new Map();

  /**
   * Get singleton instance
   */
  static getInstance(): StartupProfiler {
    return super.getInstance();
  }

  protected getServiceName(): string {
    return 'startup-profiler';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Advanced performance profiler for service startup optimization';
  }

  /**
   * Start profiling session
   */
  startProfiling(): void {
    this.samples = [];
    this.serviceAnalysis.clear();
    this.bottlenecks = [];
    this.recommendations = [];
    this.startTime = Date.now();
    this.serviceStartTimes.clear();

    if (this.config.sampleInterval > 0) {
      this.startSampling();
    }

    logger.info('Startup profiling started', {
      captureCallStacks: this.config.captureCallStacks,
      captureMemoryUsage: this.config.captureMemoryUsage,
      captureCpuUsage: this.config.captureCpuUsage,
    });
  }

  /**
   * Stop profiling session
   */
  stopProfiling(): void {
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = undefined;
    }

    logger.info('Startup profiling stopped', {
      duration: Date.now() - this.startTime,
      samples: this.samples.length,
    });
  }

  /**
   * Record service event
   */
  recordServiceEvent(
    serviceName: string,
    event: 'start' | 'init' | 'ready' | 'failed'
  ): void {
    this.currentService = serviceName;

    if (event === 'start') {
      this.serviceStartTimes.set(serviceName, Date.now());
    }

    const sample = this.collectSample(serviceName, event);
    this.samples.push(sample);

    this.emit('profiler:sample-collected', { sample });
  }

  /**
   * Analyze startup profile
   */
  @Metric({ name: 'profiler.analysis', recordDuration: true })
  analyzeProfile(
    profile: StartupProfile,
    serviceDefinitions: Map<string, ServiceDefinition>
  ): {
    analysis: Map<string, ServicePerformanceAnalysis>;
    bottlenecks: BottleneckAnalysis[];
    recommendations: OptimizationRecommendation[];
  } {
    // Analyze each service
    for (const [serviceName, def] of serviceDefinitions) {
      const analysis = this.analyzeService(serviceName, profile, def);
      if (analysis) {
        this.serviceAnalysis.set(serviceName, analysis);
        this.emit('profiler:analysis-complete', { analysis });
      }
    }

    // Identify bottlenecks
    this.identifyBottlenecks(profile);

    // Generate recommendations
    this.generateRecommendations(profile);

    return {
      analysis: this.serviceAnalysis,
      bottlenecks: this.bottlenecks,
      recommendations: this.recommendations,
    };
  }

  /**
   * Export profiling results
   */
  async exportResults(
    format: 'json' | 'flamegraph' | 'timeline' | 'all' = 'all'
  ): Promise<Map<string, string>> {
    const exports = new Map<string, string>();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json' || format === 'all') {
      const jsonPath = `startup-profile-${timestamp}.json`;
      const jsonData = this.exportJSON();
      await Bun.write(jsonPath, JSON.stringify(jsonData, null, 2));
      exports.set('json', jsonPath);
    }

    if (format === 'flamegraph' || format === 'all') {
      const flamegraphPath = `startup-flamegraph-${timestamp}.txt`;
      const flamegraphData = this.exportFlamegraph();
      await Bun.write(flamegraphPath, flamegraphData);
      exports.set('flamegraph', flamegraphPath);
    }

    if (format === 'timeline' || format === 'all') {
      const timelinePath = `startup-timeline-${timestamp}.html`;
      const timelineHTML = this.exportTimeline();
      await Bun.write(timelinePath, timelineHTML);
      exports.set('timeline', timelinePath);
    }

    for (const [format, path] of exports) {
      this.emit('profiler:export-ready', { format, path });
    }

    return exports;
  }

  /**
   * Compare two startup profiles
   */
  compareProfiles(
    baseline: StartupProfile,
    current: StartupProfile
  ): {
    improvements: Array<{ service: string; metric: string; improvement: number }>;
    regressions: Array<{ service: string; metric: string; regression: number }>;
    summary: {
      totalTimeImprovement: number;
      efficiencyImprovement: number;
      bottlenecksResolved: number;
      newBottlenecks: number;
    };
  } {
    const improvements: Array<{ service: string; metric: string; improvement: number }> = [];
    const regressions: Array<{ service: string; metric: string; regression: number }> = [];

    // Compare service timings
    const baselineTimings = new Map<string, number>();
    const currentTimings = new Map<string, number>();

    for (const event of baseline.timeline) {
      if (event.event === 'complete' && event.duration) {
        baselineTimings.set(event.service, event.duration);
      }
    }

    for (const event of current.timeline) {
      if (event.event === 'complete' && event.duration) {
        currentTimings.set(event.service, event.duration);
      }
    }

    // Find improvements and regressions
    for (const [service, baselineTime] of baselineTimings) {
      const currentTime = currentTimings.get(service);
      if (currentTime) {
        const diff = baselineTime - currentTime;
        const percentage = (diff / baselineTime) * 100;

        if (diff > 0) {
          improvements.push({
            service,
            metric: 'startup_time',
            improvement: percentage,
          });
        } else if (diff < 0) {
          regressions.push({
            service,
            metric: 'startup_time',
            regression: Math.abs(percentage),
          });
        }
      }
    }

    // Compare bottlenecks
    const baselineBottlenecks = new Set(baseline.bottlenecks.map(b => b.service));
    const currentBottlenecks = new Set(current.bottlenecks.map(b => b.service));

    const resolved = Array.from(baselineBottlenecks).filter(s => !currentBottlenecks.has(s));
    const newBottlenecks = Array.from(currentBottlenecks).filter(s => !baselineBottlenecks.has(s));

    return {
      improvements,
      regressions,
      summary: {
        totalTimeImprovement: 
          ((baseline.parallelizationMetrics.actualTime - current.parallelizationMetrics.actualTime) / 
           baseline.parallelizationMetrics.actualTime) * 100,
        efficiencyImprovement:
          (current.parallelizationMetrics.efficiency - baseline.parallelizationMetrics.efficiency) * 100,
        bottlenecksResolved: resolved.length,
        newBottlenecks: newBottlenecks.length,
      },
    };
  }

  /**
   * Private helper methods
   */

  private startSampling(): void {
    this.sampleInterval = setInterval(() => {
      if (this.currentService) {
        const sample = this.collectSample(this.currentService, 'init');
        this.samples.push(sample);
      }
    }, this.config.sampleInterval);
  }

  private collectSample(serviceName: string, event: string): PerformanceSample {
    const timestamp = Date.now() - this.startTime;
    const memUsage = process.memoryUsage();
    
    const sample: PerformanceSample = {
      timestamp,
      service: serviceName,
      event: event as any,
      metrics: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
    };

    if (this.config.captureCpuUsage) {
      const cpuUsage = process.cpuUsage();
      sample.metrics.cpuUsage = (cpuUsage.user + cpuUsage.system) / 1000; // Convert to ms
    }

    if (this.config.captureCallStacks && event === 'start') {
      sample.callStack = this.captureCallStack();
    }

    return sample;
  }

  private captureCallStack(): string[] {
    const stack = new Error().stack || '';
    return stack.split('\n').slice(3, 10); // Skip error creation frames
  }

  private analyzeService(
    serviceName: string,
    profile: StartupProfile,
    definition: ServiceDefinition
  ): ServicePerformanceAnalysis | null {
    const serviceSamples = this.samples.filter(s => s.service === serviceName);
    if (serviceSamples.length === 0) return null;

    const startSample = serviceSamples.find(s => s.event === 'start');
    const readySample = serviceSamples.find(s => s.event === 'ready');
    
    if (!startSample || !readySample) return null;

    const startupDuration = readySample.timestamp - startSample.timestamp;
    const memoryDelta = readySample.metrics.heapUsed - startSample.metrics.heapUsed;
    
    // Calculate CPU metrics
    let peakCpuUsage = 0;
    let totalCpuUsage = 0;
    let cpuSamples = 0;

    for (const sample of serviceSamples) {
      if (sample.metrics.cpuUsage) {
        peakCpuUsage = Math.max(peakCpuUsage, sample.metrics.cpuUsage);
        totalCpuUsage += sample.metrics.cpuUsage;
        cpuSamples++;
      }
    }

    const avgCpuUsage = cpuSamples > 0 ? totalCpuUsage / cpuSamples : 0;

    // Calculate blocking time (simplified)
    const blockingTime = serviceSamples
      .filter(s => s.metrics.eventLoopDelay && s.metrics.eventLoopDelay > 10)
      .reduce((sum, s) => sum + (s.metrics.eventLoopDelay || 0), 0);

    // Calculate parallelization score
    const expectedTime = definition.startupTimeout || 10000;
    const parallelizationScore = Math.min(1, expectedTime / startupDuration);

    // Identify bottleneck factors
    const bottleneckFactors: string[] = [];
    if (startupDuration > expectedTime * 1.2) {
      bottleneckFactors.push('slow_startup');
    }
    if (memoryDelta > this.config.performanceThresholds.memoryDelta * 1024 * 1024) {
      bottleneckFactors.push('high_memory_usage');
    }
    if (peakCpuUsage > this.config.performanceThresholds.cpuThreshold) {
      bottleneckFactors.push('high_cpu_usage');
    }
    if (blockingTime > 100) {
      bottleneckFactors.push('event_loop_blocking');
    }

    // Generate optimization suggestions
    const optimizationSuggestions = this.generateServiceOptimizations(
      serviceName,
      bottleneckFactors,
      { startupDuration, memoryDelta, avgCpuUsage }
    );

    return {
      serviceName,
      startupDuration,
      memoryDelta,
      peakCpuUsage,
      avgCpuUsage,
      blockingTime,
      parallelizationScore,
      bottleneckFactors,
      optimizationSuggestions,
    };
  }

  private identifyBottlenecks(profile: StartupProfile): void {
    this.bottlenecks = [];

    for (const bottleneck of profile.bottlenecks) {
      const analysis = this.serviceAnalysis.get(bottleneck.service);
      if (!analysis) continue;

      const bottleneckAnalysis: BottleneckAnalysis = {
        service: bottleneck.service,
        impact: this.assessImpact(bottleneck.duration),
        type: 'duration',
        details: {
          actualValue: bottleneck.duration,
          expectedValue: 5000, // Default expectation
          percentageOver: ((bottleneck.duration - 5000) / 5000) * 100,
        },
        recommendations: this.getBottleneckRecommendations(bottleneck.service, 'duration'),
      };

      this.bottlenecks.push(bottleneckAnalysis);
      this.emit('profiler:bottleneck-detected', { bottleneck: bottleneckAnalysis });
    }
  }

  private generateRecommendations(profile: StartupProfile): void {
    this.recommendations = [];

    // Parallelization recommendations
    if (profile.parallelizationMetrics.efficiency < 0.7) {
      this.recommendations.push({
        priority: 'high',
        category: 'parallelization',
        description: 'Low parallelization efficiency detected',
        expectedImprovement: '20-30% faster startup',
        implementation: 'Review service dependencies and reduce unnecessary coupling',
      });
    }

    // Service-specific recommendations
    for (const [serviceName, analysis] of this.serviceAnalysis) {
      if (analysis.bottleneckFactors.includes('slow_startup')) {
        this.recommendations.push({
          priority: 'high',
          category: 'lazy-loading',
          description: `${serviceName} has slow initialization`,
          expectedImprovement: `${analysis.startupDuration / 2}ms faster`,
          implementation: `Defer non-critical initialization in ${serviceName}`,
        });
      }

      if (analysis.memoryDelta > 100 * 1024 * 1024) { // 100MB
        this.recommendations.push({
          priority: 'medium',
          category: 'resource',
          description: `${serviceName} uses excessive memory during startup`,
          expectedImprovement: 'Reduced memory pressure',
          implementation: 'Lazy-load large data structures or use streaming',
        });
      }
    }

    // Sort by priority
    this.recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private generateServiceOptimizations(
    serviceName: string,
    bottleneckFactors: string[],
    metrics: any
  ): string[] {
    const suggestions: string[] = [];

    if (bottleneckFactors.includes('slow_startup')) {
      suggestions.push('Consider lazy initialization for non-critical components');
      suggestions.push('Review and optimize database connection pooling');
      suggestions.push('Cache configuration and avoid repeated file I/O');
    }

    if (bottleneckFactors.includes('high_memory_usage')) {
      suggestions.push('Stream large data instead of loading into memory');
      suggestions.push('Implement object pooling for frequently created objects');
      suggestions.push('Review memory leaks with heap snapshots');
    }

    if (bottleneckFactors.includes('high_cpu_usage')) {
      suggestions.push('Offload CPU-intensive tasks to worker threads');
      suggestions.push('Implement caching for expensive computations');
      suggestions.push('Review algorithmic complexity');
    }

    return suggestions;
  }

  private assessImpact(value: number): 'critical' | 'high' | 'medium' | 'low' {
    if (value > 30000) return 'critical';
    if (value > 15000) return 'high';
    if (value > 5000) return 'medium';
    return 'low';
  }

  private getBottleneckRecommendations(service: string, type: string): string[] {
    const recommendations: string[] = [];

    switch (type) {
      case 'duration':
        recommendations.push('Profile service initialization to identify slow operations');
        recommendations.push('Consider splitting service into smaller components');
        recommendations.push('Implement progressive initialization');
        break;
      case 'memory':
        recommendations.push('Use memory profiling tools to identify allocations');
        recommendations.push('Implement lazy loading for large datasets');
        break;
      case 'cpu':
        recommendations.push('Use CPU profiling to identify hot paths');
        recommendations.push('Consider async/await for I/O operations');
        break;
    }

    return recommendations;
  }

  private exportJSON(): any {
    return {
      metadata: {
        startTime: this.startTime,
        duration: Date.now() - this.startTime,
        samplesCollected: this.samples.length,
        servicesAnalyzed: this.serviceAnalysis.size,
      },
      samples: this.samples,
      analysis: Array.from(this.serviceAnalysis.values()),
      bottlenecks: this.bottlenecks,
      recommendations: this.recommendations,
    };
  }

  private exportFlamegraph(): string {
    // Simplified flamegraph format
    const lines: string[] = [];
    
    for (const [service, analysis] of this.serviceAnalysis) {
      const stack = `startup;${service}`;
      const value = Math.round(analysis.startupDuration);
      lines.push(`${stack} ${value}`);
      
      // Add sub-timings if available
      if (analysis.bottleneckFactors.includes('slow_startup')) {
        lines.push(`${stack};initialization ${Math.round(value * 0.6)}`);
        lines.push(`${stack};dependencies ${Math.round(value * 0.4)}`);
      }
    }
    
    return lines.join('\n');
  }

  private exportTimeline(): string {
    // Generate HTML timeline visualization
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Startup Timeline</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .timeline { position: relative; margin: 20px 0; }
    .service { position: relative; height: 30px; margin: 5px 0; }
    .service-bar { position: absolute; height: 100%; background: #4CAF50; opacity: 0.7; }
    .service-name { position: absolute; left: 5px; line-height: 30px; }
    .bottleneck { background: #f44336 !important; }
    .time-axis { border-top: 1px solid #ccc; margin-top: 20px; position: relative; }
  </style>
</head>
<body>
  <h1>Service Startup Timeline</h1>
  <div class="timeline">
    ${Array.from(this.serviceAnalysis.values()).map(analysis => `
      <div class="service">
        <div class="service-bar ${analysis.bottleneckFactors.length > 0 ? 'bottleneck' : ''}" 
             style="left: 0; width: ${analysis.startupDuration / 100}px;">
        </div>
        <div class="service-name">${analysis.serviceName} (${analysis.startupDuration}ms)</div>
      </div>
    `).join('')}
  </div>
  <div class="time-axis">
    <div>0ms</div>
  </div>
  <h2>Bottlenecks</h2>
  <ul>
    ${this.bottlenecks.map(b => `
      <li>${b.service} - ${b.type} (${b.impact} impact)</li>
    `).join('')}
  </ul>
</body>
</html>
    `;
  }
}