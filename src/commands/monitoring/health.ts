import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { executeCommand } from '../../lib/utils.js';

export default class MonitoringHealth extends Command {
  static override description = 'Run comprehensive health checks on all system components';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> --operation full',
    '<%= config.bin %> <%= command.id %> --operation quick --format json',
    '<%= config.bin %> <%= command.id %> --operation targeted --services api,database',
    '<%= config.bin %> <%= command.id %> --operation dashboard --watch',
  ];

  static override flags = {
    operation: Flags.string({
      char: 'o',
      description: 'Health check operation to perform',
      options: ['full', 'quick', 'targeted', 'dashboard', 'report', 'configure'],
      default: 'quick',
    }),
    services: Flags.string({
      char: 's',
      description: 'Comma-separated list of services to check',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'json', 'yaml'],
      default: 'table',
    }),
    timeout: Flags.integer({
      char: 't',
      description: 'Timeout in seconds for each health check',
      default: 10,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Watch mode - continuously monitor health',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output with detailed health information',
      default: false,
    }),
    'fail-fast': Flags.boolean({
      description: 'Stop on first health check failure',
      default: false,
    }),
    'save-report': Flags.string({
      description: 'Save health report to file',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MonitoringHealth);
    
    this.log(chalk.blue('🏥 System Health Monitoring'));
    this.log('='.repeat(50));

    try {
      switch (flags.operation) {
        case 'full':
          await this.runFullHealthCheck(flags);
          break;
        case 'quick':
          await this.runQuickHealthCheck(flags);
          break;
        case 'targeted':
          await this.runTargetedHealthCheck(flags);
          break;
        case 'dashboard':
          await this.showHealthDashboard(flags);
          break;
        case 'report':
          await this.generateHealthReport(flags);
          break;
        case 'configure':
          await this.configureHealthChecks(flags);
          break;
      }

    } catch (error) {
      this.log(chalk.red('❌ Health check failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async runFullHealthCheck(flags: any): Promise<void> {
    this.log(chalk.blue('🔍 Running Comprehensive Health Check'));
    this.log('-'.repeat(40));

    const healthResults: HealthCheckResult[] = [];
    
    // Infrastructure health checks
    healthResults.push(...await this.checkInfrastructure(flags));
    
    // Application health checks
    healthResults.push(...await this.checkApplications(flags));
    
    // Database health checks
    healthResults.push(...await this.checkDatabases(flags));
    
    // External services health checks
    healthResults.push(...await this.checkExternalServices(flags));
    
    // Performance health checks
    healthResults.push(...await this.checkPerformance(flags));

    this.displayHealthResults(healthResults, flags);
    
    if (flags['save-report']) {
      await this.saveHealthReport(healthResults, flags['save-report']);
    }
  }

  private async runQuickHealthCheck(flags: any): Promise<void> {
    this.log(chalk.blue('⚡ Quick Health Check'));
    this.log('-'.repeat(25));

    const healthResults: HealthCheckResult[] = [];
    
    // Essential services only
    healthResults.push(...await this.checkEssentialServices(flags));
    
    this.displayHealthResults(healthResults, flags);
  }

  private async runTargetedHealthCheck(flags: any): Promise<void> {
    if (!flags.services) {
      this.log(chalk.red('❌ Services parameter required for targeted health check'));
      return;
    }

    const services = flags.services.split(',').map((s: string) => s.trim());
    this.log(chalk.blue(`🎯 Targeted Health Check: ${services.join(', ')}`));
    this.log('-'.repeat(40));

    const healthResults: HealthCheckResult[] = [];
    
    for (const service of services) {
      const result = await this.checkSpecificService(service, flags);
      if (result) {
        healthResults.push(result);
        
        if (flags['fail-fast'] && !result.healthy) {
          this.log(chalk.red(`💥 Health check failed for ${service}, stopping (fail-fast mode)`));
          break;
        }
      }
    }

    this.displayHealthResults(healthResults, flags);
  }

  private async showHealthDashboard(flags: any): Promise<void> {
    if (flags.watch) {
      this.log(chalk.blue('📊 Live Health Dashboard (Press Ctrl+C to exit)'));
      this.log('='.repeat(50));
      
      // Clear screen and run health checks in a loop
      const interval = setInterval(async () => {
        // Clear screen
        process.stdout.write('\x1B[2J\x1B[0f');
        
        this.log(chalk.blue('📊 Live Health Dashboard'));
        this.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
        this.log('='.repeat(50));
        
        const healthResults = await this.checkEssentialServices(flags);
        this.displayHealthResults(healthResults, flags);
        
      }, 5000); // Update every 5 seconds
      
      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(interval);
        this.log(chalk.yellow('\n👋 Health monitoring stopped'));
        process.exit(0);
      });
      
    } else {
      // Static dashboard
      await this.runQuickHealthCheck(flags);
    }
  }

  private async generateHealthReport(flags: any): Promise<void> {
    this.log(chalk.blue('📋 Generating Comprehensive Health Report'));
    this.log('-'.repeat(45));

    const healthResults = await this.runFullHealthCheck(flags);
    
    // Generate summary
    const summary = this.generateHealthSummary(healthResults);
    this.log(chalk.blue('\n📊 Health Summary:'));
    this.log(JSON.stringify(summary, null, 2));
  }

  private async configureHealthChecks(flags: any): Promise<void> {
    this.log(chalk.blue('⚙️ Health Check Configuration'));
    this.log(chalk.yellow('Health check configuration will be implemented in a future release'));
  }

  // Health check implementations

  private async checkInfrastructure(flags: any): Promise<HealthCheckResult[]> {
    this.log(chalk.yellow('🏗️ Checking Infrastructure...'));
    const results: HealthCheckResult[] = [];

    // Docker health
    results.push(await this.checkDocker(flags));
    
    // System resources
    results.push(await this.checkSystemResources(flags));
    
    // Network connectivity
    results.push(await this.checkNetworkConnectivity(flags));

    return results;
  }

  private async checkApplications(flags: any): Promise<HealthCheckResult[]> {
    this.log(chalk.yellow('🌐 Checking Applications...'));
    const results: HealthCheckResult[] = [];

    // API Gateway
    results.push(await this.checkEndpoint('API Gateway', 'http://localhost:4000/health', flags));
    
    // GraphQL endpoint
    results.push(await this.checkGraphQLEndpoint('GraphQL API', 'http://localhost:4000/graphql', flags));
    
    // Subgraphs
    results.push(await this.checkEndpoint('User Subgraph', 'http://localhost:4001/health', flags));
    results.push(await this.checkEndpoint('Todo Subgraph', 'http://localhost:4002/health', flags));
    results.push(await this.checkEndpoint('AI Subgraph', 'http://localhost:4003/health', flags));

    return results;
  }

  private async checkDatabases(flags: any): Promise<HealthCheckResult[]> {
    this.log(chalk.yellow('🗄️ Checking Databases...'));
    const results: HealthCheckResult[] = [];

    // PostgreSQL
    results.push(await this.checkPostgreSQL(flags));
    
    // Redis
    results.push(await this.checkRedis(flags));
    
    // Qdrant (Vector DB)
    results.push(await this.checkQdrant(flags));

    return results;
  }

  private async checkExternalServices(flags: any): Promise<HealthCheckResult[]> {
    this.log(chalk.yellow('🌍 Checking External Services...'));
    const results: HealthCheckResult[] = [];

    // OpenAI API
    results.push(await this.checkOpenAI(flags));
    
    // Internet connectivity
    results.push(await this.checkInternetConnectivity(flags));

    return results;
  }

  private async checkPerformance(flags: any): Promise<HealthCheckResult[]> {
    this.log(chalk.yellow('⚡ Checking Performance...'));
    const results: HealthCheckResult[] = [];

    // Response times
    results.push(await this.checkResponseTimes(flags));
    
    // Memory usage
    results.push(await this.checkMemoryUsage(flags));
    
    // CPU usage
    results.push(await this.checkCPUUsage(flags));

    return results;
  }

  private async checkEssentialServices(flags: any): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    // Core application
    results.push(await this.checkEndpoint('API Gateway', 'http://localhost:4000/health', flags));
    
    // Database
    results.push(await this.checkPostgreSQL(flags));
    
    // Cache
    results.push(await this.checkRedis(flags));

    return results;
  }

  // Specific health check methods

  private async checkDocker(flags: any): Promise<HealthCheckResult> {
    try {
      await executeCommand('docker', ['ps'], { silent: true, timeout: flags.timeout * 1000 });
      return {
        name: 'Docker Engine',
        healthy: true,
        message: 'Docker is running and accessible',
        responseTime: 0,
        details: {}
      };
    } catch (error) {
      return {
        name: 'Docker Engine',
        healthy: false,
        message: 'Docker is not running or not accessible',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkSystemResources(flags: any): Promise<HealthCheckResult> {
    try {
      const memory = process.memoryUsage();
      const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memory.heapTotal / 1024 / 1024);
      
      const memoryUsagePercent = (heapUsedMB / heapTotalMB) * 100;
      const healthy = memoryUsagePercent < 90; // Consider unhealthy if >90% memory usage
      
      return {
        name: 'System Resources',
        healthy,
        message: healthy ? 'System resources are within normal limits' : 'High memory usage detected',
        responseTime: 0,
        details: {
          memoryUsedMB: heapUsedMB,
          memoryTotalMB: heapTotalMB,
          memoryUsagePercent: Math.round(memoryUsagePercent),
          uptime: Math.round(process.uptime()),
        }
      };
    } catch (error) {
      return {
        name: 'System Resources',
        healthy: false,
        message: 'Failed to check system resources',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkNetworkConnectivity(flags: any): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      await fetch('https://www.google.com', { 
        method: 'HEAD',
        signal: AbortSignal.timeout(flags.timeout * 1000)
      });
      const responseTime = Date.now() - startTime;
      
      return {
        name: 'Network Connectivity',
        healthy: true,
        message: 'Internet connectivity is available',
        responseTime,
        details: { latency: responseTime }
      };
    } catch (error) {
      return {
        name: 'Network Connectivity',
        healthy: false,
        message: 'No internet connectivity',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkEndpoint(name: string, url: string, flags: any): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(flags.timeout * 1000)
      });
      const responseTime = Date.now() - startTime;
      
      const healthy = response.ok;
      
      return {
        name,
        healthy,
        message: healthy ? `${name} is responding normally` : `${name} returned error status`,
        responseTime,
        details: {
          status: response.status,
          statusText: response.statusText,
          url
        }
      };
    } catch (error) {
      return {
        name,
        healthy: false,
        message: `${name} is not responding`,
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: { url }
      };
    }
  }

  private async checkGraphQLEndpoint(name: string, url: string, flags: any): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
        signal: AbortSignal.timeout(flags.timeout * 1000)
      });
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        const healthy = !data.errors;
        
        return {
          name,
          healthy,
          message: healthy ? `${name} is responding to GraphQL queries` : `${name} returned GraphQL errors`,
          responseTime,
          details: {
            status: response.status,
            hasErrors: !!data.errors,
            url
          }
        };
      } else {
        return {
          name,
          healthy: false,
          message: `${name} returned HTTP error`,
          responseTime,
          details: {
            status: response.status,
            statusText: response.statusText,
            url
          }
        };
      }
    } catch (error) {
      return {
        name,
        healthy: false,
        message: `${name} is not responding`,
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: { url }
      };
    }
  }

  private async checkPostgreSQL(flags: any): Promise<HealthCheckResult> {
    try {
      // Try to check if PostgreSQL container is running
      const result = await executeCommand('docker', ['ps', '--filter', 'name=postgres', '--format', '{{.Status}}'], { 
        silent: true, 
        timeout: flags.timeout * 1000 
      });
      
      const healthy = result.stdout.includes('Up');
      
      return {
        name: 'PostgreSQL Database',
        healthy,
        message: healthy ? 'PostgreSQL database is running' : 'PostgreSQL database is not running',
        responseTime: 0,
        details: {
          containerStatus: result.stdout.trim() || 'Not found'
        }
      };
    } catch (error) {
      return {
        name: 'PostgreSQL Database',
        healthy: false,
        message: 'Failed to check PostgreSQL status',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkRedis(flags: any): Promise<HealthCheckResult> {
    try {
      // Try to check if Redis container is running
      const result = await executeCommand('docker', ['ps', '--filter', 'name=redis', '--format', '{{.Status}}'], { 
        silent: true, 
        timeout: flags.timeout * 1000 
      });
      
      const healthy = result.stdout.includes('Up');
      
      return {
        name: 'Redis Cache',
        healthy,
        message: healthy ? 'Redis cache is running' : 'Redis cache is not running',
        responseTime: 0,
        details: {
          containerStatus: result.stdout.trim() || 'Not found'
        }
      };
    } catch (error) {
      return {
        name: 'Redis Cache',
        healthy: false,
        message: 'Failed to check Redis status',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkQdrant(flags: any): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      const response = await fetch('http://localhost:6333/health', {
        method: 'GET',
        signal: AbortSignal.timeout(flags.timeout * 1000)
      });
      const responseTime = Date.now() - startTime;
      
      const healthy = response.ok;
      
      return {
        name: 'Qdrant Vector DB',
        healthy,
        message: healthy ? 'Qdrant vector database is responding' : 'Qdrant vector database is not responding',
        responseTime,
        details: {
          status: response.status,
          url: 'http://localhost:6333/health'
        }
      };
    } catch (error) {
      return {
        name: 'Qdrant Vector DB',
        healthy: false,
        message: 'Qdrant vector database is not accessible',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkOpenAI(flags: any): Promise<HealthCheckResult> {
    // For security, we'll just check if the API key is configured
    const apiKey = process.env.OPENAI_API_KEY;
    
    return {
      name: 'OpenAI API',
      healthy: !!apiKey,
      message: apiKey ? 'OpenAI API key is configured' : 'OpenAI API key is not configured',
      responseTime: 0,
      details: {
        configured: !!apiKey,
        keyPresent: !!apiKey
      }
    };
  }

  private async checkInternetConnectivity(flags: any): Promise<HealthCheckResult> {
    return await this.checkNetworkConnectivity(flags);
  }

  private async checkResponseTimes(flags: any): Promise<HealthCheckResult> {
    const endpoints = [
      'http://localhost:4000/health',
      'http://localhost:4000/graphql'
    ];
    
    const responseTimes: number[] = [];
    
    for (const endpoint of endpoints) {
      try {
        const startTime = Date.now();
        await fetch(endpoint, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(flags.timeout * 1000)
        });
        responseTimes.push(Date.now() - startTime);
      } catch {
        // Skip failed requests
      }
    }
    
    if (responseTimes.length === 0) {
      return {
        name: 'Response Times',
        healthy: false,
        message: 'No endpoints responded',
        responseTime: 0,
        details: {}
      };
    }
    
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const healthy = avgResponseTime < 1000; // Consider unhealthy if >1s average
    
    return {
      name: 'Response Times',
      healthy,
      message: healthy ? 'Response times are within acceptable limits' : 'Response times are slow',
      responseTime: avgResponseTime,
      details: {
        averageMs: Math.round(avgResponseTime),
        samples: responseTimes.length,
        threshold: 1000
      }
    };
  }

  private async checkMemoryUsage(flags: any): Promise<HealthCheckResult> {
    return await this.checkSystemResources(flags); // Reuse system resources check
  }

  private async checkCPUUsage(flags: any): Promise<HealthCheckResult> {
    try {
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      
      const healthy = cpuPercent < 80; // Consider unhealthy if >80% CPU
      
      return {
        name: 'CPU Usage',
        healthy,
        message: healthy ? 'CPU usage is normal' : 'High CPU usage detected',
        responseTime: 0,
        details: {
          cpuPercent: Math.round(cpuPercent),
          userTime: cpuUsage.user,
          systemTime: cpuUsage.system,
          threshold: 80
        }
      };
    } catch (error) {
      return {
        name: 'CPU Usage',
        healthy: false,
        message: 'Failed to check CPU usage',
        error: error instanceof Error ? error.message : String(error),
        responseTime: 0,
        details: {}
      };
    }
  }

  private async checkSpecificService(service: string, flags: any): Promise<HealthCheckResult | null> {
    switch (service.toLowerCase()) {
      case 'api':
      case 'gateway':
        return await this.checkEndpoint('API Gateway', 'http://localhost:4000/health', flags);
      case 'graphql':
        return await this.checkGraphQLEndpoint('GraphQL API', 'http://localhost:4000/graphql', flags);
      case 'database':
      case 'postgres':
        return await this.checkPostgreSQL(flags);
      case 'redis':
      case 'cache':
        return await this.checkRedis(flags);
      case 'qdrant':
      case 'vector':
        return await this.checkQdrant(flags);
      case 'docker':
        return await this.checkDocker(flags);
      case 'system':
        return await this.checkSystemResources(flags);
      case 'network':
        return await this.checkNetworkConnectivity(flags);
      default:
        this.log(chalk.yellow(`⚠️  Unknown service: ${service}`));
        return null;
    }
  }

  // Display and output methods

  private displayHealthResults(results: HealthCheckResult[], flags: any): void {
    if (flags.format === 'json') {
      this.log(JSON.stringify(results, null, 2));
      return;
    }

    if (flags.format === 'yaml') {
      // Simple YAML output
      this.log('health_checks:');
      for (const result of results) {
        this.log(`  - name: "${result.name}"`);
        this.log(`    healthy: ${result.healthy}`);
        this.log(`    message: "${result.message}"`);
        this.log(`    response_time: ${result.responseTime}`);
      }
      return;
    }

    // Table format
    this.log(chalk.blue('\n📊 Health Check Results:'));
    this.log('='.repeat(80));

    const healthy = results.filter(r => r.healthy).length;
    const total = results.length;
    
    this.log(chalk.cyan(`Overall Health: ${healthy}/${total} services healthy`));
    this.log('');

    for (const result of results) {
      const status = result.healthy ? chalk.green('✅ HEALTHY') : chalk.red('❌ UNHEALTHY');
      const responseTime = result.responseTime > 0 ? ` (${result.responseTime}ms)` : '';
      
      this.log(`${status} ${result.name}${responseTime}`);
      this.log(chalk.gray(`   ${result.message}`));
      
      if (result.error) {
        this.log(chalk.red(`   Error: ${result.error}`));
      }
      
      if (flags.verbose && Object.keys(result.details).length > 0) {
        this.log(chalk.gray(`   Details: ${JSON.stringify(result.details)}`));
      }
      
      this.log('');
    }

    // Summary
    const overallHealthy = healthy === total;
    const summaryColor = overallHealthy ? chalk.green : chalk.red;
    const summaryIcon = overallHealthy ? '🎉' : '⚠️';
    
    this.log(summaryColor(`${summaryIcon} Overall Status: ${overallHealthy ? 'HEALTHY' : 'ISSUES DETECTED'}`));
    
    if (!overallHealthy) {
      this.log(chalk.yellow('\n💡 Troubleshooting Tips:'));
      this.log(chalk.yellow('  • Check service logs for detailed error information'));
      this.log(chalk.yellow('  • Verify all required services are running'));
      this.log(chalk.yellow('  • Check network connectivity and firewall settings'));
      this.log(chalk.yellow('  • Review system resource usage'));
    }
  }

  private generateHealthSummary(results: HealthCheckResult[]): HealthSummary {
    const healthy = results.filter(r => r.healthy).length;
    const unhealthy = results.filter(r => !r.healthy).length;
    const avgResponseTime = results
      .filter(r => r.responseTime > 0)
      .reduce((sum, r) => sum + r.responseTime, 0) / results.filter(r => r.responseTime > 0).length;

    return {
      timestamp: new Date().toISOString(),
      totalChecks: results.length,
      healthyCount: healthy,
      unhealthyCount: unhealthy,
      healthPercentage: Math.round((healthy / results.length) * 100),
      averageResponseTime: Math.round(avgResponseTime) || 0,
      overallStatus: healthy === results.length ? 'HEALTHY' : 'UNHEALTHY',
      checks: results
    };
  }

  private async saveHealthReport(results: HealthCheckResult[], filePath: string): Promise<void> {
    const summary = this.generateHealthSummary(results);
    const fs = await import('fs/promises');
    
    await fs.writeFile(filePath, JSON.stringify(summary, null, 2));
    this.log(chalk.green(`💾 Health report saved to: ${filePath}`));
  }
}

interface HealthCheckResult {
  name: string;
  healthy: boolean;
  message: string;
  responseTime: number;
  details: Record<string, any>;
  error?: string;
}

interface HealthSummary {
  timestamp: string;
  totalChecks: number;
  healthyCount: number;
  unhealthyCount: number;
  healthPercentage: number;
  averageResponseTime: number;
  overallStatus: 'HEALTHY' | 'UNHEALTHY';
  checks: HealthCheckResult[];
}