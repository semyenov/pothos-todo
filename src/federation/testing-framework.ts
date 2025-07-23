import { logger } from "../lib/unjs-utils.js";
import chalk from "chalk";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import fetch from "node-fetch";

// Test types
export interface TestCase {
  name: string;
  description?: string;
  query: string;
  variables?: Record<string, any>;
  expectedResult?: any;
  expectedErrors?: string[];
  skipReason?: string;
  only?: boolean;
  timeout?: number;
}

export interface TestSuite {
  name: string;
  description?: string;
  endpoint: string;
  setupQueries?: string[];
  teardownQueries?: string[];
  tests: TestCase[];
  beforeAll?: () => Promise<void>;
  afterAll?: () => Promise<void>;
}

export interface TestResult {
  suite: string;
  test: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
  actualResult?: any;
  expectedResult?: any;
  diff?: any;
}

export interface TestReport {
  timestamp: string;
  duration: number;
  suites: number;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  coverage?: {
    types: number;
    fields: number;
    queries: number;
    mutations: number;
    subscriptions: number;
  };
}

// Test runner
export class FederationTestRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;

  constructor(
    private options: {
      verbose?: boolean;
      bail?: boolean;
      timeout?: number;
      coverage?: boolean;
    } = {}
  ) {}

  async runSuite(suite: TestSuite): Promise<TestResult[]> {
    const suiteResults: TestResult[] = [];

    logger.info(chalk.blue(`\nRunning test suite: ${suite.name}`));
    if (suite.description) {
      logger.info(chalk.dim(suite.description));
    }

    // Run beforeAll hook
    if (suite.beforeAll) {
      try {
        await suite.beforeAll();
      } catch (error) {
        logger.error(chalk.red("beforeAll hook failed:"), error);
        if (this.options.bail) {
          throw error;
        }
      }
    }

    // Run setup queries
    if (suite.setupQueries) {
      for (const query of suite.setupQueries) {
        try {
          await this.executeQuery(suite.endpoint, query);
        } catch (error) {
          logger.error(chalk.red("Setup query failed:"), error);
        }
      }
    }

    // Run tests
    const testsToRun = suite.tests.filter((test) => !test.skipReason);
    const onlyTests = testsToRun.filter((test) => test.only);
    const actualTests = onlyTests.length > 0 ? onlyTests : testsToRun;

    for (const test of actualTests) {
      const result = await this.runTest(suite, test);
      suiteResults.push(result);

      if (result.status === "failed" && this.options.bail) {
        break;
      }
    }

    // Run teardown queries
    if (suite.teardownQueries) {
      for (const query of suite.teardownQueries) {
        try {
          await this.executeQuery(suite.endpoint, query);
        } catch (error) {
          logger.error(chalk.red("Teardown query failed:"), error);
        }
      }
    }

    // Run afterAll hook
    if (suite.afterAll) {
      try {
        await suite.afterAll();
      } catch (error) {
        logger.error(chalk.red("afterAll hook failed:"), error);
      }
    }

    this.results.push(...suiteResults);
    return suiteResults;
  }

  private async runTest(suite: TestSuite, test: TestCase): Promise<TestResult> {
    const startTime = Date.now();

    if (test.skipReason) {
      this.logTestResult("skipped", test.name, test.skipReason);
      return {
        suite: suite.name,
        test: test.name,
        status: "skipped",
        duration: 0,
      };
    }

    try {
      const timeout = test.timeout || this.options.timeout || 30000;
      const result = await this.executeQueryWithTimeout(
        suite.endpoint,
        test.query,
        test.variables,
        timeout
      );

      // Check for GraphQL errors
      if (result.errors && test.expectedErrors) {
        const actualErrors = result.errors.map((e: any) => e.message);
        const passed = test.expectedErrors.every((expected) =>
          actualErrors.some((actual: string) => actual.includes(expected))
        );

        if (!passed) {
          throw new Error(
            `Expected errors not found.\nExpected: ${test.expectedErrors}\nActual: ${actualErrors}`
          );
        }
      } else if (result.errors && !test.expectedErrors) {
        throw new Error(
          `Unexpected errors: ${JSON.stringify(result.errors, null, 2)}`
        );
      } else if (!result.errors && test.expectedErrors) {
        throw new Error(`Expected errors but none were returned`);
      }

      // Check result data
      if (test.expectedResult !== undefined) {
        const passed = this.deepEqual(result.data, test.expectedResult);
        if (!passed) {
          const diff = this.generateDiff(test.expectedResult, result.data);
          throw new Error(`Result mismatch:\n${diff}`);
        }
      }

      const duration = Date.now() - startTime;
      this.logTestResult("passed", test.name, `${duration}ms`);

      return {
        suite: suite.name,
        test: test.name,
        status: "passed",
        duration,
        actualResult: result.data,
        expectedResult: test.expectedResult,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logTestResult("failed", test.name, errorMessage);

      return {
        suite: suite.name,
        test: test.name,
        status: "failed",
        duration,
        error: errorMessage,
      };
    }
  }

  private async executeQuery(
    endpoint: string,
    query: string,
    variables?: Record<string, any>
  ): Promise<any> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  private async executeQueryWithTimeout(
    endpoint: string,
    query: string,
    variables?: Record<string, any>,
    timeout?: number
  ): Promise<any> {
    return Promise.race([
      this.executeQuery(endpoint, query, variables),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Test timeout after ${timeout}ms`)),
          timeout
        )
      ),
    ]);
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      return keysA.every((key) => this.deepEqual(a[key], b[key]));
    }

    return false;
  }

  private generateDiff(expected: any, actual: any): string {
    // Simple diff for now
    return `Expected:\n${JSON.stringify(
      expected,
      null,
      2
    )}\n\nActual:\n${JSON.stringify(actual, null, 2)}`;
  }

  private logTestResult(
    status: "passed" | "failed" | "skipped",
    name: string,
    detail?: string
  ) {
    const icon = status === "passed" ? "✓" : status === "failed" ? "✗" : "○";
    const color =
      status === "passed"
        ? chalk.green
        : status === "failed"
        ? chalk.red
        : chalk.gray;

    let message = `  ${color(icon)} ${name}`;
    if (detail && (this.options.verbose || status === "failed")) {
      message += chalk.dim(` - ${detail}`);
    }

    logger.info(message);
  }

  async generateReport(): Promise<TestReport> {
    const duration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.status === "passed").length;
    const failed = this.results.filter((r) => r.status === "failed").length;
    const skipped = this.results.filter((r) => r.status === "skipped").length;

    const report: TestReport = {
      timestamp: new Date().toISOString(),
      duration,
      suites: new Set(this.results.map((r) => r.suite)).size,
      tests: this.results.length,
      passed,
      failed,
      skipped,
      results: this.results,
    };

    // Add coverage if requested
    if (this.options.coverage) {
      report.coverage = await this.calculateCoverage();
    }

    return report;
  }

  private async calculateCoverage(): Promise<TestReport["coverage"]> {
    // This would analyze the executed queries against the schema
    // For now, returning placeholder values
    return {
      types: 0,
      fields: 0,
      queries: 0,
      mutations: 0,
      subscriptions: 0,
    };
  }

  async run(suites: TestSuite[]): Promise<TestReport> {
    this.startTime = Date.now();
    this.results = [];

    logger.info(chalk.bold("\n🧪 Running Federation Tests\n"));

    for (const suite of suites) {
      await this.runSuite(suite);
    }

    const report = await this.generateReport();

    // Print summary
    logger.info(chalk.bold("\n📊 Test Summary\n"));
    logger.info(`Total: ${report.tests}`);
    logger.info(chalk.green(`Passed: ${report.passed}`));
    if (report.failed > 0) {
      logger.info(chalk.red(`Failed: ${report.failed}`));
    }
    if (report.skipped > 0) {
      logger.info(chalk.gray(`Skipped: ${report.skipped}`));
    }
    logger.info(`Duration: ${(report.duration / 1000).toFixed(2)}s`);

    // Save report
    const reportPath = join(process.cwd(), "federation-test-report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    logger.info(chalk.dim(`\nReport saved to: ${reportPath}`));

    return report;
  }
}

// Test assertions
export class Assertions {
  static hasField(result: any, path: string): void {
    const parts = path.split(".");
    let current = result;

    for (const part of parts) {
      if (current == null || !(part in current)) {
        throw new Error(`Field "${path}" not found in result`);
      }
      current = current[part];
    }
  }

  static equals(actual: any, expected: any, message?: string): void {
    if (actual !== expected) {
      throw new Error(
        message ||
          `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(
            actual
          )}`
      );
    }
  }

  static includes(array: any[], item: any, message?: string): void {
    if (!array.includes(item)) {
      throw new Error(
        message || `Array does not include ${JSON.stringify(item)}`
      );
    }
  }

  static matches(actual: string, pattern: RegExp, message?: string): void {
    if (!pattern.test(actual)) {
      throw new Error(
        message || `"${actual}" does not match pattern ${pattern}`
      );
    }
  }

  static isNull(value: any, message?: string): void {
    if (value !== null) {
      throw new Error(
        message || `Expected null but got ${JSON.stringify(value)}`
      );
    }
  }

  static isNotNull(value: any, message?: string): void {
    if (value === null) {
      throw new Error(message || `Expected non-null value but got null`);
    }
  }

  static isEmpty(value: any[], message?: string): void {
    if (!Array.isArray(value) || value.length > 0) {
      throw new Error(
        message || `Expected empty array but got ${JSON.stringify(value)}`
      );
    }
  }

  static isNotEmpty(value: any[], message?: string): void {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(message || `Expected non-empty array`);
    }
  }
}

// Test data generators
export class TestDataGenerator {
  static randomString(length: number = 10): string {
    return Math.random()
      .toString(36)
      .substring(2, length + 2);
  }

  static randomEmail(): string {
    return `test-${this.randomString()}@example.com`;
  }

  static randomInt(min: number = 0, max: number = 100): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static randomBool(): boolean {
    return Math.random() < 0.5;
  }

  static randomDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - this.randomInt(0, 365));
    return date.toISOString();
  }

  static randomEnum<T>(values: T[]): T | undefined {
    if (values.length === 0) {
      return undefined;
    }

    const index = this.randomInt(0, values.length - 1);
    return values[index];
  }
}

// Snapshot testing
export class SnapshotTester {
  private snapshotDir: string;

  constructor(snapshotDir: string = join(process.cwd(), "__snapshots__")) {
    this.snapshotDir = snapshotDir;
  }

  async toMatchSnapshot(name: string, data: any): Promise<void> {
    const snapshotPath = join(this.snapshotDir, `${name}.json`);

    try {
      const existingSnapshot = await readFile(snapshotPath, "utf-8");
      const existing = JSON.parse(existingSnapshot);

      if (!this.deepEqual(existing, data)) {
        throw new Error(`Snapshot mismatch for "${name}"`);
      }
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        // Create new snapshot
        await writeFile(snapshotPath, JSON.stringify(data, null, 2));
        logger.info(chalk.yellow(`Created new snapshot: ${name}`));
      } else {
        throw error;
      }
    }
  }

  private deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
