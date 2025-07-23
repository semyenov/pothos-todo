import { PrismaClient } from '@prisma/client';

// Create a simple Prisma client for subgraphs that uses environment variables directly
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@postgres:5432/pothos_todo',
    },
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export default prisma;