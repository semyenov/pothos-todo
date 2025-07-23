# New Enterprise Service Architecture

## Overview

The infrastructure services have been migrated from legacy singleton patterns to a new enterprise-grade BaseService architecture that provides:

- **Automatic Configuration Management**: Services load and validate configuration automatically
- **Type-Safe Event System**: Strongly typed events with IntelliSense support
- **Built-in Health Checks**: Decorated methods for health monitoring
- **Comprehensive Metrics**: Automatic metric collection with decorators
- **Resilience Patterns**: Circuit breakers, retries, and timeouts
- **Hot Reload Support**: Configuration changes without service restarts
- **Resource Management**: Automatic cleanup of resources on shutdown

## Architecture Components

### 1. BaseService and BaseAsyncService

The foundation of the new architecture:

```typescript
// For synchronous services
export class MyService extends BaseService<MyConfig, MyEventMap> {
  protected getServiceName(): string {
    return 'my-service';
  }
}

// For asynchronous services
export class MyAsyncService extends BaseAsyncService<MyConfig, MyEventMap> {
  static async getInstance(): Promise<MyAsyncService> {
    return super.getInstance();
  }
}
```

### 2. Configuration Management

Services use Zod schemas for configuration validation:

```typescript
const MyServiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default('localhost'),
  port: z.number().default(8080),
  timeout: z.number().min(1000).default(30000),
});

@ServiceConfig({
  schema: MyServiceConfigSchema,
  prefix: 'my_service',  // Environment variable prefix: MY_SERVICE_
  hot: true,             // Enable hot reload
})
export class MyService extends BaseService<MyServiceConfig, MyEventMap> {
  // Configuration is automatically loaded and available as this.config
}
```

### 3. Type-Safe Event System

Events are strongly typed using TypeScript interfaces:

```typescript
export interface MyServiceEventMap extends ServiceEventMap {
  'connection:established': { host: string; port: number; duration: number };
  'request:processed': { method: string; path: string; status: number };
  'error:occurred': { error: Error; context: string };
}

// In service
this.emit('connection:established', {
  host: 'localhost',
  port: 8080,
  duration: 123,
});

// Consumers get full type safety
service.on('connection:established', ({ host, port, duration }) => {
  // TypeScript knows the exact shape of the event data
});
```

### 4. Decorators for Cross-Cutting Concerns

#### Health Checks
```typescript
@HealthCheck({
  name: 'database:connection',
  critical: true,
  interval: 30000,
  timeout: 5000,
})
async checkDatabaseConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  // Health check implementation
}
```

#### Metrics
```typescript
@Metric({ 
  name: 'api.request', 
  recordDuration: true 
})
async handleRequest(req: Request): Promise<Response> {
  // Method execution time is automatically recorded
}
```

#### Circuit Breaker
```typescript
@CircuitBreaker({ 
  threshold: 5,      // Open after 5 failures
  timeout: 30000,    // Timeout for half-open state
  resetTime: 60000,  // Time before attempting reset
})
async riskyOperation(): Promise<void> {
  // Protected operation
}
```

#### Retry Logic
```typescript
@Retry({ 
  attempts: 3, 
  delay: 1000,
  backoff: 'exponential',
  retryIf: (error) => error.code === 'ETIMEDOUT'
})
async networkOperation(): Promise<void> {
  // Automatically retried on failure
}
```

## Migration Guide

### From SingletonService

**Before:**
```typescript
export class OldService extends SingletonService<OldService> {
  static getInstance(): OldService {
    return super.getInstance();
  }
  
  private config: any;
  
  constructor() {
    super();
    this.config = {
      host: process.env.SERVICE_HOST || 'localhost',
      port: parseInt(process.env.SERVICE_PORT || '8080'),
    };
  }
}
```

**After:**
```typescript
const ServiceConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(8080),
});

@ServiceConfig({
  schema: ServiceConfigSchema,
  prefix: 'service',
  hot: true,
})
export class NewService extends BaseService<ServiceConfig, ServiceEventMap> {
  static getInstance(): NewService {
    return super.getInstance();
  }
  
  protected getServiceName(): string {
    return 'new-service';
  }
  
  protected async onInitialize(): Promise<void> {
    // Initialization logic
  }
  
  protected async onStart(): Promise<void> {
    // this.config is automatically available
  }
}
```

### From EventEmitterSingletonService

**Before:**
```typescript
export class OldEventService extends EventEmitterSingletonService<OldEventService> {
  emitDataProcessed(data: any): void {
    this.emit('data-processed', data);
  }
}
```

**After:**
```typescript
export interface ServiceEventMap extends ServiceEventMap {
  'data:processed': { id: string; size: number; duration: number };
}

@ServiceConfig({
  schema: ServiceConfigSchema,
  prefix: 'event_service',
})
export class NewEventService extends BaseService<ServiceConfig, ServiceEventMap> {
  processData(data: any): void {
    this.emit('data:processed', {
      id: data.id,
      size: data.size,
      duration: 123,
    });
  }
}
```

## Service Lifecycle

Services follow a well-defined lifecycle:

1. **Construction**: Service instance is created
2. **Configuration**: Configuration is loaded and validated
3. **Initialization**: `onInitialize()` is called
4. **Starting**: `onStart()` is called
5. **Running**: Service is operational
6. **Stopping**: `onStop()` is called
7. **Cleanup**: Resources are automatically disposed

```typescript
export class MyService extends BaseAsyncService<Config, EventMap> {
  protected async onInitialize(): Promise<void> {
    // Load dependencies, validate environment
    logger.info('Service initializing');
  }
  
  protected async onStart(): Promise<void> {
    // Start connections, begin processing
    logger.info('Service starting');
  }
  
  protected async onStop(): Promise<void> {
    // Graceful shutdown logic
    logger.info('Service stopping');
  }
  
  protected async onConfigChanged(oldConfig: Config, newConfig: Config): Promise<void> {
    // Handle configuration changes (hot reload)
    if (oldConfig.host !== newConfig.host) {
      await this.restart();
    }
  }
}
```

## Resource Management

Services can track resources for automatic cleanup:

```typescript
protected async onStart(): Promise<void> {
  // Create a managed resource
  this.connection = this.createResource({
    resource: await createConnection(this.config),
    dispose: async () => {
      await this.connection.close();
    },
  });
  
  // Resource will be automatically cleaned up on service stop
}
```

## Best Practices

### 1. Configuration Schema Design

```typescript
const ConfigSchema = z.object({
  // Group related settings
  connection: z.object({
    host: z.string(),
    port: z.number(),
    timeout: z.number(),
  }),
  
  // Use sensible defaults
  retries: z.number().min(0).max(10).default(3),
  
  // Document with descriptions
  enableCache: z.boolean().default(true).describe('Enable response caching'),
  
  // Validate complex values
  endpoints: z.array(z.string().url()).min(1),
});
```

### 2. Event Naming Conventions

- Use namespace:action format: `database:connected`, `cache:miss`
- Be consistent with tense: past for completed actions, present for ongoing
- Include relevant data but avoid sensitive information

### 3. Health Check Implementation

```typescript
@HealthCheck({
  name: 'service:dependencies',
  critical: true,
  interval: 60000,
})
async checkDependencies(): Promise<HealthCheckResult> {
  const checks = await Promise.allSettled([
    this.checkDatabase(),
    this.checkCache(),
    this.checkExternalAPI(),
  ]);
  
  const failures = checks.filter(c => c.status === 'rejected');
  
  if (failures.length === 0) {
    return { status: 'healthy', message: 'All dependencies healthy' };
  } else if (failures.length < checks.length) {
    return { status: 'degraded', message: `${failures.length} dependencies unhealthy` };
  } else {
    return { status: 'unhealthy', message: 'All dependencies unhealthy' };
  }
}
```

### 4. Error Handling

```typescript
protected async onStart(): Promise<void> {
  try {
    await this.connect();
  } catch (error) {
    // Emit error event
    this.emit('service:error', {
      error: error as Error,
      phase: 'startup',
      fatal: true,
    });
    
    // Let BaseService handle the error
    throw error;
  }
}
```

## Migration Tools

Use the automated migration script:

```bash
# Analyze services in a directory
bun scripts/migrate-to-base-service.ts --path src/infrastructure --dry-run

# Migrate a specific service
bun scripts/migrate-to-base-service.ts --file src/infrastructure/MyService.ts

# Migrate all async services
bun scripts/migrate-to-base-service.ts --path src/infrastructure --type async
```

## Examples

### Complete Service Example

```typescript
import { z } from 'zod';
import { BaseAsyncService } from '../core/BaseAsyncService.js';
import { ServiceEventMap } from '../core/ServiceEventMaps.js';
import { ServiceConfig, Retry, CircuitBreaker, HealthCheck, Metric } from '../core/decorators/ServiceDecorators.js';

// Configuration
const DataProcessorConfigSchema = z.object({
  batchSize: z.number().min(1).max(1000).default(100),
  processingInterval: z.number().min(1000).default(5000),
  maxRetries: z.number().min(0).default(3),
});

type DataProcessorConfig = z.infer<typeof DataProcessorConfigSchema>;

// Events
interface DataProcessorEventMap extends ServiceEventMap {
  'batch:processed': { count: number; duration: number };
  'item:failed': { id: string; error: Error };
  'queue:empty': { timestamp: Date };
}

// Service
@ServiceConfig({
  schema: DataProcessorConfigSchema,
  prefix: 'data_processor',
  hot: true,
})
export class DataProcessor extends BaseAsyncService<DataProcessorConfig, DataProcessorEventMap> {
  private queue: DataItem[] = [];
  private processingInterval?: NodeJS.Timeout;
  
  static async getInstance(): Promise<DataProcessor> {
    return super.getInstance();
  }
  
  protected getServiceName(): string {
    return 'data-processor';
  }
  
  protected getServiceVersion(): string {
    return '1.0.0';
  }
  
  protected async onStart(): Promise<void> {
    this.processingInterval = setInterval(
      () => this.processBatch(),
      this.config.processingInterval
    );
  }
  
  protected async onStop(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    // Process remaining items
    if (this.queue.length > 0) {
      await this.processBatch();
    }
  }
  
  @Metric({ name: 'processor.batch', recordDuration: true })
  @Retry({ attempts: 3, delay: 1000 })
  private async processBatch(): Promise<void> {
    if (this.queue.length === 0) {
      this.emit('queue:empty', { timestamp: new Date() });
      return;
    }
    
    const batch = this.queue.splice(0, this.config.batchSize);
    const start = Date.now();
    
    for (const item of batch) {
      try {
        await this.processItem(item);
      } catch (error) {
        this.emit('item:failed', {
          id: item.id,
          error: error as Error,
        });
      }
    }
    
    this.emit('batch:processed', {
      count: batch.length,
      duration: Date.now() - start,
    });
  }
  
  @HealthCheck({
    name: 'processor:queue',
    critical: false,
    interval: 30000,
  })
  async checkQueueHealth(): Promise<{ status: 'healthy' | 'degraded'; message: string }> {
    if (this.queue.length > 1000) {
      return { 
        status: 'degraded', 
        message: `Queue backlog high: ${this.queue.length} items` 
      };
    }
    
    return { 
      status: 'healthy', 
      message: `Queue size: ${this.queue.length}` 
    };
  }
}
```

## Benefits

### Code Reduction
- **40-60% less boilerplate** compared to legacy patterns
- Automatic configuration management eliminates manual parsing
- Decorators replace repetitive try-catch and timing code

### Type Safety
- **100% typed events** with IntelliSense support
- Configuration validation at startup
- Compile-time checking for event payloads

### Operational Excellence
- Built-in health monitoring
- Comprehensive metrics collection
- Automatic resource cleanup
- Graceful shutdown handling

### Developer Experience
- Clear, consistent patterns
- Self-documenting through decorators
- Hot reload for faster development
- Comprehensive error messages

## Migration Status

### Completed Migrations
- ✅ ChaosEngineeringSystem
- ✅ ServiceRegistry
- ✅ ServiceMesh
- ✅ MessageBroker
- ✅ CQRSCoordinator
- ✅ ReadModelManager
- ✅ PrismaService
- ✅ CacheManager

### Migration Tools Available
- Automated migration script: `scripts/migrate-to-base-service.ts`
- Configuration schema templates: `src/config/schemas/infrastructure.ts`
- Event map definitions: `src/infrastructure/core/InfrastructureEventMaps.ts`

### Next Steps
1. Continue migrating remaining services using the migration script
2. Update service documentation with new patterns
3. Add service-specific health checks and metrics
4. Configure hot reload for development efficiency
5. Set up centralized monitoring dashboard