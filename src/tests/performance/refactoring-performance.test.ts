import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import { performance } from 'perf_hooks';

// Import refactored components
import { PrismaUserRepository } from '@/infrastructure/persistence/PrismaUserRepository';
import { PrismaTodoRepository } from '@/infrastructure/persistence/PrismaTodoRepository';
import { User } from '@/domain/aggregates/User';
import { Todo } from '@/domain/aggregates/Todo';
import { Priority } from '@prisma/client';
import { createBatchLoader } from '@/api/dataloaders/createDataLoader';

describe('Refactoring Performance Tests', () => {
  let prisma: PrismaClient;
  let userRepo: PrismaUserRepository;
  let todoRepo: PrismaTodoRepository;

  beforeEach(async () => {
    prisma = new PrismaClient();
    userRepo = new PrismaUserRepository(prisma);
    todoRepo = new PrismaTodoRepository(prisma);

    // Clean database
    await prisma.todo.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('BaseRepository Performance', () => {
    it('should handle bulk operations efficiently', async () => {
      const userCount = 100;
      const users = Array.from({ length: userCount }, (_, i) => 
        User.create(nanoid(), `user${i}@example.com`, `User ${i}`)
      );

      // Measure bulk create performance
      const createStart = performance.now();
      await userRepo.createMany(users);
      const createEnd = performance.now();
      const createTime = createEnd - createStart;

      console.log(`Bulk created ${userCount} users in ${createTime.toFixed(2)}ms`);
      expect(createTime).toBeLessThan(1000); // Should complete within 1 second

      // Measure findAll performance
      const findStart = performance.now();
      const foundUsers = await userRepo.findAll();
      const findEnd = performance.now();
      const findTime = findEnd - findStart;

      console.log(`Found ${foundUsers.length} users in ${findTime.toFixed(2)}ms`);
      expect(findTime).toBeLessThan(200); // Should be fast
      expect(foundUsers.length).toBe(userCount);
    });

    it('should perform individual saves efficiently', async () => {
      const operationCount = 50;
      const times: number[] = [];

      for (let i = 0; i < operationCount; i++) {
        const user = User.create(nanoid(), `perf${i}@example.com`, `Perf User ${i}`);
        
        const start = performance.now();
        await userRepo.save(user);
        const end = performance.now();
        
        times.push(end - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Average save time: ${avgTime.toFixed(2)}ms`);
      console.log(`Max save time: ${maxTime.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(50); // Average should be under 50ms
      expect(maxTime).toBeLessThan(100); // No single save should take too long
    });
  });

  describe('DataLoader Performance', () => {
    it('should batch requests efficiently', async () => {
      // Create test data
      const users = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const user = User.create(nanoid(), `loader${i}@example.com`, `Loader User ${i}`);
          return userRepo.save(user).then(() => user);
        })
      );

      const userLoader = createBatchLoader<any>(prisma, {
        modelName: 'user',
      });

      // Measure parallel loading without DataLoader batching
      const withoutBatchStart = performance.now();
      const individualResults = await Promise.all(
        users.map(u => prisma.user.findUnique({ where: { id: u.id } }))
      );
      const withoutBatchEnd = performance.now();
      const withoutBatchTime = withoutBatchEnd - withoutBatchStart;

      // Clear loader cache
      userLoader.clearAll();

      // Measure with DataLoader batching
      const withBatchStart = performance.now();
      const batchedResults = await Promise.all(
        users.map(u => userLoader.load(u.id))
      );
      const withBatchEnd = performance.now();
      const withBatchTime = withBatchEnd - withBatchStart;

      console.log(`Without batching: ${withoutBatchTime.toFixed(2)}ms`);
      console.log(`With batching: ${withBatchTime.toFixed(2)}ms`);
      console.log(`Performance improvement: ${((1 - withBatchTime / withoutBatchTime) * 100).toFixed(1)}%`);

      expect(withBatchTime).toBeLessThan(withoutBatchTime);
      expect(batchedResults.length).toBe(users.length);
    });

    it('should cache results effectively', async () => {
      const user = User.create(nanoid(), 'cache-test@example.com', 'Cache Test');
      await userRepo.save(user);

      const userLoader = createBatchLoader<any>(prisma, {
        modelName: 'user',
      });

      // First load - hits database
      const firstLoadStart = performance.now();
      const firstResult = await userLoader.load(user.id);
      const firstLoadEnd = performance.now();
      const firstLoadTime = firstLoadEnd - firstLoadStart;

      // Second load - should hit cache
      const secondLoadStart = performance.now();
      const secondResult = await userLoader.load(user.id);
      const secondLoadEnd = performance.now();
      const secondLoadTime = secondLoadEnd - secondLoadStart;

      console.log(`First load: ${firstLoadTime.toFixed(2)}ms`);
      console.log(`Cached load: ${secondLoadTime.toFixed(2)}ms`);

      expect(secondLoadTime).toBeLessThan(firstLoadTime / 10); // Cache should be at least 10x faster
      expect(firstResult).toEqual(secondResult);
    });
  });

  describe('BaseAggregate Performance', () => {
    it('should handle updates efficiently', async () => {
      const user = User.create(nanoid(), 'aggregate-test@example.com', 'Test User');
      await userRepo.save(user);

      const todo = Todo.create(
        nanoid(),
        'Performance Test Todo',
        user.id,
        null,
        Priority.MEDIUM,
        new Date()
      );
      await todoRepo.save(todo);

      const updateCount = 100;
      const updateTimes: number[] = [];

      for (let i = 0; i < updateCount; i++) {
        const start = performance.now();
        
        // BaseAggregate's updateFields method
        todo.update(
          `Updated Title ${i}`,
          Priority.HIGH,
          new Date(),
          `Updated description ${i}`
        );
        
        const end = performance.now();
        updateTimes.push(end - start);
      }

      const avgUpdateTime = updateTimes.reduce((a, b) => a + b, 0) / updateTimes.length;
      console.log(`Average update time: ${avgUpdateTime.toFixed(2)}ms`);

      expect(avgUpdateTime).toBeLessThan(1); // Updates should be very fast (< 1ms)
      expect(todo.version).toBe(updateCount); // Version should increment correctly
    });

    it('should manage domain events efficiently', async () => {
      const eventCount = 1000;
      const user = User.create(nanoid(), 'event-test@example.com', 'Event Test');

      const start = performance.now();
      
      // Generate many events
      for (let i = 0; i < eventCount; i++) {
        user.update(user.email, `Updated Name ${i}`);
      }
      
      const events = user.getUncommittedEvents();
      const end = performance.now();

      const totalTime = end - start;
      console.log(`Generated ${eventCount} events in ${totalTime.toFixed(2)}ms`);
      console.log(`Average time per event: ${(totalTime / eventCount).toFixed(3)}ms`);

      expect(events.length).toBe(eventCount + 1); // +1 for creation event
      expect(totalTime).toBeLessThan(100); // Should handle 1000 events in under 100ms
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory with singleton instances', () => {
      // This is a basic check - more sophisticated memory profiling would be needed in production
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create and destroy many repository instances
      for (let i = 0; i < 100; i++) {
        const repo = new PrismaUserRepository(prisma);
        // Repository should be garbage collected after this scope
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
      
      // Should not increase memory significantly (allow 10MB for test overhead)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});