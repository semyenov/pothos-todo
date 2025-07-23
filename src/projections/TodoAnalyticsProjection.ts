import { EventProjectionManager, createProjection, ProjectionUtils } from '@/infrastructure/projections/EventProjectionManager';
import { StreamTopics } from '@/infrastructure/streaming/KafkaEventStream';
import { logger } from '@/logger';

// Read model interfaces
export interface TodoAnalytics {
  totalTodos: number;
  completedTodos: number;
  pendingTodos: number;
  inProgressTodos: number;
  cancelledTodos: number;
  completionRate: number;
  averageCompletionTime: number; // in hours
  lastUpdated: Date;
}

export interface UserTodoStats {
  userId: string;
  totalTodos: number;
  completedTodos: number;
  pendingTodos: number;
  streak: number; // consecutive days with completed todos
  lastActive: Date;
  productivity: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}

export interface TodoPriorityStats {
  priority: string;
  total: number;
  completed: number;
  averageCompletionTime: number;
}

export interface DailyTodoMetrics {
  date: string; // YYYY-MM-DD
  created: number;
  completed: number;
  cancelled: number;
  activeUsers: Set<string>;
}

// Create the projection
const todoAnalyticsProjection = createProjection(
  'todo-analytics',
  1,
  [StreamTopics.TODO_EVENTS, StreamTopics.USER_EVENTS],
  {
    batchSize: 50,
    checkpointInterval: 100,
    enableSnapshots: true,
    snapshotInterval: 1000,
  }
);

// Handle TodoCreated events
todoAnalyticsProjection.on('TodoCreated', async (event, context) => {
  const { payload } = event;
  const todo = payload.data;
  
  logger.debug('Processing TodoCreated for analytics', {
    todoId: todo.id,
    userId: todo.userId,
    priority: todo.priority,
  });

  // Update global analytics
  await updateGlobalAnalytics(context.readModel, 'created');
  
  // Update user stats
  await updateUserStats(context.readModel, todo.userId, 'created');
  
  // Update priority stats
  await updatePriorityStats(context.readModel, todo.priority, 'created');
  
  // Update daily metrics
  await updateDailyMetrics(context.readModel, new Date(), 'created', todo.userId);
});

// Handle TodoCompleted events
todoAnalyticsProjection.on('TodoCompleted', async (event, context) => {
  const { payload } = event;
  const todo = payload.data;
  
  logger.debug('Processing TodoCompleted for analytics', {
    todoId: todo.id,
    userId: todo.userId,
    completionTime: todo.completionTime,
  });

  // Update global analytics
  await updateGlobalAnalytics(context.readModel, 'completed');
  
  // Update user stats
  await updateUserStats(context.readModel, todo.userId, 'completed');
  
  // Update priority stats with completion time
  await updatePriorityStats(
    context.readModel, 
    todo.priority, 
    'completed', 
    todo.completionTime
  );
  
  // Update daily metrics
  await updateDailyMetrics(context.readModel, new Date(), 'completed', todo.userId);
  
  // Update user streak
  await updateUserStreak(context.readModel, todo.userId);
});

// Handle TodoUpdated events
todoAnalyticsProjection.on('TodoUpdated', async (event, context) => {
  const { payload } = event;
  const { updates } = payload;
  
  // If status changed, update analytics
  if (updates.status) {
    const oldStatus = updates.previousStatus || 'PENDING';
    const newStatus = updates.status;
    
    // Decrement old status count
    await updateStatusCount(context.readModel, oldStatus, -1);
    
    // Increment new status count
    await updateStatusCount(context.readModel, newStatus, 1);
  }
});

// Handle TodoDeleted events
todoAnalyticsProjection.on('TodoDeleted', async (event, context) => {
  const { payload } = event;
  const todo = payload.data;
  
  // Update global analytics
  await updateGlobalAnalytics(context.readModel, 'deleted');
  
  // Update user stats
  await updateUserStats(context.readModel, todo.userId, 'deleted');
  
  // Update priority stats
  await updatePriorityStats(context.readModel, todo.priority, 'deleted');
});

// Handle UserActivity events for productivity tracking
todoAnalyticsProjection.on('UserActivity', async (event, context) => {
  const { payload } = event;
  const { userId, activityType } = payload;
  
  if (activityType === 'todo_interaction') {
    await updateUserProductivity(context.readModel, userId);
  }
});

// Helper functions
async function updateGlobalAnalytics(readModel: any, operation: string): Promise<void> {
  const analytics = await readModel.get<TodoAnalytics>('global:analytics') || {
    totalTodos: 0,
    completedTodos: 0,
    pendingTodos: 0,
    inProgressTodos: 0,
    cancelledTodos: 0,
    completionRate: 0,
    averageCompletionTime: 0,
    lastUpdated: new Date(),
  };

  switch (operation) {
    case 'created':
      analytics.totalTodos++;
      analytics.pendingTodos++;
      break;
    case 'completed':
      analytics.completedTodos++;
      analytics.pendingTodos--;
      break;
    case 'deleted':
      analytics.totalTodos--;
      break;
  }

  // Recalculate completion rate
  analytics.completionRate = analytics.totalTodos > 0 
    ? (analytics.completedTodos / analytics.totalTodos) * 100 
    : 0;
  
  analytics.lastUpdated = new Date();
  
  await readModel.set('global:analytics', analytics);
}

async function updateStatusCount(readModel: any, status: string, delta: number): Promise<void> {
  const statusKey = `status:${status.toLowerCase()}`;
  await readModel.increment(statusKey, delta);
}

async function updateUserStats(readModel: any, userId: string, operation: string): Promise<void> {
  const userKey = `user:${userId}:stats`;
  const userStats = await readModel.get<UserTodoStats>(userKey) || {
    userId,
    totalTodos: 0,
    completedTodos: 0,
    pendingTodos: 0,
    streak: 0,
    lastActive: new Date(),
    productivity: { daily: 0, weekly: 0, monthly: 0 },
  };

  switch (operation) {
    case 'created':
      userStats.totalTodos++;
      userStats.pendingTodos++;
      break;
    case 'completed':
      userStats.completedTodos++;
      userStats.pendingTodos--;
      break;
    case 'deleted':
      userStats.totalTodos--;
      break;
  }

  userStats.lastActive = new Date();
  await readModel.set(userKey, userStats);
  
  // Update user index for quick lookups
  await ProjectionUtils.updateIndex(
    readModel,
    'users-by-activity',
    userStats.lastActive.toISOString().split('T')[0],
    userId,
    { lastActive: userStats.lastActive }
  );
}

async function updatePriorityStats(
  readModel: any, 
  priority: string, 
  operation: string, 
  completionTime?: number
): Promise<void> {
  const priorityKey = `priority:${priority}:stats`;
  const priorityStats = await readModel.get<TodoPriorityStats>(priorityKey) || {
    priority,
    total: 0,
    completed: 0,
    averageCompletionTime: 0,
  };

  switch (operation) {
    case 'created':
      priorityStats.total++;
      break;
    case 'completed':
      priorityStats.completed++;
      if (completionTime) {
        // Update average completion time
        const currentAvg = priorityStats.averageCompletionTime;
        const count = priorityStats.completed;
        priorityStats.averageCompletionTime = 
          ((currentAvg * (count - 1)) + completionTime) / count;
      }
      break;
    case 'deleted':
      priorityStats.total--;
      break;
  }

  await readModel.set(priorityKey, priorityStats);
}

async function updateDailyMetrics(
  readModel: any, 
  date: Date, 
  operation: string, 
  userId: string
): Promise<void> {
  const dateKey = date.toISOString().split('T')[0];
  const metricsKey = `daily:${dateKey}`;
  
  const metrics = await readModel.get<DailyTodoMetrics>(metricsKey) || {
    date: dateKey,
    created: 0,
    completed: 0,
    cancelled: 0,
    activeUsers: new Set<string>(),
  };

  switch (operation) {
    case 'created':
      metrics.created++;
      break;
    case 'completed':
      metrics.completed++;
      break;
    case 'cancelled':
      metrics.cancelled++;
      break;
  }

  metrics.activeUsers.add(userId);
  
  // Convert Set to Array for JSON serialization
  const metricsForStorage = {
    ...metrics,
    activeUsers: Array.from(metrics.activeUsers),
  };
  
  await readModel.set(metricsKey, metricsForStorage);
}

async function updateUserStreak(readModel: any, userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const streakKey = `user:${userId}:streak`;
  
  // Check if user completed todos today
  const userTodayKey = `user:${userId}:completed:${today}`;
  const completedToday = await readModel.increment(userTodayKey, 1);
  
  if (completedToday === 1) {
    // First completion today, update streak
    const currentStreak = await readModel.get<number>(streakKey) || 0;
    await readModel.set(streakKey, currentStreak + 1);
    
    // Set expiry for today's completion count
    await readModel.expire(userTodayKey, 24 * 60 * 60); // 24 hours
  }
}

async function updateUserProductivity(readModel: any, userId: string): Promise<void> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const thisWeek = getWeekKey(now);
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Increment productivity counters
  await readModel.increment(`user:${userId}:productivity:daily:${today}`, 1);
  await readModel.increment(`user:${userId}:productivity:weekly:${thisWeek}`, 1);
  await readModel.increment(`user:${userId}:productivity:monthly:${thisMonth}`, 1);
  
  // Set expiries
  await readModel.expire(`user:${userId}:productivity:daily:${today}`, 24 * 60 * 60);
  await readModel.expire(`user:${userId}:productivity:weekly:${thisWeek}`, 7 * 24 * 60 * 60);
  await readModel.expire(`user:${userId}:productivity:monthly:${thisMonth}`, 30 * 24 * 60 * 60);
}

function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const weekNumber = getWeekNumber(date);
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

// Export projection for registration
export { todoAnalyticsProjection };

// Register the projection
export async function registerTodoAnalyticsProjection(): Promise<void> {
  const projectionManager = await EventProjectionManager.getInstance();
  await projectionManager.registerProjection(todoAnalyticsProjection);
  
  logger.info('Todo Analytics Projection registered');
}

// Query helpers for GraphQL resolvers
export class TodoAnalyticsQueries {
  static async getGlobalAnalytics(): Promise<TodoAnalytics | null> {
    const projectionManager = await EventProjectionManager.getInstance();
    return projectionManager.queryReadModel<TodoAnalytics>(
      'todo-analytics',
      { key: 'global:analytics' }
    );
  }

  static async getUserStats(userId: string): Promise<UserTodoStats | null> {
    const projectionManager = await EventProjectionManager.getInstance();
    return projectionManager.queryReadModel<UserTodoStats>(
      'todo-analytics',
      { key: `user:${userId}:stats` }
    );
  }

  static async getPriorityStats(priority: string): Promise<TodoPriorityStats | null> {
    const projectionManager = await EventProjectionManager.getInstance();
    return projectionManager.queryReadModel<TodoPriorityStats>(
      'todo-analytics',
      { key: `priority:${priority}:stats` }
    );
  }

  static async getDailyMetrics(date: string): Promise<DailyTodoMetrics | null> {
    const projectionManager = await EventProjectionManager.getInstance();
    return projectionManager.queryReadModel<DailyTodoMetrics>(
      'todo-analytics',
      { key: `daily:${date}` }
    );
  }

  static async getUserStreak(userId: string): Promise<number> {
    const projectionManager = await EventProjectionManager.getInstance();
    const streak = await projectionManager.queryReadModel<number>(
      'todo-analytics',
      { key: `user:${userId}:streak` }
    );
    return streak || 0;
  }

  static async getTopUsers(limit: number = 10): Promise<UserTodoStats[]> {
    const projectionManager = await EventProjectionManager.getInstance();
    
    // Get all user keys
    const userKeys = await projectionManager.queryReadModel<string[]>(
      'todo-analytics',
      { pattern: 'user:*:stats', operation: 'scan' }
    ) as string[];

    // Get user stats
    const userStats = await projectionManager.queryReadModel<UserTodoStats[]>(
      'todo-analytics',
      { keys: userKeys, operation: 'mget' }
    ) as UserTodoStats[];

    // Sort by completion rate and return top users
    return userStats
      .filter(stats => stats !== null)
      .sort((a, b) => {
        const aRate = a.totalTodos > 0 ? a.completedTodos / a.totalTodos : 0;
        const bRate = b.totalTodos > 0 ? b.completedTodos / b.totalTodos : 0;
        return bRate - aRate;
      })
      .slice(0, limit);
  }
}