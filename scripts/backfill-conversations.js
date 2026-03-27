/**
 * Backfill contactNameLower + lastMessageDirection/lastMessageAt on
 * existing podium_conversations documents.
 *
 * - contactNameLower: enables server-side prefix queries (no full scan)
 * - lastMessageDirection/lastMessageAt: eliminates N+1 queries in fs_follow_up_priority
 *
 * Safe to re-run — skips conversations that already have both fields.
 *
 * Usage:
 *   node backfill-conversations.js
 *   node backfill-conversations.js --dry-run
 *   node backfill-conversations.js --name-only     # skip message lookups
 */
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const DRY_RUN = process.argv.includes("--dry-run");
const NAME_ONLY = process.argv.includes("--name-only");

initializeApp({
  credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

async function main() {
  let nameUpdated = 0;
  let msgUpdated = 0;
  let skipped = 0;
  let total = 0;
  let lastDoc = null;

  while (true) {
    let q = db.collection("podium_conversations").orderBy("__name__").limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    let batch = db.batch();
    let opsInBatch = 0;

    for (const doc of snap.docs) {
      total++;
      const data = doc.data();
      const update = {};

      // contactNameLower
      if (data.contactNameLower === undefined) {
        update.contactNameLower = data.contactName ? data.contactName.toLowerCase() : null;
        nameUpdated++;
      }

      // lastMessageDirection + lastMessageAt
      if (!NAME_ONLY && data.lastMessageDirection === undefined) {
        const msgSnap = await db.collection("podium_messages")
          .where("conversationUid", "==", doc.id)
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();
        if (!msgSnap.empty) {
          const msg = msgSnap.docs[0].data();
          update.lastMessageDirection = msg.direction || null;
          update.lastMessageAt = msg.createdAt || null;
          msgUpdated++;
        }
      }

      if (Object.keys(update).length > 0 && !DRY_RUN) {
        batch.update(doc.ref, update);
        opsInBatch++;
      } else if (Object.keys(update).length === 0) {
        skipped++;
      }

      // Firestore batch limit
      if (opsInBatch >= 400) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0 && !DRY_RUN) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`Processed ${total} (names: ${nameUpdated}, msgs: ${msgUpdated}, skipped: ${skipped})${DRY_RUN ? " [DRY RUN]" : ""}`);
  }

  console.log(`\nDone. Total: ${total}, Names updated: ${nameUpdated}, Msgs updated: ${msgUpdated}, Skipped: ${skipped}${DRY_RUN ? " [DRY RUN]" : ""}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
