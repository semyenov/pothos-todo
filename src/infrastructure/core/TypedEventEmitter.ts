import { EventEmitter } from 'events';

/**
 * Base event map that all service event maps should extend
 */
export interface ServiceEventMap {
  'service:initialized': { serviceName: string; timestamp: Date };
  'service:started': { serviceName: string; port?: number };
  'service:stopped': { serviceName: string; reason?: string };
  'service:error': { serviceName: string; error: Error; context?: string };
  'config:changed': { oldConfig: any; newConfig: any };
  'health:changed': { status: HealthStatus; checks: HealthCheckResult[] };
  'metric:recorded': { name: string; value: number; tags?: Record<string, string> };
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

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
export class TypedEventEmitter<TEventMap extends Record<string, unknown[]>> {
  private emitter = new EventEmitter();
  private listenerCounts = new Map<keyof TEventMap, number>();

  /**
   * Maximum number of listeners per event (to prevent memory leaks)
   */
  private maxListeners = 100;

  constructor() {
    this.emitter.setMaxListeners(this.maxListeners);
  }

  /**
   * Register an event listener with type-safe event name and payload
   */
  on<K extends keyof TEventMap>(
    event: K,
    listener: (data: TEventMap[K]) => void | Promise<void>
  ): this {
    const count = this.listenerCounts.get(event) || 0;
    if (count >= this.maxListeners) {
      console.warn(`Warning: Possible memory leak detected. ${String(event)} has ${count} listeners.`);
    }

    this.emitter.on(event as string, listener);
    this.listenerCounts.set(event, count + 1);
    return this;
  }

  /**
   * Register a one-time event listener
   */
  once<K extends keyof TEventMap>(
    event: K,
    listener: (data: TEventMap[K]) => void | Promise<void>
  ): this {
    const wrappedListener = (data: TEventMap[K]) => {
      this.decrementListenerCount(event);
      listener(data);
    };

    this.emitter.once(event as string, wrappedListener);
    const count = this.listenerCounts.get(event) || 0;
    this.listenerCounts.set(event, count + 1);
    return this;
  }

  /**
   * Emit an event with type-safe payload
   */
  emit<K extends keyof TEventMap>(
    event: K,
    data: TEventMap[K]
  ): boolean {
    return this.emitter.emit(event as string, data);
  }

  /**
   * Emit an event asynchronously (waits for all listeners to complete)
   */
  async emitAsync<K extends keyof TEventMap>(
    event: K,
    data: TEventMap[K]
  ): Promise<void> {
    const listeners = this.emitter.listeners(event as string) as Array<(data: TEventMap[K]) => void | Promise<void>>;

    await Promise.all(
      listeners.map(listener => Promise.resolve(listener(data)))
    );
  }

  /**
   * Remove a specific event listener
   */
  off<K extends keyof TEventMap>(
    event: K,
    listener: (data: TEventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.off(event as string, listener);
    this.decrementListenerCount(event);
    return this;
  }

  /**
   * Remove all listeners for a specific event or all events
   */
  removeAllListeners<K extends keyof TEventMap>(event?: K): this {
    if (event) {
      this.emitter.removeAllListeners(event as string);
      this.listenerCounts.delete(event);
    } else {
      this.emitter.removeAllListeners();
      this.listenerCounts.clear();
    }
    return this;
  }

  /**
   * Get the number of listeners for a specific event
   */
  listenerCount<K extends keyof TEventMap>(event: K): number {
    return this.listenerCounts.get(event) || 0;
  }

  /**
   * Get all event names that have listeners
   */
  eventNames(): Array<keyof TEventMap> {
    return Array.from(this.listenerCounts.keys());
  }

  /**
   * Set the maximum number of listeners per event
   */
  setMaxListeners(max: number): this {
    this.maxListeners = max;
    this.emitter.setMaxListeners(max);
    return this;
  }

  /**
   * Wait for an event to be emitted
   */
  waitFor<K extends keyof TEventMap>(
    event: K,
    timeout?: number
  ): Promise<TEventMap[K]> {
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
          this.off(event, handler);
          reject(new Error(`Timeout waiting for event: ${String(event)}`));
        }, timeout)
        : null;

      const handler = (data: TEventMap[K]) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      };

      this.once(event, handler);
    });
  }

  /**
   * Create a typed event interceptor
   */
  intercept<K extends keyof TEventMap>(
    event: K,
    interceptor: (data: TEventMap[K]) => TEventMap[K] | null | Promise<TEventMap[K] | null>
  ): () => void {
    const originalEmit = this.emit.bind(this);
    const originalEmitAsync = this.emitAsync.bind(this);

    // Override emit to intercept specific event
    this.emit = <E extends keyof TEventMap>(e: E, data: TEventMap[E]) => {
      if (e === event) {
        const result = interceptor(data as unknown as TEventMap[K]);
        if (result === null) return false;
        if (result instanceof Promise) {
          console.warn('Async interceptor used with sync emit. Consider using emitAsync.');
          return false;
        }
        return originalEmit(e, result as TEventMap[E]);
      }
      return originalEmit(e, data);
    };

    // Override emitAsync for async interceptors
    this.emitAsync = async <E extends keyof TEventMap>(e: E, data: TEventMap[E]) => {
      if (e === event) {
        const result = await interceptor(data as unknown as TEventMap[K]);
        if (result === null) return;
        return originalEmitAsync(e, result as TEventMap[E]);
      }
      return originalEmitAsync(e, data);
    };

    // Return cleanup function
    return () => {
      this.emit = originalEmit;
      this.emitAsync = originalEmitAsync;
    };
  }

  /**
   * Pipe events from this emitter to another
   */
  pipe<K extends keyof TEventMap, TTargetMap extends Record<string, any>>(
    event: K,
    target: TypedEventEmitter<TTargetMap>,
    targetEvent: keyof TTargetMap,
    transform?: (data: TEventMap[K]) => TTargetMap[keyof TTargetMap]
  ): () => void {
    const handler = (data: TEventMap[K]) => {
      const transformed = transform ? transform(data) : data;
      target.emit(targetEvent, transformed as TTargetMap[keyof TTargetMap]);
    };

    this.on(event, handler);

    // Return cleanup function
    return () => {
      this.off(event, handler);
    };
  }

  private decrementListenerCount<K extends keyof TEventMap>(event: K): void {
    const count = this.listenerCounts.get(event) || 0;
    if (count > 0) {
      this.listenerCounts.set(event, count - 1);
    }
    if (count === 1) {
      this.listenerCounts.delete(event);
    }
  }
}

/**
 * Type helper for extracting event data type from an event map
 */
export type EventData<TEventMap, K extends keyof TEventMap> = TEventMap[K];

/**
 * Type helper for event listener functions
 */
export type EventListener<TEventMap, K extends keyof TEventMap> = (
  data: EventData<TEventMap, K>
) => void | Promise<void>;