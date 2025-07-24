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
    if (!ServiceVisualization.instance) {\n      ServiceVisualization.instance = new ServiceVisualization();\n    }\n    return ServiceVisualization.instance;\n  }\n\n  /**\n   * Start real-time visualization monitoring\n   */\n  startMonitoring(intervalMs: number = 5000): void {\n    if (this.isMonitoring) {\n      logger.warn('Visualization monitoring is already running');\n      return;\n    }\n\n    this.isMonitoring = true;\n    logger.info('Starting visualization monitoring', { interval: intervalMs });\n\n    // Initial update\n    this.updateVisualization();\n\n    // Schedule periodic updates\n    this.updateInterval = setInterval(() => {\n      this.updateVisualization();\n    }, intervalMs);\n  }\n\n  /**\n   * Stop monitoring\n   */\n  stopMonitoring(): void {\n    if (this.updateInterval) {\n      clearInterval(this.updateInterval);\n      this.updateInterval = undefined;\n    }\n    this.isMonitoring = false;\n    logger.info('Visualization monitoring stopped');\n  }\n\n  /**\n   * Generate current dependency graph visualization data\n   */\n  async generateDependencyGraph(layout: DependencyGraphData['layout'] = 'hierarchical'): Promise<DependencyGraphData> {\n    const services = this.registry.getAllMetadata();\n    const graphData = this.dependencyGraph.exportGraph();\n    const systemHealth = await this.registry.getSystemHealth();\n    const criticalPath = this.dependencyGraph.calculateCriticalPath();\n    \n    // Create nodes\n    const nodes: VisualizationNode[] = [];\n    \n    for (const node of graphData.nodes) {\n      const serviceMetadata = services.get(node.id);\n      const serviceHealth = systemHealth.services.get(node.id);\n      const availability = this.registry.getAvailability(node.id);\n      \n      const visualNode: VisualizationNode = {\n        id: node.id,\n        label: node.label,\n        type: 'service',\n        status: this.mapHealthToStatus(serviceHealth?.status || 'unhealthy'),\n        metadata: {\n          version: serviceMetadata?.version,\n          uptime: serviceMetadata?.lifecycle.uptime || 0,\n          capabilities: serviceMetadata?.capabilities || [],\n          dependencies: serviceMetadata?.dependencies.required || [],\n          critical: node.critical,\n          level: node.level,\n        },\n        position: this.calculateNodePosition(node.id, layout),\n        metrics: await this.getNodeMetrics(node.id),\n      };\n      \n      nodes.push(visualNode);\n    }\n    \n    // Create edges\n    const edges: VisualizationEdge[] = [];\n    \n    for (const edge of graphData.edges) {\n      const fromService = services.get(edge.from);\n      const toService = services.get(edge.to);\n      \n      if (fromService && toService) {\n        const visualEdge: VisualizationEdge = {\n          id: `${edge.from}-${edge.to}`,\n          from: edge.from,\n          to: edge.to,\n          type: 'dependency',\n          label: edge.type === 'required' ? 'requires' : 'optional',\n          weight: edge.type === 'required' ? 1.0 : 0.5,\n          status: this.getEdgeStatus(edge.from, edge.to),\n          metadata: {\n            required: edge.type === 'required',\n            optional: edge.type === 'optional',\n          },\n        };\n        \n        edges.push(visualEdge);\n      }\n    }\n    \n    // Get bottlenecks from recent traces\n    const tracingStats = this.tracing.getStatistics();\n    const bottlenecks = Array.from(tracingStats.serviceStats.entries())\n      .filter(([_, stats]) => stats.avgDuration > 1000) // Services with >1s avg duration\n      .map(([service]) => service);\n    \n    const dependencyGraphData: DependencyGraphData = {\n      nodes,\n      edges,\n      layout,\n      metadata: {\n        totalServices: services.size,\n        healthyServices: systemHealth.summary.healthy,\n        criticalPath: criticalPath.services,\n        bottlenecks,\n        lastUpdated: new Date(),\n      },\n    };\n    \n    this.emit('graph:updated', {\n      timestamp: new Date(),\n      nodes: nodes.length,\n      edges: edges.length,\n    });\n    \n    return dependencyGraphData;\n  }\n\n  /**\n   * Generate real-time metrics dashboard data\n   */\n  async generateRealTimeMetrics(): Promise<RealTimeMetrics> {\n    const services = this.registry.getAllMetadata();\n    const systemHealth = await this.registry.getSystemHealth();\n    const serviceMetrics = new Map<string, any>();\n    \n    let totalRequests = 0;\n    let totalLatency = 0;\n    let totalErrors = 0;\n    let healthyServices = 0;\n    \n    for (const [serviceName, metadata] of services) {\n      const healthResult = systemHealth.services.get(serviceName);\n      const availability = this.registry.getAvailability(serviceName);\n      const incidents = this.healthMonitor.getCurrentIncidents()\n        .filter(incident => incident.serviceName === serviceName).length;\n      \n      // Get metrics for this service\n      const requestMetrics = this.metrics.getServiceMetrics(serviceName, 'requests_total');\n      const latencyMetrics = this.metrics.getServiceMetrics(serviceName, 'request_duration_ms');\n      const errorMetrics = this.metrics.getServiceMetrics(serviceName, 'errors_total');\n      \n      const requestsPerSecond = this.calculateRate(requestMetrics, 60); // Over last minute\n      const averageLatency = this.calculateAverage(latencyMetrics, 60);\n      const errorRate = this.calculateErrorRate(requestMetrics, errorMetrics, 60);\n      \n      totalRequests += requestsPerSecond;\n      totalLatency += averageLatency;\n      totalErrors += errorRate;\n      \n      if (healthResult?.status === 'healthy') {\n        healthyServices++;\n      }\n      \n      serviceMetrics.set(serviceName, {\n        health: healthResult?.status || 'unhealthy',\n        metrics: {\n          requestsPerSecond,\n          averageLatency,\n          errorRate,\n          cpuUsage: Math.random() * 100, // Placeholder - would come from actual monitoring\n          memoryUsage: Math.random() * 100, // Placeholder\n        },\n        incidents,\n        uptime: metadata.lifecycle.uptime || 0,\n      });\n    }\n    \n    const realTimeMetrics: RealTimeMetrics = {\n      timestamp: new Date(),\n      services: serviceMetrics,\n      system: {\n        totalRequests,\n        averageLatency: services.size > 0 ? totalLatency / services.size : 0,\n        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,\n        availability: services.size > 0 ? (healthyServices / services.size) * 100 : 0,\n      },\n    };\n    \n    this.emit('metrics:updated', {\n      timestamp: new Date(),\n      services: services.size,\n    });\n    \n    return realTimeMetrics;\n  }\n\n  /**\n   * Generate service topology heat map\n   */\n  async generateHeatMap(): Promise<{\n    services: Map<string, {\n      temperature: number; // 0-100, higher = more problematic\n      factors: {\n        health: number;\n        performance: number;\n        reliability: number;\n        dependencies: number;\n      };\n    }>;\n    hotspots: string[]; // Services with temperature > 70\n  }> {\n    const services = this.registry.getAllMetadata();\n    const systemHealth = await this.registry.getSystemHealth();\n    const heatMap = new Map<string, any>();\n    const hotspots: string[] = [];\n    \n    for (const [serviceName] of services) {\n      const healthResult = systemHealth.services.get(serviceName);\n      const incidents = this.healthMonitor.getCurrentIncidents()\n        .filter(incident => incident.serviceName === serviceName);\n      const trends = this.healthMonitor.getHealthTrends(serviceName, 'hour');\n      const performance = this.metrics.analyzeServicePerformance(serviceName);\n      \n      // Calculate temperature factors (0-100 scale)\n      const healthFactor = this.calculateHealthFactor(healthResult?.status);\n      const performanceFactor = this.calculatePerformanceFactor(performance);\n      const reliabilityFactor = this.calculateReliabilityFactor(trends, incidents.length);\n      const dependencyFactor = this.calculateDependencyFactor(serviceName);\n      \n      // Weighted average (health and performance are most important)\n      const temperature = (\n        healthFactor * 0.4 +\n        performanceFactor * 0.3 +\n        reliabilityFactor * 0.2 +\n        dependencyFactor * 0.1\n      );\n      \n      heatMap.set(serviceName, {\n        temperature,\n        factors: {\n          health: healthFactor,\n          performance: performanceFactor,\n          reliability: reliabilityFactor,\n          dependencies: dependencyFactor,\n        },\n      });\n      \n      if (temperature > 70) {\n        hotspots.push(serviceName);\n      }\n    }\n    \n    return { services: heatMap, hotspots };\n  }\n\n  /**\n   * Export visualization in various formats\n   */\n  async exportVisualization(\n    format: 'json' | 'svg' | 'png' | 'dot',\n    type: 'dependency-graph' | 'metrics' | 'heatmap' = 'dependency-graph'\n  ): Promise<string> {\n    let data: any;\n    \n    switch (type) {\n      case 'dependency-graph':\n        data = await this.generateDependencyGraph();\n        break;\n      case 'metrics':\n        data = await this.generateRealTimeMetrics();\n        break;\n      case 'heatmap':\n        data = await this.generateHeatMap();\n        break;\n    }\n    \n    let exported: string;\n    \n    switch (format) {\n      case 'json':\n        exported = JSON.stringify(data, null, 2);\n        break;\n        \n      case 'dot':\n        exported = this.exportToDot(data);\n        break;\n        \n      case 'svg':\n        exported = this.exportToSVG(data);\n        break;\n        \n      case 'png':\n        exported = await this.exportToPNG(data);\n        break;\n        \n      default:\n        exported = JSON.stringify(data, null, 2);\n    }\n    \n    this.emit('visualization:export', {\n      format,\n      size: exported.length,\n    });\n    \n    return exported;\n  }\n\n  /**\n   * Generate alerts based on visualization data\n   */\n  async generateAlerts(): Promise<Array<{\n    service: string;\n    type: 'performance' | 'health' | 'dependency';\n    severity: 'low' | 'medium' | 'high' | 'critical';\n    message: string;\n    timestamp: Date;\n  }>> {\n    const alerts: any[] = [];\n    const heatMap = await this.generateHeatMap();\n    const metrics = await this.generateRealTimeMetrics();\n    const incidents = this.healthMonitor.getCurrentIncidents();\n    \n    // Temperature-based alerts\n    for (const [serviceName, data] of heatMap.services) {\n      if (data.temperature > 80) {\n        alerts.push({\n          service: serviceName,\n          type: 'health',\n          severity: 'critical',\n          message: `Service ${serviceName} is running very hot (${data.temperature.toFixed(1)}% temperature)`,\n          timestamp: new Date(),\n        });\n        \n        this.emit('alert:triggered', {\n          service: serviceName,\n          type: 'health',\n          severity: 'critical',\n          message: `Critical temperature: ${data.temperature.toFixed(1)}%`,\n        });\n      } else if (data.temperature > 60) {\n        alerts.push({\n          service: serviceName,\n          type: 'performance',\n          severity: 'medium',\n          message: `Service ${serviceName} showing performance issues (${data.temperature.toFixed(1)}% temperature)`,\n          timestamp: new Date(),\n        });\n      }\n    }\n    \n    // Performance-based alerts\n    for (const [serviceName, serviceMetrics] of metrics.services) {\n      if (serviceMetrics.metrics.errorRate > 5) {\n        alerts.push({\n          service: serviceName,\n          type: 'performance',\n          severity: 'high',\n          message: `High error rate: ${serviceMetrics.metrics.errorRate.toFixed(2)}%`,\n          timestamp: new Date(),\n        });\n      }\n      \n      if (serviceMetrics.metrics.averageLatency > 2000) {\n        alerts.push({\n          service: serviceName,\n          type: 'performance',\n          severity: 'medium',\n          message: `High latency: ${serviceMetrics.metrics.averageLatency.toFixed(0)}ms`,\n          timestamp: new Date(),\n        });\n      }\n    }\n    \n    // Health incident alerts\n    for (const incident of incidents) {\n      alerts.push({\n        service: incident.serviceName,\n        type: 'health',\n        severity: incident.status === 'unhealthy' ? 'high' : 'medium',\n        message: `Active health incident: ${incident.status}`,\n        timestamp: incident.startTime,\n      });\n    }\n    \n    return alerts;\n  }\n\n  private async updateVisualization(): Promise<void> {\n    try {\n      // Update dependency graph\n      await this.generateDependencyGraph();\n      \n      // Update metrics\n      await this.generateRealTimeMetrics();\n      \n      // Check for alerts\n      const alerts = await this.generateAlerts();\n      \n      if (alerts.length > 0) {\n        logger.debug(`Generated ${alerts.length} visualization alerts`);\n      }\n      \n    } catch (error) {\n      logger.error('Failed to update visualization', { error });\n    }\n  }\n\n  private mapHealthToStatus(health: string): VisualizationNode['status'] {\n    switch (health) {\n      case 'healthy': return 'healthy';\n      case 'degraded': return 'degraded';\n      case 'unhealthy': return 'unhealthy';\n      default: return 'stopped';\n    }\n  }\n\n  private calculateNodePosition(\n    nodeId: string,\n    layout: DependencyGraphData['layout']\n  ): { x: number; y: number } {\n    // Simplified positioning - in a real implementation, this would use\n    // proper graph layout algorithms like force-directed or hierarchical\n    const hash = nodeId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);\n    \n    switch (layout) {\n      case 'hierarchical':\n        const level = this.dependencyGraph.getService(nodeId)?.dependencies?.length || 0;\n        return {\n          x: (hash % 500) + 50,\n          y: level * 100 + 50,\n        };\n        \n      case 'circular':\n        const angle = (hash * 2 * Math.PI) / 360;\n        const radius = 200;\n        return {\n          x: Math.cos(angle) * radius + 300,\n          y: Math.sin(angle) * radius + 300,\n        };\n        \n      default:\n        return {\n          x: hash % 600,\n          y: (hash * 7) % 400,\n        };\n    }\n  }\n\n  private async getNodeMetrics(serviceId: string): Promise<VisualizationNode['metrics']> {\n    const performance = this.metrics.analyzeServicePerformance(serviceId);\n    \n    return {\n      cpu: Math.random() * 100, // Placeholder\n      memory: Math.random() * 100, // Placeholder\n      requests: performance?.throughput || 0,\n      errors: performance?.errorRate || 0,\n      latency: performance?.responseTime.avg || 0,\n    };\n  }\n\n  private getEdgeStatus(from: string, to: string): VisualizationEdge['status'] {\n    const fromAvailable = this.registry.getAvailability(from)?.available;\n    const toAvailable = this.registry.getAvailability(to)?.available;\n    \n    if (fromAvailable && toAvailable) {\n      return 'active';\n    } else if (!toAvailable) {\n      return 'failed';\n    } else {\n      return 'inactive';\n    }\n  }\n\n  private calculateRate(metrics: any[], windowSeconds: number): number {\n    const now = Date.now();\n    const windowStart = now - (windowSeconds * 1000);\n    \n    const recentMetrics = metrics.filter(m => \n      m.timestamp.getTime() > windowStart\n    );\n    \n    return recentMetrics.reduce((sum, m) => sum + m.value, 0) / windowSeconds;\n  }\n\n  private calculateAverage(metrics: any[], windowSeconds: number): number {\n    const now = Date.now();\n    const windowStart = now - (windowSeconds * 1000);\n    \n    const recentMetrics = metrics.filter(m => \n      m.timestamp.getTime() > windowStart\n    );\n    \n    if (recentMetrics.length === 0) return 0;\n    \n    return recentMetrics.reduce((sum, m) => sum + m.value, 0) / recentMetrics.length;\n  }\n\n  private calculateErrorRate(\n    requestMetrics: any[],\n    errorMetrics: any[],\n    windowSeconds: number\n  ): number {\n    const requests = this.calculateRate(requestMetrics, windowSeconds);\n    const errors = this.calculateRate(errorMetrics, windowSeconds);\n    \n    return requests > 0 ? (errors / requests) * 100 : 0;\n  }\n\n  private calculateHealthFactor(health?: string): number {\n    switch (health) {\n      case 'healthy': return 0;\n      case 'degraded': return 50;\n      case 'unhealthy': return 100;\n      default: return 100;\n    }\n  }\n\n  private calculatePerformanceFactor(performance: any): number {\n    if (!performance) return 50;\n    \n    let factor = 0;\n    \n    // High latency increases temperature\n    if (performance.responseTime.avg > 1000) factor += 30;\n    else if (performance.responseTime.avg > 500) factor += 15;\n    \n    // High error rate increases temperature\n    if (performance.errorRate > 5) factor += 40;\n    else if (performance.errorRate > 1) factor += 20;\n    \n    // Low throughput might indicate issues\n    if (performance.throughput < 1) factor += 10;\n    \n    return Math.min(factor, 100);\n  }\n\n  private calculateReliabilityFactor(trends: any, incidentCount: number): number {\n    let factor = incidentCount * 20; // 20 points per incident\n    \n    if (trends) {\n      // Low availability increases temperature\n      if (trends.availability < 95) factor += 30;\n      else if (trends.availability < 99) factor += 15;\n      \n      // High MTTR increases temperature\n      if (trends.mttr > 300000) factor += 20; // > 5 minutes\n      else if (trends.mttr > 60000) factor += 10; // > 1 minute\n    }\n    \n    return Math.min(factor, 100);\n  }\n\n  private calculateDependencyFactor(serviceName: string): number {\n    const deps = this.dependencyGraph.getDependencies(serviceName);\n    const dependents = this.dependencyGraph.getDependents(serviceName);\n    \n    // Services with many dependencies or dependents are more fragile\n    const totalConnections = deps.required.length + deps.optional.length + dependents.length;\n    \n    return Math.min(totalConnections * 5, 50); // Max 50 points for dependencies\n  }\n\n  private exportToDot(data: any): string {\n    // Export to Graphviz DOT format\n    let dot = 'digraph ServiceDependencies {\\n';\n    dot += '  rankdir=TB;\\n';\n    dot += '  node [shape=box, style=rounded];\\n';\n    \n    if (data.nodes) {\n      for (const node of data.nodes) {\n        const color = this.getNodeColor(node.status);\n        dot += `  \"${node.id}\" [label=\"${node.label}\", fillcolor=\"${color}\", style=\"filled\"];\\n`;\n      }\n      \n      for (const edge of data.edges) {\n        const style = edge.metadata?.required ? 'solid' : 'dashed';\n        dot += `  \"${edge.from}\" -> \"${edge.to}\" [style=\"${style}\"];\\n`;\n      }\n    }\n    \n    dot += '}';\n    return dot;\n  }\n\n  private exportToSVG(data: any): string {\n    // Simplified SVG export - in a real implementation, this would use\n    // a proper graph rendering library\n    let svg = '<svg width=\"800\" height=\"600\" xmlns=\"http://www.w3.org/2000/svg\">\\n';\n    \n    if (data.nodes) {\n      for (const node of data.nodes) {\n        const color = this.getNodeColor(node.status);\n        const x = node.position?.x || 100;\n        const y = node.position?.y || 100;\n        \n        svg += `  <rect x=\"${x}\" y=\"${y}\" width=\"120\" height=\"40\" fill=\"${color}\" stroke=\"black\"/>\\n`;\n        svg += `  <text x=\"${x + 60}\" y=\"${y + 25}\" text-anchor=\"middle\" font-size=\"12\">${node.label}</text>\\n`;\n      }\n    }\n    \n    svg += '</svg>';\n    return svg;\n  }\n\n  private async exportToPNG(data: any): Promise<string> {\n    // In a real implementation, this would render the SVG to PNG\n    // For now, return a placeholder\n    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';\n  }\n\n  private getNodeColor(status: string): string {\n    switch (status) {\n      case 'healthy': return '#4CAF50';\n      case 'degraded': return '#FF9800';\n      case 'unhealthy': return '#F44336';\n      case 'stopped': return '#9E9E9E';\n      case 'starting': return '#2196F3';\n      default: return '#9E9E9E';\n    }\n  }\n\n  private setupEventListeners(): void {\n    // Listen to registry events\n    this.registry.on('service:health-changed', ({ name, from, to }) => {\n      if (this.isMonitoring) {\n        this.updateVisualization();\n      }\n    });\n    \n    // Listen to health monitor events\n    this.healthMonitor.on('incident:created', ({ incident }) => {\n      this.emit('alert:triggered', {\n        service: incident.serviceName,\n        type: 'health',\n        severity: incident.status === 'unhealthy' ? 'critical' : 'medium',\n        message: `Health incident: ${incident.status}`,\n      });\n    });\n  }\n}"