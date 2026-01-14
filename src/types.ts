/**
 * QuickBooks Client Types
 */

/** OAuth token data */
export interface QuickBooksTokens {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at: number;
  token_type?: string;
}

/** Configuration for the QuickBooks client */
export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment?: "sandbox" | "production";
  scopes?: string[];
}

/** Options for initializing the client */
export interface QuickBooksClientOptions extends QuickBooksConfig {
  tokenStore: TokenStore;
  /** Optional logging hook */
  onLog?: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
}

/** Token storage interface - implement this for your storage backend */
export interface TokenStore {
  /** Get stored tokens */
  getTokens(): Promise<QuickBooksTokens | null>;
  /** Store tokens */
  storeTokens(tokens: QuickBooksTokens): Promise<void>;
  /** Clear stored tokens */
  clearTokens(): Promise<void>;
}

/** OAuth token response from Intuit */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

/** QuickBooks API error response */
export interface QuickBooksApiError {
  Fault?: {
    Error?: Array<{
      Message?: string;
      Detail?: string;
      code?: string;
    }>;
    type?: string;
  };
}

/** Query response wrapper */
export interface QueryResponse<T> {
  QueryResponse: Record<string, T[] | number | undefined> & {
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
  time?: string;
}

/** Base entity with common fields */
export interface BaseEntity {
  Id?: string;
  SyncToken?: string;
  MetaData?: {
    CreateTime?: string;
    LastUpdatedTime?: string;
  };
}

/** Invoice entity */
export interface Invoice extends BaseEntity {
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: {
    value: string;
    name?: string;
  };
  Line?: InvoiceLine[];
  BillEmail?: {
    Address?: string;
  };
  CurrencyRef?: {
    value: string;
    name?: string;
  };
}

export interface InvoiceLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount?: number;
  DetailType?: string;
  SalesItemLineDetail?: {
    ItemRef?: {
      value: string;
      name?: string;
    };
    Qty?: number;
    UnitPrice?: number;
  };
}

/** Customer entity */
export interface Customer extends BaseEntity {
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  BillAddr?: Address;
  ShipAddr?: Address;
  Balance?: number;
  Active?: boolean;
}

export interface Address {
  Id?: string;
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
}

/** Payment entity */
export interface Payment extends BaseEntity {
  TxnDate?: string;
  TotalAmt?: number;
  CustomerRef?: {
    value: string;
    name?: string;
  };
  DepositToAccountRef?: {
    value: string;
    name?: string;
  };
  PaymentMethodRef?: {
    value: string;
    name?: string;
  };
  Line?: PaymentLine[];
}

export interface PaymentLine {
  Amount?: number;
  LinkedTxn?: Array<{
    TxnId: string;
    TxnType: string;
  }>;
}

/** Account entity */
export interface Account extends BaseEntity {
  Name?: string;
  AccountType?: string;
  AccountSubType?: string;
  CurrentBalance?: number;
  Active?: boolean;
  Classification?: string;
  FullyQualifiedName?: string;
}

/** Vendor entity */
export interface Vendor extends BaseEntity {
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  BillAddr?: Address;
  Balance?: number;
  Active?: boolean;
}

/** Bill entity */
export interface Bill extends BaseEntity {
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef?: {
    value: string;
    name?: string;
  };
  Line?: BillLine[];
}

export interface BillLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount?: number;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: {
    AccountRef?: {
      value: string;
      name?: string;
    };
  };
}

/** Item entity */
export interface Item extends BaseEntity {
  Name?: string;
  Description?: string;
  Active?: boolean;
  FullyQualifiedName?: string;
  Type?: "Inventory" | "Service" | "NonInventory";
  UnitPrice?: number;
  PurchaseCost?: number;
  QtyOnHand?: number;
  IncomeAccountRef?: {
    value: string;
    name?: string;
  };
  ExpenseAccountRef?: {
    value: string;
    name?: string;
  };
}
