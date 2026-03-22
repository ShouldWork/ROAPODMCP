const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
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

// ── Contact Sync constants ────────────────────────────────────────────────
const CONTACT_SYNC_LOCATION_UID = "a79838e3-8d84-5dcf-9846-a7e6d0fbdd55";
const PODIUM_CONTACTS_URL = "https://api.podium.com/v4/contacts";
const CONTACT_SYNC_TRACKED_FIELDS = ["name", "phone", "email"];

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

// ── Contact Sync helpers ───────────────────────────────────────────────────

async function fetchAllContactsForSync(accessToken, updatedAfter) {
  const contacts = [];
  let cursor = null;

  do {
    const params = {
      limit: 100,
      updatedAfter,
    };
    if (cursor) params.cursor = cursor;

    const response = await axios.get(PODIUM_CONTACTS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      params,
    });

    const data = response.data;
    if (Array.isArray(data.data)) {
      contacts.push(...data.data);
    }

    cursor = data.metadata?.nextCursor || null;
  } while (cursor);

  return contacts;
}

function extractContactFields(contact) {
  return {
    uid: contact.uid || null,
    name: contact.name || null,
    phone: contact.phoneNumbers?.[0]?.number ?? contact.phone ?? null,
    email: contact.emails?.[0]?.address ?? contact.email ?? null,
    updatedAt: contact.updatedAt || null,
    createdAt: contact.createdAt || null,
    locationUid: CONTACT_SYNC_LOCATION_UID,
    _source: "podium_contact_sync",
  };
}

async function runContactSync(accessToken, lookbackHours) {
  const db = getFirestore();
  const syncRunId = `sync_${Date.now()}`;
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let changelogEntriesWritten = 0;

  const updatedAfter = new Date(
    Date.now() - lookbackHours * 60 * 60 * 1000
  ).toISOString();

  let contacts = [];
  let runError = null;

  try {
    contacts = await fetchAllContactsForSync(accessToken, updatedAfter);

    for (const raw of contacts) {
      try {
        const contact = extractContactFields(raw);

        if (!contact.uid) {
          stats.skipped++;
          continue;
        }

        const docRef = db.collection("podium_contacts").doc(contact.uid);
        const existing = await docRef.get();

        if (!existing.exists) {
          await docRef.set({
            ...contact,
            _syncedAt: FieldValue.serverTimestamp(),
          });
          stats.created++;
        } else {
          const existingData = existing.data();
          const changedFields = [];
          const previousValues = {};
          const newValues = {};

          for (const field of CONTACT_SYNC_TRACKED_FIELDS) {
            const oldVal = existingData[field] ?? null;
            const newVal = contact[field] ?? null;
            if (oldVal !== newVal) {
              changedFields.push(field);
              previousValues[field] = oldVal;
              newValues[field] = newVal;
            }
          }

          await docRef.set(
            {
              ...contact,
              _syncedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          stats.updated++;

          if (changedFields.length > 0) {
            await db.collection("podium_sync_changelog").add({
              uid: contact.uid,
              name: contact.name,
              changedFields,
              previousValues,
              newValues,
              appliedAt: new Date().toISOString(),
              syncRunId,
            });
            changelogEntriesWritten++;
          }
        }
      } catch (contactErr) {
        stats.errors++;
        console.error(`Error processing contact ${raw.uid || "unknown"}:`, contactErr.message);
      }
    }
  } catch (err) {
    runError = err.message;
    console.error("Sync run failed:", err.message);
  }

  await db.collection("podium_sync_log").add({
    syncRunId,
    success: runError === null,
    updatedAfter,
    lookbackHours,
    contactsFetched: contacts.length,
    stats,
    changelogEntriesWritten,
    timestamp: FieldValue.serverTimestamp(),
    error: runError,
  });

  if (runError) {
    throw new Error(runError);
  }

  return { stats, changelogEntriesWritten, syncRunId };
}

// ── MCP server factory ─────────────────────────────────────────────────────

function createMcpServer(accessToken) {
  const server = new McpServer({
    name: "podium-mcp",
    version: "3.0.0",
  });
  const api = podiumClient(accessToken);
  const db = getFirestore();

  // ══════════════════════════════════════════════════════════════════════════
  // FIRESTORE TOOLS — PRIMARY DATA SOURCE
  // These query the local Firestore database (20k+ conversations indexed).
  // ALWAYS use these tools first. They support sorting, filtering by status,
  // coach, date range, and contact name — none of which the Podium API can do.
  // ══════════════════════════════════════════════════════════════════════════

  server.tool(
    "fs_dashboard_stats",
    "Get dashboard summary statistics from Firestore: total conversations, open, closed, assignment rate, and conversation counts by dashboard role. This is the fastest way to get an overview of the inbox. ALWAYS use this first when asked about stats, counts, or overview.",
    {},
    async () => {
      try {
        const convRef = db.collection("podium_conversations");
        const [totalSnap, openSnap, closedSnap] = await Promise.all([
          convRef.count().get(),
          convRef.where("status", "==", "open").count().get(),
          convRef.where("status", "==", "closed").count().get(),
        ]);
        const total = totalSnap.data().count;
        const open = openSnap.data().count;
        const closed = closedSnap.data().count;

        // Coach assignment breakdown for open conversations
        const openConvSnap = await convRef.where("status", "==", "open").get();
        const userSnap = await db.collection("podium_users").get();
        const userMap = {};
        userSnap.forEach((d) => { const u = d.data(); userMap[d.id] = { name: u.name, role: u.dashboardRole }; });

        const byCoach = {};
        let unassigned = 0;
        openConvSnap.forEach((d) => {
          const uid = d.data().assignedUserUid;
          if (!uid) { unassigned++; return; }
          const user = userMap[uid] || { name: uid.substring(0, 8), role: "Unknown" };
          const key = user.name;
          if (!byCoach[key]) byCoach[key] = { name: user.name, role: user.role || "Unset", count: 0 };
          byCoach[key].count++;
        });

        return ok({
          total, open, closed, unassigned,
          assignmentRate: open > 0 ? Math.round(((open - unassigned) / open) * 100) : 0,
          openByCoach: Object.values(byCoach).sort((a, b) => b.count - a.count),
        });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_conversations",
    "Query conversations from Firestore with full filtering and sorting. Supports filtering by status (open/closed), assigned coach, contact name search, and date ranges. Results are sorted by lastItemAt descending (most recent first). ALWAYS use this instead of get_conversations unless explicitly asked for live Podium API data.",
    {
      status: z.enum(["open", "closed"]).optional().describe("Filter by conversation status. Omit for all."),
      assignedUserUid: z.string().optional().describe("Filter by assigned user UID."),
      assignedName: z.string().optional().describe("Filter by assigned user name (partial match, case-insensitive). Resolves to UID automatically."),
      contactName: z.string().optional().describe("Search by contact name (partial match, case-insensitive). Filters client-side."),
      phone: z.string().optional().describe("Search by phone number (partial match)."),
      email: z.string().optional().describe("Search by email address (partial match, case-insensitive)."),
      staleAfterDays: z.number().optional().describe("Only return conversations with no activity for this many days."),
      activeWithinDays: z.number().optional().describe("Only return conversations with activity within this many days."),
      limit: z.number().optional().describe("Max results to return (default 50, max 500)."),
    },
    async ({ status, assignedUserUid, assignedName, contactName, phone, email, staleAfterDays, activeWithinDays, limit: maxResults }) => {
      try {
        const cap = Math.min(maxResults || 50, 500);

        // Resolve assignedName to UID if provided
        let resolvedUid = assignedUserUid;
        if (assignedName && !resolvedUid) {
          const userSnap = await db.collection("podium_users").get();
          const lowerName = assignedName.toLowerCase();
          userSnap.forEach((d) => {
            if ((d.data().name || "").toLowerCase().includes(lowerName)) {
              resolvedUid = d.id;
            }
          });
        }

        // Build Firestore query
        let q = db.collection("podium_conversations").orderBy("lastItemAt", "desc");
        if (status) q = q.where("status", "==", status);
        if (resolvedUid) q = q.where("assignedUserUid", "==", resolvedUid);

        // Date filters
        if (staleAfterDays) {
          const cutoff = new Date(Date.now() - staleAfterDays * 86400000);
          q = q.where("lastItemAt", "<", cutoff);
        }
        if (activeWithinDays) {
          const cutoff = new Date(Date.now() - activeWithinDays * 86400000);
          q = q.where("lastItemAt", ">", cutoff);
        }

        // Fetch more than needed if we're filtering client-side
        const fetchLimit = (contactName || phone || email) ? Math.min(cap * 5, 2000) : cap;
        q = q.limit(fetchLimit);

        const snap = await q.get();
        let results = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

        // Client-side name/phone search
        if (contactName) {
          const lower = contactName.toLowerCase();
          results = results.filter((c) => (c.contactName || "").toLowerCase().includes(lower));
        }
        if (phone) {
          results = results.filter((c) => (c.phone || "").includes(phone));
        }
        if (email) {
          const lowerEmail = email.toLowerCase();
          results = results.filter((c) => (c.contactEmail || "").toLowerCase().includes(lowerEmail));
        }

        results = results.slice(0, cap);

        // Resolve user names
        const userSnap = await db.collection("podium_users").get();
        const userMap = {};
        userSnap.forEach((d) => { userMap[d.id] = d.data().name; });

        results = results.map((c) => ({
          ...c,
          assignedUserName: userMap[c.assignedUserUid] || "Unassigned",
          lastItemAt: c.lastItemAt?.toDate?.()?.toISOString() || c.lastItemAt,
          createdAt: c.createdAt?.toDate?.()?.toISOString() || c.createdAt,
        }));

        return ok({ data: results, count: results.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_messages",
    "Get all messages for a conversation from Firestore, sorted by createdAt ascending (oldest first). Much faster than the Podium API. ALWAYS use this instead of get_messages unless explicitly asked for live API data.",
    {
      conversationUid: z.string().describe("The conversation UID."),
      limit: z.number().optional().describe("Max messages to return (default 200)."),
      direction: z.enum(["inbound", "outbound"]).optional().describe("Filter by message direction."),
    },
    async ({ conversationUid, limit: maxResults, direction }) => {
      try {
        let q = db.collection("podium_messages")
          .where("conversationUid", "==", conversationUid)
          .orderBy("createdAt", "asc");
        if (direction) q = q.where("direction", "==", direction);
        q = q.limit(maxResults || 200);

        const snap = await q.get();
        const userSnap = await db.collection("podium_users").get();
        const userMap = {};
        userSnap.forEach((d) => { userMap[d.id] = d.data().name; });

        const messages = snap.docs.map((d) => {
          const m = d.data();
          return {
            ...m,
            senderName: userMap[m.senderUid] || (m.direction === "inbound" ? m.contactName : "System"),
            createdAt: m.createdAt?.toDate?.()?.toISOString() || m.createdAt,
          };
        });

        return ok({ data: messages, count: messages.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_search_contacts",
    "Search contacts and conversations in Firestore by name, phone, or email. Searches both podium_contacts and podium_conversations collections. Returns deduplicated results.",
    {
      query: z.string().describe("Search term — name, phone number, or email."),
      limit: z.number().optional().describe("Max results (default 20)."),
    },
    async ({ query: searchTerm, limit: maxResults }) => {
      try {
        const cap = maxResults || 20;
        const lower = searchTerm.toLowerCase();
        const results = [];
        const seen = new Set();

        // Search conversations
        const convSnap = await db.collection("podium_conversations")
          .orderBy("lastItemAt", "desc")
          .limit(2000)
          .get();
        convSnap.forEach((d) => {
          const c = d.data();
          const name = (c.contactName || "").toLowerCase();
          const ph = c.phone || "";
          const em = (c.contactEmail || "").toLowerCase();
          if (name.includes(lower) || ph.includes(searchTerm) || em.includes(lower)) {
            const key = (c.contactName || "") + ph;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                source: "conversation",
                uid: d.id,
                contactName: c.contactName,
                phone: c.phone,
                email: c.contactEmail || null,
                contactUid: c.contactUid || null,
                status: c.status,
                lastItemAt: c.lastItemAt?.toDate?.()?.toISOString() || c.lastItemAt,
                assignedUserUid: c.assignedUserUid,
              });
            }
          }
        });

        // Search contacts collection
        const contactSnap = await db.collection("podium_contacts").limit(1000).get();
        contactSnap.forEach((d) => {
          const c = d.data();
          const name = (c.name || "").toLowerCase();
          const ph = c.phone || "";
          const em = (c.email || "").toLowerCase();
          if (name.includes(lower) || ph.includes(searchTerm) || em.includes(lower)) {
            const key = (c.name || "") + ph;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                source: "contact",
                uid: d.id,
                contactName: c.name,
                phone: c.phone,
                email: c.email,
              });
            }
          }
        });

        return ok({ data: results.slice(0, cap), count: Math.min(results.length, cap) });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_users",
    "List all Podium users from Firestore with their names, roles, and dashboard roles. Use to resolve assignedUserUid to a name, or to see team composition.",
    {},
    async () => {
      try {
        const snap = await db.collection("podium_users").get();
        const users = snap.docs.map((d) => {
          const u = d.data();
          return {
            uid: d.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            podiumRole: u.role,
            dashboardRole: u.dashboardRole || "Unset",
            locations: u.locations || [],
            active: u.active !== false,
          };
        }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return ok({ data: users, count: users.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_follow_up_priority",
    "Get open conversations that need follow-up — where the most recent message is inbound (customer sent last) and no agent has replied. Sorted by longest wait first, grouped by assigned Sales Coach. Use this when asked about unanswered messages, follow-ups needed, or response times.",
    {
      limit: z.number().optional().describe("Max conversations to check (default 100)."),
    },
    async ({ limit: maxResults }) => {
      try {
        const cap = maxResults || 100;
        const convSnap = await db.collection("podium_conversations")
          .where("status", "==", "open")
          .orderBy("lastItemAt", "desc")
          .limit(cap)
          .get();

        const userSnap = await db.collection("podium_users").get();
        const userMap = {};
        userSnap.forEach((d) => { userMap[d.id] = d.data(); });

        const needsFollowUp = [];
        for (const doc of convSnap.docs) {
          const conv = doc.data();
          const msgSnap = await db.collection("podium_messages")
            .where("conversationUid", "==", doc.id)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();
          if (msgSnap.empty) continue;
          const lastMsg = msgSnap.docs[0].data();
          if (lastMsg.direction === "inbound") {
            const lastMsgTime = lastMsg.createdAt?.toDate?.() || new Date(lastMsg.createdAt);
            const waitHours = (Date.now() - lastMsgTime.getTime()) / 3600000;
            needsFollowUp.push({
              uid: doc.id,
              contactName: conv.contactName,
              phone: conv.phone,
              assignedUserName: userMap[conv.assignedUserUid]?.name || "Unassigned",
              assignedUserRole: userMap[conv.assignedUserUid]?.dashboardRole || "Unset",
              waitHours: Math.round(waitHours * 10) / 10,
              waitFormatted: waitHours < 1 ? `${Math.round(waitHours * 60)}m` : waitHours < 24 ? `${Math.round(waitHours)}h` : `${Math.round(waitHours / 24)}d`,
              lastInboundAt: lastMsgTime.toISOString(),
            });
          }
        }

        needsFollowUp.sort((a, b) => b.waitHours - a.waitHours);
        return ok({ data: needsFollowUp, count: needsFollowUp.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_coach_workload",
    "Get workload breakdown per Sales Coach from Firestore: open conversations, active in last 7 days, stale 7-30 days, stale 30+ days, and unassigned count. Use when asked about team performance, workload balance, or stale conversations.",
    {},
    async () => {
      try {
        const convSnap = await db.collection("podium_conversations")
          .where("status", "==", "open")
          .get();

        const userSnap = await db.collection("podium_users").get();
        const userMap = {};
        userSnap.forEach((d) => { userMap[d.id] = d.data(); });

        const now = Date.now();
        const d7 = now - 7 * 86400000;
        const d30 = now - 30 * 86400000;

        const coachData = {};
        convSnap.forEach((doc) => {
          const c = doc.data();
          const uid = c.assignedUserUid || "unassigned";
          const user = userMap[uid] || { name: uid === "unassigned" ? "Unassigned" : uid.substring(0, 8), dashboardRole: "Unset" };
          if (!coachData[uid]) coachData[uid] = { name: user.name, role: user.dashboardRole || "Unset", open: 0, active7d: 0, stale7to30d: 0, stale30d: 0 };
          coachData[uid].open++;
          const lastMs = c.lastItemAt?.toDate?.()?.getTime() || 0;
          if (lastMs > d7) coachData[uid].active7d++;
          else if (lastMs > d30) coachData[uid].stale7to30d++;
          else coachData[uid].stale30d++;
        });

        const data = Object.values(coachData).sort((a, b) => b.open - a.open);
        return ok({ data, count: data.length });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_campaign_search",
    "Search outbound message bodies in Firestore for a keyword to analyze campaign reach and reply rates. Use when asked about campaign performance, broadcast results, or keyword analysis.",
    {
      keyword: z.string().describe("Keyword to search for in outbound message bodies."),
      limit: z.number().optional().describe("Max outbound messages to scan (default 5000)."),
    },
    async ({ keyword, limit: maxScan }) => {
      try {
        const cap = maxScan || 5000;
        const msgSnap = await db.collection("podium_messages")
          .where("direction", "==", "outbound")
          .orderBy("createdAt", "desc")
          .limit(cap)
          .get();

        const kw = keyword.toLowerCase();
        const matches = [];
        const conversationUids = new Set();

        msgSnap.forEach((d) => {
          const msg = d.data();
          if (msg.body && msg.body.toLowerCase().includes(kw)) {
            matches.push({
              uid: d.id,
              body: msg.body.substring(0, 200),
              conversationUid: msg.conversationUid,
              createdAt: msg.createdAt?.toDate?.()?.toISOString() || msg.createdAt,
            });
            if (msg.conversationUid) conversationUids.add(msg.conversationUid);
          }
        });

        // Check reply rate on a sample
        let replyCount = 0;
        const sampleUids = Array.from(conversationUids).slice(0, 30);
        for (const uid of sampleUids) {
          const replySnap = await db.collection("podium_messages")
            .where("conversationUid", "==", uid)
            .where("direction", "==", "inbound")
            .limit(1)
            .get();
          if (!replySnap.empty) replyCount++;
        }

        const dates = matches.map((m) => new Date(m.createdAt).getTime()).filter((d) => d > 0);
        return ok({
          keyword,
          totalMatches: matches.length,
          conversationsReached: conversationUids.size,
          replyRate: sampleUids.length > 0 ? Math.round((replyCount / sampleUids.length) * 100) : 0,
          dateRange: dates.length > 0
            ? { from: new Date(Math.min(...dates)).toISOString(), to: new Date(Math.max(...dates)).toISOString() }
            : null,
          sampleMessages: matches.slice(0, 10),
        });
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    "fs_name_quality",
    "Analyze contact name quality across all conversations in Firestore. Returns counts of unique names, duplicate first=last names (e.g. 'Tim Tim'), unknown/missing names, and phone-number-only entries. Use for data quality audits.",
    {},
    async () => {
      try {
        let duplicateNames = 0, uniqueNames = 0, unknownNames = 0, phoneOnly = 0;
        const dupeExamples = [];
        let lastDoc = null;

        while (true) {
          let q = db.collection("podium_conversations").orderBy("__name__").limit(5000);
          if (lastDoc) q = q.startAfter(lastDoc);
          const snap = await q.get();
          if (snap.empty) break;
          snap.forEach((d) => {
            const name = (d.data().contactName || "").trim();
            if (!name || name.toLowerCase() === "unknown") { unknownNames++; return; }
            if (/^\+?\d[\d\s\-()]+$/.test(name)) { phoneOnly++; return; }
            const parts = name.split(/\s+/);
            if (parts.length >= 2 && parts[0].toLowerCase() === parts[parts.length - 1].toLowerCase()) {
              duplicateNames++;
              if (dupeExamples.length < 10) dupeExamples.push(name);
            } else {
              uniqueNames++;
            }
          });
          lastDoc = snap.docs[snap.docs.length - 1];
        }

        return ok({
          uniqueNames, duplicateNames, unknownNames, phoneOnly,
          total: uniqueNames + duplicateNames + unknownNames + phoneOnly,
          duplicateExamples: dupeExamples,
        });
      } catch (err) { return fail(err); }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PODIUM API TOOLS — LIVE DATA (use only when explicitly requested)
  // These call the Podium REST API directly. They are slower, have no
  // sorting/filtering, and are rate-limited to 300 req/min.
  // Only use these when the user explicitly asks for "live" or "API" data,
  // or for write operations, or for data not yet in Firestore.
  // ══════════════════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────────────────
  // CONVERSATIONS
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "get_conversations",
    "[LIVE API — use fs_conversations instead unless user explicitly asks for live Podium data] List conversations directly from Podium API. No sorting or filtering. Cursor-based pagination only.",
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
    "[LIVE API — use fs_conversations instead] Fetches from Podium API and sorts client-side. Approximate results only. fs_conversations is faster and exact.",
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
    "[LIVE API] Retrieve full details for a single conversation directly from Podium API.",
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
    "[LIVE API] Get all users assigned to a specific conversation directly from Podium API.",
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
    "[LIVE API — use fs_messages instead unless user explicitly asks for live data] Get messages directly from Podium API. fs_messages is faster and supports direction filtering.",
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
    "[LIVE API — use fs_search_contacts instead for search] Retrieve a specific contact by UID directly from Podium API.",
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
    "[LIVE API — use fs_search_contacts instead] Search contacts directly from Podium API.",
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
    "[LIVE API] List all contacts directly from Podium API with cursor pagination.",
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
    "[LIVE API — use fs_users instead] List users directly from Podium API. fs_users includes dashboard roles.",
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
    "[LIVE API] Retrieve a single user by UID directly from Podium API.",
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
    "[LIVE API] List all Podium locations directly from the API.",
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
    "[LIVE API] Retrieve the top-level Podium organization record from the API.",
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
    "[LIVE API] List customer reviews directly from Podium API (Google, Facebook, etc.).",
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
    "[LIVE API] List review invitations directly from Podium API.",
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
    "[LIVE API] List saved Podium message templates directly from the API.",
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
    "[LIVE API] List Podium invoices (payment requests) directly from the API.",
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
    "[LIVE API] Retrieve a single Podium invoice by UID directly from the API.",
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
    "[LIVE API] List customer feedback survey responses directly from Podium API.",
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

  // ────────────────────────────────────────────────────────────────────────
  // CONTACT SYNC
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    "run_contact_sync",
    "Manually trigger a Podium-to-Firestore contact sync. Fetches contacts updated within the lookback window, creates or updates them in Firestore, and logs field-level changes to the changelog. Returns stats (created, updated, skipped, errors) and changelog count. Use this when asked to sync contacts, refresh the contact database, or pull in recent contact changes from Podium.",
    {
      lookbackHours: z
        .number()
        .optional()
        .describe("How many hours back to look for updated contacts (default 25)."),
    },
    async ({ lookbackHours }) => {
      try {
        const hours = lookbackHours || 25;
        const result = await runContactSync(accessToken, hours);
        return ok({
          success: true,
          lookbackHours: hours,
          stats: result.stats,
          changelogCount: result.changelogEntriesWritten,
          syncRunId: result.syncRunId,
        });
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
    // Podium nests event type under metadata.eventType
    const eventType = payload.metadata?.eventType || payload.eventType || payload.event || "unknown";
    const eventUid = payload.metadata?.eventUid || null;
    // Podium sends before/after snapshots — use "after" as the current state
    const data = payload.data?.after || payload.data || {};

    // Log every webhook event for audit trail
    try {
      await db.collection("podium_webhook_log").add({
        eventType,
        eventUid,
        uid: data.uid || null,
        rawPayload: JSON.stringify(payload).substring(0, 10000),
        receivedAt: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("Failed to log webhook:", logErr.message);
    }

    try {
      // message.sent = outbound, message.received = inbound
      if ((eventType === "message.sent" || eventType === "message.received") && data.uid) {
        await db.collection("podium_messages").doc(data.uid).set({
          uid: data.uid,
          conversationUid: data.conversationUid || null,
          contactName: data.contactName || null,
          contactUid: data.contactUid || null,
          body: data.body || null,
          direction: eventType === "message.received" ? "inbound" : "outbound",
          senderUid: data.senderUid || null,
          deliveryStatus: data.deliveryStatus || null,
          messageType: data.messageType || null,
          hasAttachment: !!(data.attachments && data.attachments.length > 0),
          attachmentType: data.attachments?.[0]?.type || null,
          locationUid: data.locationUid || data.organization?.uid || null,
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
          name: data.name || null,
          phone: data.phoneNumbers?.[0] || null,
          email: data.emails?.[0] || null,
          locationUid: data.locations?.[0]?.uid || null,
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
          rating: data.review?.rating || data.rating || null,
          body: data.review?.body || data.body || null,
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

      console.log(`Webhook processed: ${eventType} (${data.uid || "no uid"})`);
      res.status(200).json({ received: true, eventType });
    } catch (err) {
      console.error("Webhook processing failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);
