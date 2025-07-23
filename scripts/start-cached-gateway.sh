#!/bin/bash

# Start Cached Federation Gateway
# This script starts the GraphQL federation with advanced caching

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting Cached Federation Gateway${NC}"
echo "====================================="

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

# Check if Redis is available
REDIS_AVAILABLE=false
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        REDIS_AVAILABLE=true
        echo -e "${GREEN}✓ Redis is available${NC}"
    else
        echo -e "${YELLOW}⚠ Redis not running, using in-memory cache${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Redis not installed, using in-memory cache${NC}"
fi

# Start Redis if needed
if [ "$REDIS_AVAILABLE" = false ]; then
    echo -e "${BLUE}Starting Redis container...${NC}"
    docker run -d \
        --name redis-cache \
        --network pothos-todo_default \
        -p 6379:6379 \
        redis:alpine \
        2>/dev/null || echo "Redis container already exists"
    
    sleep 3
    REDIS_AVAILABLE=true
fi

# Check if subgraphs are running
echo -e "${BLUE}Checking subgraph health...${NC}"
./scripts/health-check.sh || {
    echo -e "${YELLOW}Subgraphs not healthy. Starting them...${NC}"
    docker compose up -d
    sleep 10
}

# Set cache configuration
if [ "$REDIS_AVAILABLE" = true ]; then
    export CACHE_STRATEGY="hybrid"
    export REDIS_HOST="localhost"
    export REDIS_PORT="6379"
else
    export CACHE_STRATEGY="memory"
fi

# Cache configuration
cat > /tmp/cache-config.json << EOF
{
  "enabled": true,
  "strategy": "$CACHE_STRATEGY",
  "ttl": {
    "default": 60000,
    "query": {
      "users": 300000,
      "todos": 120000,
      "suggestTodos": 600000,
      "getUserInsights": 1800000
    },
    "type": {
      "User": 300000,
      "Todo": 120000,
      "TodoList": 300000,
      "AIInsight": 1800000
    }
  },
  "invalidation": {
    "enabled": true,
    "patterns": [
      { "mutation": "createUser", "invalidates": ["users", "User:*"] },
      { "mutation": "updateUser", "invalidates": ["users", "User:{args.id}"] },
      { "mutation": "createTodo", "invalidates": ["todos", "Todo:*", "User:{args.input.userId}"] },
      { "mutation": "updateTodo", "invalidates": ["todos", "Todo:{args.id}"] }
    ]
  },
  "warmup": {
    "enabled": true,
    "queries": [
      {
        "query": "query WarmupUsers { users(first: 10) { id email name } }",
        "ttl": 600000
      },
      {
        "query": "query WarmupTodos { todos(first: 20, where: { status: \\"pending\\" }) { id title status priority } }",
        "ttl": 300000
      }
    ]
  }
}
EOF

# Start the cached gateway
echo -e "${BLUE}Starting cached gateway...${NC}"
bun run src/federation/gateway-with-cache.ts &
GATEWAY_PID=$!

# Wait for gateway to start
sleep 5

# Run cache warmup
echo -e "${BLUE}Running cache warmup...${NC}"
curl -s -X POST http://localhost:4000/graphql \
    -H "Content-Type: application/json" \
    -d '{"query":"{ users(first: 10) { id email name } }"}' > /dev/null

curl -s -X POST http://localhost:4000/graphql \
    -H "Content-Type: application/json" \
    -d '{"query":"{ todos(first: 20) { id title status } }"}' > /dev/null

# Test cache performance
echo -e "${BLUE}Testing cache performance...${NC}"
echo ""

# Function to test query performance
test_performance() {
    local query=$1
    local name=$2
    
    # First request (cache miss)
    start=$(date +%s%N)
    curl -s -X POST http://localhost:4000/graphql \
        -H "Content-Type: application/json" \
        -d "{\"query\":\"$query\"}" > /dev/null
    end=$(date +%s%N)
    miss_time=$(( ($end - $start) / 1000000 ))
    
    # Second request (cache hit)
    start=$(date +%s%N)
    curl -s -X POST http://localhost:4000/graphql \
        -H "Content-Type: application/json" \
        -d "{\"query\":\"$query\"}" > /dev/null
    end=$(date +%s%N)
    hit_time=$(( ($end - $start) / 1000000 ))
    
    improvement=$(( 100 - (hit_time * 100 / miss_time) ))
    
    echo -e "${name}:"
    echo -e "  Cache miss: ${miss_time}ms"
    echo -e "  Cache hit:  ${hit_time}ms"
    echo -e "  Improvement: ${GREEN}${improvement}%${NC}"
    echo ""
}

# Test different queries
test_performance "{ users(first: 5) { id email name } }" "User List Query"
test_performance "{ todos(first: 10) { id title status priority } }" "Todo List Query"
test_performance "{ user(id: \\\"1\\\") { id email todos { id title } } }" "Nested Query"

# Show cache statistics
echo -e "${BLUE}Cache Statistics:${NC}"
curl -s http://localhost:4000/cache/stats | jq '.' || echo "Unable to fetch cache stats"

echo ""
echo -e "${GREEN}✅ Cached Federation Gateway Started!${NC}"
echo ""
echo "📊 Endpoints:"
echo "   - GraphQL: http://localhost:4000/graphql"
echo "   - Cache Stats: http://localhost:4000/cache/stats"
echo "   - Cache Clear: POST http://localhost:4000/cache/clear"
echo "   - Metrics: http://localhost:9090/metrics"
echo ""
echo "🎯 Cache Strategy: $CACHE_STRATEGY"
if [ "$REDIS_AVAILABLE" = true ]; then
    echo "   - Redis: localhost:6379"
fi
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${BLUE}Shutting down...${NC}"
    kill $GATEWAY_PID 2>/dev/null || true
    rm -f /tmp/cache-config.json
    echo -e "${GREEN}Shutdown complete${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Monitor cache performance
while true; do
    sleep 30
    echo -e "\n${BLUE}Cache Performance Update:${NC}"
    stats=$(curl -s http://localhost:4000/cache/stats)
    if [ ! -z "$stats" ]; then
        hits=$(echo $stats | jq -r '.hits // 0')
        misses=$(echo $stats | jq -r '.misses // 0')
        hitRate=$(echo $stats | jq -r '.hitRate // 0')
        
        echo -e "Hits: $hits | Misses: $misses | Hit Rate: $(printf "%.1f" $(echo "$hitRate * 100" | bc))%"
    fi
done