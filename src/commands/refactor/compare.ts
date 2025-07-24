import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { relative } from 'path';

export default class RefactorCompare extends Command {
  static override description = 'Compare performance results between refactoring runs';
  
  static override examples = [
    '<%= config.bin %> <%= command.id %> baseline.json current.json',
    '<%= config.bin %> <%= command.id %> before.json after.json --detailed',
    '<%= config.bin %> <%= command.id %> *.json --summary-only',
  ];

  static override args = [
    {
      name: 'baseline',
      description: 'Baseline benchmark results file',
      required: true,
    },
    {
      name: 'current',
      description: 'Current benchmark results file',
      required: true,
    },
  ];

  static override flags = {
    detailed: Flags.boolean({
      char: 'd',
      description: 'Show detailed comparison for each test',
      default: false,
    }),
    'summary-only': Flags.boolean({
      char: 's',
      description: 'Show only summary comparison',
      default: false,
    }),
    threshold: Flags.integer({
      char: 't',
      description: 'Performance change threshold % to highlight',
      default: 5,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'json', 'markdown'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RefactorCompare);
    
    this.log(chalk.blue('📊 Performance Comparison Report'));
    this.log(chalk.gray(`Comparing: ${args.baseline} vs ${args.current}\n`));

    try {
      const baseline = await this.loadBenchmarkData(args.baseline);
      const current = await this.loadBenchmarkData(args.current);

      if (!flags['summary-only']) {
        await this.compareDetailedResults(baseline, current, flags.detailed, flags.threshold);
      }

      await this.compareSummaries(baseline, current, flags.threshold);

      if (flags.format === 'json') {
        await this.outputJSON(baseline, current);
      } else if (flags.format === 'markdown') {
        await this.outputMarkdown(baseline, current);
      }

    } catch (error) {
      this.log(chalk.red('❌ Comparison failed'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private async loadBenchmarkData(filePath: string): Promise<BenchmarkData> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!data.results || !data.summary) {
        throw new Error(`Invalid benchmark file format: ${filePath}`);
      }

      return data;
    } catch (error) {
      throw new Error(`Failed to load ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async compareDetailedResults(
    baseline: BenchmarkData, 
    current: BenchmarkData, 
    detailed: boolean,
    threshold: number
  ): Promise<void> {
    this.log(chalk.blue('🔍 Detailed Test Comparison'));
    this.log('='.repeat(80));

    const comparisons: ComparisonResult[] = [];

    for (const currentResult of current.results) {
      const baselineResult = baseline.results.find(r => 
        r.category === currentResult.category && r.test === currentResult.test
      );

      if (baselineResult) {
        const comparison = this.calculateComparison(baselineResult, currentResult);
        comparisons.push(comparison);

        if (Math.abs(comparison.improvementChange) >= threshold || detailed) {
          this.printDetailedComparison(comparison, threshold);
        }
      } else {
        this.log(chalk.yellow(`⚠️  New test: ${currentResult.category} - ${currentResult.test}`));
      }
    }

    // Check for removed tests
    for (const baselineResult of baseline.results) {
      const found = current.results.find(r => 
        r.category === baselineResult.category && r.test === baselineResult.test
      );
      if (!found) {
        this.log(chalk.red(`❌ Removed test: ${baselineResult.category} - ${baselineResult.test}`));
      }
    }

    this.log('\n' + '='.repeat(80));
  }

  private calculateComparison(baseline: BenchmarkResult, current: BenchmarkResult): ComparisonResult {
    const traditionalChange = ((current.traditional - baseline.traditional) / baseline.traditional) * 100;
    const refactoredChange = ((current.refactored - baseline.refactored) / baseline.refactored) * 100;
    const improvementChange = current.improvement - baseline.improvement;
    
    return {
      category: current.category,
      test: current.test,
      baseline,
      current,
      traditionalChange,
      refactoredChange,
      improvementChange,
    };
  }

  private printDetailedComparison(comparison: ComparisonResult, threshold: number): void {
    const { category, test, improvementChange } = comparison;
    
    // Determine status and color
    let status: string;
    let color: (text: string) => string;
    
    if (Math.abs(improvementChange) < threshold) {
      status = '➡️  No significant change';
      color = chalk.gray;
    } else if (improvementChange > 0) {
      status = '📈 Improved performance';
      color = chalk.green;
    } else {
      status = '📉 Performance regression';
      color = chalk.red;
    }

    this.log(color(`\n${status}: ${category} - ${test}`));
    this.log(color(`  Improvement change: ${improvementChange.toFixed(2)}%`));
    this.log(chalk.gray(`  Baseline improvement: ${comparison.baseline.improvement.toFixed(2)}%`));
    this.log(chalk.gray(`  Current improvement: ${comparison.current.improvement.toFixed(2)}%`));
    
    if (Math.abs(comparison.traditionalChange) > 1) {
      this.log(chalk.gray(`  Traditional time change: ${comparison.traditionalChange.toFixed(2)}%`));
    }
    if (Math.abs(comparison.refactoredChange) > 1) {
      this.log(chalk.gray(`  Refactored time change: ${comparison.refactoredChange.toFixed(2)}%`));
    }
  }

  private async compareSummaries(baseline: BenchmarkData, current: BenchmarkData, threshold: number): Promise<void> {
    this.log(chalk.blue('\n📊 Summary Comparison'));
    this.log('='.repeat(60));

    const baselineSum = baseline.summary;
    const currentSum = current.summary;

    const overallChange = currentSum.overallImprovement - baselineSum.overallImprovement;
    const averageChange = currentSum.averageImprovement - baselineSum.averageImprovement;
    const timeChange = ((currentSum.totalRefactoredTime - baselineSum.totalRefactoredTime) / baselineSum.totalRefactoredTime) * 100;

    // Overall assessment
    if (Math.abs(overallChange) >= threshold) {
      const color = overallChange > 0 ? chalk.green : chalk.red;
      const trend = overallChange > 0 ? '📈 Improved' : '📉 Regressed';
      this.log(color(`${trend} Overall Performance: ${overallChange.toFixed(2)}%`));
    } else {
      this.log(chalk.gray(`➡️  Overall Performance: No significant change (${overallChange.toFixed(2)}%)`));
    }

    // Detailed metrics
    this.log(`\n📈 Baseline vs Current:`);
    this.log(chalk.gray(`  Overall improvement: ${baselineSum.overallImprovement.toFixed(2)}% → ${currentSum.overallImprovement.toFixed(2)}%`));
    this.log(chalk.gray(`  Average improvement: ${baselineSum.averageImprovement.toFixed(2)}% → ${currentSum.averageImprovement.toFixed(2)}%`));
    this.log(chalk.gray(`  Total tests: ${baselineSum.totalTests} → ${currentSum.totalTests}`));

    if (Math.abs(timeChange) > 1) {
      const timeColor = timeChange < 0 ? chalk.green : chalk.red;
      this.log(timeColor(`  Refactored time change: ${timeChange.toFixed(2)}%`));
    }

    // Recommendations
    this.log(chalk.blue('\n💡 Recommendations:'));
    if (overallChange > threshold) {
      this.log(chalk.green('  ✅ Excellent improvement! Continue with current approach'));
    } else if (overallChange > 0) {
      this.log(chalk.yellow('  ⚠️  Modest improvement, consider additional optimizations'));
    } else if (overallChange < -threshold) {
      this.log(chalk.red('  ❌ Performance regression detected, review recent changes'));
    } else {
      this.log(chalk.gray('  ➡️  Performance is stable'));
    }

    this.log('='.repeat(60));
  }

  private async outputJSON(baseline: BenchmarkData, current: BenchmarkData): Promise<void> {
    const comparison = {
      baseline: {
        timestamp: baseline.timestamp,
        summary: baseline.summary,
      },
      current: {
        timestamp: current.timestamp,
        summary: current.summary,
      },
      changes: {
        overallImprovement: current.summary.overallImprovement - baseline.summary.overallImprovement,
        averageImprovement: current.summary.averageImprovement - baseline.summary.averageImprovement,
        testCount: current.summary.totalTests - baseline.summary.totalTests,
      }
    };

    this.log('\n' + JSON.stringify(comparison, null, 2));
  }

  private async outputMarkdown(baseline: BenchmarkData, current: BenchmarkData): Promise<void> {
    const overallChange = current.summary.overallImprovement - baseline.summary.overallImprovement;
    
    this.log('\n## Performance Comparison Report\n');
    this.log(`**Baseline:** ${baseline.timestamp}`);
    this.log(`**Current:** ${current.timestamp}\n`);
    
    this.log('### Summary\n');
    this.log('| Metric | Baseline | Current | Change |');
    this.log('|--------|----------|---------|--------|');
    this.log(`| Overall Improvement | ${baseline.summary.overallImprovement.toFixed(2)}% | ${current.summary.overallImprovement.toFixed(2)}% | ${overallChange.toFixed(2)}% |`);
    this.log(`| Average Improvement | ${baseline.summary.averageImprovement.toFixed(2)}% | ${current.summary.averageImprovement.toFixed(2)}% | ${(current.summary.averageImprovement - baseline.summary.averageImprovement).toFixed(2)}% |`);
    this.log(`| Total Tests | ${baseline.summary.totalTests} | ${current.summary.totalTests} | ${current.summary.totalTests - baseline.summary.totalTests} |`);
    
    this.log('\n### Assessment\n');
    if (overallChange > 5) {
      this.log('✅ **Significant improvement** in performance metrics.');
    } else if (overallChange > 0) {
      this.log('⚠️ **Modest improvement** in performance metrics.');
    } else if (overallChange < -5) {
      this.log('❌ **Performance regression** detected.');
    } else {
      this.log('➡️ **Stable performance** with no significant changes.');
    }
  }
}

interface BenchmarkResult {
  category: string;
  test: string;
  traditional: number;
  refactored: number;
  improvement: number;
  iterations: number;
}

interface BenchmarkSummary {
  totalTests: number;
  totalTraditionalTime: number;
  totalRefactoredTime: number;
  overallImprovement: number;
  averageImprovement: number;
}

interface BenchmarkData {
  timestamp: string;
  results: BenchmarkResult[];
  summary: BenchmarkSummary;
}

interface ComparisonResult {
  category: string;
  test: string;
  baseline: BenchmarkResult;
  current: BenchmarkResult;
  traditionalChange: number;
  refactoredChange: number;
  improvementChange: number;
}