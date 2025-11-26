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

Notes
- When the server starts it prints the absolute running folder (`Running from:`) and whether Bunny/OpenAI are configured. This helps prevent accidentally starting the archived copy.

If you need to run the archived server for debugging, see `_archived_videotheque-backend/README.md` for instructions.
