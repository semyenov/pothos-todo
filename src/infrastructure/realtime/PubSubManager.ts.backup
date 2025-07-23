import { createPubSub } from '@graphql-yoga/subscription';
import { logger } from '@/logger';
import type { Todo, TodoList, User } from '@prisma/client';

// Define subscription event types
export interface SubscriptionEvents {
  // Todo events
  todoCreated: { todo: Todo; userId: string };
  todoUpdated: { todo: Todo; userId: string; changes: Partial<Todo> };
  todoDeleted: { todoId: string; userId: string };
  todoCompleted: { todo: Todo; userId: string };

  // TodoList events
  todoListCreated: { todoList: TodoList; userId: string };
  todoListUpdated: { todoList: TodoList; userId: string };
  todoListDeleted: { todoListId: string; userId: string };

  // Collaboration events
  userJoinedList: { userId: string; listId: string; user: User };
  userLeftList: { userId: string; listId: string };
  userTyping: { userId: string; listId: string; todoId?: string };

  // AI events
  aiSuggestionGenerated: { userId: string; suggestions: string[] };
  aiInsightAvailable: { userId: string; insightType: string; data: any };
  taskComplexityAnalyzed: { todoId: string; complexity: string; userId: string };

  // Presence events
  userOnline: { userId: string; user: User };
  userOffline: { userId: string };
  userActivity: { userId: string; activity: string; metadata?: any };

  // Index signature for PubSub compatibility
  [key: string]: any;
}

export class PubSubManager {
  private static instance: PubSubManager | null = null;
  private pubsub = createPubSub();
  private userConnections = new Map<string, Set<string>>(); // userId -> connectionIds
  private listSubscribers = new Map<string, Set<string>>(); // listId -> userIds

  private constructor() { }

  static getInstance(): PubSubManager {
    if (!PubSubManager.instance) {
      PubSubManager.instance = new PubSubManager();
    }
    return PubSubManager.instance;
  }

  // Todo events
  async publishTodoCreated(todo: Todo, userId: string): Promise<void> {
    logger.info('Publishing todo created event', { todoId: todo.id, userId });
    this.pubsub.publish('todoCreated', { todo, userId });
  }

  async publishTodoUpdated(todo: Todo, userId: string, changes: Partial<Todo>): Promise<void> {
    logger.info('Publishing todo updated event', { todoId: todo.id, userId });
    this.pubsub.publish('todoUpdated', { todo, userId, changes });
  }

  async publishTodoDeleted(todoId: string, userId: string): Promise<void> {
    logger.info('Publishing todo deleted event', { todoId, userId });
    this.pubsub.publish('todoDeleted', { todoId, userId });
  }

  async publishTodoCompleted(todo: Todo, userId: string): Promise<void> {
    logger.info('Publishing todo completed event', { todoId: todo.id, userId });
    this.pubsub.publish('todoCompleted', { todo, userId });
  }

  // TodoList events
  async publishTodoListCreated(todoList: TodoList, userId: string): Promise<void> {
    logger.info('Publishing todo list created event', { listId: todoList.id, userId });
    this.pubsub.publish('todoListCreated', { todoList, userId });
  }

  async publishTodoListUpdated(todoList: TodoList, userId: string): Promise<void> {
    logger.info('Publishing todo list updated event', { listId: todoList.id, userId });
    this.pubsub.publish('todoListUpdated', { todoList, userId });
  }

  async publishTodoListDeleted(todoListId: string, userId: string): Promise<void> {
    logger.info('Publishing todo list deleted event', { todoListId, userId });
    this.pubsub.publish('todoListDeleted', { todoListId, userId });
  }

  // Collaboration events
  async publishUserJoinedList(userId: string, listId: string, user: User): Promise<void> {
    this.addUserToList(listId, userId);
    logger.info('Publishing user joined list event', { userId, listId });
    this.pubsub.publish('userJoinedList', { userId, listId, user });
  }

  async publishUserLeftList(userId: string, listId: string): Promise<void> {
    this.removeUserFromList(listId, userId);
    logger.info('Publishing user left list event', { userId, listId });
    this.pubsub.publish('userLeftList', { userId, listId });
  }

  async publishUserTyping(userId: string, listId: string, todoId?: string): Promise<void> {
    this.pubsub.publish('userTyping', { userId, listId, todoId });
  }

  // AI events
  async publishAISuggestion(userId: string, suggestions: string[]): Promise<void> {
    logger.info('Publishing AI suggestion event', { userId, count: suggestions.length });
    this.pubsub.publish('aiSuggestionGenerated', { userId, suggestions });
  }

  async publishAIInsight(userId: string, insightType: string, data: any): Promise<void> {
    logger.info('Publishing AI insight event', { userId, insightType });
    this.pubsub.publish('aiInsightAvailable', { userId, insightType, data });
  }

  async publishTaskComplexityAnalyzed(todoId: string, complexity: string, userId: string): Promise<void> {
    logger.info('Publishing task complexity analyzed event', { todoId, complexity, userId });
    this.pubsub.publish('taskComplexityAnalyzed', { todoId, complexity, userId });
  }

  // Presence events
  async publishUserOnline(userId: string, user: User): Promise<void> {
    logger.info('Publishing user online event', { userId });
    this.pubsub.publish('userOnline', { userId, user });
  }

  async publishUserOffline(userId: string): Promise<void> {
    logger.info('Publishing user offline event', { userId });
    this.pubsub.publish('userOffline', { userId });
  }

  async publishUserActivity(userId: string, activity: string, metadata?: any): Promise<void> {
    this.pubsub.publish('userActivity', { userId, activity, metadata });
  }

  // Connection management
  addUserConnection(userId: string, connectionId: string): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);
  }

  removeUserConnection(userId: string, connectionId: string): void {
    const connections = this.userConnections.get(userId);
    if (connections) {
      connections.delete(connectionId);
      if (connections.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  // List subscription management
  private addUserToList(listId: string, userId: string): void {
    if (!this.listSubscribers.has(listId)) {
      this.listSubscribers.set(listId, new Set());
    }
    this.listSubscribers.get(listId)!.add(userId);
  }

  private removeUserFromList(listId: string, userId: string): void {
    const subscribers = this.listSubscribers.get(listId);
    if (subscribers) {
      subscribers.delete(userId);
      if (subscribers.size === 0) {
        this.listSubscribers.delete(listId);
      }
    }
  }

  getListSubscribers(listId: string): string[] {
    return Array.from(this.listSubscribers.get(listId) || []);
  }

  // Get the internal pubsub instance for subscriptions
  getPubSub() {
    return this.pubsub;
  }
}