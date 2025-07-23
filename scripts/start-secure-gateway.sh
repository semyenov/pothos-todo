#!/bin/bash

# Start Secure Federation Gateway
# This script starts the GraphQL federation with all security features enabled

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔐 Starting Secure Federation Gateway${NC}"
echo "======================================="

# Generate security tokens if not exists
if [ ! -f .env.security ]; then
    echo -e "${YELLOW}Generating security tokens...${NC}"
    
    cat > .env.security << EOF
# Security Configuration
JWT_SECRET=$(openssl rand -hex 32)
SUBGRAPH_SECRET=$(openssl rand -hex 32)
REQUEST_SIGNING_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
CSRF_SECRET=$(openssl rand -hex 32)

# CORS Configuration
CORS_ORIGIN=http://localhost:3000,http://localhost:4000

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

# Security Features
ENABLE_INTROSPECTION=false
ENABLE_QUERY_WHITELISTING=false
ENABLE_CSRF_PROTECTION=true
ENABLE_REQUEST_SIGNING=true
ENABLE_SUBGRAPH_AUTH=true
EOF
    
    echo -e "${GREEN}✅ Security tokens generated${NC}"
fi

# Load security configuration
source .env.security

# Export security variables
export JWT_SECRET
export SUBGRAPH_SECRET
export REQUEST_SIGNING_SECRET
export ENCRYPTION_KEY
export CSRF_SECRET
export CORS_ORIGIN
export ENABLE_INTROSPECTION
export ENABLE_QUERY_WHITELISTING
export ENABLE_CSRF_PROTECTION
export ENABLE_REQUEST_SIGNING
export ENABLE_SUBGRAPH_AUTH

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Docker is not running${NC}"
    exit 1
fi

# Check if services are healthy
echo -e "${BLUE}Checking service health...${NC}"
./scripts/health-check.sh || {
    echo -e "${YELLOW}Some services are unhealthy. Starting them...${NC}"
    docker compose up -d
    sleep 10
}

# Start monitoring stack
echo -e "${BLUE}Starting monitoring stack...${NC}"
./scripts/start-monitoring.sh &
MONITORING_PID=$!

# Generate query whitelist (if enabled)
if [ "$ENABLE_QUERY_WHITELISTING" = "true" ]; then
    echo -e "${BLUE}Generating query whitelist...${NC}"
    bun run src/federation/generate-whitelist.ts
fi

# Start secure gateway
echo -e "${BLUE}Starting secure gateway...${NC}"
cat > /tmp/secure-gateway.ts << 'EOF'
import { startSecureGateway } from './src/federation/gateway-security.js';
import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { schemaFromExecutor } from '@graphql-tools/wrap';
import { stitchSchemas } from '@graphql-tools/stitch';
import { createSubgraphFetcher } from './src/federation/gateway-security.js';

async function start() {
  const config = {
    rateLimit: {
      window: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
      max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    },
    introspection: process.env.ENABLE_INTROSPECTION === 'true',
    csrfProtection: process.env.ENABLE_CSRF_PROTECTION === 'true',
    queryWhitelisting: {
      enabled: process.env.ENABLE_QUERY_WHITELISTING === 'true',
      whitelist: new Map(),
    },
    jwt: {
      secret: process.env.JWT_SECRET!,
      algorithms: ['HS256'] as any,
    },
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      credentials: true,
    },
    gateway: {
      trustedSubgraphs: [
        'http://localhost:4001/graphql',
        'http://localhost:4002/graphql',
        'http://localhost:4003/graphql',
      ],
      subgraphAuth: {
        enabled: process.env.ENABLE_SUBGRAPH_AUTH === 'true',
        secret: process.env.SUBGRAPH_SECRET!,
      },
      requestSigning: {
        enabled: process.env.ENABLE_REQUEST_SIGNING === 'true',
        algorithm: 'HS256' as const,
        secret: process.env.REQUEST_SIGNING_SECRET!,
      },
      encryption: {
        enabled: false,
        algorithm: 'aes-256-gcm' as const,
        key: process.env.ENCRYPTION_KEY || '',
      },
    },
  };

  // Create subgraph executors with security
  const fetcher = createSubgraphFetcher(config);
  
  const userExecutor = buildHTTPExecutor({
    endpoint: 'http://localhost:4001/graphql',
    fetch: fetcher,
  });

  const todoExecutor = buildHTTPExecutor({
    endpoint: 'http://localhost:4002/graphql',
    fetch: fetcher,
  });

  const aiExecutor = buildHTTPExecutor({
    endpoint: 'http://localhost:4003/graphql',
    fetch: fetcher,
  });

  // Get subgraph schemas
  const [userSchema, todoSchema, aiSchema] = await Promise.all([
    schemaFromExecutor(userExecutor),
    schemaFromExecutor(todoExecutor),
    schemaFromExecutor(aiExecutor),
  ]);

  // Stitch schemas
  const schema = stitchSchemas({
    subschemas: [
      { schema: userSchema, executor: userExecutor },
      { schema: todoSchema, executor: todoExecutor },
      { schema: aiSchema, executor: aiExecutor },
    ],
  });

  // Start secure gateway
  startSecureGateway(schema, 4000, config);
}

start().catch(console.error);
EOF

bun run /tmp/secure-gateway.ts &
GATEWAY_PID=$!

# Wait for gateway to start
sleep 5

# Run security tests
echo -e "${BLUE}Running security tests...${NC}"
cat > /tmp/security-test.sh << 'EOF'
#!/bin/bash

# Test rate limiting
echo "Testing rate limiting..."
for i in {1..150}; do
  curl -s -X POST http://localhost:4000/graphql \
    -H "Content-Type: application/json" \
    -d '{"query":"{ __typename }"}' > /dev/null &
done
wait

# Test CORS
echo "Testing CORS..."
curl -s -I -X OPTIONS http://localhost:4000/graphql \
  -H "Origin: http://malicious.com" \
  -H "Access-Control-Request-Method: POST"

# Test introspection blocking
echo "Testing introspection blocking..."
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name } } }"}'

echo ""
echo "Security tests completed"
EOF

chmod +x /tmp/security-test.sh
/tmp/security-test.sh

echo ""
echo -e "${GREEN}✅ Secure Federation Gateway Started!${NC}"
echo ""
echo "🔐 Security Features Enabled:"
echo "   - Rate Limiting: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW}ms"
echo "   - CORS Protection: ${CORS_ORIGIN}"
echo "   - CSRF Protection: ${ENABLE_CSRF_PROTECTION}"
echo "   - Request Signing: ${ENABLE_REQUEST_SIGNING}"
echo "   - Subgraph Authentication: ${ENABLE_SUBGRAPH_AUTH}"
echo "   - Introspection: ${ENABLE_INTROSPECTION}"
echo "   - Query Whitelisting: ${ENABLE_QUERY_WHITELISTING}"
echo ""
echo "📊 Monitoring:"
echo "   - Security Status: http://localhost:4000/security/status"
echo "   - Security Audit: http://localhost:4000/security/audit"
echo "   - Metrics: http://localhost:9090/metrics"
echo "   - Dashboard: http://localhost:4444"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${BLUE}Shutting down...${NC}"
    kill $GATEWAY_PID 2>/dev/null || true
    kill $MONITORING_PID 2>/dev/null || true
    rm -f /tmp/secure-gateway.ts /tmp/security-test.sh
    echo -e "${GREEN}Shutdown complete${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait
wait $GATEWAY_PID