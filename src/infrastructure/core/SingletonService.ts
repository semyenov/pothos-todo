/**
 * Base class for implementing the Singleton pattern across infrastructure services.
 * This eliminates the need to duplicate singleton boilerplate in 72+ service files.
 * 
 * @example
 * ```typescript
 * export class MyService extends SingletonService<MyService> {
 *   static getInstance(): MyService {
 *     return super.getInstance();
 *   }
 * 
 *   // Service implementation...
 * }
 * ```
 */
export abstract class SingletonService<T> {
  private static instances = new Map<string, any>();

  /**
   * Gets or creates the singleton instance for the calling class.
   * Uses the class constructor name as the key for instance storage.
   * 
   * @returns The singleton instance of the service
   */
  protected static getInstance<T>(this: new () => T): T {
    const className = this.name;
    
    if (!SingletonService.instances.has(className)) {
      SingletonService.instances.set(className, new this());
    }
    
    return SingletonService.instances.get(className) as T;
  }

  /**
   * Alternative getInstance with custom key support for services that need
   * multiple instances with different configurations.
   * 
   * @param key - Custom key for the instance
   * @returns The singleton instance for the given key
   */
  protected static getInstanceWithKey<T>(
    this: new () => T,
    key: string
  ): T {
    const instanceKey = `${this.name}:${key}`;
    
    if (!SingletonService.instances.has(instanceKey)) {
      SingletonService.instances.set(instanceKey, new this());
    }
    
    return SingletonService.instances.get(instanceKey) as T;
  }

  /**
   * Clears all singleton instances. Useful for testing.
   */
  static clearAllInstances(): void {
    SingletonService.instances.clear();
  }

  /**
   * Clears a specific singleton instance by class name.
   * 
   * @param className - The name of the class to clear
   */
  static clearInstance(className: string): void {
    SingletonService.instances.delete(className);
  }

  /**
   * Protected constructor to prevent direct instantiation.
   * Subclasses should also use protected or private constructors.
   */
  protected constructor() {}
}

/**
 * Extended singleton service with async initialization support.
 * Use this for services that require async setup (e.g., database connections).
 * 
 * @example
 * ```typescript
 * export class DatabaseService extends AsyncSingletonService<DatabaseService> {
 *   private connection?: Connection;
 * 
 *   static async getInstance(): Promise<DatabaseService> {
 *     return super.getInstanceAsync(async (instance) => {
 *       await instance.connect();
 *     });
 *   }
 * 
 *   private async connect(): Promise<void> {
 *     this.connection = await createConnection();
 *   }
 * }
 * ```
 */
export abstract class AsyncSingletonService<T> extends SingletonService<T> {
  private static initializationPromises = new Map<string, Promise<any>>();
  private static initializedInstances = new Set<string>();

  /**
   * Gets or creates the singleton instance with async initialization.
   * 
   * @param initializer - Optional async function to initialize the instance
   * @returns Promise resolving to the singleton instance
   */
  protected static async getInstanceAsync<T>(
    this: new () => T,
    initializer?: (instance: T) => Promise<void>
  ): Promise<T> {
    const className = this.name;
    
    // If already initialized, return immediately
    if (AsyncSingletonService.initializedInstances.has(className)) {
      return SingletonService.getInstance.call(this);
    }
    
    // If initialization is in progress, wait for it
    if (AsyncSingletonService.initializationPromises.has(className)) {
      await AsyncSingletonService.initializationPromises.get(className);
      return SingletonService.getInstance.call(this);
    }
    
    // Start new initialization
    const instance = SingletonService.getInstance.call(this);
    
    if (initializer) {
      const initPromise = initializer(instance).then(() => {
        AsyncSingletonService.initializedInstances.add(className);
        AsyncSingletonService.initializationPromises.delete(className);
      });
      
      AsyncSingletonService.initializationPromises.set(className, initPromise);
      await initPromise;
    } else {
      AsyncSingletonService.initializedInstances.add(className);
    }
    
    return instance;
  }

  /**
   * Checks if a service has been initialized.
   * 
   * @param className - The name of the class to check
   * @returns Whether the service has been initialized
   */
  static isInitialized(className: string): boolean {
    return AsyncSingletonService.initializedInstances.has(className);
  }

  /**
   * Clears all singleton instances and their initialization state.
   */
  static clearAllInstances(): void {
    super.clearAllInstances();
    AsyncSingletonService.initializationPromises.clear();
    AsyncSingletonService.initializedInstances.clear();
  }
}