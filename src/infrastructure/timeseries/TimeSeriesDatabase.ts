import type { SpanOptions } from '@opentelemetry/api';
import { AsyncSingletonService } from '@/infrastructure/core/AsyncSingletonService.js';
import { createLogger } from '@/lib/logger.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { DistributedTracing } from '@/infrastructure/observability/DistributedTracing.js';

const logger = createLogger('TimeSeriesDatabase');

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  tags?: Record<string, string>;
  fields?: Record<string, number | string | boolean>;
}

export interface TimeSeriesMetric {
  name: string;
  points: TimeSeriesPoint[];
  metadata?: MetricMetadata;
}

export interface MetricMetadata {
  description?: string;
  unit?: string;
  type?: MetricType;
  category?: string;
  source?: string;
  retention?: RetentionPolicy;
  aggregation?: AggregationConfig;
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
  RATE = 'rate'
}

export interface RetentionPolicy {
  duration: number; // milliseconds
  downsampling?: DownsamplingRule[];
  compression?: CompressionConfig;
}

export interface DownsamplingRule {
  resolution: number; // milliseconds
  aggregation: AggregationFunction;
  retention: number; // milliseconds
}

export enum AggregationFunction {
  AVG = 'avg',
  SUM = 'sum',
  MIN = 'min',
  MAX = 'max',
  COUNT = 'count',
  FIRST = 'first',
  LAST = 'last',
  MEDIAN = 'median',
  P95 = 'p95',
  P99 = 'p99',
  STDDEV = 'stddev'
}

export interface CompressionConfig {
  algorithm: 'gzip' | 'lz4' | 'snappy' | 'zstd';
  level?: number;
  enabled: boolean;
}

export interface AggregationConfig {
  functions: AggregationFunction[];
  intervals: number[]; // milliseconds
  groupBy?: string[];
}

export interface TimeSeriesQuery {
  metric: string;
  startTime: number;
  endTime: number;
  resolution?: number;
  aggregation?: AggregationFunction;
  groupBy?: string[];
  filters?: QueryFilter[];
  limit?: number;
  offset?: number;
  fill?: FillOption;
  downsample?: DownsampleConfig;
}

export interface QueryFilter {
  tag: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'regex' | 'exists';
  value: string | string[];
}

export enum FillOption {
  NULL = 'null',
  ZERO = 'zero',
  PREVIOUS = 'previous',
  LINEAR = 'linear',
  NONE = 'none'
}

export interface DownsampleConfig {
  resolution: number;
  aggregation: AggregationFunction;
  alignTime?: boolean;
}

export interface TimeSeriesResult {
  metric: string;
  points: AggregatedPoint[];
  metadata: ResultMetadata;
}

export interface AggregatedPoint {
  timestamp: number;
  value: number | null;
  count?: number;
  tags?: Record<string, string>;
  aggregation?: AggregationFunction;
}

export interface ResultMetadata {
  query: TimeSeriesQuery;
  executionTime: number;
  pointCount: number;
  resolution: number;
  aggregated: boolean;
  warnings?: string[];
}

export interface BulkWriteRequest {
  metrics: TimeSeriesMetric[];
  timestamp?: number;
  tags?: Record<string, string>;
  options?: BulkWriteOptions;
}

export interface BulkWriteOptions {
  batchSize?: number;
  timeout?: number;
  retryCount?: number;
  validateSchema?: boolean;
  compression?: boolean;
}

export interface BulkWriteResult {
  success: boolean;
  pointsWritten: number;
  pointsFailed: number;
  errors: WriteError[];
  duration: number;
}

export interface WriteError {
  metric: string;
  timestamp: number;
  error: string;
  point?: TimeSeriesPoint;
}

export interface TimeSeriesSchema {
  name: string;
  fields: SchemaField[];
  tags: SchemaTag[];
  retention: RetentionPolicy;
  indexing: IndexingConfig;
  validation: ValidationRule[];
}

export interface SchemaField {
  name: string;
  type: 'float' | 'integer' | 'string' | 'boolean';
  required: boolean;
  unit?: string;
  description?: string;
  validation?: FieldValidation;
}

export interface SchemaTag {
  name: string;
  cardinality: 'low' | 'medium' | 'high';
  required: boolean;
  values?: string[];
  pattern?: string;
  description?: string;
}

export interface IndexingConfig {
  indexTags: boolean;
  indexFields: boolean;
  customIndices?: CustomIndex[];
}

export interface CustomIndex {
  name: string;
  fields: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
}

export interface ValidationRule {
  field: string;
  rule: 'range' | 'pattern' | 'custom';
  parameters: Record<string, any>;
  message?: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  enum?: (string | number)[];
}

export interface TimeSeriesAlert {
  id: string;
  name: string;
  description: string;
  query: TimeSeriesQuery;
  condition: AlertCondition;
  actions: AlertAction[];
  enabled: boolean;
  schedule: AlertSchedule;
  state: AlertState;
}

export interface AlertCondition {
  type: 'threshold' | 'change' | 'anomaly' | 'absence';
  threshold?: number;
  operator?: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  changePercent?: number;
  changeWindow?: number;
  anomalyScore?: number;
  absenceWindow?: number;
}

export interface AlertAction {
  type: 'webhook' | 'email' | 'slack' | 'pagerduty' | 'custom';
  config: Record<string, any>;
  conditions?: ActionCondition[];
}

export interface ActionCondition {
  severity: 'low' | 'medium' | 'high' | 'critical';
  timeOfDay?: { start: string; end: string };
  dayOfWeek?: string[];
}

export interface AlertSchedule {
  interval: number; // milliseconds
  timezone?: string;
  quietHours?: { start: string; end: string };
  maxFrequency?: number; // max alerts per hour
}

export interface AlertState {
  status: 'ok' | 'alerting' | 'no_data' | 'error';
  lastEvaluation: Date;
  lastAlert?: Date;
  alertCount: number;
  message?: string;
  value?: number;
}

export interface MetricDashboard {
  id: string;
  name: string;
  description: string;
  panels: DashboardPanel[];
  layout: DashboardLayout;
  variables: DashboardVariable[];
  timeRange: TimeRange;
  refreshInterval: number;
  tags: string[];
}

export interface DashboardPanel {
  id: string;
  title: string;
  type: PanelType;
  queries: TimeSeriesQuery[];
  visualization: VisualizationConfig;
  position: PanelPosition;
  options: PanelOptions;
}

export enum PanelType {
  LINE_CHART = 'line_chart',
  BAR_CHART = 'bar_chart',
  GAUGE = 'gauge',
  STAT = 'stat',
  TABLE = 'table',
  HEATMAP = 'heatmap',
  PIE_CHART = 'pie_chart',
  HISTOGRAM = 'histogram'
}

export interface VisualizationConfig {
  colors?: string[];
  yAxis?: AxisConfig;
  xAxis?: AxisConfig;
  legend?: LegendConfig;
  tooltip?: TooltipConfig;
  thresholds?: ThresholdConfig[];
}

export interface AxisConfig {
  min?: number;
  max?: number;
  unit?: string;
  scale?: 'linear' | 'logarithmic';
  label?: string;
}

export interface LegendConfig {
  show: boolean;
  position: 'top' | 'bottom' | 'left' | 'right';
  alignAsTable?: boolean;
  values?: boolean;
}

export interface TooltipConfig {
  mode: 'single' | 'multi' | 'none';
  sort: 'none' | 'ascending' | 'descending';
}

export interface ThresholdConfig {
  value: number;
  color: string;
  fill?: boolean;
  line?: boolean;
}

export interface PanelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelOptions {
  transparent?: boolean;
  title?: string;
  description?: string;
  links?: PanelLink[];
}

export interface PanelLink {
  title: string;
  url: string;
  type: 'absolute' | 'dashboard' | 'external';
}

export interface DashboardLayout {
  type: 'grid' | 'flex';
  columns?: number;
  rowHeight?: number;
  margin?: number;
}

export interface DashboardVariable {
  name: string;
  type: 'query' | 'constant' | 'custom' | 'interval';
  query?: string;
  values?: string[];
  current?: string;
  regex?: string;
  sort?: 'alphabetical' | 'numerical' | 'alphabetical_ci' | 'numerical_ci';
}

export interface TimeRange {
  from: string | number;
  to: string | number;
  raw?: {
    from: string;
    to: string;
  };
}

export interface MetricStatistics {
  metric: string;
  timeRange: TimeRange;
  statistics: StatisticsData;
  distribution: DistributionData;
  trends: TrendData;
}

export interface StatisticsData {
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
  stddev: number;
  variance: number;
  percentiles: Record<string, number>;
}

export interface DistributionData {
  buckets: DistributionBucket[];
  outliers: OutlierData[];
}

export interface DistributionBucket {
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface OutlierData {
  timestamp: number;
  value: number;
  zscore: number;
}

export interface TrendData {
  direction: 'up' | 'down' | 'stable';
  magnitude: number;
  confidence: number;
  seasonality?: SeasonalityData;
  forecast?: ForecastData[];
}

export interface SeasonalityData {
  period: number;
  strength: number;
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
}

export interface ForecastData {
  timestamp: number;
  value: number;
  confidence: number;
  upperBound: number;
  lowerBound: number;
}

export class TimeSeriesDatabase extends AsyncSingletonService<TimeSeriesDatabase> {
  private redis!: RedisClusterManager;
  private tracing!: DistributedTracing;
  private schemas: Map<string, TimeSeriesSchema> = new Map();
  private alerts: Map<string, TimeSeriesAlert> = new Map();
  private dashboards: Map<string, MetricDashboard> = new Map();
  private writeBuffer: Map<string, TimeSeriesPoint[]> = new Map();
  private flushInterval?: NodeJS.Timeout;
  private alertInterval?: NodeJS.Timeout;

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<TimeSeriesDatabase> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.redis = RedisClusterManager.getInstance();
      this.tracing = await DistributedTracing.getInstance();

      await this.loadSchemas();
      await this.loadAlerts();
      await this.loadDashboards();
      await this.startBackgroundTasks();

      logger.info('TimeSeriesDatabase initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize TimeSeriesDatabase:', error);
      throw error;
    }
  }

  async createSchema(schema: TimeSeriesSchema): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.schema_name': schema.name,
        'timeseries.operation': 'create_schema'
      }
    };

    return this.tracing.traceAsync('timeseries_create_schema', spanOptions, async () => {
      try {
        await this.validateSchema(schema);

        this.schemas.set(schema.name, schema);
        await this.redis.setObject(`timeseries:schema:${schema.name}`, schema, 86400000 * 30); // 30 days

        // Create indices for the schema
        await this.createSchemaIndices(schema);

        logger.info(`Time series schema created: ${schema.name}`);
      } catch (error) {
        logger.error(`Failed to create schema ${schema.name}:`, error);
        throw error;
      }
    });
  }

  async writePoint(metric: string, point: TimeSeriesPoint): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.metric': metric,
        'timeseries.operation': 'write_point'
      }
    };

    return this.tracing.traceAsync('timeseries_write_point', spanOptions, async () => {
      try {
        // Validate point against schema
        await this.validatePoint(metric, point);

        // Add to write buffer
        if (!this.writeBuffer.has(metric)) {
          this.writeBuffer.set(metric, []);
        }
        this.writeBuffer.get(metric)!.push(point);

        // Flush if buffer is getting large
        if (this.writeBuffer.get(metric)!.length >= 1000) {
          await this.flushMetric(metric);
        }
      } catch (error) {
        logger.error(`Failed to write point for metric ${metric}:`, error);
        throw error;
      }
    });
  }

  async writePoints(metric: string, points: TimeSeriesPoint[]): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.metric': metric,
        'timeseries.operation': 'write_points',
        'timeseries.point_count': points.length
      }
    };

    return this.tracing.traceAsync('timeseries_write_points', spanOptions, async () => {
      try {
        // Validate all points
        for (const point of points) {
          await this.validatePoint(metric, point);
        }

        // Add to write buffer
        if (!this.writeBuffer.has(metric)) {
          this.writeBuffer.set(metric, []);
        }
        this.writeBuffer.get(metric)!.push(...points);

        // Flush if buffer is getting large
        if (this.writeBuffer.get(metric)!.length >= 1000) {
          await this.flushMetric(metric);
        }
      } catch (error) {
        logger.error(`Failed to write points for metric ${metric}:`, error);
        throw error;
      }
    });
  }

  async bulkWrite(request: BulkWriteRequest): Promise<BulkWriteResult> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.operation': 'bulk_write',
        'timeseries.metric_count': request.metrics.length
      }
    };

    return this.tracing.traceAsync('timeseries_bulk_write', spanOptions, async () => {
      const startTime = Date.now();
      const result: BulkWriteResult = {
        success: true,
        pointsWritten: 0,
        pointsFailed: 0,
        errors: [],
        duration: 0
      };

      try {
        const batchSize = request.options?.batchSize || 100;

        for (let i = 0; i < request.metrics.length; i += batchSize) {
          const batch = request.metrics.slice(i, i + batchSize);

          for (const metric of batch) {
            try {
              await this.writePoints(metric.name, metric.points);
              result.pointsWritten += metric.points.length;
            } catch (error) {
              result.success = false;
              result.pointsFailed += metric.points.length;
              result.errors.push({
                metric: metric.name,
                timestamp: Date.now(),
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }

        result.duration = Date.now() - startTime;
        return result;
      } catch (error) {
        logger.error('Bulk write failed:', error);
        result.success = false;
        result.duration = Date.now() - startTime;
        throw error;
      }
    });
  }

  async query(query: TimeSeriesQuery): Promise<TimeSeriesResult> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.metric': query.metric,
        'timeseries.operation': 'query',
        'timeseries.time_range': query.endTime - query.startTime
      }
    };

    return this.tracing.traceAsync('timeseries_query', spanOptions, async () => {
      try {
        const startTime = Date.now();

        // Get raw points from storage
        const rawPoints = await this.getRawPoints(query);

        // Apply filters
        let filteredPoints = await this.applyFilters(rawPoints, query.filters || []);

        // Apply downsampling if needed
        if (query.downsample || query.resolution) {
          filteredPoints = await this.downsamplePoints(filteredPoints, query);
        }

        // Apply aggregation
        const aggregatedPoints = await this.aggregatePoints(filteredPoints, query);

        // Apply fill option
        const filledPoints = await this.fillMissingPoints(aggregatedPoints, query);

        // Apply limit and offset
        const limitedPoints = this.applyLimitOffset(filledPoints, query);

        const executionTime = Date.now() - startTime;

        return {
          metric: query.metric,
          points: limitedPoints,
          metadata: {
            query,
            executionTime,
            pointCount: limitedPoints.length,
            resolution: query.resolution || this.inferResolution(limitedPoints),
            aggregated: !!query.aggregation || !!query.downsample,
            warnings: this.generateQueryWarnings(query, limitedPoints)
          }
        };
      } catch (error) {
        logger.error(`Query failed for metric ${query.metric}:`, error);
        throw error;
      }
    });
  }

  async multiQuery(queries: TimeSeriesQuery[]): Promise<TimeSeriesResult[]> {
    const spanOptions: SpanOptions = {
      attributes: {
        'timeseries.operation': 'multi_query',
        'timeseries.query_count': queries.length
      }
    };

    return this.tracing.traceAsync('timeseries_multi_query', spanOptions, async () => {
      try {
        const queryPromises = queries.map(query => this.query(query));
        const results = await Promise.allSettled(queryPromises);

        return results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            logger.error(`Multi-query item ${index} failed:`, result.reason);
            return this.createEmptyResult(queries[index]);
          }
        });
      } catch (error) {
        logger.error('Multi-query failed:', error);
        throw error;
      }
    });
  }

  async getStatistics(metric: string, timeRange: TimeRange): Promise<MetricStatistics> {
    try {
      const query: TimeSeriesQuery = {
        metric,
        startTime: this.parseTimeRange(timeRange.from),
        endTime: this.parseTimeRange(timeRange.to)
      };

      const result = await this.query(query);
      const values = result.points.map(p => p.value).filter(v => v !== null) as number[];

      if (values.length === 0) {
        throw new Error(`No data found for metric ${metric} in the specified time range`);
      }

      // Calculate statistics
      const statistics = this.calculateStatistics(values);

      // Calculate distribution
      const distribution = this.calculateDistribution(values);

      // Calculate trends
      const trends = this.calculateTrends(result.points);

      return {
        metric,
        timeRange,
        statistics,
        distribution,
        trends
      };
    } catch (error) {
      logger.error(`Failed to get statistics for metric ${metric}:`, error);
      throw error;
    }
  }

  async createAlert(alert: TimeSeriesAlert): Promise<void> {
    try {
      await this.validateAlert(alert);

      this.alerts.set(alert.id, alert);
      await this.redis.setObject(`timeseries:alert:${alert.id}`, alert, 86400000 * 30); // 30 days

      logger.info(`Time series alert created: ${alert.name} (${alert.id})`);
    } catch (error) {
      logger.error(`Failed to create alert ${alert.id}:`, error);
      throw error;
    }
  }

  async createDashboard(dashboard: MetricDashboard): Promise<void> {
    try {
      await this.validateDashboard(dashboard);

      this.dashboards.set(dashboard.id, dashboard);
      await this.redis.setObject(`timeseries:dashboard:${dashboard.id}`, dashboard, 86400000 * 30); // 30 days

      logger.info(`Dashboard created: ${dashboard.name} (${dashboard.id})`);
    } catch (error) {
      logger.error(`Failed to create dashboard ${dashboard.id}:`, error);
      throw error;
    }
  }

  async executeAlert(alertId: string): Promise<void> {
    try {
      const alert = this.alerts.get(alertId);
      if (!alert || !alert.enabled) {
        return;
      }

      const result = await this.query(alert.query);
      const shouldAlert = await this.evaluateAlertCondition(alert.condition, result);

      if (shouldAlert) {
        await this.triggerAlert(alert, result);
      } else {
        await this.clearAlert(alert);
      }

      alert.state.lastEvaluation = new Date();
      await this.redis.setObject(`timeseries:alert:${alertId}`, alert, 86400000 * 30);
    } catch (error) {
      logger.error(`Failed to execute alert ${alertId}:`, error);
    }
  }

  private async validateSchema(schema: TimeSeriesSchema): Promise<void> {
    if (!schema.name || schema.fields.length === 0) {
      throw new Error('Schema name and fields are required');
    }

    // Validate field types
    for (const field of schema.fields) {
      if (!['float', 'integer', 'string', 'boolean'].includes(field.type)) {
        throw new Error(`Invalid field type: ${field.type}`);
      }
    }
  }

  private async validatePoint(metric: string, point: TimeSeriesPoint): Promise<void> {
    const schema = this.schemas.get(metric);
    if (!schema) {
      // Allow points for metrics without explicit schema
      return;
    }

    // Validate required tags
    for (const tag of schema.tags) {
      if (tag.required && (!point.tags || !point.tags[tag.name])) {
        throw new Error(`Required tag missing: ${tag.name}`);
      }
    }

    // Validate fields
    if (point.fields) {
      for (const [fieldName, value] of Object.entries(point.fields)) {
        const field = schema.fields.find(f => f.name === fieldName);
        if (field) {
          await this.validateFieldValue(field, value);
        }
      }
    }
  }

  private async validateFieldValue(field: SchemaField, value: any): Promise<void> {
    // Type validation
    switch (field.type) {
      case 'float':
      case 'integer':
        if (typeof value !== 'number') {
          throw new Error(`Field ${field.name} must be a number`);
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Field ${field.name} must be a string`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Field ${field.name} must be a boolean`);
        }
        break;
    }

    // Validation rules
    if (field.validation) {
      if (field.validation.min !== undefined && typeof value === 'number' && value < field.validation.min) {
        throw new Error(`Field ${field.name} must be at least ${field.validation.min}`);
      }

      if (field.validation.max !== undefined && typeof value === 'number' && value > field.validation.max) {
        throw new Error(`Field ${field.name} must be at most ${field.validation.max}`);
      }

      if (field.validation.pattern && typeof value === 'string') {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(value)) {
          throw new Error(`Field ${field.name} does not match pattern: ${field.validation.pattern}`);
        }
      }

      if (field.validation.enum && !field.validation.enum.includes(value)) {
        throw new Error(`Field ${field.name} must be one of: ${field.validation.enum.join(', ')}`);
      }
    }
  }

  private async createSchemaIndices(schema: TimeSeriesSchema): Promise<void> {
    // Create indices for efficient querying
    // This is a simplified implementation
    logger.debug(`Creating indices for schema: ${schema.name}`);
  }

  private async flushMetric(metric: string): Promise<void> {
    const points = this.writeBuffer.get(metric);
    if (!points || points.length === 0) {
      return;
    }

    try {
      // Store points in Redis with time-based keys
      const batches = this.batchPointsByTime(points);

      for (const [timeKey, batchPoints] of batches) {
        const key = `timeseries:data:${metric}:${timeKey}`;
        await this.redis.listPush(key, batchPoints);

        // Set expiration based on retention policy
        const schema = this.schemas.get(metric);
        const retention = schema?.retention?.duration || 86400000 * 30; // 30 days default
        await this.redis.expire(key, Math.ceil(retention / 1000));
      }

      // Clear buffer
      this.writeBuffer.set(metric, []);

      logger.debug(`Flushed ${points.length} points for metric ${metric}`);
    } catch (error) {
      logger.error(`Failed to flush metric ${metric}:`, error);
    }
  }

  private batchPointsByTime(points: TimeSeriesPoint[]): Map<string, TimeSeriesPoint[]> {
    const batches = new Map<string, TimeSeriesPoint[]>();

    for (const point of points) {
      // Group by hour
      const hour = Math.floor(point.timestamp / 3600000) * 3600000;
      const timeKey = hour.toString();

      if (!batches.has(timeKey)) {
        batches.set(timeKey, []);
      }
      batches.get(timeKey)!.push(point);
    }

    return batches;
  }

  private async getRawPoints(query: TimeSeriesQuery): Promise<TimeSeriesPoint[]> {
    const points: TimeSeriesPoint[] = [];

    // Calculate time range keys
    const startHour = Math.floor(query.startTime / 3600000) * 3600000;
    const endHour = Math.floor(query.endTime / 3600000) * 3600000;

    for (let hour = startHour; hour <= endHour; hour += 3600000) {
      const key = `timeseries:data:${query.metric}:${hour}`;
      const hourPoints = await this.redis.getList<TimeSeriesPoint>(key) || [];

      // Filter by exact time range
      const filteredPoints = hourPoints.filter(p =>
        p.timestamp >= query.startTime && p.timestamp <= query.endTime
      );

      points.push(...filteredPoints);
    }

    return points.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async applyFilters(points: TimeSeriesPoint[], filters: QueryFilter[]): Promise<TimeSeriesPoint[]> {
    if (filters.length === 0) {
      return points;
    }

    return points.filter(point => {
      return filters.every(filter => {
        const tagValue = point.tags?.[filter.tag];

        switch (filter.operator) {
          case 'equals':
            return tagValue === filter.value;
          case 'not_equals':
            return tagValue !== filter.value;
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(tagValue);
          case 'not_in':
            return Array.isArray(filter.value) && !filter.value.includes(tagValue);
          case 'regex':
            return tagValue && typeof filter.value === 'string' && new RegExp(filter.value).test(tagValue);
          case 'exists':
            return tagValue !== undefined;
          default:
            return true;
        }
      });
    });
  }

  private async downsamplePoints(points: TimeSeriesPoint[], query: TimeSeriesQuery): Promise<TimeSeriesPoint[]> {
    const resolution = query.downsample?.resolution || query.resolution;
    if (!resolution) {
      return points;
    }

    const aggregation = query.downsample?.aggregation || query.aggregation || AggregationFunction.AVG;
    const buckets = new Map<number, TimeSeriesPoint[]>();

    // Group points into time buckets
    for (const point of points) {
      const bucketTime = Math.floor(point.timestamp / resolution) * resolution;

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }
      buckets.get(bucketTime)!.push(point);
    }

    // Aggregate each bucket
    const aggregatedPoints: TimeSeriesPoint[] = [];

    for (const [bucketTime, bucketPoints] of buckets) {
      const aggregatedValue = this.aggregateValues(
        bucketPoints.map(p => p.value),
        aggregation
      );

      aggregatedPoints.push({
        timestamp: bucketTime,
        value: aggregatedValue,
        tags: bucketPoints[0].tags // Use first point's tags
      });
    }

    return aggregatedPoints.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async aggregatePoints(points: TimeSeriesPoint[], query: TimeSeriesQuery): Promise<AggregatedPoint[]> {
    if (!query.groupBy || query.groupBy.length === 0) {
      return points.map(p => ({
        timestamp: p.timestamp,
        value: p.value,
        tags: p.tags
      }));
    }

    // Group by specified tags
    const groups = new Map<string, TimeSeriesPoint[]>();

    for (const point of points) {
      const groupKey = query.groupBy.map(tag => point.tags?.[tag] || '').join('|');

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(point);
    }

    // Aggregate each group
    const aggregatedPoints: AggregatedPoint[] = [];

    for (const [groupKey, groupPoints] of groups) {
      const aggregation = query.aggregation || AggregationFunction.AVG;
      const aggregatedValue = this.aggregateValues(
        groupPoints.map(p => p.value),
        aggregation
      );

      // Use the timestamp of the first point in the group
      const timestamp = groupPoints[0].timestamp;
      const tags = groupPoints[0].tags;

      aggregatedPoints.push({
        timestamp,
        value: aggregatedValue,
        count: groupPoints.length,
        tags,
        aggregation
      });
    }

    return aggregatedPoints.sort((a, b) => a.timestamp - b.timestamp);
  }

  private aggregateValues(values: number[], aggregation: AggregationFunction): number {
    if (values.length === 0) {
      return 0;
    }

    switch (aggregation) {
      case AggregationFunction.SUM:
        return values.reduce((sum, v) => sum + v, 0);
      case AggregationFunction.AVG:
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      case AggregationFunction.MIN:
        return Math.min(...values);
      case AggregationFunction.MAX:
        return Math.max(...values);
      case AggregationFunction.COUNT:
        return values.length;
      case AggregationFunction.FIRST:
        return values[0];
      case AggregationFunction.LAST:
        return values[values.length - 1];
      case AggregationFunction.MEDIAN:
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      case AggregationFunction.P95:
        return this.calculatePercentile(values, 95);
      case AggregationFunction.P99:
        return this.calculatePercentile(values, 99);
      case AggregationFunction.STDDEV:
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
      default:
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
  }

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);

    if (Math.floor(index) === index) {
      return sorted[index];
    } else {
      const lower = sorted[Math.floor(index)];
      const upper = sorted[Math.ceil(index)];
      return lower + (upper - lower) * (index - Math.floor(index));
    }
  }

  private async fillMissingPoints(points: AggregatedPoint[], query: TimeSeriesQuery): Promise<AggregatedPoint[]> {
    if (!query.fill || query.fill === FillOption.NONE) {
      return points;
    }

    const resolution = query.resolution || this.inferResolution(points);
    if (!resolution) {
      return points;
    }

    const filledPoints: AggregatedPoint[] = [];
    let currentTime = query.startTime;
    let pointIndex = 0;

    while (currentTime <= query.endTime) {
      const existingPoint = points.find(p => Math.abs(p.timestamp - currentTime) < resolution / 2);

      if (existingPoint) {
        filledPoints.push(existingPoint);
        pointIndex++;
      } else {
        // Fill missing point
        let fillValue: number | null = null;

        switch (query.fill) {
          case FillOption.ZERO:
            fillValue = 0;
            break;
          case FillOption.PREVIOUS:
            if (filledPoints.length > 0) {
              fillValue = filledPoints[filledPoints.length - 1].value;
            }
            break;
          case FillOption.LINEAR:
            fillValue = this.linearInterpolate(points, currentTime);
            break;
          case FillOption.NULL:
          default:
            fillValue = null;
            break;
        }

        filledPoints.push({
          timestamp: currentTime,
          value: fillValue
        });
      }

      currentTime += resolution;
    }

    return filledPoints;
  }

  private linearInterpolate(points: AggregatedPoint[], timestamp: number): number | null {
    // Find surrounding points
    let before: AggregatedPoint | null = null;
    let after: AggregatedPoint | null = null;

    for (const point of points) {
      if (point.timestamp < timestamp && (!before || point.timestamp > before.timestamp)) {
        before = point;
      }
      if (point.timestamp > timestamp && (!after || point.timestamp < after.timestamp)) {
        after = point;
      }
    }

    if (!before || !after || before.value === null || after.value === null) {
      return null;
    }

    const ratio = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
    return before.value + (after.value - before.value) * ratio;
  }

  private applyLimitOffset(points: AggregatedPoint[], query: TimeSeriesQuery): AggregatedPoint[] {
    let result = points;

    if (query.offset) {
      result = result.slice(query.offset);
    }

    if (query.limit) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  private inferResolution(points: AggregatedPoint[]): number {
    if (points.length < 2) {
      return 60000; // 1 minute default
    }

    const intervals = [];
    for (let i = 1; i < Math.min(points.length, 10); i++) {
      intervals.push(points[i].timestamp - points[i - 1].timestamp);
    }

    return intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  }

  private generateQueryWarnings(query: TimeSeriesQuery, points: AggregatedPoint[]): string[] {
    const warnings: string[] = [];

    if (points.length === 0) {
      warnings.push('No data found for the specified time range');
    }

    if (query.limit && points.length === query.limit) {
      warnings.push('Result set truncated due to limit');
    }

    const timeRange = query.endTime - query.startTime;
    if (timeRange > 86400000 * 30) { // 30 days
      warnings.push('Large time range may impact query performance');
    }

    return warnings;
  }

  private calculateStatistics(values: number[]): StatisticsData {
    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((s, v) => s + v, 0);
    const avg = sum / count;
    const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count;

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg,
      sum,
      stddev: Math.sqrt(variance),
      variance,
      percentiles: {
        'p50': this.calculatePercentile(values, 50),
        'p75': this.calculatePercentile(values, 75),
        'p90': this.calculatePercentile(values, 90),
        'p95': this.calculatePercentile(values, 95),
        'p99': this.calculatePercentile(values, 99)
      }
    };
  }

  private calculateDistribution(values: number[]): DistributionData {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    const bucketCount = Math.min(10, Math.ceil(Math.sqrt(values.length)));
    const bucketSize = range / bucketCount;

    const buckets: DistributionBucket[] = [];
    const outliers: OutlierData[] = [];

    // Create distribution buckets
    for (let i = 0; i < bucketCount; i++) {
      const bucketMin = min + i * bucketSize;
      const bucketMax = min + (i + 1) * bucketSize;
      const count = values.filter(v => v >= bucketMin && v < bucketMax).length;

      buckets.push({
        min: bucketMin,
        max: bucketMax,
        count,
        percentage: (count / values.length) * 100
      });
    }

    // Identify outliers (values beyond 2 standard deviations)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stddev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);

    for (const value of values) {
      const zscore = Math.abs((value - mean) / stddev);
      if (zscore > 2) {
        outliers.push({
          timestamp: Date.now(), // This should be the actual timestamp from the point
          value,
          zscore
        });
      }
    }

    return { buckets, outliers };
  }

  private calculateTrends(points: AggregatedPoint[]): TrendData {
    if (points.length < 2) {
      return {
        direction: 'stable',
        magnitude: 0,
        confidence: 0
      };
    }

    const values = points.filter(p => p.value !== null).map(p => p.value) as number[];
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const change = lastValue - firstValue;
    const percentChange = Math.abs(change) / firstValue * 100;

    return {
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
      magnitude: percentChange,
      confidence: Math.min(95, values.length * 5) // Simple confidence calculation
    };
  }

  private async evaluateAlertCondition(condition: AlertCondition, result: TimeSeriesResult): Promise<boolean> {
    if (result.points.length === 0) {
      return condition.type === 'absence';
    }

    const latestPoint = result.points[result.points.length - 1];

    switch (condition.type) {
      case 'threshold':
        if (!latestPoint.value || !condition.threshold || !condition.operator) {
          return false;
        }

        switch (condition.operator) {
          case 'greater_than':
            return latestPoint.value > condition.threshold;
          case 'less_than':
            return latestPoint.value < condition.threshold;
          case 'equals':
            return Math.abs(latestPoint.value - condition.threshold) < 0.01;
          case 'not_equals':
            return Math.abs(latestPoint.value - condition.threshold) >= 0.01;
          default:
            return false;
        }

      case 'change':
        // Implement change detection logic
        return false;

      case 'anomaly':
        // Implement anomaly detection logic
        return false;

      case 'absence':
        return result.points.length === 0;

      default:
        return false;
    }
  }

  private async triggerAlert(alert: TimeSeriesAlert, result: TimeSeriesResult): Promise<void> {
    alert.state.status = 'alerting';
    alert.state.lastAlert = new Date();
    alert.state.alertCount++;

    // Execute alert actions
    for (const action of alert.actions) {
      try {
        await this.executeAlertAction(action, alert, result);
      } catch (error) {
        logger.error(`Failed to execute alert action for ${alert.id}:`, error);
      }
    }

    logger.warn(`Alert triggered: ${alert.name}`, {
      alertId: alert.id,
      value: result.points[result.points.length - 1]?.value
    });
  }

  private async clearAlert(alert: TimeSeriesAlert): Promise<void> {
    if (alert.state.status === 'alerting') {
      alert.state.status = 'ok';
      alert.state.message = undefined;

      logger.info(`Alert cleared: ${alert.name}`, { alertId: alert.id });
    }
  }

  private async executeAlertAction(action: AlertAction, alert: TimeSeriesAlert, result: TimeSeriesResult): Promise<void> {
    switch (action.type) {
      case 'webhook':
        await this.sendWebhook(action.config, alert, result);
        break;
      case 'email':
        await this.sendEmail(action.config, alert, result);
        break;
      case 'slack':
        await this.sendSlackMessage(action.config, alert, result);
        break;
      default:
        logger.warn(`Unsupported alert action type: ${action.type}`);
    }
  }

  private async sendWebhook(config: Record<string, any>, alert: TimeSeriesAlert, result: TimeSeriesResult): Promise<void> {
    // Implement webhook sending
    logger.debug(`Sending webhook for alert: ${alert.name}`);
  }

  private async sendEmail(config: Record<string, any>, alert: TimeSeriesAlert, result: TimeSeriesResult): Promise<void> {
    // Implement email sending
    logger.debug(`Sending email for alert: ${alert.name}`);
  }

  private async sendSlackMessage(config: Record<string, any>, alert: TimeSeriesAlert, result: TimeSeriesResult): Promise<void> {
    // Implement Slack message sending
    logger.debug(`Sending Slack message for alert: ${alert.name}`);
  }

  private createEmptyResult(query: TimeSeriesQuery): TimeSeriesResult {
    return {
      metric: query.metric,
      points: [],
      metadata: {
        query,
        executionTime: 0,
        pointCount: 0,
        resolution: 0,
        aggregated: false,
        warnings: ['Query failed']
      }
    };
  }

  private parseTimeRange(time: string | number): number {
    if (typeof time === 'number') {
      return time;
    }

    // Parse relative time strings like "now-1h", "now-1d", etc.
    if (time === 'now') {
      return Date.now();
    }

    if (time.startsWith('now-')) {
      const duration = time.slice(4);
      const now = Date.now();

      if (duration.endsWith('m')) {
        return now - parseInt(duration) * 60000;
      } else if (duration.endsWith('h')) {
        return now - parseInt(duration) * 3600000;
      } else if (duration.endsWith('d')) {
        return now - parseInt(duration) * 86400000;
      }
    }

    // Try to parse as ISO date
    return new Date(time).getTime();
  }

  private async validateAlert(alert: TimeSeriesAlert): Promise<void> {
    if (!alert.id || !alert.name || !alert.query) {
      throw new Error('Alert ID, name, and query are required');
    }
  }

  private async validateDashboard(dashboard: MetricDashboard): Promise<void> {
    if (!dashboard.id || !dashboard.name || dashboard.panels.length === 0) {
      throw new Error('Dashboard ID, name, and panels are required');
    }
  }

  private async loadSchemas(): Promise<void> {
    // Load schemas from Redis
    logger.info('Loading time series schemas');
  }

  private async loadAlerts(): Promise<void> {
    // Load alerts from Redis
    logger.info('Loading time series alerts');
  }

  private async loadDashboards(): Promise<void> {
    // Load dashboards from Redis
    logger.info('Loading metric dashboards');
  }

  private async startBackgroundTasks(): Promise<void> {
    // Flush write buffer every 30 seconds
    this.flushInterval = setInterval(async () => {
      for (const metric of this.writeBuffer.keys()) {
        await this.flushMetric(metric);
      }
    }, 30000);

    // Evaluate alerts every minute
    this.alertInterval = setInterval(async () => {
      for (const alertId of this.alerts.keys()) {
        await this.executeAlert(alertId);
      }
    }, 60000);
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }

    // Flush remaining data
    for (const metric of this.writeBuffer.keys()) {
      await this.flushMetric(metric);
    }

    logger.info('TimeSeriesDatabase shutdown completed');
  }
}