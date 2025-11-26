# Videotheque — Backend (canonical)

This `backend/` folder is the canonical and unified backend for the project.

Why this exists
- There used to be two copies of the server in the repo. To avoid confusion we merged everything into this folder and archived the other copy at `_archived_videotheque-backend/`.

How to run
- Start the main backend from this folder:

```bash
cd /path/to/repo/backend
npm install   # if you haven't already
npm run start:backend
```

API endpoints (examples)
- GET /api/videos — returns a list of videos.
- POST /api/validate — accepts { code: '...' } and validates it (activates on first use, valid for 1 hour).
- POST /api/chat — talks to OpenAI if `OPENAI_API_KEY` is present, otherwise returns a fallback message.

Environment variables
- BUNNY_API_KEY and BUNNY_LIBRARY_ID — will make `/api/videos` use Bunny.net API. Falls back to `data/videos.json` if not present.
- OPENAI_API_KEY — enables the chat route to use OpenAI.

Database / migration
- The backend now uses SQLite (file: `data/db.sqlite`) for codes storage. On first run, if `data/db.sqlite` doesn't exist but `data/codes.json` does, the server will auto-import codes from `codes.json` into the DB.
- Using a DB allows atomic updates and easier migration in the future; if you want Postgres instead I can add a migration layer.

Admin & merchant integration (gift cards)
- ADMIN_API_KEY (env var) — required for admin endpoints. Use the header `x-admin-key` when calling admin endpoints.
	- Endpoints:
		- GET /api/admin/codes → list all codes
		- POST /api/admin/codes { count, prefix, length } → create single or bulk codes
		- GET /api/admin/codes/export → CSV export of codes

- MERCHANT_API_KEY (env var) — merchant webhook key. Merchant calls `POST /api/webhook/giftcard` with `{ quantity, prefix, customerRef }` to create codes programmatically; the response contains the codes which can be printed and delivered.

Security notes
Usage examples

Generate 3 codes via admin API (local dev default admin key shown):

```bash
curl -X POST http://localhost:3001/api/admin/codes \
	-H "Content-Type: application/json" \
	-H "x-admin-key: dev_admin_key_change_me" \
	-d '{"count":3, "prefix":"GFT"}'
```

Webhook example (merchant creates 2 gift codes for order-789):

```bash
curl -X POST http://localhost:3001/api/webhook/giftcard \
	-H "Content-Type: application/json" \
	-H "x-merchant-key: dev_merchant_key_change_me" \
	-d '{"quantity":2, "prefix":"GFTWEB", "customerRef":"order-789"}'
```

- Keep `ADMIN_API_KEY`, `MERCHANT_API_KEY` and `VIDEO_TOKEN_SECRET` secret — add them in Vercel's Project > Settings > Environment Variables.

 - VIDEO_TOKEN_SECRET — (new) secret used to sign 1-hour access tokens for video playback. If not set the app uses a dev secret. Set this on Vercel:
	 - Key: VIDEO_TOKEN_SECRET
	 - Value: a long random string (e.g. generated with `openssl rand -hex 32`).

Access flow for 1-hour sessions (Bunny)
- The backend supports generating an access token for a specific video via POST /api/videos/:id/access.
	- Request body must include { "code": "YOUR_CODE" } — the same codes used by /api/validate.
	- If the code is valid or activated within the last hour, the server returns { accessUrl, expiresIn } where accessUrl is a short-lived route that validates the token and redirects to Bunny or the local video URL.
	- The redirect route is GET /api/videos/stream/:id?token=xxx and expires after 1 hour.

Notes
- When the server starts it prints the absolute running folder (`Running from:`) and whether Bunny/OpenAI are configured. This helps prevent accidentally starting the archived copy.

If you need to run the archived server for debugging, see `_archived_videotheque-backend/README.md` for instructions.
