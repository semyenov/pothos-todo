import { getGitHub, getOAuthState, validateOAuthState, handleGitHubOAuth, generateSessionToken, createSession, setSessionTokenCookie, type GitHubUserInfo } from '@/lib/auth';
import type { OAuth2Tokens } from 'arctic';
import { type H3Event } from 'h3';
import { $fetch } from '@/lib/fetch-wrapper.js';

/**
 * Handle GitHub OAuth callback using H3
 * GET /auth/github/callback
 */
export async function handleGitHubCallback(event: H3Event): Promise<Response> {
	try {
		const url = new URL(event.node.req.url!, `http://${event.node.req.headers.host}`);
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		// Validate required parameters
		if (!code || !state) {
			console.error('Missing code or state parameters');
			return new Response('Bad Request: Missing parameters', { status: 400 });
		}

		// Get stored state from H3 cookies
		const storedState = getOAuthState(event, 'github');

		// Validate state (CSRF protection)
		if (!validateOAuthState(state, storedState)) {
			console.error('Invalid state');
			return new Response('Bad Request: Invalid state', { status: 400 });
		}

		// Exchange authorization code for tokens	
		let tokens: OAuth2Tokens;
		try {
			tokens = await getGitHub().validateAuthorizationCode(code);
		} catch (error) {
			console.error('Error validating authorization code:', error);
			return new Response('Bad Request: Invalid authorization code', { status: 400 });
		}

		// Fetch user information from GitHub API
		let githubUserInfo: GitHubUserInfo;
		try {
			const userData = await $fetch('https://api.github.com/user', {
				headers: {
					Authorization: `Bearer ${tokens.accessToken()}`,
					'User-Agent': 'Pothos-Todo-App',
				},
				retry: 2,
				timeout: 5000,
			});

			// Fetch user email if not public
			let email = userData.email;
			if (!email) {
				try {
					const emails = await $fetch('https://api.github.com/user/emails', {
						headers: {
							Authorization: `Bearer ${tokens.accessToken()}`,
							'User-Agent': 'Pothos-Todo-App',
						},
						retry: 2,
						timeout: 5000,
					});
					const primaryEmail = emails.find((e: any) => e.primary && e.verified);
					email = primaryEmail?.email || emails[0]?.email;
				} catch {
					// Email fetch failed, but continue if we have other data
				}
			}

			if (!email) {
				return new Response('Bad Request: No email found', { status: 400 });
			}

			githubUserInfo = {
				id: userData.id,
				login: userData.login,
				email,
				name: userData.name || userData.login,
				avatar_url: userData.avatar_url,
			};
		} catch (error) {
			console.error('Error fetching GitHub user data:', error);
			return new Response('Bad Request: Failed to fetch user data', { status: 400 });
		}

		// Handle user creation/authentication
		let user;
		try {
			user = await handleGitHubOAuth(githubUserInfo);
		} catch (error) {
			console.error('Error handling GitHub OAuth:', error);
			return new Response('Internal Server Error: User creation failed', { status: 500 });
		}

		// Create new session
		const sessionToken = generateSessionToken();
		const session = await createSession(sessionToken, user.id);

		// Set session cookie using H3
		setSessionTokenCookie(event, sessionToken, session.expiresAt);

		// Create success response with redirect
		const response = new Response(null, {
			status: 302,
			headers: {
				Location: '/', // Redirect to app homepage
			},
		});

		return response;
	} catch (error) {
		console.error('Unexpected error in GitHub callback:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
}