#!/usr/bin/env bun

/**
 * System Test Script - Tests core infrastructure services
 */

import { logger } from './src/lib/unjs-utils.js';
import { EnhancedServiceRegistry } from './src/infrastructure/core/ServiceRegistry.enhanced.js';
import { ServiceDependencyGraph } from './src/infrastructure/orchestration/ServiceDependencyGraph.js';
import { StartupOrchestrator } from './src/infrastructure/core/StartupOrchestrator.js';
import { ServiceCommunicationHub } from './src/infrastructure/orchestration/ServiceCommunicationHub.js';
import { ServiceHealthMonitor } from './src/infrastructure/core/ServiceHealthMonitor.js';
import { ServiceMetrics } from './src/infrastructure/core/ServiceMetrics.js';

async function testSystemInitialization() {
  logger.info('🚀 Starting system initialization test...');

  try {
    // Test 1: Core service instances
    logger.info('📋 Test 1: Creating core service instances...');
    
    const registry = EnhancedServiceRegistry.getInstance();
    const dependencyGraph = new ServiceDependencyGraph();
    const orchestrator = new StartupOrchestrator();
    const communicationHub = ServiceCommunicationHub.getInstance();
    const healthMonitor = ServiceHealthMonitor.getInstance();
    const metrics = ServiceMetrics.getInstance();

    logger.info('✅ Core service instances created successfully');

    // Test 2: Service Registry functionality
    logger.info('📋 Test 2: Testing service registry functionality...');
    
    const systemHealth = await registry.getSystemHealth();
    logger.info(`System Health: ${systemHealth.summary.healthy}/${systemHealth.summary.total} services healthy`);
    
    const allServices = registry.getAllServices();
    logger.info(`Registry contains ${allServices.size} services`);

    logger.info('✅ Service registry test passed');

    // Test 3: Dependency Graph
    logger.info('📋 Test 3: Testing dependency graph...');
    
    const sortedDeps = dependencyGraph.topologicalSort();
    logger.info(`Dependency graph has ${sortedDeps.length} levels`);
    
    const criticalPath = dependencyGraph.calculateCriticalPath();
    logger.info(`Critical path: ${criticalPath.services.join(' → ')}`);
    logger.info(`Critical path time: ${criticalPath.totalTime}ms`);

    logger.info('✅ Dependency graph test passed');

    // Test 4: Health Monitor
    logger.info('📋 Test 4: Testing health monitor...');
    
    healthMonitor.startMonitoring(5000);
    const incidents = healthMonitor.getCurrentIncidents();
    logger.info(`Current incidents: ${incidents.length}`);
    
    // Stop monitoring to clean up
    setTimeout(() => {
      healthMonitor.stopMonitoring();
    }, 1000);

    logger.info('✅ Health monitor test passed');

    // Test 5: Metrics System
    logger.info('📋 Test 5: Testing metrics system...');
    
    metrics.record('test-service', 'response_time', 150, 'histogram');
    metrics.record('test-service', 'requests_total', 1, 'counter');
    
    const performance = metrics.analyzeServicePerformance('test-service');
    if (performance) {
      logger.info(`Service performance: ${performance.responseTime.avg}ms avg response time`);
    }

    logger.info('✅ Metrics system test passed');

    // Test 6: Communication Hub
    logger.info('📋 Test 6: Testing communication hub...');
    
    // Test circuit breaker configuration
    communicationHub.configureCircuitBreaker('test-service', {
      failureThreshold: 5,
      timeoutMs: 30000,
      recoveryTimeMs: 60000
    });
    
    // Test load balancer configuration
    communicationHub.configureLoadBalancer('test-capability', {
      strategy: 'round-robin',
      healthCheck: true,
      weights: new Map([['test-service', 1]])
    });
    
    // Test getting circuit breaker status
    const circuitStatus = communicationHub.getCircuitBreakerStatus('test-service');
    logger.info(`Circuit breaker status: ${circuitStatus?.state || 'not configured'}`);
    
    // Test getting statistics
    const stats = communicationHub.getStatistics();
    logger.info(`Communication hub stats: ${stats.totalMessages} total messages`);

    logger.info('✅ Communication hub test passed');

    logger.info('🎉 All system tests passed successfully!');
    logger.info('📊 System Summary:');
    logger.info(`   - Services registered: ${allServices.size}`);
    logger.info(`   - Dependency levels: ${sortedDeps.length}`);
    logger.info(`   - Critical path time: ${criticalPath.totalTime}ms`);
    logger.info(`   - Current incidents: ${incidents.length}`);

  } catch (error) {
    logger.error('❌ System test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSystemInitialization().then(() => {
  logger.info('✅ System test completed successfully');
  process.exit(0);
}).catch((error) => {
  logger.error('❌ System test failed:', error);
  process.exit(1);
});