#!/usr/bin/env bun

import { logger } from '../src/lib/unjs-utils.js';

async function testSubgraph(name: string, port: number) {
  try {
    const response = await fetch(`http://localhost:${port}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          {
            __schema {
              types {
                name
              }
            }
          }
        `,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      logger.success(`✅ ${name} subgraph is working on port ${port}`);
      return true;
    } else {
      logger.error(`❌ ${name} subgraph returned ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ ${name} subgraph is not reachable on port ${port}`, error);
    return false;
  }
}

async function main() {
  logger.info('Testing subgraphs...\n');
  
  const results = await Promise.all([
    testSubgraph('User', 4001),
    testSubgraph('Todo', 4002),
    testSubgraph('AI', 4003),
  ]);
  
  const allWorking = results.every(r => r);
  
  if (allWorking) {
    logger.success('\n🎉 All subgraphs are working!');
    logger.info('\nYou can now run the federation gateway.');
  } else {
    logger.error('\n❌ Some subgraphs are not working. Please check the logs.');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});