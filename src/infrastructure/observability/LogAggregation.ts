import { logger } from '@/logger';
import { EventEmitterSingletonService } from '../core/SingletonService.js';
import { createHash } from 'crypto';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  message: string;
  service: string;
  module?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  metadata: Record<string, any>;
  tags: string[];
  fingerprint: string; // For deduplication
}

export interface LogQuery {
  level?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  service?: string;
  module?: string;
  traceId?: string;
  userId?: string;
  timeRange?: { start: number; end: number };
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface LogAnalytics {
  totalLogs: number;
  logsByLevel: Record<string, number>;
  logsByService: Record<string, number>;
  errorPatterns: Array<{
    pattern: string;
    count: number;
    examples: LogEntry[];
  }>;
  timeSeriesData: Array<{
    timestamp: number;
    count: number;
    errors: number;
  }>;
  topErrors: Array<{
    fingerprint: string;
    message: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
  }>;
}

export interface LogAlert {
  id: string;
  name: string;
  query: LogQuery;
  condition: 'count' | 'rate' | 'absence';
  threshold: number;
  timeWindow: number; // seconds
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  cooldown: number; // seconds
}

export interface StructuredLogConfig {
  serviceName: string;
  environment: string;
  version: string;
  maxLogSize: number;
  retentionPeriod: number; // days
  enableDeduplication: boolean;
  enableSampling: boolean;
  sampleRate: number;
  exportTargets: Array<{
    type: 'elasticsearch' | 'fluentd' | 'loki' | 'file';
    config: Record<string, any>;
  }>;
}

export class LogAggregation extends EventEmitterSingletonService<LogAggregation> {
  private config: StructuredLogConfig | null = null;
  private logs: LogEntry[] = [];
  private logIndex: Map<string, number[]> = new Map(); // field -> log indices
  private duplicateTracker: Map<string, { count: number; firstSeen: number; lastSeen: number }> = new Map();
  private alerts: Map<string, LogAlert> = new Map();
  private alertStates: Map<string, { lastTriggered: number; cooldownUntil: number }> = new Map();
  private cleanupInterval: NodeJS.Timer | null = null;

  protected constructor() {
    super();
  }

  public configure(config: StructuredLogConfig): void {
    this.config = config;
    this.setupCleanupSchedule();
  }

  private ensureConfig(): StructuredLogConfig {
    if (!this.config) {
      throw new Error('LogAggregation not configured');
    }
    return this.config;
  }

  public static getInstance(config?: StructuredLogConfig): LogAggregation {
    const instance = super.getInstance();
    if (config && !instance.config) {
      instance.configure(config);
    }
    return instance;
  }

  /**
   * Ingest log entry with structured processing
   */
  public ingestLog(logData: Omit<LogEntry, 'id' | 'timestamp' | 'fingerprint'>): void {
    try {
      // Create unique fingerprint for deduplication
      const fingerprint = this.createLogFingerprint(logData);

      // Check deduplication
      if (this.ensureConfig().enableDeduplication && this.shouldDeduplicate(fingerprint)) {
        this.updateDuplicateCount(fingerprint);
        return;
      }

      // Apply sampling if enabled
      if (this.ensureConfig().enableSampling && !this.shouldSample()) {
        return;
      }

      const logEntry: LogEntry = {
        id: this.generateLogId(),
        timestamp: Date.now(),
        fingerprint,
        ...logData,
      };

      // Store log
      this.logs.push(logEntry);
      this.updateIndex(logEntry);

      // Check size limits
      if (this.logs.length > this.ensureConfig().maxLogSize) {
        this.rotateLogs();
      }

      // Process alerts
      this.processLogAlerts(logEntry);

      // Emit events for real-time processing
      this.emit('log_ingested', logEntry);

      if (logEntry.level === 'error') {
        this.emit('error_logged', logEntry);
      }

      // Export to configured targets
      this.exportLog(logEntry);

    } catch (error) {
      logger.error('Failed to ingest log entry', error);
    }
  }

  /**
   * Query logs with advanced filtering
   */
  public queryLogs(query: LogQuery): LogEntry[] {
    let results = [...this.logs];

    // Filter by level
    if (query.level) {
      results = results.filter(log => log.level === query.level);
    }

    // Filter by service
    if (query.service) {
      results = results.filter(log => log.service === query.service);
    }

    // Filter by module
    if (query.module) {
      results = results.filter(log => log.module === query.module);
    }

    // Filter by trace ID
    if (query.traceId) {
      results = results.filter(log => log.traceId === query.traceId);
    }

    // Filter by user ID
    if (query.userId) {
      results = results.filter(log => log.userId === query.userId);
    }

    // Filter by time range
    if (query.timeRange) {
      results = results.filter(log =>
        log.timestamp >= query.timeRange!.start &&
        log.timestamp <= query.timeRange!.end
      );
    }

    // Text search
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(log =>
        log.message.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.metadata).toLowerCase().includes(searchLower)
      );
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(log =>
        query.tags!.some(tag => log.tags.includes(tag))
      );
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 100;

    return results.slice(offset, offset + limit);
  }

  /**
   * Generate comprehensive log analytics
   */
  public getLogAnalytics(timeRange?: { start: number; end: number }): LogAnalytics {
    let logs = this.logs;

    if (timeRange) {
      logs = logs.filter(log =>
        log.timestamp >= timeRange.start && log.timestamp <= timeRange.end
      );
    }

    // Basic statistics
    const logsByLevel: Record<string, number> = {};
    const logsByService: Record<string, number> = {};

    logs.forEach(log => {
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
      logsByService[log.service] = (logsByService[log.service] || 0) + 1;
    });

    // Error pattern analysis
    const errorPatterns = this.analyzeErrorPatterns(logs.filter(log => log.level === 'error'));

    // Time series data
    const timeSeriesData = this.generateTimeSeriesData(logs);

    // Top errors by frequency
    const topErrors = this.getTopErrors();

    return {
      totalLogs: logs.length,
      logsByLevel,
      logsByService,
      errorPatterns,
      timeSeriesData,
      topErrors,
    };
  }

  /**
   * Create log alert rule
   */
  public createLogAlert(alert: LogAlert): void {
    this.alerts.set(alert.id, alert);
    this.alertStates.set(alert.id, { lastTriggered: 0, cooldownUntil: 0 });

    logger.info('Log alert created', {
      id: alert.id,
      name: alert.name,
      condition: alert.condition,
      threshold: alert.threshold,
    });
  }

  /**
   * Get log alert status
   */
  public getLogAlerts(): Array<LogAlert & {
    status: 'active' | 'triggered' | 'cooldown';
    lastTriggered?: number;
  }> {
    return Array.from(this.alerts.values()).map(alert => {
      const state = this.alertStates.get(alert.id)!;
      const now = Date.now();

      let status: 'active' | 'triggered' | 'cooldown' = 'active';
      if (state.cooldownUntil > now) {
        status = 'cooldown';
      } else if (state.lastTriggered > 0 && (now - state.lastTriggered) < 60000) {
        status = 'triggered';
      }

      return {
        ...alert,
        status,
        lastTriggered: state.lastTriggered || undefined,
      };
    });
  }

  /**
   * Search logs using advanced patterns
   */
  public searchLogs(pattern: string, options?: {
    regex?: boolean;
    caseSensitive?: boolean;
    fields?: string[];
    timeRange?: { start: number; end: number };
  }): LogEntry[] {
    const opts = {
      regex: false,
      caseSensitive: false,
      fields: ['message', 'metadata'],
      ...options,
    };

    let searchPattern: RegExp;

    if (opts.regex) {
      try {
        searchPattern = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
      } catch {
        return []; // Invalid regex
      }
    } else {
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchPattern = new RegExp(escapedPattern, opts.caseSensitive ? 'g' : 'gi');
    }

    let logs = this.logs;

    if (opts.timeRange) {
      logs = logs.filter(log =>
        log.timestamp >= opts.timeRange!.start &&
        log.timestamp <= opts.timeRange!.end
      );
    }

    return logs.filter(log => {
      return opts.fields!.some(field => {
        let content = '';

        if (field === 'message') {
          content = log.message;
        } else if (field === 'metadata') {
          content = JSON.stringify(log.metadata);
        } else if (field in log) {
          content = String((log as any)[field]);
        }

        return searchPattern.test(content);
      });
    });
  }

  /**
   * Export logs in various formats
   */
  public exportLogs(
    query: LogQuery,
    format: 'json' | 'csv' | 'ndjson' = 'json'
  ): string {
    const logs = this.queryLogs(query);

    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);

      case 'ndjson':
        return logs.map(log => JSON.stringify(log)).join('\n');

      case 'csv':
        const headers = ['timestamp', 'level', 'service', 'message', 'traceId', 'userId'];
        const csvRows = [headers.join(',')];

        logs.forEach(log => {
          const row = headers.map(header => {
            const value = (log as any)[header] || '';
            return `"${String(value).replace(/"/g, '""')}"`;
          });
          csvRows.push(row.join(','));
        });

        return csvRows.join('\n');

      default:
        return JSON.stringify(logs);
    }
  }

  /**
   * Get log statistics dashboard
   */
  public getLogDashboard(): {
    overview: {
      totalLogs: number;
      errorRate: number;
      logRate: number; // logs per minute
      uniqueServices: number;
    };
    recent: {
      errors: LogEntry[];
      warnings: LogEntry[];
      topServices: Array<{ service: string; count: number }>;
    };
    trends: {
      hourly: Array<{ hour: number; count: number; errors: number }>;
      daily: Array<{ day: string; count: number; errors: number }>;
    };
  } {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);

    const recentLogs = this.logs.filter(log => log.timestamp > hourAgo);
    const dailyLogs = this.logs.filter(log => log.timestamp > dayAgo);

    // Overview
    const totalLogs = this.logs.length;
    const errorLogs = this.logs.filter(log => log.level === 'error').length;
    const errorRate = totalLogs > 0 ? errorLogs / totalLogs : 0;
    const logRate = recentLogs.length; // logs in last hour
    const uniqueServices = new Set(this.logs.map(log => log.service)).size;

    // Recent data
    const errors = this.logs
      .filter(log => log.level === 'error')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    const warnings = this.logs
      .filter(log => log.level === 'warn')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    const serviceCounts: Record<string, number> = {};
    recentLogs.forEach(log => {
      serviceCounts[log.service] = (serviceCounts[log.service] || 0) + 1;
    });

    const topServices = Object.entries(serviceCounts)
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Trends
    const hourly = this.generateHourlyTrends(dailyLogs);
    const daily = this.generateDailyTrends();

    return {
      overview: {
        totalLogs,
        errorRate,
        logRate,
        uniqueServices,
      },
      recent: {
        errors,
        warnings,
        topServices,
      },
      trends: {
        hourly,
        daily,
      },
    };
  }

  // Private helper methods

  private createLogFingerprint(logData: Omit<LogEntry, 'id' | 'timestamp' | 'fingerprint'>): string {
    const key = `${logData.level}:${logData.service}:${logData.message}`;
    return createHash('md5').update(key).digest('hex');
  }

  private shouldDeduplicate(fingerprint: string): boolean {
    const existing = this.duplicateTracker.get(fingerprint);
    if (!existing) {
      this.duplicateTracker.set(fingerprint, {
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });
      return false;
    }

    // Allow if last seen was more than 5 minutes ago
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return existing.lastSeen > fiveMinutesAgo;
  }

  private updateDuplicateCount(fingerprint: string): void {
    const existing = this.duplicateTracker.get(fingerprint);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    }
  }

  private shouldSample(): boolean {
    return Math.random() < this.ensureConfig().sampleRate;
  }

  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateIndex(logEntry: LogEntry): void {
    // Index by service
    if (!this.logIndex.has(`service:${logEntry.service}`)) {
      this.logIndex.set(`service:${logEntry.service}`, []);
    }
    this.logIndex.get(`service:${logEntry.service}`)!.push(this.logs.length - 1);

    // Index by level
    if (!this.logIndex.has(`level:${logEntry.level}`)) {
      this.logIndex.set(`level:${logEntry.level}`, []);
    }
    this.logIndex.get(`level:${logEntry.level}`)!.push(this.logs.length - 1);

    // Index by trace ID if present
    if (logEntry.traceId) {
      if (!this.logIndex.has(`traceId:${logEntry.traceId}`)) {
        this.logIndex.set(`traceId:${logEntry.traceId}`, []);
      }
      this.logIndex.get(`traceId:${logEntry.traceId}`)!.push(this.logs.length - 1);
    }
  }

  private rotateLogs(): void {
    const keepCount = Math.floor(this.ensureConfig().maxLogSize * 0.7);
    this.logs = this.logs.slice(-keepCount);

    // Rebuild index
    this.logIndex.clear();
    this.logs.forEach((log, index) => {
      // Update existing log entry index
      (log as any).originalIndex = index;
      this.updateIndex(log);
    });

    logger.info('Log rotation completed', {
      removedLogs: this.logs.length - keepCount,
      remainingLogs: this.logs.length,
    });
  }

  private processLogAlerts(logEntry: LogEntry): void {
    for (const [alertId, alert] of this.alerts) {
      if (!alert.enabled) continue;

      const state = this.alertStates.get(alertId)!;
      const now = Date.now();

      // Check cooldown
      if (state.cooldownUntil > now) continue;

      // Check if log matches alert query
      if (this.matchesAlertQuery(logEntry, alert.query)) {
        this.evaluateAlert(alert, state);
      }
    }
  }

  private matchesAlertQuery(logEntry: LogEntry, query: LogQuery): boolean {
    if (query.level && logEntry.level !== query.level) return false;
    if (query.service && logEntry.service !== query.service) return false;
    if (query.module && logEntry.module !== query.module) return false;
    if (query.traceId && logEntry.traceId !== query.traceId) return false;
    if (query.userId && logEntry.userId !== query.userId) return false;

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      if (!logEntry.message.toLowerCase().includes(searchLower)) return false;
    }

    if (query.tags && query.tags.length > 0) {
      if (!query.tags.some(tag => logEntry.tags.includes(tag))) return false;
    }

    return true;
  }

  private evaluateAlert(alert: LogAlert, state: { lastTriggered: number; cooldownUntil: number }): void {
    const now = Date.now();
    const timeWindow = alert.timeWindow * 1000;
    const windowStart = now - timeWindow;

    const matchingLogs = this.logs.filter(log =>
      log.timestamp >= windowStart && this.matchesAlertQuery(log, alert.query)
    );

    let shouldTrigger = false;

    switch (alert.condition) {
      case 'count':
        shouldTrigger = matchingLogs.length >= alert.threshold;
        break;
      case 'rate':
        const rate = matchingLogs.length / (timeWindow / 1000);
        shouldTrigger = rate >= alert.threshold;
        break;
      case 'absence':
        shouldTrigger = matchingLogs.length === 0;
        break;
    }

    if (shouldTrigger) {
      state.lastTriggered = now;
      state.cooldownUntil = now + (alert.cooldown * 1000);

      this.emit('log_alert_triggered', {
        alert,
        matchingLogs: matchingLogs.slice(0, 10), // Include some examples
        triggeredAt: now,
      });

      logger.warn('Log alert triggered', {
        alertId: alert.id,
        alertName: alert.name,
        matchingLogsCount: matchingLogs.length,
        severity: alert.severity,
      });
    }
  }

  private analyzeErrorPatterns(errorLogs: LogEntry[]): Array<{
    pattern: string;
    count: number;
    examples: LogEntry[];
  }> {
    const patterns: Map<string, LogEntry[]> = new Map();

    errorLogs.forEach(log => {
      // Extract error pattern (simplified)
      const pattern = this.extractErrorPattern(log.message);
      if (!patterns.has(pattern)) {
        patterns.set(pattern, []);
      }
      patterns.get(pattern)!.push(log);
    });

    return Array.from(patterns.entries())
      .map(([pattern, logs]) => ({
        pattern,
        count: logs.length,
        examples: logs.slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private extractErrorPattern(message: string): string {
    // Simplified pattern extraction
    return message
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/["'][^"']*["']/g, 'STRING') // Replace quoted strings
      .replace(/\b[a-f0-9]{8,}\b/gi, 'HASH') // Replace hashes/IDs
      .substring(0, 100);
  }

  private generateTimeSeriesData(logs: LogEntry[]): Array<{
    timestamp: number;
    count: number;
    errors: number;
  }> {
    const buckets: Map<number, { count: number; errors: number }> = new Map();
    const bucketSize = 60 * 60 * 1000; // 1 hour buckets

    logs.forEach(log => {
      const bucket = Math.floor(log.timestamp / bucketSize) * bucketSize;
      if (!buckets.has(bucket)) {
        buckets.set(bucket, { count: 0, errors: 0 });
      }

      const bucketData = buckets.get(bucket)!;
      bucketData.count++;
      if (log.level === 'error') {
        bucketData.errors++;
      }
    });

    return Array.from(buckets.entries())
      .map(([timestamp, data]) => ({
        timestamp,
        count: data.count,
        errors: data.errors,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private getTopErrors(): Array<{
    fingerprint: string;
    message: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
  }> {
    return Array.from(this.duplicateTracker.entries())
      .map(([fingerprint, data]) => {
        const exampleLog = this.logs.find(log => log.fingerprint === fingerprint);
        return {
          fingerprint,
          message: exampleLog?.message || 'Unknown error',
          count: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private generateHourlyTrends(logs: LogEntry[]): Array<{ hour: number; count: number; errors: number }> {
    const trends: Record<number, { count: number; errors: number }> = {};

    for (let i = 0; i < 24; i++) {
      trends[i] = { count: 0, errors: 0 };
    }

    logs.forEach(log => {
      const hour = new Date(log.timestamp).getHours();
      trends[hour].count++;
      if (log.level === 'error') {
        trends[hour].errors++;
      }
    });

    return Object.entries(trends).map(([hour, data]) => ({
      hour: parseInt(hour),
      count: data.count,
      errors: data.errors,
    }));
  }

  private generateDailyTrends(): Array<{ day: string; count: number; errors: number }> {
    const trends: Record<string, { count: number; errors: number }> = {};
    const today = new Date();

    // Generate last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const day = date.toISOString().split('T')[0];
      trends[day] = { count: 0, errors: 0 };
    }

    this.logs.forEach(log => {
      const day = new Date(log.timestamp).toISOString().split('T')[0];
      if (trends[day]) {
        trends[day].count++;
        if (log.level === 'error') {
          trends[day].errors++;
        }
      }
    });

    return Object.entries(trends).map(([day, data]) => ({
      day,
      count: data.count,
      errors: data.errors,
    }));
  }

  private exportLog(logEntry: LogEntry): void {
    this.ensureConfig().exportTargets.forEach(target => {
      try {
        switch (target.type) {
          case 'file':
            // File export would be implemented here
            break;
          case 'elasticsearch':
            // Elasticsearch export would be implemented here
            break;
          case 'fluentd':
            // Fluentd export would be implemented here
            break;
          case 'loki':
            // Loki export would be implemented here
            break;
        }
      } catch (error) {
        logger.error(`Failed to export log to ${target.type}`, error);
      }
    });
  }

  private setupCleanupSchedule(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 60 * 60 * 1000); // Every hour
  }

  private performCleanup(): void {
    const cutoffTime = Date.now() - (this.ensureConfig().retentionPeriod * 24 * 60 * 60 * 1000);

    // Remove old logs
    const initialCount = this.logs.length;
    this.logs = this.logs.filter(log => log.timestamp > cutoffTime);

    // Clean duplicate tracker
    for (const [fingerprint, data] of this.duplicateTracker) {
      if (data.lastSeen < cutoffTime) {
        this.duplicateTracker.delete(fingerprint);
      }
    }

    // Rebuild index if logs were removed
    if (this.logs.length !== initialCount) {
      this.logIndex.clear();
      this.logs.forEach((log, index) => {
        this.updateIndex(log);
      });

      logger.info('Log cleanup completed', {
        removedLogs: initialCount - this.logs.length,
        remainingLogs: this.logs.length,
      });
    }
  }

  /**
   * Get current log aggregation status
   */
  public getStatus(): {
    totalLogs: number;
    indexSize: number;
    duplicateTrackerSize: number;
    activeAlerts: number;
    memoryUsage: number;
  } {
    return {
      totalLogs: this.logs.length,
      indexSize: this.logIndex.size,
      duplicateTrackerSize: this.duplicateTracker.size,
      activeAlerts: this.alerts.size,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.logs = [];
    this.logIndex.clear();
    this.duplicateTracker.clear();
    this.alerts.clear();
    this.alertStates.clear();

    logger.info('Log aggregation cleaned up');
  }
}

// Export singleton factory
export const createLogAggregation = (config: StructuredLogConfig) => {
  return LogAggregation.getInstance(config);
};