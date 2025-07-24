/**
 * Service Mesh Integration Demo
 * Demonstrates advanced traffic management, security policies, and observability
 */

import { logger } from '@/lib/unjs-utils.js';
import { ServiceMeshIntegration } from '@/infrastructure/orchestration/ServiceMeshIntegration.js';
import { MeshGateway } from '@/infrastructure/orchestration/MeshGateway.js';
import { ServiceDiscovery } from '@/infrastructure/orchestration/ServiceDiscovery.js';
import { TrafficSplitter } from '@/infrastructure/orchestration/TrafficSplitter.js';

async function runServiceMeshDemo(): Promise<void> {
  logger.info('🕸️ Starting Service Mesh Integration Demo...');

  const mesh = ServiceMeshIntegration.getInstance();
  const gateway = MeshGateway.getInstance();
  const discovery = ServiceDiscovery.getInstance();
  const splitter = TrafficSplitter.getInstance();

  try {
    // Initialize mesh
    await mesh.initialize();

    // Register services
    const userService = await mesh.registerService({
      name: 'user-service',
      namespace: 'production',
      endpoints: [{ protocol: 'http', port: 8080, secure: true }],
      metadata: { capabilities: ['user-management'], dependencies: ['database'] }
    });

    const orderService = await mesh.registerService({
      name: 'order-service',
      namespace: 'production',
      endpoints: [{ protocol: 'http', port: 8081, secure: true }],
      metadata: { capabilities: ['order-processing'], dependencies: ['user-service', 'payment-service'] }
    });

    // Configure gateway routes
    gateway.addRoute({
      id: 'user-api',
      path: '/api/users/*',
      service: 'user-service',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      middleware: ['auth', 'logging'],
      rateLimit: { requests: 100, window: 60000 },
      auth: { required: true, schemes: ['Bearer'] }
    });

    // Set up traffic splitting for canary deployment
    const splitId = splitter.createSplit({
      service: 'user-service',
      splits: [
        { version: 'v1', weight: 90 },
        { version: 'v2', weight: 10, headers: { 'x-canary': 'true' } }
      ]
    });

    // Apply security policies
    await mesh.applySecurityPolicy({
      id: 'production-security',
      name: 'Production Security Policy',
      namespace: 'production',
      rules: [{
        from: { namespaces: ['production'] },
        to: { operations: [{ methods: ['GET', 'POST'], paths: ['/api/*'] }] },
        action: 'ALLOW'
      }],
      mtls: { mode: 'STRICT' }
    });

    // Apply traffic rules
    await mesh.applyTrafficRule({
      id: 'user-service-routing',
      name: 'User Service Routing',
      source: { services: ['order-service'] },
      destination: { service: 'user-service' },
      routing: {
        timeout: 5000,
        retries: { attempts: 3, perTryTimeout: 2000, retryOn: ['5xx', 'reset'] },
        circuitBreaker: {
          maxConnections: 100,
          maxPendingRequests: 10,
          maxRetries: 3,
          consecutiveErrors: 5
        }
      }
    });

    // Start canary deployment
    const canaryId = await mesh.startCanaryDeployment({
      service: 'user-service',
      newVersion: 'v2.1.0',
      percentage: 10,
      success_criteria: { successRate: 99, maxLatency: 200, duration: 30000 }
    });

    // Simulate traffic
    await simulateTraffic(gateway, splitter);

    // Get metrics and status
    const metrics = await mesh.getMetrics();
    const security = mesh.getSecurityStatus();
    const topology = mesh.getTrafficTopology();

    logger.info('📊 Mesh Metrics:', {
      totalServices: metrics.mesh.totalServices,
      healthyServices: metrics.mesh.healthyServices,
      mtlsPercentage: `${metrics.mesh.mtlsPercentage.toFixed(1)}%`,
      averageLatency: `${metrics.mesh.averageLatency.toFixed(0)}ms`
    });

    logger.info('🔒 Security Status:', {
      mtlsEnabled: security.mtlsEnabled,
      compliance: `${security.compliance.score.toFixed(1)}%`,
      expiring: security.certificateExpiry.filter(c => c.daysRemaining < 30).length
    });

    // Generate configurations for external mesh systems
    const istioConfig = mesh.generateMeshConfig('istio');
    logger.info('🔧 Generated Istio configuration', { size: istioConfig.length });

    logger.info('✅ Service Mesh Demo completed successfully');

  } catch (error) {
    logger.error('❌ Service Mesh Demo failed', { error });
    throw error;
  } finally {
    await mesh.shutdown();
  }
}

async function simulateTraffic(gateway: MeshGateway, splitter: TrafficSplitter): Promise<void> {
  logger.info('🚦 Simulating mesh traffic...');

  const requests = [
    { path: '/api/users/123', method: 'GET', headers: { 'authorization': 'Bearer token123' } },
    { path: '/api/users', method: 'POST', headers: { 'authorization': 'Bearer token456', 'x-canary': 'true' } },
    { path: '/api/users/456', method: 'PUT', headers: { 'authorization': 'Bearer token789' } }
  ];

  for (let i = 0; i < 50; i++) {
    const request = requests[i % requests.length];
    
    // Route through gateway
    const routeResult = await gateway.routeRequest(request.path, request.method, request.headers);
    
    if (routeResult.allowed) {
      // Apply traffic splitting
      const version = splitter.routeRequest('user-service', request);
      logger.debug(`Request routed: ${request.path} -> ${routeResult.service}:${version}`);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const splitMetrics = splitter.getSplitMetrics('user-service');
  if (splitMetrics) {
    logger.info('📊 Traffic Split Results:', {
      totalRequests: splitMetrics.totalRequests,
      distribution: splitMetrics.splitCounts
    });
  }
}

if (import.meta.main) {
  runServiceMeshDemo()
    .then(() => logger.info('🎉 Demo completed'))
    .catch(error => {
      logger.error('💥 Demo failed', { error });
      process.exit(1);
    });
}

export default runServiceMeshDemo;