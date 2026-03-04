/**
 * @panoptic/quickbooks-client
 *
 * QuickBooks Online API client with OAuth 2.0, rate limiting, and typed entities
 */

// Main client
export { QuickBooksClient } from "./client.js";
export type { QuickBooksErrorCode } from "./errors.js";

// Errors
export {
	handleQuickBooksError,
	QB_ERROR_CODES,
	QuickBooksError,
} from "./errors.js";
// OAuth utilities
export {
	calculateTokenExpiry,
	exchangeCodeForTokens,
	generateAuthUrl,
	generateState,
	isTokenExpired,
	refreshTokens,
	revokeTokens,
} from "./oauth.js";

// Types
export type {
	Account,
	Address,
	Attachable,
	AttachableRef,
	BaseEntity,
	// Batch
	BatchItemRequest,
	BatchItemResponse,
	BatchResponse,
	Bill,
	BillLine,
	BillPayment,
	BillPaymentLine,
	CompanyInfo,
	CreditMemo,
	CreditMemoLine,
	Customer,
	// Entities
	Invoice,
	InvoiceLine,
	Item,
	OAuthTokenResponse,
	Payment,
	PaymentLine,
	// API Types
	QueryResponse,
	QuickBooksApiError,
	QuickBooksClientOptions,
	// Config & Options
	QuickBooksConfig,
	QuickBooksTokens,
	// Common
	Ref,
	// Tax
	TaxCode,
	TaxLine,
	TaxRate,
	TaxRateDetail,
	TokenStore,
	TxnTaxDetail,
	Vendor,
	VendorCredit,
	VendorCreditLine,
} from "./types.js";
