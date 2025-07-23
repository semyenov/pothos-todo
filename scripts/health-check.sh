#!/bin/bash

# Health check script for GraphQL Federation
# Checks the health of all services in the federation

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Services to check
declare -A SERVICES=(
    ["Gateway"]="http://localhost:4000/health"
    ["User Subgraph"]="http://localhost:4001/graphql"
    ["Todo Subgraph"]="http://localhost:4002/graphql"
    ["AI Subgraph"]="http://localhost:4003/graphql"
    ["PostgreSQL"]="pg_isready -h localhost -p 5432"
    ["Redis"]="redis-cli ping"
    ["Qdrant"]="http://localhost:6333/health"
)

# GraphQL health query
GRAPHQL_QUERY='{"query":"{ __typename }"}'

# Function to check HTTP endpoint
check_http() {
    local url=$1
    local response=$(curl -s -o /dev/null -w "%{http_code}" $url 2>/dev/null || echo "000")
    
    if [ "$response" = "200" ]; then
        return 0
    else
        return 1
    fi
}

# Function to check GraphQL endpoint
check_graphql() {
    local url=$1
    local response=$(curl -s -X POST $url \
        -H "Content-Type: application/json" \
        -d "$GRAPHQL_QUERY" 2>/dev/null || echo "{}")
    
    if echo "$response" | grep -q "__typename"; then
        return 0
    else
        return 1
    fi
}

# Function to check command
check_command() {
    local cmd=$1
    if $cmd &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Main health check
echo "🏥 Running Federation Health Checks..."
echo "====================================="

FAILED=0
TOTAL=0

for service in "${!SERVICES[@]}"; do
    TOTAL=$((TOTAL + 1))
    endpoint="${SERVICES[$service]}"
    
    printf "%-20s" "$service:"
    
    # Determine check type
    if [[ $endpoint == http* ]]; then
        if [[ $endpoint == */graphql ]]; then
            # GraphQL endpoint
            if check_graphql "$endpoint"; then
                echo -e "${GREEN}✓ Healthy${NC}"
            else
                echo -e "${RED}✗ Unhealthy${NC}"
                FAILED=$((FAILED + 1))
            fi
        else
            # Regular HTTP endpoint
            if check_http "$endpoint"; then
                echo -e "${GREEN}✓ Healthy${NC}"
            else
                echo -e "${RED}✗ Unhealthy${NC}"
                FAILED=$((FAILED + 1))
            fi
        fi
    else
        # Command check
        if check_command "$endpoint"; then
            echo -e "${GREEN}✓ Healthy${NC}"
        else
            echo -e "${RED}✗ Unhealthy${NC}"
            FAILED=$((FAILED + 1))
        fi
    fi
done

echo "====================================="

# Summary
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All services healthy ($TOTAL/$TOTAL)${NC}"
    exit 0
else
    echo -e "${RED}❌ $FAILED services unhealthy ($((TOTAL - FAILED))/$TOTAL)${NC}"
    
    # Additional diagnostics
    echo -e "\n${YELLOW}📊 Diagnostics:${NC}"
    
    # Check Docker containers
    echo -e "\nDocker containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(pothos-todo|postgres|redis|qdrant)" || echo "No containers found"
    
    # Check ports
    echo -e "\nListening ports:"
    netstat -tuln 2>/dev/null | grep -E "(4000|4001|4002|4003|5432|6379|6333)" || echo "Cannot check ports"
    
    exit 1
fi