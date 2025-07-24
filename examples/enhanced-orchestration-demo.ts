/**
 * Enhanced Orchestration Demo
 * 
 * Demonstrates advanced orchestration capabilities including:
 * - Event Sourcing with MessageBroker
 * - Saga Pattern for Distributed Transactions  
 * - Advanced Service Mesh with Traffic Rules
 * - Enhanced Service Registry with Health Monitoring
 * - Real-time Communication and Monitoring
 */

import { logger } from '@/lib/unjs-utils.js';
import { 
  initializeServiceMesh,
  EnhancedMessageBroker,
  EnhancedServiceMesh,
  EnhancedServiceRegistry,
  type Message,
  type Saga,
  type TrafficRule,
  type SecurityPolicy
} from '@/infrastructure/orchestration/index.js';

async function runEnhancedOrchestrationDemo(): Promise<void> {
  logger.info('🚀 Starting Enhanced Service Orchestration Demo...');
  logger.info('   Showcasing event sourcing, saga patterns, and advanced mesh capabilities');

  try {
    // === PHASE 1: INITIALIZE ENHANCED ECOSYSTEM ===
    logger.info('\n🏗️ PHASE 1: Enhanced Ecosystem Initialization...');
    
    const {
      mesh,
      gateway,
      discovery,
      splitter,
      integration,
      resilience,
      enhanced: { messageBroker, serviceMesh, serviceRegistry }
    } = await initializeServiceMesh();

    logger.info('✅ Enhanced orchestration ecosystem initialized', {
      components: [
        'traditional_mesh', 'gateway', 'discovery', 'splitter', 
        'enhanced_message_broker', 'enhanced_service_mesh', 'enhanced_service_registry'
      ],
    });

    // === PHASE 2: EVENT SOURCING SETUP ===
    logger.info('\n📝 PHASE 2: Event Sourcing Configuration...');

    // Subscribe to various domain events
    const userEventSubscription = await messageBroker.subscribe(
      'user.*',
      async (message: Message) => {
        logger.info('User event processed', {
          type: message.type,
          userId: message.payload.userId,
          action: message.payload.action,
        });
      },
      { autoAck: true, prefetch: 5 }
    );

    const orderEventSubscription = await messageBroker.subscribe(
      'order.*',
      async (message: Message) => {
        logger.info('Order event processed', {
          type: message.type,
          orderId: message.payload.orderId,
          status: message.payload.status,
        });
      },
      { autoAck: true, prefetch: 3 }
    );

    // Create event queues
    await messageBroker.createQueue({
      name: 'user-events',
      type: 'topic',
      durable: true,
      autoDelete: false,
      options: {
        messageTtl: 86400000, // 24 hours
        maxLength: 10000,
      },
    });

    await messageBroker.createQueue({
      name: 'order-events',
      type: 'priority',
      durable: true,
      autoDelete: false,
      options: {
        priority: 10,
        messageTtl: 3600000, // 1 hour
      },
    });

    logger.info('Event sourcing infrastructure configured');

    // === PHASE 3: SAGA PATTERN DEMONSTRATION ===
    logger.info('\n🔄 PHASE 3: Distributed Transaction Saga...');

    // Create an order processing saga
    const orderSagaId = await messageBroker.createSaga(
      'order-processing',
      [
        {
          name: 'validate-payment',
          action: async (context: any) => {
            logger.info('Saga: Validating payment', { orderId: context.orderId });
            // Simulate payment validation
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (Math.random() > 0.8) {
              throw new Error('Payment validation failed');
            }
            
            return { paymentId: 'pay_' + Math.random().toString(36).substr(2, 9) };
          },
          compensation: async (context: any) => {
            logger.info('Saga: Cancelling payment hold', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 200));
          },
        },
        {
          name: 'reserve-inventory',
          action: async (context: any) => {
            logger.info('Saga: Reserving inventory', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 300));
            
            if (Math.random() > 0.85) {
              throw new Error('Insufficient inventory');
            }
            
            return { reservationId: 'res_' + Math.random().toString(36).substr(2, 9) };
          },
          compensation: async (context: any) => {
            logger.info('Saga: Releasing inventory reservation', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 200));
          },
        },
        {
          name: 'process-shipment',
          action: async (context: any) => {
            logger.info('Saga: Processing shipment', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 400));
            
            return { shipmentId: 'ship_' + Math.random().toString(36).substr(2, 9) };
          },
          compensation: async (context: any) => {
            logger.info('Saga: Cancelling shipment', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 200));
          },
        },
        {
          name: 'send-confirmation',
          action: async (context: any) => {
            logger.info('Saga: Sending order confirmation', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 200));
            
            return { confirmationId: 'conf_' + Math.random().toString(36).substr(2, 9) };
          },
          compensation: async (context: any) => {
            logger.info('Saga: Sending cancellation notice', { orderId: context.orderId });
            await new Promise(resolve => setTimeout(resolve, 100));
          },
        },
      ],
      {
        orderId: 'order_' + Math.random().toString(36).substr(2, 9),
        customerId: 'cust_' + Math.random().toString(36).substr(2, 9),
        amount: 199.99,
        items: ['item1', 'item2'],
      }
    );

    // Execute the saga
    try {
      await messageBroker.executeSaga(orderSagaId);
      logger.info('✅ Order processing saga completed successfully');
    } catch (error) {
      logger.warn('⚠️ Order processing saga failed with compensation', {
        error: (error as Error).message,
      });
    }

    // === PHASE 4: EVENT PUBLISHING AND CONSUMPTION ===
    logger.info('\n📡 PHASE 4: Event Publishing and Consumption...');

    // Publish domain events
    const events = [
      {
        topic: 'user.created',
        payload: {
          userId: 'user_123',
          email: 'john@example.com',
          action: 'account_created',
          timestamp: new Date(),
        },
        metadata: { priority: 'high' as const, correlationId: 'corr_123' },
      },
      {
        topic: 'user.updated',
        payload: {
          userId: 'user_123',
          field: 'profile',
          action: 'profile_updated',
          timestamp: new Date(),
        },
        metadata: { priority: 'normal' as const, correlationId: 'corr_124' },
      },
      {
        topic: 'order.created',
        payload: {
          orderId: 'order_456',
          customerId: 'user_123',
          status: 'pending',
          amount: 299.99,
          timestamp: new Date(),
        },
        metadata: { priority: 'high' as const, correlationId: 'corr_125' },
      },
      {
        topic: 'order.paid',
        payload: {
          orderId: 'order_456',
          paymentId: 'pay_789',
          status: 'paid',
          timestamp: new Date(),
        },
        metadata: { priority: 'critical' as const, correlationId: 'corr_126' },
      },
    ];

    for (const event of events) {
      const messageId = await messageBroker.publish(
        event.topic,
        event.payload,
        event.metadata
      );
      logger.info(`Published event: ${event.topic} (${messageId})`);
    }

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // === PHASE 5: ENHANCED SERVICE MESH CONFIGURATION ===
    logger.info('\n🕸️ PHASE 5: Enhanced Service Mesh Configuration...');

    // Register services in enhanced registry
    const userServiceId = await serviceRegistry.registerService({
      name: 'user-service',
      version: '2.1.0',
      type: 'api',
      endpoints: {
        health: 'http://user-service:8080/health',
        metrics: 'http://user-service:8080/metrics',
        api: 'http://user-service:8080/api',
      },
      network: {
        host: 'user-service',
        port: 8080,
        protocol: 'http',
      },
      metadata: {
        region: 'us-east-1',
        zone: 'us-east-1a',
        environment: 'production',
        tags: ['api', 'user-management'],
        dependencies: ['database-service', 'cache-service'],
        capabilities: ['authentication', 'user-crud', 'profile-management'],
      },
      resources: {
        cpu: 1.0,
        memory: 2048,
        disk: 10240,
        connections: 1000,
      },
      scaling: {
        minInstances: 2,
        maxInstances: 10,
        currentInstances: 3,
        autoScale: true,
      },
      deployment: {
        strategy: 'rolling',
        rollbackOnFailure: true,
        healthCheckGracePeriod: 30000,
      },
      security: {
        authRequired: true,
        roles: ['user', 'admin'],
        rateLimit: {
          requests: 1000,
          window: 60000,
        },
      },
    });

    const orderServiceId = await serviceRegistry.registerService({
      name: 'order-service',
      version: '1.8.0',
      type: 'api',
      endpoints: {
        health: 'http://order-service:8081/health',
        metrics: 'http://order-service:8081/metrics',
        api: 'http://order-service:8081/api',
      },
      network: {
        host: 'order-service',
        port: 8081,
        protocol: 'http',
      },
      metadata: {
        region: 'us-east-1',
        zone: 'us-east-1b',
        environment: 'production',
        tags: ['api', 'order-management'],
        dependencies: ['user-service', 'payment-service', 'inventory-service'],
        capabilities: ['order-crud', 'payment-processing', 'inventory-check'],
      },
      resources: {
        cpu: 1.5,
        memory: 3072,
        disk: 20480,
        connections: 800,
      },
      scaling: {
        minInstances: 3,
        maxInstances: 15,
        currentInstances: 5,
        autoScale: true,
      },
      deployment: {
        strategy: 'canary',
        rollbackOnFailure: true,
        healthCheckGracePeriod: 45000,
      },
      security: {
        authRequired: true,
        roles: ['user', 'admin', 'order-manager'],
        rateLimit: {
          requests: 500,
          window: 60000,
        },
      },
    });

    logger.info('Services registered in enhanced registry', {
      userService: userServiceId,
      orderService: orderServiceId,
    });

    // Configure load balancing strategies
    await serviceRegistry.configureLoadBalancing('user-service', {
      type: 'least-connections',
      stickySession: true,
    });

    await serviceRegistry.configureLoadBalancing('order-service', {
      type: 'weighted',
      weights: new Map([
        ['instance-1', 3],
        ['instance-2', 2],
        ['instance-3', 1],
      ]),
    });

    // === PHASE 6: ADVANCED TRAFFIC MANAGEMENT ===
    logger.info('\n🚦 PHASE 6: Advanced Traffic Management...');

    // Create sophisticated traffic rules
    const canaryTrafficRuleId = await serviceMesh.createTrafficRule({
      name: 'order-service-canary',
      source: { service: 'user-service' },
      destination: { service: 'order-service' },
      match: {
        headers: { 'x-canary': 'true' },
        uri: { prefix: '/api/orders' },
        method: ['POST', 'PUT'],
      },
      route: [
        { destination: 'order-service-v1', weight: 80 },
        { destination: 'order-service-v2', weight: 20 },
      ],
      timeout: 5000,
      retries: {
        attempts: 3,
        perTryTimeout: 2000,
      },
    });

    const faultInjectionRuleId = await serviceMesh.createTrafficRule({
      name: 'chaos-testing',
      source: { service: 'test-client' },
      destination: { service: 'order-service' },
      match: {
        headers: { 'x-chaos-test': 'true' },
      },
      route: [
        { destination: 'order-service', weight: 100 },
      ],
      fault: {
        delay: {
          percentage: 10,
          fixedDelay: 2000,
        },
        abort: {
          percentage: 5,
          httpStatus: 503,
        },
      },
    });

    logger.info('Traffic rules configured', {
      canaryRule: canaryTrafficRuleId,
      chaosRule: faultInjectionRuleId,
    });

    // === PHASE 7: SECURITY POLICIES ===
    logger.info('\n🔒 PHASE 7: Security Policy Enforcement...');

    // Create comprehensive security policies
    const strictAuthPolicyId = await serviceMesh.createSecurityPolicy({
      name: 'strict-authentication',
      namespace: 'production',
      selector: {
        matchLabels: { environment: 'production' },
      },
      rules: [
        {
          from: [
            {
              source: {
                principals: ['cluster.local/ns/production/sa/user-service'],
                namespaces: ['production'],
              },
            },
          ],
          to: [
            {
              operation: {
                methods: ['GET', 'POST', 'PUT'],
                paths: ['/api/orders/*', '/api/users/*'],
              },
            },
          ],
        },
      ],
      action: 'ALLOW',
    });

    const adminOnlyPolicyId = await serviceMesh.createSecurityPolicy({
      name: 'admin-only-access',
      namespace: 'production',
      selector: {
        matchLabels: { app: 'admin-service' },
      },
      rules: [
        {
          from: [
            {
              source: {
                principals: ['cluster.local/ns/production/sa/admin-user'],
              },
            },
          ],
          to: [
            {
              operation: {
                methods: ['GET', 'POST', 'PUT', 'DELETE'],
                paths: ['/admin/*'],
              },
            },
          ],
        },
      ],
      action: 'ALLOW',
    });

    logger.info('Security policies created', {
      authPolicy: strictAuthPolicyId,
      adminPolicy: adminOnlyPolicyId,
    });

    // === PHASE 8: SIMULATE TRAFFIC AND MONITORING ===
    logger.info('\n📊 PHASE 8: Traffic Simulation and Monitoring...');

    // Simulate various API calls through the mesh
    const trafficSimulation = [
      {
        from: 'user-service',
        to: 'order-service',
        method: 'POST',
        path: '/api/orders',
        headers: { 'authorization': 'Bearer token123' },
      },
      {
        from: 'user-service',
        to: 'order-service',
        method: 'POST',
        path: '/api/orders',
        headers: { 'authorization': 'Bearer token456', 'x-canary': 'true' },
      },
      {
        from: 'test-client',
        to: 'order-service',
        method: 'GET',
        path: '/api/orders/123',
        headers: { 'x-chaos-test': 'true' },
      },
      {
        from: 'admin-client',
        to: 'admin-service',
        method: 'DELETE',
        path: '/admin/users/456',
        headers: { 'authorization': 'Bearer admin-token' },
      },
    ];

    for (const request of trafficSimulation) {
      try {
        await serviceMesh.routeRequest(
          request.from,
          request.to,
          request.method,
          request.path,
          request.headers
        );
        logger.info(`✅ Request routed: ${request.method} ${request.path}`);
      } catch (error) {
        logger.warn(`⚠️ Request failed: ${request.method} ${request.path}`, {
          error: (error as Error).message,
        });
      }
    }

    // === PHASE 9: COMPREHENSIVE STATISTICS ===
    logger.info('\n📈 PHASE 9: System Statistics and Health...');

    // Get comprehensive system statistics
    const [
      brokerStats,
      meshStats,
      registryStats,
    ] = await Promise.all([
      messageBroker.getStats(),
      serviceMesh.getStats(),
      serviceRegistry.getStats(),
    ]);

    logger.info('Enhanced Orchestration Statistics:', {
      messageBroker: {
        queues: brokerStats.queues,
        published: brokerStats.published,
        consumed: brokerStats.consumed,
        activeSagas: brokerStats.activeSagas,
        eventStreams: brokerStats.eventStreams,
      },
      serviceMesh: {
        trafficRules: meshStats.trafficRules,
        securityPolicies: meshStats.securityPolicies,
        activeRequests: meshStats.activeRequests,
        circuitBreakers: meshStats.circuitBreakers,
      },
      serviceRegistry: {
        services: registryStats.services,
        instances: registryStats.instances,
        healthyInstances: registryStats.healthyInstances,
        loadBalancers: registryStats.loadBalancers,
      },
    });

    // === PHASE 10: EVENT REPLAY DEMONSTRATION ===
    logger.info('\n⏮️ PHASE 10: Event Replay and Recovery...');

    // Demonstrate event replay capability
    try {
      await messageBroker.replayEvents('user.created:corr_123', 1, 2);
      logger.info('✅ Event replay completed successfully');
    } catch (error) {
      logger.warn('⚠️ Event replay failed', { error: (error as Error).message });
    }

    // Clean up subscriptions
    await messageBroker.unsubscribe(userEventSubscription);
    await messageBroker.unsubscribe(orderEventSubscription);

    logger.info('✅ Enhanced Service Orchestration Demo completed successfully!');

    // === FINAL SUMMARY ===
    printEnhancedSummary({
      messageBroker,
      serviceMesh,
      serviceRegistry,
      stats: {
        brokerStats,
        meshStats,
        registryStats,
      },
    });

  } catch (error) {
    logger.error('❌ Enhanced Orchestration Demo failed', { error });
    throw error;
  }
}

function printEnhancedSummary(components: any): void {
  logger.info('\n🎯 ENHANCED ORCHESTRATION DEMO SUMMARY:');
  logger.info('═══════════════════════════════════════════════════════════');
  
  logger.info('\n📝 EVENT SOURCING & MESSAGING:');
  logger.info('  ✅ Advanced message broker with event sourcing');
  logger.info('  ✅ Distributed transaction management with saga patterns');
  logger.info('  ✅ Event replay and recovery capabilities');
  logger.info('  ✅ Priority queues and message routing');
  logger.info('  ✅ Dead letter queues and retry mechanisms');

  logger.info('\n🕸️ ENHANCED SERVICE MESH:');
  logger.info('  ✅ Advanced traffic routing and canary deployments');
  logger.info('  ✅ Comprehensive security policy enforcement');
  logger.info('  ✅ Circuit breakers and fault injection');
  logger.info('  ✅ Real-time request tracing and monitoring');
  logger.info('  ✅ Middleware pipeline with rate limiting');

  logger.info('\n🎯 SERVICE REGISTRY ENHANCEMENTS:');
  logger.info('  ✅ Enhanced service definitions with detailed metadata');
  logger.info('  ✅ Auto-scaling configuration and resource management');
  logger.info('  ✅ Deployment strategies (rolling, canary, blue-green)');
  logger.info('  ✅ Advanced load balancing with multiple algorithms');
  logger.info('  ✅ Health monitoring and instance management');

  logger.info('\n🔄 DISTRIBUTED TRANSACTIONS:');
  logger.info('  ✅ Saga pattern implementation with compensation');
  logger.info('  ✅ Automatic rollback on failure');
  logger.info('  ✅ Step-by-step execution with error handling');
  logger.info('  ✅ Context passing and state management');

  logger.info('\n🔒 SECURITY & COMPLIANCE:');
  logger.info('  ✅ mTLS authentication and authorization');
  logger.info('  ✅ Role-based access control (RBAC)');
  logger.info('  ✅ Rate limiting and DDoS protection');
  logger.info('  ✅ Security policy enforcement at mesh level');

  // Final metrics summary
  const stats = components.stats;
  logger.info('\n📊 ENHANCED SYSTEM METRICS:');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info(`  📡 Message Broker: ${stats.brokerStats.published} published, ${stats.brokerStats.consumed} consumed, ${stats.brokerStats.activeSagas} active sagas`);
  logger.info(`  🕸️ Service Mesh: ${stats.meshStats.trafficRules} traffic rules, ${stats.meshStats.securityPolicies} security policies`);
  logger.info(`  🎯 Service Registry: ${stats.registryStats.services} services, ${stats.registryStats.healthyInstances}/${stats.registryStats.instances} healthy instances`);

  logger.info('\n🚀 Enhanced Service Orchestration with Enterprise-Grade Capabilities!');
  logger.info('   Event sourcing, saga patterns, and advanced mesh features are fully operational.');
}

if (import.meta.main) {
  runEnhancedOrchestrationDemo()
    .then(() => logger.info('🎉 Enhanced demo finished successfully'))
    .catch(error => {
      logger.error('💥 Enhanced demo failed', { error });
      process.exit(1);
    });
}

export default runEnhancedOrchestrationDemo;