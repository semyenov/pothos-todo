#!/bin/bash

# Test script for GraphQL Federation queries
# This script demonstrates various federation capabilities

GATEWAY_URL="http://localhost:4000/graphql"

echo "🧪 Testing GraphQL Federation..."
echo "================================"

# Test 1: Basic health check
echo -e "\n1️⃣ Health Check:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}' | jq '.data'

# Test 2: User subgraph query
echo -e "\n2️⃣ User Subgraph Query:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users { id email name createdAt } }"}' | jq '.data'

# Test 3: Todo subgraph query
echo -e "\n3️⃣ Todo Subgraph Query:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ todos { id title status priority createdAt } todoLists { id title createdAt } }"}' | jq '.data'

# Test 4: AI subgraph query (mock data)
echo -e "\n4️⃣ AI Subgraph Query:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ suggestTodos(limit: 3) { title description priority estimatedTime } }"}' | jq '.data'

# Test 5: Cross-subgraph federation
echo -e "\n5️⃣ Cross-Subgraph Federation:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users { id email todos { id title } } }"}' | jq '.data' 2>/dev/null || echo "Note: Cross-subgraph queries require proper federation setup"

# Test 6: AI insights query
echo -e "\n6️⃣ AI Insights Query:"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ getUserInsights(userId: \"test\") { type message data } }"}' | jq '.data'

# Test 7: Schema introspection
echo -e "\n7️⃣ Schema Introspection (showing first 10 types):"
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name description } } }"}' | jq '.data.__schema.types[:10]'

echo -e "\n✅ Federation tests complete!"