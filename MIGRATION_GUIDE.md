# Migration Guide: New Base Service Architecture

This guide helps migrate existing infrastructure services to the new base service architecture with TypedEventEmitter, automatic configuration, and enhanced lifecycle management.

## Overview

The new architecture provides:
- **Strongly-typed events** with TypedEventEmitter
- **Automatic configuration** loading and validation
- **Built-in health checks** and metrics
- **Resource lifecycle management**
- **Decorators** for cross-cutting concerns
- **Hot reload** support for configuration

## Migration Steps

### 1. Choose the Right Base Class

- **BaseService**: For synchronous services (most common)
- **BaseAsyncService**: For services requiring async initialization

```typescript
// Before: SingletonService
export class MyService extends SingletonService<MyService> {
  protected constructor() {
    super();
  }
}

// After: BaseService
export class MyService extends BaseService<MyConfig, MyEventMap> {
  static getInstance(): MyService {
    return super.getInstance();
  }
}
```

### 2. Define Configuration Schema

```typescript
import { z } from 'zod';

const MyServiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default('localhost'),
  port: z.number().default(3000),
  timeout: z.number().default(5000),
});

type MyServiceConfig = z.infer<typeof MyServiceConfigSchema>;
```

### 3. Apply Service Decorator

```typescript
import { ServiceConfig } from '@/infrastructure/core/decorators/ServiceDecorators.js';

@ServiceConfig({
  schema: MyServiceConfigSchema,
  prefix: 'myservice', // Config prefix in environment
  hot: true, // Enable hot reload
})
export class MyService extends BaseService<MyServiceConfig, MyEventMap> {
  // Service implementation
}
```

### 4. Define Event Maps

Use predefined event maps or create custom ones:

```typescript
// Use predefined
import { RedisServiceEventMap } from '@/infrastructure/core/ServiceEventMaps.js';

// Or create custom
interface MyServiceEventMap {
  'service:started': { timestamp: Date };
  'service:error': { error: Error; operation: string };
  'data:processed': { count: number; duration: number };
}
```

### 5. Implement Lifecycle Methods

```typescript
export class MyService extends BaseService<MyServiceConfig, MyServiceEventMap> {
  protected getServiceName(): string {
    return 'my-service';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected async onInitialize(): Promise<void> {
    // One-time initialization
    logger.info('Service initializing...');
  }

  protected async onStart(): Promise<void> {
    // Start resources
    this.client = this.createResource({
      resource: new MyClient(this.config),
      dispose: async () => {
        await this.client.close();
      },
    });
  }

  protected async onStop(): Promise<void> {
    // Resources auto-cleaned by BaseService
    logger.info('Service stopped');
  }

  protected async onConfigChanged(oldConfig: MyConfig, newConfig: MyConfig): Promise<void> {
    // Handle hot reload
    if (oldConfig.host !== newConfig.host) {
      await this.restart();
    }
  }
}
```

### 6. Add Health Checks

```typescript
@HealthCheck({
  name: 'service:connection',
  critical: true,
  interval: 30000,
})
async checkConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  try {
    await this.client.ping();
    return { status: 'healthy', message: 'Connection OK' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}
```

### 7. Apply Method Decorators

```typescript
// Automatic caching
@Cache({ ttl: 300, key: (id) => `user:${id}` })
async getUser(id: string): Promise<User> {
  return this.db.findUser(id);
}

// Retry logic
@Retry({ attempts: 3, backoff: 'exponential' })
async fetchExternalData(): Promise<Data> {
  return this.externalApi.getData();
}

// Circuit breaker
@CircuitBreaker({ threshold: 5, timeout: 10000 })
async callService(): Promise<Result> {
  return this.remoteService.call();
}

// Metrics collection
@Metric({ name: 'api.request', recordDuration: true })
async handleRequest(): Promise<Response> {
  return this.processRequest();
}
```

## Migration Examples

### Example 1: PrismaService Migration

See `src/infrastructure/database/PrismaService.new.ts` for a complete example.

Key changes:
- Extends `BaseAsyncService` (needs async initialization)
- Uses `DatabaseServiceEventMap` for typed events
- Automatic configuration with validation
- Built-in health checks for connection and pool
- Metrics decorators on query methods

### Example 2: CacheManager Migration

See `src/infrastructure/cache/CacheManager.new.ts` for a complete example.

Key changes:
- Uses `RedisServiceEventMap` for Redis-specific events
- Hot reload support for configuration
- Health checks for connection and memory
- Circuit breaker on cache operations
- Automatic resource cleanup

### Example 3: SystemIntegration Migration

See `src/infrastructure/SystemIntegration.new.ts` for a complete example.

Key changes:
- Orchestrates multiple services
- Combined event map for all subsystems
- Complex lifecycle management
- Cross-component integration
- Dynamic feature enabling/disabling

## Common Patterns

### Resource Management

```typescript
// Create tracked resources
const resource = this.createResource({
  resource: new MyResource(),
  dispose: async () => {
    await resource.cleanup();
  },
});
```

### Event Emission

```typescript
// Type-safe event emission
this.emit('data:processed', {
  count: 100,
  duration: 1234,
});

// Listen to events
service.on('data:processed', ({ count, duration }) => {
  console.log(`Processed ${count} items in ${duration}ms`);
});
```

### Configuration Access

```typescript
// Access validated configuration
if (this.config.enabled) {
  await this.connect(this.config.host, this.config.port);
}
```

### Metrics Recording

```typescript
// Record custom metrics
this.recordMetric('custom.metric', value, { tag: 'value' });
```

## Migration Checklist

- [ ] Choose appropriate base class (BaseService vs BaseAsyncService)
- [ ] Define configuration schema with Zod
- [ ] Create or select appropriate event map
- [ ] Apply @ServiceConfig decorator
- [ ] Implement required lifecycle methods
- [ ] Convert initialization to onInitialize/onStart
- [ ] Add health check methods with @HealthCheck
- [ ] Apply method decorators (@Cache, @Retry, etc.)
- [ ] Update resource creation to use createResource()
- [ ] Replace console.log with typed event emissions
- [ ] Test hot reload functionality
- [ ] Update documentation

## Testing Migration

```typescript
// Test the migrated service
const service = await MyService.getInstance();

// Listen to events
service.on('service:started', ({ timestamp }) => {
  console.log(`Service started at ${timestamp}`);
});

// Check health
const health = await service.getHealth();
console.log('Service health:', health);

// Test configuration reload
process.env.MYSERVICE_PORT = '4000';
// Service will automatically reload if hot reload is enabled
```

## Rollback Plan

If issues arise during migration:

1. Keep original service files (.ts)
2. Create new files with .new.ts extension
3. Test thoroughly before replacing
4. Use feature flags to switch between old/new
5. Monitor metrics and health after deployment

## Support

For questions or issues during migration:
- Check existing examples in the codebase
- Review decorator documentation
- Look at test files for usage patterns
- Create detailed error reports with stack traces