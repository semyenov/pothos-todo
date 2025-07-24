import { EventEmitter } from "events";

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
export abstract class SingletonService {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  private static instances = new Map<string, SingletonService>();

  /**
   * Gets or creates the singleton instance for the calling class.
   * Uses the class constructor name as the key for instance storage.
   *
   * @returns The singleton instance of the service
   */
  public static getInstance<T extends SingletonService>(
    this: new (...args: unknown[]) => T,
    ...args: unknown[]
  ): T {
    const className = this.name;
    if (!SingletonService.instances.has(className)) {
      SingletonService.instances.set(className, new this(...args));
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
  public static getInstanceWithKey<T extends SingletonService>(
    this: new (...args: unknown[]) => T,
    key: string,
    ...args: unknown[]
  ): T {
    const instanceKey = `${this.name}:${key}`;

    if (!SingletonService.instances.has(instanceKey)) {
      SingletonService.instances.set(instanceKey, new this(...args));
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
export abstract class AsyncSingletonService<
  T extends AsyncSingletonService<T>
> extends SingletonService {
  private static instances = new Map<string, AsyncSingletonService<T>>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  private static initializationPromises = new Map<string, Promise<T>>();
  private static initializedInstances = new Set<string>();

  /**
   * Gets or creates the singleton instance with async initialization.
   *
   * @returns Promise resolving to the singleton instance
   */
  public static async getInstance<T extends AsyncSingletonService<T>>(
    this: new (...args: unknown[]) => T,
    ...args: unknown[]
  ): Promise<T> {
    const className = this.name;

    // If already initialized, return immediately
    if (AsyncSingletonService.initializedInstances.has(className)) {
      return SingletonService.getInstance.call(this, ...args) as T;
    }

    // If initialization is in progress, wait for it
    if (AsyncSingletonService.initializationPromises.has(className)) {
      await AsyncSingletonService.initializationPromises.get(className);
      return SingletonService.getInstance.call(this, ...args) as T;
    }

    // Start new initialization
    const instance = SingletonService.getInstance.call(this, ...args) as T;
    AsyncSingletonService.initializedInstances.add(className);

    return instance;
  }

  /**
   * Checks if a service has been initialized.
   *
   * @param className - The name of the class to check
   * @returns Whether the service has been initialized
   */
  public static isInitialized(className: string): boolean {
    return AsyncSingletonService.initializedInstances.has(className);
  }

  /**
   * Clears all singleton instances and their initialization state.
   */
  public static override clearAllInstances(): void {
    AsyncSingletonService.initializationPromises.clear();
    AsyncSingletonService.initializedInstances.clear();
  }
}

/**
 * Singleton service that extends EventEmitter for services that need to emit events.
 * Combines singleton pattern with EventEmitter functionality.
 *
 * @example
 * ```typescript
 * export class SecurityManager extends EventEmitterSingletonService<SecurityManager> {
 *   static getInstance(): SecurityManager {
 *     return super.getInstance();
 *   }
 *
 *   detectThreat(threat: Threat): void {
 *     // Handle threat detection
 *     this.emit('threat-detected', threat);
 *   }
 * }
 * ```
 */
export abstract class EventEmitterSingletonService<
  T extends EventEmitterSingletonService<T>
> extends EventEmitter {
  private static instances = new Map<string, EventEmitterSingletonService<T>>();

  /**
   * Gets or creates the singleton instance for the calling class.
   *
   * @returns The singleton instance of the service
   */
  public static getInstance<T extends EventEmitterSingletonService<T>>(
    this: new (...args: unknown[]) => T,
    ...args: unknown[]
  ): T {
    const className = this.name;
    if (!EventEmitterSingletonService.instances.has(className)) {
      EventEmitterSingletonService.instances.set(className, new this(...args));
    }
    return EventEmitterSingletonService.instances.get(className) as T;
  }

  /**
   * Alternative getInstance with custom key support.
   *
   * @param key - Custom key for the instance
   * @returns The singleton instance for the given key
   */
  public static getInstanceWithKey<T extends EventEmitterSingletonService<T>>(
    this: new (...args: unknown[]) => T,
    key: string,
    ...args: unknown[]
  ): T {
    const instanceKey = `${this.name}:${key}`;

    if (!EventEmitterSingletonService.instances.has(instanceKey)) {
      EventEmitterSingletonService.instances.set(
        instanceKey,
        new this(...args)
      );
    }
    return EventEmitterSingletonService.instances.get(instanceKey) as T;
  }

  /**
   * Clears all singleton instances.
   */
  public static clearAllInstances(): void {
    EventEmitterSingletonService.instances.clear();
  }

  /**
   * Clears a specific singleton instance by class name.
   *
   * @param className - The name of the class to clear
   */
  public static clearInstance(className: string): void {
    EventEmitterSingletonService.instances.delete(className);
  }

  /**
   * Protected constructor to prevent direct instantiation.
   */
  protected constructor() {
    super();
  }
}

/**
 * Async singleton service that extends EventEmitter with async initialization support.
 * For EventEmitter services that require async setup.
 *
 * @example
 * ```typescript
 * export class RealtimeService extends AsyncEventEmitterSingletonService<RealtimeService> {
 *   static async getInstance(): Promise<RealtimeService> {
 *     return super.getInstanceAsync(async (instance) => {
 *       await instance.connect();
 *     });
 *   }
 *
 *   private async connect(): Promise<void> {
 *     // Setup connection
 *     this.emit('connected');
 *   }
 * }
 * ```
 */
export abstract class AsyncEventEmitterSingletonService<
  T extends AsyncEventEmitterSingletonService<T>
> extends EventEmitterSingletonService<T> {
  private static initializationPromises = new Map<
    string,
    Promise<AsyncEventEmitterSingletonService<T>>
  >();
  private static initializedInstances = new Set<string>();

  /**
   * Gets or creates the singleton instance with async initialization.
   *
   * @returns Promise resolving to the singleton instance
   */
  public static override async getInstance<
    T extends AsyncEventEmitterSingletonService<T>
  >(this: new (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
    const className = this.name;

    // If already initialized, return immediately
    if (AsyncEventEmitterSingletonService.initializedInstances.has(className)) {
      return EventEmitterSingletonService.getInstance.call(this, ...args) as T;
    }

    // If initialization is in progress, wait for it
    if (
      AsyncEventEmitterSingletonService.initializationPromises.has(className)
    ) {
      await AsyncEventEmitterSingletonService.initializationPromises.get(
        className
      );
      return EventEmitterSingletonService.getInstance.call(this, ...args) as T;
    }

    // Start new initialization
    const instance = EventEmitterSingletonService.getInstance.call(
      this,
      ...args
    ) as T;

    AsyncEventEmitterSingletonService.initializedInstances.add(className);

    return instance;
  }

  /**
   * Checks if a service has been initialized.
   *
   * @param className - The name of the class to check
   * @returns Whether the service has been initialized
   */
  public static isInitialized(className: string): boolean {
    return AsyncEventEmitterSingletonService.initializedInstances.has(
      className
    );
  }

  /**
   * Clears all singleton instances and their initialization state.
   */
  public static override clearAllInstances(): void {
    AsyncEventEmitterSingletonService.initializationPromises.clear();
    AsyncEventEmitterSingletonService.initializedInstances.clear();
  }
}
