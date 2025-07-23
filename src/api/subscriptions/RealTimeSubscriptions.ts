import { builder } from '@/api/schema/builder';
import { PubSub } from 'graphql-subscriptions';
import { authenticated } from '@/api/middleware/authenticated';
import { KafkaEventStream, StreamEvent, createEventConsumer } from '@/infrastructure/streaming/KafkaEventStream';
import { EventProjectionManager } from '@/infrastructure/projections/EventProjectionManager';
import { AdvancedNotificationSystem } from '@/infrastructure/notifications/AdvancedNotificationSystem';
import { logger } from '@/logger';
import { nanoid } from 'nanoid';

// Enhanced PubSub with Redis support for horizontal scaling
class RedisPubSub extends PubSub {
  private redis: any; // RedisClusterManager instance
  
  constructor(redis: any) {
    super();
    this.redis = redis;
  }

  async publish(triggerName: string, payload: any): Promise<void> {
    // Publish locally
    super.publish(triggerName, payload);
    
    // Publish to Redis for other instances
    await this.redis.publish(`graphql:${triggerName}`, JSON.stringify(payload));
  }

  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T> {
    const triggerArray = Array.isArray(triggers) ? triggers : [triggers];
    
    // Subscribe to Redis for cross-instance events
    triggerArray.forEach(trigger => {
      this.redis.subscribe(`graphql:${trigger}`, (message: string) => {
        try {
          const payload = JSON.parse(message);
          super.publish(trigger, payload);
        } catch (error) {
          logger.error('Failed to parse Redis PubSub message', { trigger, error });
        }
      });
    });

    return super.asyncIterator(triggers);
  }
}

// Subscription payload types
const TodoUpdatedPayload = builder.objectRef<{
  id: string;
  title: string;
  status: string;
  priority: string;
  userId: string;
  updatedAt: Date;
  changes: string[];
}>('TodoUpdatedPayload');

builder.objectType(TodoUpdatedPayload, {
  name: 'TodoUpdatedPayload',
  fields: (t) => ({
    id: t.exposeString('id'),
    title: t.exposeString('title'),
    status: t.exposeString('status'),
    priority: t.exposeString('priority'),
    userId: t.exposeString('userId'),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    changes: t.exposeStringList('changes'),
  }),
});

const UserActivityPayload = builder.objectRef<{
  userId: string;
  activityType: string;
  details: Record<string, any>;
  timestamp: Date;
}>('UserActivityPayload');

builder.objectType(UserActivityPayload, {
  name: 'UserActivityPayload',
  fields: (t) => ({
    userId: t.exposeString('userId'),
    activityType: t.exposeString('activityType'),
    details: t.expose('details', { type: 'JSON' }),
    timestamp: t.expose('timestamp', { type: 'DateTime' }),
  }),
});

const NotificationPayload = builder.objectRef<{
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata: Record<string, any>;
  createdAt: Date;
}>('NotificationPayload');

builder.objectType(NotificationPayload, {
  name: 'NotificationPayload',
  fields: (t) => ({
    id: t.exposeString('id'),
    userId: t.exposeString('userId'),
    type: t.exposeString('type'),
    title: t.exposeString('title'),
    body: t.exposeString('body'),
    actionUrl: t.exposeString('actionUrl', { nullable: true }),
    metadata: t.expose('metadata', { type: 'JSON' }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

const AnalyticsUpdatePayload = builder.objectRef<{
  type: string;
  data: Record<string, any>;
  timestamp: Date;
}>('AnalyticsUpdatePayload');

builder.objectType(AnalyticsUpdatePayload, {
  name: 'AnalyticsUpdatePayload',
  fields: (t) => ({
    type: t.exposeString('type'),
    data: t.expose('data', { type: 'JSON' }),
    timestamp: t.expose('timestamp', { type: 'DateTime' }),
  }),
});

const CollaborationEventPayload = builder.objectRef<{
  type: string;
  userId: string;
  userName: string;
  resourceId: string;
  resourceType: string;
  action: string;
  details: Record<string, any>;
  timestamp: Date;
}>('CollaborationEventPayload');

builder.objectType(CollaborationEventPayload, {
  name: 'CollaborationEventPayload',
  fields: (t) => ({
    type: t.exposeString('type'),
    userId: t.exposeString('userId'),
    userName: t.exposeString('userName'),
    resourceId: t.exposeString('resourceId'),
    resourceType: t.exposeString('resourceType'),
    action: t.exposeString('action'),
    details: t.expose('details', { type: 'JSON' }),
    timestamp: t.expose('timestamp', { type: 'DateTime' }),
  }),
});

// Subscription filters
const SubscriptionFilters = {
  userOwnsResource: (userId: string) => (payload: any) => {
    return payload.userId === userId;
  },
  
  userInList: (userIds: string[]) => (payload: any) => {
    return userIds.includes(payload.userId);
  },
  
  resourceMatch: (resourceId: string, resourceType?: string) => (payload: any) => {
    return payload.resourceId === resourceId && 
           (!resourceType || payload.resourceType === resourceType);
  },

  eventTypeMatch: (eventTypes: string[]) => (payload: any) => {
    return eventTypes.includes(payload.type || payload.activityType);
  },
};

// Real-time subscription manager
export class RealTimeSubscriptionManager {
  private static instance: RealTimeSubscriptionManager;
  private pubsub: RedisPubSub;
  private eventStream: KafkaEventStream | null = null;
  private projectionManager: EventProjectionManager | null = null;
  private notificationSystem: AdvancedNotificationSystem | null = null;
  private activeSubscriptions: Map<string, Set<string>> = new Map();

  constructor(redis: any) {
    this.pubsub = new RedisPubSub(redis);
  }

  static getInstance(redis?: any): RealTimeSubscriptionManager {
    if (!RealTimeSubscriptionManager.instance) {
      if (!redis) {
        throw new Error('Redis instance required for first initialization');
      }
      RealTimeSubscriptionManager.instance = new RealTimeSubscriptionManager(redis);
    }
    return RealTimeSubscriptionManager.instance;
  }

  async initialize(): Promise<void> {
    try {
      this.eventStream = await KafkaEventStream.getInstance();
      this.projectionManager = await EventProjectionManager.getInstance();
      this.notificationSystem = await AdvancedNotificationSystem.getInstance();

      // Start event consumers for real-time subscriptions
      await this.startEventConsumers();
      
      logger.info('Real-time subscription manager initialized');
    } catch (error) {
      logger.error('Failed to initialize real-time subscription manager', error);
      throw error;
    }
  }

  async publishTodoUpdate(todo: any, changes: string[] = []): Promise<void> {
    await this.pubsub.publish('TODO_UPDATED', {
      id: todo.id,
      title: todo.title,
      status: todo.status,
      priority: todo.priority,
      userId: todo.userId,
      updatedAt: new Date(),
      changes,
    });
  }

  async publishUserActivity(
    userId: string,
    activityType: string,
    details: Record<string, any> = {}
  ): Promise<void> {
    await this.pubsub.publish('USER_ACTIVITY', {
      userId,
      activityType,
      details,
      timestamp: new Date(),
    });
  }

  async publishNotification(notification: any): Promise<void> {
    await this.pubsub.publish('NOTIFICATION_RECEIVED', {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      actionUrl: notification.actionUrl,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    });
  }

  async publishAnalyticsUpdate(type: string, data: Record<string, any>): Promise<void> {
    await this.pubsub.publish('ANALYTICS_UPDATED', {
      type,
      data,
      timestamp: new Date(),
    });
  }

  async publishCollaborationEvent(
    type: string,
    userId: string,
    userName: string,
    resourceId: string,
    resourceType: string,
    action: string,
    details: Record<string, any> = {}
  ): Promise<void> {
    await this.pubsub.publish('COLLABORATION_EVENT', {
      type,
      userId,
      userName,
      resourceId,
      resourceType,
      action,
      details,
      timestamp: new Date(),
    });
  }

  getAsyncIterator(trigger: string): AsyncIterator<any> {
    return this.pubsub.asyncIterator(trigger);
  }

  trackSubscription(userId: string, subscriptionType: string): void {
    if (!this.activeSubscriptions.has(subscriptionType)) {
      this.activeSubscriptions.set(subscriptionType, new Set());
    }
    this.activeSubscriptions.get(subscriptionType)!.add(userId);
  }

  untrackSubscription(userId: string, subscriptionType: string): void {
    const subscriptions = this.activeSubscriptions.get(subscriptionType);
    if (subscriptions) {
      subscriptions.delete(userId);
    }
  }

  getActiveSubscribers(subscriptionType: string): string[] {
    return Array.from(this.activeSubscriptions.get(subscriptionType) || []);
  }

  private async startEventConsumers(): Promise<void> {
    // Consumer for domain events -> real-time subscriptions
    await createEventConsumer(
      'realtime-subscriptions',
      ['domain-events', 'todo-events', 'user-events'],
      async (event: StreamEvent) => {
        await this.processEventForSubscriptions(event);
      }
    );

    // Consumer for projection updates -> analytics subscriptions
    await createEventConsumer(
      'realtime-analytics',
      ['projection-todo-analytics'],
      async (event: StreamEvent) => {
        await this.processAnalyticsUpdate(event);
      }
    );
  }

  private async processEventForSubscriptions(event: StreamEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'TodoCreated':
        case 'TodoUpdated':
        case 'TodoCompleted':
          await this.publishTodoUpdate(event.payload.data, event.payload.changes);
          break;

        case 'UserActivity':
          await this.publishUserActivity(
            event.payload.userId,
            event.payload.activityType,
            event.payload.details
          );
          break;

        case 'CollaborationStarted':
        case 'CollaborationEnded':
        case 'CollaborationUpdate':
          await this.publishCollaborationEvent(
            event.type,
            event.payload.userId,
            event.payload.userName,
            event.payload.resourceId,
            event.payload.resourceType,
            event.payload.action,
            event.payload.details
          );
          break;
      }
    } catch (error) {
      logger.error('Failed to process event for subscriptions', {
        eventType: event.type,
        eventId: event.id,
        error,
      });
    }
  }

  private async processAnalyticsUpdate(event: StreamEvent): Promise<void> {
    await this.publishAnalyticsUpdate(event.type, event.payload);
  }
}

// Initialize the subscription manager (this would be called during app startup)
export async function initializeSubscriptionManager(redis: any): Promise<void> {
  const manager = RealTimeSubscriptionManager.getInstance(redis);
  await manager.initialize();
}

// GraphQL Subscription definitions
builder.subscriptionType({
  fields: (t) => ({
    // Todo updates subscription
    todoUpdated: t.field({
      type: TodoUpdatedPayload,
      args: {
        userId: t.arg.string({ required: false }),
        todoId: t.arg.string({ required: false }),
      },
      resolve: (payload) => payload,
      subscribe: authenticated(
        (parent, args, context) => {
          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'todoUpdated');
          
          return manager.getAsyncIterator('TODO_UPDATED');
        }
      ),
    }),

    // User activity subscription
    userActivity: t.field({
      type: UserActivityPayload,
      args: {
        activityTypes: t.arg.stringList({ required: false }),
      },
      resolve: (payload, args) => {
        // Filter by activity types if specified
        if (args.activityTypes && !args.activityTypes.includes(payload.activityType)) {
          return null;
        }
        return payload;
      },
      subscribe: authenticated(
        (parent, args, context) => {
          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'userActivity');
          
          return manager.getAsyncIterator('USER_ACTIVITY');
        }
      ),
    }),

    // Notification subscription
    notificationReceived: t.field({
      type: NotificationPayload,
      resolve: (payload, args, context) => {
        // Only return notifications for the authenticated user
        if (payload.userId !== context.user?.id) {
          return null;
        }
        return payload;
      },
      subscribe: authenticated(
        (parent, args, context) => {
          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'notifications');
          
          return manager.getAsyncIterator('NOTIFICATION_RECEIVED');
        }
      ),
    }),

    // Analytics updates subscription (admin only)
    analyticsUpdated: t.field({
      type: AnalyticsUpdatePayload,
      args: {
        types: t.arg.stringList({ required: false }),
      },
      resolve: (payload, args) => {
        if (args.types && !args.types.includes(payload.type)) {
          return null;
        }
        return payload;
      },
      subscribe: authenticated(
        (parent, args, context) => {
          // Check if user has analytics permissions
          if (!context.user.permissions?.includes('analytics')) {
            throw new Error('Insufficient permissions for analytics subscription');
          }

          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'analytics');
          
          return manager.getAsyncIterator('ANALYTICS_UPDATED');
        }
      ),
    }),

    // Collaboration events subscription
    collaborationEvent: t.field({
      type: CollaborationEventPayload,
      args: {
        resourceId: t.arg.string({ required: false }),
        resourceType: t.arg.string({ required: false }),
      },
      resolve: (payload, args, context) => {
        // Filter by resource if specified
        if (args.resourceId && payload.resourceId !== args.resourceId) {
          return null;
        }
        if (args.resourceType && payload.resourceType !== args.resourceType) {
          return null;
        }
        
        // User must be involved in the collaboration or be an admin
        if (payload.userId !== context.user?.id && !context.user?.permissions?.includes('admin')) {
          return null;
        }
        
        return payload;
      },
      subscribe: authenticated(
        (parent, args, context) => {
          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'collaboration');
          
          return manager.getAsyncIterator('COLLABORATION_EVENT');
        }
      ),
    }),

    // Live presence subscription
    presence: t.field({
      type: builder.objectRef<{
        userId: string;
        status: string;
        lastSeen: Date;
        currentPage?: string;
      }>('PresencePayload'),
      resolve: (payload) => payload,
      subscribe: authenticated(
        (parent, args, context) => {
          const manager = RealTimeSubscriptionManager.getInstance();
          manager.trackSubscription(context.user.id, 'presence');
          
          return manager.getAsyncIterator('PRESENCE_UPDATE');
        }
      ),
    }),
  }),
});

// Create presence payload type
builder.objectType(builder.objectRef<{
  userId: string;
  status: string;
  lastSeen: Date;
  currentPage?: string;
}>('PresencePayload'), {
  name: 'PresencePayload',
  fields: (t) => ({
    userId: t.exposeString('userId'),
    status: t.exposeString('status'),
    lastSeen: t.expose('lastSeen', { type: 'DateTime' }),
    currentPage: t.exposeString('currentPage', { nullable: true }),
  }),
});

// Subscription utilities for use in mutations
export const SubscriptionPublisher = {
  async publishTodoUpdate(todo: any, changes: string[] = []): Promise<void> {
    const manager = RealTimeSubscriptionManager.getInstance();
    await manager.publishTodoUpdate(todo, changes);
  },

  async publishUserActivity(userId: string, activityType: string, details: Record<string, any> = {}): Promise<void> {
    const manager = RealTimeSubscriptionManager.getInstance();
    await manager.publishUserActivity(userId, activityType, details);
  },

  async publishNotification(notification: any): Promise<void> {
    const manager = RealTimeSubscriptionManager.getInstance();
    await manager.publishNotification(notification);
  },

  async publishPresenceUpdate(userId: string, status: string, currentPage?: string): Promise<void> {
    const manager = RealTimeSubscriptionManager.getInstance();
    await manager.pubsub.publish('PRESENCE_UPDATE', {
      userId,
      status,
      lastSeen: new Date(),
      currentPage,
    });
  },
};