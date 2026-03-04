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
	/** QBO API minor version (e.g. 75). Appended to all API URLs. */
	minorVersion?: number;
	/** Optional logging hook */
	onLog?: (
		level: "debug" | "info" | "warn" | "error",
		message: string,
		data?: unknown,
	) => void;
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

/** Ref type used throughout QBO entities */
export interface Ref {
	value: string;
	name?: string;
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

/** Address */
export interface Address {
	Id?: string;
	Line1?: string;
	Line2?: string;
	City?: string;
	CountrySubDivisionCode?: string;
	PostalCode?: string;
	Country?: string;
}

// ============================================
// Invoice
// ============================================

export interface Invoice extends BaseEntity {
	DocNumber?: string;
	TxnDate?: string;
	DueDate?: string;
	TotalAmt?: number;
	Balance?: number;
	CustomerRef?: Ref;
	Line?: InvoiceLine[];
	BillEmail?: {
		Address?: string;
	};
	CurrencyRef?: Ref;
	TxnTaxDetail?: TxnTaxDetail;
	PrivateNote?: string;
}

export interface InvoiceLine {
	Id?: string;
	LineNum?: number;
	Description?: string;
	Amount?: number;
	DetailType?:
		| "SalesItemLineDetail"
		| "SubTotalLineDetail"
		| "DiscountLineDetail"
		| "GroupLineDetail"
		| string;
	SalesItemLineDetail?: {
		ItemRef?: Ref;
		TaxCodeRef?: Ref;
		Qty?: number;
		UnitPrice?: number;
	};
}

// ============================================
// Customer
// ============================================

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

// ============================================
// Payment
// ============================================

export interface Payment extends BaseEntity {
	TxnDate?: string;
	TotalAmt?: number;
	CustomerRef?: Ref;
	DepositToAccountRef?: Ref;
	PaymentMethodRef?: Ref;
	Line?: PaymentLine[];
}

export interface PaymentLine {
	Amount?: number;
	LinkedTxn?: Array<{
		TxnId: string;
		TxnType: string;
	}>;
}

// ============================================
// Account
// ============================================

export interface Account extends BaseEntity {
	Name?: string;
	AccountType?: string;
	AccountSubType?: string;
	CurrentBalance?: number;
	Active?: boolean;
	Classification?: string;
	FullyQualifiedName?: string;
	CurrencyRef?: Ref;
}

// ============================================
// Vendor
// ============================================

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
	TaxIdentifier?: string;
	CurrencyRef?: Ref;
}

// ============================================
// Bill
// ============================================

export interface Bill extends BaseEntity {
	DocNumber?: string;
	TxnDate?: string;
	DueDate?: string;
	TotalAmt?: number;
	Balance?: number;
	VendorRef?: Ref;
	APAccountRef?: Ref;
	Line?: BillLine[];
	TxnTaxDetail?: TxnTaxDetail;
	PrivateNote?: string;
	CurrencyRef?: Ref;
	DepartmentRef?: Ref;
}

export interface BillLine {
	Id?: string;
	LineNum?: number;
	Description?: string;
	Amount?: number;
	DetailType?:
		| "AccountBasedExpenseLineDetail"
		| "ItemBasedExpenseLineDetail"
		| string;
	AccountBasedExpenseLineDetail?: {
		AccountRef?: Ref;
		TaxCodeRef?: Ref;
		BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
		CustomerRef?: Ref;
		TaxAmount?: number;
	};
	ItemBasedExpenseLineDetail?: {
		ItemRef?: Ref;
		TaxCodeRef?: Ref;
		BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
		CustomerRef?: Ref;
		Qty?: number;
		UnitPrice?: number;
	};
}

// ============================================
// BillPayment
// ============================================

export interface BillPayment extends BaseEntity {
	VendorRef?: Ref;
	TotalAmt?: number;
	PayType?: "Check" | "CreditCard";
	DocNumber?: string;
	TxnDate?: string;
	APAccountRef?: Ref;
	DepartmentRef?: Ref;
	CurrencyRef?: Ref;
	PrivateNote?: string;
	Line?: BillPaymentLine[];
	CheckPayment?: {
		BankAccountRef?: Ref;
		PrintStatus?: "NeedToPrint" | "NotSet";
	};
	CreditCardPayment?: {
		CCAccountRef?: Ref;
	};
}

export interface BillPaymentLine {
	Amount?: number;
	LinkedTxn?: Array<{
		TxnId: string;
		TxnType: "Bill" | string;
	}>;
}

// ============================================
// CreditMemo (Credit Note)
// ============================================

export interface CreditMemo extends BaseEntity {
	DocNumber?: string;
	TxnDate?: string;
	TotalAmt?: number;
	Balance?: number;
	RemainingCredit?: number;
	CustomerRef?: Ref;
	Line?: CreditMemoLine[];
	BillEmail?: {
		Address?: string;
	};
	CurrencyRef?: Ref;
	TxnTaxDetail?: TxnTaxDetail;
	PrivateNote?: string;
	DepartmentRef?: Ref;
}

export interface CreditMemoLine {
	Id?: string;
	LineNum?: number;
	Description?: string;
	Amount?: number;
	DetailType?: "SalesItemLineDetail" | "SubTotalLineDetail" | string;
	SalesItemLineDetail?: {
		ItemRef?: Ref;
		TaxCodeRef?: Ref;
		Qty?: number;
		UnitPrice?: number;
	};
}

// ============================================
// VendorCredit (supplier-side credit note)
// ============================================

export interface VendorCredit extends BaseEntity {
	DocNumber?: string;
	TxnDate?: string;
	TotalAmt?: number;
	Balance?: number;
	VendorRef?: Ref;
	APAccountRef?: Ref;
	Line?: VendorCreditLine[];
	CurrencyRef?: Ref;
	PrivateNote?: string;
	DepartmentRef?: Ref;
}

export interface VendorCreditLine {
	Id?: string;
	LineNum?: number;
	Description?: string;
	Amount?: number;
	DetailType?:
		| "AccountBasedExpenseLineDetail"
		| "ItemBasedExpenseLineDetail"
		| string;
	AccountBasedExpenseLineDetail?: {
		AccountRef?: Ref;
		TaxCodeRef?: Ref;
		BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
		CustomerRef?: Ref;
	};
	ItemBasedExpenseLineDetail?: {
		ItemRef?: Ref;
		TaxCodeRef?: Ref;
		BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
		CustomerRef?: Ref;
		Qty?: number;
		UnitPrice?: number;
	};
}

// ============================================
// Tax
// ============================================

export interface TaxCode extends BaseEntity {
	Name?: string;
	Description?: string;
	Active?: boolean;
	Taxable?: boolean;
	TaxGroup?: boolean;
	SalesTaxRateList?: {
		TaxRateDetail?: TaxRateDetail[];
	};
	PurchaseTaxRateList?: {
		TaxRateDetail?: TaxRateDetail[];
	};
}

export interface TaxRateDetail {
	TaxRateRef?: Ref;
	TaxTypeApplicable?: "TaxOnAmount" | "TaxOnAmountPlusTax" | "TaxOnTax";
	TaxOrder?: number;
}

export interface TaxRate extends BaseEntity {
	Name?: string;
	Description?: string;
	RateValue?: number;
	Active?: boolean;
	AgencyRef?: Ref;
	TaxReturnLineRef?: Ref;
	SpecialTaxType?: string;
	DisplayType?: string;
}

/** Tax detail block used on transactions (Invoice, Bill, CreditMemo, etc.) */
export interface TxnTaxDetail {
	TxnTaxCodeRef?: Ref;
	TotalTax?: number;
	TaxLine?: TaxLine[];
}

export interface TaxLine {
	Amount?: number;
	DetailType?: "TaxLineDetail";
	TaxLineDetail?: {
		TaxRateRef?: Ref;
		PercentBased?: boolean;
		TaxPercent?: number;
		NetAmountTaxable?: number;
		TaxInclusiveAmount?: number;
		OverrideDeltaAmount?: number;
	};
}

// ============================================
// Attachable (file attachments)
// ============================================

export interface Attachable extends BaseEntity {
	FileName?: string;
	FileAccessUri?: string;
	TempDownloadUri?: string;
	Size?: number;
	ContentType?: string;
	Category?: string;
	Lat?: string;
	Long?: string;
	PlaceName?: string;
	Note?: string;
	Tag?: string;
	ThumbnailFileAccessUri?: string;
	ThumbnailTempDownloadUri?: string;
	AttachableRef?: AttachableRef[];
}

export interface AttachableRef {
	EntityRef?: Ref;
	IncludeOnSend?: boolean;
	LineInfo?: string;
	NoRefOnly?: boolean;
	/** e.g. "Bill", "Invoice", "VendorCredit" */
	Inactive?: boolean;
}

// ============================================
// CompanyInfo
// ============================================

export interface CompanyInfo extends BaseEntity {
	CompanyName?: string;
	LegalName?: string;
	CompanyAddr?: Address;
	CustomerCommunicationAddr?: Address;
	LegalAddr?: Address;
	PrimaryPhone?: {
		FreeFormNumber?: string;
	};
	CompanyStartDate?: string;
	FiscalYearStartMonth?: string;
	Country?: string;
	Email?: {
		Address?: string;
	};
	WebAddr?: {
		URI?: string;
	};
	SupportedLanguages?: string;
	NameValue?: Array<{
		Name: string;
		Value: string;
	}>;
}

// ============================================
// Item
// ============================================

export interface Item extends BaseEntity {
	Name?: string;
	Description?: string;
	Active?: boolean;
	FullyQualifiedName?: string;
	Type?: "Inventory" | "Service" | "NonInventory";
	UnitPrice?: number;
	PurchaseCost?: number;
	QtyOnHand?: number;
	IncomeAccountRef?: Ref;
	ExpenseAccountRef?: Ref;
	AssetAccountRef?: Ref;
	Taxable?: boolean;
	SalesTaxIncluded?: boolean;
	PurchaseTaxIncluded?: boolean;
	SalesTaxCodeRef?: Ref;
	PurchaseTaxCodeRef?: Ref;
}

// ============================================
// Batch Operations
// ============================================

export interface BatchItemRequest {
	/** Unique ID for this batch item (you choose) */
	bId: string;
	/** Operation to perform */
	operation: "create" | "update" | "delete" | "query";
	/** Only for non-query operations: entity name e.g. "Bill", "Invoice" */
	optionsData?: string;
	/** The entity payload (for create/update/delete) */
	[entityName: string]: unknown;
}

export interface BatchItemResponse {
	bId: string;
	[key: string]: unknown;
	Fault?: {
		Error?: Array<{
			Message?: string;
			Detail?: string;
			code?: string;
		}>;
		type?: string;
	};
}

export interface BatchResponse {
	BatchItemResponse: BatchItemResponse[];
	time?: string;
}
