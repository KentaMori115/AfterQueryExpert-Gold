# CloudVault Storage API

A full-stack file storage service built with [Next.js](https://nextjs.org) (App Router), Firebase Firestore, Upstash Redis, and the Telegram Bot API. Files are uploaded to a user's private Telegram chat via their own bot token, and served back through a stable API with usage tracking.

## Features

- **API key auth** — per-user keys with names, activation state, and usage counters.
- **Upload / download / delete** — files are proxied through Telegram and re-served with the original filename, extension, and MIME type.
- **Persistent metadata** — canonical per-file Firestore records plus an append-only history collection.
- **Usage stats** — per-key and aggregate request, storage, and bandwidth totals for the dashboard.
- **Rate limiting** — per-client limits backed by Upstash Redis with a fail-open fallback.
- **Dashboard UI** — create and test API keys, view usage cards, and copy client examples.

## Architecture

```
app/api/            Next.js API routes
├── upload/         POST multipart file -> Telegram -> Firestore metadata
├── file/[fileId]   GET metadata / proxy download (?download=1, ?refresh=1)
├── files/          GET links for one or more Telegram file IDs
├── delete/[fileId] DELETE the Telegram message
├── generateApiKey/ POST create a user profile + first API key
└── apiKeys/        GET list / POST create / DELETE deactivate / PUT rename

lib/                Pure helpers and data access
├── api-key.ts      API key generation and validation
├── file-utils.ts   Extension, size, and MIME helpers
├── stats.ts        Usage aggregation
├── firestore.ts    Client-side Firestore access
├── firestore-admin.ts  Admin (service-account) access
├── rate-limit.ts   Redis rate limiting
└── utils.ts        Redis client, shared utilities
```

## Getting Started

### Prerequisites

- Node.js 20+ (CI and Docker use Node 24)
- A Firebase project (client + admin service account)
- An Upstash Redis instance
- A Telegram bot token

### Install

```bash
npm ci
```

### Configure

```bash
cp .env.example .env.local
```

Fill in the Firebase client keys, the Firebase Admin service account (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`), the Upstash Redis credentials, and your `TELEGRAM_BOT_TOKEN`.

### Run

```bash
npm run dev        # development server
npm run build      # production build
npm run start      # start the production server
```

### Test

```bash
npm test           # run the Jest unit suite
npm run typecheck  # TypeScript type check
```

## API

All `/api/*` endpoints (except `POST /api/generateApiKey`) require an `Authorization: Bearer <api_key>` header.

| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | Upload a file (max 50 MB) |
| GET | `/api/file/:fileId` | File metadata + direct download URL |
| GET | `/api/file/:fileId?download=1` | Proxy-download the file bytes |
| GET | `/api/files?fileId=..&fileId=..` | Resolve Telegram file links |
| DELETE | `/api/delete/:fileId` | Delete the Telegram message |
| POST | `/api/generateApiKey` | Create profile + first API key |
| GET/POST | `/api/apiKeys` | List / create API keys |
| PUT | `/api/apiKeys/:keyId/name` | Rename an API key |
| DELETE | `/api/apiKeys/:keyId` | Deactivate an API key |

## Deployment

The included `Dockerfile` builds and runs the app in production mode:

```bash
docker build -t cloudvault-storage-api .
docker run -p 3000:3000 --env-file .env.local cloudvault-storage-api
```

CI runs on every push via `.github/workflows/ci.yml` (`npm ci` → `npm test` → `npm run typecheck` → `npm run build`).

## Large File Chunking (up to 250MB)

Files larger than 45MB are automatically split into multiple chunks during upload and sent to Telegram. When downloading, the `/api/file/:fileId?download=1` endpoint dynamically streams and reassembles the pieces on-the-fly, bypassing the Telegram bot API upload limit.

## Bi-Directional Telegram Webhook Bot

You can interact with your storage directly through Telegram by setting up a Webhook:
- **Webhook Endpoint**: `POST /api/webhooks/telegram?secret=YOUR_WEBHOOK_SECRET`
- **Commands**:
  - `/list` - View last 5 files uploaded
  - `/delete <fileId>` - Delete file metadata
  - Forward files/images directly to the bot to upload them to your account.
