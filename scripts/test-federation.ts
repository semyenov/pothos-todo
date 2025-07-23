#!/usr/bin/env bun

import { execSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { logger } from '../src/lib/unjs-utils.js';

/**
 * Test Federation Setup
 * 
 * This script starts all subgraphs and the development gateway
 * to test the federation setup without Hive credentials.
 */

async function checkHealth(url: string, name: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      logger.success(`✅ ${name} is healthy`);
      return true;
    }
  } catch (error) {
    // Service not ready yet
  }
  return false;
}

async function waitForService(url: string, name: string, maxRetries = 30): Promise<void> {
  logger.info(`Waiting for ${name} to be ready...`);
  
  for (let i = 0; i < maxRetries; i++) {
    if (await checkHealth(url, name)) {
      return;
    }
    await setTimeout(1000);
  }
  
  throw new Error(`${name} failed to start after ${maxRetries} seconds`);
}

async function testFederation() {
  logger.info('🚀 Starting Federation Test Environment');
  
  // Kill any existing processes on the ports
  logger.info('Cleaning up existing processes...');
  try {
    execSync('lsof -ti:4000 -ti:4001 -ti:4002 -ti:4003 | xargs kill -9', { stdio: 'ignore' });
  } catch {
    // Ignore errors if no processes are running
  }
  
  // Start all services in the background
  logger.info('Starting subgraphs and gateway...');
  
  const processes: any[] = [];
  
  // Start user subgraph
  const userProcess = Bun.spawn(['bun', 'run', 'subgraph:user'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, USER_SUBGRAPH_PORT: '4001' },
  });
  processes.push(userProcess);
  
  // Start todo subgraph
  const todoProcess = Bun.spawn(['bun', 'run', 'subgraph:todo'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, TODO_SUBGRAPH_PORT: '4002' },
  });
  processes.push(todoProcess);
  
  // Start AI subgraph
  const aiProcess = Bun.spawn(['bun', 'run', 'subgraph:ai'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, AI_SUBGRAPH_PORT: '4003' },
  });
  processes.push(aiProcess);
  
  // Wait for subgraphs to be ready
  await setTimeout(2000);
  
  try {
    await waitForService('http://localhost:4001/graphql', 'User Subgraph');
    await waitForService('http://localhost:4002/graphql', 'Todo Subgraph');
    await waitForService('http://localhost:4003/graphql', 'AI Subgraph');
    
    // Start the gateway
    logger.info('Starting development gateway...');
    const gatewayProcess = Bun.spawn(['bun', 'run', 'gateway:dev'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, GATEWAY_PORT: '4000' },
    });
    processes.push(gatewayProcess);
    
    await setTimeout(2000);
    await waitForService('http://localhost:4000/graphql', 'Development Gateway');
    
    logger.success('🎉 Federation is up and running!');
    logger.info('\nYou can now:');
    logger.info('  - Access the gateway at http://localhost:4000/graphql');
    logger.info('  - Access individual subgraphs:');
    logger.info('    - User: http://localhost:4001/graphql');
    logger.info('    - Todo: http://localhost:4002/graphql');
    logger.info('    - AI: http://localhost:4003/graphql');
    logger.info('\nPress Ctrl+C to stop all services');
    
    // Keep the process running
    process.on('SIGINT', () => {
      logger.info('\nShutting down federation...');
      processes.forEach(p => p.kill());
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('\nShutting down federation...');
      processes.forEach(p => p.kill());
      process.exit(0);
    });
    
    // Wait indefinitely
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('Failed to start federation:', error);
    processes.forEach(p => p.kill());
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testFederation().catch((error) => {
    logger.error('Federation test failed:', error);
    process.exit(1);
  });
}