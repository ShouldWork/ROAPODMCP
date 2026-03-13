const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

initializeApp();

// ── Secrets ────────────────────────────────────────────────────────────────
const PODIUM_CLIENT_ID = defineSecret("PODIUM_CLIENT_ID");
const PODIUM_CLIENT_SECRET = defineSecret("PODIUM_CLIENT_SECRET");
const PODIUM_REDIRECT_URI = defineSecret("PODIUM_REDIRECT_URI");
const MCP_API_KEY = defineSecret("MCP_API_KEY");

// ── Constants ──────────────────────────────────────────────────────────────
const PODIUM_AUTH_URL = "https://api.podium.com/oauth/authorize";
const PODIUM_TOKEN_URL = "https://api.podium.com/oauth/token";
const PODIUM_API_BASE = "https://api.podium.com/v4";

const SCOPES = [
  "read_contacts",
  "read_locations",
  "write_message",
  "read_message",
  "read_payments",
  "read_reporting",
  "read_reviews",
  "read_templates",
  "write_templates",
  "read_users",
].join(" ");

// ── Token helpers ──────────────────────────────────────────────────────────

/**
 * Load the stored access token from Firestore, refreshing it automatically
 * if it has expired (or will expire within 5 minutes).
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<string>} valid access_token
 */
async function getPodiumAccessToken(clientId, clientSecret) {
  const db = getFirestore();
  const doc = await db.collection("podium_tokens").doc("primary").get();
  if (!doc.exists) throw new Error("No Podium token stored. Run the OAuth flow first.");

  const data = doc.data();
  const { access_token, refresh_token, expires_in, updated_at } = data;

  // Check expiry with a 5-minute safety buffer
  const updatedMs = new Date(updated_at).getTime();
  const expiresMs = updatedMs + expires_in * 1000;
  const BUFFER_MS = 5 * 60 * 1000;

  if (Date.now() < expiresMs - BUFFER_MS) {
    return access_token; // still valid
  }

  // Token expired — refresh it
  const response = await axios.post(
    PODIUM_TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const tokens = response.data;
  await db.collection("podium_tokens").doc("primary").set({
    ...tokens,
    updated_at: new Date().toISOString(),
  });

  return tokens.access_token;
}

/** Axios instance factory pre-configured with the Podium bearer token. */
function podiumClient(accessToken) {
  return axios.create({
    baseURL: PODIUM_API_BASE,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── MCP server factory ─────────────────────────────────────────────────────

/** Build and return a configured McpServer instance with all Podium tools. */
function createMcpServer(accessToken) {
  const server = new McpServer({ name: "podium-mcp", version: "1.0.0" });
  const api = podiumClient(accessToken);

  const ok = (data) => ({
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  });
  const fail = (err) => ({
    content: [{ type: "text", text: `Error: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}` }],
    isError: true,
  });

  server.tool(
    "get_conversations",
    "List recent Podium conversations (texts/messages). Returns conversation metadata including contact name, phone, last message, and unread status.",
    {
      limit: z.number().optional().describe("Max conversations to return (default 20, max 100)."),
      locationUid: z.string().optional().describe("Filter by a specific Podium location UID."),
    },
    async ({ limit, locationUid }) => {
      try {
        const params = { pageSize: limit || 20 };
        if (locationUid) params.locationUid = locationUid;
        const { data } = await api.get("/conversations", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_messages",
    "Get all messages within a specific Podium conversation by its conversation UID.",
    {
      conversationUid: z.string().describe("The Podium conversation UID."),
      limit: z.number().optional().describe("Max messages to return (default 50)."),
    },
    async ({ conversationUid, limit }) => {
      try {
        const { data } = await api.get(`/conversations/${conversationUid}/messages`, {
          params: { pageSize: limit || 50 },
        });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_contact",
    "Look up a Podium contact by their UID, phone number, or email address.",
    {
      contactUid: z.string().optional().describe("The Podium contact UID."),
      phoneNumber: z.string().optional().describe("Phone number (E.164 preferred, e.g. +15551234567)."),
      email: z.string().optional().describe("Email address to search."),
    },
    async ({ contactUid, phoneNumber, email }) => {
      try {
        if (contactUid) {
          const { data } = await api.get(`/contacts/${contactUid}`);
          return ok(data);
        }
        const params = {};
        if (phoneNumber) params.phoneNumber = phoneNumber;
        if (email) params.email = email;
        const { data } = await api.get("/contacts", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_calls",
    "List recent Podium call records (inbound and outbound phone calls).",
    {
      limit: z.number().optional().describe("Max call records to return (default 20)."),
      locationUid: z.string().optional().describe("Filter by a specific Podium location UID."),
    },
    async ({ limit, locationUid }) => {
      try {
        const params = { pageSize: limit || 20 };
        if (locationUid) params.locationUid = locationUid;
        const { data } = await api.get("/calls", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "search_contacts",
    "Search Podium contacts by name, phone number, or email address.",
    {
      query: z.string().describe("Search query (name, phone, or email)."),
      limit: z.number().optional().describe("Max results to return (default 20)."),
    },
    async ({ query, limit }) => {
      try {
        const { data } = await api.get("/contacts", {
          params: { q: query, pageSize: limit || 20 },
        });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_unread_conversations",
    "List Podium conversations that have unread messages, sorted by most recent activity.",
    {
      limit: z.number().optional().describe("Max unread conversations to return (default 20)."),
    },
    async ({ limit }) => {
      try {
        const { data } = await api.get("/conversations", {
          params: { pageSize: limit || 20, unread: true },
        });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  return server;
}

// ══════════════════════════════════════════════════════════════════════════════
// OAuth Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Step 1 — Redirect user to Podium login/authorization page.
 */
exports.podiumOAuthStart = onRequest(
  { secrets: [PODIUM_CLIENT_ID, PODIUM_REDIRECT_URI] },
  (req, res) => {
    const params = new URLSearchParams({
      client_id: PODIUM_CLIENT_ID.value(),
      redirect_uri: PODIUM_REDIRECT_URI.value(),
      response_type: "code",
      scope: SCOPES,
    });
    res.redirect(`${PODIUM_AUTH_URL}?${params.toString()}`);
  }
);

/**
 * Step 2 — Exchange auth code for tokens and store in Firestore.
 */
exports.podiumOAuthCallback = onRequest(
  { secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET, PODIUM_REDIRECT_URI] },
  async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing authorization code.");

    try {
      const response = await axios.post(
        PODIUM_TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: PODIUM_CLIENT_ID.value(),
          client_secret: PODIUM_CLIENT_SECRET.value(),
          redirect_uri: PODIUM_REDIRECT_URI.value(),
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const db = getFirestore();
      await db.collection("podium_tokens").doc("primary").set({
        ...response.data,
        updated_at: new Date().toISOString(),
      });

      res.send("OAuth complete. Tokens stored in Firestore under podium_tokens/primary.");
    } catch (err) {
      console.error("Token exchange failed:", err.response?.data || err.message);
      res.status(500).send("Token exchange failed. Check function logs.");
    }
  }
);

/**
 * Manual token refresh endpoint.
 */
exports.podiumRefreshToken = onRequest(
  { secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET] },
  async (req, res) => {
    try {
      await getPodiumAccessToken(
        PODIUM_CLIENT_ID.value(),
        PODIUM_CLIENT_SECRET.value()
      );
      res.send("Token refreshed and stored successfully.");
    } catch (err) {
      console.error("Token refresh failed:", err.response?.data || err.message);
      res.status(500).send("Token refresh failed. Check function logs.");
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// MCP Server Endpoint
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The MCP server endpoint for Claude.ai custom connector.
 *
 * Supports:
 *   POST /podiumMcp  — MCP JSON-RPC (tool calls, list tools, etc.)
 *   GET  /podiumMcp  — SSE stream for server-initiated messages
 *   DELETE /podiumMcp — Session cleanup
 */
exports.podiumMcp = onRequest(
  { secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET, MCP_API_KEY] },
  async (req, res) => {
    // CORS headers required for Claude.ai to reach this endpoint
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id"
    );
    res.set("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    // Validate API key sent by Claude.ai connector
    const authHeader = req.headers["authorization"] || "";
    const providedKey = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (providedKey !== MCP_API_KEY.value()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const accessToken = await getPodiumAccessToken(
        PODIUM_CLIENT_ID.value(),
        PODIUM_CLIENT_SECRET.value()
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — required for serverless
      });

      const server = createMcpServer(accessToken);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }
);
