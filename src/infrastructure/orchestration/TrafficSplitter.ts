import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { ServiceDiscovery } from './ServiceDiscovery.js';
import { logger } from '@/lib/unjs-utils.js';

interface TrafficSplit {
  id: string;
  service: string;
  splits: Array<{
    version: string;
    weight: number;
    headers?: Record<string, string>;
    condition?: string;
  }>;
  metrics: {
    totalRequests: number;
    splitCounts: Record<string, number>;
  };
}

interface SplitterEventMap {
  'traffic:split': { service: string; version: string; request: any };
  'split:updated': { splitId: string; changes: Partial<TrafficSplit> };
}

export class TrafficSplitter extends TypedEventEmitter<SplitterEventMap> {
  private static instance: TrafficSplitter;
  private discovery: ServiceDiscovery;
  private splits = new Map<string, TrafficSplit>();

  private constructor() {
    super();
    this.discovery = ServiceDiscovery.getInstance();
  }

  static getInstance(): TrafficSplitter {
    if (!TrafficSplitter.instance) {
      TrafficSplitter.instance = new TrafficSplitter();
    }
    return TrafficSplitter.instance;
  }

  createSplit(split: Omit<TrafficSplit, 'id' | 'metrics'>): string {
    const id = `split-${split.service}-${Date.now()}`;
    const fullSplit: TrafficSplit = {
      ...split,
      id,
      metrics: { totalRequests: 0, splitCounts: {} }
    };

    // Validate weights sum to 100
    const totalWeight = split.splits.reduce((sum, s) => sum + s.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw new Error(`Traffic split weights must sum to 100, got ${totalWeight}`);
    }

    this.splits.set(id, fullSplit);
    logger.info(`Traffic split created for ${split.service}: ${split.splits.map(s => `${s.version}(${s.weight}%)`).join(', ')}`);
    return id;
  }

  routeRequest(service: string, request: any): string {
    const split = Array.from(this.splits.values()).find(s => s.service === service);
    if (!split) {
      return 'v1'; // Default version
    }

    split.metrics.totalRequests++;

    // Check for header-based routing first
    for (const splitConfig of split.splits) {
      if (splitConfig.headers) {
        const matches = Object.entries(splitConfig.headers).every(([key, value]) => 
          request.headers?.[key] === value
        );
        if (matches) {
          split.metrics.splitCounts[splitConfig.version] = (split.metrics.splitCounts[splitConfig.version] || 0) + 1;
          this.emit('traffic:split', { service, version: splitConfig.version, request });
          return splitConfig.version;
        }
      }
    }

    // Weight-based routing
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const splitConfig of split.splits) {
      cumulative += splitConfig.weight;
      if (random <= cumulative) {
        split.metrics.splitCounts[splitConfig.version] = (split.metrics.splitCounts[splitConfig.version] || 0) + 1;
        this.emit('traffic:split', { service, version: splitConfig.version, request });
        return splitConfig.version;
      }
    }

    // Fallback to first version
    const fallback = split.splits[0].version;
    split.metrics.splitCounts[fallback] = (split.metrics.splitCounts[fallback] || 0) + 1;
    return fallback;
  }

  updateSplit(splitId: string, updates: Partial<Pick<TrafficSplit, 'splits'>>): void {
    const split = this.splits.get(splitId);
    if (!split) {
      throw new Error(`Traffic split not found: ${splitId}`);
    }

    if (updates.splits) {
      const totalWeight = updates.splits.reduce((sum, s) => sum + s.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error(`Traffic split weights must sum to 100, got ${totalWeight}`);
      }
      split.splits = updates.splits;
    }

    this.emit('split:updated', { splitId, changes: updates });
    logger.info(`Traffic split updated: ${splitId}`);
  }

  getSplitMetrics(service: string): TrafficSplit['metrics'] | null {
    const split = Array.from(this.splits.values()).find(s => s.service === service);
    return split?.metrics || null;
  }

  getAllSplits(): TrafficSplit[] {
    return Array.from(this.splits.values());
  }
}