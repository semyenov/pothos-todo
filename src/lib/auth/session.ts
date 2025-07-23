import prisma from '@/lib/prisma';
import type { User, Session } from '@prisma/client';
import { setCookie, deleteCookie, getCookie, useSession, type H3Event, type SessionData } from 'h3';
import { isProduction, getSessionConfig } from '@/config/index';
import { getUserById } from './user.js';
import { nanoid } from 'nanoid';

export interface SessionWithUser {
	session: Session;
	user: User;
}

// H3 session data structure
export interface H3SessionData extends SessionData {
	userId: string;
	loginTime: number;
	lastActivity: number;
}

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Generate a cryptographically secure random session token
 */
export function generateSessionToken(): string {
	// nanoid generates URL-safe tokens by default
	// 32 characters = ~190 bits of entropy (more secure than the previous 192 bits)
	return nanoid(32);
}

/**
 * Create a new session for a user
 */
export async function createSession(token: string, userId: string): Promise<Session> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_EXPIRES_IN_SECONDS * 1000);

	const session = await prisma.session.create({
		data: {
			id: token,
			userId,
			expiresAt,
		},
	});

	return session;
}

/**
 * Verify a session token (alias for validateSessionToken for WebSocket auth)
 */
export async function verifySessionToken(token: string): Promise<SessionWithUser | null> {
	return validateSessionToken(token);
}

/**
 * Validate a session token and return session with user data
 */
export async function validateSessionToken(token: string): Promise<SessionWithUser | null> {
	try {
		const result = await prisma.session.findUnique({
			where: { id: token },
			include: { user: true },
		});

		if (!result) {
			return null;
		}

		const { user, ...session } = result;

		// Check if session is expired
		if (new Date() >= session.expiresAt) {
			await invalidateSession(session.id);
			return null;
		}

		// Extend session if it expires in less than 15 days
		const fifteenDaysFromNow = new Date().getTime() + (15 * 24 * 60 * 60 * 1000);
		if (session.expiresAt.getTime() < fifteenDaysFromNow) {
			const newExpiresAt = new Date(Date.now() + SESSION_EXPIRES_IN_SECONDS * 1000);
			await prisma.session.update({
				where: { id: session.id },
				data: { expiresAt: newExpiresAt },
			});
			session.expiresAt = newExpiresAt;
		}

		return { session, user };
	} catch (error) {
		console.error('Error validating session:', error);
		return null;
	}
}

/**
 * Invalidate a specific session
 */
export async function invalidateSession(sessionId: string): Promise<void> {
	try {
		await prisma.session.delete({
			where: { id: sessionId },
		});
	} catch (error) {
		// Session might not exist, which is fine
		console.warn('Session deletion failed:', error);
	}
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
	try {
		await prisma.session.deleteMany({
			where: { userId },
		});
	} catch (error) {
		console.error('Error invalidating user sessions:', error);
	}
}

/**
 * Set session token cookie using H3
 */
export function setSessionTokenCookie(event: H3Event, token: string, expiresAt: Date): void {
	setCookie(event, 'session', token, {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		expires: expiresAt,
		secure: isProduction(),
	});
}

/**
 * Delete session token cookie using H3
 */
export function deleteSessionTokenCookie(event: H3Event): void {
	deleteCookie(event, 'session', {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		secure: isProduction(),
	});
}

/**
 * Get session token from H3 event cookies
 */
export function getSessionToken(event: H3Event): string | null {
	return getCookie(event, 'session') || null;
}

/**
 * Get current session from request (for middleware/context)
 */
export async function getCurrentSession(token: string | null): Promise<SessionWithUser | null> {
	if (!token) return null;

	return validateSessionToken(token);
}

/**
 * Get current session from H3 event (extracts token from cookies)
 */
export async function getCurrentSessionFromEvent(event: H3Event): Promise<SessionWithUser | null> {
	const token = getSessionToken(event);
	return getCurrentSession(token);
}

// ========================================
// H3 Session Management Functions
// ========================================

/**
 * Get current session using H3 useSession
 */
export async function getCurrentSessionFromEventH3(event: H3Event): Promise<SessionWithUser | null> {
	try {
		const sessionConfig = getSessionConfig();
		const session = await useSession(event, {
			password: sessionConfig.secret,
			name: sessionConfig.name,
			maxAge: sessionConfig.maxAge,
			cookie: {
				httpOnly: true,
				secure: sessionConfig.secure,
				sameSite: sessionConfig.sameSite,
			},
		});

		// Check if user is logged in
		if (!session.data.userId) {
			return null;
		}

		// Get user from database using userId from session
		const user = await getUserById(session.data.userId);
		if (!user) {
			// Clear invalid session
			await session.clear();
			return null;
		}

		// Update last activity
		await session.update({
			...session.data,
			lastActivity: Date.now(),
		} as H3SessionData);

		// Return compatible format for GraphQL context
		return {
			session: {
				id: sessionConfig.name,
				userId: user.id,
				expiresAt: new Date(Date.now() + sessionConfig.maxAge * 1000),
			} as Session,
			user,
		};
	} catch (error) {
		console.error('Error getting H3 session:', error);
		return null;
	}
}

/**
 * Create a new H3 session for a user
 */
export async function createH3Session(event: H3Event, userId: string): Promise<SessionWithUser | null> {
	try {
		const sessionConfig = getSessionConfig();
		const session = await useSession(event, {
			password: sessionConfig.secret,
			name: sessionConfig.name,
			maxAge: sessionConfig.maxAge,
			cookie: {
				httpOnly: true,
				secure: sessionConfig.secure,
				sameSite: sessionConfig.sameSite,
			},
		});

		// Get user from database
		const user = await getUserById(userId);
		if (!user) {
			throw new Error('User not found');
		}

		// Set session data
		const sessionData: H3SessionData = {
			userId,
			loginTime: Date.now(),
			lastActivity: Date.now(),
		};

		await session.update(sessionData);

		// Return compatible format
		return {
			session: {
				id: sessionConfig.name,
				userId: user.id,
				expiresAt: new Date(Date.now() + sessionConfig.maxAge * 1000),
			} as Session,
			user,
		};
	} catch (error) {
		console.error('Error creating H3 session:', error);
		return null;
	}
}

/**
 * Clear H3 session
 */
export async function clearH3Session(event: H3Event): Promise<void> {
	try {
		const sessionConfig = getSessionConfig();
		const session = await useSession(event, {
			password: sessionConfig.secret,
			name: sessionConfig.name,
			maxAge: sessionConfig.maxAge,
			cookie: {
				httpOnly: true,
				secure: sessionConfig.secure,
				sameSite: sessionConfig.sameSite,
			},
		});

		await session.clear();
	} catch (error) {
		console.error('Error clearing H3 session:', error);
	}
}

/**
 * Update H3 session activity
 */
export async function updateH3SessionActivity(event: H3Event): Promise<void> {
	try {
		const sessionConfig = getSessionConfig();
		const session = await useSession(event, {
			password: sessionConfig.secret,
			name: sessionConfig.name,
			maxAge: sessionConfig.maxAge,
			cookie: {
				httpOnly: true,
				secure: sessionConfig.secure,
				sameSite: sessionConfig.sameSite,
			},
		});

		if (session.data.userId) {
			await session.update({
				...session.data,
				lastActivity: Date.now(),
			} as H3SessionData);
		}
	} catch (error) {
		console.error('Error updating H3 session activity:', error);
	}
}