/**
 * QuickBooks Online API Client
 *
 * Main client class with rate limiting, auto token refresh, and typed API methods
 */

import type {
  QuickBooksClientOptions,
  QuickBooksTokens,
  TokenStore,
  QueryResponse,
  Invoice,
  Customer,
  Payment,
  Account,
  Vendor,
  Bill,
  Item,
} from "./types.js";
import { refreshTokens, isTokenExpired } from "./oauth.js";
import { QuickBooksError, QB_ERROR_CODES, handleQuickBooksError } from "./errors.js";

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

  constructor(options: QuickBooksClientOptions) {
    this.validateConfig(options);
    this.config = options;
    this.tokenStore = options.tokenStore;
    this.onLog = options.onLog;
  }

  private validateConfig(options: QuickBooksClientOptions): void {
    if (!options.clientId) {
      throw new QuickBooksError("clientId is required", QB_ERROR_CODES.INVALID_CONFIG);
    }
    if (!options.clientSecret) {
      throw new QuickBooksError("clientSecret is required", QB_ERROR_CODES.INVALID_CONFIG);
    }
    if (!options.redirectUri) {
      throw new QuickBooksError("redirectUri is required", QB_ERROR_CODES.INVALID_CONFIG);
    }
    if (!options.tokenStore) {
      throw new QuickBooksError("tokenStore is required", QB_ERROR_CODES.INVALID_CONFIG);
    }
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
    if (this.onLog) {
      this.onLog(level, message, data);
    }
  }

  /**
   * Rate limiting - ensures we don't exceed 500 requests/minute
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();

    // Remove timestamps older than the rate limit window
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
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
        QB_ERROR_CODES.UNAUTHORIZED
      );
    }

    // Check if token needs refresh (with 5 minute buffer)
    if (isTokenExpired(tokens.expires_at)) {
      this.log("info", "Token expired, refreshing...");

      try {
        const newTokens = await refreshTokens(
          this.config,
          tokens.refresh_token,
          tokens.realm_id
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
    retryCount = 0
  ): Promise<T> {
    await this.checkRateLimit();

    const tokens = await this.getValidTokens();
    const env = this.config.environment || "production";
    const baseUrl = API_BASE[env];
    const url = `${baseUrl}/v3/company/${tokens.realm_id}${endpoint}`;

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
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);

        this.log("warn", `Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1})`);
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
            tokens.realm_id
          );
          await this.tokenStore.storeTokens(newTokens);

          return this.request<T>(method, endpoint, body, retryCount + 1);
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
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
    const url = `${baseUrl}/v3/company/${tokens.realm_id}/query`;

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
      const errorData = await fetchResponse.json().catch(() => ({})) as Record<string, unknown>;
      throw handleQuickBooksError({ status: fetchResponse.status, ...errorData });
    }

    const data = (await fetchResponse.json()) as QueryResponse<T>;

    // Extract the entity array from QueryResponse
    const keys = Object.keys(data.QueryResponse).filter(
      (k) => !["startPosition", "maxResults", "totalCount"].includes(k)
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
      const url = `${baseUrl}/v3/company/${tokens.realm_id}/query`;

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
        const errorData = await fetchResponse.json().catch(() => ({})) as Record<string, unknown>;
        throw handleQuickBooksError({ status: fetchResponse.status, ...errorData });
      }

      const data = (await fetchResponse.json()) as QueryResponse<T>;

      // Extract the entity array from QueryResponse
      const keys = Object.keys(data.QueryResponse).filter(
        (k) => !["startPosition", "maxResults", "totalCount"].includes(k)
      );
      const entityKey = keys[0];
      const pageResults = entityKey ? (data.QueryResponse[entityKey] as T[]) : [];

      allResults.push(...pageResults);

      this.log("debug", `Fetched page at position ${startPosition}, got ${pageResults.length} results (total: ${allResults.length})`);

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
    const response = await this.request<{ Invoice: Invoice }>("GET", `/invoice/${id}`);
    return response.Invoice;
  }

  async getInvoices(where?: string): Promise<Invoice[]> {
    const sql = where
      ? `SELECT * FROM Invoice WHERE ${where}`
      : "SELECT * FROM Invoice";
    return this.query<Invoice>(sql);
  }

  async createInvoice(invoice: Partial<Invoice>): Promise<Invoice> {
    const response = await this.request<{ Invoice: Invoice }>("POST", "/invoice", invoice);
    return response.Invoice;
  }

  async updateInvoice(invoice: Invoice): Promise<Invoice> {
    const response = await this.request<{ Invoice: Invoice }>("POST", "/invoice", invoice);
    return response.Invoice;
  }

  async deleteInvoice(id: string, syncToken: string): Promise<void> {
    await this.request("POST", "/invoice", {
      Id: id,
      SyncToken: syncToken,
    });
  }

  // ============================================
  // Customer Methods
  // ============================================

  async getCustomer(id: string): Promise<Customer> {
    const response = await this.request<{ Customer: Customer }>("GET", `/customer/${id}`);
    return response.Customer;
  }

  async getCustomers(where?: string): Promise<Customer[]> {
    const sql = where
      ? `SELECT * FROM Customer WHERE ${where}`
      : "SELECT * FROM Customer";
    return this.query<Customer>(sql);
  }

  async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    const response = await this.request<{ Customer: Customer }>("POST", "/customer", customer);
    return response.Customer;
  }

  async updateCustomer(customer: Customer): Promise<Customer> {
    const response = await this.request<{ Customer: Customer }>("POST", "/customer", customer);
    return response.Customer;
  }

  // ============================================
  // Payment Methods
  // ============================================

  async getPayment(id: string): Promise<Payment> {
    const response = await this.request<{ Payment: Payment }>("GET", `/payment/${id}`);
    return response.Payment;
  }

  async getPayments(where?: string): Promise<Payment[]> {
    const sql = where
      ? `SELECT * FROM Payment WHERE ${where}`
      : "SELECT * FROM Payment";
    return this.query<Payment>(sql);
  }

  async createPayment(payment: Partial<Payment>): Promise<Payment> {
    const response = await this.request<{ Payment: Payment }>("POST", "/payment", payment);
    return response.Payment;
  }

  // ============================================
  // Account Methods
  // ============================================

  async getAccount(id: string): Promise<Account> {
    const response = await this.request<{ Account: Account }>("GET", `/account/${id}`);
    return response.Account;
  }

  async getAccounts(where?: string): Promise<Account[]> {
    const sql = where
      ? `SELECT * FROM Account WHERE ${where}`
      : "SELECT * FROM Account WHERE Active = true";
    return this.query<Account>(sql);
  }

  // ============================================
  // Vendor Methods
  // ============================================

  async getVendor(id: string): Promise<Vendor> {
    const response = await this.request<{ Vendor: Vendor }>("GET", `/vendor/${id}`);
    return response.Vendor;
  }

  async getVendors(where?: string): Promise<Vendor[]> {
    const sql = where
      ? `SELECT * FROM Vendor WHERE ${where}`
      : "SELECT * FROM Vendor";
    return this.query<Vendor>(sql);
  }

  async createVendor(vendor: Partial<Vendor>): Promise<Vendor> {
    const response = await this.request<{ Vendor: Vendor }>("POST", "/vendor", vendor);
    return response.Vendor;
  }

  async updateVendor(vendor: Vendor): Promise<Vendor> {
    const response = await this.request<{ Vendor: Vendor }>("POST", "/vendor", vendor);
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
    return this.query<Bill>(sql);
  }

  async createBill(bill: Partial<Bill>): Promise<Bill> {
    const response = await this.request<{ Bill: Bill }>("POST", "/bill", bill);
    return response.Bill;
  }

  async updateBill(bill: Bill): Promise<Bill> {
    const response = await this.request<{ Bill: Bill }>("POST", "/bill", bill);
    return response.Bill;
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
    return this.query<Item>(sql);
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
  // Utility Methods
  // ============================================

  /**
   * Get company info
   */
  async getCompanyInfo(): Promise<unknown> {
    const tokens = await this.getValidTokens();
    const response = await this.request<{ CompanyInfo: unknown }>(
      "GET",
      `/companyinfo/${tokens.realm_id}`
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
