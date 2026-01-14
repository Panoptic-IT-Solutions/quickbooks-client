/**
 * @panoptic/quickbooks-client
 *
 * QuickBooks Online API client with OAuth 2.0, rate limiting, and typed entities
 */

// Main client
export { QuickBooksClient } from "./client.js";

// OAuth utilities
export {
  generateAuthUrl,
  exchangeCodeForTokens,
  refreshTokens,
  revokeTokens,
  calculateTokenExpiry,
  isTokenExpired,
  generateState,
} from "./oauth.js";

// Errors
export { QuickBooksError, QB_ERROR_CODES, handleQuickBooksError } from "./errors.js";
export type { QuickBooksErrorCode } from "./errors.js";

// Types
export type {
  // Config & Options
  QuickBooksConfig,
  QuickBooksClientOptions,
  QuickBooksTokens,
  TokenStore,
  OAuthTokenResponse,

  // API Types
  QueryResponse,
  QuickBooksApiError,

  // Entities
  BaseEntity,
  Invoice,
  InvoiceLine,
  Customer,
  Address,
  Payment,
  PaymentLine,
  Account,
  Vendor,
  Bill,
  BillLine,
  Item,
} from "./types.js";
