import type { GatewayConfig } from '@graphql-hive/gateway';

/**
 * Simple Hive Gateway Configuration for Docker
 */
export const gatewayConfig: GatewayConfig = {
  // Supergraph configuration - for development without Hive CDN
  supergraph: {
    type: 'hive',
    endpoint: process.env.HIVE_CDN_ENDPOINT || 'http://localhost:4000',
    key: process.env.HIVE_CDN_KEY || '',
  },
};
