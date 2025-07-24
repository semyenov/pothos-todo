import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenRetryTimeout: number;
  resetTimeout: number;
  monitoringPeriod: number;
  volumeThreshold: number;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  requests: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  halfOpenStartTime?: Date;
  nextRetryTime?: Date;
  failureRate: number;
  averageLatency: number;
}

interface CircuitBreakerEventMap {
  'state:changed': {
    service: string;
    from: CircuitBreakerState;
    to: CircuitBreakerState;
    reason: string;
    timestamp: Date;
  };
  'call:success': {
    service: string;
    duration: number;
    timestamp: Date;
  };
  'call:failure': {
    service: string;
    error: Error;
    duration: number;
    timestamp: Date;
  };
  'call:rejected': {
    service: string;
    reason: string;
    timestamp: Date;
  };
}

class ServiceCircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private requests = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private halfOpenStartTime?: Date;
  private nextRetryTime?: Date;
  private latencySum = 0;

  constructor(
    public readonly serviceName: string,
    config: Partial<CircuitBreakerConfig> = {},
    private emitter: TypedEventEmitter<CircuitBreakerEventMap>
  ) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
      halfOpenRetryTimeout: 60000,
      resetTimeout: 300000,
      monitoringPeriod: 60000,
      volumeThreshold: 10,
      ...config,
    };

    this.startMonitoring();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shouldRejectCall()) {
      const reason = `Circuit breaker is ${this.state}`;
      this.emitter.emit('call:rejected', {
        service: this.serviceName,
        reason,
        timestamp: new Date(),
      });
      throw new Error(`Circuit breaker is ${this.state} for service ${this.serviceName}`);
    }

    const startTime = Date.now();
    
    try {
      const result = await operation();
      const duration = Date.now() - startTime;
      
      this.recordSuccess(duration);
      
      this.emitter.emit('call:success', {
        service: this.serviceName,
        duration,
        timestamp: new Date(),
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.recordFailure(error as Error, duration);
      
      this.emitter.emit('call:failure', {
        service: this.serviceName,
        error: error as Error,
        duration,
        timestamp: new Date(),
      });
      
      throw error;
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      halfOpenStartTime: this.halfOpenStartTime,
      nextRetryTime: this.nextRetryTime,
      failureRate: this.requests > 0 ? this.failures / this.requests : 0,
      averageLatency: this.requests > 0 ? this.latencySum / this.requests : 0,
    };
  }

  reset(): void {
    const oldState = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requests = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.halfOpenStartTime = undefined;
    this.nextRetryTime = undefined;
    this.latencySum = 0;

    if (oldState !== 'CLOSED') {
      this.emitStateChange(oldState, 'CLOSED', 'Manual reset');
    }

    logger.info(`Circuit breaker reset for ${this.serviceName}`);
  }

  private shouldRejectCall(): boolean {
    const now = new Date();

    switch (this.state) {
      case 'CLOSED':
        return false;

      case 'OPEN':
        if (this.nextRetryTime && now >= this.nextRetryTime) {
          this.transitionToHalfOpen();
          return false;
        }
        return true;

      case 'HALF_OPEN':
        return false;

      default:
        return true;
    }
  }

  private recordSuccess(duration: number): void {
    this.requests++;
    this.successes++;
    this.latencySum += duration;
    this.lastSuccessTime = new Date();

    if (this.state === 'HALF_OPEN') {
      if (this.successes >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  private recordFailure(error: Error, duration: number): void {
    this.requests++;
    this.failures++;
    this.latencySum += duration;
    this.lastFailureTime = new Date();

    if (this.state === 'CLOSED') {
      if (this.shouldTransitionToOpen()) {
        this.transitionToOpen();
      }
    } else if (this.state === 'HALF_OPEN') {
      this.transitionToOpen();
    }
  }

  private shouldTransitionToOpen(): boolean {
    // Check if we have enough volume to make a decision
    if (this.requests < this.config.volumeThreshold) {
      return false;
    }

    // Check failure threshold
    const failureRate = this.failures / this.requests;
    return failureRate >= (this.config.failureThreshold / 100);
  }

  private transitionToOpen(): void {
    const oldState = this.state;
    this.state = 'OPEN';
    this.nextRetryTime = new Date(Date.now() + this.config.halfOpenRetryTimeout);
    
    this.emitStateChange(oldState, 'OPEN', `Failure threshold exceeded (${this.failures}/${this.requests})`);
    
    logger.warn(`Circuit breaker opened for ${this.serviceName}`, {
      failures: this.failures,
      requests: this.requests,
      failureRate: `${(this.failures / this.requests * 100).toFixed(1)}%`,
    });
  }

  private transitionToHalfOpen(): void {
    const oldState = this.state;
    this.state = 'HALF_OPEN';
    this.halfOpenStartTime = new Date();
    this.successes = 0; // Reset success counter for half-open evaluation
    
    this.emitStateChange(oldState, 'HALF_OPEN', 'Retry timeout elapsed');
    
    logger.info(`Circuit breaker half-opened for ${this.serviceName}`);
  }

  private transitionToClosed(): void {
    const oldState = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.requests = 0;
    this.nextRetryTime = undefined;
    this.halfOpenStartTime = undefined;
    
    this.emitStateChange(oldState, 'CLOSED', `Success threshold met (${this.successes}/${this.config.successThreshold})`);
    
    logger.info(`Circuit breaker closed for ${this.serviceName}`, {
      successes: this.successes,
      threshold: this.config.successThreshold,
    });
  }

  private emitStateChange(from: CircuitBreakerState, to: CircuitBreakerState, reason: string): void {
    this.emitter.emit('state:changed', {
      service: this.serviceName,
      from,
      to,
      reason,
      timestamp: new Date(),
    });
  }

  private startMonitoring(): void {
    setInterval(() => {
      this.checkForReset();
      this.logPeriodStats();
    }, this.config.monitoringPeriod);
  }

  private checkForReset(): void {
    if (this.state === 'OPEN' && this.lastFailureTime) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
      if (timeSinceLastFailure > this.config.resetTimeout) {
        this.reset();
      }
    }
  }

  private logPeriodStats(): void {
    if (this.requests > 0) {
      logger.debug(`Circuit breaker stats for ${this.serviceName}`, {
        state: this.state,
        requests: this.requests,
        failures: this.failures,
        failureRate: `${(this.failures / this.requests * 100).toFixed(1)}%`,
        averageLatency: `${(this.latencySum / this.requests).toFixed(1)}ms`,
      });
    }
  }
}

export class CircuitBreakerManager extends TypedEventEmitter<CircuitBreakerEventMap> {
  private static instance: CircuitBreakerManager;
  private circuitBreakers = new Map<string, ServiceCircuitBreaker>();
  private globalConfig: Partial<CircuitBreakerConfig> = {};

  private constructor() {
    super();
  }

  static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  setGlobalConfig(config: Partial<CircuitBreakerConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
    logger.info('Global circuit breaker config updated', config);
  }

  getOrCreateCircuitBreaker(serviceName: string, config?: Partial<CircuitBreakerConfig>): ServiceCircuitBreaker {
    if (!this.circuitBreakers.has(serviceName)) {
      const finalConfig = { ...this.globalConfig, ...config };
      const circuitBreaker = new ServiceCircuitBreaker(serviceName, finalConfig, this);
      this.circuitBreakers.set(serviceName, circuitBreaker);
      
      logger.info(`Circuit breaker created for ${serviceName}`, finalConfig);
    }
    
    return this.circuitBreakers.get(serviceName)!;
  }

  async executeWithBreaker<T>(
    serviceName: string,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const circuitBreaker = this.getOrCreateCircuitBreaker(serviceName, config);
    return circuitBreaker.execute(operation);
  }

  getStats(serviceName?: string): Map<string, CircuitBreakerStats> | CircuitBreakerStats | null {
    if (serviceName) {
      const circuitBreaker = this.circuitBreakers.get(serviceName);
      return circuitBreaker ? circuitBreaker.getStats() : null;
    }

    const allStats = new Map<string, CircuitBreakerStats>();
    for (const [name, breaker] of this.circuitBreakers) {
      allStats.set(name, breaker.getStats());
    }
    return allStats;
  }

  resetAll(): void {
    for (const [serviceName, circuitBreaker] of this.circuitBreakers) {
      circuitBreaker.reset();
    }
    logger.info('All circuit breakers reset');
  }

  reset(serviceName: string): void {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
  }

  getOpenCircuitBreakers(): string[] {
    const openBreakers: string[] = [];
    for (const [serviceName, breaker] of this.circuitBreakers) {
      if (breaker.getStats().state === 'OPEN') {
        openBreakers.push(serviceName);
      }
    }
    return openBreakers;
  }

  getHealthySummary(): {
    total: number;
    closed: number;
    halfOpen: number;
    open: number;
    healthyPercentage: number;
  } {
    const summary = { total: 0, closed: 0, halfOpen: 0, open: 0, healthyPercentage: 0 };
    
    for (const [_, breaker] of this.circuitBreakers) {
      const stats = breaker.getStats();
      summary.total++;
      
      switch (stats.state) {
        case 'CLOSED': summary.closed++; break;
        case 'HALF_OPEN': summary.halfOpen++; break;
        case 'OPEN': summary.open++; break;
      }
    }
    
    summary.healthyPercentage = summary.total > 0 
      ? ((summary.closed + summary.halfOpen) / summary.total) * 100 
      : 100;
    
    return summary;
  }

  generateReport(): string {
    const summary = this.getHealthySummary();
    const openBreakers = this.getOpenCircuitBreakers();
    
    let report = `# Circuit Breaker Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += `## Summary\n\n`;
    report += `- **Total Breakers:** ${summary.total}\n`;
    report += `- **Closed (Healthy):** ${summary.closed}\n`;
    report += `- **Half-Open:** ${summary.halfOpen}\n`;
    report += `- **Open (Failed):** ${summary.open}\n`;
    report += `- **Health Percentage:** ${summary.healthyPercentage.toFixed(1)}%\n\n`;
    
    if (openBreakers.length > 0) {
      report += `## 🚨 Open Circuit Breakers\n\n`;
      for (const serviceName of openBreakers) {
        const stats = this.getStats(serviceName) as CircuitBreakerStats;
        report += `### ${serviceName}\n`;
        report += `- **Failure Rate:** ${(stats.failureRate * 100).toFixed(1)}%\n`;
        report += `- **Last Failure:** ${stats.lastFailureTime?.toISOString() || 'N/A'}\n`;
        report += `- **Next Retry:** ${stats.nextRetryTime?.toISOString() || 'N/A'}\n\n`;
      }
    }
    
    report += `## Detailed Stats\n\n`;
    report += `| Service | State | Requests | Failures | Failure Rate | Avg Latency |\n`;
    report += `|---------|-------|----------|----------|--------------|-------------|\n`;
    
    for (const [serviceName, breaker] of this.circuitBreakers) {
      const stats = breaker.getStats();
      const stateEmoji = stats.state === 'CLOSED' ? '✅' : stats.state === 'HALF_OPEN' ? '⚠️' : '❌';
      
      report += `| ${serviceName} | ${stateEmoji} ${stats.state} | ${stats.requests} | ${stats.failures} | ${(stats.failureRate * 100).toFixed(1)}% | ${stats.averageLatency.toFixed(1)}ms |\n`;
    }
    
    return report;
  }
}