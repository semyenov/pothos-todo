# Docker Federation Setup

This guide explains how to run the GraphQL federation using Docker Compose, with options for both development and production environments.

## Prerequisites

- Docker and Docker Compose installed
- Bun runtime (for local development)
- Hive Platform credentials (for production mode)

## Architecture Overview

The Docker Compose setup includes:

- **PostgreSQL**: Primary database
- **Redis**: Caching and session storage
- **Qdrant**: Vector database for AI features
- **Hive Gateway**: GraphQL federation gateway (or dev gateway)
- **User Subgraph**: Handles user authentication and profiles
- **Todo Subgraph**: Manages todos and todo lists
- **AI Subgraph**: Provides AI-powered features

## Quick Start

### Development Mode (No Hive Credentials Required)

Run the federation with the development gateway:

```bash
# Start all services with development overrides
bun run federation:docker:dev

# Or manually with docker compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This will:
- Use the development gateway (schema stitching)
- Enable hot reloading for all services
- Mount source code as volumes
- Skip Hive credential requirements

### Production Mode (Requires Hive Credentials)

1. Set up environment variables:

```bash
# Create .env.local with your Hive credentials
cat > .env.local << EOF
HIVE_TOKEN=your-hive-token
HIVE_CDN_ENDPOINT=https://cdn.graphql-hive.com/artifacts/v1/YOUR_TARGET_ID
HIVE_CDN_KEY=your-cdn-key
EOF
```

2. Build and run the services:

```bash
# Build all federation services
bun run federation:docker:build

# Start the federation
bun run federation:docker

# Or manually
docker compose up hive-gateway user-subgraph todo-subgraph ai-subgraph
```

## Service URLs

Once running, services are available at:

- **Federation Gateway**: http://localhost:4000/graphql
- **User Subgraph**: http://localhost:4001/graphql
- **Todo Subgraph**: http://localhost:4002/graphql
- **AI Subgraph**: http://localhost:4003/graphql
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379
- **Qdrant**: localhost:6333

## Docker Compose Commands

### Start Services

```bash
# Start all services (including databases)
docker compose up -d

# Start only federation services
docker compose up -d hive-gateway user-subgraph todo-subgraph ai-subgraph

# Start with development overrides
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Stop Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (caution: deletes data)
docker compose down -v
```

### View Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f hive-gateway
docker compose logs -f user-subgraph
```

### Rebuild Services

```bash
# Rebuild all images
docker compose build

# Rebuild specific service
docker compose build user-subgraph

# Rebuild without cache
docker compose build --no-cache
```

## Environment Variables

### Gateway Configuration

```env
# Hive Gateway Configuration
HIVE_TOKEN=your-hive-token
HIVE_CDN_ENDPOINT=https://cdn.graphql-hive.com/artifacts/v1/TARGET_ID
HIVE_CDN_KEY=your-cdn-key
GATEWAY_PORT=4000

# Subgraph URLs (for development gateway)
USER_SUBGRAPH_URL=http://user-subgraph:4001/graphql
TODO_SUBGRAPH_URL=http://todo-subgraph:4002/graphql
AI_SUBGRAPH_URL=http://ai-subgraph:4003/graphql
```

### Subgraph Configuration

```env
# User Subgraph
USER_SUBGRAPH_PORT=4001
USER_SUBGRAPH_CONTAINER=pothos-todo-user-subgraph

# Todo Subgraph
TODO_SUBGRAPH_PORT=4002
TODO_SUBGRAPH_CONTAINER=pothos-todo-todo-subgraph

# AI Subgraph
AI_SUBGRAPH_PORT=4003
AI_SUBGRAPH_CONTAINER=pothos-todo-ai-subgraph
OPENAI_API_KEY=your-openai-key
```

### Database Configuration

```env
# PostgreSQL
POSTGRES_DB=pothos_todo
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_PORT=5432

# Redis
REDIS_PASSWORD=
REDIS_PORT=6379

# Qdrant
QDRANT_PORT=6333
QDRANT_GRPC_PORT=6334
```

## Health Checks

All services include health checks:

```bash
# Check service health
docker compose ps

# Manual health check
curl http://localhost:4000/health
curl http://localhost:4001/graphql?query={__typename}
```

## Troubleshooting

### Services Not Starting

1. Check logs for specific errors:
```bash
docker compose logs hive-gateway
```

2. Ensure all required environment variables are set:
```bash
docker compose config
```

3. Verify port availability:
```bash
lsof -i :4000 -i :4001 -i :4002 -i :4003
```

### Database Connection Issues

1. Ensure PostgreSQL is healthy:
```bash
docker compose ps postgres
docker compose exec postgres pg_isready
```

2. Check database migrations:
```bash
docker compose exec user-subgraph bun run db:migrate
```

### Networking Issues

Services communicate via the `pothos-network` bridge network. To debug:

```bash
# List networks
docker network ls

# Inspect network
docker network inspect pothos-todo_pothos-network

# Test connectivity
docker compose exec hive-gateway ping user-subgraph
```

## Development Workflow

### Hot Reloading

In development mode, changes to source files automatically restart services:

1. Edit files in `src/subgraphs/`
2. Services automatically restart
3. Test changes at http://localhost:4000/graphql

### Adding New Subgraphs

1. Create subgraph directory:
```bash
mkdir -p src/subgraphs/new-service
```

2. Add Dockerfile:
```bash
cp docker/subgraphs/user/Dockerfile docker/subgraphs/new-service/
```

3. Update docker-compose.yml:
```yaml
new-subgraph:
  build:
    context: .
    dockerfile: ./docker/subgraphs/new-service/Dockerfile
  # ... configuration
```

4. Update gateway configuration to include new subgraph

## Production Deployment

### Using Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml pothos-todo
```

### Using Kubernetes

Convert Docker Compose to Kubernetes manifests:

```bash
# Install kompose
curl -L https://github.com/kubernetes/kompose/releases/download/v1.26.0/kompose-linux-amd64 -o kompose

# Convert
./kompose convert -f docker-compose.yml
```

## Monitoring

### Logs Aggregation

For production, consider using:
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Grafana Loki
- AWS CloudWatch

### Metrics Collection

The Hive Gateway exposes metrics at `/metrics` for Prometheus scraping.

## Security Considerations

1. **Secrets Management**: Use Docker secrets or external secret managers
2. **Network Isolation**: Services only expose necessary ports
3. **SSL/TLS**: Add reverse proxy (nginx/traefik) for HTTPS
4. **Resource Limits**: Set memory/CPU limits in production

```yaml
services:
  user-subgraph:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

## Backup and Recovery

### Database Backup

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U postgres pothos_todo > backup.sql

# Restore PostgreSQL
docker compose exec -T postgres psql -U postgres pothos_todo < backup.sql
```

### Volume Backup

```bash
# Backup all volumes
docker run --rm -v pothos-todo_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

## Next Steps

1. Configure monitoring and alerting
2. Set up CI/CD pipeline for automated deployments
3. Implement proper secret management
4. Add SSL termination with reverse proxy
5. Configure horizontal scaling for subgraphs