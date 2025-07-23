# Hive Gateway Migration Plan

## Overview

This document outlines the migration plan from the current GraphQL setup (with placeholder Apollo Federation) to GraphQL Hive Gateway. The migration will enable true federation capabilities with a modern, open-source gateway solution.

## Current State Analysis

### What We Have
- **GraphQL Server**: GraphQL Yoga with Pothos schema builder
- **Federation Plugin**: Installed but not actively used
- **Placeholder Components**: Basic federation structure without implementation
- **Monolithic Service**: Currently running as a single GraphQL service
- **Enterprise Features**: Advanced caching, monitoring, and infrastructure ready

### What Needs Change
- Replace Apollo Gateway dependencies with Hive Gateway
- Implement actual federation with proper subgraph separation
- Configure schema registry integration
- Set up CDN-based schema distribution

## Migration Phases

### Phase 1: Preparation (Week 1)

#### 1.1 Environment Setup
```bash
# Add to .env
HIVE_ENDPOINT=https://app.graphql-hive.com
HIVE_TOKEN=your-hive-token
HIVE_CDN_ENDPOINT=https://cdn.graphql-hive.com/artifacts/v1/TARGET_ID
HIVE_CDN_KEY=your-cdn-key
FEDERATION_TYPE=hive  # for gradual migration
```

#### 1.2 Install Dependencies
```bash
# Remove Apollo dependencies
bun remove @apollo/gateway @apollo/server @apollo/subgraph

# Add Hive dependencies
bun add @graphql-hive/gateway @graphql-hive/client @graphql-mesh/utils
```

#### 1.3 Create Configuration Module
```typescript
// src/config/hive-gateway.config.ts
export const hiveGatewayConfig = {
  supergraph: {
    type: 'hive' as const,
    endpoint: process.env.HIVE_CDN_ENDPOINT!,
    key: process.env.HIVE_CDN_KEY!,
    pollIntervalInMs: 10_000,
  },
  reporting: {
    enabled: true,
    token: process.env.HIVE_TOKEN!,
    usage: {
      enabled: true,
    },
  },
  plugins: [
    // Add existing plugins
  ],
};
```

### Phase 2: Subgraph Implementation (Week 2)

#### 2.1 Split Monolith into Subgraphs

**User Subgraph** (`src/subgraphs/user/`)
- Extract user-related types, queries, and mutations
- Add federation directives (@key, @shareable)
- Create standalone user service

**Todo Subgraph** (`src/subgraphs/todo/`)
- Extract todo-related functionality
- Define entity references to User
- Implement field resolvers for cross-service data

**AI Subgraph** (`src/subgraphs/ai/`)
- Separate AI/ML features into dedicated service
- Maintain connection to Todo entities
- Handle vector search and embeddings

#### 2.2 Add Federation Directives
```typescript
// Example: User type with federation
builder.objectType('User', {
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    // ... other fields
  }),
  extensions: {
    directives: {
      key: { fields: 'id' },
    },
  },
});
```

### Phase 3: Gateway Implementation (Week 3)

#### 3.1 Create Hive Gateway Service
```typescript
// src/infrastructure/gateway/HiveGatewayService.ts
import { createGateway } from '@graphql-hive/gateway';

export class HiveGatewayService {
  private gateway: Gateway;

  async initialize() {
    this.gateway = await createGateway({
      supergraph: {
        type: 'hive',
        endpoint: config.hive.cdn.endpoint,
        key: config.hive.cdn.key,
      },
      plugins: [
        useResponseCache(),
        useRateLimiting(),
        useAuthentication(),
      ],
    });
  }
}
```

#### 3.2 Update FederationManager
- Replace Apollo-specific code with Hive Gateway
- Maintain existing health monitoring
- Update service discovery for Hive

#### 3.3 Integrate with Infrastructure
- Connect to MetricsCollector
- Update OpenTelemetry integration
- Configure Redis caching for CDN

### Phase 4: Testing & Validation (Week 4)

#### 4.1 Create Test Suite
- Unit tests for subgraph schemas
- Integration tests for federation
- Performance benchmarks
- Load testing with federated setup

#### 4.2 Gradual Rollout
1. Run Hive Gateway alongside existing service
2. Route test traffic through gateway
3. Monitor performance and errors
4. Gradually increase traffic percentage
5. Full cutover when stable

### Phase 5: Production Deployment (Week 5)

#### 5.1 Deployment Strategy
```yaml
# Docker Compose for local development
services:
  hive-gateway:
    image: ghcr.io/graphql-hive/gateway:latest
    environment:
      - HIVE_CDN_ENDPOINT=${HIVE_CDN_ENDPOINT}
      - HIVE_CDN_KEY=${HIVE_CDN_KEY}
    ports:
      - "4000:4000"
  
  user-subgraph:
    build: ./src/subgraphs/user
    ports:
      - "4001:4001"
  
  todo-subgraph:
    build: ./src/subgraphs/todo
    ports:
      - "4002:4002"
  
  ai-subgraph:
    build: ./src/subgraphs/ai
    ports:
      - "4003:4003"
```

#### 5.2 Monitoring Setup
- Configure Hive Platform dashboard
- Set up alerts for schema changes
- Monitor gateway performance
- Track subgraph health

## Configuration Changes

### Base Configuration Update
```typescript
// config/base.config.ts
export default {
  // ... existing config
  federation: {
    type: process.env.FEDERATION_TYPE || 'hive',
    hive: {
      endpoint: process.env.HIVE_ENDPOINT,
      token: process.env.HIVE_TOKEN,
      cdn: {
        endpoint: process.env.HIVE_CDN_ENDPOINT,
        key: process.env.HIVE_CDN_KEY,
      },
      polling: {
        interval: 10000,
        timeout: 30000,
      },
    },
    subgraphs: [
      {
        name: 'user',
        url: process.env.USER_SUBGRAPH_URL || 'http://localhost:4001/graphql',
      },
      {
        name: 'todo',
        url: process.env.TODO_SUBGRAPH_URL || 'http://localhost:4002/graphql',
      },
      {
        name: 'ai',
        url: process.env.AI_SUBGRAPH_URL || 'http://localhost:4003/graphql',
      },
    ],
  },
};
```

### Package.json Scripts
```json
{
  "scripts": {
    // ... existing scripts
    "gateway:dev": "bun run --watch src/gateway/index.ts",
    "subgraph:user": "bun run --watch src/subgraphs/user/index.ts",
    "subgraph:todo": "bun run --watch src/subgraphs/todo/index.ts",
    "subgraph:ai": "bun run --watch src/subgraphs/ai/index.ts",
    "federation:dev": "concurrently \"bun run gateway:dev\" \"bun run subgraph:*\"",
    "hive:publish": "bunx @graphql-hive/cli schema:publish",
    "hive:check": "bunx @graphql-hive/cli schema:check"
  }
}
```

## Compatibility Checklist

### ✅ Compatible Features
- [x] GraphQL Subscriptions (WebSocket, SSE)
- [x] Query batching
- [x] JWT authentication
- [x] Authorization with directives
- [x] Response caching
- [x] Rate limiting
- [x] OpenTelemetry integration
- [x] Persisted documents
- [x] GraphQL Yoga compatibility

### ⚠️ Features Requiring Adaptation
- [ ] Custom Apollo directives → Hive directives
- [ ] Apollo Studio reporting → Hive Platform reporting
- [ ] Apollo-specific plugins → Hive plugins
- [ ] Managed federation → Hive Registry

### 🔄 Migration Tasks
- [ ] Update CI/CD pipelines
- [ ] Modify Docker configurations
- [ ] Update monitoring dashboards
- [ ] Revise documentation
- [ ] Train team on Hive Platform

## Benefits After Migration

1. **Open Source**: No vendor lock-in, MIT licensed
2. **Cost Effective**: Essential features not behind paywall
3. **Performance**: CDN-based schema distribution
4. **Flexibility**: Multiple deployment options
5. **Modern Architecture**: Better support for edge computing
6. **Community**: Active development and support

## Rollback Plan

If issues arise during migration:
1. Keep existing monolithic service running
2. Use feature flags to toggle federation
3. Maintain Apollo dependencies during transition
4. Document all changes for easy reversal
5. Keep backup of current configuration

## Success Metrics

- [ ] All queries/mutations working through gateway
- [ ] Performance metrics equal or better
- [ ] Successful schema composition
- [ ] Zero downtime during migration
- [ ] All tests passing
- [ ] Monitoring and alerting functional

## Timeline

- **Week 1**: Preparation and setup
- **Week 2**: Subgraph implementation
- **Week 3**: Gateway integration
- **Week 4**: Testing and validation
- **Week 5**: Production deployment
- **Week 6**: Monitoring and optimization

## Next Steps

1. Review and approve migration plan
2. Set up Hive Platform account
3. Create development environment
4. Begin Phase 1 implementation
5. Schedule team training sessions