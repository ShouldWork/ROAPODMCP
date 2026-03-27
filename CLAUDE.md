# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ROA Podium Intelligence — a Firebase application that syncs Podium CRM data into Firestore and exposes it via an MCP server on Cloud Functions. Three components: Cloud Functions backend, React dashboard, and backfill scripts.

Firebase project: `roa-support` (us-central1)

## Commands

### Dashboard (run from `dashboard/`)
```bash
npm run dev       # Vite dev server on localhost:5173
npm run build     # Production build to dashboard/dist/
npm run lint      # ESLint
npm run preview   # Preview production build
```

### Cloud Functions (run from `functions/`)
```bash
npm run serve     # Firebase emulators for functions
npm run shell     # Interactive functions shell
npm run logs      # View function logs (firebase functions:log)
```

### Backfill Scripts (run from `scripts/`)
```bash
node backfill.js --dry-run              # Verify API connectivity only
node backfill.js --conversations-only   # Fast: conversations only (~2 min)
node backfill.js --full                 # Full import: conversations + messages
node backfill.js --resume               # Resume interrupted import
```

### Deployment
```bash
# Functions (deploy only our functions — other functions exist in roa-support)
firebase deploy --only functions:podiumOAuthStart,functions:podiumOAuthCallback,functions:podiumRefreshToken,functions:podiumMcp,functions:podiumWebhook

# Firestore indexes (takes 5-10 min to build)
firebase deploy --only firestore:indexes

# Firestore security rules
firebase deploy --only firestore:rules

# Dashboard (build first, then deploy)
cd dashboard && npm run build && cd .. && firebase deploy --only hosting
```

See `DEPLOY.md` for the full 12-step deployment sequence.

## Architecture

### Cloud Functions (`functions/index.js`)
Single file containing all Cloud Functions. Uses Firebase Functions v2 (`onRequest` from `firebase-functions/https`).

**HTTP endpoints:**
- `podiumOAuthStart` / `podiumOAuthCallback` — OAuth flow with Podium
- `podiumRefreshToken` — Manual token refresh
- `podiumMcp` — MCP server (StreamableHTTPServerTransport, stateless, CORS open)
- `podiumWebhook` — Real-time Podium webhook receiver (HMAC-SHA256 verification)

**MCP tools (30+):**
- **Firestore tools** (preferred, fast): `fs_dashboard_stats`, `fs_conversations`, `fs_messages`, `fs_search_contacts`, `fs_users`, `fs_follow_up_priority`, `fs_coach_workload`, `fs_campaign_search`, `fs_name_quality`
- **Podium API tools** (live data, 300 req/min rate limit): `get_conversation`, `get_messages`, `get_contact`, `search_contacts`, etc.

**Key patterns:**
- In-memory user cache with 5-min TTL (`getCachedUserMap()`)
- Auto-refresh Podium OAuth tokens 5 min before expiry
- Secrets via `defineSecret()`: `PODIUM_CLIENT_ID`, `PODIUM_CLIENT_SECRET`, `PODIUM_REDIRECT_URI`, `MCP_API_KEY`, `PODIUM_WEBHOOK_SECRET`

### Scheduled Contact Sync (`functions/podiumContactSync/`)
Separate Firebase Functions codebase (declared in `firebase.json` as `podium-contact-sync`). Periodically syncs contacts from Podium API.

### Dashboard (`dashboard/`)
React 19 + Vite SPA with Firebase Auth (email/password). 8 lazy-loaded tabs defined in `App.jsx`:

1. **Overview** — KPIs, recent activity, coach load
2. **Conversations** — Browse/filter/assign conversations
3. **Follow-Up Priority** — Conversations awaiting reply
4. **Coach Workload** — Per-coach metrics
5. **Campaign Analysis** — Search outbound messages
6. **Contact Search** — Multi-field contact search
7. **Reviews** — Reviews needing response
8. **Users** — Manage user roles

Supporting modules: `firebase.js` (Firebase config), `cache.js` (IndexedDB + sessionStorage with 5-min TTL), `hooks/useFirestore.js`, `SmartQuery.jsx` (NLP query parser converting user input to Firestore queries).

### Backfill Scripts (`scripts/`)
Node.js CommonJS scripts using firebase-admin SDK directly. Require a service account key (`roa-support-firebase-adminsdk-*.json`) in the scripts directory.
- `backfill.js` — Main historical import with cursor pagination, batched writes (400 ops/batch), exponential backoff on 429s
- `seed-users.js` — Pre-populate `podium_users` collection
- `backfill-contactNameLower.js`, `backfill-conversations.js`, `enrich-emails.js` — Specialized migration/enrichment scripts

## Firestore Schema

**Synced collections (authenticated read-only):**
- `podium_conversations` — indexed on `(status, lastItemAt)`, `(assignedUserUid, status, lastItemAt)`, `(contactNameLower, lastItemAt)`
- `podium_messages` — indexed on `(conversationUid, createdAt)`, `(direction, createdAt)`, `(senderUid, createdAt)`
- `podium_contacts` — indexed on `(contactNameLower, updatedAt)` for prefix search
- `podium_reviews` — indexed on `(needsResponse, createdAt)`
- `podium_invoices`

**User-writable:**
- `podium_users` — authenticated read; clients can only update `dashboardRole` field
- `deliveries` — authenticated create/read/update, no delete; indexed on `(status, createdAt)`

**Admin-only (Cloud Functions / scripts):**
- `podium_tokens` — OAuth token storage (`podium_tokens/primary`)
- `podium_webhook_log`, `backfill_state`

Name search uses `contactNameLower` field with Firestore range queries for prefix matching.

## Firebase Config

Two function codebases declared in `firebase.json`:
1. `default` — source: `functions/` (main functions)
2. `podium-contact-sync` — source: `functions/podiumContactSync/`

Hosting serves `dashboard/dist/` with SPA rewrite (`** → /index.html`).
