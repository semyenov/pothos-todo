import { logger } from '@/logger';
import { EventEmitterSingletonService } from '../core/SingletonService.js';
import { createHash, randomBytes } from 'crypto';
import WebSocket from 'ws';

export interface CollaborationUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'owner' | 'editor' | 'viewer';
  lastActive: Date;
  status: 'online' | 'away' | 'offline';
  cursor?: {
    x: number;
    y: number;
    element?: string;
  };
}

export interface CollaborationSession {
  id: string;
  resourceId: string;
  resourceType: 'todo' | 'todo_list' | 'document';
  users: Map<string, CollaborationUser>;
  created: Date;
  lastActivity: Date;
  settings: {
    maxUsers: number;
    allowAnonymous: boolean;
    permissions: Record<string, string[]>;
  };
}

export interface RealTimeEvent {
  id: string;
  sessionId: string;
  userId: string;
  type: 'user_joined' | 'user_left' | 'cursor_move' | 'selection_change' | 'content_change' | 'lock_acquired' | 'lock_released';
  timestamp: Date;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ContentOperation {
  id: string;
  sessionId: string;
  userId: string;
  type: 'insert' | 'delete' | 'update' | 'move';
  resourceId: string;
  position?: number;
  content?: any;
  previousContent?: any;
  timestamp: Date;
  dependencies?: string[]; // For operation ordering
}

export interface ConflictResolution {
  id: string;
  operationIds: string[];
  strategy: 'last_write_wins' | 'operational_transform' | 'merge' | 'user_choice';
  resolution: any;
  resolvedBy: string;
  timestamp: Date;
}

export interface PresenceInfo {
  userId: string;
  sessionId: string;
  activity: 'typing' | 'editing' | 'viewing' | 'selecting';
  location: {
    resourceId: string;
    element?: string;
    position?: number;
  };
  timestamp: Date;
}

export class RealTimeCollaboration extends EventEmitterSingletonService<RealTimeCollaboration> {
  private sessions: Map<string, CollaborationSession> = new Map();
  private userSessions: Map<string, Set<string>> = new Map(); // userId -> sessionIds
  private operations: Map<string, ContentOperation[]> = new Map(); // sessionId -> operations
  private conflicts: Map<string, ConflictResolution[]> = new Map();
  private presenceData: Map<string, PresenceInfo[]> = new Map(); // sessionId -> presence
  private lockManager: Map<string, { userId: string; expires: Date }> = new Map();
  private webSocketServer: WebSocket.Server | null = null;
  private clientConnections: Map<string, WebSocket> = new Map(); // userId -> connection

  protected constructor() {
    super();
    this.setupCleanupTasks();
  }

  public static getInstance(): RealTimeCollaboration {
    return super.getInstance();
  }

  /**
   * Initialize real-time collaboration service
   */
  public async initialize(port: number = 8080): Promise<void> {
    try {
      // Setup WebSocket server
      this.webSocketServer = new WebSocket.Server({ port });
      
      this.webSocketServer.on('connection', (ws, request) => {
        this.handleWebSocketConnection(ws, request);
      });

      logger.info('Real-time collaboration service initialized', { port });
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize real-time collaboration', error);
      throw error;
    }
  }

  /**
   * Create or join collaboration session
   */
  public async joinSession(
    resourceId: string,
    resourceType: 'todo' | 'todo_list' | 'document',
    user: Omit<CollaborationUser, 'lastActive' | 'status'>
  ): Promise<{
    sessionId: string;
    session: CollaborationSession;
    existingUsers: CollaborationUser[];
  }> {
    try {
      let session = this.findSessionByResource(resourceId, resourceType);
      
      if (!session) {
        // Create new session
        session = {
          id: this.generateSessionId(),
          resourceId,
          resourceType,
          users: new Map(),
          created: new Date(),
          lastActivity: new Date(),
          settings: {
            maxUsers: 50,
            allowAnonymous: true,
            permissions: {
              owner: ['read', 'write', 'admin'],
              editor: ['read', 'write'],
              viewer: ['read'],
            },
          },
        };
        
        this.sessions.set(session.id, session);
        this.operations.set(session.id, []);
        this.presenceData.set(session.id, []);
      }

      // Add user to session
      const collaborationUser: CollaborationUser = {
        ...user,
        lastActive: new Date(),
        status: 'online',
      };

      session.users.set(user.id, collaborationUser);
      session.lastActivity = new Date();

      // Track user sessions
      if (!this.userSessions.has(user.id)) {
        this.userSessions.set(user.id, new Set());
      }
      this.userSessions.get(user.id)!.add(session.id);

      // Broadcast user joined event
      const event: RealTimeEvent = {
        id: this.generateEventId(),
        sessionId: session.id,
        userId: user.id,
        type: 'user_joined',
        timestamp: new Date(),
        data: { user: collaborationUser },
      };

      this.broadcastEvent(session.id, event, user.id);

      logger.info('User joined collaboration session', {
        sessionId: session.id,
        userId: user.id,
        resourceId,
        totalUsers: session.users.size,
      });

      return {
        sessionId: session.id,
        session,
        existingUsers: Array.from(session.users.values()).filter(u => u.id !== user.id),
      };
    } catch (error) {
      logger.error('Failed to join collaboration session', error);
      throw error;
    }
  }

  /**
   * Leave collaboration session
   */
  public async leaveSession(sessionId: string, userId: string): Promise<void> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session || !session.users.has(userId)) {
        return;
      }

      // Remove user from session
      session.users.delete(userId);
      session.lastActivity = new Date();

      // Update user sessions tracking
      const userSessionSet = this.userSessions.get(userId);
      if (userSessionSet) {
        userSessionSet.delete(sessionId);
        if (userSessionSet.size === 0) {
          this.userSessions.delete(userId);
        }
      }

      // Release any locks held by user
      this.releaseUserLocks(sessionId, userId);

      // Remove presence data
      const presenceList = this.presenceData.get(sessionId) || [];
      this.presenceData.set(sessionId, presenceList.filter(p => p.userId !== userId));

      // Broadcast user left event
      const event: RealTimeEvent = {
        id: this.generateEventId(),
        sessionId,
        userId,
        type: 'user_left',
        timestamp: new Date(),
        data: { userId },
      };

      this.broadcastEvent(sessionId, event, userId);

      // Clean up empty sessions
      if (session.users.size === 0) {
        this.cleanupSession(sessionId);
      }

      logger.info('User left collaboration session', {
        sessionId,
        userId,
        remainingUsers: session.users.size,
      });
    } catch (error) {
      logger.error('Failed to leave collaboration session', error);
    }
  }

  /**
   * Apply content operation with conflict resolution
   */
  public async applyOperation(operation: Omit<ContentOperation, 'id' | 'timestamp'>): Promise<{
    applied: boolean;
    conflicts?: ConflictResolution[];
    transformedOperation?: ContentOperation;
  }> {
    try {
      const session = this.sessions.get(operation.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${operation.sessionId}`);
      }

      const fullOperation: ContentOperation = {
        id: this.generateOperationId(),
        timestamp: new Date(),
        ...operation,
      };

      // Check for conflicts
      const conflicts = await this.detectConflicts(fullOperation);
      
      if (conflicts.length > 0) {
        // Resolve conflicts
        const resolutions = await this.resolveConflicts(conflicts);
        
        // Apply operational transformation if needed
        const transformedOperation = await this.transformOperation(fullOperation, resolutions);
        
        // Store conflict resolutions
        if (!this.conflicts.has(operation.sessionId)) {
          this.conflicts.set(operation.sessionId, []);
        }
        this.conflicts.get(operation.sessionId)!.push(...resolutions);

        // Store transformed operation
        this.operations.get(operation.sessionId)!.push(transformedOperation);

        // Broadcast the resolved operation
        const event: RealTimeEvent = {
          id: this.generateEventId(),
          sessionId: operation.sessionId,
          userId: operation.userId,
          type: 'content_change',
          timestamp: new Date(),
          data: { 
            operation: transformedOperation,
            conflicts: resolutions,
          },
        };

        this.broadcastEvent(operation.sessionId, event, operation.userId);

        return {
          applied: true,
          conflicts: resolutions,
          transformedOperation,
        };
      } else {
        // No conflicts, apply operation directly
        this.operations.get(operation.sessionId)!.push(fullOperation);

        // Broadcast the operation
        const event: RealTimeEvent = {
          id: this.generateEventId(),
          sessionId: operation.sessionId,
          userId: operation.userId,
          type: 'content_change',
          timestamp: new Date(),
          data: { operation: fullOperation },
        };

        this.broadcastEvent(operation.sessionId, event, operation.userId);

        return { applied: true };
      }
    } catch (error) {
      logger.error('Failed to apply operation', error);
      return { applied: false };
    }
  }

  /**
   * Update user presence information
   */
  public updatePresence(presenceInfo: Omit<PresenceInfo, 'timestamp'>): void {
    try {
      const fullPresence: PresenceInfo = {
        ...presenceInfo,
        timestamp: new Date(),
      };

      const presenceList = this.presenceData.get(presenceInfo.sessionId) || [];
      
      // Remove old presence data for this user
      const filteredPresence = presenceList.filter(p => p.userId !== presenceInfo.userId);
      filteredPresence.push(fullPresence);
      
      this.presenceData.set(presenceInfo.sessionId, filteredPresence);

      // Update user's last active time
      const session = this.sessions.get(presenceInfo.sessionId);
      if (session && session.users.has(presenceInfo.userId)) {
        const user = session.users.get(presenceInfo.userId)!;
        user.lastActive = new Date();
        user.status = 'online';

        // Update cursor position if provided
        if (presenceInfo.activity === 'editing' && presenceInfo.location.position) {
          user.cursor = {
            x: presenceInfo.location.position,
            y: 0, // Would be calculated based on content
            element: presenceInfo.location.element,
          };
        }
      }

      // Broadcast presence update
      const event: RealTimeEvent = {
        id: this.generateEventId(),
        sessionId: presenceInfo.sessionId,
        userId: presenceInfo.userId,
        type: presenceInfo.activity === 'typing' ? 'cursor_move' : 'selection_change',
        timestamp: new Date(),
        data: { presence: fullPresence },
      };

      this.broadcastEvent(presenceInfo.sessionId, event, presenceInfo.userId);
    } catch (error) {
      logger.error('Failed to update presence', error);
    }
  }

  /**
   * Acquire exclusive lock on resource
   */
  public async acquireLock(
    sessionId: string,
    userId: string,
    resourceKey: string,
    duration: number = 30000 // 30 seconds default
  ): Promise<{
    acquired: boolean;
    lockId?: string;
    expires?: Date;
  }> {
    try {
      const lockKey = `${sessionId}:${resourceKey}`;
      const existingLock = this.lockManager.get(lockKey);

      // Check if lock is expired
      if (existingLock && existingLock.expires < new Date()) {
        this.lockManager.delete(lockKey);
      }

      // Check if lock is available
      const currentLock = this.lockManager.get(lockKey);
      if (currentLock && currentLock.userId !== userId) {
        return { acquired: false };
      }

      // Acquire lock
      const expires = new Date(Date.now() + duration);
      this.lockManager.set(lockKey, { userId, expires });

      // Broadcast lock acquired event
      const event: RealTimeEvent = {
        id: this.generateEventId(),
        sessionId,
        userId,
        type: 'lock_acquired',
        timestamp: new Date(),
        data: { 
          resourceKey,
          lockId: lockKey,
          expires: expires.toISOString(),
        },
      };

      this.broadcastEvent(sessionId, event, userId);

      logger.debug('Lock acquired', { sessionId, userId, resourceKey, expires });

      return {
        acquired: true,
        lockId: lockKey,
        expires,
      };
    } catch (error) {
      logger.error('Failed to acquire lock', error);
      return { acquired: false };
    }
  }

  /**
   * Release lock on resource
   */
  public async releaseLock(sessionId: string, userId: string, lockId: string): Promise<boolean> {
    try {
      const lock = this.lockManager.get(lockId);
      if (!lock || lock.userId !== userId) {
        return false;
      }

      this.lockManager.delete(lockId);

      // Broadcast lock released event
      const event: RealTimeEvent = {
        id: this.generateEventId(),
        sessionId,
        userId,
        type: 'lock_released',
        timestamp: new Date(),
        data: { lockId },
      };

      this.broadcastEvent(sessionId, event, userId);

      logger.debug('Lock released', { sessionId, userId, lockId });
      return true;
    } catch (error) {
      logger.error('Failed to release lock', error);
      return false;
    }
  }

  /**
   * Get session analytics and statistics
   */
  public getSessionAnalytics(sessionId: string): {
    session: CollaborationSession;
    statistics: {
      totalOperations: number;
      totalConflicts: number;
      activeUsers: number;
      averageSessionDuration: number;
      operationsByType: Record<string, number>;
    };
    presenceOverview: Array<{
      userId: string;
      activity: string;
      location: string;
      lastSeen: Date;
    }>;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const operations = this.operations.get(sessionId) || [];
    const conflicts = this.conflicts.get(sessionId) || [];
    const presence = this.presenceData.get(sessionId) || [];

    // Calculate statistics
    const operationsByType: Record<string, number> = {};
    operations.forEach(op => {
      operationsByType[op.type] = (operationsByType[op.type] || 0) + 1;
    });

    const activeUsers = Array.from(session.users.values()).filter(
      user => user.status === 'online'
    ).length;

    const sessionDuration = Date.now() - session.created.getTime();
    const averageSessionDuration = sessionDuration / session.users.size;

    // Build presence overview
    const presenceOverview = presence.map(p => ({
      userId: p.userId,
      activity: p.activity,
      location: `${p.location.resourceId}${p.location.element ? ':' + p.location.element : ''}`,
      lastSeen: p.timestamp,
    }));

    return {
      session,
      statistics: {
        totalOperations: operations.length,
        totalConflicts: conflicts.length,
        activeUsers,
        averageSessionDuration,
        operationsByType,
      },
      presenceOverview,
    };
  }

  /**
   * Export session data for analysis
   */
  public exportSessionData(sessionId: string): {
    session: CollaborationSession;
    operations: ContentOperation[];
    conflicts: ConflictResolution[];
    events: RealTimeEvent[];
    timeline: Array<{
      timestamp: Date;
      type: string;
      user: string;
      description: string;
    }>;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const operations = this.operations.get(sessionId) || [];
    const conflicts = this.conflicts.get(sessionId) || [];

    // Generate timeline
    const timeline: Array<{
      timestamp: Date;
      type: string;
      user: string;
      description: string;
    }> = [];

    // Add operations to timeline
    operations.forEach(op => {
      timeline.push({
        timestamp: op.timestamp,
        type: 'operation',
        user: op.userId,
        description: `${op.type} operation on ${op.resourceId}`,
      });
    });

    // Add conflicts to timeline
    conflicts.forEach(conflict => {
      timeline.push({
        timestamp: conflict.timestamp,
        type: 'conflict',
        user: conflict.resolvedBy,
        description: `Resolved conflict using ${conflict.strategy}`,
      });
    });

    // Sort timeline by timestamp
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      session,
      operations,
      conflicts,
      events: [], // Would track all events if needed
      timeline,
    };
  }

  // Private helper methods

  private handleWebSocketConnection(ws: WebSocket, request: any): void {
    // Extract user ID from connection (would come from auth)
    const userId = this.extractUserIdFromRequest(request);
    if (userId) {
      this.clientConnections.set(userId, ws);
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(ws, message, userId);
      } catch (error) {
        logger.error('Failed to parse WebSocket message', error);
      }
    });

    ws.on('close', () => {
      if (userId) {
        this.clientConnections.delete(userId);
        // Leave all sessions for this user
        const userSessionSet = this.userSessions.get(userId);
        if (userSessionSet) {
          userSessionSet.forEach(sessionId => {
            this.leaveSession(sessionId, userId);
          });
        }
      }
    });
  }

  private handleWebSocketMessage(ws: WebSocket, message: any, userId?: string): void {
    if (!userId) return;

    switch (message.type) {
      case 'presence_update':
        this.updatePresence({
          userId,
          sessionId: message.sessionId,
          activity: message.activity,
          location: message.location,
        });
        break;

      case 'operation':
        this.applyOperation({
          sessionId: message.sessionId,
          userId,
          type: message.operationType,
          resourceId: message.resourceId,
          position: message.position,
          content: message.content,
          previousContent: message.previousContent,
          dependencies: message.dependencies,
        });
        break;

      case 'lock_request':
        this.acquireLock(message.sessionId, userId, message.resourceKey, message.duration);
        break;

      case 'lock_release':
        this.releaseLock(message.sessionId, userId, message.lockId);
        break;
    }
  }

  private extractUserIdFromRequest(request: any): string | null {
    // In a real implementation, this would extract user ID from JWT token
    // or session data in the request headers
    const url = new URL(request.url, 'http://localhost');
    return url.searchParams.get('userId');
  }

  private broadcastEvent(sessionId: string, event: RealTimeEvent, excludeUserId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message = JSON.stringify(event);

    session.users.forEach((user, userId) => {
      if (userId === excludeUserId) return;

      const connection = this.clientConnections.get(userId);
      if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(message);
      }
    });
  }

  private findSessionByResource(resourceId: string, resourceType: string): CollaborationSession | null {
    for (const session of this.sessions.values()) {
      if (session.resourceId === resourceId && session.resourceType === resourceType) {
        return session;
      }
    }
    return null;
  }

  private async detectConflicts(operation: ContentOperation): Promise<string[]> {
    const sessionOperations = this.operations.get(operation.sessionId) || [];
    const conflicts = [];

    // Simple conflict detection based on position overlap
    for (const existingOp of sessionOperations) {
      if (existingOp.resourceId === operation.resourceId &&
          existingOp.userId !== operation.userId &&
          this.operationsConflict(existingOp, operation)) {
        conflicts.push(existingOp.id);
      }
    }

    return conflicts;
  }

  private operationsConflict(op1: ContentOperation, op2: ContentOperation): boolean {
    // Simplified conflict detection
    if (op1.position === undefined || op2.position === undefined) {
      return false;
    }

    // Check for position overlap
    const op1End = op1.position + (op1.content?.length || 0);
    const op2End = op2.position + (op2.content?.length || 0);

    return !(op1End <= op2.position || op2End <= op1.position);
  }

  private async resolveConflicts(conflictIds: string[]): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = [];

    // For now, use last-write-wins strategy
    // In a real implementation, this would use operational transformation
    resolutions.push({
      id: this.generateConflictId(),
      operationIds: conflictIds,
      strategy: 'last_write_wins',
      resolution: { winner: 'latest' },
      resolvedBy: 'system',
      timestamp: new Date(),
    });

    return resolutions;
  }

  private async transformOperation(
    operation: ContentOperation,
    resolutions: ConflictResolution[]
  ): Promise<ContentOperation> {
    // Simplified transformation - in reality this would use operational transform algorithms
    return operation;
  }

  private releaseUserLocks(sessionId: string, userId: string): void {
    const keysToDelete = [];
    
    for (const [lockKey, lock] of this.lockManager) {
      if (lockKey.startsWith(`${sessionId}:`) && lock.userId === userId) {
        keysToDelete.push(lockKey);
      }
    }

    keysToDelete.forEach(key => {
      this.lockManager.delete(key);
    });
  }

  private cleanupSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.operations.delete(sessionId);
    this.conflicts.delete(sessionId);
    this.presenceData.delete(sessionId);

    // Clean up locks for this session
    const locksToDelete = [];
    for (const [lockKey] of this.lockManager) {
      if (lockKey.startsWith(`${sessionId}:`)) {
        locksToDelete.push(lockKey);
      }
    }
    locksToDelete.forEach(key => this.lockManager.delete(key));

    logger.info('Session cleaned up', { sessionId });
  }

  private setupCleanupTasks(): void {
    // Clean up expired locks every minute
    setInterval(() => {
      const now = new Date();
      const expiredLocks = [];
      
      for (const [lockKey, lock] of this.lockManager) {
        if (lock.expires < now) {
          expiredLocks.push(lockKey);
        }
      }

      expiredLocks.forEach(key => this.lockManager.delete(key));
    }, 60000);

    // Clean up inactive sessions every 10 minutes
    setInterval(() => {
      const cutoffTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const sessionsToCleanup = [];

      for (const [sessionId, session] of this.sessions) {
        if (session.lastActivity < cutoffTime && session.users.size === 0) {
          sessionsToCleanup.push(sessionId);
        }
      }

      sessionsToCleanup.forEach(sessionId => this.cleanupSession(sessionId));
    }, 600000);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }

  private generateConflictId(): string {
    return `conflict_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }

  /**
   * Get collaboration overview
   */
  public getCollaborationOverview(): {
    totalSessions: number;
    totalUsers: number;
    activeUsers: number;
    totalOperations: number;
    activeLocks: number;
  } {
    let totalUsers = 0;
    let activeUsers = 0;
    let totalOperations = 0;

    this.sessions.forEach(session => {
      totalUsers += session.users.size;
      activeUsers += Array.from(session.users.values()).filter(u => u.status === 'online').length;
    });

    this.operations.forEach(ops => {
      totalOperations += ops.length;
    });

    return {
      totalSessions: this.sessions.size,
      totalUsers,
      activeUsers,
      totalOperations,
      activeLocks: this.lockManager.size,
    };
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    if (this.webSocketServer) {
      this.webSocketServer.close();
    }

    this.sessions.clear();
    this.userSessions.clear();
    this.operations.clear();
    this.conflicts.clear();
    this.presenceData.clear();
    this.lockManager.clear();
    this.clientConnections.clear();

    logger.info('Real-time collaboration cleaned up');
  }
}