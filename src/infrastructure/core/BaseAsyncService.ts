import { BaseService } from './BaseService.js';
import { ServiceEventMap } from './TypedEventEmitter.js';
import { ServiceConfigOptions } from './BaseService.js';

/**
 * Base class for services that require asynchronous initialization.
 * This extends BaseService with singleton pattern and async getInstance.
 * 
 * @example
 * ```typescript
 * interface DatabaseConfig {
 *   connectionString: string;
 *   poolSize: number;
 * }
 * 
 * class DatabaseService extends BaseAsyncService<DatabaseConfig> {
 *   private pool: Pool;
 * 
 *   static async getInstance(): Promise<DatabaseService> {
 *     return super.getInstanceAsync(async (instance) => {
 *       await instance.initialize();
 *       await instance.start();
 *     });
 *   }
 *   
 *   protected async onStart() {
 *     this.pool = await createPool(this.config);
 *   }
 * }
 * ```
 */
export abstract class BaseAsyncService<
  TConfig = any,
  TEventMap extends ServiceEventMap = ServiceEventMap
> extends BaseService<TConfig, TEventMap> {
  private static instances = new Map<string, BaseAsyncService<any, any>>();
  private static initializationPromises = new Map<string, Promise<any>>();
  private static initializedInstances = new Set<string>();

  /**
   * Get or create the singleton instance with async initialization
   */
  public static async getInstanceAsync<T extends BaseAsyncService<any, any>>(
    this: new () => T,
    initializer?: (instance: T) => Promise<void>
  ): Promise<T> {
    const className = this.name;

    // If already initialized, return immediately
    if (BaseAsyncService.initializedInstances.has(className)) {
      return BaseAsyncService.instances.get(className) as T;
    }

    // If initialization is in progress, wait for it
    if (BaseAsyncService.initializationPromises.has(className)) {
      await BaseAsyncService.initializationPromises.get(className);
      return BaseAsyncService.instances.get(className) as T;
    }

    // Create new instance
    if (!BaseAsyncService.instances.has(className)) {
      BaseAsyncService.instances.set(className, new this());
    }

    const instance = BaseAsyncService.instances.get(className) as T;

    // Start initialization
    if (initializer) {
      const initPromise = initializer(instance)
        .then(() => {
          BaseAsyncService.initializedInstances.add(className);
          BaseAsyncService.initializationPromises.delete(className);
        })
        .catch((error) => {
          // Clean up on failure
          BaseAsyncService.instances.delete(className);
          BaseAsyncService.initializationPromises.delete(className);
          throw error;
        });

      BaseAsyncService.initializationPromises.set(className, initPromise);
      await initPromise;
    } else {
      BaseAsyncService.initializedInstances.add(className);
    }

    return instance;
  }

  /**
   * Get or create instance with auto-initialization
   */
  public static async getInstance<T extends BaseAsyncService<any, any>>(
    this: new () => T,
    configOptions?: ServiceConfigOptions<any>
  ): Promise<T> {
    return BaseAsyncService.getInstanceAsync.call(this, async (instance) => {
      if (configOptions || instance.getConfigSchema()) {
        await instance.initialize(configOptions);
      }
      await instance.start();
    });
  }

  /**
   * Check if a service has been initialized
   */
  public static isInitialized(className: string): boolean {
    return BaseAsyncService.initializedInstances.has(className);
  }

  /**
   * Clear all singleton instances (useful for testing)
   */
  public static clearAllInstances(): void {
    // Stop all running services
    const stopPromises: Promise<void>[] = [];
    
    for (const instance of BaseAsyncService.instances.values()) {
      if (instance.state === 'running') {
        stopPromises.push(instance.stop('clearing instances'));
      }
    }

    // Wait for all services to stop
    Promise.all(stopPromises).catch(console.error);

    BaseAsyncService.instances.clear();
    BaseAsyncService.initializationPromises.clear();
    BaseAsyncService.initializedInstances.clear();
  }

  /**
   * Clear a specific singleton instance
   */
  public static clearInstance(className: string): void {
    const instance = BaseAsyncService.instances.get(className);
    if (instance && instance.state === 'running') {
      instance.stop('clearing instance').catch(console.error);
    }
    
    BaseAsyncService.instances.delete(className);
    BaseAsyncService.initializationPromises.delete(className);
    BaseAsyncService.initializedInstances.delete(className);
  }

  /**
   * Get an existing instance without creating one
   */
  public static getExistingInstance<T extends BaseAsyncService<any, any>>(
    this: new () => T
  ): T | undefined {
    return BaseAsyncService.instances.get(this.name) as T | undefined;
  }

  /**
   * Wait for service to be ready (useful for dependent services)
   */
  public async waitUntilReady(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (this.state !== 'running') {
      if (this.state === 'error') {
        throw new Error(`Service ${this.metadata.name} is in error state`);
      }
      
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout waiting for service ${this.metadata.name} to be ready`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Protected constructor to prevent direct instantiation
   */
  protected constructor() {
    super();
  }
}