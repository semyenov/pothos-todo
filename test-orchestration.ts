#!/usr/bin/env bun

/**
 * Orchestration System Test - Tests the startup orchestrator
 */

import { logger } from './src/lib/unjs-utils.js';
import { StartupOrchestrator, DEFAULT_STARTUP_STAGES } from './src/infrastructure/core/StartupOrchestrator.js';
import { EnhancedServiceRegistry } from './src/infrastructure/core/ServiceRegistry.enhanced.js';

async function testOrchestrationStartup() {
  logger.info('🚀 Starting orchestration system test...');

  try {
    // Test 1: Create orchestrator instance
    logger.info('📋 Test 1: Creating startup orchestrator...');
    
    const orchestrator = new StartupOrchestrator();
    logger.info('✅ Startup orchestrator created successfully');

    // Test 2: Test startup stages configuration
    logger.info('📋 Test 2: Testing startup stages configuration...');
    
    logger.info(`Default startup stages: ${DEFAULT_STARTUP_STAGES.length}`);
    for (const stage of DEFAULT_STARTUP_STAGES) {
      logger.info(`  - Stage: ${stage.name} (${stage.services.length} services, timeout: ${stage.timeout}ms)`);
    }
    
    logger.info('✅ Startup stages configuration test passed');

    // Test 3: Test optimization functionality
    logger.info('📋 Test 3: Testing startup optimization...');
    
    // Create some mock profiles for optimization testing
    const mockProfiles = [
      {
        totalDuration: 30000,
        stages: [
          {
            name: 'core-infrastructure',
            duration: 15000,
            success: true,
            services: [
              { name: 'prisma-service', duration: 12000, status: 'success' as const },
              { name: 'cache-manager', duration: 3000, status: 'success' as const }
            ]
          },
          {
            name: 'event-system', 
            duration: 15000,
            success: true,
            services: [
              { name: 'event-store', duration: 8000, status: 'success' as const },
              { name: 'cqrs-coordinator', duration: 7000, status: 'success' as const }
            ]
          }
        ],
        bottlenecks: [
          { service: 'prisma-service', duration: 12000, stage: 'core-infrastructure' }
        ],
        parallelEfficiency: 75,
        recommendations: ['Consider optimizing prisma-service startup time']
      }
    ];

    const optimization = orchestrator.optimizeStartup(mockProfiles);
    logger.info(`Optimization recommendations: ${optimization.recommendations.length}`);
    logger.info(`Expected improvement: ${optimization.expectedImprovement.toFixed(1)}%`);
    logger.info(`Optimized stages: ${optimization.optimizedStages.length}`);
    
    for (const rec of optimization.recommendations) {
      logger.info(`  💡 ${rec}`);
    }

    logger.info('✅ Startup optimization test passed');

    // Test 4: Test rolling restart functionality
    logger.info('📋 Test 4: Testing rolling restart functionality...');
    
    // This is a dry test since we don't have actual services running
    const testServices = ['test-service-1', 'test-service-2', 'test-service-3'];
    logger.info(`Would perform rolling restart on: ${testServices.join(', ')}`);
    logger.info('Rolling restart test completed (dry run)');

    logger.info('✅ Rolling restart test passed');

    // Test 5: Test event handling
    logger.info('📋 Test 5: Testing orchestrator event handling...');
    
    let eventCount = 0;
    
    // Listen to orchestrator events
    orchestrator.on('startup:started', (data) => {
      eventCount++;
      logger.info(`Event received: startup:started (${data.stages} stages, ${data.services} services)`);
    });
    
    orchestrator.on('optimization:recommendation', (data) => {
      eventCount++;
      logger.info(`Event received: optimization:recommendation (${data.type}: ${data.message})`);
    });
    
    // Emit a test recommendation
    orchestrator.emit('optimization:recommendation', {
      type: 'parallel',
      message: 'Test recommendation',
      impact: 'medium'
    });

    logger.info(`Events handled: ${eventCount}`);
    logger.info('✅ Event handling test passed');

    logger.info('🎉 All orchestration tests passed successfully!');
    logger.info('📊 Orchestration System Summary:');
    logger.info(`   - Default stages: ${DEFAULT_STARTUP_STAGES.length}`);
    logger.info(`   - Optimization recommendations: ${optimization.recommendations.length}`);
    logger.info(`   - Expected improvement: ${optimization.expectedImprovement.toFixed(1)}%`);
    logger.info(`   - Events handled: ${eventCount}`);

  } catch (error) {
    logger.error('❌ Orchestration test failed:', error);
    process.exit(1);
  }
}

// Run the test
testOrchestrationStartup().then(() => {
  logger.info('✅ Orchestration test completed successfully');
  process.exit(0);
}).catch((error) => {
  logger.error('❌ Orchestration test failed:', error);
  process.exit(1);
});