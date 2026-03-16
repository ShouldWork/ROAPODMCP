/**
 * Seed podium_users collection with known Sales Coaches and team members.
 * Safe to re-run — uses set() with merge.
 *
 * Usage: node seed-users.js
 */
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp({
  credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const USERS = [
  { uid: "d484d03d-072a-50c1-97a8-4fb1dace1be6", name: "Josh Kartchner", role: "Sales Coach", active: true },
  { uid: "ae6be300-9600-57f0-aa61-6cf2dcf170b4", name: "Angela (ROA Off-Road)", role: "Sales Coach / Marketing", active: true },
  { uid: "974eb91f-d847-5000-b581-29d2d699c7c1", name: "Sales Coach (974eb91f)", role: "Sales Coach", active: true },
  { uid: "f97dd4e1-472d-5a91-8e1f-851168effea9", name: "Sales Coach (f97dd4e1)", role: "Sales Coach", active: true },
  { uid: "3f35b2a7-0017-58c3-a0a0-0ea41f4bc5b4", name: "Sales Coach (3f35b2a7)", role: "Sales Coach", active: true },
  { uid: "f2fe468d-d493-5622-88c1-5d1c604524a1", name: "Team Member (f2fe468d)", role: "Team Member", active: true },
  { uid: "7536af49-4064-58a2-ab53-66e6cf860fe2", name: "Team Member (7536af49)", role: "Team Member", active: true },
];

async function main() {
  const batch = db.batch();
  for (const user of USERS) {
    const ref = db.collection("podium_users").doc(user.uid);
    batch.set(ref, { ...user, _ingestedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  console.log(`Seeded ${USERS.length} users into podium_users.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
