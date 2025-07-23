FROM oven/bun:1.2.10-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY bun.lockb* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Expose port
EXPOSE 4002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:4002/graphql?query=%7B__typename%7D || exit 1

# Start the todo subgraph
CMD ["bun", "run", "src/subgraphs/todo/index.ts"]