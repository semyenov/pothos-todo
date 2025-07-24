import { TypedEventEmitter } from '../core/TypedEventEmitter.js';
import { ServiceMeshIntegration } from './ServiceMeshIntegration.js';
import { logger } from '@/lib/unjs-utils.js';

interface GatewayRoute {
  id: string;
  path: string;
  service: string;
  methods: string[];
  middleware: string[];
  rateLimit?: { requests: number; window: number };
  auth?: { required: boolean; schemes: string[] };
}

interface GatewayEventMap {
  'request:received': { path: string; method: string; timestamp: Date };
  'request:routed': { route: string; service: string; duration: number };
  'request:failed': { path: string; error: string; timestamp: Date };
  'rate-limit:exceeded': { ip: string; path: string; timestamp: Date };
}

export class MeshGateway extends TypedEventEmitter<GatewayEventMap> {
  private static instance: MeshGateway;
  private mesh: ServiceMeshIntegration;
  private routes = new Map<string, GatewayRoute>();
  private rateLimitStore = new Map<string, { count: number; resetTime: number }>();

  private constructor() {
    super();
    this.mesh = ServiceMeshIntegration.getInstance();
  }

  static getInstance(): MeshGateway {
    if (!MeshGateway.instance) {
      MeshGateway.instance = new MeshGateway();
    }
    return MeshGateway.instance;
  }

  addRoute(route: GatewayRoute): void {
    this.routes.set(route.id, route);
    logger.info(`Gateway route added: ${route.path} -> ${route.service}`);
  }

  async routeRequest(path: string, method: string, headers: Record<string, string>): Promise<{
    service: string;
    transformedPath: string;
    allowed: boolean;
    reason?: string;
  }> {
    this.emit('request:received', { path, method, timestamp: new Date() });

    const route = this.findMatchingRoute(path, method);
    if (!route) {
      this.emit('request:failed', { path, error: 'No matching route', timestamp: new Date() });
      return { service: '', transformedPath: path, allowed: false, reason: 'No matching route' };
    }

    // Check rate limiting
    if (route.rateLimit && !this.checkRateLimit(headers['x-forwarded-for'] || 'unknown', route)) {
      this.emit('rate-limit:exceeded', { ip: headers['x-forwarded-for'] || 'unknown', path, timestamp: new Date() });
      return { service: route.service, transformedPath: path, allowed: false, reason: 'Rate limit exceeded' };
    }

    // Check authentication
    if (route.auth?.required && !this.checkAuth(headers, route.auth.schemes)) {
      return { service: route.service, transformedPath: path, allowed: false, reason: 'Authentication required' };
    }

    this.emit('request:routed', { route: route.id, service: route.service, duration: 0 });
    return { service: route.service, transformedPath: this.transformPath(path, route), allowed: true };
  }

  private findMatchingRoute(path: string, method: string): GatewayRoute | undefined {
    for (const route of this.routes.values()) {
      if (route.methods.includes(method) && this.pathMatches(path, route.path)) {
        return route;
      }
    }
    return undefined;
  }

  private pathMatches(requestPath: string, routePath: string): boolean {
    const routeRegex = routePath.replace(/:\w+/g, '([^/]+)').replace(/\*/g, '.*');
    return new RegExp(`^${routeRegex}$`).test(requestPath);
  }

  private checkRateLimit(ip: string, route: GatewayRoute): boolean {
    if (!route.rateLimit) return true;

    const key = `${ip}:${route.id}`;
    const now = Date.now();
    const limit = this.rateLimitStore.get(key);

    if (!limit || now > limit.resetTime) {
      this.rateLimitStore.set(key, { count: 1, resetTime: now + route.rateLimit.window });
      return true;
    }

    if (limit.count >= route.rateLimit.requests) {
      return false;
    }

    limit.count++;
    return true;
  }

  private checkAuth(headers: Record<string, string>, schemes: string[]): boolean {
    const authHeader = headers['authorization'];
    if (!authHeader) return false;

    return schemes.some(scheme => authHeader.toLowerCase().startsWith(scheme.toLowerCase()));
  }

  private transformPath(path: string, route: GatewayRoute): string {
    return path.replace(new RegExp(`^${route.path.replace(/:\w+/g, '[^/]+')}`), '');
  }
}