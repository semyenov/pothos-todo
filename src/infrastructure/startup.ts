import { ServiceRegistry } from './core/ServiceRegistry.js';
import { logger } from '@/lib/unjs-utils.js';
import { PrismaClient } from '@prisma/client';

// Import all services
import { PrismaService } from './database/PrismaService.new.js';
import { CacheManager } from './cache/CacheManager.new.js';
import { ChaosEngineeringSystem } from './chaos/ChaosEngineering.new.js';
import { ServiceRegistry as MicroserviceRegistry } from './microservices/ServiceRegistry.new.js';
import { ServiceMesh } from './microservices/ServiceMesh.new.js';
import { MessageBroker } from './microservices/MessageBroker.new.js';
import { CQRSCoordinator } from './cqrs/CQRSCoordinator.new.js';
import { ReadModelManager } from './cqrs/ReadModelManager.new.js';
import { ServiceDashboard } from './monitoring/ServiceDashboard.js';

// Import event stores and other dependencies
import { EventStore } from './events/EventStore.js';

/**
 * Initialize all infrastructure services with the new BaseService architecture
 * This demonstrates the proper startup sequence with dependency management
 */
export async function initializeInfrastructure(): Promise<void> {
  logger.info('🚀 Initializing infrastructure services...');

  try {
    // 1. Initialize core services first (no dependencies)
    logger.info('Initializing core services...');
    
    const prismaService = await PrismaService.getInstance();
    ServiceRegistry.register(prismaService);
    
    const cacheManager = await CacheManager.getInstance();
    ServiceRegistry.register(cacheManager);

    // 2. Initialize microservice infrastructure
    logger.info('Initializing microservice infrastructure...');
    
    const serviceRegistry = await MicroserviceRegistry.getInstance();
    ServiceRegistry.register(serviceRegistry);
    
    const messageBroker = await MessageBroker.getInstance();
    ServiceRegistry.register(messageBroker);
    
    const serviceMesh = await ServiceMesh.getInstance();
    ServiceRegistry.register(serviceMesh);

    // 3. Initialize CQRS/Event Sourcing (depends on Prisma and MessageBroker)
    logger.info('Initializing CQRS infrastructure...');
    
    const prismaClient = prismaService.getClient();
    const eventStore = EventStore.getInstance(prismaClient);
    
    const cqrsCoordinator = await CQRSCoordinator.getInstance(prismaClient, eventStore);
    ServiceRegistry.register(cqrsCoordinator);
    
    const readModelManager = await ReadModelManager.getInstance(prismaClient);
    ServiceRegistry.register(readModelManager);

    // 4. Initialize monitoring and chaos engineering
    logger.info('Initializing monitoring and chaos engineering...');
    
    const dashboard = ServiceDashboard.getInstance();
    ServiceRegistry.register(dashboard);
    
    const chaosEngineering = await ChaosEngineeringSystem.getInstance();
    ServiceRegistry.register(chaosEngineering);

    // 5. Check all dependencies are satisfied
    logger.info('Verifying service dependencies...');
    
    const services = ServiceRegistry.getAll();
    for (const [name, service] of services) {
      const deps = ServiceRegistry.checkDependencies(name);
      if (!deps.satisfied) {
        throw new Error(`Service ${name} has unsatisfied dependencies: ${deps.missing.join(', ')}`);
      }
    }

    // 6. Start all services in dependency order
    logger.info('Starting all services...');
    await ServiceRegistry.startAll();

    // 7. Verify system health
    const health = await ServiceRegistry.getSystemHealth();
    if (!health.healthy) {
      const unhealthy = Array.from(health.services.entries())
        .filter(([_, status]) => status.health !== 'healthy')
        .map(([name]) => name);
      
      logger.warn(`System started with unhealthy services: ${unhealthy.join(', ')}`);
    } else {
      logger.info('✅ All services started successfully and are healthy!');
    }

    // 8. Setup graceful shutdown
    setupGracefulShutdown();

    // 9. Log startup summary
    logStartupSummary();

  } catch (error) {
    logger.error('❌ Failed to initialize infrastructure', { error });
    
    // Attempt to stop any started services
    try {
      await ServiceRegistry.stopAll();
    } catch (stopError) {
      logger.error('Failed to stop services during error recovery', { stopError });
    }
    
    throw error;
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`\n📤 Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Generate final report
      const dashboard = ServiceRegistry.get<ServiceDashboard>('service-dashboard');
      if (dashboard) {
        const report = await dashboard.generateReport();
        logger.info('Final service report:\n' + report);
      }
      
      // Stop all services
      await ServiceRegistry.stopAll();
      
      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown', { error });
      process.exit(1);
    }
  };

  // Handle different shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGUSR2', () => shutdown('SIGUSR2'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
    shutdown('unhandledRejection');
  });
}

/**
 * Log startup summary
 */
function logStartupSummary(): void {
  const services = ServiceRegistry.getAll();
  const graph = ServiceRegistry.getDependencyGraph();
  
  logger.info('=== Infrastructure Startup Summary ===');
  logger.info(`Total services: ${services.size}`);
  
  // Log service details
  const serviceList: string[] = [];
  for (const [name, service] of services) {
    const deps = graph.get(name) || [];
    const depStr = deps.length > 0 ? ` (deps: ${deps.join(', ')})` : '';
    serviceList.push(`  - ${name} v${service.metadata.version}${depStr}`);
  }
  logger.info('Services:\n' + serviceList.join('\n'));
  
  // Log configuration source
  logger.info('\nConfiguration loaded from:');
  logger.info(`  - Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`  - Config files: config/*.config.ts`);
  logger.info(`  - Environment variables: *_SERVICE_* prefixes`);
  
  // Log key features
  logger.info('\nFeatures enabled:');
  logger.info('  ✓ Automatic configuration management');
  logger.info('  ✓ Type-safe event system');
  logger.info('  ✓ Health monitoring');
  logger.info('  ✓ Metrics collection');
  logger.info('  ✓ Circuit breakers and retries');
  logger.info('  ✓ Hot reload support');
  logger.info('  ✓ Graceful shutdown');
  
  logger.info('\n🎉 Infrastructure ready for use!');
}

/**
 * Example: Initialize infrastructure and demonstrate usage
 */
if (import.meta.main) {
  initializeInfrastructure()
    .then(async () => {
      logger.info('\n📊 Example: Accessing services...');
      
      // Example: Use cache service
      const cache = ServiceRegistry.get<CacheManager>('cache-manager');
      if (cache) {
        await cache.set('example:key', { data: 'Hello, BaseService!' }, { ttl: 60 });
        const value = await cache.get('example:key');
        logger.info('Cache example:', { value });
      }
      
      // Example: Check system health
      const health = await ServiceRegistry.getSystemHealth();
      logger.info('System health:', {
        healthy: health.healthy,
        services: health.services.size,
      });
      
      // Example: View dashboard data
      const dashboard = ServiceRegistry.get<ServiceDashboard>('service-dashboard');
      if (dashboard) {
        const data = await dashboard.getDashboardData();
        logger.info('Dashboard summary:', {
          totalServices: data.systemHealth.totalServices,
          healthyServices: data.systemHealth.healthyServices,
          alerts: data.alerts.length,
        });
      }
    })
    .catch((error) => {
      logger.error('Failed to initialize infrastructure', { error });
      process.exit(1);
    });
}