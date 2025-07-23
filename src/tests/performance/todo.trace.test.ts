import {
  traceBasedTesting,
  TraceBasedTesting,
} from "@/infrastructure/testing/TraceBasedTesting.js";
import { Container } from "@/infrastructure/container/Container.js";
import { CreateTodoCommand } from "@/application/commands/CreateTodoCommand.js";
import { performanceMonitor } from "@/infrastructure/telemetry/PerformanceMonitor.js";
import prisma from "@/lib/prisma.js";
import { Priority as PrismaPriority } from "@prisma/client";

/**
 * Trace-based performance tests for Todo operations
 */
export const todoPerformanceTests = traceBasedTesting
  .createSuite("Todo Performance Tests")
  .test(
    "Create Todo Performance",
    {
      name: "create_todo_performance",
      expectedDuration: 100, // Should complete within 100ms
      expectedSpans: [
        "graphql.mutation.createTodo",
        "db.insert",
        "ai.embeddings",
        "cache.set",
      ],
      assertMetrics: (metrics) => {
        (traceBasedTesting as any).assertPerformanceMetrics(metrics, {
          maxResponseTime: 100,
          maxErrorRate: 0.01,
        });
      },
    },
    async () => {
      const container = Container.getInstance();
      const handler = container.createTodoHandler;

      const command = CreateTodoCommand.create(
        crypto.randomUUID(),
        "Performance test todo",
        "test-user-id",
        undefined,
        PrismaPriority.MEDIUM,
        new Date()
      );

      await handler.handle(command);
    }
  )
  .test(
    "Bulk Todo Creation",
    {
      name: "bulk_todo_creation",
      expectedDuration: 1000, // 1 second for 10 todos
      timeout: 5000,
    },
    async () => {
      const container = Container.getInstance();
      const handler = container.createTodoHandler;

      const promises = Array.from({ length: 10 }, (_, i) =>
        handler.handle(
          CreateTodoCommand.create(
            crypto.randomUUID(),
            `Bulk test todo ${i}`,
            "test-user-id",
            undefined,
            PrismaPriority.LOW,
            new Date()
          )
        )
      );

      await Promise.all(promises);
    }
  )
  .test(
    "Todo Query with Cache",
    {
      name: "todo_query_cache_performance",
      expectedDuration: 50, // Cached queries should be fast
      expectedSpans: ["cache.get", "graphql.query.findMany"],
    },
    async () => {
      // First query to warm cache
      await prisma.todo.findMany({
        where: { userId: "test-user-id" },
        take: 10,
      });

      // Second query should hit cache
      await prisma.todo.findMany({
        where: { userId: "test-user-id" },
        take: 10,
      });
    }
  )
  .test(
    "Complex Query Performance",
    {
      name: "complex_query_performance",
      expectedDuration: 200,
      assertMetrics: (metrics) => {
        if (metrics.p95ResponseTime > 200) {
          throw new Error("P95 response time exceeds 200ms");
        }
      },
    },
    async () => {
      await prisma.todo.findMany({
        where: {
          OR: [
            { title: { contains: "test" } },
            { description: { contains: "performance" } },
          ],
          AND: [
            { status: "PENDING" },
            { priority: { in: ["HIGH", "MEDIUM"] } },
          ],
        },
        include: {
          user: true,
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 20,
      });
    }
  );

/**
 * Run performance benchmarks
 */
export async function runTodoBenchmarks() {
  console.log("Running Todo performance benchmarks...\n");

  // Benchmark single todo creation
  const createBenchmark = await traceBasedTesting.benchmark(
    "todo_creation",
    100,
    async () => {
      const container = Container.getInstance();
      const handler = container.createTodoHandler;

      await handler.handle(
        CreateTodoCommand.create(
          crypto.randomUUID(),
          "Benchmark todo",
          "test-user-id",
          undefined,
          PrismaPriority.MEDIUM,
          new Date()
        )
      );
    }
  );

  console.log("Todo Creation Benchmark:");
  console.log(`- Average: ${createBenchmark.averageDuration.toFixed(2)}ms`);
  console.log(`- Min: ${createBenchmark.minDuration}ms`);
  console.log(`- Max: ${createBenchmark.maxDuration}ms`);
  console.log(`- P95: ${createBenchmark.p95Duration}ms`);
  console.log(`- P99: ${createBenchmark.p99Duration}ms\n`);

  // Benchmark query performance
  const queryBenchmark = await traceBasedTesting.benchmark(
    "todo_query",
    100,
    async () => {
      await prisma.todo.findMany({
        where: { userId: "test-user-id" },
        take: 20,
      });
    }
  );

  console.log("Todo Query Benchmark:");
  console.log(`- Average: ${queryBenchmark.averageDuration.toFixed(2)}ms`);
  console.log(`- Min: ${queryBenchmark.minDuration}ms`);
  console.log(`- Max: ${queryBenchmark.maxDuration}ms`);
  console.log(`- P95: ${queryBenchmark.p95Duration}ms`);
  console.log(`- P99: ${queryBenchmark.p99Duration}ms\n`);

  // Generate performance report
  const anomalies = await performanceMonitor.detectAnomalies();
  if (anomalies.length > 0) {
    console.log("Performance Anomalies Detected:");
    anomalies.forEach((a) => {
      console.log(`- ${a.type}: ${a.message} (severity: ${a.severity})`);
    });
  }
}

// Export test runner
export async function runAllTests() {
  // Clean up test data
  await prisma.todo.deleteMany({
    where: { userId: "test-user-id" },
  });

  // Run test suite
  const results = await todoPerformanceTests.run();

  // Run benchmarks
  await runTodoBenchmarks();

  // Generate report
  const report = traceBasedTesting.generateReport();
  console.log("\n" + report);

  // Clean up
  await prisma.todo.deleteMany({
    where: { userId: "test-user-id" },
  });

  return results;
}
