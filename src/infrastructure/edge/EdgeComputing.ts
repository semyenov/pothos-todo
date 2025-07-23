import { logger } from '@/logger.js';
import { MetricsSystem } from '../observability/Metrics.js';
import { TelemetrySystem } from '../observability/Telemetry.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface EdgeLocation {
  id: string;
  region: string;
  provider: 'cloudflare' | 'fastly' | 'aws-cloudfront' | 'custom';
  endpoint: string;
  coordinates: { lat: number; lng: number };
  capacity: {
    compute: number; // vCPUs
    memory: number; // GB
    storage: number; // GB
  };
  status: 'active' | 'degraded' | 'offline';
  metrics?: EdgeMetrics;
}

export interface EdgeMetrics {
  requests: number;
  latency: { p50: number; p95: number; p99: number };
  errorRate: number;
  cacheHitRate: number;
  cpuUsage: number;
  memoryUsage: number;
  bandwidth: { in: number; out: number };
}

export interface EdgeFunction {
  id: string;
  name: string;
  runtime: 'v8' | 'webassembly' | 'node';
  code: string;
  triggers: EdgeTrigger[];
  config: {
    timeout: number;
    memory: number;
    environment: Record<string, string>;
  };
  deployments: Map<string, EdgeDeployment>;
}

export interface EdgeTrigger {
  type: 'request' | 'cron' | 'event';
  pattern?: string;
  schedule?: string;
  eventType?: string;
}

export interface EdgeDeployment {
  locationId: string;
  version: string;
  status: 'deploying' | 'active' | 'failed';
  deployedAt: Date;
  metrics?: EdgeFunctionMetrics;
}

export interface EdgeFunctionMetrics {
  invocations: number;
  duration: { mean: number; p95: number; p99: number };
  errors: number;
  coldStarts: number;
}

export interface EdgeRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  clientIp: string;
  location?: GeolocationData;
}

export interface GeolocationData {
  country: string;
  region: string;
  city: string;
  coordinates: { lat: number; lng: number };
  timezone: string;
}

export interface EdgeResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
  servedFrom: string;
  latency: number;
  cached: boolean;
}

/**
 * Edge Computing Infrastructure
 * Manages distributed edge computing nodes and functions
 */
export class EdgeComputingSystem extends EventEmitterSingletonService<EdgeComputingSystem> {
  private locations: Map<string, EdgeLocation> = new Map();
  private functions: Map<string, EdgeFunction> = new Map();
  private routingTable: Map<string, string[]> = new Map(); // region -> locationIds
  private metrics: MetricsSystem | null = null;
  private telemetry: TelemetrySystem | null = null;

  protected constructor() {
    super();
  }

  public async initialize(): Promise<void> {
    this.metrics = await MetricsSystem.getInstance();
    this.telemetry = await TelemetrySystem.getInstance();
    this.initializeEdgeLocations();
  }

  private ensureMetrics(): MetricsSystem {
    if (!this.metrics) {
      throw new Error('EdgeComputingSystem not initialized');
    }
    return this.metrics;
  }

  private ensureTelemetry(): TelemetrySystem {
    if (!this.telemetry) {
      throw new Error('EdgeComputingSystem not initialized');
    }
    return this.telemetry;
  }

  static async getInstance(): Promise<EdgeComputingSystem> {
    const instance = super.getInstance();
    if (!instance.metrics) {
      await instance.initialize();
    }
    return instance;
  }

  /**
   * Register an edge location
   */
  registerLocation(location: EdgeLocation): void {
    this.locations.set(location.id, location);
    
    // Update routing table
    const region = location.region;
    if (!this.routingTable.has(region)) {
      this.routingTable.set(region, []);
    }
    this.routingTable.get(region)!.push(location.id);

    logger.info(`Registered edge location: ${location.id} in ${location.region}`);
    this.emit('location:registered', location);
  }

  /**
   * Deploy function to edge locations
   */
  async deployFunction(
    func: EdgeFunction,
    targetLocations?: string[]
  ): Promise<Map<string, EdgeDeployment>> {
    const locations = targetLocations || Array.from(this.locations.keys());
    const deployments = new Map<string, EdgeDeployment>();

    await this.ensureTelemetry().traceAsync('edge.deploy_function', async () => {
      const deployPromises = locations.map(async (locationId) => {
        const location = this.locations.get(locationId);
        if (!location || location.status === 'offline') {
          return;
        }

        const deployment = await this.deployToLocation(func, location);
        deployments.set(locationId, deployment);
        func.deployments.set(locationId, deployment);
      });

      await Promise.all(deployPromises);
    });

    this.functions.set(func.id, func);
    this.emit('function:deployed', { function: func, deployments });

    logger.info(`Deployed function ${func.name} to ${deployments.size} locations`);
    return deployments;
  }

  /**
   * Execute function at optimal edge location
   */
  async executeFunction(
    functionId: string,
    request: EdgeRequest
  ): Promise<EdgeResponse> {
    const func = this.functions.get(functionId);
    if (!func) {
      throw new Error(`Function ${functionId} not found`);
    }

    // Find optimal location
    const location = await this.findOptimalLocation(request);
    if (!location) {
      throw new Error('No available edge location');
    }

    // Execute function
    return this.ensureTelemetry().traceAsync('edge.execute_function', async () => {
      const startTime = Date.now();
      
      try {
        const response = await this.executeAtLocation(func, request, location);
        
        // Record metrics
        this.ensureMetrics().record('apiLatency', (Date.now() - startTime) / 1000, {
          function: func.name,
          location: location.id,
          cached: response.cached,
        });

        return response;
      } catch (error) {
        // Fallback to next best location
        const fallbackLocation = await this.findFallbackLocation(request, location.id);
        if (fallbackLocation) {
          logger.warn(`Falling back to ${fallbackLocation.id} due to error at ${location.id}`);
          return this.executeAtLocation(func, request, fallbackLocation);
        }
        throw error;
      }
    });
  }

  /**
   * Handle GraphQL operations at edge
   */
  async handleGraphQLAtEdge(
    operation: {
      query: string;
      variables?: Record<string, any>;
      operationName?: string;
    },
    request: EdgeRequest
  ): Promise<EdgeResponse> {
    // Parse operation to determine cacheability
    const cacheKey = this.generateCacheKey(operation);
    const isCacheable = this.isQueryCacheable(operation.query);

    if (isCacheable) {
      // Check edge cache
      const cached = await this.checkEdgeCache(cacheKey, request);
      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }
    }

    // Execute at edge if possible
    const location = await this.findOptimalLocation(request);
    
    if (this.canExecuteAtEdge(operation)) {
      // Execute query at edge
      const response = await this.executeGraphQLAtEdge(operation, location);
      
      if (isCacheable) {
        await this.cacheAtEdge(cacheKey, response, location);
      }
      
      return response;
    } else {
      // Forward to origin
      return this.forwardToOrigin(operation, request, location);
    }
  }

  /**
   * Get edge performance analytics
   */
  async getPerformanceAnalytics(): Promise<{
    global: {
      totalRequests: number;
      avgLatency: number;
      cacheHitRate: number;
      errorRate: number;
    };
    byLocation: Map<string, EdgeMetrics>;
    byFunction: Map<string, EdgeFunctionMetrics>;
  }> {
    const analytics = {
      global: {
        totalRequests: 0,
        avgLatency: 0,
        cacheHitRate: 0,
        errorRate: 0,
      },
      byLocation: new Map<string, EdgeMetrics>(),
      byFunction: new Map<string, EdgeFunctionMetrics>(),
    };

    // Aggregate location metrics
    for (const [locationId, location] of this.locations) {
      if (location.metrics) {
        analytics.byLocation.set(locationId, location.metrics);
        analytics.global.totalRequests += location.metrics.requests;
      }
    }

    // Aggregate function metrics
    for (const [functionId, func] of this.functions) {
      const aggregated: EdgeFunctionMetrics = {
        invocations: 0,
        duration: { mean: 0, p95: 0, p99: 0 },
        errors: 0,
        coldStarts: 0,
      };

      for (const deployment of func.deployments.values()) {
        if (deployment.metrics) {
          aggregated.invocations += deployment.metrics.invocations;
          aggregated.errors += deployment.metrics.errors;
          aggregated.coldStarts += deployment.metrics.coldStarts;
        }
      }

      analytics.byFunction.set(functionId, aggregated);
    }

    // Calculate global averages
    const locationCount = analytics.byLocation.size;
    if (locationCount > 0) {
      let totalLatency = 0;
      let totalCacheHitRate = 0;
      let totalErrorRate = 0;

      for (const metrics of analytics.byLocation.values()) {
        totalLatency += metrics.latency.p50;
        totalCacheHitRate += metrics.cacheHitRate;
        totalErrorRate += metrics.errorRate;
      }

      analytics.global.avgLatency = totalLatency / locationCount;
      analytics.global.cacheHitRate = totalCacheHitRate / locationCount;
      analytics.global.errorRate = totalErrorRate / locationCount;
    }

    return analytics;
  }

  /**
   * Initialize edge locations
   */
  private initializeEdgeLocations(): void {
    // Register global edge locations
    const locations: EdgeLocation[] = [
      {
        id: 'edge-us-east',
        region: 'us-east',
        provider: 'cloudflare',
        endpoint: 'https://us-east.edge.example.com',
        coordinates: { lat: 40.7128, lng: -74.0060 }, // New York
        capacity: { compute: 100, memory: 256, storage: 1000 },
        status: 'active',
      },
      {
        id: 'edge-us-west',
        region: 'us-west',
        provider: 'cloudflare',
        endpoint: 'https://us-west.edge.example.com',
        coordinates: { lat: 37.7749, lng: -122.4194 }, // San Francisco
        capacity: { compute: 100, memory: 256, storage: 1000 },
        status: 'active',
      },
      {
        id: 'edge-eu-west',
        region: 'eu-west',
        provider: 'cloudflare',
        endpoint: 'https://eu-west.edge.example.com',
        coordinates: { lat: 51.5074, lng: -0.1278 }, // London
        capacity: { compute: 100, memory: 256, storage: 1000 },
        status: 'active',
      },
      {
        id: 'edge-ap-south',
        region: 'ap-south',
        provider: 'cloudflare',
        endpoint: 'https://ap-south.edge.example.com',
        coordinates: { lat: 1.3521, lng: 103.8198 }, // Singapore
        capacity: { compute: 100, memory: 256, storage: 1000 },
        status: 'active',
      },
      {
        id: 'edge-ap-northeast',
        region: 'ap-northeast',
        provider: 'cloudflare',
        endpoint: 'https://ap-northeast.edge.example.com',
        coordinates: { lat: 35.6762, lng: 139.6503 }, // Tokyo
        capacity: { compute: 100, memory: 256, storage: 1000 },
        status: 'active',
      },
    ];

    for (const location of locations) {
      this.registerLocation(location);
    }
  }

  /**
   * Deploy function to specific location
   */
  private async deployToLocation(
    func: EdgeFunction,
    location: EdgeLocation
  ): Promise<EdgeDeployment> {
    // Simulate deployment based on provider
    const deployment: EdgeDeployment = {
      locationId: location.id,
      version: `v${Date.now()}`,
      status: 'deploying',
      deployedAt: new Date(),
    };

    // In real implementation, would deploy to actual edge provider
    await this.simulateDeployment(func, location);
    
    deployment.status = 'active';
    return deployment;
  }

  /**
   * Find optimal edge location for request
   */
  private async findOptimalLocation(request: EdgeRequest): Promise<EdgeLocation | null> {
    // Get client location
    const clientLocation = request.location || (await this.geolocateIP(request.clientIp));
    
    // Find nearest active locations
    const activeLocations = Array.from(this.locations.values())
      .filter(loc => loc.status === 'active');

    if (activeLocations.length === 0) {
      return null;
    }

    // Calculate distances and scores
    const scored = activeLocations.map(location => {
      const distance = this.calculateDistance(
        clientLocation.coordinates,
        location.coordinates
      );

      // Factor in current load and performance
      const loadScore = location.metrics ? 
        (1 - location.metrics.cpuUsage / 100) * (1 - location.metrics.memoryUsage / 100) : 
        1;

      const latencyScore = location.metrics ?
        1 / (1 + location.metrics.latency.p50 / 100) :
        1;

      const score = (1 / (1 + distance / 1000)) * loadScore * latencyScore;

      return { location, score, distance };
    });

    // Sort by score and return best
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.location || null;
  }

  /**
   * Find fallback location
   */
  private async findFallbackLocation(
    request: EdgeRequest,
    excludeId: string
  ): Promise<EdgeLocation | null> {
    const locations = Array.from(this.locations.values())
      .filter(loc => loc.id !== excludeId && loc.status === 'active');

    if (locations.length === 0) {
      return null;
    }

    // Return random active location as fallback
    return locations[Math.floor(Math.random() * locations.length)];
  }

  /**
   * Execute function at specific location
   */
  private async executeAtLocation(
    func: EdgeFunction,
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<EdgeResponse> {
    const startTime = Date.now();

    // Simulate edge function execution
    const response = await this.simulateExecution(func, request, location);

    // Update metrics
    const deployment = func.deployments.get(location.id);
    if (deployment) {
      if (!deployment.metrics) {
        deployment.metrics = {
          invocations: 0,
          duration: { mean: 0, p95: 0, p99: 0 },
          errors: 0,
          coldStarts: 0,
        };
      }
      deployment.metrics.invocations++;
    }

    return {
      ...response,
      servedFrom: location.id,
      latency: Date.now() - startTime,
      cached: false,
    };
  }

  /**
   * Check if query can be executed at edge
   */
  private canExecuteAtEdge(operation: any): boolean {
    // Simple queries without mutations can run at edge
    const query = operation.query.toLowerCase();
    return !query.includes('mutation') && 
           !query.includes('subscription') &&
           !query.includes('@skip') &&
           !query.includes('@include');
  }

  /**
   * Execute GraphQL at edge
   */
  private async executeGraphQLAtEdge(
    operation: any,
    location: EdgeLocation
  ): Promise<EdgeResponse> {
    // In real implementation, would execute against edge data store
    return {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-served-by': location.id,
      },
      body: {
        data: {
          // Simulated response
          todos: [],
        },
      },
      servedFrom: location.id,
      latency: Math.random() * 50,
      cached: false,
    };
  }

  /**
   * Forward request to origin
   */
  private async forwardToOrigin(
    operation: any,
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<EdgeResponse> {
    // In real implementation, would forward to origin server
    return {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-by': location.id,
      },
      body: {
        data: {},
      },
      servedFrom: 'origin',
      latency: Math.random() * 200,
      cached: false,
    };
  }

  /**
   * Generate cache key for GraphQL operation
   */
  private generateCacheKey(operation: any): string {
    const { createHash } = require('crypto');
    const hash = createHash('sha256');
    hash.update(operation.query);
    hash.update(JSON.stringify(operation.variables || {}));
    return hash.digest('hex');
  }

  /**
   * Check if query is cacheable
   */
  private isQueryCacheable(query: string): boolean {
    const normalized = query.toLowerCase();
    return normalized.includes('query') && 
           !normalized.includes('mutation') &&
           !normalized.includes('subscription');
  }

  /**
   * Check edge cache
   */
  private async checkEdgeCache(
    key: string,
    request: EdgeRequest
  ): Promise<EdgeResponse | null> {
    // In real implementation, would check distributed cache
    return null;
  }

  /**
   * Cache response at edge
   */
  private async cacheAtEdge(
    key: string,
    response: EdgeResponse,
    location: EdgeLocation
  ): Promise<void> {
    // In real implementation, would store in edge cache
    logger.debug(`Cached response at ${location.id}`, { key });
  }

  /**
   * Geolocate IP address
   */
  private async geolocateIP(ip: string): Promise<GeolocationData> {
    // In real implementation, would use IP geolocation service
    return {
      country: 'US',
      region: 'us-east',
      city: 'New York',
      coordinates: { lat: 40.7128, lng: -74.0060 },
      timezone: 'America/New_York',
    };
  }

  /**
   * Calculate distance between coordinates
   */
  private calculateDistance(
    coord1: { lat: number; lng: number },
    coord2: { lat: number; lng: number }
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(coord2.lat - coord1.lat);
    const dLng = this.toRad(coord2.lng - coord1.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(coord1.lat)) * Math.cos(this.toRad(coord2.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Simulate deployment
   */
  private async simulateDeployment(
    func: EdgeFunction,
    location: EdgeLocation
  ): Promise<void> {
    // Simulate deployment delay
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Simulate function execution
   */
  private async simulateExecution(
    func: EdgeFunction,
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<Omit<EdgeResponse, 'servedFrom' | 'latency' | 'cached'>> {
    // Simulate execution
    return {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-function-id': func.id,
      },
      body: {
        message: `Executed ${func.name} at ${location.id}`,
        timestamp: new Date(),
      },
    };
  }
}