# Pulumi Docker Infrastructure

This directory contains Pulumi infrastructure as code for deploying the Pothos GraphQL Todo API using Docker containers. The infrastructure includes complete observability, monitoring, and enterprise-grade features.

## 🚀 Quick Start

### Prerequisites

1. **Install Pulumi**:
   ```bash
   curl -fsSL https://get.pulumi.com | sh
   ```

2. **Install Docker**: Ensure Docker is running on your system

3. **Install Bun**: Required for dependency management
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

### Deploy Development Environment

```bash
# Deploy to development environment
bun run pulumi:dev

# Or use the script directly
./scripts/pulumi-deploy.sh up -s dev
```

### Deploy Production Environment

```bash
# Configure production secrets first
./scripts/pulumi-deploy.sh config -s prod

# Deploy to production
bun run pulumi:prod
```

## 📁 Infrastructure Structure

```
pulumi/
├── index.ts                    # Main entry point (kept for compatibility)
├── docker-infrastructure.ts   # Docker infrastructure configuration
├── docker-deployment.ts       # Pulumi Docker resources and deployment
├── Pulumi.yaml                # Project configuration
├── Pulumi.dev.yaml            # Development stack config
└── Pulumi.prod.yaml           # Production stack config
```

## 🐳 Services Deployed

### Core Application Services
- **App**: Main Pothos GraphQL API server
- **Hive Gateway**: GraphQL Federation gateway
- **PostgreSQL**: Primary database
- **Redis**: Caching and session storage
- **Qdrant**: Vector database for AI features

### Monitoring & Observability
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization and dashboards
- **Jaeger**: Distributed tracing
- **OpenTelemetry**: Telemetry data collection

## ⚙️ Configuration

### Environment Variables

Set these environment variables for production deployment:

```bash
export PULUMI_ACCESS_TOKEN="your-pulumi-token"
export DOCKER_REGISTRY="ghcr.io"
export HIVE_CDN_ENDPOINT="your-hive-endpoint"
export HIVE_CDN_KEY="your-hive-key"
export POSTGRES_PASSWORD="secure-password"
export REDIS_PASSWORD="secure-redis-password"
export GRAFANA_PASSWORD="secure-grafana-password"
```

### Stack Configuration

Configure stack-specific settings:

```bash
# Set environment
pulumi config set environment production

# Set Docker registry
pulumi config set dockerRegistry ghcr.io

# Set secrets
pulumi config set --secret hiveCdnKey "your-secret-key"
pulumi config set --secret postgresPassword "your-db-password"
```

## 🔧 Available Commands

### Deployment Commands

```bash
# Deploy infrastructure
bun run pulumi:up

# Preview changes
bun run pulumi:preview

# Destroy infrastructure
bun run pulumi:down

# Show status
bun run pulumi:status

# Configure settings
bun run pulumi:config
```

### Development vs Production

```bash
# Development deployment
bun run pulumi:dev

# Production deployment  
bun run pulumi:prod
```

### Using the Deployment Script

```bash
# Deploy to development
./scripts/pulumi-deploy.sh up -s dev

# Preview production changes
./scripts/pulumi-deploy.sh preview -s prod

# Destroy staging environment
./scripts/pulumi-deploy.sh down -s staging --force

# Show logs
./scripts/pulumi-deploy.sh logs -s dev

# Backup state
./scripts/pulumi-deploy.sh backup -s prod
```

## 🌐 Service Access

After deployment, services are available at:

### Development Environment
- **GraphQL API**: http://localhost:4000/graphql
- **Hive Gateway**: http://localhost:4001/graphql
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Jaeger**: http://localhost:16686

### Production Environment
- **GraphQL API**: https://api.pothos-todo.com/graphql
- **Hive Gateway**: https://gateway.pothos-todo.com/graphql
- **Monitoring**: https://monitoring.pothos-todo.com
- **Metrics**: https://metrics.pothos-todo.com
- **Tracing**: https://tracing.pothos-todo.com

## 📊 Monitoring & Observability

### Prometheus Metrics

The infrastructure automatically collects metrics from:
- GraphQL API performance
- Federation gateway metrics
- Database query performance
- Redis cache hit rates
- System resource usage
- Custom business metrics

### Grafana Dashboards

Pre-configured dashboards for:
- Application performance monitoring
- Infrastructure health
- GraphQL operation analytics
- Federation gateway metrics
- Business KPI tracking

### Distributed Tracing

Jaeger provides distributed tracing for:
- GraphQL query execution
- Database operations
- Redis operations
- Inter-service communication
- AI service calls

## 🔒 Security Features

### Development Environment
- Internal Docker network isolation
- Health checks for all services
- Basic authentication for monitoring

### Production Environment
- TLS/SSL termination
- Advanced rate limiting
- Secret management
- Network security policies
- Automated backup encryption

## 🚀 Deployment Strategies

### Blue-Green Deployment

```bash
# Deploy to staging first
./scripts/pulumi-deploy.sh up -s staging

# Test and validate
./scripts/pulumi-deploy.sh status -s staging

# Deploy to production
./scripts/pulumi-deploy.sh up -s prod
```

### Rolling Updates

The infrastructure supports zero-downtime rolling updates:

```bash
# Update with rolling deployment
./scripts/pulumi-deploy.sh up -s prod --refresh
```

## 🔧 Troubleshooting

### Common Issues

1. **Port Conflicts**: Ensure ports 3000, 4000, 4001, 5432, 6379, 6333, 9090, 16686 are available

2. **Docker Issues**: 
   ```bash
   # Check Docker status
   docker info
   
   # Restart Docker daemon if needed
   sudo systemctl restart docker
   ```

3. **Pulumi State Issues**:
   ```bash
   # Refresh state
   ./scripts/pulumi-deploy.sh refresh -s dev
   
   # Backup state before major changes
   ./scripts/pulumi-deploy.sh backup -s prod
   ```

### Debugging

Enable verbose logging:

```bash
./scripts/pulumi-deploy.sh up -s dev --verbose
```

Check service logs:

```bash
# All services
docker compose logs -f

# Specific service
docker logs pothos-todo-dev-app
```

## 📚 Additional Resources

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [GraphQL Federation Guide](https://www.apollographql.com/docs/federation/)
- [Prometheus Monitoring](https://prometheus.io/docs/)
- [Grafana Dashboards](https://grafana.com/docs/)

## 🤝 Contributing

1. Test changes in development environment first
2. Use preview mode for production changes
3. Always backup state before major changes
4. Follow infrastructure as code best practices

## 📄 License

This infrastructure configuration is part of the Pothos GraphQL Todo API project and follows the same licensing terms.