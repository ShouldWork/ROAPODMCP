/**
 * Podium → Firestore Historical Backfill
 *
 * Pages through ALL Podium conversations and messages, writing them to
 * Firestore. Resumable — saves cursor progress after every page.
 *
 * Usage:
 *   node backfill.js                     # full backfill
 *   node backfill.js --conversations-only # skip messages
 *   node backfill.js --resume            # continue from saved cursor
 *   node backfill.js --dry-run           # fetch only, no Firestore writes
 */
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const axios = require("axios");

// ── CLI flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FLAG_CONVERSATIONS_ONLY = args.includes("--conversations-only");
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");

// ── Init ───────────────────────────────────────────────────────────────────
initializeApp({
  credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const PODIUM_API_BASE = "https://api.podium.com/v4";
const PODIUM_TOKEN_URL = "https://api.podium.com/oauth/token";
const LOCATION_UID = process.env.PODIUM_LOCATION_UID;
const BATCH_LIMIT = 400; // Firestore max is 500, use 400 for safety
const CONVERSATION_PAGE_DELAY = 700;  // ms between conversation pages
const MESSAGE_FETCH_DELAY = 1200;     // ms between message fetches

// ── Token management ───────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  // Try Firestore first (tokens saved by OAuth flow)
  const doc = await db.collection("podium_tokens").doc("primary").get();
  if (!doc.exists) throw new Error("No Podium token in Firestore. Run the OAuth flow first.");

  const data = doc.data();
  const updatedMs = new Date(data.updated_at).getTime();
  const expiresMs = updatedMs + data.expires_in * 1000;

  if (Date.now() < expiresMs - 5 * 60 * 1000) {
    cachedToken = data.access_token;
    tokenExpiresAt = expiresMs - 5 * 60 * 1000;
    return cachedToken;
  }

  // Refresh
  const resp = await axios.post(
    PODIUM_TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      client_id: process.env.PODIUM_CLIENT_ID,
      client_secret: process.env.PODIUM_CLIENT_SECRET,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const tokens = resp.data;
  await db.collection("podium_tokens").doc("primary").set({
    ...tokens,
    updated_at: new Date().toISOString(),
  });

  cachedToken = tokens.access_token;
  tokenExpiresAt = Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

function createApiClient(token) {
  const client = axios.create({
    baseURL: PODIUM_API_BASE,
    headers: { Authorization: `Bearer ${token}` },
  });

  // Auto-retry on 429
  client.interceptors.response.use(null, async (error) => {
    const config = error.config;
    config._retryCount = config._retryCount || 0;
    if (error.response?.status === 429 && config._retryCount < 5) {
      config._retryCount++;
      const delay = Math.pow(2, config._retryCount) * 1000;
      log(`  429 rate limited, retrying in ${delay / 1000}s (attempt ${config._retryCount})...`);
      await sleep(delay);
      // Refresh token in case it rotated
      const newToken = await getAccessToken();
      config.headers.Authorization = `Bearer ${newToken}`;
      return client.request(config);
    }
    throw error;
  });

  return client;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function toTimestamp(dateStr) {
  if (!dateStr) return null;
  return Timestamp.fromDate(new Date(dateStr));
}

// ── Backfill state ──────────────────────────────────────────────────────────
const PROGRESS_REF = db.collection("backfill_state").doc("progress");

async function loadProgress() {
  const doc = await PROGRESS_REF.get();
  if (!doc.exists) return { lastCursor: null, conversationsDone: [], completed: false };
  return doc.data();
}

async function saveProgress(data) {
  if (FLAG_DRY_RUN) return;
  await PROGRESS_REF.set(data, { merge: true });
}

// ── Write conversations batch ───────────────────────────────────────────────
async function writeConversationsBatch(conversations) {
  if (FLAG_DRY_RUN) {
    log(`  [DRY RUN] Would write ${conversations.length} conversations`);
    return;
  }

  for (let i = 0; i < conversations.length; i += BATCH_LIMIT) {
    const chunk = conversations.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const conv of chunk) {
      const ref = db.collection("podium_conversations").doc(conv.uid);
      batch.set(ref, {
        uid: conv.uid,
        contactName: conv.contactName || null,
        phone: conv.channel?.identifier || null,
        channelType: conv.channel?.type || null,
        status: conv.closed ? "closed" : "open",
        assignedUserUid: conv.assignedUserUid || null,
        locationUid: conv.locationUid || null,
        createdAt: toTimestamp(conv.createdAt),
        updatedAt: toTimestamp(conv.updatedAt),
        lastItemAt: toTimestamp(conv.lastItemAt),
        _ingestedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

// ── Write messages batch ────────────────────────────────────────────────────
async function writeMessagesBatch(messages, conversationUid) {
  if (FLAG_DRY_RUN) {
    log(`  [DRY RUN] Would write ${messages.length} messages for ${conversationUid}`);
    return;
  }

  for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
    const chunk = messages.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const msg of chunk) {
      const ref = db.collection("podium_messages").doc(msg.uid);
      batch.set(ref, {
        uid: msg.uid,
        conversationUid: conversationUid,
        contactName: msg.contactName || null,
        contactUid: msg.contactUid || null,
        body: msg.body || null,
        direction: msg.direction || null,
        senderUid: msg.senderUid || null,
        deliveryStatus: msg.deliveryStatus || null,
        messageType: msg.messageType || null,
        hasAttachment: !!(msg.attachments && msg.attachments.length > 0),
        attachmentType: msg.attachments?.[0]?.type || null,
        locationUid: msg.locationUid || null,
        createdAt: toTimestamp(msg.createdAt),
        _ingestedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

// ── Fetch all messages for a conversation ───────────────────────────────────
async function fetchAllMessages(api, conversationUid) {
  const allMessages = [];
  let cursor = null;

  do {
    const params = {};
    if (cursor) params.cursor = cursor;

    const { data } = await api.get(`/conversations/${conversationUid}/messages`, { params });
    const items = data.data || [];
    allMessages.push(...items);
    cursor = data.metadata?.nextCursor || null;

    if (cursor) await sleep(MESSAGE_FETCH_DELAY);
  } while (cursor);

  return allMessages;
}

// ── Main backfill ───────────────────────────────────────────────────────────
async function main() {
  log("=== Podium → Firestore Backfill ===");
  log(`Flags: conversations-only=${FLAG_CONVERSATIONS_ONLY}, resume=${FLAG_RESUME}, dry-run=${FLAG_DRY_RUN}`);

  const token = await getAccessToken();
  const api = createApiClient(token);

  // Load resume state
  let progress = FLAG_RESUME ? await loadProgress() : { lastCursor: null, conversationsDoneCount: 0, completed: false };
  if (progress.completed && FLAG_RESUME) {
    log("Backfill already marked complete. Use without --resume to start fresh.");
    return;
  }

  let cursor = FLAG_RESUME ? progress.lastCursor : null;
  let pageNum = 0;
  let totalConversations = progress.conversationsDoneCount || 0;
  let totalMessages = 0;

  log(cursor ? `Resuming from cursor (${totalConversations} conversations already done)` : "Starting from the beginning");

  // Page through all conversations
  do {
    pageNum++;
    const params = {};
    if (cursor) params.cursor = cursor;

    log(`Fetching conversation page ${pageNum}...`);
    const { data } = await api.get("/conversations", { params });
    const conversations = data.data || [];
    const nextCursor = data.metadata?.nextCursor || null;

    if (conversations.length === 0) {
      log("No more conversations found.");
      break;
    }

    log(`  Got ${conversations.length} conversations`);
    totalConversations += conversations.length;

    // Write conversations to Firestore
    await writeConversationsBatch(conversations);

    // Fetch and write messages for each conversation
    if (!FLAG_CONVERSATIONS_ONLY) {
      for (const conv of conversations) {
        // Check if messages already backfilled for this conversation
        if (!FLAG_DRY_RUN) {
          const convDoc = await db.collection("podium_conversations").doc(conv.uid).get();
          if (convDoc.exists && convDoc.data()._messagesBackfilled) {
            log(`  Skipping messages for ${conv.contactName || conv.uid} (already done)`);
            continue;
          }
        }

        try {
          const messages = await fetchAllMessages(api, conv.uid);
          if (messages.length > 0) {
            await writeMessagesBatch(messages, conv.uid);
            totalMessages += messages.length;
          }
          // Mark this conversation as messages-backfilled
          if (!FLAG_DRY_RUN) {
            await db.collection("podium_conversations").doc(conv.uid).set(
              { _messagesBackfilled: true }, { merge: true }
            );
          }
          log(`  ${conv.contactName || conv.uid}: ${messages.length} messages`);
        } catch (err) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          log(`  ERROR fetching messages for ${conv.uid}: ${detail} — skipping`);
        }

        await sleep(MESSAGE_FETCH_DELAY);
      }
    }

    // Save progress after each page
    cursor = nextCursor;
    totalConversations += conversations.length;
    await saveProgress({
      lastCursor: cursor,
      conversationsDoneCount: totalConversations,
      completed: false,
      lastPageAt: new Date().toISOString(),
    });

    if (cursor) await sleep(CONVERSATION_PAGE_DELAY);
  } while (cursor);

  // Mark complete
  await saveProgress({
    completed: true,
    completedAt: new Date().toISOString(),
    totalConversations,
    totalMessages,
  });

  log("=== Backfill Complete ===");
  log(`Conversations: ${totalConversations}`);
  log(`Messages: ${totalMessages}`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
