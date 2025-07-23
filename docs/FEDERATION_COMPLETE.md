# Complete GraphQL Federation Setup with Hive Gateway

This document provides a comprehensive guide to the GraphQL federation implementation using Hive Gateway, including all production-ready features.

## 🏗️ Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User     │     │    Todo     │     │     AI      │
│  Subgraph   │     │  Subgraph   │     │  Subgraph   │
│  (Port 4001)│     │  (Port 4002)│     │  (Port 4003)│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                    │
       └───────────────────┴────────────────────┘
                           │
                    ┌──────▼──────┐
                    │    Hive     │
                    │   Gateway   │
                    │ (Port 4000) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Clients   │
                    └─────────────┘
```

## 🚀 Quick Start

### Development Mode
```bash
# Start federation with proper environment setup
bun run federation:docker:dev

# Access services
- Gateway: http://localhost:4000/graphql
- Status Page: http://localhost:4444
- User Subgraph: http://localhost:4001/graphql
- Todo Subgraph: http://localhost:4002/graphql
- AI Subgraph: http://localhost:4003/graphql
```

### Production Mode
```bash
# Set Hive credentials in .env
HIVE_CDN_ENDPOINT=your-endpoint
HIVE_CDN_KEY=your-key
HIVE_TOKEN=your-token

# Start production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 📊 Monitoring Stack

### Start Monitoring Services
```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

# Access monitoring tools
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)
- Jaeger: http://localhost:16686
```

### Available Metrics
- GraphQL query performance
- Subgraph response times
- Cache hit rates
- Error rates
- System resources

## 🔧 Configuration

### Environment Variables
```bash
# Gateway Configuration
GATEWAY_PORT=4000
LOG_LEVEL=info
CORS_ORIGIN=https://app.example.com

# Hive Platform (Production)
HIVE_CDN_ENDPOINT=https://cdn.graphql-hive.com
HIVE_CDN_KEY=your-cdn-key
HIVE_TOKEN=your-hive-token

# Subgraph URLs (Development)
USER_SUBGRAPH_URL=http://user-subgraph:4001/graphql
TODO_SUBGRAPH_URL=http://todo-subgraph:4002/graphql
AI_SUBGRAPH_URL=http://ai-subgraph:4003/graphql

# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/pothos_todo

# Redis
REDIS_URL=redis://redis:6379
REDIS_PASSWORD=your-redis-password

# AI Services
OPENAI_API_KEY=your-openai-key
QDRANT_URL=http://qdrant:6333

# Telemetry
TELEMETRY_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
```

## 🏢 Production Features

### 1. High Availability
- Multiple gateway replicas with load balancing
- Subgraph health checks and automatic failover
- Circuit breakers for fault tolerance

### 2. Performance Optimization
- Response caching with intelligent invalidation
- Query complexity analysis
- DataLoader pattern for N+1 prevention
- Connection pooling

### 3. Security
- Rate limiting per IP/user
- CORS configuration
- Authentication integration
- Query depth limiting

### 4. Observability
- Distributed tracing with OpenTelemetry
- Prometheus metrics
- Grafana dashboards
- Real-time status monitoring

## 📝 Development Workflow

### Adding New Features
1. Update domain models in appropriate subgraph
2. Implement resolver logic
3. Test locally with development gateway
4. Deploy and register with Hive Platform

### Testing Federation
```bash
# Run comprehensive tests
./scripts/test-federation-queries.sh

# Check federation status
bun run src/federation/status.ts
```

### Schema Management
```bash
# Check schema compatibility
bun run hive:check

# Publish schema to Hive
bun run hive:publish
```

## 🔍 Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Problem: Can't reach database server at localhost:5432
# Solution: Use federation:docker:dev which handles environment correctly
bun run federation:docker:dev
```

#### Schema Composition Errors
```bash
# Check individual subgraph schemas
curl -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name } } }"}'
```

#### Cross-Subgraph Queries Not Working
- Ensure all subgraphs are running
- Check that federation directives are correct
- Verify entity resolvers are implemented

## 🎯 Best Practices

### 1. Schema Design
- Keep subgraphs focused on their domain
- Use consistent naming conventions
- Implement proper error handling

### 2. Performance
- Use DataLoaders for all database queries
- Implement caching at appropriate levels
- Monitor query complexity

### 3. Security
- Never expose internal IDs directly
- Implement field-level authorization
- Use rate limiting for expensive operations

### 4. Deployment
- Always test schema changes locally first
- Use canary deployments for gateway updates
- Monitor error rates after deployments

## 📚 Advanced Topics

### Custom Directives
```graphql
directive @auth(requires: Role = USER) on FIELD_DEFINITION
directive @cache(ttl: Int = 60) on FIELD_DEFINITION
```

### Federation Entities
```typescript
// Extending types across subgraphs
builder.objectType('User', {
  directives: {
    key: { fields: 'id', resolvable: false },
    extends: true,
  },
  fields: (t) => ({
    // Add fields from other subgraphs
  }),
});
```

### Performance Monitoring
```typescript
// Track resolver performance
const tracer = getTracer('subgraph-name');
const span = tracer.startSpan('resolver.user.todos');
// ... resolver logic
span.end();
```

## 🚦 Health Checks

### Gateway Health
```bash
curl http://localhost:4000/health
```

### Subgraph Health
```bash
# Check each subgraph
for port in 4001 4002 4003; do
  echo "Checking port $port:"
  curl -X POST http://localhost:$port/graphql \
    -H "Content-Type: application/json" \
    -d '{"query":"{ __typename }"}'
done
```

## 📈 Scaling

### Horizontal Scaling
- Gateway: 2-4 replicas recommended
- Subgraphs: Scale based on load
- Database: Consider read replicas
- Redis: Use Redis Cluster for high availability

### Resource Requirements
```yaml
# Production recommendations
Gateway: 1-2 CPU, 512MB-1GB RAM
Subgraphs: 0.5-1 CPU, 256-512MB RAM
Database: 2-4 CPU, 2-4GB RAM
Redis: 1 CPU, 1-2GB RAM
```

## 🔗 Resources

- [Hive Platform Documentation](https://docs.graphql-hive.com)
- [Federation Specification](https://www.apollographql.com/docs/federation)
- [Pothos Documentation](https://pothos-graphql.dev)
- [Project README](../README.md)

---

This federation setup provides a production-ready, scalable GraphQL API with comprehensive monitoring, security, and performance features.