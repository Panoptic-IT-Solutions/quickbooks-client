/**
 * OAuth 2.0 implementation for QuickBooks Online
 *
 * Replaces intuit-oauth with native fetch implementation
 */

import type { QuickBooksConfig, OAuthTokenResponse, QuickBooksTokens } from "./types.js";
import { QuickBooksError, QB_ERROR_CODES } from "./errors.js";

/** Intuit OAuth endpoints */
const ENDPOINTS = {
  sandbox: {
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  },
  production: {
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  },
} as const;

/** Default scopes for QuickBooks accounting API */
const DEFAULT_SCOPES = ["com.intuit.quickbooks.accounting"];

/**
 * Generate the authorization URL for OAuth flow
 */
export function generateAuthUrl(config: QuickBooksConfig, state: string): string {
  const env = config.environment || "production";
  const scopes = config.scopes || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: state,
  });

  return `${ENDPOINTS[env].authorize}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: QuickBooksConfig,
  code: string,
  realmId: string
): Promise<QuickBooksTokens> {
  const env = config.environment || "production";

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch(ENDPOINTS[env].token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new QuickBooksError(
      `Failed to exchange code for tokens: ${response.status}`,
      QB_ERROR_CODES.UNAUTHORIZED,
      response.status,
      errorData
    );
  }

  const data = (await response.json()) as OAuthTokenResponse;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    expires_at: calculateTokenExpiry(data.expires_in),
    token_type: data.token_type,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshTokens(
  config: QuickBooksConfig,
  refreshToken: string,
  realmId: string
): Promise<QuickBooksTokens> {
  const env = config.environment || "production";

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch(ENDPOINTS[env].token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new QuickBooksError(
      `Failed to refresh tokens: ${response.status}`,
      QB_ERROR_CODES.REFRESH_FAILED,
      response.status,
      errorData
    );
  }

  const data = (await response.json()) as OAuthTokenResponse;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    expires_at: calculateTokenExpiry(data.expires_in),
    token_type: data.token_type,
  };
}

/**
 * Revoke tokens (disconnect from QuickBooks)
 */
export async function revokeTokens(
  config: QuickBooksConfig,
  token: string
): Promise<void> {
  const env = config.environment || "production";

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch(ENDPOINTS[env].revoke, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new QuickBooksError(
      `Failed to revoke tokens: ${response.status}`,
      QB_ERROR_CODES.API_ERROR,
      response.status,
      errorData
    );
  }
}

/**
 * Calculate token expiry timestamp from expires_in value
 */
export function calculateTokenExpiry(expiresIn: number): number {
  return Math.floor(Date.now() / 1000) + expiresIn;
}

/**
 * Check if token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expiresAt: number, bufferSeconds = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= expiresAt - bufferSeconds;
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
