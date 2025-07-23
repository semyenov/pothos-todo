import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { logger } from '@/logger.js';
import { ZeroTrustGateway, type SecurityContext } from '../security/ZeroTrustGateway.js';
import { EdgeComputingSystem, type EdgeLocation, type EdgeRequest } from './EdgeComputing.js';
import { EventEmitterSingletonService } from '../core/SingletonService.js';

export interface EdgeAuthConfig {
  jwtSecret: string;
  sessionDuration: number;
  enableGeoFencing?: boolean;
  enableDeviceBinding?: boolean;
  syncInterval?: number;
}

export interface EdgeSession {
  id: string;
  userId: string;
  token: string;
  deviceId?: string;
  location: GeographicLocation;
  permissions: string[];
  metadata: {
    created: Date;
    lastAccessed: Date;
    lastSynced: Date;
    accessCount: number;
  };
  restrictions?: SessionRestrictions;
}

export interface GeographicLocation {
  country: string;
  region: string;
  city: string;
  coordinates: { lat: number; lng: number };
  timezone: string;
}

export interface SessionRestrictions {
  allowedRegions?: string[];
  blockedRegions?: string[];
  ipWhitelist?: string[];
  deviceIds?: string[];
  maxConcurrentSessions?: number;
}

export interface AuthCache {
  sessions: Map<string, EdgeSession>;
  permissions: Map<string, Set<string>>;
  blacklist: Set<string>;
  lastSync: Date;
}

export interface AuthSyncPacket {
  type: 'full' | 'delta';
  timestamp: Date;
  sessions?: EdgeSession[];
  revokedSessions?: string[];
  permissionUpdates?: Array<{ userId: string; permissions: string[] }>;
}

/**
 * Edge Authentication and Authorization System
 * Provides distributed auth with local validation at edge
 */
export class EdgeAuthSystem extends EventEmitterSingletonService<EdgeAuthSystem> {
  private config: EdgeAuthConfig | null = null;
  private authCaches: Map<string, AuthCache> = new Map(); // locationId -> cache
  private zeroTrust: ZeroTrustGateway | null = null;
  private edgeSystem: EdgeComputingSystem | null = null;
  private syncInterval?: NodeJS.Timeout;

  protected constructor() {
    super();
  }

  public async initialize(config: EdgeAuthConfig): Promise<void> {
    this.config = config;
    this.zeroTrust = ZeroTrustGateway.getInstance();
    this.edgeSystem = await EdgeComputingSystem.getInstance();
    
    this.initializeAuthCaches();
    this.startSyncProcess();
  }

  private ensureConfig(): EdgeAuthConfig {
    if (!this.config) {
      throw new Error('EdgeAuthSystem not initialized');
    }
    return this.config;
  }

  private ensureZeroTrust(): ZeroTrustGateway {
    if (!this.zeroTrust) {
      throw new Error('EdgeAuthSystem not initialized');
    }
    return this.zeroTrust;
  }

  private ensureEdgeSystem(): EdgeComputingSystem {
    if (!this.edgeSystem) {
      throw new Error('EdgeAuthSystem not initialized');
    }
    return this.edgeSystem;
  }

  static getInstance(): EdgeAuthSystem {
    return super.getInstance();
  }

  /**
   * Authenticate at edge
   */
  async authenticateAtEdge(
    credentials: {
      token?: string;
      username?: string;
      password?: string;
      deviceId?: string;
    },
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<{ success: boolean; session?: EdgeSession; reason?: string }> {
    // Try token authentication first
    if (credentials.token) {
      const session = await this.validateTokenAtEdge(
        credentials.token,
        request,
        location
      );
      
      if (session) {
        return { success: true, session };
      }
    }

    // Fall back to credential authentication
    if (credentials.username && credentials.password) {
      // For security, credential auth must go through origin
      return this.authenticateThroughOrigin(credentials, request, location);
    }

    return { success: false, reason: 'Invalid credentials' };
  }

  /**
   * Authorize request at edge
   */
  async authorizeAtEdge(
    session: EdgeSession,
    resource: string,
    action: string,
    location: EdgeLocation
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check session validity
    if (!this.isSessionValid(session, location)) {
      return { allowed: false, reason: 'Invalid or expired session' };
    }

    // Check geographic restrictions
    if (this.ensureConfig().enableGeoFencing) {
      const geoCheck = this.checkGeographicRestrictions(session, location);
      if (!geoCheck.allowed) {
        return geoCheck;
      }
    }

    // Check device binding
    if (this.ensureConfig().enableDeviceBinding && session.deviceId) {
      const deviceCheck = this.checkDeviceBinding(session, location);
      if (!deviceCheck.allowed) {
        return deviceCheck;
      }
    }

    // Check permissions
    const hasPermission = this.checkPermission(
      session.permissions,
      resource,
      action
    );

    if (!hasPermission) {
      return { allowed: false, reason: 'Insufficient permissions' };
    }

    // Update session activity
    this.updateSessionActivity(session, location);

    return { allowed: true };
  }

  /**
   * Create edge session
   */
  async createEdgeSession(
    securityContext: SecurityContext,
    location: EdgeLocation
  ): Promise<EdgeSession> {
    const session: EdgeSession = {
      id: this.generateSessionId(),
      userId: securityContext.userId,
      token: this.generateEdgeToken(securityContext),
      deviceId: securityContext.deviceId,
      location: await this.getGeographicLocation(securityContext.ipAddress),
      permissions: securityContext.permissions,
      metadata: {
        created: new Date(),
        lastAccessed: new Date(),
        lastSynced: new Date(),
        accessCount: 0,
      },
    };

    // Add to edge cache
    this.cacheSession(session, location);

    // Emit session created event
    this.emit('session:created', { session, location });

    return session;
  }

  /**
   * Revoke session across all edges
   */
  async revokeSession(sessionId: string): Promise<void> {
    // Add to blacklist
    for (const cache of this.authCaches.values()) {
      cache.blacklist.add(sessionId);
      cache.sessions.delete(sessionId);
    }

    // Propagate revocation
    await this.propagateRevocation(sessionId);

    logger.info(`Session ${sessionId} revoked across all edges`);
    this.emit('session:revoked', sessionId);
  }

  /**
   * Sync authentication data
   */
  async syncAuthData(locationId?: string): Promise<void> {
    const locations = locationId ? [locationId] : Array.from(this.authCaches.keys());

    for (const locId of locations) {
      try {
        const syncData = await this.fetchAuthSyncData(locId);
        await this.applySyncData(locId, syncData);
        
        logger.debug(`Auth data synced for location ${locId}`);
      } catch (error) {
        logger.error(`Auth sync failed for location ${locId}`, error);
      }
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    activeByLocation: Map<string, number>;
    averageSessionDuration: number;
    topLocations: Array<{ location: string; count: number }>;
  } {
    let totalSessions = 0;
    const activeByLocation = new Map<string, number>();
    let totalDuration = 0;
    let sessionCount = 0;

    for (const [locationId, cache] of this.authCaches) {
      const activeSessions = Array.from(cache.sessions.values()).filter(s =>
        this.isSessionActive(s)
      );
      
      activeByLocation.set(locationId, activeSessions.length);
      totalSessions += activeSessions.length;

      for (const session of activeSessions) {
        const duration = Date.now() - session.metadata.created.getTime();
        totalDuration += duration;
        sessionCount++;
      }
    }

    const topLocations = Array.from(activeByLocation.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, count]) => ({ location, count }));

    return {
      totalSessions,
      activeByLocation,
      averageSessionDuration: sessionCount > 0 ? totalDuration / sessionCount : 0,
      topLocations,
    };
  }

  /**
   * Initialize auth caches for edge locations
   */
  private initializeAuthCaches(): void {
    const locations = ['edge-us-east', 'edge-us-west', 'edge-eu-west', 'edge-ap-south'];
    
    for (const locationId of locations) {
      this.authCaches.set(locationId, {
        sessions: new Map(),
        permissions: new Map(),
        blacklist: new Set(),
        lastSync: new Date(),
      });
    }
  }

  /**
   * Start sync process
   */
  private startSyncProcess(): void {
    if (this.ensureConfig().syncInterval) {
      this.syncInterval = setInterval(() => {
        this.syncAuthData().catch(error => {
          logger.error('Periodic auth sync failed', error);
        });
      }, this.ensureConfig().syncInterval);
    }
  }

  /**
   * Validate token at edge
   */
  private async validateTokenAtEdge(
    token: string,
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<EdgeSession | null> {
    try {
      // Verify JWT
      const decoded = jwt.verify(token, this.ensureConfig().jwtSecret) as any;
      
      // Check blacklist
      const cache = this.authCaches.get(location.id);
      if (cache?.blacklist.has(decoded.sessionId)) {
        return null;
      }

      // Look up session
      const session = cache?.sessions.get(decoded.sessionId);
      if (!session) {
        // Session not in edge cache, need to sync
        await this.syncAuthData(location.id);
        return cache?.sessions.get(decoded.sessionId) || null;
      }

      return session;
    } catch (error) {
      logger.debug('Token validation failed', error);
      return null;
    }
  }

  /**
   * Authenticate through origin
   */
  private async authenticateThroughOrigin(
    credentials: any,
    request: EdgeRequest,
    location: EdgeLocation
  ): Promise<{ success: boolean; session?: EdgeSession; reason?: string }> {
    try {
      // Forward to zero trust gateway
      const { token, context } = await this.ensureZeroTrust().authenticate({
        ...credentials,
        ipAddress: request.clientIp,
        userAgent: request.headers['user-agent'] || '',
      });

      // Create edge session
      const session = await this.createEdgeSession(context, location);

      return { success: true, session };
    } catch (error) {
      return { 
        success: false, 
        reason: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  /**
   * Check if session is valid
   */
  private isSessionValid(session: EdgeSession, location: EdgeLocation): boolean {
    // Check expiration
    const age = Date.now() - session.metadata.created.getTime();
    if (age > this.ensureConfig().sessionDuration) {
      return false;
    }

    // Check blacklist
    const cache = this.authCaches.get(location.id);
    if (cache?.blacklist.has(session.id)) {
      return false;
    }

    return true;
  }

  /**
   * Check if session is active
   */
  private isSessionActive(session: EdgeSession): boolean {
    const idleTime = Date.now() - session.metadata.lastAccessed.getTime();
    return idleTime < 3600000; // 1 hour idle timeout
  }

  /**
   * Check geographic restrictions
   */
  private checkGeographicRestrictions(
    session: EdgeSession,
    location: EdgeLocation
  ): { allowed: boolean; reason?: string } {
    if (!session.restrictions) {
      return { allowed: true };
    }

    const { allowedRegions, blockedRegions } = session.restrictions;

    // Check blocked regions
    if (blockedRegions && blockedRegions.includes(location.region)) {
      return { allowed: false, reason: 'Access from blocked region' };
    }

    // Check allowed regions
    if (allowedRegions && !allowedRegions.includes(location.region)) {
      return { allowed: false, reason: 'Access from unauthorized region' };
    }

    return { allowed: true };
  }

  /**
   * Check device binding
   */
  private checkDeviceBinding(
    session: EdgeSession,
    location: EdgeLocation
  ): { allowed: boolean; reason?: string } {
    if (!session.deviceId || !session.restrictions?.deviceIds) {
      return { allowed: true };
    }

    if (!session.restrictions.deviceIds.includes(session.deviceId)) {
      return { allowed: false, reason: 'Device not authorized' };
    }

    return { allowed: true };
  }

  /**
   * Check permission
   */
  private checkPermission(
    permissions: string[],
    resource: string,
    action: string
  ): boolean {
    const requiredPermission = `${resource}:${action}`;
    
    return permissions.some(permission => {
      // Exact match
      if (permission === requiredPermission) return true;
      
      // Wildcard match
      if (permission.endsWith(':*')) {
        const permResource = permission.slice(0, -2);
        return resource.startsWith(permResource);
      }
      
      if (permission === '*') return true;
      
      return false;
    });
  }

  /**
   * Update session activity
   */
  private updateSessionActivity(session: EdgeSession, location: EdgeLocation): void {
    session.metadata.lastAccessed = new Date();
    session.metadata.accessCount++;

    // Update in cache
    const cache = this.authCaches.get(location.id);
    if (cache) {
      cache.sessions.set(session.id, session);
    }
  }

  /**
   * Cache session
   */
  private cacheSession(session: EdgeSession, location: EdgeLocation): void {
    const cache = this.authCaches.get(location.id);
    if (cache) {
      cache.sessions.set(session.id, session);
      
      // Update permissions cache
      if (!cache.permissions.has(session.userId)) {
        cache.permissions.set(session.userId, new Set());
      }
      const userPerms = cache.permissions.get(session.userId)!;
      session.permissions.forEach(p => userPerms.add(p));
    }
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate edge token
   */
  private generateEdgeToken(context: SecurityContext): string {
    return jwt.sign(
      {
        userId: context.userId,
        sessionId: context.sessionId,
        permissions: context.permissions,
      },
      this.ensureConfig().jwtSecret,
      {
        expiresIn: Math.floor(this.ensureConfig().sessionDuration / 1000),
        issuer: 'edge-auth',
      }
    );
  }

  /**
   * Get geographic location
   */
  private async getGeographicLocation(ipAddress: string): Promise<GeographicLocation> {
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
   * Fetch auth sync data
   */
  private async fetchAuthSyncData(locationId: string): Promise<AuthSyncPacket> {
    // In real implementation, would fetch from origin
    return {
      type: 'delta',
      timestamp: new Date(),
      sessions: [],
      revokedSessions: [],
      permissionUpdates: [],
    };
  }

  /**
   * Apply sync data
   */
  private async applySyncData(
    locationId: string,
    syncData: AuthSyncPacket
  ): Promise<void> {
    const cache = this.authCaches.get(locationId);
    if (!cache) return;

    // Apply session updates
    if (syncData.sessions) {
      for (const session of syncData.sessions) {
        cache.sessions.set(session.id, session);
      }
    }

    // Apply revocations
    if (syncData.revokedSessions) {
      for (const sessionId of syncData.revokedSessions) {
        cache.sessions.delete(sessionId);
        cache.blacklist.add(sessionId);
      }
    }

    // Apply permission updates
    if (syncData.permissionUpdates) {
      for (const update of syncData.permissionUpdates) {
        cache.permissions.set(update.userId, new Set(update.permissions));
        
        // Update existing sessions
        for (const session of cache.sessions.values()) {
          if (session.userId === update.userId) {
            session.permissions = update.permissions;
          }
        }
      }
    }

    cache.lastSync = new Date();
  }

  /**
   * Propagate revocation
   */
  private async propagateRevocation(sessionId: string): Promise<void> {
    const packet: AuthSyncPacket = {
      type: 'delta',
      timestamp: new Date(),
      revokedSessions: [sessionId],
    };

    // In real implementation, would broadcast to all edges
    for (const locationId of this.authCaches.keys()) {
      await this.applySyncData(locationId, packet);
    }
  }

  /**
   * Stop sync process
   */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }
}