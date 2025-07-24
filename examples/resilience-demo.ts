/**
 * Service Resilience Demo
 * Demonstrates advanced resilience patterns including circuit breakers,
 * retry policies, load balancing, and service proxies
 */

import { logger } from '@/lib/unjs-utils.js';
import { 
  LoadBalancer,
  CircuitBreakerManager,
  RetryPolicy,
  ServiceProxy,
  ServiceDiscovery,
} from '@/infrastructure/orchestration/index.js';

async function runResilienceDemo(): Promise<void> {
  logger.info('🛡️ Starting Service Resilience Patterns Demo...');

  const loadBalancer = new LoadBalancer();
  const circuitBreaker = CircuitBreakerManager.getInstance();
  const retryPolicy = RetryPolicy.getInstance();
  const serviceProxy = ServiceProxy.getInstance();
  const discovery = ServiceDiscovery.getInstance();

  try {
    // === PHASE 1: SERVICE DISCOVERY & REGISTRATION ===
    logger.info('\n🔍 PHASE 1: Service Discovery & Registration...');

    // Start health checks
    discovery.startHealthChecks(10000); // Check every 10 seconds

    // Register multiple endpoints for a service
    const userServiceEndpoints = [
      { service: 'user-service', address: '10.0.1.10', port: 8080, metadata: { region: 'us-east-1', zone: 'a' } },
      { service: 'user-service', address: '10.0.1.11', port: 8080, metadata: { region: 'us-east-1', zone: 'b' } },
      { service: 'user-service', address: '10.0.1.12', port: 8080, metadata: { region: 'us-east-1', zone: 'c' } },
    ];

    for (const endpoint of userServiceEndpoints) {
      const endpointId = discovery.registerEndpoint(endpoint);
      discovery.updateHealth(endpointId, 'healthy');
      logger.info(`Registered endpoint: ${endpoint.address}:${endpoint.port}`);
    }

    // === PHASE 2: LOAD BALANCING ===
    logger.info('\n⚖️ PHASE 2: Load Balancing Strategies...');

    // Configure different load balancing algorithms
    const algorithms = ['round-robin', 'least-connections', 'weighted', 'random'] as const;
    
    for (const algorithm of algorithms) {
      loadBalancer.configureService(`user-service-${algorithm}`, {
        algorithm,
        healthCheck: true,
        weights: algorithm === 'weighted' ? {
          'user-service-10.0.1.10-8080': 3,
          'user-service-10.0.1.11-8080': 2,
          'user-service-10.0.1.12-8080': 1,
        } : undefined,
      });

      // Simulate requests to see load balancing in action
      logger.info(`Testing ${algorithm} load balancing:`);
      for (let i = 0; i < 6; i++) {
        const endpoint = loadBalancer.selectEndpoint(`user-service-${algorithm}`);
        loadBalancer.recordRequest(`user-service-${algorithm}`, endpoint || 'unknown', true, Math.random() * 100);
        logger.info(`  Request ${i + 1} routed to: ${endpoint}`);
      }
    }

    // === PHASE 3: CIRCUIT BREAKER PATTERNS ===
    logger.info('\n🔌 PHASE 3: Circuit Breaker Resilience...');

    // Configure circuit breaker
    circuitBreaker.setGlobalConfig({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      halfOpenRetryTimeout: 10000,
    });

    // Simulate successful operations
    logger.info('Simulating successful operations:');
    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.executeWithBreaker('payment-service', async () => {
          // Simulate successful operation
          await new Promise(resolve => setTimeout(resolve, 50));
          return { success: true, transactionId: `tx_${i}` };
        });
        logger.info(`  ✅ Payment transaction ${i + 1} successful`);
      } catch (error) {
        logger.error(`  ❌ Payment transaction ${i + 1} failed`);
      }
    }

    // Simulate failures to trigger circuit breaker
    logger.info('\nSimulating failures to trigger circuit breaker:');
    for (let i = 0; i < 6; i++) {
      try {
        await circuitBreaker.executeWithBreaker('payment-service', async () => {
          // Simulate failure
          throw new Error('Payment service temporarily unavailable');
        });
      } catch (error) {
        logger.info(`  ❌ Payment failure ${i + 1}: ${(error as Error).message}`);
      }
    }

    // Show circuit breaker status
    const cbStats = circuitBreaker.getStats('payment-service');
    if (cbStats) {
      logger.info('Circuit breaker status:', {
        state: cbStats.state,
        failures: cbStats.failures,
        requests: cbStats.requests,
        failureRate: `${(cbStats.failureRate * 100).toFixed(1)}%`,
      });
    }

    // === PHASE 4: RETRY POLICIES ===
    logger.info('\n🔄 PHASE 4: Retry Policies...');

    // Exponential backoff retry
    logger.info('Testing exponential backoff retry:');
    let attempts = 0;
    try {
      const result = await retryPolicy.withExponentialBackoff(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary network error');
        }
        return { success: true, data: 'Retrieved after retries' };
      }, 'network-fetch');
      
      logger.info(`✅ Exponential backoff succeeded after ${attempts} attempts:`, result);
    } catch (error) {
      logger.error(`❌ Exponential backoff failed after ${attempts} attempts`);
    }

    // Fixed delay retry
    logger.info('Testing fixed delay retry:');
    attempts = 0;
    try {
      const result = await retryPolicy.withFixedDelay(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ECONNREFUSED');
        }
        return { success: true, data: 'Connected successfully' };
      }, 'database-connection', 1000, 3);
      
      logger.info(`✅ Fixed delay retry succeeded after ${attempts} attempts:`, result);
    } catch (error) {
      logger.error(`❌ Fixed delay retry failed after ${attempts} attempts`);
    }

    // Batch retry operations
    logger.info('Testing batch retry operations:');
    const batchOperations = [
      {
        operation: async () => ({ id: 1, status: 'processed' }),
        name: 'operation-1',
      },
      {
        operation: async () => {
          if (Math.random() < 0.5) throw new Error('Random failure');
          return { id: 2, status: 'processed' };
        },
        name: 'operation-2',
      },
      {
        operation: async () => ({ id: 3, status: 'processed' }),
        name: 'operation-3',
      },
    ];

    const batchResults = await retryPolicy.executeBatch(batchOperations, {
      concurrency: 2,
      failFast: false,
    });

    logger.info('Batch retry results:', {
      total: batchResults.length,
      successful: batchResults.filter(r => r.success).length,
      failed: batchResults.filter(r => !r.success).length,
    });

    // === PHASE 5: SERVICE PROXY ===
    logger.info('\n🎭 PHASE 5: Service Proxy with Resilience...');

    // Configure service proxy with all resilience features
    serviceProxy.setDefaultConfig({
      retries: {
        enabled: true,
        maxAttempts: 3,
        baseDelay: 500,
        backoffMultiplier: 2,
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 60, // 60% failure rate
        timeout: 30000,
      },
      loadBalancer: {
        enabled: true,
        algorithm: 'round-robin',
      },
      cache: {
        enabled: true,
        ttl: 60000, // 1 minute
        maxSize: 100,
      },
      timeout: 5000,
    });

    // Test service proxy calls
    logger.info('Testing service proxy calls:');
    
    const userProxy = serviceProxy.createProxy('user-service');
    
    // Test cacheable operation
    try {
      const userData1 = await userProxy.call('getUser', ['user123']);
      logger.info('✅ First getUser call (cache miss):', userData1);
      
      const userData2 = await userProxy.call('getUser', ['user123']);
      logger.info('✅ Second getUser call (cache hit):', userData2);
    } catch (error) {
      logger.error('❌ User service call failed:', (error as Error).message);
    }

    // Test fluent API
    logger.info('Testing fluent API:');
    try {
      const orderData = await serviceProxy.service('order-service').call('getOrder', 'order456');
      logger.info('✅ Order service call via fluent API:', orderData);
    } catch (error) {
      logger.error('❌ Order service call failed:', (error as Error).message);
    }

    // Test with session stickiness
    logger.info('Testing session-based calls:');
    try {
      const sessionService = serviceProxy.service('session-service').withSession('session789');
      const session1 = await sessionService.call('getSessionData');
      const session2 = await sessionService.call('updateSession', { lastAccess: new Date() });
      
      logger.info('✅ Session-based calls completed:', { session1, session2 });
    } catch (error) {
      logger.error('❌ Session service calls failed:', (error as Error).message);
    }

    // === PHASE 6: ADAPTIVE BEHAVIOR ===
    logger.info('\n🧠 PHASE 6: Adaptive Resilience Patterns...');

    // Simulate high load to trigger algorithm adaptation
    logger.info('Simulating high load to trigger adaptive behavior:');
    
    const highLoadService = 'high-load-service';
    loadBalancer.configureService(highLoadService, {
      algorithm: 'round-robin',
      healthCheck: true,
    });

    // Simulate many requests with some failures
    for (let i = 0; i < 50; i++) {
      const endpoint = loadBalancer.selectEndpoint(highLoadService) || 'unknown';
      const success = Math.random() > 0.15; // 15% failure rate
      const latency = success ? Math.random() * 200 : Math.random() * 2000;
      
      loadBalancer.recordRequest(highLoadService, endpoint, success, latency);
    }

    // Trigger adaptation
    loadBalancer.adaptAlgorithm(highLoadService);

    // === PHASE 7: COMPREHENSIVE REPORTING ===
    logger.info('\n📊 PHASE 7: Comprehensive Resilience Reporting...');

    // Circuit breaker report
    const cbReport = circuitBreaker.generateReport();
    logger.info('Circuit Breaker Report Generated:', {
      length: cbReport.length,
      openBreakers: circuitBreaker.getOpenCircuitBreakers().length,
    });

    // Service proxy report
    const proxyReport = serviceProxy.generateReport();
    logger.info('Service Proxy Report Generated:', {
      length: proxyReport.length,
      proxiedServices: serviceProxy.getStats().size,
    });

    // Load balancer stats
    const lbStats = loadBalancer.getAllStats();
    logger.info('Load Balancer Summary:', {
      configuredServices: lbStats.size,
      totalRequests: Array.from(lbStats.values()).reduce((sum, stats) => sum + stats.totalRequests, 0),
    });

    // Service discovery summary
    const allEndpoints = discovery.getEndpoints();
    const healthyEndpoints = allEndpoints.filter(e => e.health === 'healthy');
    logger.info('Service Discovery Summary:', {
      totalEndpoints: allEndpoints.length,
      healthyEndpoints: healthyEndpoints.length,
      healthPercentage: allEndpoints.length > 0 ? `${(healthyEndpoints.length / allEndpoints.length * 100).toFixed(1)}%` : '0%',
    });

    logger.info('✅ Service Resilience Demo completed successfully!');

    // Print final summary
    printFinalSummary(loadBalancer, circuitBreaker, retryPolicy, serviceProxy, discovery);

  } catch (error) {
    logger.error('❌ Service Resilience Demo failed', { error });
    throw error;
  } finally {
    // Cleanup
    discovery.stopHealthChecks();
  }
}

function printFinalSummary(
  loadBalancer: LoadBalancer,
  circuitBreaker: CircuitBreakerManager,
  retryPolicy: RetryPolicy,
  serviceProxy: ServiceProxy,
  discovery: ServiceDiscovery
): void {
  logger.info('\n🎯 RESILIENCE DEMO SUMMARY:');
  logger.info('  ✅ Service discovery with automatic health monitoring');
  logger.info('  ✅ Multiple load balancing algorithms with adaptive behavior');
  logger.info('  ✅ Circuit breaker patterns with failure isolation');
  logger.info('  ✅ Comprehensive retry policies with exponential backoff');
  logger.info('  ✅ Service proxy with integrated resilience features');
  logger.info('  ✅ Intelligent caching with TTL and size management');
  logger.info('  ✅ Session stickiness and traffic routing');
  logger.info('  ✅ Real-time metrics and adaptive algorithms');
  logger.info('\n🛡️ The Service Resilience system provides enterprise-grade fault tolerance!');

  // Final statistics
  const cbSummary = circuitBreaker.getHealthySummary();
  const lbStats = loadBalancer.getAllStats();
  const proxyStats = serviceProxy.getStats();
  const endpoints = discovery.getEndpoints();

  logger.info('\n📊 Final Statistics:', {
    circuitBreakers: {
      total: cbSummary.total,
      healthy: `${cbSummary.healthyPercentage.toFixed(1)}%`,
      open: cbSummary.open,
    },
    loadBalancers: {
      configured: lbStats.size,
      totalRequests: Array.from(lbStats.values()).reduce((sum, stats) => sum + stats.totalRequests, 0),
    },
    serviceProxies: {
      created: proxyStats.size,
      cacheEnabled: Array.from(proxyStats.values()).filter(stats => stats.cache?.size !== undefined).length,
    },
    serviceDiscovery: {
      totalEndpoints: endpoints.length,
      healthyEndpoints: endpoints.filter(e => e.health === 'healthy').length,
    },
  });
}

if (import.meta.main) {
  runResilienceDemo()
    .then(() => logger.info('🎉 Demo completed'))
    .catch(error => {
      logger.error('💥 Demo failed', { error });
      process.exit(1);
    });
}

export default runResilienceDemo;