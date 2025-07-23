import { logger } from '@/logger.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { hash } from 'ohash';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'pathe';
import { SingletonService } from '../core/SingletonService.js';

export interface EdgeNode {
  id: string;
  name: string;
  location: {
    region: string;
    country: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  capabilities: {
    cpu: number; // cores
    memory: number; // GB
    storage: number; // GB
    gpu?: {
      model: string;
      memory: number; // GB
    };
    bandwidth: number; // Mbps
  };
  status: 'online' | 'offline' | 'degraded' | 'maintenance';
  load: {
    cpu: number; // percentage
    memory: number; // percentage
    storage: number; // percentage
    network: number; // percentage
  };
  services: string[]; // deployed service IDs
  latency: {
    toOrigin: number; // ms
    toUsers: Map<string, number>; // user region -> latency
  };
  health: {
    lastHeartbeat: Date;
    uptime: number; // seconds
    errorRate: number; // percentage
    requests: number;
  };
  deployment: {
    version: string;
    lastDeployed: Date;
    rolloutStatus: 'pending' | 'deploying' | 'completed' | 'failed' | 'rolling_back';
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeService {
  id: string;
  name: string;
  type: 'api' | 'static' | 'compute' | 'ml_inference' | 'cache';
  config: {
    image: string;
    replicas: number;
    resources: {
      cpu: string;
      memory: string;
      gpu?: boolean;
    };
    environment: Record<string, string>;
    healthCheck: {
      path: string;
      interval: number; // seconds
      timeout: number; // seconds
      retries: number;
    };
  };
  routing: {
    domains: string[];
    paths: string[];
    geo: {
      include?: string[]; // countries
      exclude?: string[]; // countries
    };
    conditions: Array<{
      type: 'header' | 'query' | 'user_agent' | 'ip_range';
      key?: string;
      value: string;
      operator: 'equals' | 'contains' | 'regex' | 'in_range';
    }>;
  };
  deployment: {
    strategy: 'rolling' | 'blue_green' | 'canary';
    targetNodes: string[]; // node IDs or 'auto'
    constraints: {
      minNodes: number;
      maxNodes: number;
      preferredRegions?: string[];
      requiresGPU?: boolean;
    };
  };
  monitoring: {
    metrics: string[];
    alerts: Array<{
      name: string;
      condition: string;
      threshold: number;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }>;
  };
  status: 'pending' | 'deploying' | 'running' | 'scaling' | 'error' | 'stopped';
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeRequest {
  id: string;
  serviceId: string;
  nodeId: string;
  userId?: string;
  userLocation?: {
    country: string;
    region: string;
    city: string;
  };
  method: string;
  path: string;
  headers: Record<string, string>;
  timestamp: Date;
  duration: number;
  statusCode: number;
  responseSize: number;
  cacheHit: boolean;
  error?: string;
}

export interface EdgeAnalytics {
  requests: {
    total: number;
    byNode: Map<string, number>;
    byService: Map<string, number>;
    byRegion: Map<string, number>;
  };
  performance: {
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    cacheHitRate: number;
    errorRate: number;
  };
  capacity: {
    totalNodes: number;
    healthyNodes: number;
    totalCPU: number;
    usedCPU: number;
    totalMemory: number;
    usedMemory: number;
  };
  geographic: {
    userDistribution: Map<string, number>; // country -> user count
    nodeDistribution: Map<string, number>; // region -> node count
    latencyByRegion: Map<string, number>; // region -> avg latency
  };
}

export class EdgeComputingManager extends SingletonService {
  private nodes = new Map<string, EdgeNode>();
  private services = new Map<string, EdgeService>();
  private requests: EdgeRequest[] = [];
  private metrics: MetricsCollector | null = null;
  private healthCheckInterval?: NodeJS.Timeout;
  private loadBalancingInterval?: NodeJS.Timeout;
  private analyticsInterval?: NodeJS.Timeout;

  // Request routing
  private requestQueue: Array<{
    request: any;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }> = [];

  protected constructor() {
    super();
  }

  public initialize(): void {
    this.metrics = MetricsCollector.getInstance();
    this.setupDefaultNodes();
    this.startHealthMonitoring();
    this.startLoadBalancing();
    this.startAnalytics();
  }

  private ensureMetrics(): MetricsCollector {
    if (!this.metrics) {
      throw new Error('EdgeComputingManager not initialized');
    }
    return this.metrics;
  }

  public static override getInstance(): EdgeComputingManager {
    const instance = super.getInstance();
    if (!instance) {
      throw new Error('EdgeComputingManager not initialized');
    }
    return instance as EdgeComputingManager;
  }

  /**
   * Register a new edge node
   */
  public async registerNode(
    name: string,
    location: EdgeNode['location'],
    capabilities: EdgeNode['capabilities']
  ): Promise<EdgeNode> {
    const nodeId = hash({ name, location, timestamp: Date.now() });

    const node: EdgeNode = {
      id: nodeId,
      name,
      location,
      capabilities,
      status: 'online',
      load: {
        cpu: 0,
        memory: 0,
        storage: 0,
        network: 0,
      },
      services: [],
      latency: {
        toOrigin: Math.random() * 100 + 10, // 10-110ms
        toUsers: new Map(),
      },
      health: {
        lastHeartbeat: new Date(),
        uptime: 0,
        errorRate: 0,
        requests: 0,
      },
      deployment: {
        version: '1.0.0',
        lastDeployed: new Date(),
        rolloutStatus: 'completed',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.nodes.set(nodeId, node);

    // Create node configuration directory
    const nodeDir = join(process.cwd(), 'edge', 'nodes', nodeId);
    if (!existsSync(nodeDir)) {
      mkdirSync(nodeDir, { recursive: true });
    }

    // Save node configuration
    const configPath = join(nodeDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(node, null, 2));

    logger.info('Edge node registered', {
      nodeId,
      name,
      location: `${location.city}, ${location.country}`,
      capabilities,
    });

    this.ensureMetrics().recordMetric('edge.node.registered', 1, {
      region: location.region,
      country: location.country,
    });

    return node;
  }

  /**
   * Deploy service to edge nodes
   */
  public async deployService(
    name: string,
    type: EdgeService['type'],
    config: EdgeService['config'],
    routing: EdgeService['routing'],
    deployment: EdgeService['deployment']
  ): Promise<EdgeService> {
    const serviceId = hash({ name, config, timestamp: Date.now() });

    const service: EdgeService = {
      id: serviceId,
      name,
      type,
      config,
      routing,
      deployment,
      monitoring: {
        metrics: ['requests', 'latency', 'errors', 'cpu', 'memory'],
        alerts: [
          {
            name: 'high_error_rate',
            condition: 'error_rate > threshold',
            threshold: 5,
            severity: 'high',
          },
          {
            name: 'high_latency',
            condition: 'p95_latency > threshold',
            threshold: 1000,
            severity: 'medium',
          },
        ],
      },
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.services.set(serviceId, service);

    // Start deployment process
    await this.deployServiceToNodes(service);

    logger.info('Edge service deployed', {
      serviceId,
      name,
      type,
      targetNodes: deployment.targetNodes.length,
    });

    this.ensureMetrics().recordMetric('edge.service.deployed', 1, {
      type,
      nodes: deployment.targetNodes.length.toString(),
    });

    return service;
  }

  /**
   * Route request to optimal edge node
   */
  public async routeRequest(
    serviceId: string,
    request: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body?: any;
      userId?: string;
      userLocation?: EdgeRequest['userLocation'];
    }
  ): Promise<{
    nodeId: string;
    response: any;
    duration: number;
    cacheHit: boolean;
  }> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    if (service.status !== 'running') {
      throw new Error(`Service ${serviceId} is not running`);
    }

    const startTime = Date.now();

    try {
      // Find optimal node
      const optimalNode = await this.findOptimalNode(service, request);

      if (!optimalNode) {
        throw new Error('No available nodes for service');
      }

      // Execute request on node
      const result = await this.executeRequestOnNode(optimalNode, service, request);

      const duration = Date.now() - startTime;

      // Record request
      const edgeRequest: EdgeRequest = {
        id: hash({ serviceId, request, timestamp: Date.now() }),
        serviceId,
        nodeId: optimalNode.id,
        userId: request.userId,
        userLocation: request.userLocation,
        method: request.method,
        path: request.path,
        headers: request.headers,
        timestamp: new Date(),
        duration,
        statusCode: result.statusCode,
        responseSize: JSON.stringify(result.response).length,
        cacheHit: result.cacheHit,
      };

      this.requests.push(edgeRequest);

      // Keep only recent requests (last 10000)
      if (this.requests.length > 10000) {
        this.requests = this.requests.slice(-10000);
      }

      // Update node metrics
      optimalNode.health.requests++;
      optimalNode.load.cpu = Math.min(100, optimalNode.load.cpu + 0.1);
      optimalNode.updatedAt = new Date();

      this.ensureMetrics().recordMetric('edge.request.routed', 1, {
        serviceId,
        nodeId: optimalNode.id,
        region: optimalNode.location.region,
        duration: duration.toString(),
        cacheHit: result.cacheHit.toString(),
      });

      return {
        nodeId: optimalNode.id,
        response: result.response,
        duration,
        cacheHit: result.cacheHit,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Edge request routing failed', error as Error, {
        serviceId,
        duration,
      });

      this.ensureMetrics().recordMetric('edge.request.error', 1, {
        serviceId,
        error: (error as Error).message,
        duration: duration.toString(),
      });

      throw error;
    }
  }

  /**
   * Scale service across edge nodes
   */
  public async scaleService(
    serviceId: string,
    targetReplicas: number,
    targetNodes?: string[]
  ): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    service.status = 'scaling';
    service.config.replicas = targetReplicas;

    if (targetNodes) {
      service.deployment.targetNodes = targetNodes;
    }

    service.updatedAt = new Date();

    // Simulate scaling process
    setTimeout(async () => {
      await this.deployServiceToNodes(service);
      service.status = 'running';

      logger.info('Service scaled', {
        serviceId,
        replicas: targetReplicas.toString() || 'unknown',
        nodes: service.deployment.targetNodes.length.toString() || 'unknown',
      });

      this.ensureMetrics().recordMetric('edge.service.scaled', 1, {
        serviceId,
        replicas: targetReplicas.toString() || 'unknown',
      });
    }, 2000);
  }

  /**
   * Get edge analytics
   */
  public async getEdgeAnalytics(timeRange?: {
    start: Date;
    end: Date;
  }): Promise<EdgeAnalytics> {
    const now = new Date();
    const start = timeRange?.start || new Date(now.getTime() - 3600000); // 1 hour ago
    const end = timeRange?.end || now;

    // Filter requests by time range
    const filteredRequests = this.requests.filter(
      req => req.timestamp >= start && req.timestamp <= end
    );

    // Calculate request metrics
    const totalRequests = filteredRequests.length;
    const requestsByNode = new Map<string, number>();
    const requestsByService = new Map<string, number>();
    const requestsByRegion = new Map<string, number>();

    for (const req of filteredRequests) {
      requestsByNode.set(req.nodeId, (requestsByNode.get(req.nodeId) || 0) + 1);
      requestsByService.set(req.serviceId, (requestsByService.get(req.serviceId) || 0) + 1);

      const node = this.nodes.get(req.nodeId);
      if (node) {
        const region = node.location.region;
        requestsByRegion.set(region, (requestsByRegion.get(region) || 0) + 1);
      }
    }

    // Calculate performance metrics
    const latencies = filteredRequests.map(req => req.duration);
    const averageLatency = latencies.length > 0 ?
      latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length : 0;

    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    const p95Latency = sortedLatencies[p95Index] || 0;
    const p99Latency = sortedLatencies[p99Index] || 0;

    const cacheHits = filteredRequests.filter(req => req.cacheHit).length;
    const cacheHitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;

    const errors = filteredRequests.filter(req => req.statusCode >= 400).length;
    const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

    // Calculate capacity metrics
    const allNodes = Array.from(this.nodes.values());
    const healthyNodes = allNodes.filter(node => node.status === 'online');
    const totalCPU = allNodes.reduce((sum, node) => sum + node.capabilities.cpu, 0);
    const usedCPU = allNodes.reduce((sum, node) => sum + (node.capabilities.cpu * node.load.cpu / 100), 0);
    const totalMemory = allNodes.reduce((sum, node) => sum + node.capabilities.memory, 0);
    const usedMemory = allNodes.reduce((sum, node) => sum + (node.capabilities.memory * node.load.memory / 100), 0);

    // Calculate geographic metrics
    const userDistribution = new Map<string, number>();
    const nodeDistribution = new Map<string, number>();
    const latencyByRegion = new Map<string, number>();

    for (const req of filteredRequests) {
      if (req.userLocation) {
        const country = req.userLocation.country;
        userDistribution.set(country, (userDistribution.get(country) || 0) + 1);
      }
    }

    for (const node of allNodes) {
      const region = node.location.region;
      nodeDistribution.set(region, (nodeDistribution.get(region) || 0) + 1);

      const regionRequests = filteredRequests.filter(req => {
        const reqNode = this.nodes.get(req.nodeId);
        return reqNode?.location.region === region;
      });

      if (regionRequests.length > 0) {
        const avgLatency = regionRequests.reduce((sum, req) => sum + req.duration, 0) / regionRequests.length;
        latencyByRegion.set(region, avgLatency);
      }
    }

    return {
      requests: {
        total: totalRequests,
        byNode: requestsByNode,
        byService: requestsByService,
        byRegion: requestsByRegion,
      },
      performance: {
        averageLatency,
        p95Latency,
        p99Latency,
        cacheHitRate,
        errorRate,
      },
      capacity: {
        totalNodes: allNodes.length,
        healthyNodes: healthyNodes.length,
        totalCPU,
        usedCPU,
        totalMemory,
        usedMemory,
      },
      geographic: {
        userDistribution,
        nodeDistribution,
        latencyByRegion,
      },
    };
  }

  /**
   * Get all edge nodes
   */
  public getNodes(): EdgeNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edge services
   */
  public getServices(): EdgeService[] {
    return Array.from(this.services.values());
  }

  /**
   * Setup default edge nodes
   */
  private setupDefaultNodes(): void {
    // US East
    this.registerNode('us-east-1', {
      region: 'us-east',
      country: 'US',
      city: 'New York',
      latitude: 40.7128,
      longitude: -74.0060,
    }, {
      cpu: 16,
      memory: 64,
      storage: 1000,
      bandwidth: 1000,
      gpu: {
        model: 'NVIDIA T4',
        memory: 16,
      },
    });

    // US West
    this.registerNode('us-west-1', {
      region: 'us-west',
      country: 'US',
      city: 'San Francisco',
      latitude: 37.7749,
      longitude: -122.4194,
    }, {
      cpu: 16,
      memory: 64,
      storage: 1000,
      bandwidth: 1000,
    });

    // Europe
    this.registerNode('eu-west-1', {
      region: 'eu-west',
      country: 'IE',
      city: 'Dublin',
      latitude: 53.3498,
      longitude: -6.2603,
    }, {
      cpu: 8,
      memory: 32,
      storage: 500,
      bandwidth: 500,
    });

    // Asia Pacific
    this.registerNode('ap-southeast-1', {
      region: 'ap-southeast',
      country: 'SG',
      city: 'Singapore',
      latitude: 1.3521,
      longitude: 103.8198,
    }, {
      cpu: 8,
      memory: 32,
      storage: 500,
      bandwidth: 500,
    });

    logger.info('Default edge nodes created');
  }

  /**
   * Deploy service to selected nodes
   */
  private async deployServiceToNodes(service: EdgeService): Promise<void> {
    service.status = 'deploying';

    // Determine target nodes
    let targetNodes: EdgeNode[];

    if (service.deployment.targetNodes.includes('auto')) {
      targetNodes = await this.selectOptimalNodes(service);
    } else {
      targetNodes = service.deployment.targetNodes
        .map(nodeId => this.nodes.get(nodeId))
        .filter((node): node is EdgeNode => node !== undefined);
    }

    // Simulate deployment to each node
    const deploymentPromises = targetNodes.map(async (node) => {
      // Simulate deployment time
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

      // Add service to node
      if (!node.services.includes(service.id)) {
        node.services.push(service.id);
      }

      // Update node load
      node.load.cpu = Math.min(100, node.load.cpu + 5);
      node.load.memory = Math.min(100, node.load.memory + 10);
      node.updatedAt = new Date();

      logger.debug('Service deployed to node', {
        serviceId: service.id,
        nodeId: node.id,
        location: `${node.location.city}, ${node.location.country}`,
      });
    });

    await Promise.all(deploymentPromises);

    service.status = 'running';
    service.deployment.targetNodes = targetNodes.map(node => node.id);
    service.updatedAt = new Date();

    logger.info('Service deployment completed', {
      serviceId: service.id,
      nodes: targetNodes.length,
      regions: [...new Set(targetNodes.map(node => node.location.region))],
    });
  }

  /**
   * Select optimal nodes for service deployment
   */
  private async selectOptimalNodes(service: EdgeService): Promise<EdgeNode[]> {
    const availableNodes = Array.from(this.nodes.values())
      .filter(node => node.status === 'online')
      .filter(node => {
        // Check resource requirements
        const cpuRequired = parseInt(service.config.resources.cpu.replace('m', '')) / 1000;
        const memoryRequired = parseInt(service.config.resources.memory.replace('Mi', ''));

        const availableCpu = node.capabilities.cpu * (1 - node.load.cpu / 100);
        const availableMemory = node.capabilities.memory * 1024 * (1 - node.load.memory / 100);

        return availableCpu >= cpuRequired && availableMemory >= memoryRequired;
      })
      .filter(node => {
        // Check GPU requirement
        if (service.config.resources.gpu) {
          return !!node.capabilities.gpu;
        }
        return true;
      });

    // Score nodes based on multiple factors
    const scoredNodes = availableNodes.map(node => {
      let score = 0;

      // Lower load is better
      score += (100 - node.load.cpu) * 0.3;
      score += (100 - node.load.memory) * 0.3;

      // Lower latency is better
      score += Math.max(0, 200 - node.latency.toOrigin) * 0.2;

      // Prefer nodes in preferred regions
      if (service.deployment.constraints.preferredRegions?.includes(node.location.region)) {
        score += 20;
      }

      // Higher uptime is better
      score += Math.min(node.health.uptime / 86400, 30) * 0.2; // Max 30 days contribution

      return { node, score };
    });

    // Sort by score and select top nodes
    scoredNodes.sort((a, b) => b.score - a.score);

    const targetCount = Math.min(
      service.config.replicas,
      Math.max(service.deployment.constraints.minNodes, scoredNodes.length)
    );

    return scoredNodes.slice(0, targetCount).map(item => item.node);
  }

  /**
   * Find optimal node for request routing
   */
  private async findOptimalNode(
    service: EdgeService,
    request: any
  ): Promise<EdgeNode | null> {
    // Get nodes running this service
    const serviceNodes = Array.from(this.nodes.values())
      .filter(node => node.services.includes(service.id))
      .filter(node => node.status === 'online');

    if (serviceNodes.length === 0) {
      return null;
    }

    // Filter by geographic constraints
    let eligibleNodes = serviceNodes;

    if (request.userLocation) {
      const userCountry = request.userLocation.country;

      if (service.routing.geo.include?.length) {
        eligibleNodes = eligibleNodes.filter(node =>
          service.routing.geo.include!.includes(node.location.country)
        );
      }

      if (service.routing.geo.exclude?.length) {
        eligibleNodes = eligibleNodes.filter(node =>
          !service.routing.geo.exclude!.includes(node.location.country)
        );
      }
    }

    // Filter by routing conditions
    for (const condition of service.routing.conditions) {
      eligibleNodes = eligibleNodes.filter(node =>
        this.evaluateRoutingCondition(condition, request, node)
      );
    }

    if (eligibleNodes.length === 0) {
      // Fall back to any available node if no nodes match conditions
      eligibleNodes = serviceNodes;
    }

    // Score nodes for routing
    const scoredNodes = eligibleNodes.map(node => {
      let score = 0;

      // Lower load is better for routing
      score += (100 - node.load.cpu) * 0.4;
      score += (100 - node.load.network) * 0.3;

      // Geographic proximity
      if (request.userLocation) {
        const userCountry = request.userLocation.country;
        const userLatency = node.latency.toUsers.get(userCountry) || node.latency.toOrigin;
        score += Math.max(0, 300 - userLatency) * 0.3;
      }

      return { node, score };
    });

    // Return node with highest score
    scoredNodes.sort((a, b) => b.score - a.score);
    return scoredNodes[0]?.node || null;
  }

  /**
   * Execute request on edge node
   */
  private async executeRequestOnNode(
    node: EdgeNode,
    service: EdgeService,
    request: any
  ): Promise<{
    response: any;
    statusCode: number;
    cacheHit: boolean;
  }> {
    // Simulate request execution
    const executionTime = Math.random() * 200 + 50; // 50-250ms
    await new Promise(resolve => setTimeout(resolve, executionTime));

    // Simulate cache hit/miss
    const cacheHit = Math.random() < 0.7; // 70% cache hit rate

    // Simulate response
    const response = {
      data: `Response from ${node.name} (${node.location.city})`,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      serviceId: service.id,
      cached: cacheHit,
    };

    // Simulate occasional errors
    const statusCode = Math.random() < 0.95 ? 200 : 500;

    return {
      response,
      statusCode,
      cacheHit,
    };
  }

  /**
   * Evaluate routing condition
   */
  private evaluateRoutingCondition(
    condition: EdgeService['routing']['conditions'][0],
    request: any,
    node: EdgeNode
  ): boolean {
    switch (condition.type) {
      case 'header':
        const headerValue = request.headers[condition.key!];
        return this.evaluateValue(headerValue, condition.value, condition.operator);

      case 'query':
        // Simulate query parameter check
        return Math.random() > 0.5;

      case 'user_agent':
        const userAgent = request.headers['user-agent'] || '';
        return this.evaluateValue(userAgent, condition.value, condition.operator);

      case 'ip_range':
        // Simulate IP range check
        return Math.random() > 0.3;

      default:
        return true;
    }
  }

  /**
   * Evaluate condition value
   */
  private evaluateValue(actual: string, expected: string, operator: string): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'contains':
        return actual.includes(expected);
      case 'regex':
        return new RegExp(expected).test(actual);
      default:
        return true;
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const [nodeId, node] of this.nodes.entries()) {
        // Simulate health check
        const isHealthy = Math.random() > 0.05; // 95% uptime

        if (isHealthy) {
          node.status = 'online';
          node.health.lastHeartbeat = new Date();
          node.health.uptime += 30; // 30 seconds

          // Simulate load fluctuation
          node.load.cpu = Math.max(0, Math.min(100, node.load.cpu + (Math.random() - 0.5) * 10));
          node.load.memory = Math.max(0, Math.min(100, node.load.memory + (Math.random() - 0.5) * 5));
          node.load.network = Math.max(0, Math.min(100, node.load.network + (Math.random() - 0.5) * 15));

        } else {
          node.status = 'degraded';
          node.health.errorRate = Math.min(100, node.health.errorRate + 5);
        }

        node.updatedAt = new Date();
      }

      // Log health summary
      const healthyNodes = Array.from(this.nodes.values()).filter(n => n.status === 'online').length;
      logger.debug('Edge health check completed', {
        totalNodes: this.nodes.size,
        healthyNodes,
        degradedNodes: this.nodes.size - healthyNodes,
      });

    }, 30000); // Every 30 seconds
  }

  /**
   * Start load balancing optimization
   */
  private startLoadBalancing(): void {
    this.loadBalancingInterval = setInterval(async () => {
      // Check for overloaded nodes and rebalance services
      const overloadedNodes = Array.from(this.nodes.values())
        .filter(node => node.load.cpu > 80 || node.load.memory > 85);

      if (overloadedNodes.length > 0) {
        logger.info('Rebalancing load across edge nodes', {
          overloadedNodes: overloadedNodes.length,
        });

        // In production, implement actual load rebalancing logic
        for (const node of overloadedNodes) {
          node.load.cpu = Math.max(50, node.load.cpu - 10);
          node.load.memory = Math.max(40, node.load.memory - 15);
        }
      }

    }, 120000); // Every 2 minutes
  }

  /**
   * Start analytics collection
   */
  private startAnalytics(): void {
    this.analyticsInterval = setInterval(async () => {
      const analytics = await this.getEdgeAnalytics();

      // Record key metrics
      this.ensureMetrics().recordMetric('edge.analytics.total_requests', analytics.requests.total);
      this.ensureMetrics().recordMetric('edge.analytics.average_latency', analytics.performance.averageLatency);
      this.ensureMetrics().recordMetric('edge.analytics.cache_hit_rate', analytics.performance.cacheHitRate);
      this.ensureMetrics().recordMetric('edge.analytics.error_rate', analytics.performance.errorRate);
      this.ensureMetrics().recordMetric('edge.analytics.healthy_nodes', analytics.capacity.healthyNodes);
      this.ensureMetrics().recordMetric('edge.analytics.cpu_utilization',
        analytics.capacity.totalCPU > 0 ? (analytics.capacity.usedCPU / analytics.capacity.totalCPU) * 100 : 0
      );

      logger.debug('Edge analytics collected', {
        totalRequests: analytics.requests.total,
        averageLatency: analytics.performance.averageLatency,
        healthyNodes: analytics.capacity.healthyNodes,
      });

    }, 300000); // Every 5 minutes
  }

  /**
   * Generate edge deployment configuration
   */
  public generateDeploymentConfig(): string {
    const config = {
      nodes: Array.from(this.nodes.values()).map(node => ({
        id: node.id,
        name: node.name,
        location: node.location,
        capabilities: node.capabilities,
        status: node.status,
      })),
      services: Array.from(this.services.values()).map(service => ({
        id: service.id,
        name: service.name,
        type: service.type,
        config: service.config,
        routing: service.routing,
        deployment: service.deployment,
        status: service.status,
      })),
      generatedAt: new Date().toISOString(),
    };

    // Save configuration
    const configDir = join(process.cwd(), 'edge', 'deployments');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const configFile = join(configDir, `deployment-${Date.now()}.json`);
    writeFileSync(configFile, JSON.stringify(config, null, 2));

    logger.info('Edge deployment configuration generated', {
      file: configFile,
      nodes: config.nodes.length,
      services: config.services.length,
    });

    return configFile;
  }

  /**
   * Shutdown edge computing manager
   */
  public shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    if (this.loadBalancingInterval) {
      clearInterval(this.loadBalancingInterval);
      this.loadBalancingInterval = undefined;
    }

    if (this.analyticsInterval) {
      clearInterval(this.analyticsInterval);
      this.analyticsInterval = undefined;
    }

    this.nodes.clear();
    this.services.clear();
    this.requests = [];
    this.requestQueue = [];

    logger.info('Edge computing manager shutdown completed');
  }
}

/**
 * Edge computing middleware
 */
export function createEdgeMiddleware() {
  const edgeManager = EdgeComputingManager.getInstance();

  return (context: any) => {
    // Add edge context
    context.edge = {
      routeRequest: edgeManager.routeRequest.bind(edgeManager),
      deployService: edgeManager.deployService.bind(edgeManager),
      scaleService: edgeManager.scaleService.bind(edgeManager),
      getAnalytics: edgeManager.getEdgeAnalytics.bind(edgeManager),
      getNodes: edgeManager.getNodes.bind(edgeManager),
      getServices: edgeManager.getServices.bind(edgeManager),
    };
  };
}