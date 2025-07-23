#!/bin/bash

# Start Federation Monitoring Stack
# This script starts the monitoring infrastructure for the GraphQL federation

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting Federation Monitoring Stack${NC}"
echo "======================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}Docker is not running. Starting Docker...${NC}"
    open -a Docker || sudo systemctl start docker || echo "Please start Docker manually"
    sleep 10
fi

# Start Prometheus
echo -e "${BLUE}Starting Prometheus...${NC}"
docker run -d \
    --name prometheus \
    --network pothos-todo_default \
    -p 9090:9090 \
    -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
    prom/prometheus \
    --config.file=/etc/prometheus/prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --web.console.libraries=/usr/share/prometheus/console_libraries \
    --web.console.templates=/usr/share/prometheus/consoles \
    --web.enable-lifecycle \
    2>/dev/null || echo "Prometheus already running"

# Start Grafana
echo -e "${BLUE}Starting Grafana...${NC}"
docker run -d \
    --name grafana \
    --network pothos-todo_default \
    -p 3000:3000 \
    -e "GF_SECURITY_ADMIN_PASSWORD=admin" \
    -e "GF_USERS_ALLOW_SIGN_UP=false" \
    grafana/grafana \
    2>/dev/null || echo "Grafana already running"

# Start Jaeger for distributed tracing
echo -e "${BLUE}Starting Jaeger...${NC}"
docker run -d \
    --name jaeger \
    --network pothos-todo_default \
    -e COLLECTOR_OTLP_ENABLED=true \
    -p 16686:16686 \
    -p 4317:4317 \
    -p 4318:4318 \
    jaegertracing/all-in-one:latest \
    2>/dev/null || echo "Jaeger already running"

# Start OpenTelemetry Collector
echo -e "${BLUE}Starting OpenTelemetry Collector...${NC}"
docker run -d \
    --name otel-collector \
    --network pothos-todo_default \
    -p 4319:4317 \
    -p 8888:8888 \
    -v $(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml \
    otel/opentelemetry-collector:latest \
    --config=/etc/otelcol/config.yaml \
    2>/dev/null || echo "OpenTelemetry Collector already running"

# Wait for services to be ready
echo -e "${BLUE}Waiting for services to be ready...${NC}"
sleep 10

# Start the monitoring dashboard
echo -e "${BLUE}Starting Monitoring Dashboard...${NC}"
bun run src/federation/monitoring-dashboard.ts &
DASHBOARD_PID=$!

echo ""
echo -e "${GREEN}✅ Monitoring Stack Started Successfully!${NC}"
echo ""
echo "📊 Access the services at:"
echo "   - Prometheus: http://localhost:9090"
echo "   - Grafana: http://localhost:3000 (admin/admin)"
echo "   - Jaeger: http://localhost:16686"
echo "   - Custom Dashboard: http://localhost:4444"
echo ""
echo "🔍 Metrics endpoints:"
echo "   - Gateway metrics: http://localhost:4000/metrics"
echo "   - User subgraph metrics: http://localhost:4001/metrics"
echo "   - Todo subgraph metrics: http://localhost:4002/metrics"
echo "   - AI subgraph metrics: http://localhost:4003/metrics"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop monitoring${NC}"

# Wait for interrupt
wait $DASHBOARD_PID