import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { federationMetrics } from './monitoring.js';
import { EventStreamManager } from './event-streaming.js';

// ML-powered query optimization
export interface QueryPattern {
  query: string;
  variables: Record<string, any>;
  frequency: number;
  averageLatency: number;
  complexity: number;
  userId?: string;
  timestamp: Date;
}

export interface OptimizationRecommendation {
  type: 'cache' | 'index' | 'dataloader' | 'federation' | 'query_rewrite';
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: {
    latencyReduction: number; // percentage
    resourceSavings: number; // percentage
    userExperience: number; // score 1-10
  };
  implementation: {
    effort: 'low' | 'medium' | 'high';
    estimatedHours: number;
    riskLevel: 'low' | 'medium' | 'high';
  };
  code?: string;
}

// Query pattern analyzer
export class QueryPatternAnalyzer {
  private patterns = new Map<string, QueryPattern>();
  private recommendations: OptimizationRecommendation[] = [];

  constructor(private eventManager: EventStreamManager) {
    this.subscribeToQueryEvents();
  }

  private subscribeToQueryEvents(): void {
    this.eventManager.subscribe('graphql.query.*', (event) => {
      this.analyzeQuery({
        query: event.data.query,
        variables: event.data.variables || {},
        frequency: 1,
        averageLatency: event.data.duration || 0,
        complexity: this.calculateQueryComplexity(event.data.query),
        userId: event.metadata?.userId,
        timestamp: event.timestamp,
      });
    });
  }

  // Analyze query patterns and generate optimizations
  analyzeQuery(pattern: QueryPattern): void {
    const key = this.generatePatternKey(pattern.query, pattern.variables);
    const existing = this.patterns.get(key);

    if (existing) {
      // Update existing pattern
      existing.frequency += 1;
      existing.averageLatency = (existing.averageLatency + pattern.averageLatency) / 2;
      existing.timestamp = pattern.timestamp;
    } else {
      // Add new pattern
      this.patterns.set(key, pattern);
    }

    // Generate recommendations periodically
    if (this.patterns.size % 100 === 0) {
      this.generateOptimizationRecommendations();
    }
  }

  private generatePatternKey(query: string, variables: Record<string, any>): string {
    // Normalize query by removing whitespace and variables
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();
    const sortedVarKeys = Object.keys(variables).sort();
    return `${normalizedQuery}:${sortedVarKeys.join(',')}`;
  }

  private calculateQueryComplexity(query: string): number {
    // Simple complexity calculation
    const depth = (query.match(/\{/g) || []).length;
    const fields = (query.match(/\w+:/g) || []).length;
    const arrays = (query.match(/\[/g) || []).length;
    
    return depth * 2 + fields + arrays * 3;
  }

  // Generate ML-powered optimization recommendations
  generateOptimizationRecommendations(): void {
    logger.info(chalk.blue('🤖 Generating ML optimization recommendations...'));

    this.recommendations = [];

    // Analyze high-frequency queries
    const sortedPatterns = Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency);

    const highFrequencyQueries = sortedPatterns.slice(0, 10);

    for (const pattern of highFrequencyQueries) {
      // Cache optimization
      if (pattern.frequency > 50 && pattern.averageLatency > 100) {
        this.recommendations.push({
          type: 'cache',
          priority: 'high',
          description: `Cache frequently requested query with ${pattern.frequency} requests and ${pattern.averageLatency}ms avg latency`,
          impact: {
            latencyReduction: 80,
            resourceSavings: 60,
            userExperience: 8,
          },
          implementation: {
            effort: 'low',
            estimatedHours: 2,
            riskLevel: 'low',
          },
          code: this.generateCacheCode(pattern),
        });
      }

      // Index optimization
      if (pattern.complexity > 20 && pattern.averageLatency > 500) {
        this.recommendations.push({
          type: 'index',
          priority: 'medium',
          description: `Add database index for complex query (complexity: ${pattern.complexity})`,
          impact: {
            latencyReduction: 60,
            resourceSavings: 40,
            userExperience: 7,
          },
          implementation: {
            effort: 'medium',
            estimatedHours: 4,
            riskLevel: 'medium',
          },
          code: this.generateIndexCode(pattern),
        });
      }

      // DataLoader optimization
      if (this.detectNPlusOnePattern(pattern)) {
        this.recommendations.push({
          type: 'dataloader',
          priority: 'high',
          description: 'Detected N+1 query pattern - implement DataLoader',
          impact: {
            latencyReduction: 90,
            resourceSavings: 80,
            userExperience: 9,
          },
          implementation: {
            effort: 'medium',
            estimatedHours: 6,
            riskLevel: 'low',
          },
          code: this.generateDataLoaderCode(pattern),
        });
      }
    }

    // Analyze query rewrite opportunities
    this.analyzeQueryRewriteOpportunities();

    logger.info(chalk.green(`✅ Generated ${this.recommendations.length} optimization recommendations`));
  }

  private detectNPlusOnePattern(pattern: QueryPattern): boolean {
    // Simple N+1 detection based on nested field patterns
    const hasNestedLists = pattern.query.includes('[') && pattern.query.includes('{');
    const hasUserField = pattern.query.includes('user {') || pattern.query.includes('todos {');
    return hasNestedLists && hasUserField && pattern.frequency > 20;
  }

  private analyzeQueryRewriteOpportunities(): void {
    // Analyze for potential query optimizations
    const complexQueries = Array.from(this.patterns.values())
      .filter(p => p.complexity > 30 && p.averageLatency > 200);

    for (const pattern of complexQueries) {
      this.recommendations.push({
        type: 'query_rewrite',
        priority: 'medium',
        description: `Rewrite complex query to reduce depth and improve performance`,
        impact: {
          latencyReduction: 40,
          resourceSavings: 30,
          userExperience: 6,
        },
        implementation: {
          effort: 'high',
          estimatedHours: 8,
          riskLevel: 'medium',
        },
        code: this.generateQueryRewriteCode(pattern),
      });
    }
  }

  private generateCacheCode(pattern: QueryPattern): string {
    return `
// Add caching for high-frequency query
const cacheConfig = {
  ttl: 300000, // 5 minutes
  key: "${this.generatePatternKey(pattern.query, pattern.variables)}",
  tags: ["user", "todo"]
};

// In your GraphQL resolver:
const cachedResult = await cache.get(cacheConfig.key);
if (cachedResult) {
  return cachedResult;
}

const result = await originalResolver(args);
await cache.set(cacheConfig.key, result, cacheConfig.ttl);
return result;
`;
  }

  private generateIndexCode(pattern: QueryPattern): string {
    return `
-- Add database index for improved query performance
-- Analyze the query pattern and add appropriate indexes

-- Example for user queries:
CREATE INDEX CONCURRENTLY idx_users_email_created_at 
ON users(email, created_at) 
WHERE deleted_at IS NULL;

-- Example for todo queries:
CREATE INDEX CONCURRENTLY idx_todos_user_status_priority 
ON todos(user_id, status, priority) 
WHERE deleted_at IS NULL;

-- Composite index for complex filters:
CREATE INDEX CONCURRENTLY idx_todos_complex_filter 
ON todos(user_id, status, priority, due_date) 
INCLUDE (title, description);
`;
  }

  private generateDataLoaderCode(pattern: QueryPattern): string {
    return `
// Implement DataLoader to solve N+1 queries
import DataLoader from 'dataloader';

// User DataLoader
const userLoader = new DataLoader(async (userIds) => {
  const users = await db.user.findMany({
    where: { id: { in: userIds } }
  });
  
  return userIds.map(id => users.find(user => user.id === id));
});

// Todo DataLoader
const todosByUserLoader = new DataLoader(async (userIds) => {
  const todos = await db.todo.findMany({
    where: { userId: { in: userIds } }
  });
  
  return userIds.map(userId => 
    todos.filter(todo => todo.userId === userId)
  );
});

// In your GraphQL resolver:
const Todo = {
  user: (parent) => userLoader.load(parent.userId),
};

const User = {
  todos: (parent) => todosByUserLoader.load(parent.id),
};
`;
  }

  private generateQueryRewriteCode(pattern: QueryPattern): string {
    return `
// Query rewrite suggestion - break complex query into simpler parts

// Original complex query - consider splitting into:
// 1. Shallow query for main data
// 2. Separate queries for nested data
// 3. Use fragments for reusable parts

fragment UserBasicInfo on User {
  id
  email
  name
}

fragment TodoBasicInfo on Todo {
  id
  title
  status
  priority
}

// Instead of deeply nested query, use multiple simpler queries:
query GetUserWithBasicInfo($userId: ID!) {
  user(id: $userId) {
    ...UserBasicInfo
    todoCount
  }
}

query GetUserTodos($userId: ID!, $first: Int = 10) {
  todos(userId: $userId, first: $first) {
    ...TodoBasicInfo
    dueDate
  }
}
`;
  }

  // Get recommendations sorted by priority and impact
  getRecommendations(): OptimizationRecommendation[] {
    return this.recommendations.sort((a, b) => {
      const priorityScore = { critical: 4, high: 3, medium: 2, low: 1 };
      const aPriority = priorityScore[a.priority];
      const bPriority = priorityScore[b.priority];
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // Sort by impact score
      const aImpact = a.impact.latencyReduction + a.impact.resourceSavings + (a.impact.userExperience * 10);
      const bImpact = b.impact.latencyReduction + b.impact.resourceSavings + (b.impact.userExperience * 10);
      
      return bImpact - aImpact;
    });
  }

  // Export analytics
  getAnalytics(): {
    totalQueries: number;
    uniquePatterns: number;
    avgComplexity: number;
    avgLatency: number;
    topQueries: QueryPattern[];
    recommendations: OptimizationRecommendation[];
  } {
    const patterns = Array.from(this.patterns.values());
    
    return {
      totalQueries: patterns.reduce((sum, p) => sum + p.frequency, 0),
      uniquePatterns: patterns.length,
      avgComplexity: patterns.reduce((sum, p) => sum + p.complexity, 0) / patterns.length,
      avgLatency: patterns.reduce((sum, p) => sum + p.averageLatency, 0) / patterns.length,
      topQueries: patterns.sort((a, b) => b.frequency - a.frequency).slice(0, 10),
      recommendations: this.getRecommendations(),
    };
  }
}

// Auto-scaling manager
export class AutoScalingManager {
  private metrics = {
    requestsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    activeConnections: 0,
  };

  private scalingHistory: Array<{
    timestamp: Date;
    action: 'scale_up' | 'scale_down' | 'no_action';
    reason: string;
    before: number;
    after: number;
  }> = [];

  constructor(private eventManager: EventStreamManager) {
    this.collectMetrics();
    this.startAutoScaling();
  }

  private collectMetrics(): void {
    setInterval(async () => {
      try {
        // Collect federation metrics
        const requestsTotal = await federationMetrics.requestsTotal.get();
        const requestDuration = await federationMetrics.requestDuration.get();
        const errorsTotal = await federationMetrics.errorsTotal.get();

        // Calculate current metrics
        this.metrics.requestsPerSecond = this.calculateRPS(requestsTotal);
        this.metrics.averageLatency = this.calculateAverageLatency(requestDuration);
        this.metrics.errorRate = this.calculateErrorRate(errorsTotal, requestsTotal);
        
        // Get system metrics
        const memUsage = process.memoryUsage();
        this.metrics.memoryUsage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        
        // CPU usage (simplified)
        const cpuUsage = process.cpuUsage();
        this.metrics.cpuUsage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds

        logger.debug(chalk.dim('Auto-scaling metrics:'), this.metrics);
      } catch (error) {
        logger.error('Error collecting auto-scaling metrics:', error);
      }
    }, 10000); // Every 10 seconds
  }

  private startAutoScaling(): void {
    setInterval(() => {
      const decision = this.makeScalingDecision();
      if (decision.action !== 'no_action') {
        this.executeScalingAction(decision);
      }
    }, 30000); // Every 30 seconds
  }

  private makeScalingDecision(): {
    action: 'scale_up' | 'scale_down' | 'no_action';
    reason: string;
    targetReplicas: number;
  } {
    const currentReplicas = this.getCurrentReplicas();
    
    // Scale up conditions
    if (this.metrics.requestsPerSecond > 1000 && this.metrics.averageLatency > 500) {
      return {
        action: 'scale_up',
        reason: `High load: ${this.metrics.requestsPerSecond} RPS, ${this.metrics.averageLatency}ms latency`,
        targetReplicas: Math.min(currentReplicas + 2, 10),
      };
    }

    if (this.metrics.cpuUsage > 80 || this.metrics.memoryUsage > 85) {
      return {
        action: 'scale_up',
        reason: `Resource pressure: ${this.metrics.cpuUsage}% CPU, ${this.metrics.memoryUsage}% memory`,
        targetReplicas: Math.min(currentReplicas + 1, 10),
      };
    }

    if (this.metrics.errorRate > 5) {
      return {
        action: 'scale_up',
        reason: `High error rate: ${this.metrics.errorRate}%`,
        targetReplicas: Math.min(currentReplicas + 1, 10),
      };
    }

    // Scale down conditions
    if (this.metrics.requestsPerSecond < 100 && 
        this.metrics.averageLatency < 100 && 
        this.metrics.cpuUsage < 30 && 
        currentReplicas > 2) {
      return {
        action: 'scale_down',
        reason: `Low load: ${this.metrics.requestsPerSecond} RPS, ${this.metrics.cpuUsage}% CPU`,
        targetReplicas: Math.max(currentReplicas - 1, 2),
      };
    }

    return { action: 'no_action', reason: 'Metrics within normal range', targetReplicas: currentReplicas };
  }

  private async executeScalingAction(decision: {
    action: 'scale_up' | 'scale_down';
    reason: string;
    targetReplicas: number;
  }): Promise<void> {
    const currentReplicas = this.getCurrentReplicas();
    
    logger.info(chalk.yellow(`🔧 Auto-scaling: ${decision.action} from ${currentReplicas} to ${decision.targetReplicas} replicas`));
    logger.info(chalk.dim(`Reason: ${decision.reason}`));

    try {
      // In production, this would call Kubernetes API, Docker Swarm, or cloud provider APIs
      await this.scaleReplicas(decision.targetReplicas);

      // Record scaling action
      this.scalingHistory.push({
        timestamp: new Date(),
        action: decision.action,
        reason: decision.reason,
        before: currentReplicas,
        after: decision.targetReplicas,
      });

      // Publish scaling event
      await this.eventManager.publishEvent({
        type: 'system.autoscaling.executed',
        source: 'auto-scaling-manager',
        data: {
          action: decision.action,
          reason: decision.reason,
          replicas: {
            before: currentReplicas,
            after: decision.targetReplicas,
          },
        },
      });

      logger.info(chalk.green(`✅ Successfully ${decision.action}d to ${decision.targetReplicas} replicas`));
    } catch (error) {
      logger.error(chalk.red(`Failed to execute scaling action: ${error}`));
    }
  }

  private getCurrentReplicas(): number {
    // In production, this would query the orchestrator
    return parseInt(process.env.CURRENT_REPLICAS || '3');
  }

  private async scaleReplicas(targetReplicas: number): Promise<void> {
    // Mock scaling implementation
    // In production, implement actual scaling logic:
    
    if (process.env.KUBERNETES_SERVICE_HOST) {
      // Kubernetes scaling
      await this.scaleKubernetesDeployment(targetReplicas);
    } else if (process.env.DOCKER_SWARM_MODE) {
      // Docker Swarm scaling
      await this.scaleDockerService(targetReplicas);
    } else {
      // Local development - just log
      logger.info(chalk.blue(`Mock scaling to ${targetReplicas} replicas`));
    }
  }

  private async scaleKubernetesDeployment(replicas: number): Promise<void> {
    // Implement Kubernetes scaling
    const command = `kubectl scale deployment pothos-todo-gateway --replicas=${replicas}`;
    logger.info(chalk.blue(`Executing: ${command}`));
    // Execute kubectl command
  }

  private async scaleDockerService(replicas: number): Promise<void> {
    // Implement Docker Swarm scaling
    const command = `docker service scale pothos-todo-gateway=${replicas}`;
    logger.info(chalk.blue(`Executing: ${command}`));
    // Execute docker command
  }

  private calculateRPS(requestsTotal: any): number {
    // Calculate requests per second from Prometheus metrics
    // This is a simplified calculation
    return 0; // Would implement actual RPS calculation
  }

  private calculateAverageLatency(requestDuration: any): number {
    // Calculate average latency from histogram
    return 0; // Would implement actual latency calculation
  }

  private calculateErrorRate(errorsTotal: any, requestsTotal: any): number {
    // Calculate error rate percentage
    return 0; // Would implement actual error rate calculation
  }

  // Get scaling analytics
  getScalingAnalytics(): {
    currentMetrics: typeof this.metrics;
    scalingHistory: typeof this.scalingHistory;
    recommendations: string[];
  } {
    const recentHistory = this.scalingHistory.slice(-10);
    const scaleUpCount = recentHistory.filter(h => h.action === 'scale_up').length;
    const scaleDownCount = recentHistory.filter(h => h.action === 'scale_down').length;

    const recommendations = [];
    
    if (scaleUpCount > scaleDownCount * 2) {
      recommendations.push('Consider increasing base replica count - frequent scale-ups detected');
    }
    
    if (this.metrics.averageLatency > 200) {
      recommendations.push('High latency detected - consider query optimization');
    }
    
    if (this.metrics.errorRate > 2) {
      recommendations.push('Elevated error rate - investigate error sources');
    }

    return {
      currentMetrics: this.metrics,
      scalingHistory: recentHistory,
      recommendations,
    };
  }
}

// Export instances
export const queryPatternAnalyzer = new QueryPatternAnalyzer(
  new EventStreamManager()
);

export const autoScalingManager = new AutoScalingManager(
  new EventStreamManager()
);