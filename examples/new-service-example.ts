/**
 * Example: Creating a New Service with BaseService Architecture
 * 
 * This example demonstrates how to create a new infrastructure service
 * using the enterprise-grade BaseService architecture with all features:
 * - Configuration management
 * - Type-safe events
 * - Health checks
 * - Metrics
 * - Resilience patterns
 */

import { z } from 'zod';
import { BaseAsyncService } from '@/infrastructure/core/BaseAsyncService.js';
import { ServiceEventMap } from '@/infrastructure/core/TypedEventEmitter.js';
import { 
  ServiceConfig, 
  Retry, 
  CircuitBreaker, 
  HealthCheck, 
  Metric 
} from '@/infrastructure/core/decorators/ServiceDecorators.js';
import { logger } from '@/lib/unjs-utils.js';

// Step 1: Define Configuration Schema
const EmailServiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  smtp: z.object({
    host: z.string().default('smtp.gmail.com'),
    port: z.number().default(587),
    secure: z.boolean().default(false),
    auth: z.object({
      user: z.string(),
      pass: z.string(),
    }).optional(),
  }),
  from: z.object({
    name: z.string().default('Todo App'),
    email: z.string().email(),
  }),
  templates: z.object({
    welcomeEmail: z.string().default('welcome'),
    passwordReset: z.string().default('password-reset'),
    todoReminder: z.string().default('todo-reminder'),
  }),
  queue: z.object({
    maxRetries: z.number().min(0).max(10).default(3),
    retryDelay: z.number().min(1000).default(5000),
    batchSize: z.number().min(1).max(100).default(10),
  }),
  rateLimit: z.object({
    perUser: z.number().default(10), // emails per hour
    global: z.number().default(1000), // emails per hour
  }),
});

type EmailServiceConfig = z.infer<typeof EmailServiceConfigSchema>;

// Step 2: Define Event Map
interface EmailServiceEventMap extends ServiceEventMap {
  // Email lifecycle events
  'email:queued': { 
    id: string; 
    to: string; 
    template: string; 
    priority: 'low' | 'normal' | 'high';
  };
  'email:sent': { 
    id: string; 
    to: string; 
    duration: number; 
    provider: string;
  };
  'email:failed': { 
    id: string; 
    to: string; 
    error: Error; 
    attempt: number;
  };
  'email:bounced': { 
    id: string; 
    to: string; 
    reason: string;
  };
  
  // Queue events
  'queue:processing': { 
    batchSize: number; 
    queueLength: number;
  };
  'queue:empty': { 
    processedTotal: number;
  };
  
  // Rate limit events
  'ratelimit:exceeded': { 
    userId?: string; 
    limit: number; 
    window: string;
  };
}

// Step 3: Define Email Interface
interface Email {
  id: string;
  to: string;
  subject: string;
  template: string;
  data: Record<string, any>;
  priority: 'low' | 'normal' | 'high';
  attempts: number;
  createdAt: Date;
  scheduledFor?: Date;
}

// Step 4: Create the Service
@ServiceConfig({
  schema: EmailServiceConfigSchema,
  prefix: 'email', // Environment variables: EMAIL_SMTP_HOST, EMAIL_FROM_EMAIL, etc.
  hot: true, // Enable hot reload for configuration changes
})
export class EmailService extends BaseAsyncService<EmailServiceConfig, EmailServiceEventMap> {
  private emailQueue: Email[] = [];
  private processingInterval?: NodeJS.Timeout;
  private smtpTransporter?: any; // In real implementation, use nodemailer
  
  // Metrics
  private sentCount = 0;
  private failedCount = 0;
  private bouncedCount = 0;
  
  // Rate limiting
  private userRateLimits = new Map<string, { count: number; resetAt: Date }>();
  private globalRateLimit = { count: 0, resetAt: new Date() };

  /**
   * Get the singleton instance
   */
  static async getInstance(): Promise<EmailService> {
    return super.getInstance();
  }

  // Required service metadata methods
  protected getServiceName(): string {
    return 'email-service';
  }

  protected getServiceVersion(): string {
    return '1.0.0';
  }

  protected getServiceDescription(): string {
    return 'Email delivery service with templating and rate limiting';
  }

  protected getServiceDependencies(): string[] {
    // List other services this depends on
    return ['cache-manager', 'template-engine'];
  }

  /**
   * Initialize the service
   */
  protected async onInitialize(): Promise<void> {
    logger.info('EmailService initializing', {
      smtp: {
        host: this.config.smtp.host,
        port: this.config.smtp.port,
      },
      from: this.config.from,
      rateLimit: this.config.rateLimit,
    });

    // Validate required configuration
    if (!this.config.from.email) {
      throw new Error('Email from address is required');
    }
  }

  /**
   * Start the service
   */
  protected async onStart(): Promise<void> {
    if (!this.config.enabled) {
      logger.warn('Email service is disabled by configuration');
      return;
    }

    // Create SMTP transporter
    await this.connectToSMTP();

    // Start queue processing
    this.startQueueProcessing();

    // Start rate limit cleanup
    this.startRateLimitCleanup();

    logger.info('Email service started successfully');
  }

  /**
   * Stop the service
   */
  protected async onStop(): Promise<void> {
    // Stop processing
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Process remaining emails
    if (this.emailQueue.length > 0) {
      logger.info(`Processing ${this.emailQueue.length} remaining emails before shutdown`);
      await this.processQueue();
    }

    // Close SMTP connection
    if (this.smtpTransporter) {
      await this.smtpTransporter.close();
    }

    logger.info('Email service stopped');
  }

  /**
   * Handle configuration changes
   */
  protected async onConfigChanged(oldConfig: EmailServiceConfig, newConfig: EmailServiceConfig): Promise<void> {
    // Reconnect if SMTP settings changed
    if (
      oldConfig.smtp.host !== newConfig.smtp.host ||
      oldConfig.smtp.port !== newConfig.smtp.port ||
      oldConfig.smtp.auth?.user !== newConfig.smtp.auth?.user
    ) {
      logger.info('SMTP configuration changed, reconnecting...');
      await this.reconnectToSMTP();
    }

    // Update rate limits immediately
    logger.info('Configuration updated', {
      rateLimit: newConfig.rateLimit,
      queue: newConfig.queue,
    });
  }

  /**
   * Health check for SMTP connection
   */
  @HealthCheck({
    name: 'email:smtp',
    critical: true,
    interval: 60000, // Check every minute
    timeout: 10000,
  })
  async checkSMTPConnection(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    if (!this.config.enabled) {
      return { status: 'healthy', message: 'Email service is disabled' };
    }

    try {
      // In real implementation, verify SMTP connection
      // await this.smtpTransporter.verify();
      
      return { 
        status: 'healthy', 
        message: `SMTP connection to ${this.config.smtp.host}:${this.config.smtp.port} is healthy` 
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `SMTP connection failed: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Health check for queue processing
   */
  @HealthCheck({
    name: 'email:queue',
    critical: false,
    interval: 30000,
  })
  async checkQueueHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message: string }> {
    const queueSize = this.emailQueue.length;
    const oldestEmail = this.emailQueue[0];
    
    if (queueSize > 1000) {
      return { 
        status: 'unhealthy', 
        message: `Queue size critical: ${queueSize} emails pending` 
      };
    } else if (queueSize > 100) {
      return { 
        status: 'degraded', 
        message: `Queue size high: ${queueSize} emails pending` 
      };
    }

    // Check if oldest email is stuck
    if (oldestEmail) {
      const age = Date.now() - oldestEmail.createdAt.getTime();
      if (age > 3600000) { // 1 hour
        return { 
          status: 'degraded', 
          message: `Oldest email in queue for ${Math.floor(age / 60000)} minutes` 
        };
      }
    }

    return { 
      status: 'healthy', 
      message: `Queue healthy with ${queueSize} emails` 
    };
  }

  /**
   * Send an email
   */
  @Metric({ name: 'email.send', recordDuration: true })
  @Retry({ 
    attempts: 3,
    delay: 2000,
    backoff: 'exponential',
    retryIf: (error) => {
      // Retry on temporary errors
      const message = error.message.toLowerCase();
      return message.includes('timeout') || 
             message.includes('connection') ||
             message.includes('temporary');
    }
  })
  async sendEmail(params: {
    to: string;
    subject: string;
    template: string;
    data?: Record<string, any>;
    priority?: 'low' | 'normal' | 'high';
    userId?: string;
  }): Promise<string> {
    // Check rate limits
    if (!this.checkRateLimit(params.userId)) {
      this.emit('ratelimit:exceeded', {
        userId: params.userId,
        limit: params.userId ? this.config.rateLimit.perUser : this.config.rateLimit.global,
        window: '1 hour',
      });
      throw new Error('Rate limit exceeded');
    }

    // Create email object
    const email: Email = {
      id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      to: params.to,
      subject: params.subject,
      template: params.template,
      data: params.data || {},
      priority: params.priority || 'normal',
      attempts: 0,
      createdAt: new Date(),
    };

    // Add to queue
    this.addToQueue(email);

    this.emit('email:queued', {
      id: email.id,
      to: email.to,
      template: email.template,
      priority: email.priority,
    });

    logger.debug('Email queued', {
      id: email.id,
      to: email.to,
      template: email.template,
    });

    return email.id;
  }

  /**
   * Process email queue
   */
  @CircuitBreaker({
    threshold: 5,
    timeout: 60000,
    resetTime: 300000, // 5 minutes
  })
  private async processQueue(): Promise<void> {
    if (this.emailQueue.length === 0) {
      this.emit('queue:empty', {
        processedTotal: this.sentCount,
      });
      return;
    }

    // Get batch of emails to process
    const batch = this.emailQueue
      .filter(email => !email.scheduledFor || email.scheduledFor <= new Date())
      .sort((a, b) => {
        // Priority order: high > normal > low
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, this.config.queue.batchSize);

    if (batch.length === 0) {
      return;
    }

    this.emit('queue:processing', {
      batchSize: batch.length,
      queueLength: this.emailQueue.length,
    });

    // Process each email
    for (const email of batch) {
      try {
        await this.deliverEmail(email);
        
        // Remove from queue
        this.emailQueue = this.emailQueue.filter(e => e.id !== email.id);
        
      } catch (error) {
        email.attempts++;
        
        if (email.attempts >= this.config.queue.maxRetries) {
          // Move to failed
          this.failedCount++;
          this.emailQueue = this.emailQueue.filter(e => e.id !== email.id);
          
          this.emit('email:failed', {
            id: email.id,
            to: email.to,
            error: error as Error,
            attempt: email.attempts,
          });
          
          logger.error('Email permanently failed', {
            id: email.id,
            to: email.to,
            error: (error as Error).message,
          });
        } else {
          // Retry later
          email.scheduledFor = new Date(Date.now() + this.config.queue.retryDelay * email.attempts);
          
          logger.warn('Email delivery failed, will retry', {
            id: email.id,
            attempt: email.attempts,
            nextRetry: email.scheduledFor,
          });
        }
      }
    }
  }

  /**
   * Deliver a single email
   */
  private async deliverEmail(email: Email): Promise<void> {
    const start = Date.now();

    // In real implementation, use nodemailer or similar
    // const result = await this.smtpTransporter.sendMail({
    //   from: `${this.config.from.name} <${this.config.from.email}>`,
    //   to: email.to,
    //   subject: email.subject,
    //   html: await this.renderTemplate(email.template, email.data),
    // });

    // Simulate sending
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    // Simulate occasional failures
    if (Math.random() < 0.1) {
      throw new Error('Simulated SMTP error');
    }

    // Simulate bounces
    if (Math.random() < 0.05) {
      this.bouncedCount++;
      this.emit('email:bounced', {
        id: email.id,
        to: email.to,
        reason: 'Invalid recipient address',
      });
      return;
    }

    const duration = Date.now() - start;
    this.sentCount++;

    this.emit('email:sent', {
      id: email.id,
      to: email.to,
      duration,
      provider: 'smtp',
    });

    // Update rate limits
    this.updateRateLimit(email.to);

    logger.info('Email sent successfully', {
      id: email.id,
      to: email.to,
      duration,
    });
  }

  /**
   * Add email to queue with priority
   */
  private addToQueue(email: Email): void {
    // Insert based on priority
    let inserted = false;
    
    for (let i = 0; i < this.emailQueue.length; i++) {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      if (priorityOrder[email.priority] < priorityOrder[this.emailQueue[i].priority]) {
        this.emailQueue.splice(i, 0, email);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.emailQueue.push(email);
    }
  }

  /**
   * Connect to SMTP server
   */
  private async connectToSMTP(): Promise<void> {
    // In real implementation, create nodemailer transporter
    // this.smtpTransporter = nodemailer.createTransport({...});
    
    logger.info('Connected to SMTP server', {
      host: this.config.smtp.host,
      port: this.config.smtp.port,
    });
  }

  /**
   * Reconnect to SMTP server
   */
  private async reconnectToSMTP(): Promise<void> {
    if (this.smtpTransporter) {
      await this.smtpTransporter.close();
    }
    await this.connectToSMTP();
  }

  /**
   * Check rate limits
   */
  private checkRateLimit(userId?: string): boolean {
    const now = new Date();

    // Check user-specific rate limit
    if (userId) {
      const userLimit = this.userRateLimits.get(userId);
      if (userLimit) {
        if (userLimit.resetAt > now) {
          if (userLimit.count >= this.config.rateLimit.perUser) {
            return false;
          }
        } else {
          // Reset expired limit
          this.userRateLimits.delete(userId);
        }
      }
    }

    // Check global rate limit
    if (this.globalRateLimit.resetAt <= now) {
      this.globalRateLimit = {
        count: 0,
        resetAt: new Date(now.getTime() + 3600000), // 1 hour
      };
    }

    return this.globalRateLimit.count < this.config.rateLimit.global;
  }

  /**
   * Update rate limits after sending
   */
  private updateRateLimit(userId?: string): void {
    const now = new Date();

    // Update user limit
    if (userId) {
      const userLimit = this.userRateLimits.get(userId) || {
        count: 0,
        resetAt: new Date(now.getTime() + 3600000),
      };
      userLimit.count++;
      this.userRateLimits.set(userId, userLimit);
    }

    // Update global limit
    this.globalRateLimit.count++;
  }

  /**
   * Start queue processing loop
   */
  private startQueueProcessing(): void {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        logger.error('Queue processing error', { error });
      }
    }, 5000); // Process every 5 seconds
  }

  /**
   * Cleanup expired rate limits
   */
  private startRateLimitCleanup(): void {
    setInterval(() => {
      const now = new Date();
      
      // Clean up expired user rate limits
      for (const [userId, limit] of this.userRateLimits.entries()) {
        if (limit.resetAt <= now) {
          this.userRateLimits.delete(userId);
        }
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    sent: number;
    failed: number;
    bounced: number;
    queued: number;
    deliveryRate: string;
    avgDeliveryTime?: number;
  }> {
    const total = this.sentCount + this.failedCount;
    const deliveryRate = total > 0 
      ? ((this.sentCount / total) * 100).toFixed(2) + '%'
      : '0%';

    return {
      sent: this.sentCount,
      failed: this.failedCount,
      bounced: this.bouncedCount,
      queued: this.emailQueue.length,
      deliveryRate,
      // In real implementation, track delivery times
    };
  }
}

// Example usage
if (import.meta.main) {
  async function example() {
    // Get the email service instance
    const emailService = await EmailService.getInstance();

    // Listen to events
    emailService.on('email:sent', ({ id, to, duration }) => {
      console.log(`✅ Email ${id} sent to ${to} in ${duration}ms`);
    });

    emailService.on('email:failed', ({ id, to, error }) => {
      console.error(`❌ Email ${id} to ${to} failed: ${error.message}`);
    });

    emailService.on('ratelimit:exceeded', ({ userId, limit }) => {
      console.warn(`⚠️ Rate limit exceeded for user ${userId}: ${limit}/hour`);
    });

    // Send emails
    try {
      // Send welcome email
      const emailId = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Welcome to Todo App!',
        template: 'welcome',
        data: {
          userName: 'John Doe',
          activationLink: 'https://example.com/activate',
        },
        priority: 'high',
        userId: 'user123',
      });

      console.log(`Email queued with ID: ${emailId}`);

      // Send reminder emails
      for (let i = 0; i < 5; i++) {
        await emailService.sendEmail({
          to: `user${i}@example.com`,
          subject: 'Todo Reminder',
          template: 'todo-reminder',
          data: {
            todoTitle: `Task ${i}`,
            dueDate: new Date(Date.now() + 86400000), // Tomorrow
          },
          priority: 'normal',
        });
      }

      // Check service health
      const health = await emailService.getHealth();
      console.log('Service health:', health);

      // Get statistics
      const stats = await emailService.getStats();
      console.log('Email statistics:', stats);

    } catch (error) {
      console.error('Error:', error);
    }
  }

  example().catch(console.error);
}