# ROA Podium Intelligence — Deployment Guide

## Prerequisites

- Node.js 18+ installed
- Firebase CLI: `npm install -g firebase-tools`
- Logged in: `firebase login`
- Service account key for local scripts (download from Firebase Console → Project Settings → Service Accounts → Generate New Private Key)

---

## Step 1: Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

This creates composite indexes needed for dashboard queries. Takes 5-10 minutes to build.

## Step 2: Deploy Firestore Security Rules

```bash
firebase deploy --only firestore:rules
```

## Step 3: Set Webhook Secret

```bash
firebase functions:secrets:set PODIUM_WEBHOOK_SECRET
# Enter a strong random string
```

## Step 4: Deploy Cloud Functions

```bash
firebase deploy --only functions:podiumOAuthStart,functions:podiumOAuthCallback,functions:podiumRefreshToken,functions:podiumMcp,functions:podiumWebhook
```

## Step 5: Seed Known Users

```bash
cd scripts
cp .env.template .env
# Edit .env with your credentials
# Place service-account-key.json in scripts/
npm install
node seed-users.js
```

## Step 6: Run Backfill — Dry Run

```bash
node backfill.js --dry-run
```

Verifies API connectivity without writing to Firestore.

## Step 7: Run Backfill — Conversations Only (Fast, ~2 min)

```bash
node backfill.js --conversations-only
```

Populates `podium_conversations` collection. No messages.

## Step 8: Run Full Backfill (Overnight)

```bash
node backfill.js
```

Fetches all conversations AND all messages. For 10k+ conversations this can take hours.
If it fails mid-run, resume with:

```bash
node backfill.js --resume
```

## Step 9: Register Podium Webhook

1. Go to Podium Developer Dashboard
2. Create a new webhook pointing to:
   ```
   https://us-central1-roa-support.cloudfunctions.net/podiumWebhook
   ```
3. Subscribe to events: `message.created`, `contact.created`, `contact.updated`, `review.created`, `invoice.created`, `invoice.updated`
4. Save the webhook secret and ensure it matches the value from Step 3

## Step 10: Verify Webhook

Send a test message in Podium and check:
```bash
firebase functions:log --only podiumWebhook
```

Check Firestore for new documents in `podium_webhook_log`.

## Step 11: Deploy Dashboard

```bash
cd dashboard
cp .env.template .env
# Edit .env with Firebase web app config values
npm install
npm run build
cd ..
firebase deploy --only hosting
```

Dashboard will be available at: `https://roa-support.web.app`

## Step 12: Create Dashboard User

1. Go to Firebase Console → Authentication → Add User
2. Add manager email/password
3. They can now sign in to the dashboard

---

## Project Structure

```
roa-podium-mcp/
  firebase.json              — Firebase config (functions + firestore + hosting)
  firestore.rules            — Security rules
  firestore.indexes.json     — Composite indexes
  functions/
    index.js                 — All Cloud Functions (OAuth, MCP, webhook)
  scripts/
    backfill.js              — Historical data backfill
    seed-users.js            — Pre-populate known users
    .env.template            — Environment variables template
  dashboard/
    src/                     — React dashboard source
    dist/                    — Built dashboard (deployed to Firebase Hosting)
```
