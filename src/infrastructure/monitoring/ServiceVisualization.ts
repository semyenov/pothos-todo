import { EnhancedServiceRegistry } from '../core/ServiceRegistry.enhanced.js';
import { ServiceDependencyGraph } from '../orchestration/ServiceDependencyGraph.js';
import { ServiceHealthMonitor } from '../core/ServiceHealthMonitor.js';
import { ServiceMetrics } from '../core/ServiceMetrics.js';
import { ServiceTracing } from '../core/ServiceTracing.js';
import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { logger } from '@/lib/unjs-utils.js';

export interface VisualizationNode {
  id: string;
  label: string;
  type: 'service' | 'capability' | 'dependency-group';
  status: 'healthy' | 'degraded' | 'unhealthy' | 'stopped' | 'starting';
  metadata: {
    version?: string;
    uptime?: number;
    capabilities?: string[];
    dependencies?: string[];
    critical?: boolean;
    level?: number;
  };
  position?: { x: number; y: number };
  metrics?: {
    cpu?: number;
    memory?: number;
    requests?: number;
    errors?: number;
    latency?: number;
  };
}

export interface VisualizationEdge {
  id: string;
  from: string;
  to: string;
  type: 'dependency' | 'communication' | 'health-check';
  label?: string;
  weight?: number;
  status: 'active' | 'inactive' | 'failed';
  metadata?: {
    required?: boolean;
    optional?: boolean;
    latency?: number;
    throughput?: number;
    errorRate?: number;
  };
}

export interface DependencyGraphData {
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  layout: 'hierarchical' | 'force' | 'circular' | 'tree';
  metadata: {
    totalServices: number;
    healthyServices: number;
    criticalPath: string[];
    bottlenecks: string[];
    lastUpdated: Date;
  };
}

export interface RealTimeMetrics {
  timestamp: Date;
  services: Map<string, {
    health: 'healthy' | 'degraded' | 'unhealthy';
    metrics: {
      requestsPerSecond: number;
      averageLatency: number;
      errorRate: number;
      cpuUsage: number;
      memoryUsage: number;
    };
    incidents: number;
    uptime: number;
  }>;
  system: {
    totalRequests: number;
    averageLatency: number;
    errorRate: number;
    availability: number;
  };
}

interface VisualizationEventMap {
  'graph:updated': {
    timestamp: Date;
    nodes: number;
    edges: number;
  };
  'metrics:updated': {
    timestamp: Date;
    services: number;
  };
  'alert:triggered': {
    service: string;
    type: 'performance' | 'health' | 'dependency';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
  };
  'visualization:export': {
    format: 'json' | 'svg' | 'png' | 'dot';
    size: number;
  };
}

/**
 * Service Visualization Engine
 * Provides real-time visualization of service dependencies, health, and performance
 */
export class ServiceVisualization extends TypedEventEmitter<VisualizationEventMap> {
  private static instance: ServiceVisualization;
  
  private registry: EnhancedServiceRegistry;
  private dependencyGraph: ServiceDependencyGraph;
  private healthMonitor: ServiceHealthMonitor;
  private metrics: ServiceMetrics;
  private tracing: ServiceTracing;
  
  private updateInterval?: NodeJS.Timeout;
  private isMonitoring = false;
  
  private constructor() {
    super();
    this.registry = EnhancedServiceRegistry.getInstance();
    this.dependencyGraph = new ServiceDependencyGraph();
    this.healthMonitor = ServiceHealthMonitor.getInstance();
    this.metrics = ServiceMetrics.getInstance();
    this.tracing = ServiceTracing.getInstance();
    
    this.setupEventListeners();
  }

  static getInstance(): ServiceVisualization {
    if (!ServiceVisualization.instance) {
      ServiceVisualization.instance = new ServiceVisualization();
    }
    return ServiceVisualization.instance;
  }

  /**
   * Start real-time visualization monitoring
   */
  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) {
      logger.warn('Visualization monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting visualization monitoring', { interval: intervalMs });

    // Initial update
    this.updateVisualization();

    // Schedule periodic updates
    this.updateInterval = setInterval(() => {
      this.updateVisualization();
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    this.isMonitoring = false;
    logger.info('Visualization monitoring stopped');
  }

  /**
   * Generate current dependency graph visualization data
   */
  async generateDependencyGraph(layout: DependencyGraphData['layout'] = 'hierarchical'): Promise<DependencyGraphData> {
    const services = this.registry.getAllMetadata();
    const graphData = this.dependencyGraph.exportGraph();
    const systemHealth = await this.registry.getSystemHealth();
    const criticalPath = this.dependencyGraph.calculateCriticalPath();
    
    // Create nodes
    const nodes: VisualizationNode[] = [];
    
    for (const node of graphData.nodes) {
      const serviceMetadata = services.get(node.id);
      const serviceHealth = systemHealth.services.get(node.id);
      const availability = this.registry.getAvailability(node.id);
      
      const visualNode: VisualizationNode = {
        id: node.id,
        label: node.label,
        type: 'service',
        status: this.mapHealthToStatus(serviceHealth?.status || 'unhealthy'),
        metadata: {
          version: serviceMetadata?.version,
          uptime: serviceMetadata?.lifecycle.uptime || 0,
          capabilities: serviceMetadata?.capabilities || [],
          dependencies: serviceMetadata?.dependencies.required || [],
          critical: node.critical,
          level: node.level,
        },
        position: this.calculateNodePosition(node.id, layout),
        metrics: await this.getNodeMetrics(node.id),
      };
      
      nodes.push(visualNode);
    }
    
    // Create edges
    const edges: VisualizationEdge[] = [];
    
    for (const edge of graphData.edges) {
      const fromService = services.get(edge.from);
      const toService = services.get(edge.to);
      
      if (fromService && toService) {
        const visualEdge: VisualizationEdge = {
          id: `${edge.from}-${edge.to}`,
          from: edge.from,
          to: edge.to,
          type: 'dependency',
          label: edge.type === 'required' ? 'requires' : 'optional',
          weight: edge.type === 'required' ? 1.0 : 0.5,
          status: this.getEdgeStatus(edge.from, edge.to),
          metadata: {
            required: edge.type === 'required',
            optional: edge.type === 'optional',
          },
        };
        
        edges.push(visualEdge);
      }
    }
    
    // Get bottlenecks from recent traces
    const tracingStats = this.tracing.getStatistics();
    const bottlenecks = Array.from(tracingStats.serviceStats.entries())
      .filter(([_, stats]) => stats.avgDuration > 1000) // Services with >1s avg duration
      .map(([service]) => service);
    
    const dependencyGraphData: DependencyGraphData = {
      nodes,
      edges,
      layout,
      metadata: {
        totalServices: services.size,
        healthyServices: systemHealth.summary.healthy,
        criticalPath: criticalPath.services,
        bottlenecks,
        lastUpdated: new Date(),
      },
    };
    
    this.emit('graph:updated', {
      timestamp: new Date(),
      nodes: nodes.length,
      edges: edges.length,
    });
    
    return dependencyGraphData;
  }

  /**
   * Generate real-time metrics dashboard data
   */
  async generateRealTimeMetrics(): Promise<RealTimeMetrics> {
    const services = this.registry.getAllMetadata();
    const systemHealth = await this.registry.getSystemHealth();
    const serviceMetrics = new Map<string, any>();
    
    let totalRequests = 0;
    let totalLatency = 0;
    let totalErrors = 0;
    let healthyServices = 0;
    
    for (const [serviceName, metadata] of services) {
      const healthResult = systemHealth.services.get(serviceName);
      const availability = this.registry.getAvailability(serviceName);
      const incidents = this.healthMonitor.getCurrentIncidents()
        .filter(incident => incident.serviceName === serviceName).length;
      
      // Get metrics for this service
      const requestMetrics = this.metrics.getServiceMetrics(serviceName, 'requests_total');
      const latencyMetrics = this.metrics.getServiceMetrics(serviceName, 'request_duration_ms');
      const errorMetrics = this.metrics.getServiceMetrics(serviceName, 'errors_total');
      
      const requestsPerSecond = this.calculateRate(requestMetrics, 60); // Over last minute
      const averageLatency = this.calculateAverage(latencyMetrics, 60);
      const errorRate = this.calculateErrorRate(requestMetrics, errorMetrics, 60);
      
      totalRequests += requestsPerSecond;
      totalLatency += averageLatency;
      totalErrors += errorRate;
      
      if (healthResult?.status === 'healthy') {
        healthyServices++;
      }
      
      serviceMetrics.set(serviceName, {
        health: healthResult?.status || 'unhealthy',
        metrics: {
          requestsPerSecond,
          averageLatency,
          errorRate,
          cpuUsage: Math.random() * 100, // Placeholder - would come from actual monitoring
          memoryUsage: Math.random() * 100, // Placeholder
        },
        incidents,
        uptime: metadata.lifecycle.uptime || 0,
      });
    }
    
    const realTimeMetrics: RealTimeMetrics = {
      timestamp: new Date(),
      services: serviceMetrics,
      system: {
        totalRequests,
        averageLatency: services.size > 0 ? totalLatency / services.size : 0,
        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        availability: services.size > 0 ? (healthyServices / services.size) * 100 : 0,
      },
    };
    
    this.emit('metrics:updated', {
      timestamp: new Date(),
      services: services.size,
    });
    
    return realTimeMetrics;
  }

  /**
   * Generate service topology heat map
   */
  async generateHeatMap(): Promise<{
    services: Map<string, {
      temperature: number; // 0-100, higher = more problematic
      factors: {
        health: number;
        performance: number;
        reliability: number;
        dependencies: number;
      };
    }>;
    hotspots: string[]; // Services with temperature > 70
  }> {
    const services = this.registry.getAllMetadata();
    const systemHealth = await this.registry.getSystemHealth();
    const heatMap = new Map<string, any>();
    const hotspots: string[] = [];
    
    for (const [serviceName] of services) {
      const healthResult = systemHealth.services.get(serviceName);
      const incidents = this.healthMonitor.getCurrentIncidents()
        .filter(incident => incident.serviceName === serviceName);
      const trends = this.healthMonitor.getHealthTrends(serviceName, 'hour');
      const performance = this.metrics.analyzeServicePerformance(serviceName);
      
      // Calculate temperature factors (0-100 scale)
      const healthFactor = this.calculateHealthFactor(healthResult?.status);
      const performanceFactor = this.calculatePerformanceFactor(performance);
      const reliabilityFactor = this.calculateReliabilityFactor(trends, incidents.length);
      const dependencyFactor = this.calculateDependencyFactor(serviceName);
      
      // Weighted average (health and performance are most important)
      const temperature = (
        healthFactor * 0.4 +
        performanceFactor * 0.3 +
        reliabilityFactor * 0.2 +
        dependencyFactor * 0.1
      );
      
      heatMap.set(serviceName, {
        temperature,
        factors: {
          health: healthFactor,
          performance: performanceFactor,
          reliability: reliabilityFactor,
          dependencies: dependencyFactor,
        },
      });
      
      if (temperature > 70) {
        hotspots.push(serviceName);
      }
    }
    
    return { services: heatMap, hotspots };
  }

  /**
   * Export visualization in various formats
   */
  async exportVisualization(
    format: 'json' | 'svg' | 'png' | 'dot',
    type: 'dependency-graph' | 'metrics' | 'heatmap' = 'dependency-graph'
  ): Promise<string> {
    let data: any;
    
    switch (type) {
      case 'dependency-graph':
        data = await this.generateDependencyGraph();
        break;
      case 'metrics':
        data = await this.generateRealTimeMetrics();
        break;
      case 'heatmap':
        data = await this.generateHeatMap();
        break;
    }
    
    let exported: string;
    
    switch (format) {
      case 'json':
        exported = JSON.stringify(data, null, 2);
        break;
        
      case 'dot':
        exported = this.exportToDot(data);
        break;
        
      case 'svg':
        exported = this.exportToSVG(data);
        break;
        
      case 'png':
        exported = await this.exportToPNG(data);
        break;
        
      default:
        exported = JSON.stringify(data, null, 2);
    }
    
    this.emit('visualization:export', {
      format,
      size: exported.length,
    });
    
    return exported;
  }

  /**
   * Generate alerts based on visualization data
   */
  async generateAlerts(): Promise<Array<{
    service: string;
    type: 'performance' | 'health' | 'dependency';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: Date;
  }>> {
    const alerts: any[] = [];
    const heatMap = await this.generateHeatMap();
    const metrics = await this.generateRealTimeMetrics();
    const incidents = this.healthMonitor.getCurrentIncidents();
    
    // Temperature-based alerts
    for (const [serviceName, data] of heatMap.services) {
      if (data.temperature > 80) {
        alerts.push({
          service: serviceName,
          type: 'health',
          severity: 'critical',
          message: `Service ${serviceName} is running very hot (${data.temperature.toFixed(1)}% temperature)`,
          timestamp: new Date(),
        });
        
        this.emit('alert:triggered', {
          service: serviceName,
          type: 'health',
          severity: 'critical',
          message: `Critical temperature: ${data.temperature.toFixed(1)}%`,
        });
      } else if (data.temperature > 60) {
        alerts.push({
          service: serviceName,
          type: 'performance',
          severity: 'medium',
          message: `Service ${serviceName} showing performance issues (${data.temperature.toFixed(1)}% temperature)`,
          timestamp: new Date(),
        });
      }
    }
    
    // Performance-based alerts
    for (const [serviceName, serviceMetrics] of metrics.services) {
      if (serviceMetrics.metrics.errorRate > 5) {
        alerts.push({
          service: serviceName,
          type: 'performance',
          severity: 'high',
          message: `High error rate: ${serviceMetrics.metrics.errorRate.toFixed(2)}%`,
          timestamp: new Date(),
        });
      }
      
      if (serviceMetrics.metrics.averageLatency > 2000) {
        alerts.push({
          service: serviceName,
          type: 'performance',
          severity: 'medium',
          message: `High latency: ${serviceMetrics.metrics.averageLatency.toFixed(0)}ms`,
          timestamp: new Date(),
        });
      }
    }
    
    // Health incident alerts
    for (const incident of incidents) {
      alerts.push({
        service: incident.serviceName,
        type: 'health',
        severity: incident.status === 'unhealthy' ? 'high' : 'medium',
        message: `Active health incident: ${incident.status}`,
        timestamp: incident.startTime,
      });
    }
    
    return alerts;
  }

  private async updateVisualization(): Promise<void> {
    try {
      // Update dependency graph
      await this.generateDependencyGraph();
      
      // Update metrics
      await this.generateRealTimeMetrics();
      
      // Check for alerts
      const alerts = await this.generateAlerts();
      
      if (alerts.length > 0) {
        logger.debug(`Generated ${alerts.length} visualization alerts`);
      }
      
    } catch (error) {
      logger.error('Failed to update visualization', { error });
    }
  }

  private mapHealthToStatus(health: string): VisualizationNode['status'] {
    switch (health) {
      case 'healthy': return 'healthy';
      case 'degraded': return 'degraded';
      case 'unhealthy': return 'unhealthy';
      default: return 'stopped';
    }
  }

  private calculateNodePosition(
    nodeId: string,
    layout: DependencyGraphData['layout']
  ): { x: number; y: number } {
    // Simplified positioning - in a real implementation, this would use
    // proper graph layout algorithms like force-directed or hierarchical
    const hash = nodeId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    
    switch (layout) {
      case 'hierarchical':
        const level = this.dependencyGraph.getService(nodeId)?.dependencies?.length || 0;
        return {
          x: (hash % 500) + 50,
          y: level * 100 + 50,
        };
        
      case 'circular':
        const angle = (hash * 2 * Math.PI) / 360;
        const radius = 200;
        return {
          x: Math.cos(angle) * radius + 300,
          y: Math.sin(angle) * radius + 300,
        };
        
      default:
        return {
          x: hash % 600,
          y: (hash * 7) % 400,
        };
    }
  }

  private async getNodeMetrics(serviceId: string): Promise<VisualizationNode['metrics']> {
    const performance = this.metrics.analyzeServicePerformance(serviceId);
    
    return {
      cpu: Math.random() * 100, // Placeholder
      memory: Math.random() * 100, // Placeholder
      requests: performance?.throughput || 0,
      errors: performance?.errorRate || 0,
      latency: performance?.responseTime.avg || 0,
    };
  }

  private getEdgeStatus(from: string, to: string): VisualizationEdge['status'] {
    const fromAvailable = this.registry.getAvailability(from)?.available;
    const toAvailable = this.registry.getAvailability(to)?.available;
    
    if (fromAvailable && toAvailable) {
      return 'active';
    } else if (!toAvailable) {
      return 'failed';
    } else {
      return 'inactive';
    }
  }

  private calculateRate(metrics: any[], windowSeconds: number): number {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    const recentMetrics = metrics.filter(m => 
      m.timestamp.getTime() > windowStart
    );
    
    return recentMetrics.reduce((sum, m) => sum + m.value, 0) / windowSeconds;
  }

  private calculateAverage(metrics: any[], windowSeconds: number): number {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    const recentMetrics = metrics.filter(m => 
      m.timestamp.getTime() > windowStart
    );
    
    if (recentMetrics.length === 0) return 0;
    
    return recentMetrics.reduce((sum, m) => sum + m.value, 0) / recentMetrics.length;
  }

  private calculateErrorRate(
    requestMetrics: any[],
    errorMetrics: any[],
    windowSeconds: number
  ): number {
    const requests = this.calculateRate(requestMetrics, windowSeconds);
    const errors = this.calculateRate(errorMetrics, windowSeconds);
    
    return requests > 0 ? (errors / requests) * 100 : 0;
  }

  private calculateHealthFactor(health?: string): number {
    switch (health) {
      case 'healthy': return 0;
      case 'degraded': return 50;
      case 'unhealthy': return 100;
      default: return 100;
    }
  }

  private calculatePerformanceFactor(performance: any): number {
    if (!performance) return 50;
    
    let factor = 0;
    
    // High latency increases temperature
    if (performance.responseTime.avg > 1000) factor += 30;
    else if (performance.responseTime.avg > 500) factor += 15;
    
    // High error rate increases temperature
    if (performance.errorRate > 5) factor += 40;
    else if (performance.errorRate > 1) factor += 20;
    
    // Low throughput might indicate issues
    if (performance.throughput < 1) factor += 10;
    
    return Math.min(factor, 100);
  }

  private calculateReliabilityFactor(trends: any, incidentCount: number): number {
    let factor = incidentCount * 20; // 20 points per incident
    
    if (trends) {
      // Low availability increases temperature
      if (trends.availability < 95) factor += 30;
      else if (trends.availability < 99) factor += 15;
      
      // High MTTR increases temperature
      if (trends.mttr > 300000) factor += 20; // > 5 minutes
      else if (trends.mttr > 60000) factor += 10; // > 1 minute
    }
    
    return Math.min(factor, 100);
  }

  private calculateDependencyFactor(serviceName: string): number {
    const deps = this.dependencyGraph.getDependencies(serviceName);
    const dependents = this.dependencyGraph.getDependents(serviceName);
    
    // Services with many dependencies or dependents are more fragile
    const totalConnections = deps.required.length + deps.optional.length + dependents.length;
    
    return Math.min(totalConnections * 5, 50); // Max 50 points for dependencies
  }

  private exportToDot(data: any): string {
    // Export to Graphviz DOT format
    let dot = 'digraph ServiceDependencies {\
';
    dot += '  rankdir=TB;\
';
    dot += '  node [shape=box, style=rounded];\
';
    
    if (data.nodes) {
      for (const node of data.nodes) {
        const color = this.getNodeColor(node.status);
        dot += `  \"${node.id}\" [label=\"${node.label}\", fillcolor=\"${color}\", style=\"filled\"];\
`;
      }
      
      for (const edge of data.edges) {
        const style = edge.metadata?.required ? 'solid' : 'dashed';
        dot += `  \"${edge.from}\" -> \"${edge.to}\" [style=\"${style}\"];\
`;
      }
    }
    
    dot += '}';
    return dot;
  }

  private exportToSVG(data: any): string {
    // Simplified SVG export - in a real implementation, this would use
    // a proper graph rendering library
    let svg = '<svg width=\"800\" height=\"600\" xmlns=\"http://www.w3.org/2000/svg\">\
';
    
    if (data.nodes) {
      for (const node of data.nodes) {
        const color = this.getNodeColor(node.status);
        const x = node.position?.x || 100;
        const y = node.position?.y || 100;
        
        svg += `  <rect x=\"${x}\" y=\"${y}\" width=\"120\" height=\"40\" fill=\"${color}\" stroke=\"black\"/>\
`;
        svg += `  <text x=\"${x + 60}\" y=\"${y + 25}\" text-anchor=\"middle\" font-size=\"12\">${node.label}</text>\
`;
      }
    }
    
    svg += '</svg>';
    return svg;
  }

  private async exportToPNG(data: any): Promise<string> {
    // In a real implementation, this would render the SVG to PNG
    // For now, return a placeholder
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  }

  private getNodeColor(status: string): string {
    switch (status) {
      case 'healthy': return '#4CAF50';
      case 'degraded': return '#FF9800';
      case 'unhealthy': return '#F44336';
      case 'stopped': return '#9E9E9E';
      case 'starting': return '#2196F3';
      default: return '#9E9E9E';
    }
  }

  private setupEventListeners(): void {
    // Listen to registry events
    this.registry.on('service:health-changed', ({ name, from, to }) => {
      if (this.isMonitoring) {
        this.updateVisualization();
      }
    });
    
    // Listen to health monitor events
    this.healthMonitor.on('incident:created', ({ incident }) => {
      this.emit('alert:triggered', {
        service: incident.serviceName,
        type: 'health',
        severity: incident.status === 'unhealthy' ? 'critical' : 'medium',
        message: `Health incident: ${incident.status}`,
      });
    });
  }
}