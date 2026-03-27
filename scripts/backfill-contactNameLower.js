/**
 * Backfill contactNameLower on existing podium_contacts documents.
 *
 * Adds a lowercase version of the name field for server-side prefix queries.
 * Safe to re-run — skips documents that already have the field.
 *
 * Usage:
 *   node backfill-contactNameLower.js
 *   node backfill-contactNameLower.js --dry-run
 */
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const DRY_RUN = process.argv.includes("--dry-run");

initializeApp({
  credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

async function main() {
  let updated = 0;
  let skipped = 0;
  let lastDoc = null;

  while (true) {
    let q = db.collection("podium_contacts").orderBy("__name__").limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let opsInBatch = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.contactNameLower !== undefined) {
        skipped++;
        continue;
      }
      const lower = data.name ? data.name.toLowerCase() : null;
      batch.update(doc.ref, { contactNameLower: lower });
      opsInBatch++;
      updated++;
    }

    if (opsInBatch > 0 && !DRY_RUN) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`Processed ${updated + skipped} docs (${updated} updated, ${skipped} skipped)${DRY_RUN ? " [DRY RUN]" : ""}`);
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}${DRY_RUN ? " [DRY RUN — no writes]" : ""}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
