import { OpenAI } from 'openai';
import { logger } from '@/logger.js';
import type { PrismaClient } from '@prisma/client';
import { EmbeddingService } from './EmbeddingService.js';
import { MLPredictionService } from './MLPredictionService.js';
import { SingletonService } from '../core/SingletonService.js';

export interface ProductivityInsight {
  type: 'productivity' | 'pattern' | 'optimization' | 'achievement' | 'warning';
  title: string;
  description: string;
  actionable: boolean;
  confidence: number;
  data: Record<string, any>;
  recommendations: string[];
  createdAt: Date;
}

export interface WorkPatternAnalysis {
  peakProductivityHours: { start: number; end: number };
  averageTasksPerDay: number;
  completionRate: number;
  mostProductiveDays: string[];
  commonDelayFactors: string[];
  strengths: string[];
  improvementAreas: string[];
}

export interface SmartRecommendation {
  id: string;
  type: 'task_creation' | 'scheduling' | 'priority_adjustment' | 'break_suggestion';
  title: string;
  reason: string;
  impact: 'low' | 'medium' | 'high';
  timeToImplement: number; // minutes
  category: string;
}

/**
 * AI-Powered Insights Service
 * 
 * Provides intelligent insights about user productivity, work patterns,
 * and actionable recommendations for improvement.
 */
export class AIInsightService extends SingletonService<AIInsightService> {
  private openai: OpenAI | null = null;
  private embeddingService: EmbeddingService | null = null;
  private mlService: MLPredictionService | null = null;
  private prisma: PrismaClient | null = null;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<AIInsightService> {
    return super.getInstance();
  }

  /**
   * Configure the AIInsightService with dependencies
   */
  public async configure(prisma: PrismaClient): Promise<void> {
    this.prisma = prisma;
    this.embeddingService = await EmbeddingService.getInstance();
    await this.embeddingService.configure(prisma);
    
    this.mlService = await MLPredictionService.getInstance();
    this.mlService.configure(prisma);
  }

  initialize(apiKey: string): void {
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      logger.info('AI Insight service initialized');
    } else {
      logger.warn('OpenAI API key not provided, insights will be limited');
    }
  }

  /**
   * Generate comprehensive productivity insights for a user
   */
  async generateProductivityInsights(userId: string): Promise<ProductivityInsight[]> {
    try {
      this.ensureConfigured();

      const insights: ProductivityInsight[] = [];

      // Get user's task data for analysis
      const recentTodos = await this.prisma!.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          todoList: true,
        },
      });

      if (recentTodos.length === 0) {
        return [{
          type: 'pattern',
          title: 'Welcome to Your Productivity Journey',
          description: 'Start by creating your first tasks to unlock personalized insights.',
          actionable: true,
          confidence: 1.0,
          data: {},
          recommendations: ['Create your first task', 'Set up task priorities', 'Organize tasks into lists'],
          createdAt: new Date(),
        }];
      }

      // Analyze completion patterns
      const completionInsight = await this.analyzeCompletionPatterns(recentTodos);
      if (completionInsight) insights.push(completionInsight);

      // Analyze work patterns
      const patternInsight = await this.analyzeWorkPatterns(recentTodos);
      if (patternInsight) insights.push(patternInsight);

      // Check for productivity trends
      const trendInsight = await this.analyzeProductivityTrends(recentTodos);
      if (trendInsight) insights.push(trendInsight);

      // Identify optimization opportunities
      const optimizationInsight = await this.identifyOptimizationOpportunities(recentTodos);
      if (optimizationInsight) insights.push(optimizationInsight);

      // Achievement recognition
      const achievementInsight = await this.recognizeAchievements(recentTodos);
      if (achievementInsight) insights.push(achievementInsight);

      return insights;
    } catch (error) {
      logger.error('Failed to generate productivity insights', { error, userId });
      return [];
    }
  }

  /**
   * Analyze user's work patterns and habits
   */
  async analyzeWorkPatterns(todos: any[]): Promise<WorkPatternAnalysis> {
    const completed = todos.filter(t => t.status === 'COMPLETED' && t.completedAt);
    
    if (completed.length === 0) {
      return {
        peakProductivityHours: { start: 9, end: 11 },
        averageTasksPerDay: 0,
        completionRate: 0,
        mostProductiveDays: [],
        commonDelayFactors: [],
        strengths: [],
        improvementAreas: ['Start completing tasks to unlock pattern analysis'],
      };
    }

    // Analyze completion times by hour
    const hourlyCompletions: Record<number, number> = {};
    const dailyCompletions: Record<string, number> = {};

    for (const todo of completed) {
      const hour = todo.completedAt.getHours();
      const day = todo.completedAt.toLocaleDateString('en-US', { weekday: 'long' });
      
      hourlyCompletions[hour] = (hourlyCompletions[hour] || 0) + 1;
      dailyCompletions[day] = (dailyCompletions[day] || 0) + 1;
    }

    // Find peak productivity hours
    const peakHour = Object.entries(hourlyCompletions)
      .sort(([, a], [, b]) => b - a)[0];
    
    const peakProductivityHours = peakHour 
      ? { start: parseInt(peakHour[0]), end: parseInt(peakHour[0]) + 2 }
      : { start: 9, end: 11 };

    // Calculate metrics
    const totalDays = Math.max(1, Math.ceil(
      (new Date().getTime() - completed[completed.length - 1].createdAt.getTime()) / (1000 * 60 * 60 * 24)
    ));
    
    const completionRate = todos.length > 0 ? completed.length / todos.length : 0;
    const averageTasksPerDay = completed.length / totalDays;

    const mostProductiveDays = Object.entries(dailyCompletions)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([day]) => day);

    return {
      peakProductivityHours,
      averageTasksPerDay,
      completionRate,
      mostProductiveDays,
      commonDelayFactors: await this.identifyDelayFactors(todos),
      strengths: await this.identifyStrengths(todos),
      improvementAreas: await this.identifyImprovementAreas(todos),
    };
  }

  /**
   * Generate smart recommendations based on AI analysis
   */
  async generateSmartRecommendations(userId: string): Promise<SmartRecommendation[]> {
    try {
      if (!this.openai) {
        return this.getFallbackRecommendations();
      }

      const recentTodos = await this.prisma.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const workPattern = await this.analyzeWorkPatterns(recentTodos);
      const currentHour = new Date().getHours();

      const systemPrompt = `You are a productivity AI assistant. Generate smart, actionable recommendations based on user data.
Return a JSON array of recommendations with:
- id: unique identifier
- type: task_creation, scheduling, priority_adjustment, or break_suggestion
- title: short descriptive title
- reason: explanation why this helps
- impact: low, medium, or high
- timeToImplement: minutes needed
- category: productivity category`;

      const userPrompt = `User productivity data:
Current time: ${new Date().toLocaleString()}
Current hour: ${currentHour}
Peak hours: ${workPattern.peakProductivityHours.start}-${workPattern.peakProductivityHours.end}
Completion rate: ${(workPattern.completionRate * 100).toFixed(1)}%
Average tasks/day: ${workPattern.averageTasksPerDay.toFixed(1)}
Recent tasks: ${recentTodos.slice(0, 10).map(t => `${t.title} (${t.status})`).join(', ')}
Improvement areas: ${workPattern.improvementAreas.join(', ')}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 800,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"recommendations": []}');
      return result.recommendations || [];
    } catch (error) {
      logger.error('Failed to generate smart recommendations', { error, userId });
      return this.getFallbackRecommendations();
    }
  }

  /**
   * Predict user burnout risk based on task patterns
   */
  async predictBurnoutRisk(userId: string): Promise<{
    riskLevel: 'low' | 'medium' | 'high';
    confidence: number;
    factors: string[];
    recommendations: string[];
  }> {
    try {
      const recentTodos = await this.prisma.todo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Calculate stress indicators
      const overdueTasks = recentTodos.filter(t => 
        t.status !== 'COMPLETED' && t.dueDate && t.dueDate < new Date()
      ).length;

      const highPriorityPending = recentTodos.filter(t => 
        t.status !== 'COMPLETED' && (t.priority === 'HIGH' || t.priority === 'URGENT')
      ).length;

      const recentCompletions = recentTodos.filter(t => 
        t.status === 'COMPLETED' && 
        t.completedAt && 
        t.completedAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      ).length;

      const workPattern = await this.analyzeWorkPatterns(recentTodos);

      // Simple burnout risk calculation
      let riskScore = 0;
      const factors: string[] = [];

      if (overdueTasks > 5) {
        riskScore += 30;
        factors.push(`${overdueTasks} overdue tasks`);
      }

      if (highPriorityPending > 10) {
        riskScore += 25;
        factors.push(`${highPriorityPending} high-priority pending tasks`);
      }

      if (workPattern.completionRate < 0.6) {
        riskScore += 20;
        factors.push('Low completion rate');
      }

      if (recentCompletions > workPattern.averageTasksPerDay * 2) {
        riskScore += 15;
        factors.push('Working above average pace');
      }

      const riskLevel: 'low' | 'medium' | 'high' = 
        riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

      const recommendations = this.getBurnoutRecommendations(riskLevel);

      return {
        riskLevel,
        confidence: Math.min(0.9, riskScore / 100),
        factors,
        recommendations,
      };
    } catch (error) {
      logger.error('Failed to predict burnout risk', { error, userId });
      return {
        riskLevel: 'low',
        confidence: 0.3,
        factors: [],
        recommendations: ['Take regular breaks', 'Prioritize important tasks'],
      };
    }
  }

  private async analyzeCompletionPatterns(todos: any[]): Promise<ProductivityInsight | null> {
    const completed = todos.filter(t => t.status === 'COMPLETED').length;
    const total = todos.length;
    
    if (total === 0) return null;

    const completionRate = completed / total;
    
    return {
      type: 'pattern',
      title: 'Task Completion Analysis',
      description: `You complete ${(completionRate * 100).toFixed(1)}% of your tasks. ${
        completionRate > 0.8 ? 'Excellent completion rate!' : 
        completionRate > 0.6 ? 'Good completion rate with room for improvement.' :
        'Consider reviewing your task planning approach.'
      }`,
      actionable: completionRate < 0.7,
      confidence: 0.8,
      data: { completionRate, completed, total },
      recommendations: completionRate < 0.7 ? [
        'Break large tasks into smaller ones',
        'Set more realistic deadlines',
        'Prioritize fewer tasks each day'
      ] : [
        'Keep up the great work!',
        'Consider taking on more challenging tasks'
      ],
      createdAt: new Date(),
    };
  }

  private async analyzeProductivityTrends(todos: any[]): Promise<ProductivityInsight | null> {
    const recent = todos.filter(t => 
      t.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    const older = todos.filter(t => 
      t.createdAt <= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) &&
      t.createdAt > new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    );

    if (recent.length === 0 || older.length === 0) return null;

    const recentCompletionRate = recent.filter(t => t.status === 'COMPLETED').length / recent.length;
    const olderCompletionRate = older.filter(t => t.status === 'COMPLETED').length / older.length;
    
    const trend = recentCompletionRate - olderCompletionRate;

    return {
      type: 'productivity',
      title: 'Productivity Trend',
      description: `Your productivity has ${
        trend > 0.1 ? 'improved significantly' :
        trend > 0 ? 'improved slightly' :
        trend > -0.1 ? 'remained stable' :
        'declined recently'
      } compared to last week.`,
      actionable: trend < -0.1,
      confidence: 0.7,
      data: { trend, recentRate: recentCompletionRate, olderRate: olderCompletionRate },
      recommendations: trend < 0 ? [
        'Review what changed in your routine',
        'Consider reducing task load temporarily',
        'Focus on completing existing tasks before adding new ones'
      ] : [
        'Maintain your current momentum',
        'Consider gradually increasing task complexity'
      ],
      createdAt: new Date(),
    };
  }

  private async identifyOptimizationOpportunities(todos: any[]): Promise<ProductivityInsight | null> {
    const longRunningTasks = todos.filter(t => {
      if (!t.createdAt || t.status === 'COMPLETED') return false;
      const daysSinceCreated = (new Date().getTime() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceCreated > 7;
    });

    if (longRunningTasks.length === 0) return null;

    return {
      type: 'optimization',
      title: 'Task Optimization Opportunity',
      description: `You have ${longRunningTasks.length} tasks that have been pending for over a week. These might benefit from being broken down or reprioritized.`,
      actionable: true,
      confidence: 0.9,
      data: { longRunningCount: longRunningTasks.length },
      recommendations: [
        'Break large tasks into smaller, manageable pieces',
        'Set specific deadlines for stalled tasks',
        'Consider if these tasks are still relevant',
        'Move less important tasks to a "someday" list'
      ],
      createdAt: new Date(),
    };
  }

  private async recognizeAchievements(todos: any[]): Promise<ProductivityInsight | null> {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const completedToday = todos.filter(t => 
      t.status === 'COMPLETED' && 
      t.completedAt && 
      t.completedAt >= todayStart
    );

    if (completedToday.length >= 5) {
      return {
        type: 'achievement',
        title: 'Productivity Achievement',
        description: `Outstanding! You've completed ${completedToday.length} tasks today. You're on fire! 🔥`,
        actionable: false,
        confidence: 1.0,
        data: { completedToday: completedToday.length },
        recommendations: [
          'Take a moment to celebrate your productivity',
          'Consider setting a new personal record',
          'Share your success with others'
        ],
        createdAt: new Date(),
      };
    }

    return null;
  }

  private async identifyDelayFactors(todos: any[]): Promise<string[]> {
    const factors: string[] = [];
    
    const overdue = todos.filter(t => 
      t.status !== 'COMPLETED' && t.dueDate && t.dueDate < new Date()
    );
    
    if (overdue.length > 0) factors.push('Overdue tasks accumulating');
    
    const highPriorityPending = todos.filter(t => 
      t.status !== 'COMPLETED' && (t.priority === 'HIGH' || t.priority === 'URGENT')
    );
    
    if (highPriorityPending.length > 5) factors.push('Too many high-priority tasks');
    
    return factors;
  }

  private async identifyStrengths(todos: any[]): Promise<string[]> {
    const strengths: string[] = [];
    
    const completionRate = todos.filter(t => t.status === 'COMPLETED').length / todos.length;
    if (completionRate > 0.8) strengths.push('High task completion rate');
    
    const consistentPriorities = todos.filter(t => t.priority).length / todos.length;
    if (consistentPriorities > 0.8) strengths.push('Good at setting priorities');
    
    return strengths;
  }

  private async identifyImprovementAreas(todos: any[]): Promise<string[]> {
    const areas: string[] = [];
    
    const withoutDescriptions = todos.filter(t => !t.description).length / todos.length;
    if (withoutDescriptions > 0.5) areas.push('Add more detailed task descriptions');
    
    const withoutDueDates = todos.filter(t => !t.dueDate).length / todos.length;
    if (withoutDueDates > 0.7) areas.push('Set due dates for better planning');
    
    return areas;
  }

  private getFallbackRecommendations(): SmartRecommendation[] {
    return [
      {
        id: 'break-reminder',
        type: 'break_suggestion',
        title: 'Take a 5-minute break',
        reason: 'Regular breaks improve focus and productivity',
        impact: 'medium',
        timeToImplement: 5,
        category: 'wellness',
      },
      {
        id: 'priority-review',
        type: 'priority_adjustment',
        title: 'Review task priorities',
        reason: 'Ensuring important tasks are properly prioritized',
        impact: 'high',
        timeToImplement: 10,
        category: 'organization',
      },
    ];
  }

  private getBurnoutRecommendations(riskLevel: 'low' | 'medium' | 'high'): string[] {
    const base = ['Take regular breaks', 'Maintain work-life balance'];
    
    if (riskLevel === 'medium') {
      return [...base, 'Consider delegating some tasks', 'Review and adjust deadlines'];
    }
    
    if (riskLevel === 'high') {
      return [...base, 'Take immediate steps to reduce workload', 'Consider taking time off', 'Seek support from colleagues or supervisors'];
    }
    
    return base;
  }

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.prisma || !this.embeddingService || !this.mlService) {
      throw new Error('AIInsightService not configured - call configure() first');
    }
  }
}

export const aiInsightService = async (prisma: PrismaClient) => {
  const service = await AIInsightService.getInstance();
  await service.configure(prisma);
  return service;
};