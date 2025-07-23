#!/usr/bin/env bun

/**
 * Demonstration of the advanced service orchestration system
 * 
 * This script shows:
 * - Service dependency graph visualization
 * - Parallel startup execution
 * - Health-based progression
 * - Performance profiling
 * - Inter-service communication
 */

import { ServiceDependencyGraph } from './ServiceDependencyGraph.js';
import { StartupOrchestrator } from './StartupOrchestrator.js';
import { ServiceCommunicationHub } from './ServiceCommunicationHub.js';
import { getAllServiceDefinitions, STARTUP_STAGES } from './ServiceDefinitions.js';
import { logger } from '@/lib/unjs-utils.js';
import chalk from 'chalk';

// ANSI escape codes for better visualization
const clear = '\x1b[2J\x1b[0f';
const bold = (text: string) => chalk.bold(text);
const green = (text: string) => chalk.green(text);
const yellow = (text: string) => chalk.yellow(text);
const red = (text: string) => chalk.red(text);
const blue = (text: string) => chalk.blue(text);
const dim = (text: string) => chalk.dim(text);

/**
 * Visualize the dependency graph
 */
async function visualizeDependencyGraph() {
  console.log(bold('\n📊 Service Dependency Graph\n'));
  
  const graph = new ServiceDependencyGraph();
  const services = getAllServiceDefinitions();
  
  // Add all services to graph
  for (const service of services) {
    graph.addService(service);
  }
  
  // Validate graph
  const validation = graph.validateGraph();
  if (!validation.valid) {
    console.log(red('❌ Graph validation failed:'));
    validation.errors.forEach(error => console.log(`  - ${error}`));
    return;
  }
  
  if (validation.warnings.length > 0) {
    console.log(yellow('⚠️  Warnings:'));
    validation.warnings.forEach(warning => console.log(`  - ${warning}`));
  }
  
  // Get statistics
  const stats = graph.getStatistics();
  console.log(blue('\n📈 Statistics:'));
  console.log(`  Total Services: ${stats.totalServices}`);
  console.log(`  Critical Services: ${stats.criticalServices}`);
  console.log(`  Max Depth: ${stats.maxDepth}`);
  console.log(`  Average Dependencies: ${stats.averageDependencies.toFixed(2)}`);
  console.log(`  Root Services: ${stats.rootServices}`);
  console.log(`  Leaf Services: ${stats.leafServices}`);
  
  // Show parallel groups
  console.log(blue('\n🔀 Parallel Execution Groups:'));
  const groups = graph.getParallelGroups();
  groups.forEach((group, index) => {
    console.log(`\n  ${bold(`Group ${index + 1}`)} (Depth ${group.depth}, Timeout ${group.timeout}ms):`);
    group.services.forEach(service => {
      const def = services.find(s => s.name === service);
      const critical = def?.critical ? red('[CRITICAL]') : '';
      console.log(`    - ${service} ${critical}`);
    });
  });
  
  // Show critical path
  console.log(blue('\n🛤️  Critical Path:'));
  const criticalPath = graph.getCriticalPath();
  console.log(`  ${criticalPath.join(' → ')}`);
  
  // Export DOT format
  console.log(dim('\n💾 DOT format saved to: dependency-graph.dot'));
  const dot = graph.exportDOT();
  await Bun.write('dependency-graph.dot', dot);
}

/**
 * Simulate service startup
 */
async function simulateStartup() {
  console.log(bold('\n🚀 Simulating Service Startup\n'));
  
  const orchestrator = new StartupOrchestrator();
  const hub = ServiceCommunicationHub.getInstance();
  
  // Subscribe to orchestrator events
  orchestrator.on('orchestrator:service-starting', ({ service, attempt }) => {
    console.log(dim(`  [${new Date().toISOString().split('T')[1].split('.')[0]}] Starting ${service} (attempt ${attempt})`));
  });
  
  orchestrator.on('orchestrator:service-started', ({ service, duration }) => {
    console.log(green(`  ✓ ${service} started in ${duration}ms`));
  });
  
  orchestrator.on('orchestrator:service-failed', ({ service, error, attempts }) => {
    console.log(red(`  ✗ ${service} failed after ${attempts} attempts: ${error.message}`));
  });
  
  orchestrator.on('orchestrator:group-starting', ({ depth, services }) => {
    console.log(bold(`\n🔄 Starting Group ${depth + 1} (${services.length} services in parallel)`));
  });
  
  orchestrator.on('orchestrator:group-completed', ({ depth, results }) => {
    const successful = results.services.filter(s => s.status === 'success').length;
    const failed = results.services.filter(s => s.status === 'failed').length;
    console.log(`  Group ${depth + 1} complete: ${green(`${successful} successful`)}, ${failed > 0 ? red(`${failed} failed`) : '0 failed'}, efficiency: ${(results.parallelEfficiency * 100).toFixed(1)}%`);
  });
  
  // Register mock service factories
  const services = getAllServiceDefinitions();
  for (const service of services) {
    orchestrator.registerService(service, async () => {
      // Simulate startup time
      const baseTime = service.startupTimeout || 10000;
      const variance = 0.3; // 30% variance
      const actualTime = baseTime * (1 - variance + Math.random() * variance * 2);
      
      // Simulate failure for some services
      const failureRate = service.critical ? 0.05 : 0.1; // 5% for critical, 10% for others
      if (Math.random() < failureRate) {
        await new Promise(resolve => setTimeout(resolve, actualTime / 3));
        throw new Error(`Simulated failure for ${service.name}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, actualTime));
      
      return {
        name: service.name,
        getHealth: async () => {
          const healthStatus = Math.random() > 0.9 ? 'degraded' : 'healthy';
          return { status: healthStatus, message: `Service is ${healthStatus}` };
        },
        getServiceMetadata: () => ({
          version: '1.0.0',
          ...service.metadata,
        }),
      };
    });
  }
  
  // Start the orchestration
  console.log(blue('\n📋 Using progressive stages:'));
  STARTUP_STAGES.forEach((stage, index) => {
    console.log(`  ${index + 1}. ${stage.name} (${stage.services.length} services)`);
  });
  
  const startTime = Date.now();
  
  try {
    const result = await orchestrator.executeProgressiveStartup(STARTUP_STAGES);
    const duration = Date.now() - startTime;
    
    console.log(bold(`\n✅ Startup Complete in ${duration}ms\n`));
    
    // Show results
    console.log(blue('📊 Results:'));
    console.log(`  Total Duration: ${result.totalDuration}ms`);
    console.log(`  Failed Services: ${result.failedServices.length > 0 ? red(result.failedServices.join(', ')) : green('None')}`);
    console.log(`  Degraded Services: ${result.degradedServices.length > 0 ? yellow(result.degradedServices.join(', ')) : green('None')}`);
    console.log(`  Skipped Services: ${result.skippedServices.length > 0 ? yellow(result.skippedServices.join(', ')) : 'None'}`);
    
    // Show performance profile
    if (result.startupProfile) {
      console.log(blue('\n⚡ Performance Profile:'));
      const metrics = result.startupProfile.parallelizationMetrics;
      console.log(`  Theoretical Min Time: ${metrics.theoreticalMinTime}ms`);
      console.log(`  Actual Time: ${metrics.actualTime}ms`);
      console.log(`  Efficiency: ${(metrics.efficiency * 100).toFixed(1)}%`);
      
      if (result.startupProfile.bottlenecks.length > 0) {
        console.log(yellow('\n🐌 Bottlenecks:'));
        result.startupProfile.bottlenecks.forEach(bottleneck => {
          console.log(`  - ${bottleneck.service}: ${bottleneck.duration}ms (${bottleneck.reason})`);
        });
      }
    }
    
    // Test inter-service communication
    await testCommunication(hub);
    
  } catch (error) {
    console.log(red(`\n❌ Startup failed: ${error}`));
  }
}

/**
 * Test inter-service communication
 */
async function testCommunication(hub: ServiceCommunicationHub) {
  console.log(bold('\n📡 Testing Inter-Service Communication\n'));
  
  // Create service proxies
  const todoProxy = hub.createServiceProxy<{
    create: (data: { title: string; userId: string }) => Promise<{ id: string; title: string }>;
    find: (query: { userId: string }) => Promise<Array<{ id: string; title: string }>>;
  }>('todo-service', {
    create: { timeout: 5000 },
    find: { timeout: 10000 },
  });
  
  // Subscribe to events
  const subscription = hub.subscribe<{ todoId: string; title: string }>(
    'todo-service',
    'todo:created',
    async (event) => {
      console.log(green(`  📨 Received event: Todo created - ${event.title}`));
    }
  );
  
  // Simulate service calls
  console.log('  Testing pub/sub:');
  hub.publish('todo:created', {
    todoId: '123',
    title: 'Test Todo',
  });
  
  // Get statistics
  const stats = hub.getStatistics();
  console.log(blue('\n📈 Communication Hub Statistics:'));
  console.log(`  Active Subscriptions: ${stats.activeSubscriptions}`);
  console.log(`  Service Proxies: ${stats.serviceProxies}`);
  console.log(`  Pending Correlations: ${stats.pendingCorrelations}`);
  
  // Cleanup
  subscription.unsubscribe();
}

/**
 * Main execution
 */
async function main() {
  console.log(clear);
  console.log(bold(blue('🎯 Advanced Service Orchestration Demo\n')));
  
  try {
    // Step 1: Visualize dependencies
    await visualizeDependencyGraph();
    
    // Wait for user input
    console.log(dim('\nPress Enter to continue with startup simulation...'));
    await Bun.stdin.text();
    
    // Step 2: Simulate startup
    await simulateStartup();
    
    console.log(bold(green('\n✨ Demo complete!')));
    console.log(dim('\nTo visualize the dependency graph, run:'));
    console.log(dim('  dot -Tpng dependency-graph.dot -o dependency-graph.png'));
    
  } catch (error) {
    console.error(red('\n❌ Demo failed:'), error);
    process.exit(1);
  }
}

// Run the demo
if (import.meta.main) {
  main().catch(console.error);
}