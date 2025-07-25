import { defineWebSocketHandler } from 'h3';
import type { Peer, Message } from 'crossws';
import { makeServer } from 'graphql-ws';
import type { User } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { logger } from '@/logger';
import { verifySessionToken } from '@/lib/auth/session';
import { PubSubManager } from '@/infrastructure/realtime/PubSubManager';
import { Container } from '@/infrastructure/container/Container';

// Define the GraphQLPeer interface
interface GraphQLPeer extends Peer {
  userId?: string;
  sessionId?: string;
  user?: User;
  handleMessage?: (data: string) => void;
}

// Get the container instance
const container = Container.getInstance();
const pubsubManager = PubSubManager.getInstance();

// Create the GraphQL WebSocket server configuration for a peer (user)  
const createGraphQLHandler = (peer: GraphQLPeer) => {
  return makeServer({
    async context(ctx, msg, args) {
      return {
        container,
        user: peer.user || null,
        session: peer.sessionId ? { id: peer.sessionId, user: peer.user } : null,
        connectionId: peer.id,
      };
    },

    async onConnect(ctx) {
      logger.info('GraphQL WebSocket client connected', {
        peerId: peer.id,
        userId: peer.userId,
      });

      return true; // Accept connection
    },

    async onDisconnect(ctx, code, reason) {
      logger.info('GraphQL WebSocket client disconnected', {
        peerId: peer.id,
        userId: peer.userId,
        code,
        reason,
      });
    },

    async onSubscribe(ctx, id: string, msg) {
      logger.info('GraphQL subscription started', {
        peerId: peer.id,
        userId: peer.userId,
        id,
        msg,
      });
    },

    async onComplete(ctx, id: string, msg) {
      logger.info('GraphQL subscription completed', {
        peerId: peer.id,
        userId: peer.userId,
        id,
      });
    },

    async onError(ctx, id: string, msg, errors: readonly GraphQLError[]) {
      logger.error('GraphQL operation error', {
        peerId: peer.id,
        userId: peer.userId,
        id,
        msg,
        ctx,
        errors,
      });
    },

    async onOperation(ctx, id: string, msg, result) {
      if (result && 'errors' in result) {
        const errors = result.errors as GraphQLError[];
        const error = errors[0];

        logger.error('GraphQL operation error', {
          peerId: peer.id,
          userId: peer.userId,
          id,
          msg,
          ctx,
          error,
        });
      } else {
        logger.info('GraphQL operation next', {
          peerId: peer.id,
          userId: peer.userId,
          id,
          msg,
          ctx,
          result,
        });
      }
    },

    async onNext(ctx, id: string, msg, data: any) {
      logger.info('GraphQL operation next', {
        peerId: peer.id,
        userId: peer.userId,
        id,
        msg,
        ctx,
        data,
      });
    },


  });
};

export default defineWebSocketHandler({
  async upgrade(request) {
    const cookies = parseCookies(request.headers.get('cookie') || '');
    const sessionToken = cookies['auth-session'] || extractTokenFromSubprotocol(request as Request);

    if (!sessionToken) {
      logger.warn('GraphQL WebSocket upgrade attempt without session token');
      return { status: 401, statusText: 'Unauthorized' };
    }

    try {
      // Verify the session token
      const session = await verifySessionToken(sessionToken);

      if (!session) {
        logger.warn('Invalid session token for GraphQL WebSocket upgrade');
        return { status: 401, statusText: 'Unauthorized' };
      }

      // Add user info to request headers for later access
      request.headers.set('x-user-id', session.user.id);
      request.headers.set('x-session-id', session.session.id);

      logger.info('GraphQL WebSocket upgrade authenticated', {
        userId: session.user.id,
        sessionId: session.session.id,
      });

      // Accept the graphql-ws protocol
      const protocols = request.headers.get('sec-websocket-protocol');
      if (protocols?.includes('graphql-ws')) {
        return {
          headers: {
            'sec-websocket-protocol': 'graphql-ws',
          },
        };
      }

      return; // Allow upgrade
    } catch (error) {
      logger.error('GraphQL WebSocket authentication error', { error });
      return { status: 401, statusText: 'Authentication failed' };
    }
  },

  async open(peer: GraphQLPeer) {
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

    // Get user details
    const user = await container.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      peer.user = user;

      // Track connection
      pubsubManager.addUserConnection(userId, peer.id);
      await pubsubManager.publishUserOnline(userId, user);
    }

    // Create graphql-ws handler for this peer
    const graphqlHandler = createGraphQLHandler(peer);

    // Set up the connection with graphql-ws
    const closed = graphqlHandler.opened(
      {
        protocol: 'graphql-ws',
        send: (data) => {
          peer.send(data);
        },
        close: (code, reason) => {
          peer.close(code, reason);
        },
        onMessage: (cb) => {
          // Store the message handler
          peer.handleMessage = cb;
        },
      },
      { peer }
    );

    // Store the close handler for later cleanup
  },

  async message(peer: GraphQLPeer, message: Message) {
    if (!peer.userId || !peer.handleMessage) {
      peer.close(1008, 'Not initialized');
      return;
    }

    // Forward message to graphql-ws
    const messageStr = typeof message === 'string' ? message : message.toString();
    peer.handleMessage(messageStr);
  },

  async close(peer: GraphQLPeer, details) {
    logger.info('GraphQL WebSocket closing', {
      peerId: peer.id,
      userId: peer.userId,
      code: details.code,
      reason: details.reason,
    });

    // Clean up connection tracking
    if (peer.userId) {
      pubsubManager.removeUserConnection(peer.userId, peer.id);

      // If user has no more connections, publish offline event
      if (pubsubManager.getUserConnectionCount(peer.userId) === 0) {
        await pubsubManager.publishUserOffline(peer.userId);
      }
    }
  },

  error(peer: GraphQLPeer, error) {
    logger.error('GraphQL WebSocket error', {
      peerId: peer.id,
      userId: peer.userId,
      error,
    });
  },
});

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

function extractTokenFromSubprotocol(request: Request): string | null {
  const protocols = request.headers.get('sec-websocket-protocol');
  if (!protocols) return null;

  // Look for auth token in subprotocols (format: "graphql-ws,auth-TOKEN")
  const authProtocol = protocols.split(',').find(p => p.trim().startsWith('auth-'));
  if (authProtocol) {
    return authProtocol.trim().substring(5); // Remove 'auth-' prefix
  }

  return null;
}