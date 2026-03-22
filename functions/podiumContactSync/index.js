const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const axios = require("axios");

initializeApp();

// ── Secrets (reuse existing OAuth credentials) ──────────────────────────────
const PODIUM_CLIENT_ID = defineSecret("PODIUM_CLIENT_ID");
const PODIUM_CLIENT_SECRET = defineSecret("PODIUM_CLIENT_SECRET");

// ── Constants ────────────────────────────────────────────────────────────────
const LOCATION_UID = "a79838e3-8d84-5dcf-9846-a7e6d0fbdd55";
const PODIUM_CONTACTS_URL = "https://api.podium.com/v4/contacts";
const PODIUM_TOKEN_URL = "https://api.podium.com/oauth/token";
const TRACKED_FIELDS = ["name", "phone", "email"];
const MAX_PAGES_PER_RUN = 20; // 2000 contacts per invocation

// ── Token management ────────────────────────────────────────────────────────

async function getAccessToken(clientId, clientSecret) {
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

  console.log("Token expired, refreshing...");
  let response;
  try {
    response = await axios.post(
      PODIUM_TOKEN_URL,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  } catch (refreshErr) {
    const detail = refreshErr.response?.data || refreshErr.message;
    console.error("Token refresh failed:", JSON.stringify(detail));
    throw new Error(`Token refresh failed: ${JSON.stringify(detail)}`);
  }

  const tokens = response.data;
  await db.collection("podium_tokens").doc("primary").set({
    ...tokens,
    updated_at: new Date().toISOString(),
  });

  return tokens.access_token;
}

// ── Podium API helpers ───────────────────────────────────────────────────────

/**
 * Extract normalized fields from a Podium contact object.
 */
function extractContactFields(contact) {
  return {
    uid: contact.uid || null,
    name: contact.name || null,
    phone: contact.phoneNumbers?.[0]?.number ?? contact.phone ?? null,
    email: contact.emails?.[0]?.address ?? contact.email ?? null,
    updatedAt: contact.updatedAt || null,
    createdAt: contact.createdAt || null,
    locationUid: LOCATION_UID,
    _source: "podium_contact_sync",
  };
}

// ── Core sync logic ──────────────────────────────────────────────────────────

/**
 * Sync contacts from Podium, processing up to MAX_PAGES_PER_RUN pages per
 * invocation. Persists the pagination cursor in Firestore so the next run
 * resumes where this one left off.
 *
 * When the full contact list has been traversed (no more pages), the stored
 * cursor is cleared so the next invocation starts from the beginning.
 */
async function syncContacts(accessToken, lookbackHours) {
  const db = getFirestore();
  const syncRunId = `sync_${Date.now()}`;
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0, pagesProcessed: 0 };
  let changelogEntriesWritten = 0;

  const cutoff = new Date(
    Date.now() - lookbackHours * 60 * 60 * 1000
  ).getTime();
  const updatedAfterISO = new Date(cutoff).toISOString();

  // Load saved cursor (if any) to resume pagination
  const cursorDoc = await db.collection("podium_sync_state").doc("cursor").get();
  let cursor = cursorDoc.exists ? cursorDoc.data().nextCursor || null : null;
  const resumedFrom = cursor ? "saved cursor" : "beginning";
  console.log(`Starting sync from ${resumedFrom}`);

  let runError = null;
  let totalFetched = 0;
  let reachedEnd = false;

  try {
    let page = 0;

    while (page < MAX_PAGES_PER_RUN) {
      const params = { limit: 100 };
      if (cursor) params.cursor = cursor;

      const response = await axios.get(PODIUM_CONTACTS_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        params,
      });

      const data = response.data;
      const contacts = Array.isArray(data.data) ? data.data : [];
      totalFetched += contacts.length;
      page++;
      console.log(`Page ${page}: ${contacts.length} contacts (${totalFetched} total this run)`);

      // Process each contact in this page immediately
      for (const raw of contacts) {
        try {
          const contact = extractContactFields(raw);

          if (!contact.uid) {
            stats.skipped++;
            continue;
          }

          // Check if contact was updated within our lookback window
          const contactUpdatedAt = contact.updatedAt
            ? new Date(contact.updatedAt).getTime()
            : 0;
          if (contactUpdatedAt < cutoff) {
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
            console.log(`Created contact: ${contact.name} (${contact.uid})`);
          } else {
            const existingData = existing.data();
            const changedFields = [];
            const previousValues = {};
            const newValues = {};

            for (const field of TRACKED_FIELDS) {
              const oldVal = existingData[field] ?? null;
              const newVal = contact[field] ?? null;
              if (oldVal !== newVal) {
                changedFields.push(field);
                previousValues[field] = oldVal;
                newValues[field] = newVal;
              }
            }

            await docRef.set(
              { ...contact, _syncedAt: FieldValue.serverTimestamp() },
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
              console.log(
                `Updated contact with field changes: ${contact.name} (${contact.uid}) — fields: ${changedFields.join(", ")}`
              );
            }
          }
        } catch (contactErr) {
          stats.errors++;
          console.error(`Error processing contact ${raw.uid || "unknown"}:`, contactErr.message);
        }
      }

      stats.pagesProcessed = page;
      cursor = data.metadata?.nextCursor || null;

      if (!cursor) {
        reachedEnd = true;
        break;
      }
    }

    // Persist cursor for the next invocation (or clear it if we reached the end)
    if (reachedEnd) {
      await db.collection("podium_sync_state").doc("cursor").delete();
      console.log("Reached end of contacts list — cursor cleared for next full pass.");
    } else {
      await db.collection("podium_sync_state").doc("cursor").set({
        nextCursor: cursor,
        savedAt: new Date().toISOString(),
        syncRunId,
      });
      console.log(`Saved cursor for next run (processed ${page} pages, more remain).`);
    }
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    runError = detail;
    console.error("Sync run failed:", detail);
  }

  // Write sync run log
  await db.collection("podium_sync_log").add({
    syncRunId,
    success: runError === null,
    updatedAfter: updatedAfterISO,
    lookbackHours,
    contactsFetched: totalFetched,
    reachedEnd,
    stats,
    changelogEntriesWritten,
    timestamp: FieldValue.serverTimestamp(),
    error: runError,
  });

  if (runError) {
    throw new Error(runError);
  }

  return { stats, changelogEntriesWritten, syncRunId, reachedEnd };
}

// ── Exported Cloud Functions ─────────────────────────────────────────────────

/**
 * Scheduled function — runs daily at 2:00 AM MT (8:00 AM UTC).
 */
exports.podiumContactSyncScheduled = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "America/Denver",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET],
  },
  async () => {
    const accessToken = await getAccessToken(PODIUM_CLIENT_ID.value(), PODIUM_CLIENT_SECRET.value());
    const result = await syncContacts(accessToken, 25);
    console.log("Scheduled sync complete:", JSON.stringify(result.stats));
  }
);

/**
 * HTTP trigger — POST only. Accepts optional { lookbackHours } in body.
 */
exports.podiumContactSyncManual = onRequest(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const lookbackHours = req.body?.lookbackHours || 25;

    try {
      const accessToken = await getAccessToken(PODIUM_CLIENT_ID.value(), PODIUM_CLIENT_SECRET.value());
      const result = await syncContacts(accessToken, lookbackHours);
      res.status(200).json({
        success: true,
        stats: result.stats,
        changelogCount: result.changelogEntriesWritten,
        reachedEnd: result.reachedEnd,
        message: result.reachedEnd
          ? "Full sync complete."
          : "Partial sync — call again to continue from where this run left off.",
      });
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error("Manual sync failed:", JSON.stringify(detail));
      res.status(500).json({
        success: false,
        error: detail,
      });
    }
  }
);
