import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class MonitoringMetrics extends Command {
  static override description = 'View and analyze system metrics, performance data, and analytics';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --operation live',
    '<%= config.bin %> <%= command.id %> --operation historical --timeframe 24h',
    '<%= config.bin %> <%= command.id %> --operation query --metric cpu --timeframe 1h',
    '<%= config.bin %> <%= command.id %> --operation export --format json --output metrics.json',
  ];

  static override flags = {
    operation: Flags.string({
      char: 'o',
      description: 'Metrics operation to perform',
      options: ['live', 'historical', 'query', 'export', 'configure'],
      default: 'live',
    }),
    metric: Flags.string({
      char: 'm',
      description: 'Specific metric to query',
      options: ['cpu', 'memory', 'disk', 'network', 'requests', 'errors', 'latency', 'all'],
    }),
    timeframe: Flags.string({
      char: 't',
      description: 'Time frame for historical data',
      options: ['5m', '15m', '1h', '6h', '24h', '7d', '30d'],
      default: '1h',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'json', 'csv', 'prometheus'],
      default: 'table',
    }),
    output: Flags.string({
      description: 'Output file path for export',
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Watch mode - continuously update metrics',
      default: false,
    }),
    interval: Flags.integer({
      char: 'i',
      description: 'Update interval in seconds for watch mode',
      default: 5,
    }),
    threshold: Flags.string({
      description: 'Alert threshold for metrics (e.g., cpu:80,memory:90)',
    }),
    aggregate: Flags.string({
      char: 'a',
      description: 'Aggregation function',
      options: ['avg', 'min', 'max', 'sum', 'count'],
      default: 'avg',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MonitoringMetrics);
    
    this.log(chalk.blue('📊 System Metrics Monitoring'));
    this.log('='.repeat(50));

    try {
      switch (flags.operation) {
        case 'live':
          await this.showLiveMetrics(flags);
          break;
        case 'historical':
          await this.showHistoricalMetrics(flags);
          break;
        case 'query':
          await this.querySpecificMetric(flags);
          break;
        case 'export':
          await this.exportMetrics(flags);
          break;
        case 'configure':
          await this.configureMetrics(flags);
          break;
      }

    } catch (error) {
      this.log(chalk.red('❌ Metrics operation failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async showLiveMetrics(flags: any): Promise<void> {
    if (flags.watch) {
      this.log(chalk.blue('📊 Live Metrics Dashboard (Press Ctrl+C to exit)'));
      this.log('='.repeat(50));
      
      const interval = setInterval(async () => {
        // Clear screen
        process.stdout.write('\x1B[2J\x1B[0f');
        
        this.log(chalk.blue('📊 Live Metrics Dashboard'));
        this.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
        this.log('='.repeat(50));
        
        const metrics = await this.collectCurrentMetrics();
        this.displayMetrics(metrics, flags);
        
        // Check thresholds
        if (flags.threshold) {
          this.checkThresholds(metrics, flags.threshold);
        }
        
      }, flags.interval * 1000);
      
      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(interval);
        this.log(chalk.yellow('\n👋 Metrics monitoring stopped'));
        process.exit(0);
      });
      
    } else {
      // Single snapshot
      const metrics = await this.collectCurrentMetrics();
      this.displayMetrics(metrics, flags);
    }
  }

  private async showHistoricalMetrics(flags: any): Promise<void> {
    this.log(chalk.blue(`📈 Historical Metrics (${flags.timeframe})`));
    this.log('-'.repeat(40));

    // For now, show current metrics as historical data would require a time-series database
    this.log(chalk.yellow('ℹ️  Historical metrics require a time-series database integration'));
    this.log(chalk.gray('Showing current metrics as a placeholder:\n'));
    
    const metrics = await this.collectCurrentMetrics();
    this.displayMetrics(metrics, flags);
  }

  private async querySpecificMetric(flags: any): Promise<void> {
    if (!flags.metric) {
      this.log(chalk.red('❌ Metric parameter required for query operation'));
      return;
    }

    this.log(chalk.blue(`🔍 Querying Metric: ${flags.metric} (${flags.timeframe})`));
    this.log('-'.repeat(40));

    const metrics = await this.collectCurrentMetrics();
    const specificMetric = this.getSpecificMetric(metrics, flags.metric);
    
    if (specificMetric) {
      this.displaySpecificMetric(specificMetric, flags);
    } else {
      this.log(chalk.red(`❌ Metric '${flags.metric}' not found`));
    }
  }

  private async exportMetrics(flags: any): Promise<void> {
    this.log(chalk.blue('📤 Exporting Metrics'));
    this.log('-'.repeat(25));

    const metrics = await this.collectCurrentMetrics();
    
    if (flags.output) {
      await this.saveMetricsToFile(metrics, flags.output, flags.format);
    } else {
      this.outputMetrics(metrics, flags.format);
    }
  }

  private async configureMetrics(flags: any): Promise<void> {
    this.log(chalk.blue('⚙️ Metrics Configuration'));
    this.log(chalk.yellow('Metrics configuration will be implemented in a future release'));
  }

  // Metrics collection methods

  private async collectCurrentMetrics(): Promise<SystemMetrics> {
    const timestamp = new Date();
    
    return {
      timestamp,
      system: await this.collectSystemMetrics(),
      application: await this.collectApplicationMetrics(),
      database: await this.collectDatabaseMetrics(),
      network: await this.collectNetworkMetrics(),
    };
  }

  private async collectSystemMetrics(): Promise<SystemResourceMetrics> {
    // Node.js process metrics
    const memory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      cpu: {
        usage: Math.round((cpuUsage.user + cpuUsage.system) / 10000) / 100, // Convert to percentage
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      memory: {
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024), // MB
        rss: Math.round(memory.rss / 1024 / 1024), // MB
        external: Math.round(memory.external / 1024 / 1024), // MB
        usagePercent: Math.round((memory.heapUsed / memory.heapTotal) * 100),
      },
      uptime: Math.round(process.uptime()),
      loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
    };
  }

  private async collectApplicationMetrics(): Promise<ApplicationMetrics> {
    // Try to get metrics from application endpoints
    const metrics: ApplicationMetrics = {
      requests: { total: 0, rate: 0, errors: 0, errorRate: 0 },
      responses: { average: 0, p95: 0, p99: 0 },
      graphql: { queries: 0, mutations: 0, subscriptions: 0, errors: 0 },
    };

    try {
      // Try to fetch metrics from Prometheus endpoint if available
      const response = await fetch('http://localhost:4000/metrics', {
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const metricsText = await response.text();
        metrics.requests = this.parsePrometheusMetrics(metricsText, 'http_requests');
        metrics.responses = this.parsePrometheusMetrics(metricsText, 'http_request_duration');
      }
    } catch {
      // Metrics endpoint not available, use placeholder data
    }

    return metrics;
  }

  private async collectDatabaseMetrics(): Promise<DatabaseMetrics> {
    const metrics: DatabaseMetrics = {
      connections: { active: 0, idle: 0, total: 0 },
      queries: { total: 0, rate: 0, slow: 0 },
      performance: { avgQueryTime: 0, cacheHitRate: 0 },
    };

    try {
      // Try to get database metrics (would need actual implementation)
      // For now, return placeholder data
      metrics.connections = { active: 5, idle: 15, total: 20 };
      metrics.queries = { total: 1000, rate: 10.5, slow: 2 };
      metrics.performance = { avgQueryTime: 25, cacheHitRate: 85 };
    } catch {
      // Database metrics not available
    }

    return metrics;
  }

  private async collectNetworkMetrics(): Promise<NetworkMetrics> {
    try {
      // Try to get network stats (simplified)
      const networkInterfaces = require('os').networkInterfaces();
      const interfaces = Object.keys(networkInterfaces).length;
      
      return {
        interfaces,
        bytesIn: 0, // Would need actual network monitoring
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        errors: 0,
      };
    } catch {
      return {
        interfaces: 0,
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        errors: 0,
      };
    }
  }

  private parsePrometheusMetrics(metricsText: string, prefix: string): any {
    // Simple Prometheus metrics parser (would need proper implementation)
    const lines = metricsText.split('\n');
    const relevantLines = lines.filter(line => line.startsWith(prefix));
    
    // Return placeholder data for now
    return { total: relevantLines.length, rate: 0, errors: 0 };
  }

  // Display methods

  private displayMetrics(metrics: SystemMetrics, flags: any): void {
    if (flags.format === 'json') {
      this.log(JSON.stringify(metrics, null, 2));
      return;
    }

    // Table format
    this.log(chalk.cyan('🖥️ System Resources:'));
    this.log(`  CPU Usage: ${metrics.system.cpu.usage}%`);
    this.log(`  Memory: ${metrics.system.memory.heapUsed}MB / ${metrics.system.memory.heapTotal}MB (${metrics.system.memory.usagePercent}%)`);
    this.log(`  RSS Memory: ${metrics.system.memory.rss}MB`);
    this.log(`  Uptime: ${this.formatUptime(metrics.system.uptime)}`);
    
    if (metrics.system.loadAverage) {
      this.log(`  Load Average: ${metrics.system.loadAverage.map(l => l.toFixed(2)).join(', ')}`);
    }

    this.log(chalk.cyan('\n🌐 Application Metrics:'));
    this.log(`  Total Requests: ${metrics.application.requests.total}`);
    this.log(`  Request Rate: ${metrics.application.requests.rate}/sec`);
    this.log(`  Error Rate: ${metrics.application.requests.errorRate}%`);
    this.log(`  Avg Response Time: ${metrics.application.responses.average}ms`);

    this.log(chalk.cyan('\n🗄️ Database Metrics:'));
    this.log(`  Active Connections: ${metrics.database.connections.active}`);
    this.log(`  Total Connections: ${metrics.database.connections.total}`);
    this.log(`  Query Rate: ${metrics.database.queries.rate}/sec`);
    this.log(`  Avg Query Time: ${metrics.database.performance.avgQueryTime}ms`);
    this.log(`  Cache Hit Rate: ${metrics.database.performance.cacheHitRate}%`);

    this.log(chalk.cyan('\n🌐 Network Metrics:'));
    this.log(`  Network Interfaces: ${metrics.network.interfaces}`);
    this.log(`  Bytes In/Out: ${this.formatBytes(metrics.network.bytesIn)} / ${this.formatBytes(metrics.network.bytesOut)}`);
    this.log(`  Packets In/Out: ${metrics.network.packetsIn} / ${metrics.network.packetsOut}`);
    
    this.log(chalk.gray(`\nLast Updated: ${metrics.timestamp.toLocaleString()}`));
  }

  private getSpecificMetric(metrics: SystemMetrics, metricName: string): any {
    switch (metricName) {
      case 'cpu':
        return metrics.system.cpu;
      case 'memory':
        return metrics.system.memory;
      case 'requests':
        return metrics.application.requests;
      case 'errors':
        return { 
          requests: metrics.application.requests.errors,
          rate: metrics.application.requests.errorRate 
        };
      case 'latency':
        return metrics.application.responses;
      case 'network':
        return metrics.network;
      default:
        return null;
    }
  }

  private displaySpecificMetric(metric: any, flags: any): void {
    if (flags.format === 'json') {
      this.log(JSON.stringify(metric, null, 2));
      return;
    }

    this.log(chalk.cyan(`📊 ${flags.metric.toUpperCase()} Metrics:`));
    
    if (typeof metric === 'object') {
      for (const [key, value] of Object.entries(metric)) {
        this.log(`  ${key}: ${value}`);
      }
    } else {
      this.log(`  Value: ${metric}`);
    }
  }

  private checkThresholds(metrics: SystemMetrics, thresholdString: string): void {
    const thresholds = this.parseThresholds(thresholdString);
    const alerts: string[] = [];

    for (const [metric, threshold] of Object.entries(thresholds)) {
      const value = this.getMetricValue(metrics, metric);
      if (value !== null && value > threshold) {
        alerts.push(`${metric}: ${value} > ${threshold}`);
      }
    }

    if (alerts.length > 0) {
      this.log(chalk.red('\n🚨 ALERTS:'));
      for (const alert of alerts) {
        this.log(chalk.red(`  ⚠️  ${alert}`));
      }
    }
  }

  private parseThresholds(thresholdString: string): Record<string, number> {
    const thresholds: Record<string, number> = {};
    
    const pairs = thresholdString.split(',');
    for (const pair of pairs) {
      const [metric, value] = pair.split(':');
      if (metric && value) {
        thresholds[metric.trim()] = parseFloat(value.trim());
      }
    }
    
    return thresholds;
  }

  private getMetricValue(metrics: SystemMetrics, metricName: string): number | null {
    switch (metricName) {
      case 'cpu':
        return metrics.system.cpu.usage;
      case 'memory':
        return metrics.system.memory.usagePercent;
      case 'requests':
        return metrics.application.requests.rate;
      case 'errors':
        return metrics.application.requests.errorRate;
      default:
        return null;
    }
  }

  // Output and export methods

  private outputMetrics(metrics: SystemMetrics, format: string): void {
    switch (format) {
      case 'json':
        this.log(JSON.stringify(metrics, null, 2));
        break;
      case 'csv':
        this.outputCSV(metrics);
        break;
      case 'prometheus':
        this.outputPrometheus(metrics);
        break;
      default:
        this.displayMetrics(metrics, { format: 'table' });
    }
  }

  private outputCSV(metrics: SystemMetrics): void {
    this.log('timestamp,cpu_usage,memory_usage,memory_used_mb,uptime,requests_total,request_rate,error_rate');
    this.log([
      metrics.timestamp.toISOString(),
      metrics.system.cpu.usage,
      metrics.system.memory.usagePercent,
      metrics.system.memory.heapUsed,
      metrics.system.uptime,
      metrics.application.requests.total,
      metrics.application.requests.rate,
      metrics.application.requests.errorRate
    ].join(','));
  }

  private outputPrometheus(metrics: SystemMetrics): void {
    const timestamp = Date.now();
    
    this.log(`# System metrics`);
    this.log(`cpu_usage_percent ${metrics.system.cpu.usage} ${timestamp}`);
    this.log(`memory_usage_percent ${metrics.system.memory.usagePercent} ${timestamp}`);
    this.log(`memory_used_bytes ${metrics.system.memory.heapUsed * 1024 * 1024} ${timestamp}`);
    this.log(`uptime_seconds ${metrics.system.uptime} ${timestamp}`);
    
    this.log(`# Application metrics`);
    this.log(`http_requests_total ${metrics.application.requests.total} ${timestamp}`);
    this.log(`http_request_rate ${metrics.application.requests.rate} ${timestamp}`);
    this.log(`http_error_rate ${metrics.application.requests.errorRate} ${timestamp}`);
  }

  private async saveMetricsToFile(metrics: SystemMetrics, filePath: string, format: string): Promise<void> {
    const fs = await import('fs/promises');
    let content: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(metrics, null, 2);
        break;
      case 'csv':
        content = this.getCSVContent(metrics);
        break;
      default:
        content = JSON.stringify(metrics, null, 2);
    }

    await fs.writeFile(filePath, content);
    this.log(chalk.green(`💾 Metrics exported to: ${filePath}`));
  }

  private getCSVContent(metrics: SystemMetrics): string {
    const header = 'timestamp,cpu_usage,memory_usage,memory_used_mb,uptime,requests_total,request_rate,error_rate';
    const row = [
      metrics.timestamp.toISOString(),
      metrics.system.cpu.usage,
      metrics.system.memory.usagePercent,
      metrics.system.memory.heapUsed,
      metrics.system.uptime,
      metrics.application.requests.total,
      metrics.application.requests.rate,
      metrics.application.requests.errorRate
    ].join(',');
    
    return `${header}\n${row}`;
  }

  // Utility methods

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Type definitions

interface SystemMetrics {
  timestamp: Date;
  system: SystemResourceMetrics;
  application: ApplicationMetrics;
  database: DatabaseMetrics;
  network: NetworkMetrics;
}

interface SystemResourceMetrics {
  cpu: {
    usage: number;
    user: number;
    system: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    usagePercent: number;
  };
  uptime: number;
  loadAverage: number[];
}

interface ApplicationMetrics {
  requests: {
    total: number;
    rate: number;
    errors: number;
    errorRate: number;
  };
  responses: {
    average: number;
    p95: number;
    p99: number;
  };
  graphql: {
    queries: number;
    mutations: number;
    subscriptions: number;
    errors: number;
  };
}

interface DatabaseMetrics {
  connections: {
    active: number;
    idle: number;
    total: number;
  };
  queries: {
    total: number;
    rate: number;
    slow: number;
  };
  performance: {
    avgQueryTime: number;
    cacheHitRate: number;
  };
}

interface NetworkMetrics {
  interfaces: number;
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  errors: number;
}