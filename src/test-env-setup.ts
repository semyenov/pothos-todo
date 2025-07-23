#!/usr/bin/env bun

/**
 * Simple environment test for Hive Gateway setup
 */

console.log('🔍 Checking Hive Gateway environment setup...\n');

// Check required environment variables
const requiredEnvVars = [
  'HIVE_TOKEN',
  'HIVE_CDN_ENDPOINT', 
  'HIVE_CDN_KEY',
];

const missingEnvVars: string[] = [];
const unconfiguredEnvVars: string[] = [];

for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  
  if (!value) {
    missingEnvVars.push(envVar);
  } else if (value.includes('your-') && value.includes('-here')) {
    unconfiguredEnvVars.push(envVar);
  }
}

if (missingEnvVars.length > 0 || unconfiguredEnvVars.length > 0) {
  console.log('❌ Environment variables need configuration:\n');
  
  if (missingEnvVars.length > 0) {
    console.log('Missing variables:');
    missingEnvVars.forEach(v => console.log(`  - ${v}`));
    console.log();
  }
  
  if (unconfiguredEnvVars.length > 0) {
    console.log('Unconfigured variables (still have placeholder values):');
    unconfiguredEnvVars.forEach(v => console.log(`  - ${v} = ${process.env[v]}`));
    console.log();
  }
  
  console.log('📋 To configure Hive Gateway:');
  console.log('1. Sign up at https://app.graphql-hive.com');
  console.log('2. Create a new project and target');
  console.log('3. Get your access tokens from the dashboard:');
  console.log('   - HIVE_TOKEN: From Settings > Tokens');
  console.log('   - HIVE_CDN_ENDPOINT: From your target\'s CDN tab (format: https://cdn.graphql-hive.com/artifacts/v1/TARGET_ID)');
  console.log('   - HIVE_CDN_KEY: From your target\'s CDN tab');
  console.log('4. Update your .env file with these values\n');
  
  process.exit(1);
} else {
  console.log('✅ All required environment variables are configured!\n');
  console.log('Current configuration:');
  console.log(`  HIVE_TOKEN: ${process.env.HIVE_TOKEN?.substring(0, 10)}...`);
  console.log(`  HIVE_CDN_ENDPOINT: ${process.env.HIVE_CDN_ENDPOINT}`);
  console.log(`  HIVE_CDN_KEY: ${process.env.HIVE_CDN_KEY?.substring(0, 10)}...`);
  console.log();
  console.log('✨ You\'re ready to start using Hive Gateway!');
  console.log();
  console.log('Next steps:');
  console.log('1. Start your subgraphs: bun run subgraph:user, bun run subgraph:todo, bun run subgraph:ai');
  console.log('2. Publish schemas to Hive: bun run hive:publish');
  console.log('3. Start the gateway: bun run gateway:dev');
  console.log();
}