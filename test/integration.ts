/**
 * Integration test server for QuickBooks client
 *
 * Run with: npx tsx test/integration.ts
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import {
  QuickBooksClient,
  generateAuthUrl,
  exchangeCodeForTokens,
  generateState,
  type QuickBooksTokens,
  type TokenStore,
} from "../src/index.js";

// Load from environment
const config = {
  clientId: process.env.QB_CLIENT_ID!,
  clientSecret: process.env.QB_CLIENT_SECRET!,
  redirectUri: process.env.QB_REDIRECT_URI || "http://localhost:3000/callback",
  environment: "sandbox" as const,
};

// Validate config
if (!config.clientId || !config.clientSecret) {
  console.error("Missing QB_CLIENT_ID or QB_CLIENT_SECRET environment variables");
  console.error("\nUsage:");
  console.error("  QB_CLIENT_ID=xxx QB_CLIENT_SECRET=yyy npx tsx test/integration.ts");
  process.exit(1);
}

// In-memory token storage for testing
let storedTokens: QuickBooksTokens | null = null;

const tokenStore: TokenStore = {
  async getTokens() {
    return storedTokens;
  },
  async storeTokens(tokens) {
    storedTokens = tokens;
    console.log("\n✓ Tokens stored successfully");
  },
  async clearTokens() {
    storedTokens = null;
  },
};

// Create the client
const client = new QuickBooksClient({
  ...config,
  tokenStore,
  onLog: (level, message, data) => {
    console.log(`[${level.toUpperCase()}] ${message}`, data || "");
  },
});

// Track state for CSRF protection
let pendingState: string | null = null;

// Simple HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  try {
    // Home page - show auth link or test options
    if (url.pathname === "/") {
      if (storedTokens) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <h1>QuickBooks Client Test</h1>
          <p style="color: green;">✓ Connected to QuickBooks (Realm: ${storedTokens.realm_id})</p>
          <h2>Test API Calls:</h2>
          <ul>
            <li><a href="/test/company">Get Company Info</a></li>
            <li><a href="/test/customers">Get Customers</a></li>
            <li><a href="/test/invoices">Get Invoices</a></li>
            <li><a href="/test/accounts">Get Accounts</a></li>
            <li><a href="/test/items">Get Items</a></li>
          </ul>
          <p><a href="/disconnect">Disconnect</a></p>
        `);
      } else {
        pendingState = generateState();
        const authUrl = generateAuthUrl(config, pendingState);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <h1>QuickBooks Client Test</h1>
          <p>Not connected to QuickBooks</p>
          <p><a href="${authUrl}">Connect to QuickBooks Sandbox</a></p>
        `);
      }
      return;
    }

    // OAuth callback
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const realmId = url.searchParams.get("realmId");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>${error}</p><p><a href="/">Try again</a></p>`);
        return;
      }

      if (!code || !realmId) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>Missing code or realmId</p><p><a href="/">Try again</a></p>`);
        return;
      }

      if (state !== pendingState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>Invalid state (CSRF check failed)</p><p><a href="/">Try again</a></p>`);
        return;
      }

      console.log("\n→ Exchanging code for tokens...");
      const tokens = await exchangeCodeForTokens(config, code, realmId);
      await tokenStore.storeTokens(tokens);

      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    // Disconnect
    if (url.pathname === "/disconnect") {
      await tokenStore.clearTokens();
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    // Test endpoints
    if (url.pathname.startsWith("/test/")) {
      const testType = url.pathname.replace("/test/", "");
      let result: unknown;
      let title: string;

      console.log(`\n→ Testing: ${testType}`);

      switch (testType) {
        case "company":
          title = "Company Info";
          result = await client.getCompanyInfo();
          break;
        case "customers":
          title = "Customers";
          result = await client.getCustomers();
          break;
        case "invoices":
          title = "Invoices";
          result = await client.getInvoices();
          break;
        case "accounts":
          title = "Accounts";
          result = await client.getAccounts();
          break;
        case "items":
          title = "Items";
          result = await client.getItems();
          break;
        default:
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end(`<h1>Unknown test: ${testType}</h1><p><a href="/">Back</a></p>`);
          return;
      }

      console.log(`✓ ${title} retrieved successfully`);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <h1>${title}</h1>
        <p><a href="/">← Back</a></p>
        <pre style="background: #f5f5f5; padding: 16px; overflow: auto;">${JSON.stringify(result, null, 2)}</pre>
      `);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(`<h1>Not Found</h1><p><a href="/">Home</a></p>`);

  } catch (err) {
    console.error("Error:", err);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`
      <h1>Error</h1>
      <pre style="background: #fee; padding: 16px;">${err instanceof Error ? err.message : String(err)}</pre>
      <p><a href="/">Back</a></p>
    `);
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 QuickBooks integration test server running at http://localhost:${PORT}`);
  console.log("\nConfiguration:");
  console.log(`  Client ID: ${config.clientId.slice(0, 8)}...`);
  console.log(`  Redirect URI: ${config.redirectUri}`);
  console.log(`  Environment: ${config.environment}`);
  console.log("\nOpen http://localhost:3000 in your browser to start testing.\n");
});
