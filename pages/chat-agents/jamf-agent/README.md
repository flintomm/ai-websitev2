# JAMF Agent (Secure Backend Mode)

This chatbot now uses a **server-side proxy** instead of browser-entered API keys.

## How it works

- Frontend popup chat calls: `POST /api/jamf-agent/chat`
- Backend (`/server.mjs`) reads provider keys from environment variables
- Requests route through your configured low-cost models (Kimi / MiniMax)
- API keys never appear in browser code

## Run locally

From the project root:

```bash
cd "/Users/flint/Documents/AI Website"
npm run setup:env
npm run start:env
```

Then open:

- `http://127.0.0.1:8080/`
- JAMF page: `http://127.0.0.1:8080/pages/chat-agents/jamf-agent/index.html`

## Notes

- If you open the HTML file directly (`file://...`), chat calls will fail because the API route needs the local server.
- Allowed model refs are restricted in server code for safety.
- JAMF documentation retrieval is also done server-side.

## Deploy Split (GitHub Pages + Backend)

For GitHub Pages, host static files there and host `server.mjs` separately.

1. Deploy static site to GitHub Pages.
2. Deploy backend to a Node host (Render/Railway/Fly/VPS).
3. Set backend env vars:
   - `HOST=0.0.0.0`
   - `PORT=8080` (or platform port)
   - `NODE_ENV=production`
   - `JAMF_AGENT_ALLOWED_ORIGINS=https://<your-gh-pages-domain>`
   - At least one provider key: `KIMI_API_KEY` or `MINIMAX_API_KEY`
   - Optional: `JAMF_AGENT_RATE_LIMIT_MAX=30`
4. In JAMF Agent settings, set `API Base URL` to your backend URL.

Health check endpoint:

- `GET /api/jamf-agent/health`

Model discovery endpoint:

- `GET /api/jamf-agent/models`
