#!/bin/bash

# Start federation with correct database URL for Docker environment
# This script ensures the database URL points to the postgres container

echo "Starting federation with Docker..."

# Export the correct DATABASE_URL for Docker
export DATABASE_URL="postgresql://postgres:password@postgres:5432/pothos_todo"

# Remove any existing DATABASE_URL from .env temporarily
if [ -f .env ]; then
    mv .env .env.backup
fi

# Create a temporary .env with Docker-specific values
cat > .env << EOF
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@postgres:5432/pothos_todo
REDIS_URL=redis://redis:6379
QDRANT_URL=http://qdrant:6333
SESSION_SECRET=your-session-secret-at-least-32-characters-long
EOF

# Start the services
docker compose -f docker-compose.yml -f docker-compose.dev.yml up "$@"

# Restore the original .env
if [ -f .env.backup ]; then
    mv .env.backup .env
fi