import { HiveGatewayService } from '../../infrastructure/gateway/HiveGatewayService.js';
import { logger } from '../../lib/unjs-utils.js';
import type { Gateway } from '@graphql-hive/gateway';

export interface GatewayConfig {
  cors?: {
    origin?: string[];
    credentials?: boolean;
  };
  apiKeys?: {
    enabled: boolean;
    required: boolean;
  };
  port?: number;
}

/**
 * FederationGateway - Wrapper around HiveGatewayService for backward compatibility
 * 
 * This class provides a bridge between the existing federation interface
 * and the new Hive Gateway implementation.
 */
export class FederationGateway {
  private hiveGateway: HiveGatewayService;
  private started = false;

  constructor(private config: GatewayConfig) {
    this.hiveGateway = HiveGatewayService.getInstance();
  }
  
  /**
   * Start the federation gateway
   */
  async start() {
    try {
      logger.info('Starting Federation Gateway with Hive...');
      
      // Initialize and start Hive Gateway
      await this.hiveGateway.initialize();
      await this.hiveGateway.start(this.config.port || 4000);
      
      this.started = true;
      
      const url = `http://localhost:${this.config.port || 4000}/graphql`;
      logger.info(`Federation Gateway started at ${url}`);
      
      return { url };
    } catch (error) {
      logger.error('Failed to start Federation Gateway', error);
      throw error;
    }
  }
  
  /**
   * Stop the federation gateway
   */
  async stop() {
    if (this.started) {
      logger.info('Stopping Federation Gateway...');
      await this.hiveGateway.stop();
      this.started = false;
      logger.info('Federation Gateway stopped');
    }
  }
  
  /**
   * Get gateway metrics
   */
  getMetrics() {
    const metrics = this.hiveGateway.getMetrics();
    
    return {
      requestCount: 0, // TODO: Implement proper metrics collection
      errorCount: 0,
      averageLatency: 0,
      healthy: metrics.healthy,
      initialized: metrics.initialized,
    };
  }

  /**
   * Check if the gateway is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.hiveGateway.isHealthy();
  }

  /**
   * Get the underlying Hive Gateway instance
   */
  getHiveGateway(): HiveGatewayService {
    return this.hiveGateway;
  }
}