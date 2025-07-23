import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll } from 'bun:test';

// Global test setup for integration tests
let prisma: PrismaClient;

beforeAll(async () => {
  // Setup test database
  console.log('Setting up test database...');
  
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_TEST_URL || process.env.DATABASE_URL,
      },
    },
  });

  // Ensure database is ready
  await prisma.$connect();
  
  // Clean all data before tests
  await cleanDatabase();
});

afterAll(async () => {
  // Clean up after all tests
  await cleanDatabase();
  await prisma.$disconnect();
});

async function cleanDatabase() {
  // Delete in correct order to respect foreign keys
  await prisma.domainEvent.deleteMany();
  await prisma.todo.deleteMany();
  await prisma.todoList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
}

export { prisma };