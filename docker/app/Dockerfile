# Multi-stage Dockerfile for Pothos GraphQL Todo API
# Optimized for production deployment with Bun runtime

# Base stage with Bun runtime
FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Development stage
FROM base AS development
ENV NODE_ENV=development

# Copy package files
COPY package.json bun.lockb ./

# Install all dependencies (including dev dependencies)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Start development server with hot reload
CMD ["dumb-init", "bun", "run", "dev"]

# Production build stage
FROM base AS builder
ENV NODE_ENV=production

# Copy package files
COPY package.json bun.lockb ./

# Install only production dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build the application
RUN bun run build

# Remove dev dependencies and unnecessary files
RUN rm -rf node_modules/.cache \
    && bun install --frozen-lockfile --production \
    && rm -rf src/ \
    && rm -rf tests/ \
    && rm -rf docs/ \
    && rm -rf examples/ \
    && rm -rf scripts/dev/

# Production stage
FROM base AS production
ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

# Copy configuration files
COPY --chown=nodejs:nodejs config/ ./config/
COPY --chown=nodejs:nodejs CLAUDE.md ./

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:4000/health || exit 1

# Production startup command
CMD ["dumb-init", "bun", "run", "start"]

# Default target
FROM ${NODE_ENV:-development} AS final