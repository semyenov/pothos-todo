import { EventEmitter } from "events";

// Update EventMap to be a simple record type for better TypeScript compatibility
type EventMap<T = any> = Record<string | symbol, any[]>;

/**
 * Base event map that all service event maps should extend
 */
export type ServiceEventMap = {
  "service:initialized": [{ serviceName: string; timestamp: Date }];
  "service:started": [{ serviceName: string; port?: number }];
  "service:stopped": [{ serviceName: string; reason?: string }];
  "service:error": [{ serviceName: string; error: Error; context?: string }];
  "config:changed": [{ oldConfig: any; newConfig: any }];
  "health:changed": [{ status: HealthStatus; checks: HealthCheckResult[] }];
  "metric:recorded": [{
    name: string;
    value: number;
    tags?: Record<string, string>;
  }];
};

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  duration?: number;
  timestamp: Date;
}

/**
 * Strongly-typed EventEmitter that provides compile-time safety for event names and payloads.
 * This eliminates runtime errors from typos and incorrect event data structures.
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'data:received': { id: string; data: any };
 *   'error:occurred': { error: Error; retry: boolean };
 * }
 *
 * class MyService extends TypedEventEmitter<MyEvents> {
 *   processData(id: string, data: any) {
 *     this.emit('data:received', { id, data }); // Type-safe!
 *   }
 * }
 * ```
 */
export class TypedEventEmitter<
  TEventMap extends EventMap<any> = EventMap<any>,
  TEventKey extends keyof TEventMap = keyof TEventMap
> extends EventEmitter {
  /**
   * Maximum number of listeners per event (to prevent memory leaks)
   */
  private readonly maxListeners = 100;

  constructor() {
    super();
    this.setMaxListeners(this.maxListeners);
  }

  /**
   * Type-safe emit method
   */
  emit<K extends keyof TEventMap>(event: K, ...args: TEventMap[K]): boolean {
    return super.emit(event as string, ...args);
  }

  /**
   * Type-safe on method
   */
  on<K extends keyof TEventMap>(
    event: K,
    listener: (...args: TEventMap[K]) => void
  ): this {
    return super.on(event as string, listener as any);
  }

  /**
   * Type-safe once method
   */
  once<K extends keyof TEventMap>(
    event: K,
    listener: (...args: TEventMap[K]) => void
  ): this {
    return super.once(event as string, listener as any);
  }

  /**
   * Type-safe off method
   */
  off<K extends keyof TEventMap>(
    event: K,
    listener: (...args: TEventMap[K]) => void
  ): this {
    return super.off(event as string, listener as any);
  }

  /**
   * Type-safe removeListener method
   */
  removeListener<K extends keyof TEventMap>(
    event: K,
    listener: (...args: TEventMap[K]) => void
  ): this {
    return super.removeListener(event as string, listener as any);
  }

  /**
   * Type-safe addListener method
   */
  addListener<K extends keyof TEventMap>(
    event: K,
    listener: (...args: TEventMap[K]) => void
  ): this {
    return super.addListener(event as string, listener as any);
  }

  /**
   * Emit an event asynchronously (waits for all listeners to complete)
   */
  async emitAsync<K extends keyof TEventMap>(
    event: K,
    ...args: TEventMap[K]
  ): Promise<void> {
    const listeners = this.listeners(event as string);

    await Promise.all(
      listeners.map((listener) => Promise.resolve(listener(...args)))
    );
  }
}
