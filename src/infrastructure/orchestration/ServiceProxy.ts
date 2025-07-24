import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { CircuitBreakerManager } from './CircuitBreaker.js';
import { RetryPolicy } from './RetryPolicy.js';
import { LoadBalancer } from './LoadBalancer.js';
import { ServiceDiscovery } from './ServiceDiscovery.js';
import { logger } from '@/lib/unjs-utils.js';

export interface ProxyConfig {
  retries?: {
    enabled: boolean;
    maxAttempts: number;
    baseDelay: number;
    backoffMultiplier: number;
  };
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    timeout: number;
  };
  loadBalancer?: {
    enabled: boolean;
    algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'random';
  };
  timeout?: number;
  cache?: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  metrics?: {
    enabled: boolean;
    sampleRate: number;
  };
}

export interface ProxyCall {
  id: string;
  serviceName: string;
  method: string;
  args: any[];
  startTime: Date;
  endTime?: Date;
  duration?: number;
  success: boolean;
  error?: Error;
  retryAttempts: number;
  cacheHit?: boolean;
  endpointId?: string;
}

interface ProxyEventMap {
  'call:started': { call: ProxyCall };
  'call:completed': { call: ProxyCall };
  'call:failed': { call: ProxyCall };
  'cache:hit': { serviceName: string; method: string; key: string };
  'cache:miss': { serviceName: string; method: string; key: string };
  'endpoint:selected': { serviceName: string; endpointId: string; algorithm: string };
}

class ServiceMethodProxy {
  private cache = new Map<string, { value: any; expiry: Date }>();
  
  constructor(
    private serviceName: string,
    private config: ProxyConfig,
    private circuitBreaker: CircuitBreakerManager,
    private retryPolicy: RetryPolicy,
    private loadBalancer: LoadBalancer,
    private discovery: ServiceDiscovery,
    private emitter: TypedEventEmitter<ProxyEventMap>
  ) {}

  async call(method: string, args: any[] = [], sessionId?: string): Promise<any> {
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const call: ProxyCall = {
      id: callId,
      serviceName: this.serviceName,
      method,
      args,
      startTime: new Date(),
      success: false,
      retryAttempts: 0,
    };

    this.emitter.emit('call:started', { call });

    try {
      // Check cache first
      if (this.config.cache?.enabled && this.isCacheable(method)) {
        const cacheKey = this.generateCacheKey(method, args);
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
          call.cacheHit = true;
          call.success = true;
          call.endTime = new Date();
          call.duration = 0;
          
          this.emitter.emit('cache:hit', {
            serviceName: this.serviceName,
            method,
            key: cacheKey,
          });
          
          this.emitter.emit('call:completed', { call });
          return cached;
        } else {
          this.emitter.emit('cache:miss', {
            serviceName: this.serviceName,
            method,
            key: cacheKey,
          });
        }
      }

      // Select endpoint using load balancer
      let endpointId: string | null = null;
      if (this.config.loadBalancer?.enabled) {
        endpointId = this.loadBalancer.selectEndpoint(this.serviceName, sessionId);
        call.endpointId = endpointId;
        
        if (endpointId) {
          this.emitter.emit('endpoint:selected', {
            serviceName: this.serviceName,
            endpointId,
            algorithm: this.config.loadBalancer.algorithm,
          });
        }
      }

      // Execute the actual call
      const result = await this.executeCall(method, args, call);

      // Cache the result if applicable
      if (this.config.cache?.enabled && this.isCacheable(method)) {
        const cacheKey = this.generateCacheKey(method, args);
        this.setCache(cacheKey, result);
      }

      // Record success metrics
      if (this.config.loadBalancer?.enabled && endpointId) {
        this.loadBalancer.recordRequest(this.serviceName, endpointId, true, call.duration || 0);
      }

      call.success = true;
      call.endTime = new Date();
      call.duration = call.endTime.getTime() - call.startTime.getTime();

      this.emitter.emit('call:completed', { call });

      return result;

    } catch (error) {
      call.error = error as Error;
      call.endTime = new Date();
      call.duration = call.endTime.getTime() - call.startTime.getTime();

      // Record failure metrics
      if (this.config.loadBalancer?.enabled && call.endpointId) {
        this.loadBalancer.recordRequest(this.serviceName, call.endpointId, false, call.duration);
      }

      this.emitter.emit('call:failed', { call });

      throw error;
    }
  }

  private async executeCall(method: string, args: any[], call: ProxyCall): Promise<any> {
    const operation = async () => {
      // Get the actual service instance
      const serviceInstance = await this.getServiceInstance();
      
      if (!serviceInstance || typeof serviceInstance[method] !== 'function') {
        throw new Error(`Method ${method} not found on service ${this.serviceName}`);
      }

      // Apply timeout if configured
      if (this.config.timeout) {
        return this.executeWithTimeout(
          () => serviceInstance[method](...args),
          this.config.timeout
        );
      } else {
        return serviceInstance[method](...args);
      }
    };

    // Apply circuit breaker if enabled
    let wrappedOperation = operation;
    if (this.config.circuitBreaker?.enabled) {
      wrappedOperation = () => this.circuitBreaker.executeWithBreaker(
        this.serviceName,
        operation,
        this.config.circuitBreaker
      );
    }

    // Apply retry policy if enabled
    if (this.config.retries?.enabled) {
      const result = await this.retryPolicy.executeWithResult(
        wrappedOperation,
        `${this.serviceName}.${method}`,
        this.config.retries
      );
      
      call.retryAttempts = result.attempts;
      
      if (result.success && result.result !== undefined) {
        return result.result;
      } else {
        throw result.error || new Error('Operation failed');
      }
    } else {
      return wrappedOperation();
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private async getServiceInstance(): Promise<any> {
    // In a real implementation, this would get the service from a registry
    // For now, we'll simulate it
    return {
      [this.serviceName]: {
        // Mock service methods
        getHealth: () => ({ status: 'healthy', timestamp: new Date() }),
        getData: (id: string) => ({ id, data: `Mock data for ${id}` }),
        processRequest: (request: any) => ({ processed: true, request }),
      }
    }[this.serviceName];
  }

  private isCacheable(method: string): boolean {
    // Only cache read operations (GET-like methods)
    const readMethods = ['get', 'find', 'list', 'search', 'query', 'read'];
    return readMethods.some(prefix => method.toLowerCase().startsWith(prefix));
  }

  private generateCacheKey(method: string, args: any[]): string {
    const argsHash = JSON.stringify(args);
    return `${this.serviceName}:${method}:${argsHash}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiry > new Date()) {
      return cached.value;
    } else if (cached) {
      this.cache.delete(key); // Remove expired entry
    }
    return null;
  }

  private setCache(key: string, value: any): void {
    if (!this.config.cache) return;

    const expiry = new Date(Date.now() + this.config.cache.ttl);
    
    // Check cache size limit
    if (this.cache.size >= this.config.cache.maxSize) {
      // Remove oldest entry (simple LRU)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, expiry });
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.cache?.maxSize || 0,
      // Hit rate would be calculated from metrics
    };
  }
}

export class ServiceProxy extends TypedEventEmitter<ProxyEventMap> {
  private static instance: ServiceProxy;
  private proxies = new Map<string, ServiceMethodProxy>();
  private defaultConfig: ProxyConfig = {
    retries: {
      enabled: true,
      maxAttempts: 3,
      baseDelay: 1000,
      backoffMultiplier: 2,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 50,
      timeout: 30000,
    },
    loadBalancer: {
      enabled: true,
      algorithm: 'round-robin',
    },
    timeout: 30000,
    cache: {
      enabled: true,
      ttl: 300000, // 5 minutes
      maxSize: 1000,
    },
    metrics: {
      enabled: true,
      sampleRate: 1.0,
    },
  };

  private circuitBreaker: CircuitBreakerManager;
  private retryPolicy: RetryPolicy;
  private loadBalancer: LoadBalancer;
  private discovery: ServiceDiscovery;

  private constructor() {
    super();
    this.circuitBreaker = CircuitBreakerManager.getInstance();
    this.retryPolicy = RetryPolicy.getInstance();
    this.loadBalancer = new LoadBalancer();
    this.discovery = ServiceDiscovery.getInstance();
  }

  static getInstance(): ServiceProxy {
    if (!ServiceProxy.instance) {
      ServiceProxy.instance = new ServiceProxy();
    }
    return ServiceProxy.instance;
  }

  createProxy(serviceName: string, config?: Partial<ProxyConfig>): ServiceMethodProxy {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    if (!this.proxies.has(serviceName)) {
      const proxy = new ServiceMethodProxy(
        serviceName,
        finalConfig,
        this.circuitBreaker,
        this.retryPolicy,
        this.loadBalancer,
        this.discovery,
        this
      );
      
      this.proxies.set(serviceName, proxy);
      
      // Configure load balancer
      if (finalConfig.loadBalancer?.enabled) {
        this.loadBalancer.configureService(serviceName, {
          algorithm: finalConfig.loadBalancer.algorithm,
          healthCheck: true,
        });
      }
      
      logger.info(`Service proxy created for ${serviceName}`, finalConfig);
    }
    
    return this.proxies.get(serviceName)!;
  }

  async call(serviceName: string, method: string, args: any[] = [], sessionId?: string): Promise<any> {
    const proxy = this.createProxy(serviceName);
    return proxy.call(method, args, sessionId);
  }

  setDefaultConfig(config: Partial<ProxyConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    logger.info('Default proxy config updated', config);
  }

  getProxy(serviceName: string): ServiceMethodProxy | undefined {
    return this.proxies.get(serviceName);
  }

  clearAllCaches(): void {
    for (const proxy of this.proxies.values()) {
      proxy.clearCache();
    }
    logger.info('All proxy caches cleared');
  }

  getStats(): Map<string, any> {
    const stats = new Map();
    
    for (const [serviceName, proxy] of this.proxies) {
      stats.set(serviceName, {
        cache: proxy.getCacheStats(),
        circuitBreaker: this.circuitBreaker.getStats(serviceName),
        loadBalancer: this.loadBalancer.getStats(serviceName),
      });
    }
    
    return stats;
  }

  generateReport(): string {
    const stats = this.getStats();
    const circuitBreakerSummary = this.circuitBreaker.getHealthySummary();
    
    let report = `# Service Proxy Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    report += `## Summary\n\n`;
    report += `- **Total Proxied Services:** ${stats.size}\n`;
    report += `- **Circuit Breaker Health:** ${circuitBreakerSummary.healthyPercentage.toFixed(1)}%\n`;
    report += `- **Open Circuit Breakers:** ${circuitBreakerSummary.open}\n\n`;
    
    report += `## Service Details\n\n`;
    
    for (const [serviceName, serviceStats] of stats) {
      report += `### ${serviceName}\n\n`;
      
      // Cache stats
      if (serviceStats.cache) {
        report += `**Cache:**\n`;
        report += `- Size: ${serviceStats.cache.size}/${serviceStats.cache.maxSize}\n`;
        report += `- Hit Rate: ${serviceStats.cache.hitRate ? `${(serviceStats.cache.hitRate * 100).toFixed(1)}%` : 'N/A'}\n\n`;
      }
      
      // Circuit breaker stats
      if (serviceStats.circuitBreaker) {
        const cb = serviceStats.circuitBreaker;
        report += `**Circuit Breaker:**\n`;
        report += `- State: ${cb.state}\n`;
        report += `- Failure Rate: ${(cb.failureRate * 100).toFixed(1)}%\n`;
        report += `- Requests: ${cb.requests}\n\n`;
      }
      
      // Load balancer stats
      if (serviceStats.loadBalancer) {
        const lb = serviceStats.loadBalancer;
        report += `**Load Balancer:**\n`;
        report += `- Total Requests: ${lb.totalRequests}\n`;
        report += `- Success Rate: ${lb.totalRequests > 0 ? ((lb.successfulRequests / lb.totalRequests) * 100).toFixed(1) : 0}%\n`;
        report += `- Average Latency: ${lb.averageLatency.toFixed(1)}ms\n\n`;
      }
    }
    
    return report;
  }

  // Helper method to create a fluent API for service calls
  service(serviceName: string) {
    return {
      call: (method: string, ...args: any[]) => this.call(serviceName, method, args),
      withSession: (sessionId: string) => ({
        call: (method: string, ...args: any[]) => this.call(serviceName, method, args, sessionId),
      }),
      proxy: () => this.createProxy(serviceName),
    };
  }
}