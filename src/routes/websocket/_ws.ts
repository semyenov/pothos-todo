import { defineWebSocketHandler } from 'h3';
import type { Peer, Message } from 'crossws';
import { logger } from '@/logger';
import { PubSubManager } from '@/infrastructure/realtime/PubSubManager';
import { Container } from '@/infrastructure/container/Container';
import { verifySessionToken } from '@/lib/auth/session';
import { parse as parseCookie } from 'cookie-es';

interface AuthenticatedPeer extends Peer {
  userId?: string;
  sessionId?: string;
  user?: any;
}

const pubsubManager = PubSubManager.getInstance();
const container = Container.getInstance();
const activePeers = new Map<string, AuthenticatedPeer>();

export default defineWebSocketHandler({
  async upgrade(request) {
    // Extract session token from cookies
    const cookies = parseCookies(request.headers.get('cookie') || '');
    const sessionToken = cookies['auth-session'];

    if (!sessionToken) {
      logger.warn('WebSocket upgrade attempt without session token');
      return { status: 401, statusText: 'Unauthorized' };
    }

    try {
      // Verify the session token
      const sessionData = await verifySessionToken(sessionToken);

      if (!sessionData) {
        logger.warn('Invalid session token for WebSocket upgrade');
        return { status: 401, statusText: 'Unauthorized' };
      }

      // Add user info to request headers for later access
      request.headers.set('x-user-id', sessionData.user.id);
      request.headers.set('x-session-id', sessionData.session.id);

      logger.info('WebSocket upgrade authenticated', {
        userId: sessionData.user.id,
        sessionId: sessionData.session.id,
      });

      return; // Allow upgrade
    } catch (error) {
      logger.error('WebSocket authentication error', { error });
      return { status: 401, statusText: 'Authentication failed' };
    }
  },

  async open(peer: AuthenticatedPeer) {
    // Get user info from headers set during upgrade
    const userId = peer.request?.headers.get('x-user-id');
    const sessionId = peer.request?.headers.get('x-session-id');

    if (!userId || !sessionId) {
      peer.close(1008, 'Authentication required');
      return;
    }

    // Store authenticated info on peer
    peer.userId = userId;
    peer.sessionId = sessionId;

    // Track the peer
    activePeers.set(peer.id, peer);
    pubsubManager.addUserConnection(userId, peer.id);

    // Get user details and publish online event
    const user = await container.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      peer.user = user;
      await pubsubManager.publishUserOnline(userId, user);
    }

    logger.info('WebSocket connection opened', {
      peerId: peer.id,
      userId,
      sessionId,
    });

    // Send welcome message
    peer.send(JSON.stringify({
      type: 'welcome',
      connectionId: peer.id,
      userId,
    }));
  },

  async message(peer: AuthenticatedPeer, message: Message) {
    if (!peer.userId) {
      peer.close(1008, 'Authentication required');
      return;
    }

    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;

      // Handle different message types
      switch (data.type) {
        case 'ping':
          peer.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'subscribe':
          // Handle subscription to specific channels
          if (data.channel) {
            peer.subscribe(data.channel);
            logger.info('Peer subscribed to channel', {
              peerId: peer.id,
              channel: data.channel,
            });
          }
          break;

        case 'unsubscribe':
          // Handle unsubscription from channels
          if (data.channel) {
            peer.unsubscribe(data.channel);
            logger.info('Peer unsubscribed from channel', {
              peerId: peer.id,
              channel: data.channel,
            });
          }
          break;

        case 'typing':
          // Handle typing indicators
          if (data.listId) {
            await pubsubManager.publishUserTyping(peer.userId, data.listId, data.todoId);
          }
          break;

        case 'activity':
          // Handle user activity updates
          if (data.activity) {
            await pubsubManager.publishUserActivity(peer.userId, data.activity, data.metadata);
          }
          break;

        default:
          logger.warn('Unknown message type', { type: data.type, peerId: peer.id });
      }
    } catch (error) {
      logger.error('Error processing WebSocket message', {
        error,
        peerId: peer.id,
        message,
      });
    }
  },

  async close(peer: AuthenticatedPeer, details) {
    logger.info('WebSocket connection closed', {
      peerId: peer.id,
      userId: peer.userId,
      code: details.code,
      reason: details.reason,
    });

    // Clean up
    activePeers.delete(peer.id);

    if (peer.userId) {
      pubsubManager.removeUserConnection(peer.userId, peer.id);

      // If user has no more connections, publish offline event
      if (pubsubManager.getUserConnectionCount(peer.userId) === 0) {
        await pubsubManager.publishUserOffline(peer.userId);
      }
    }
  },

  error(peer: AuthenticatedPeer, error) {
    logger.error('WebSocket error', {
      peerId: peer.id,
      userId: peer.userId,
      error,
    });
  },
});

// Helper function to parse cookies - now using cookie-es
function parseCookies(cookieHeader: string): Record<string, string> {
  return parseCookie(cookieHeader);
}

// Export function to broadcast to all connected peers
export function broadcastToChannel(channel: string, message: any) {
  const messageStr = JSON.stringify(message);

  activePeers.forEach(peer => {
    if (peer.topics?.has(channel)) { // TODO: check if this is correct    
      peer.send(messageStr);
      logger.info('Broadcasted message to channel', {
        channel,
        message,
        peerId: peer.id,
      });
    }
  });
}

// Export function to send message to specific user
export function sendToUser(userId: string, message: any) {
  const messageStr = JSON.stringify(message);

  activePeers.forEach(peer => {
    if (peer.userId === userId) {
      peer.send(messageStr);
    }
  });
}