import { AsyncSingletonService } from '@/infrastructure/core/SingletonService';
import { KafkaEventStream, StreamEvent, createEventConsumer } from '@/infrastructure/streaming/KafkaEventStream';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager';
import { logger } from '@/logger';
import { ErrorHandler } from '@/infrastructure/core/ErrorHandler';
import { nanoid } from 'nanoid';

export interface NotificationTemplate {
  id: string;
  name: string;
  type: NotificationType;
  channels: NotificationChannel[];
  template: {
    title: string;
    body: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
  };
  triggers: NotificationTrigger[];
  conditions?: NotificationCondition[];
  rateLimiting?: {
    maxPerHour?: number;
    maxPerDay?: number;
    cooldownMinutes?: number;
  };
  personalization?: {
    timezone?: boolean;
    language?: boolean;
    preferences?: boolean;
  };
}

export interface NotificationTrigger {
  eventType: string;
  conditions?: Record<string, any>;
  delay?: number; // in seconds
  recurring?: {
    interval: number; // in seconds
    maxCount?: number;
  };
}

export interface NotificationCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains';
  value: any;
}

export interface NotificationChannel {
  type: 'email' | 'sms' | 'push' | 'webhook' | 'websocket' | 'slack' | 'discord';
  config: Record<string, any>;
  priority: number; // 1-10, higher is more important
  enabled: boolean;
}

export enum NotificationType {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
  REMINDER = 'reminder',
  MARKETING = 'marketing',
}

export interface Notification {
  id: string;
  userId: string;
  templateId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string;
  metadata: Record<string, any>;
  channels: NotificationChannel[];
  status: NotificationStatus;
  createdAt: Date;
  scheduledFor?: Date;
  sentAt?: Date;
  readAt?: Date;
  clickedAt?: Date;
  attempts: number;
  maxAttempts: number;
  errors: string[];
}

export enum NotificationStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  CLICKED = 'clicked',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface NotificationPreferences {
  userId: string;
  channels: {
    email: boolean;
    sms: boolean;
    push: boolean;
    websocket: boolean;
  };
  types: {
    [key in NotificationType]: boolean;
  };
  schedule: {
    quietHours: {
      start: string; // HH:MM
      end: string; // HH:MM
    };
    timezone: string;
    weekends: boolean;
  };
  frequency: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

export interface NotificationDeliveryProvider {
  type: string;
  send(notification: Notification, config: Record<string, any>): Promise<void>;
  validate(config: Record<string, any>): boolean;
}

class EmailDeliveryProvider implements NotificationDeliveryProvider {
  type = 'email';

  async send(notification: Notification, config: Record<string, any>): Promise<void> {
    // Implement email sending logic (e.g., using SendGrid, SES, etc.)
    logger.info('Sending email notification', {
      notificationId: notification.id,
      userId: notification.userId,
      to: config.to,
    });
    
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  validate(config: Record<string, any>): boolean {
    return !!(config.to && config.from && config.subject);
  }
}

class WebSocketDeliveryProvider implements NotificationDeliveryProvider {
  type = 'websocket';

  async send(notification: Notification, config: Record<string, any>): Promise<void> {
    // Implement WebSocket notification sending
    logger.info('Sending WebSocket notification', {
      notificationId: notification.id,
      userId: notification.userId,
    });
    
    // Here you would emit to the user's WebSocket connection
    // This could integrate with your WebSocket server
  }

  validate(config: Record<string, any>): boolean {
    return true; // WebSocket doesn't need additional config
  }
}

class PushDeliveryProvider implements NotificationDeliveryProvider {
  type = 'push';

  async send(notification: Notification, config: Record<string, any>): Promise<void> {
    logger.info('Sending push notification', {
      notificationId: notification.id,
      userId: notification.userId,
      deviceToken: config.deviceToken,
    });
    
    // Implement push notification logic (FCM, APNs, etc.)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  validate(config: Record<string, any>): boolean {
    return !!(config.deviceToken);
  }
}

export class AdvancedNotificationSystem extends AsyncSingletonService<AdvancedNotificationSystem> {
  private templates: Map<string, NotificationTemplate> = new Map();
  private providers: Map<string, NotificationDeliveryProvider> = new Map();
  private preferences: Map<string, NotificationPreferences> = new Map();
  private eventStream: KafkaEventStream | null = null;
  private redis: RedisClusterManager | null = null;
  private errorHandler = ErrorHandler.getInstance();
  private schedulerRunning = false;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<AdvancedNotificationSystem> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing Advanced Notification System...');
      
      this.eventStream = await KafkaEventStream.getInstance();
      this.redis = await RedisClusterManager.getInstance();
      
      // Register default delivery providers
      this.registerProvider(new EmailDeliveryProvider());
      this.registerProvider(new WebSocketDeliveryProvider());
      this.registerProvider(new PushDeliveryProvider());
      
      // Load notification templates and preferences
      await this.loadTemplates();
      await this.loadPreferences();
      
      // Start event consumer
      await this.startEventConsumer();
      
      // Start notification scheduler
      await this.startScheduler();
      
      logger.info('Advanced Notification System initialized');
    } catch (error) {
      logger.error('Failed to initialize Advanced Notification System', error);
      throw error;
    }
  }

  async registerTemplate(template: NotificationTemplate): Promise<void> {
    logger.info('Registering notification template', {
      id: template.id,
      name: template.name,
      type: template.type,
    });

    // Validate template
    if (!template.id || !template.name || !template.template.title || !template.template.body) {
      throw new Error('Invalid notification template');
    }

    this.templates.set(template.id, template);
    
    // Persist template
    await this.redis!.set(`notification:template:${template.id}`, JSON.stringify(template));
    
    logger.info('Notification template registered', { id: template.id });
  }

  async registerProvider(provider: NotificationDeliveryProvider): Promise<void> {
    this.providers.set(provider.type, provider);
    logger.info('Notification provider registered', { type: provider.type });
  }

  async setUserPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
    this.preferences.set(userId, preferences);
    
    // Persist preferences
    await this.redis!.set(
      `notification:preferences:${userId}`,
      JSON.stringify(preferences)
    );
    
    logger.info('User notification preferences updated', { userId });
  }

  async getUserPreferences(userId: string): Promise<NotificationPreferences | null> {
    let preferences = this.preferences.get(userId);
    
    if (!preferences) {
      const cached = await this.redis!.get(`notification:preferences:${userId}`);
      if (cached) {
        preferences = JSON.parse(cached);
        this.preferences.set(userId, preferences!);
      }
    }
    
    return preferences || null;
  }

  async createNotification(
    userId: string,
    templateId: string,
    context: Record<string, any> = {},
    options: {
      scheduledFor?: Date;
      priority?: number;
      overrideChannels?: NotificationChannel[];
    } = {}
  ): Promise<string> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Notification template ${templateId} not found`);
    }

    // Check user preferences
    const userPrefs = await this.getUserPreferences(userId);
    if (userPrefs && !userPrefs.types[template.type]) {
      logger.debug('Notification blocked by user preferences', {
        userId,
        templateId,
        type: template.type,
      });
      return '';
    }

    // Apply rate limiting
    if (await this.isRateLimited(userId, template)) {
      logger.debug('Notification rate limited', { userId, templateId });
      return '';
    }

    // Create notification
    const notification: Notification = {
      id: nanoid(),
      userId,
      templateId,
      type: template.type,
      title: this.interpolateTemplate(template.template.title, context),
      body: this.interpolateTemplate(template.template.body, context),
      actionUrl: template.template.actionUrl ? 
        this.interpolateTemplate(template.template.actionUrl, context) : undefined,
      metadata: { ...template.template.metadata, ...context },
      channels: options.overrideChannels || this.getEnabledChannels(template, userPrefs),
      status: options.scheduledFor ? NotificationStatus.SCHEDULED : NotificationStatus.PENDING,
      createdAt: new Date(),
      scheduledFor: options.scheduledFor,
      attempts: 0,
      maxAttempts: 3,
      errors: [],
    };

    // Store notification
    await this.redis!.set(
      `notification:${notification.id}`,
      JSON.stringify(notification),
      24 * 60 * 60 // 24 hours TTL
    );

    // Add to user's notification list
    await this.redis!.zadd(
      `notifications:user:${userId}`,
      Date.now(),
      notification.id
    );

    // Schedule or send immediately
    if (options.scheduledFor) {
      await this.scheduleNotification(notification);
    } else {
      await this.sendNotification(notification);
    }

    logger.info('Notification created', {
      id: notification.id,
      userId,
      templateId,
      scheduled: !!options.scheduledFor,
    });

    return notification.id;
  }

  async sendNotification(notification: Notification): Promise<void> {
    if (notification.status === NotificationStatus.SENT) {
      return;
    }

    notification.status = NotificationStatus.SENDING;
    notification.attempts++;
    
    try {
      const deliveryPromises = notification.channels.map(async (channel) => {
        const provider = this.providers.get(channel.type);
        if (!provider) {
          throw new Error(`No provider for channel type: ${channel.type}`);
        }

        if (!provider.validate(channel.config)) {
          throw new Error(`Invalid config for channel type: ${channel.type}`);
        }

        await provider.send(notification, channel.config);
      });

      await Promise.all(deliveryPromises);
      
      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
      
      logger.info('Notification sent successfully', {
        id: notification.id,
        userId: notification.userId,
        channels: notification.channels.map(c => c.type),
      });
    } catch (error) {
      notification.status = NotificationStatus.FAILED;
      notification.errors.push(error.message);
      
      logger.error('Failed to send notification', {
        id: notification.id,
        userId: notification.userId,
        error: error.message,
        attempts: notification.attempts,
      });

      // Retry if within max attempts
      if (notification.attempts < notification.maxAttempts) {
        setTimeout(() => {
          this.sendNotification(notification);
        }, Math.pow(2, notification.attempts) * 1000); // Exponential backoff
      }
    }

    // Update stored notification
    await this.redis!.set(
      `notification:${notification.id}`,
      JSON.stringify(notification),
      24 * 60 * 60
    );
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const notification = await this.getNotification(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    notification.status = NotificationStatus.READ;
    notification.readAt = new Date();

    await this.redis!.set(
      `notification:${notificationId}`,
      JSON.stringify(notification),
      24 * 60 * 60
    );

    logger.debug('Notification marked as read', { notificationId, userId });
  }

  async markAsClicked(notificationId: string, userId: string): Promise<void> {
    const notification = await this.getNotification(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    notification.status = NotificationStatus.CLICKED;
    notification.clickedAt = new Date();

    await this.redis!.set(
      `notification:${notificationId}`,
      JSON.stringify(notification),
      24 * 60 * 60
    );

    logger.debug('Notification marked as clicked', { notificationId, userId });
  }

  async getUserNotifications(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: NotificationStatus;
      type?: NotificationType;
    } = {}
  ): Promise<Notification[]> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Get notification IDs from sorted set (newest first)
    const notificationIds = await this.redis!.zrevrange(
      `notifications:user:${userId}`,
      offset,
      offset + limit - 1
    );

    // Get notification data
    const notifications = await Promise.all(
      notificationIds.map(id => this.getNotification(id))
    );

    // Filter by status and type if specified
    let filtered = notifications.filter(n => n !== null) as Notification[];
    
    if (options.status) {
      filtered = filtered.filter(n => n.status === options.status);
    }
    
    if (options.type) {
      filtered = filtered.filter(n => n.type === options.type);
    }

    return filtered;
  }

  async getNotificationStats(userId?: string): Promise<{
    total: number;
    sent: number;
    delivered: number;
    read: number;
    clicked: number;
    failed: number;
    byType: Record<NotificationType, number>;
    byChannel: Record<string, number>;
  }> {
    const stats = {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      failed: 0,
      byType: {} as Record<NotificationType, number>,
      byChannel: {} as Record<string, number>,
    };

    // Implementation would query Redis for notification statistics
    // This is a simplified version - in practice, you'd use Redis aggregations
    
    return stats;
  }

  private async getNotification(notificationId: string): Promise<Notification | null> {
    const data = await this.redis!.get(`notification:${notificationId}`);
    return data ? JSON.parse(data) : null;
  }

  private async isRateLimited(userId: string, template: NotificationTemplate): Promise<boolean> {
    if (!template.rateLimiting) {
      return false;
    }

    const now = Date.now();
    const hourKey = `ratelimit:${userId}:${template.id}:hour:${Math.floor(now / (60 * 60 * 1000))}`;
    const dayKey = `ratelimit:${userId}:${template.id}:day:${Math.floor(now / (24 * 60 * 60 * 1000))}`;
    
    const [hourCount, dayCount] = await Promise.all([
      this.redis!.incr(hourKey),
      this.redis!.incr(dayKey),
    ]);

    // Set expiry on first increment
    if (hourCount === 1) {
      await this.redis!.expire(hourKey, 60 * 60); // 1 hour
    }
    if (dayCount === 1) {
      await this.redis!.expire(dayKey, 24 * 60 * 60); // 24 hours
    }

    return (
      (template.rateLimiting.maxPerHour && hourCount > template.rateLimiting.maxPerHour) ||
      (template.rateLimiting.maxPerDay && dayCount > template.rateLimiting.maxPerDay)
    );
  }

  private interpolateTemplate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return context[key] || match;
    });
  }

  private getEnabledChannels(
    template: NotificationTemplate,
    userPrefs?: NotificationPreferences | null
  ): NotificationChannel[] {
    let channels = template.channels.filter(c => c.enabled);

    if (userPrefs) {
      channels = channels.filter(channel => {
        switch (channel.type) {
          case 'email':
            return userPrefs.channels.email;
          case 'sms':
            return userPrefs.channels.sms;
          case 'push':
            return userPrefs.channels.push;
          case 'websocket':
            return userPrefs.channels.websocket;
          default:
            return true;
        }
      });
    }

    return channels.sort((a, b) => b.priority - a.priority);
  }

  private async scheduleNotification(notification: Notification): Promise<void> {
    const delay = notification.scheduledFor!.getTime() - Date.now();
    
    if (delay <= 0) {
      await this.sendNotification(notification);
      return;
    }

    // Store in scheduled notifications sorted set
    await this.redis!.zadd(
      'notifications:scheduled',
      notification.scheduledFor!.getTime(),
      notification.id
    );
  }

  private async startEventConsumer(): Promise<void> {
    await createEventConsumer(
      'notification-system',
      ['domain-events', 'user-events', 'todo-events'],
      async (event: StreamEvent) => {
        await this.processEventForNotifications(event);
      }
    );
  }

  private async processEventForNotifications(event: StreamEvent): Promise<void> {
    // Find templates that match this event
    for (const [templateId, template] of this.templates) {
      for (const trigger of template.triggers) {
        if (trigger.eventType === event.type) {
          // Check conditions
          if (this.evaluateConditions(event, template.conditions || [])) {
            const userId = event.metadata.userId || event.payload.userId;
            if (userId) {
              await this.createNotification(userId, templateId, {
                ...event.payload,
                ...event.metadata,
              });
            }
          }
        }
      }
    }
  }

  private evaluateConditions(event: StreamEvent, conditions: NotificationCondition[]): boolean {
    return conditions.every(condition => {
      const value = this.getNestedValue(event, condition.field);
      
      switch (condition.operator) {
        case 'eq':
          return value === condition.value;
        case 'ne':
          return value !== condition.value;
        case 'gt':
          return value > condition.value;
        case 'gte':
          return value >= condition.value;
        case 'lt':
          return value < condition.value;
        case 'lte':
          return value <= condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(value);
        case 'nin':
          return Array.isArray(condition.value) && !condition.value.includes(value);
        case 'contains':
          return typeof value === 'string' && value.includes(condition.value);
        default:
          return true;
      }
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private async startScheduler(): Promise<void> {
    if (this.schedulerRunning) {
      return;
    }

    this.schedulerRunning = true;
    
    const processScheduledNotifications = async () => {
      if (!this.schedulerRunning) {
        return;
      }

      try {
        const now = Date.now();
        
        // Get notifications scheduled for now or earlier
        const notificationIds = await this.redis!.zrangebyscore(
          'notifications:scheduled',
          0,
          now,
          'LIMIT',
          0,
          100
        );

        for (const notificationId of notificationIds) {
          const notification = await this.getNotification(notificationId);
          if (notification) {
            await this.sendNotification(notification);
            
            // Remove from scheduled set
            await this.redis!.zrem('notifications:scheduled', notificationId);
          }
        }
      } catch (error) {
        logger.error('Error processing scheduled notifications', error);
      }

      // Schedule next run
      setTimeout(processScheduledNotifications, 30000); // Every 30 seconds
    };

    processScheduledNotifications();
    logger.info('Notification scheduler started');
  }

  private async loadTemplates(): Promise<void> {
    try {
      const templateKeys = await this.redis!.scan('notification:template:*');
      
      for (const key of templateKeys) {
        const templateData = await this.redis!.get(key);
        if (templateData) {
          const template: NotificationTemplate = JSON.parse(templateData);
          this.templates.set(template.id, template);
        }
      }

      logger.debug('Notification templates loaded', { count: this.templates.size });
    } catch (error) {
      logger.error('Failed to load notification templates', error);
    }
  }

  private async loadPreferences(): Promise<void> {
    try {
      const prefKeys = await this.redis!.scan('notification:preferences:*');
      
      for (const key of prefKeys) {
        const prefData = await this.redis!.get(key);
        if (prefData) {
          const preferences: NotificationPreferences = JSON.parse(prefData);
          this.preferences.set(preferences.userId, preferences);
        }
      }

      logger.debug('Notification preferences loaded', { count: this.preferences.size });
    } catch (error) {
      logger.error('Failed to load notification preferences', error);
    }
  }
}