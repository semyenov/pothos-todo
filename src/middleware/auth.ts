import { getCurrentSessionFromEventH3, type SessionWithUser } from '@/lib/auth';
import type { Context } from '@/api/schema/builder';
import type { H3Event } from 'h3';
import { User } from '@/domain/aggregates/User';
import { Container } from '@/infrastructure/container/Container';

/**
 * Authentication middleware for GraphQL Yoga using H3 useSession
 * Validates session and sets user context using H3's built-in session management
 */
export async function authMiddleware(event: H3Event): Promise<Partial<Context>> {
	try {
		// Get current session using H3 useSession
		const sessionData: SessionWithUser | null = await getCurrentSessionFromEventH3(event);
		
		// If no session found, return empty context
		if (!sessionData) {
			return {
				user: null,
				session: null,
			};
		}
		
		// Convert Prisma user to domain User aggregate
		const domainUser = new User(
			sessionData.user.id,
			sessionData.user.email,
			sessionData.user.name,
			'user', // role
			[], // permissions
			sessionData.user.createdAt,
			sessionData.user.updatedAt
		);
		
		return {
			user: domainUser,
			session: sessionData,
		};
	} catch (error) {
		console.error('Error in H3 auth middleware:', error);
		
		// In case of error, return empty context
		return {
			user: null,
			session: null,
		};
	}
}

/**
 * Enhanced context factory that combines auth middleware with other context
 * @deprecated Use createH3GraphQLContext instead
 */
export function createGraphQLContext(container: Container) {
	return async ({ request }: { request: Request }): Promise<Context> => {
		console.warn('createGraphQLContext is deprecated, use createH3GraphQLContext instead');
		
		// Fallback - return empty auth context
		return {
			user: null,
			session: null,
			container,
		} as Context;
	};
}

/**
 * H3-compatible context factory for GraphQL Yoga using H3 sessions
 */
export function createH3GraphQLContext(container: Container) {
	return async (event: H3Event): Promise<Context> => {
		// Get auth context from H3 event using H3 sessions
		const authContext = await authMiddleware(event);
		
		// Combine with other context data
		return {
			...authContext,
			container,
		} as Context;
	};
}

/**
 * CSRF protection middleware using H3
 * Validates origin header for non-GET requests
 */
export function csrfMiddleware(event: H3Event): boolean {
	const method = event.node.req.method;
	const origin = event.node.req.headers.origin;
	const host = event.node.req.headers.host;
	
	// Allow GET and HEAD requests (they should be safe)
	if (method === 'GET' || method === 'HEAD') {
		return true;
	}
	
	// For other requests, validate origin
	if (!origin || !host) {
		return false;
	}
	
	// Extract hostname from origin
	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	
	// Check if origin matches host
	return originHost === host;
}

/**
 * H3-compatible plugin for GraphQL Yoga authentication using H3 sessions
 */
export const h3AuthPlugin = {
	/**
	 * Plugin for GraphQL Yoga to handle authentication with H3 events and H3 sessions
	 */
	onRequest: async (event: H3Event, context: Context) => {
		// CSRF protection
		if (!csrfMiddleware(event)) {
			throw new Error('CSRF validation failed');
		}
		
		// Add auth context using H3 sessions
		const authContext = await authMiddleware(event);
		Object.assign(context, authContext);
	},
};

/**
 * Legacy plugin for backwards compatibility
 * @deprecated Use h3AuthPlugin with H3 sessions instead
 */
export const luciaAuthPlugin = {
	/**
	 * Plugin for GraphQL Yoga to handle Lucia authentication
	 */
		onRequest: async (request: Request, context: Context) => {
		console.warn('luciaAuthPlugin is deprecated, use h3AuthPlugin with H3 sessions instead');
		
		// Temporary fallback
		Object.assign(context, {
			user: null,
			session: null,
		});
	},
};