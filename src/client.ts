/**
 * QuickBooks Online API Client
 *
 * Main client class with rate limiting, auto token refresh, and typed API methods
 */

import {
	handleQuickBooksError,
	QB_ERROR_CODES,
	QuickBooksError,
} from "./errors.js";
import { isTokenExpired, refreshTokens } from "./oauth.js";
import type {
	Account,
	Attachable,
	BatchItemRequest,
	BatchResponse,
	Bill,
	BillPayment,
	CompanyInfo,
	CreditMemo,
	Customer,
	Invoice,
	Item,
	Payment,
	QueryResponse,
	QuickBooksClientOptions,
	QuickBooksTokens,
	TaxCode,
	TaxRate,
	TokenStore,
	Vendor,
	VendorCredit,
} from "./types.js";

/** API base URLs */
const API_BASE = {
	sandbox: "https://sandbox-quickbooks.api.intuit.com",
	production: "https://quickbooks.api.intuit.com",
} as const;

/** Rate limit: 500 requests per minute */
const RATE_LIMIT = 500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Retry configuration */
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

export class QuickBooksClient {
	private config: QuickBooksClientOptions;
	private tokenStore: TokenStore;
	private requestTimestamps: number[] = [];
	private onLog: QuickBooksClientOptions["onLog"];
	private minorVersion: number | undefined;

	constructor(options: QuickBooksClientOptions) {
		this.validateConfig(options);
		this.config = options;
		this.tokenStore = options.tokenStore;
		this.onLog = options.onLog;
		this.minorVersion = options.minorVersion;
	}

	private validateConfig(options: QuickBooksClientOptions): void {
		if (!options.clientId) {
			throw new QuickBooksError(
				"clientId is required",
				QB_ERROR_CODES.INVALID_CONFIG,
			);
		}
		if (!options.clientSecret) {
			throw new QuickBooksError(
				"clientSecret is required",
				QB_ERROR_CODES.INVALID_CONFIG,
			);
		}
		if (!options.redirectUri) {
			throw new QuickBooksError(
				"redirectUri is required",
				QB_ERROR_CODES.INVALID_CONFIG,
			);
		}
		if (!options.tokenStore) {
			throw new QuickBooksError(
				"tokenStore is required",
				QB_ERROR_CODES.INVALID_CONFIG,
			);
		}
	}

	private log(
		level: "debug" | "info" | "warn" | "error",
		message: string,
		data?: unknown,
	): void {
		if (this.onLog) {
			this.onLog(level, message, data);
		}
	}

	/**
	 * Append minorversion query param to a URL if configured
	 */
	private appendMinorVersion(url: string): string {
		if (this.minorVersion == null) return url;
		const separator = url.includes("?") ? "&" : "?";
		return `${url}${separator}minorversion=${this.minorVersion}`;
	}

	/**
	 * Rate limiting - ensures we don't exceed 500 requests/minute
	 */
	private async checkRateLimit(): Promise<void> {
		const now = Date.now();

		// Remove timestamps older than the rate limit window
		this.requestTimestamps = this.requestTimestamps.filter(
			(ts) => now - ts < RATE_LIMIT_WINDOW_MS,
		);

		// If at rate limit, wait until oldest request expires from window
		if (this.requestTimestamps.length >= RATE_LIMIT) {
			const oldestTimestamp = this.requestTimestamps[0];
			const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp) + 100; // Add small buffer

			this.log("warn", `Rate limit reached, waiting ${waitTime}ms`);
			await new Promise((resolve) => setTimeout(resolve, waitTime));
		}

		// Record this request
		this.requestTimestamps.push(Date.now());
	}

	/**
	 * Get current tokens, refreshing if necessary
	 */
	private async getValidTokens(): Promise<QuickBooksTokens> {
		const tokens = await this.tokenStore.getTokens();

		if (!tokens) {
			throw new QuickBooksError(
				"No tokens found - please connect to QuickBooks first",
				QB_ERROR_CODES.UNAUTHORIZED,
			);
		}

		// Check if token needs refresh (with 5 minute buffer)
		if (isTokenExpired(tokens.expires_at)) {
			this.log("info", "Token expired, refreshing...");

			try {
				const newTokens = await refreshTokens(
					this.config,
					tokens.refresh_token,
					tokens.realm_id,
				);

				await this.tokenStore.storeTokens(newTokens);
				this.log("info", "Token refreshed successfully");

				return newTokens;
			} catch (error) {
				// If refresh fails with 401, clear tokens and require reconnection
				if (error instanceof QuickBooksError && error.status === 401) {
					this.log("warn", "Refresh token invalid, clearing tokens");
					await this.tokenStore.clearTokens();
				}
				throw error;
			}
		}

		return tokens;
	}

	/**
	 * Make an authenticated API request with retry logic
	 */
	private async request<T>(
		method: string,
		endpoint: string,
		body?: unknown,
		retryCount = 0,
	): Promise<T> {
		await this.checkRateLimit();

		const tokens = await this.getValidTokens();
		const env = this.config.environment || "production";
		const baseUrl = API_BASE[env];
		const url = this.appendMinorVersion(
			`${baseUrl}/v3/company/${tokens.realm_id}${endpoint}`,
		);

		this.log("debug", `${method} ${endpoint}`, { body });

		const headers: Record<string, string> = {
			Authorization: `Bearer ${tokens.access_token}`,
			Accept: "application/json",
		};

		if (body) {
			headers["Content-Type"] = "application/json";
		}

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
			});

			// Handle rate limiting with retry
			if (response.status === 429 && retryCount < MAX_RETRIES) {
				const retryAfter = response.headers.get("Retry-After");
				const delay = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: INITIAL_RETRY_DELAY_MS * 2 ** retryCount;

				this.log(
					"warn",
					`Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1})`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay));

				return this.request<T>(method, endpoint, body, retryCount + 1);
			}

			// Handle 401 with token refresh retry
			if (response.status === 401 && retryCount < 1) {
				this.log("warn", "Got 401, attempting token refresh");

				const tokens = await this.tokenStore.getTokens();
				if (tokens) {
					const newTokens = await refreshTokens(
						this.config,
						tokens.refresh_token,
						tokens.realm_id,
					);
					await this.tokenStore.storeTokens(newTokens);

					return this.request<T>(method, endpoint, body, retryCount + 1);
				}
			}

			if (!response.ok) {
				const errorData = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				throw { status: response.status, ...errorData };
			}

			return (await response.json()) as T;
		} catch (error) {
			throw handleQuickBooksError(error);
		}
	}

	/**
	 * Execute a query using QuickBooks Query Language
	 */
	async query<T>(sql: string): Promise<T[]> {
		const tokens = await this.getValidTokens();
		const env = this.config.environment || "production";
		const baseUrl = API_BASE[env];
		const url = this.appendMinorVersion(
			`${baseUrl}/v3/company/${tokens.realm_id}/query`,
		);

		await this.checkRateLimit();

		const fetchResponse = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
				Accept: "application/json",
				"Content-Type": "application/text",
			},
			body: sql,
		});

		if (!fetchResponse.ok) {
			const errorData = (await fetchResponse
				.json()
				.catch(() => ({}))) as Record<string, unknown>;
			throw handleQuickBooksError({
				status: fetchResponse.status,
				...errorData,
			});
		}

		const data = (await fetchResponse.json()) as QueryResponse<T>;

		// Extract the entity array from QueryResponse
		const keys = Object.keys(data.QueryResponse).filter(
			(k) => !["startPosition", "maxResults", "totalCount"].includes(k),
		);
		const entityKey = keys[0];

		return entityKey ? (data.QueryResponse[entityKey] as T[]) : [];
	}

	/**
	 * Execute a query with automatic pagination to fetch all results
	 * @param sql - Base SQL query (without STARTPOSITION/MAXRESULTS)
	 * @param pageSize - Number of results per page (default 1000, max 1000)
	 */
	async queryAll<T>(sql: string, pageSize = 1000): Promise<T[]> {
		const allResults: T[] = [];
		let startPosition = 1;
		const maxResults = Math.min(pageSize, 1000);

		while (true) {
			const paginatedSql = `${sql} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;

			const tokens = await this.getValidTokens();
			const env = this.config.environment || "production";
			const baseUrl = API_BASE[env];
			const url = this.appendMinorVersion(
				`${baseUrl}/v3/company/${tokens.realm_id}/query`,
			);

			await this.checkRateLimit();

			const fetchResponse = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
					Accept: "application/json",
					"Content-Type": "application/text",
				},
				body: paginatedSql,
			});

			if (!fetchResponse.ok) {
				const errorData = (await fetchResponse
					.json()
					.catch(() => ({}))) as Record<string, unknown>;
				throw handleQuickBooksError({
					status: fetchResponse.status,
					...errorData,
				});
			}

			const data = (await fetchResponse.json()) as QueryResponse<T>;

			// Extract the entity array from QueryResponse
			const keys = Object.keys(data.QueryResponse).filter(
				(k) => !["startPosition", "maxResults", "totalCount"].includes(k),
			);
			const entityKey = keys[0];
			const pageResults = entityKey
				? (data.QueryResponse[entityKey] as T[])
				: [];

			allResults.push(...pageResults);

			this.log(
				"debug",
				`Fetched page at position ${startPosition}, got ${pageResults.length} results (total: ${allResults.length})`,
			);

			// If we got fewer results than requested, we've reached the end
			if (pageResults.length < maxResults) {
				break;
			}

			startPosition += maxResults;
		}

		return allResults;
	}

	// ============================================
	// Invoice Methods
	// ============================================

	async getInvoice(id: string): Promise<Invoice> {
		const response = await this.request<{ Invoice: Invoice }>(
			"GET",
			`/invoice/${id}`,
		);
		return response.Invoice;
	}

	async getInvoices(where?: string): Promise<Invoice[]> {
		const sql = where
			? `SELECT * FROM Invoice WHERE ${where}`
			: "SELECT * FROM Invoice";
		return this.queryAll<Invoice>(sql);
	}

	async createInvoice(invoice: Partial<Invoice>): Promise<Invoice> {
		const response = await this.request<{ Invoice: Invoice }>(
			"POST",
			"/invoice",
			invoice,
		);
		return response.Invoice;
	}

	async updateInvoice(invoice: Invoice): Promise<Invoice> {
		const response = await this.request<{ Invoice: Invoice }>(
			"POST",
			"/invoice",
			invoice,
		);
		return response.Invoice;
	}

	async deleteInvoice(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/invoice?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// Customer Methods
	// ============================================

	async getCustomer(id: string): Promise<Customer> {
		const response = await this.request<{ Customer: Customer }>(
			"GET",
			`/customer/${id}`,
		);
		return response.Customer;
	}

	async getCustomers(where?: string): Promise<Customer[]> {
		const sql = where
			? `SELECT * FROM Customer WHERE ${where}`
			: "SELECT * FROM Customer";
		return this.queryAll<Customer>(sql);
	}

	async createCustomer(customer: Partial<Customer>): Promise<Customer> {
		const response = await this.request<{ Customer: Customer }>(
			"POST",
			"/customer",
			customer,
		);
		return response.Customer;
	}

	async updateCustomer(customer: Customer): Promise<Customer> {
		const response = await this.request<{ Customer: Customer }>(
			"POST",
			"/customer",
			customer,
		);
		return response.Customer;
	}

	// ============================================
	// Payment Methods
	// ============================================

	async getPayment(id: string): Promise<Payment> {
		const response = await this.request<{ Payment: Payment }>(
			"GET",
			`/payment/${id}`,
		);
		return response.Payment;
	}

	async getPayments(where?: string): Promise<Payment[]> {
		const sql = where
			? `SELECT * FROM Payment WHERE ${where}`
			: "SELECT * FROM Payment";
		return this.queryAll<Payment>(sql);
	}

	async createPayment(payment: Partial<Payment>): Promise<Payment> {
		const response = await this.request<{ Payment: Payment }>(
			"POST",
			"/payment",
			payment,
		);
		return response.Payment;
	}

	// ============================================
	// Account Methods
	// ============================================

	async getAccount(id: string): Promise<Account> {
		const response = await this.request<{ Account: Account }>(
			"GET",
			`/account/${id}`,
		);
		return response.Account;
	}

	async getAccounts(where?: string): Promise<Account[]> {
		const sql = where
			? `SELECT * FROM Account WHERE ${where}`
			: "SELECT * FROM Account WHERE Active = true";
		return this.queryAll<Account>(sql);
	}

	// ============================================
	// Vendor Methods
	// ============================================

	async getVendor(id: string): Promise<Vendor> {
		const response = await this.request<{ Vendor: Vendor }>(
			"GET",
			`/vendor/${id}`,
		);
		return response.Vendor;
	}

	async getVendors(where?: string): Promise<Vendor[]> {
		const sql = where
			? `SELECT * FROM Vendor WHERE ${where}`
			: "SELECT * FROM Vendor";
		return this.queryAll<Vendor>(sql);
	}

	async createVendor(vendor: Partial<Vendor>): Promise<Vendor> {
		const response = await this.request<{ Vendor: Vendor }>(
			"POST",
			"/vendor",
			vendor,
		);
		return response.Vendor;
	}

	async updateVendor(vendor: Vendor): Promise<Vendor> {
		const response = await this.request<{ Vendor: Vendor }>(
			"POST",
			"/vendor",
			vendor,
		);
		return response.Vendor;
	}

	// ============================================
	// Bill Methods
	// ============================================

	async getBill(id: string): Promise<Bill> {
		const response = await this.request<{ Bill: Bill }>("GET", `/bill/${id}`);
		return response.Bill;
	}

	async getBills(where?: string): Promise<Bill[]> {
		const sql = where
			? `SELECT * FROM Bill WHERE ${where}`
			: "SELECT * FROM Bill";
		return this.queryAll<Bill>(sql);
	}

	async createBill(bill: Partial<Bill>): Promise<Bill> {
		const response = await this.request<{ Bill: Bill }>("POST", "/bill", bill);
		return response.Bill;
	}

	async updateBill(bill: Bill): Promise<Bill> {
		const response = await this.request<{ Bill: Bill }>("POST", "/bill", bill);
		return response.Bill;
	}

	async deleteBill(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/bill?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// BillPayment Methods
	// ============================================

	async getBillPayment(id: string): Promise<BillPayment> {
		const response = await this.request<{ BillPayment: BillPayment }>(
			"GET",
			`/billpayment/${id}`,
		);
		return response.BillPayment;
	}

	async getBillPayments(where?: string): Promise<BillPayment[]> {
		const sql = where
			? `SELECT * FROM BillPayment WHERE ${where}`
			: "SELECT * FROM BillPayment";
		return this.queryAll<BillPayment>(sql);
	}

	async createBillPayment(
		billPayment: Partial<BillPayment>,
	): Promise<BillPayment> {
		const response = await this.request<{ BillPayment: BillPayment }>(
			"POST",
			"/billpayment",
			billPayment,
		);
		return response.BillPayment;
	}

	async updateBillPayment(billPayment: BillPayment): Promise<BillPayment> {
		const response = await this.request<{ BillPayment: BillPayment }>(
			"POST",
			"/billpayment",
			billPayment,
		);
		return response.BillPayment;
	}

	async deleteBillPayment(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/billpayment?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// CreditMemo Methods (customer-facing credit notes)
	// ============================================

	async getCreditMemo(id: string): Promise<CreditMemo> {
		const response = await this.request<{ CreditMemo: CreditMemo }>(
			"GET",
			`/creditmemo/${id}`,
		);
		return response.CreditMemo;
	}

	async getCreditMemos(where?: string): Promise<CreditMemo[]> {
		const sql = where
			? `SELECT * FROM CreditMemo WHERE ${where}`
			: "SELECT * FROM CreditMemo";
		return this.queryAll<CreditMemo>(sql);
	}

	async createCreditMemo(creditMemo: Partial<CreditMemo>): Promise<CreditMemo> {
		const response = await this.request<{ CreditMemo: CreditMemo }>(
			"POST",
			"/creditmemo",
			creditMemo,
		);
		return response.CreditMemo;
	}

	async updateCreditMemo(creditMemo: CreditMemo): Promise<CreditMemo> {
		const response = await this.request<{ CreditMemo: CreditMemo }>(
			"POST",
			"/creditmemo",
			creditMemo,
		);
		return response.CreditMemo;
	}

	async deleteCreditMemo(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/creditmemo?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// VendorCredit Methods (supplier-side credit notes)
	// ============================================

	async getVendorCredit(id: string): Promise<VendorCredit> {
		const response = await this.request<{ VendorCredit: VendorCredit }>(
			"GET",
			`/vendorcredit/${id}`,
		);
		return response.VendorCredit;
	}

	async getVendorCredits(where?: string): Promise<VendorCredit[]> {
		const sql = where
			? `SELECT * FROM VendorCredit WHERE ${where}`
			: "SELECT * FROM VendorCredit";
		return this.queryAll<VendorCredit>(sql);
	}

	async createVendorCredit(
		vendorCredit: Partial<VendorCredit>,
	): Promise<VendorCredit> {
		const response = await this.request<{ VendorCredit: VendorCredit }>(
			"POST",
			"/vendorcredit",
			vendorCredit,
		);
		return response.VendorCredit;
	}

	async updateVendorCredit(vendorCredit: VendorCredit): Promise<VendorCredit> {
		const response = await this.request<{ VendorCredit: VendorCredit }>(
			"POST",
			"/vendorcredit",
			vendorCredit,
		);
		return response.VendorCredit;
	}

	async deleteVendorCredit(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/vendorcredit?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// TaxCode Methods (read-only in QBO API)
	// ============================================

	async getTaxCode(id: string): Promise<TaxCode> {
		const response = await this.request<{ TaxCode: TaxCode }>(
			"GET",
			`/taxcode/${id}`,
		);
		return response.TaxCode;
	}

	async getTaxCodes(where?: string): Promise<TaxCode[]> {
		const sql = where
			? `SELECT * FROM TaxCode WHERE ${where}`
			: "SELECT * FROM TaxCode";
		return this.queryAll<TaxCode>(sql);
	}

	// ============================================
	// TaxRate Methods (read-only in QBO API)
	// ============================================

	async getTaxRate(id: string): Promise<TaxRate> {
		const response = await this.request<{ TaxRate: TaxRate }>(
			"GET",
			`/taxrate/${id}`,
		);
		return response.TaxRate;
	}

	async getTaxRates(where?: string): Promise<TaxRate[]> {
		const sql = where
			? `SELECT * FROM TaxRate WHERE ${where}`
			: "SELECT * FROM TaxRate";
		return this.queryAll<TaxRate>(sql);
	}

	// ============================================
	// Item Methods
	// ============================================

	async getItem(id: string): Promise<Item> {
		const response = await this.request<{ Item: Item }>("GET", `/item/${id}`);
		return response.Item;
	}

	async getItems(where?: string): Promise<Item[]> {
		const sql = where
			? `SELECT * FROM Item WHERE ${where}`
			: "SELECT * FROM Item WHERE Active = true";
		return this.queryAll<Item>(sql);
	}

	async createItem(item: Partial<Item>): Promise<Item> {
		const response = await this.request<{ Item: Item }>("POST", "/item", item);
		return response.Item;
	}

	async updateItem(item: Item): Promise<Item> {
		const response = await this.request<{ Item: Item }>("POST", "/item", item);
		return response.Item;
	}

	// ============================================
	// Attachable Methods
	// ============================================

	async getAttachable(id: string): Promise<Attachable> {
		const response = await this.request<{ Attachable: Attachable }>(
			"GET",
			`/attachable/${id}`,
		);
		return response.Attachable;
	}

	async getAttachables(where?: string): Promise<Attachable[]> {
		const sql = where
			? `SELECT * FROM Attachable WHERE ${where}`
			: "SELECT * FROM Attachable";
		return this.queryAll<Attachable>(sql);
	}

	/**
	 * Upload a file and attach it to an entity.
	 * Uses multipart/form-data — the QBO upload endpoint differs from standard CRUD.
	 */
	async uploadAttachable(
		file: Blob | Buffer,
		fileName: string,
		contentType: string,
		attachTo?: { entityType: string; entityId: string },
	): Promise<Attachable> {
		await this.checkRateLimit();

		const tokens = await this.getValidTokens();
		const env = this.config.environment || "production";
		const baseUrl = API_BASE[env];
		const url = this.appendMinorVersion(
			`${baseUrl}/v3/company/${tokens.realm_id}/upload`,
		);

		const metadata: Partial<Attachable> = {
			FileName: fileName,
			ContentType: contentType,
		};

		if (attachTo) {
			metadata.AttachableRef = [
				{
					EntityRef: {
						value: attachTo.entityId,
						name: attachTo.entityType,
					},
				},
			];
		}

		// Build multipart form
		const formData = new FormData();
		formData.append(
			"file_metadata_0",
			new Blob([JSON.stringify(metadata)], { type: "application/json" }),
		);

		const fileBlob =
			file instanceof Buffer ? new Blob([file], { type: contentType }) : file;
		formData.append("file_content_0", fileBlob, fileName);

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
					Accept: "application/json",
				},
				body: formData,
			});

			if (!response.ok) {
				const errorData = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				throw { status: response.status, ...errorData };
			}

			const data = (await response.json()) as {
				AttachableResponse: Array<{ Attachable: Attachable }>;
			};
			return data.AttachableResponse[0].Attachable;
		} catch (error) {
			throw handleQuickBooksError(error);
		}
	}

	async updateAttachable(attachable: Attachable): Promise<Attachable> {
		const response = await this.request<{ Attachable: Attachable }>(
			"POST",
			"/attachable",
			attachable,
		);
		return response.Attachable;
	}

	async deleteAttachable(id: string, syncToken: string): Promise<void> {
		await this.request("POST", "/attachable?operation=delete", {
			Id: id,
			SyncToken: syncToken,
		});
	}

	// ============================================
	// Batch Operations
	// ============================================

	/**
	 * Execute a batch of up to 30 operations in a single API call.
	 * Each item needs a unique bId and the entity payload.
	 *
	 * @example
	 * ```ts
	 * const results = await client.batch([
	 *   { bId: "1", operation: "create", Bill: { VendorRef: { value: "1" }, Line: [...] } },
	 *   { bId: "2", operation: "query", optionsData: "SELECT * FROM Vendor WHERE Id = '1'" },
	 * ]);
	 * ```
	 */
	async batch(items: BatchItemRequest[]): Promise<BatchResponse> {
		if (items.length > 30) {
			throw new QuickBooksError(
				"Batch operations are limited to 30 items per request",
				QB_ERROR_CODES.INVALID_CONFIG,
			);
		}

		const response = await this.request<BatchResponse>("POST", "/batch", {
			BatchItemRequest: items,
		});

		return response;
	}

	// ============================================
	// Utility Methods
	// ============================================

	/**
	 * Get company info
	 */
	async getCompanyInfo(): Promise<CompanyInfo> {
		const tokens = await this.getValidTokens();
		const response = await this.request<{ CompanyInfo: CompanyInfo }>(
			"GET",
			`/companyinfo/${tokens.realm_id}`,
		);
		return response.CompanyInfo;
	}

	/**
	 * Check if connected to QuickBooks
	 */
	async isConnected(): Promise<boolean> {
		try {
			const tokens = await this.tokenStore.getTokens();
			return tokens !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Check connection status with details
	 */
	async getConnectionStatus(): Promise<{
		isConnected: boolean;
		needsRefresh: boolean;
		realmId?: string;
		expiresAt?: number;
	}> {
		const tokens = await this.tokenStore.getTokens();

		if (!tokens) {
			return { isConnected: false, needsRefresh: false };
		}

		return {
			isConnected: true,
			needsRefresh: isTokenExpired(tokens.expires_at),
			realmId: tokens.realm_id,
			expiresAt: tokens.expires_at,
		};
	}
}
