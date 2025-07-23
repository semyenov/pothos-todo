import { BaseService, BaseAsyncService } from '../core/BaseService.js';
import { ServiceEventMap } from '../core/TypedEventEmitter.js';
import { ServiceRegistry } from '../core/ServiceRegistry.js';
import { z } from 'zod';

/**
 * Test utilities for BaseService testing
 * Provides helpers for creating mock services, testing events, and validating behavior
 */

/**
 * Create a mock service for testing
 */
export function createMockService<TConfig = any, TEventMap extends ServiceEventMap = ServiceEventMap>(
  options: {
    name: string;
    config?: TConfig;
    configSchema?: z.ZodSchema<TConfig>;
    async?: boolean;
    events?: Array<keyof TEventMap>;
  }
): BaseService<TConfig, TEventMap> | BaseAsyncService<TConfig, TEventMap> {
  const MockServiceClass = options.async ? 
    class extends BaseAsyncService<TConfig, TEventMap> {
      static async getInstance(): Promise<any> {
        return super.getInstance();
      }
      
      protected getServiceName(): string {
        return options.name;
      }
      
      protected getServiceVersion(): string {
        return '1.0.0-mock';
      }
      
      protected getConfigSchema(): z.ZodSchema<TConfig> | undefined {
        return options.configSchema;
      }
      
      protected async onInitialize(): Promise<void> {
        // Mock initialization
      }
      
      protected async onStart(): Promise<void> {
        // Mock start
      }
      
      protected async onStop(): Promise<void> {
        // Mock stop
      }
    } :
    class extends BaseService<TConfig, TEventMap> {
      static getInstance(): any {
        return super.getInstance();
      }
      
      protected getServiceName(): string {
        return options.name;
      }
      
      protected getServiceVersion(): string {
        return '1.0.0-mock';
      }
      
      protected getConfigSchema(): z.ZodSchema<TConfig> | undefined {
        return options.configSchema;
      }
      
      protected onInitialize(): void {
        // Mock initialization
      }
      
      protected onStart(): void {
        // Mock start
      }
      
      protected onStop(): void {
        // Mock stop
      }
    };

  // Create instance
  const instance = new MockServiceClass();
  
  // Set config if provided
  if (options.config) {
    (instance as any).config = options.config;
  }
  
  return instance;
}

/**
 * Event recorder for testing service events
 */
export class EventRecorder<TEventMap extends ServiceEventMap = ServiceEventMap> {
  private events: Array<{ event: keyof TEventMap; data: any; timestamp: Date }> = [];
  private listeners: Map<keyof TEventMap, Function> = new Map();

  /**
   * Attach to a service to record events
   */
  attach(service: BaseService<any, TEventMap> | BaseAsyncService<any, TEventMap>): void {
    // Record all events
    const originalEmit = service.emit.bind(service);
    (service as any).emit = (event: keyof TEventMap, data: any) => {
      this.events.push({ event, data, timestamp: new Date() });
      return originalEmit(event, data);
    };
  }

  /**
   * Get all recorded events
   */
  getEvents(): Array<{ event: keyof TEventMap; data: any; timestamp: Date }> {
    return [...this.events];
  }

  /**
   * Get events of a specific type
   */
  getEventsByType<K extends keyof TEventMap>(
    eventType: K
  ): Array<{ event: K; data: TEventMap[K]; timestamp: Date }> {
    return this.events
      .filter(e => e.event === eventType)
      .map(e => ({ ...e, event: e.event as K, data: e.data as TEventMap[K] }));
  }

  /**
   * Wait for a specific event
   */
  async waitForEvent<K extends keyof TEventMap>(
    eventType: K,
    timeout = 5000
  ): Promise<TEventMap[K]> {
    return new Promise((resolve, reject) => {
      const existing = this.events.find(e => e.event === eventType);
      if (existing) {
        resolve(existing.data);
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${String(eventType)}`));
      }, timeout);

      const listener = (data: TEventMap[K]) => {
        clearTimeout(timeoutId);
        resolve(data);
      };

      this.listeners.set(eventType, listener);
    });
  }

  /**
   * Assert an event was emitted
   */
  assertEventEmitted<K extends keyof TEventMap>(
    eventType: K,
    matcher?: (data: TEventMap[K]) => boolean
  ): void {
    const events = this.getEventsByType(eventType);
    
    if (events.length === 0) {
      throw new Error(`Expected event '${String(eventType)}' was not emitted`);
    }

    if (matcher) {
      const matched = events.some(e => matcher(e.data));
      if (!matched) {
        throw new Error(`Event '${String(eventType)}' was emitted but did not match criteria`);
      }
    }
  }

  /**
   * Assert an event was not emitted
   */
  assertEventNotEmitted<K extends keyof TEventMap>(eventType: K): void {
    const events = this.getEventsByType(eventType);
    
    if (events.length > 0) {
      throw new Error(`Expected event '${String(eventType)}' to not be emitted, but it was emitted ${events.length} times`);
    }
  }

  /**
   * Clear recorded events
   */
  clear(): void {
    this.events = [];
  }
}

/**
 * Service test harness for integration testing
 */
export class ServiceTestHarness {
  private services: Map<string, BaseService<any, any> | BaseAsyncService<any, any>> = new Map();
  private startedServices: Set<string> = new Set();

  /**
   * Add a service to the harness
   */
  addService(service: BaseService<any, any> | BaseAsyncService<any, any>): void {
    const name = service.metadata.name;
    this.services.set(name, service);
    ServiceRegistry.register(service);
  }

  /**
   * Start all services
   */
  async startAll(): Promise<void> {
    for (const [name, service] of this.services) {
      if (service.state !== 'running') {
        await service.start();
        this.startedServices.add(name);
      }
    }
  }

  /**
   * Stop all services
   */
  async stopAll(): Promise<void> {
    for (const name of this.startedServices) {
      const service = this.services.get(name);
      if (service && service.state === 'running') {
        await service.stop('test cleanup');
      }
    }
    this.startedServices.clear();
  }

  /**
   * Get a service by name
   */
  getService<T extends BaseService<any, any> | BaseAsyncService<any, any>>(
    name: string
  ): T | undefined {
    return this.services.get(name) as T;
  }

  /**
   * Clean up the harness
   */
  async cleanup(): Promise<void> {
    await this.stopAll();
    this.services.clear();
    ServiceRegistry.clear();
  }

  /**
   * Wait for all services to be healthy
   */
  async waitForHealthy(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const health = await ServiceRegistry.getSystemHealth();
      
      if (health.healthy) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Timeout waiting for services to be healthy');
  }
}

/**
 * Mock configuration provider for testing
 */
export class MockConfigProvider {
  private configs: Map<string, any> = new Map();

  /**
   * Set configuration for a service
   */
  setConfig(servicePrefix: string, config: any): void {
    this.configs.set(servicePrefix, config);
  }

  /**
   * Apply configurations as environment variables
   */
  applyToEnv(): void {
    for (const [prefix, config] of this.configs) {
      this.setEnvVars(prefix.toUpperCase(), config);
    }
  }

  private setEnvVars(prefix: string, obj: any, path = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      const envKey = path ? `${prefix}_${path}_${key}`.toUpperCase() : `${prefix}_${key}`.toUpperCase();
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.setEnvVars(prefix, value, path ? `${path}_${key}` : key);
      } else {
        process.env[envKey] = String(value);
      }
    }
  }

  /**
   * Clear all set environment variables
   */
  clear(): void {
    for (const [prefix] of this.configs) {
      this.clearEnvVars(prefix.toUpperCase());
    }
    this.configs.clear();
  }

  private clearEnvVars(prefix: string): void {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(prefix + '_')) {
        delete process.env[key];
      }
    }
  }
}

/**
 * Performance benchmarking for services
 */
export class ServiceBenchmark {
  private metrics: Map<string, number[]> = new Map();

  /**
   * Benchmark a service operation
   */
  async benchmark<T>(
    name: string,
    operation: () => Promise<T>,
    iterations = 100
  ): Promise<{
    name: string;
    iterations: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await operation();
      const duration = performance.now() - start;
      times.push(duration);
    }

    times.sort((a, b) => a - b);

    const result = {
      name,
      iterations,
      avg: times.reduce((sum, t) => sum + t, 0) / times.length,
      min: times[0],
      max: times[times.length - 1],
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
    };

    this.metrics.set(name, times);
    return result;
  }

  /**
   * Compare two benchmarks
   */
  compare(
    baseline: string,
    comparison: string
  ): {
    improvement: number;
    significant: boolean;
  } | null {
    const baselineTimes = this.metrics.get(baseline);
    const comparisonTimes = this.metrics.get(comparison);

    if (!baselineTimes || !comparisonTimes) {
      return null;
    }

    const baselineAvg = baselineTimes.reduce((sum, t) => sum + t, 0) / baselineTimes.length;
    const comparisonAvg = comparisonTimes.reduce((sum, t) => sum + t, 0) / comparisonTimes.length;

    const improvement = ((baselineAvg - comparisonAvg) / baselineAvg) * 100;

    // Simple significance test (in real implementation, use proper statistics)
    const significant = Math.abs(improvement) > 5;

    return { improvement, significant };
  }
}

/**
 * Example test suite for a service
 */
export function exampleServiceTest() {
  const harness = new ServiceTestHarness();
  const eventRecorder = new EventRecorder();
  const configProvider = new MockConfigProvider();

  beforeAll(async () => {
    // Set up test configuration
    configProvider.setConfig('test_service', {
      enabled: true,
      timeout: 5000,
    });
    configProvider.applyToEnv();

    // Create and add test service
    const service = createMockService({
      name: 'test-service',
      async: true,
      configSchema: z.object({
        enabled: z.boolean(),
        timeout: z.number(),
      }),
    });

    eventRecorder.attach(service);
    harness.addService(service);

    // Start services
    await harness.startAll();
    await harness.waitForHealthy();
  });

  afterAll(async () => {
    await harness.cleanup();
    configProvider.clear();
  });

  test('service should emit started event', async () => {
    eventRecorder.assertEventEmitted('service:started');
  });

  test('service should be healthy', async () => {
    const service = harness.getService('test-service');
    const health = await service!.getHealth();
    expect(health.status).toBe('healthy');
  });

  test('service should handle configuration changes', async () => {
    const service = harness.getService('test-service');
    
    // Update configuration
    configProvider.setConfig('test_service', {
      enabled: true,
      timeout: 10000,
    });
    configProvider.applyToEnv();

    // Trigger config reload
    await service!.reloadConfig();

    // Verify event was emitted
    eventRecorder.assertEventEmitted('service:config-changed');
  });
}