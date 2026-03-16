const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const crypto = require("crypto");

initializeApp();

// ── Secrets ────────────────────────────────────────────────────────────────
const PODIUM_CLIENT_ID = defineSecret("PODIUM_CLIENT_ID");
const PODIUM_CLIENT_SECRET = defineSecret("PODIUM_CLIENT_SECRET");
const PODIUM_REDIRECT_URI = defineSecret("PODIUM_REDIRECT_URI");
const MCP_API_KEY = defineSecret("MCP_API_KEY");
const PODIUM_WEBHOOK_SECRET = defineSecret("PODIUM_WEBHOOK_SECRET");

// ── Constants ──────────────────────────────────────────────────────────────
const PODIUM_AUTH_URL = "https://api.podium.com/oauth/authorize";
const PODIUM_TOKEN_URL = "https://api.podium.com/oauth/token";
const PODIUM_API_BASE = "https://api.podium.com/v4";
const SCOPES = [
  "read_contacts",
  "read_feedback",
  "read_locations",
  "read_messages",
  "write_messages",
  "read_payments",
  "read_reviews",
  "read_users",
].join(" ");

// ── Token helpers ──────────────────────────────────────────────────────────

/**
 * Load the stored access token from Firestore, refreshing it automatically
 * if it has expired (or will expire within 5 minutes).
 */
async function getPodiumAccessToken(clientId, clientSecret) {
  const db = getFirestore();
  const doc = await db.collection("podium_tokens").doc("primary").get();
  if (!doc.exists) throw new Error("No Podium token stored. Run the OAuth flow first.");

  const data = doc.data();
  const { access_token, refresh_token, expires_in, updated_at } = data;

  const updatedMs = new Date(updated_at).getTime();
  const expiresMs = updatedMs + expires_in * 1000;
  const BUFFER_MS = 5 * 60 * 1000;

  if (Date.now() < expiresMs - BUFFER_MS) {
    return access_token;
  }

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

/** Axios instance factory with Podium bearer token and version header. */
function podiumClient(accessToken) {
  const client = axios.create({
    baseURL: PODIUM_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // Retry interceptor: 429 with exponential backoff, invalid_cursor recovery
  client.interceptors.response.use(null, async (error) => {
    const config = error.config;
    if (!config) throw error;
    config._retryCount = config._retryCount || 0;

    // 429 Too Many Requests — retry up to 3 times
    if (error.response?.status === 429 && config._retryCount < 3) {
      config._retryCount++;
      const delay = Math.pow(2, config._retryCount - 1) * 1000;
      await new Promise((r) => setTimeout(r, delay));
      return client.request(config);
    }

    // Invalid cursor — retry without the cursor param
    const errCode = error.response?.data?.code || error.response?.data?.error?.code;
    if (errCode === "invalid_cursor" && config.params?.cursor) {
      delete config.params.cursor;
      config._retryCount++;
      return client.request(config);
    }

    throw error;
  });

  return client;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Build only-defined params object. */
function buildParams(pairs) {
  const params = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== undefined && value !== null) params[key] = value;
  }
  return params;
}

/** Format a successful tool response. */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Format an error tool response with contextual messages. */
function fail(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  let message;

  if (status === 404) {
    message = "Resource not found. Verify the UID is correct.";
  } else if (status === 401 || status === 403) {
    message = `Authentication error. The access token may have expired or lack a required scope. Details: ${JSON.stringify(body)}`;
  } else if (body) {
    message = JSON.stringify(body);
  } else {
    message = err.message;
  }

  return { content: [{ type: "text", text: `Error (${status || "unknown"}): ${message}` }], isError: true };
}

// ── MCP server factory ─────────────────────────────────────────────────────

function createMcpServer(accessToken) {
  const server = new McpServer({ name: "podium-mcp", version: "2.0.0" });
  const api = podiumClient(accessToken);

  // ────────────────────────────────────────────────────────────────────────
  // CONVERSATIONS
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "get_conversations",
    "List Podium conversations. Returns conversation metadata including contact name, channel, assigned user UID, last activity timestamp (lastItemAt), and open/closed status. Supports cursor-based pagination.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific Podium location UID."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/conversations", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_recent_conversations",
    "Returns Podium conversations sorted by most recent activity (lastItemAt descending). Use this when the user asks for 'recent', 'latest', or 'most active' conversations. Note: sorts within the fetched batch; results are approximate across the full dataset.",
    {
      limit: z.number().optional().describe("Number of results to return (default 20)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
    },
    async ({ limit, locationUid }) => {
      try {
        const targetLimit = limit ?? 20;
        const fetchSize = Math.min(targetLimit * 3, 100);
        const params = buildParams({ limit: fetchSize, locationUid });
        const { data } = await api.get("/conversations", { params });
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        items.sort((a, b) => new Date(b.lastItemAt || 0) - new Date(a.lastItemAt || 0));
        const sliced = items.slice(0, targetLimit);
        return ok({ data: sliced, metadata: data.metadata, count: sliced.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_conversation",
    "Retrieve full details for a single Podium conversation by its UID.",
    {
      conversationUid: z.string().describe("The Podium conversation UID."),
    },
    async ({ conversationUid }) => {
      try {
        const { data } = await api.get(`/conversations/${conversationUid}`);
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_conversation_assignees",
    "Get all users assigned to a specific Podium conversation. Requires read_messages scope.",
    {
      conversationUid: z.string().describe("The Podium conversation UID."),
    },
    async ({ conversationUid }) => {
      try {
        const { data } = await api.get(`/conversations/${conversationUid}/assignees`);
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // MESSAGES
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "get_messages",
    "Get all messages within a specific Podium conversation by its conversation UID. Supports cursor-based pagination.",
    {
      conversationUid: z.string().describe("The Podium conversation UID."),
      limit: z.number().optional().describe("Max messages to return (default 10, max 100)."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ conversationUid, limit, cursor }) => {
      try {
        const params = buildParams({ limit, cursor });
        const { data } = await api.get(`/conversations/${conversationUid}/messages`, { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // CONTACTS
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "get_contact",
    "Retrieve a specific Podium contact by their UID.",
    {
      contactUid: z.string().describe("The Podium contact UID."),
    },
    async ({ contactUid }) => {
      try {
        const { data } = await api.get(`/contacts/${contactUid}`);
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "search_contacts",
    "Search Podium contacts by name, phone number, or email address.",
    {
      query: z.string().describe("Search query (name, phone, or email)."),
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
    },
    async ({ query, limit }) => {
      try {
        const params = buildParams({ q: query, limit });
        const { data } = await api.get("/contacts", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "list_contacts",
    "List all contacts in the Podium organization. Supports cursor-based pagination.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/contacts", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "list_contact_attributes",
    "List all custom contact attribute definitions in the organization (e.g. trailer model, purchase stage).",
    {
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ locationUid, cursor }) => {
      try {
        const params = buildParams({ locationUid, cursor });
        const { data } = await api.get("/contact-entity-attributes", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "list_contact_tags",
    "List all contact tag definitions in the Podium organization.",
    {
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ cursor }) => {
      try {
        const params = buildParams({ cursor });
        const { data } = await api.get("/contact-entity-tags", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // USERS
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_users",
    "List all Podium users in the organization. Use this to resolve assignedUserUid fields in conversations and reviews to real user names. Returns uid, name, email, and role for each user.",
    {
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ locationUid, cursor }) => {
      try {
        const params = buildParams({ locationUid, cursor });
        const { data } = await api.get("/users", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_user",
    "Retrieve a single Podium user by their UID. Use to resolve a specific assignedUserUid to a name.",
    {
      userUid: z.string().describe("The Podium user UID."),
    },
    async ({ userUid }) => {
      try {
        const { data } = await api.get(`/users/${userUid}`);
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // LOCATIONS & ORGANIZATION
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_locations",
    "List all Podium locations in the organization. Use to discover locationUid values for filtering other tools.",
    {
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ cursor }) => {
      try {
        const params = buildParams({ cursor });
        const { data } = await api.get("/locations", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_organization",
    "Retrieve the top-level Podium organization record including org UID and account metadata.",
    {},
    async () => {
      try {
        const { data } = await api.get("/organizations");
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // REVIEWS
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_reviews",
    "List all customer reviews across connected platforms (Google, Facebook, etc.). Use for reputation monitoring, response tracking, and surfacing unresolved low-star reviews.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/reviews", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "list_review_invites",
    "List review invitations sent to contacts. Use for tracking review request campaigns.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/review_invites", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // TEMPLATES
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_templates",
    "List all saved Podium message templates. Use to reference or suggest existing templates when composing messages.",
    {
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ locationUid, cursor }) => {
      try {
        const params = buildParams({ locationUid, cursor });
        const { data } = await api.get("/templates", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // PAYMENTS / INVOICES
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_invoices",
    "List all Podium invoices (payment requests). Use for verifying deposit or final payment status in the Roamer delivery process.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/invoices", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "get_invoice",
    "Retrieve a single Podium invoice by UID.",
    {
      invoiceUid: z.string().describe("The Podium invoice UID."),
    },
    async ({ invoiceUid }) => {
      try {
        const { data } = await api.get(`/invoices/${invoiceUid}`);
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  // ────────────────────────────────────────────────────────────────────────
  // FEEDBACK
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "list_feedback",
    "List customer feedback survey responses. Use for delivery quality assurance and identifying Roamers who may need post-delivery follow-up. High priority for Delivery Coach workflows.",
    {
      limit: z.number().optional().describe("Max results (default 10, max 100)."),
      locationUid: z.string().optional().describe("Filter to a specific location."),
      cursor: z.string().optional().describe("Pagination cursor from a previous response."),
    },
    async ({ limit, locationUid, cursor }) => {
      try {
        const params = buildParams({ limit, locationUid, cursor });
        const { data } = await api.get("/feedback", { params });
        return ok(data);
      } catch (err) { return fail(err); }
    }
  );

  return server;
}

// ══════════════════════════════════════════════════════════════════════════════
// OAuth Functions
// ══════════════════════════════════════════════════════════════════════════════

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

exports.podiumMcp = onRequest(
  { secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET, MCP_API_KEY] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.set("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    // API key check — skip if Claude.ai doesn't send auth headers
    const authHeader = req.headers["authorization"] || "";
    if (authHeader) {
      const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (providedKey !== MCP_API_KEY.value()) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    try {
      const accessToken = await getPodiumAccessToken(
        PODIUM_CLIENT_ID.value(),
        PODIUM_CLIENT_SECRET.value()
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
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

// ══════════════════════════════════════════════════════════════════════════════
// Podium Webhook Receiver
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Receives Podium webhook events and syncs data to Firestore.
 * Register this URL in the Podium dashboard:
 *   https://us-central1-roa-support.cloudfunctions.net/podiumWebhook
 */
exports.podiumWebhook = onRequest(
  { secrets: [PODIUM_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    const db = getFirestore();

    // Validate HMAC-SHA256 signature
    const signature = req.headers["x-podium-signature"];
    if (signature && PODIUM_WEBHOOK_SECRET.value()) {
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const expected = crypto
        .createHmac("sha256", PODIUM_WEBHOOK_SECRET.value())
        .update(rawBody)
        .digest("hex");
      if (signature !== expected) {
        console.warn("Webhook signature mismatch");
        return res.status(401).send("Invalid signature");
      }
    }

    const payload = req.body;
    const eventType = payload.eventType || payload.event || "unknown";

    // Log every webhook event for audit trail
    try {
      await db.collection("podium_webhook_log").add({
        eventType,
        uid: payload.data?.uid || null,
        rawPayload: JSON.stringify(payload).substring(0, 10000),
        receivedAt: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("Failed to log webhook:", logErr.message);
    }

    try {
      const data = payload.data || {};

      if (eventType === "message.created" && data.uid) {
        await db.collection("podium_messages").doc(data.uid).set({
          uid: data.uid,
          conversationUid: data.conversationUid || null,
          contactName: data.contactName || null,
          contactUid: data.contactUid || null,
          body: data.body || null,
          direction: data.direction || null,
          senderUid: data.senderUid || null,
          deliveryStatus: data.deliveryStatus || null,
          messageType: data.messageType || null,
          hasAttachment: !!(data.attachments && data.attachments.length > 0),
          attachmentType: data.attachments?.[0]?.type || null,
          locationUid: data.locationUid || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : null,
          _ingestedAt: new Date(),
        }, { merge: true });

        // Update parent conversation's lastItemAt
        if (data.conversationUid) {
          await db.collection("podium_conversations").doc(data.conversationUid).set({
            lastItemAt: data.createdAt ? new Date(data.createdAt) : new Date(),
            _ingestedAt: new Date(),
          }, { merge: true });
        }
      }

      if ((eventType === "contact.created" || eventType === "contact.updated") && data.uid) {
        await db.collection("podium_contacts").doc(data.uid).set({
          uid: data.uid,
          name: data.name || `${data.firstName || ""} ${data.lastName || ""}`.trim() || null,
          phone: data.phone || data.phones?.[0]?.number || null,
          email: data.email || data.emails?.[0]?.address || null,
          locationUid: data.locationUid || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : null,
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : null,
          _ingestedAt: new Date(),
        }, { merge: true });
      }

      if (eventType === "review.created" && data.uid) {
        await db.collection("podium_reviews").doc(data.uid).set({
          uid: data.uid,
          contactName: data.author?.name || null,
          contactUid: data.contactUid || null,
          rating: data.review?.rating || null,
          body: data.review?.body || null,
          source: data.review?.source || data.platform || null,
          locationUid: data.locationUid || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : null,
          _ingestedAt: new Date(),
        }, { merge: true });
      }

      if ((eventType === "invoice.created" || eventType === "invoice.updated") && data.uid) {
        await db.collection("podium_invoices").doc(data.uid).set({
          uid: data.uid,
          contactName: data.contactName || null,
          contactUid: data.contactUid || null,
          amountCents: data.amountCents || data.amount || null,
          status: data.status || null,
          conversationUid: data.conversationUid || null,
          locationUid: data.locationUid || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : null,
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : null,
          _ingestedAt: new Date(),
        }, { merge: true });
      }

      res.status(200).json({ received: true, eventType });
    } catch (err) {
      console.error("Webhook processing failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);
