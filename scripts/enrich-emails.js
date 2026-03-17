#!/usr/bin/env node
/**
 * Enriches podium_conversations in Firestore with email addresses
 * by looking up each contact's phone number in the Podium contacts API.
 *
 * Also stores contactUid on the conversation for future reference.
 *
 * Usage: node enrich-emails.js [--dry-run]
 */
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 400;

initializeApp({
  credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getAccessToken() {
  const doc = await db.collection("podium_tokens").doc("primary").get();
  return doc.data().access_token;
}

async function fetchAllContacts(token) {
  const api = axios.create({
    baseURL: "https://api.podium.com/v4",
    headers: { Authorization: `Bearer ${token}` },
  });

  const allContacts = [];
  let cursor = null;
  let page = 0;

  do {
    const params = {};
    if (cursor) params.cursor = cursor;
    const { data } = await api.get("/contacts", { params });
    const items = data.data || [];
    allContacts.push(...items);
    cursor = data.metadata?.nextCursor || null;
    page++;
    log(`  Contacts page ${page}: ${items.length} contacts (total: ${allContacts.length})`);
    if (cursor) await new Promise((r) => setTimeout(r, 700));
  } while (cursor);

  return allContacts;
}

async function main() {
  log("=== Enrich Conversations with Email Addresses ===");
  if (DRY_RUN) log("DRY RUN — no Firestore writes");

  // Step 1: Fetch all contacts from Podium API
  log("Step 1: Fetching all contacts from Podium API...");
  const token = await getAccessToken();
  const contacts = await fetchAllContacts(token);
  log(`Fetched ${contacts.length} contacts total`);

  // Step 2: Build phone → { email, contactUid } map
  const phoneMap = {};
  let withEmail = 0;
  for (const c of contacts) {
    const phones = c.phoneNumbers || [];
    const emails = c.emails || [];
    const email = emails[0] || null;
    if (email) withEmail++;

    for (const phone of phones) {
      const normalized = phone.replace(/[\s\-()]/g, "");
      phoneMap[normalized] = {
        email,
        contactUid: c.uid,
        contactName: c.name,
      };
    }
  }
  log(`Built phone map: ${Object.keys(phoneMap).length} phone numbers, ${withEmail} contacts with emails`);

  // Step 3: Iterate all conversations and enrich
  log("Step 2: Enriching conversations...");
  let updated = 0, skipped = 0, noMatch = 0, alreadyHasEmail = 0;
  let lastDoc = null;
  let batchCount = 0;
  let batch = db.batch();

  while (true) {
    let q = db.collection("podium_conversations").orderBy("__name__").limit(5000);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data();

      // Skip if already has email
      if (data.contactEmail) {
        alreadyHasEmail++;
        continue;
      }

      const phone = (data.phone || "").replace(/[\s\-()]/g, "");
      if (!phone) { skipped++; continue; }

      const match = phoneMap[phone];
      if (!match) { noMatch++; continue; }

      const update = {};
      if (match.email) update.contactEmail = match.email;
      if (match.contactUid) update.contactUid = match.contactUid;

      if (Object.keys(update).length === 0) { skipped++; continue; }

      if (!DRY_RUN) {
        batch.set(doc.ref, update, { merge: true });
        batchCount++;

        if (batchCount >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      updated++;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    log(`  Processed ${snap.size} conversations (updated: ${updated}, noMatch: ${noMatch}, alreadyHasEmail: ${alreadyHasEmail})`);
  }

  // Commit remaining
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }

  log("=== Complete ===");
  log(`Updated: ${updated}`);
  log(`Already had email: ${alreadyHasEmail}`);
  log(`No matching contact: ${noMatch}`);
  log(`Skipped (no phone): ${skipped}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
