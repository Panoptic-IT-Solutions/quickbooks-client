# @panoptic/quickbooks-client

QuickBooks Online API client with OAuth 2.0, rate limiting, and typed entities.

## Installation

```bash
npm install @panoptic/quickbooks-client
```

## Quick Start

```typescript
import { QuickBooksClient, generateAuthUrl, exchangeCodeForTokens, generateState } from '@panoptic/quickbooks-client';
import type { TokenStore, QuickBooksTokens } from '@panoptic/quickbooks-client';

// 1. Implement TokenStore for your storage backend
const tokenStore: TokenStore = {
  async getTokens() {
    // Return stored tokens or null
    return db.getQuickBooksTokens();
  },
  async storeTokens(tokens) {
    // Store tokens
    await db.saveQuickBooksTokens(tokens);
  },
  async clearTokens() {
    // Clear tokens
    await db.deleteQuickBooksTokens();
  }
};

// 2. Create the client
const client = new QuickBooksClient({
  clientId: process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  redirectUri: process.env.QB_REDIRECT_URI,
  environment: 'production', // or 'sandbox'
  tokenStore,
});

// 3. Use the client
const invoices = await client.getInvoices();
const customers = await client.getCustomers('Active = true');
```

## OAuth Flow

### Generate Authorization URL

```typescript
import { generateAuthUrl, generateState } from '@panoptic/quickbooks-client';

const state = generateState(); // Store this for CSRF validation
const authUrl = generateAuthUrl({
  clientId: process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  redirectUri: process.env.QB_REDIRECT_URI,
}, state);

// Redirect user to authUrl
```

### Handle OAuth Callback

```typescript
import { exchangeCodeForTokens } from '@panoptic/quickbooks-client';

// In your callback handler:
const tokens = await exchangeCodeForTokens(
  {
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    redirectUri: process.env.QB_REDIRECT_URI,
  },
  code,    // from URL params
  realmId  // from URL params
);

// Store tokens using your TokenStore
await tokenStore.storeTokens(tokens);
```

## API Methods

### Invoices

```typescript
const invoices = await client.getInvoices();
const invoice = await client.getInvoice('123');
const newInvoice = await client.createInvoice({
  CustomerRef: { value: '1' },
  Line: [{ Amount: 100, DetailType: 'SalesItemLineDetail' }]
});
```

### Customers

```typescript
const customers = await client.getCustomers();
const customer = await client.getCustomer('123');
const newCustomer = await client.createCustomer({
  DisplayName: 'Acme Corp'
});
```

### Payments

```typescript
const payments = await client.getPayments();
const payment = await client.createPayment({
  CustomerRef: { value: '1' },
  TotalAmt: 100
});
```

### Bills & Vendors

```typescript
const bills = await client.getBills();
const vendors = await client.getVendors();
```

### Raw Query

```typescript
const results = await client.query<Invoice>(
  "SELECT * FROM Invoice WHERE Balance > '0'"
);
```

## Features

- **No external OAuth dependencies** - Pure fetch-based OAuth 2.0 implementation
- **Automatic token refresh** - Tokens are refreshed automatically when expired
- **Rate limiting** - Built-in 500 req/min rate limiter with exponential backoff
- **Typed entities** - Full TypeScript support for Invoice, Customer, Payment, etc.
- **Pluggable token storage** - Implement `TokenStore` interface for any backend

## TokenStore Interface

```typescript
interface TokenStore {
  getTokens(): Promise<QuickBooksTokens | null>;
  storeTokens(tokens: QuickBooksTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

interface QuickBooksTokens {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at: number;
}
```

## Error Handling

```typescript
import { QuickBooksError, QB_ERROR_CODES } from '@panoptic/quickbooks-client';

try {
  await client.getInvoices();
} catch (error) {
  if (error instanceof QuickBooksError) {
    switch (error.code) {
      case QB_ERROR_CODES.TOKEN_EXPIRED:
        // Handle expired token
        break;
      case QB_ERROR_CODES.RATE_LIMIT:
        // Handle rate limiting
        break;
      case QB_ERROR_CODES.UNAUTHORIZED:
        // Handle auth error
        break;
    }
  }
}
```

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `clientId` | Yes | - | OAuth client ID from Intuit |
| `clientSecret` | Yes | - | OAuth client secret |
| `redirectUri` | Yes | - | OAuth callback URL |
| `environment` | No | `production` | `sandbox` or `production` |
| `tokenStore` | Yes | - | Token storage implementation |
| `onLog` | No | - | Logging callback |

## License

MIT
