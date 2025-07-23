import { EventEmitter } from 'events';
import { logger } from '@/logger.js';
import { MetricsSystem } from './Metrics.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface AnomalyDetectorConfig {
  windowSize: number; // Number of data points to consider
  sensitivity: number; // 0-1, higher = more sensitive
  algorithms: Array<'zscore' | 'mad' | 'isolation-forest' | 'lstm'>;
  checkInterval: number; // ms
}

export interface Anomaly {
  id: string;
  metric: string;
  timestamp: Date;
  value: number;
  expectedRange: { min: number; max: number };
  severity: 'low' | 'medium' | 'high' | 'critical';
  algorithm: string;
  confidence: number;
  context?: Record<string, any>;
}

export interface TimeSeriesData {
  timestamp: Date;
  value: number;
  metadata?: Record<string, any>;
}

/**
 * Advanced Anomaly Detection System
 */
export class AnomalyDetectionSystem extends EventEmitterSingletonService<AnomalyDetectionSystem> {
  private config: AnomalyDetectorConfig;
  private metricBuffers: Map<string, TimeSeriesData[]> = new Map();
  private detectors: Map<string, AnomalyDetector> = new Map();
  private checkInterval?: NodeJS.Timeout;
  private anomalyHistory: Anomaly[] = [];

  protected constructor() {
    super();
    this.config = {
      windowSize: 100,
      sensitivity: 0.95,
      algorithms: ['zscore', 'mad'],
      checkInterval: 60000, // 1 minute
    };
  }

  static initialize(config?: Partial<AnomalyDetectorConfig>): AnomalyDetectionSystem {
    const instance = super.getInstance();
    if (config) {
      instance.configure(config);
    }
    return instance;
  }

  static getInstance(): AnomalyDetectionSystem {
    return super.getInstance();
  }

  /**
   * Configure the AnomalyDetectionSystem with settings
   */
  public configure(config: Partial<AnomalyDetectorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Register a metric for anomaly detection
   */
  registerMetric(
    metricName: string,
    options: {
      expectedRange?: { min: number; max: number };
      seasonality?: 'hourly' | 'daily' | 'weekly';
      customDetector?: AnomalyDetector;
    } = {}
  ): void {
    if (!this.metricBuffers.has(metricName)) {
      this.metricBuffers.set(metricName, []);
    }

    const detector = options.customDetector || 
      new CompositeAnomalyDetector(this.config, options);
    
    this.detectors.set(metricName, detector);
    
    logger.info(`Registered metric ${metricName} for anomaly detection`);
  }

  /**
   * Add data point for a metric
   */
  addDataPoint(metricName: string, value: number, metadata?: Record<string, any>): void {
    const buffer = this.metricBuffers.get(metricName);
    if (!buffer) {
      logger.warn(`Metric ${metricName} not registered for anomaly detection`);
      return;
    }

    const dataPoint: TimeSeriesData = {
      timestamp: new Date(),
      value,
      metadata,
    };

    buffer.push(dataPoint);

    // Keep only the required window size
    if (buffer.length > this.config.windowSize * 2) {
      buffer.splice(0, buffer.length - this.config.windowSize);
    }

    // Check for anomalies immediately for critical metrics
    if (metadata?.critical) {
      this.checkMetricForAnomalies(metricName);
    }
  }

  /**
   * Start automated anomaly detection
   */
  start(): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      this.checkAllMetrics();
    }, this.config.checkInterval);

    logger.info('Anomaly detection system started');
  }

  /**
   * Stop anomaly detection
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    logger.info('Anomaly detection system stopped');
  }

  /**
   * Check all metrics for anomalies
   */
  private async checkAllMetrics(): Promise<void> {
    for (const [metricName, buffer] of this.metricBuffers) {
      if (buffer.length >= this.config.windowSize) {
        await this.checkMetricForAnomalies(metricName);
      }
    }
  }

  /**
   * Check a specific metric for anomalies
   */
  private async checkMetricForAnomalies(metricName: string): Promise<void> {
    const buffer = this.metricBuffers.get(metricName);
    const detector = this.detectors.get(metricName);

    if (!buffer || !detector || buffer.length < 10) {
      return;
    }

    const recentData = buffer.slice(-this.config.windowSize);
    const anomalies = await detector.detect(recentData);

    for (const anomaly of anomalies) {
      this.handleAnomaly({
        ...anomaly,
        metric: metricName,
        id: `${metricName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      });
    }
  }

  /**
   * Handle detected anomaly
   */
  private handleAnomaly(anomaly: Anomaly): void {
    // Add to history
    this.anomalyHistory.push(anomaly);
    if (this.anomalyHistory.length > 1000) {
      this.anomalyHistory.shift();
    }

    // Emit event
    this.emit('anomaly', anomaly);

    // Log based on severity
    const logMessage = `Anomaly detected in ${anomaly.metric}: value=${anomaly.value}, expected=${anomaly.expectedRange.min}-${anomaly.expectedRange.max}`;
    
    switch (anomaly.severity) {
      case 'critical':
        logger.error(logMessage, anomaly);
        break;
      case 'high':
        logger.warn(logMessage, anomaly);
        break;
      default:
        logger.info(logMessage, anomaly);
    }

    // Record anomaly metric
    const metrics = MetricsSystem.getInstance();
    metrics.record('apiErrors', 1, {
      type: 'anomaly',
      metric: anomaly.metric,
      severity: anomaly.severity,
    });
  }

  /**
   * Get anomaly history
   */
  getAnomalyHistory(
    filter?: {
      metric?: string;
      severity?: string;
      since?: Date;
    }
  ): Anomaly[] {
    let history = [...this.anomalyHistory];

    if (filter?.metric) {
      history = history.filter(a => a.metric === filter.metric);
    }
    if (filter?.severity) {
      history = history.filter(a => a.severity === filter.severity);
    }
    if (filter?.since) {
      history = history.filter(a => a.timestamp >= filter.since);
    }

    return history;
  }

  /**
   * Get current metric statistics
   */
  getMetricStats(metricName: string): any {
    const buffer = this.metricBuffers.get(metricName);
    if (!buffer || buffer.length === 0) {
      return null;
    }

    const values = buffer.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    
    return {
      count: values.length,
      mean,
      median: sorted[Math.floor(sorted.length / 2)],
      min: Math.min(...values),
      max: Math.max(...values),
      stdDev: Math.sqrt(
        values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length
      ),
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }
}

/**
 * Base Anomaly Detector interface
 */
export interface AnomalyDetector {
  detect(data: TimeSeriesData[]): Promise<Anomaly[]>;
}

/**
 * Z-Score based anomaly detector
 */
export class ZScoreDetector implements AnomalyDetector {
  constructor(
    private threshold: number = 3,
    private minDataPoints: number = 30
  ) {}

  async detect(data: TimeSeriesData[]): Promise<Anomaly[]> {
    if (data.length < this.minDataPoints) {
      return [];
    }

    const values = data.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length
    );

    const anomalies: Anomaly[] = [];
    const latest = data[data.length - 1];
    const zScore = Math.abs((latest.value - mean) / stdDev);

    if (zScore > this.threshold) {
      anomalies.push({
        id: '',
        metric: '',
        timestamp: latest.timestamp,
        value: latest.value,
        expectedRange: {
          min: mean - (this.threshold * stdDev),
          max: mean + (this.threshold * stdDev),
        },
        severity: this.calculateSeverity(zScore),
        algorithm: 'zscore',
        confidence: Math.min(zScore / 10, 1),
        context: latest.metadata,
      });
    }

    return anomalies;
  }

  private calculateSeverity(zScore: number): Anomaly['severity'] {
    if (zScore > 6) return 'critical';
    if (zScore > 4) return 'high';
    if (zScore > 3) return 'medium';
    return 'low';
  }
}

/**
 * MAD (Median Absolute Deviation) based detector
 */
export class MADDetector implements AnomalyDetector {
  constructor(
    private threshold: number = 3.5,
    private minDataPoints: number = 30
  ) {}

  async detect(data: TimeSeriesData[]): Promise<Anomaly[]> {
    if (data.length < this.minDataPoints) {
      return [];
    }

    const values = data.map(d => d.value);
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    const deviations = values.map(v => Math.abs(v - median));
    const madSorted = [...deviations].sort((a, b) => a - b);
    const mad = madSorted[Math.floor(madSorted.length / 2)];
    
    const anomalies: Anomaly[] = [];
    const latest = data[data.length - 1];
    const modifiedZScore = 0.6745 * (latest.value - median) / mad;

    if (Math.abs(modifiedZScore) > this.threshold) {
      anomalies.push({
        id: '',
        metric: '',
        timestamp: latest.timestamp,
        value: latest.value,
        expectedRange: {
          min: median - (this.threshold * mad / 0.6745),
          max: median + (this.threshold * mad / 0.6745),
        },
        severity: this.calculateSeverity(Math.abs(modifiedZScore)),
        algorithm: 'mad',
        confidence: Math.min(Math.abs(modifiedZScore) / 10, 1),
        context: latest.metadata,
      });
    }

    return anomalies;
  }

  private calculateSeverity(score: number): Anomaly['severity'] {
    if (score > 7) return 'critical';
    if (score > 5) return 'high';
    if (score > 3.5) return 'medium';
    return 'low';
  }
}

/**
 * Composite detector that uses multiple algorithms
 */
export class CompositeAnomalyDetector implements AnomalyDetector {
  private detectors: AnomalyDetector[] = [];

  constructor(
    config: AnomalyDetectorConfig,
    options: any = {}
  ) {
    if (config.algorithms.includes('zscore')) {
      this.detectors.push(new ZScoreDetector());
    }
    if (config.algorithms.includes('mad')) {
      this.detectors.push(new MADDetector());
    }
    // Add more detectors as needed
  }

  async detect(data: TimeSeriesData[]): Promise<Anomaly[]> {
    const allAnomalies = await Promise.all(
      this.detectors.map(d => d.detect(data))
    );

    // Combine and deduplicate anomalies
    const anomalyMap = new Map<string, Anomaly>();
    
    for (const anomalies of allAnomalies) {
      for (const anomaly of anomalies) {
        const key = `${anomaly.timestamp.getTime()}_${anomaly.value}`;
        const existing = anomalyMap.get(key);
        
        if (!existing || existing.confidence < anomaly.confidence) {
          anomalyMap.set(key, anomaly);
        }
      }
    }

    return Array.from(anomalyMap.values());
  }
}