# Flint Chatbot Integration

## Overview

This website uses a floating chatbot widget on every page. The frontend calls local backend routes, and the backend proxies to MiniMax using `MINIMAX_API_KEY` from environment variables.

## Routes

- `GET /api/chat/health`
- `GET /api/chat/models`
- `POST /api/chat/message`

## Request payload (`POST /api/chat/message`)

```json
{
  "sessionId": "string",
  "messages": [{ "role": "user", "content": "hello" }],
  "page": { "url": "https://example.com", "title": "Home", "path": "/" }
}
```

## Environment variables

- `MINIMAX_API_KEY` (required)
- `MINIMAX_BASE_URL` (optional, defaults to `https://api.minimax.io/anthropic`)
- `SITE_CHAT_ALLOWED_ORIGINS` (optional CORS allowlist)
- `SITE_CHAT_RATE_LIMIT_MAX` (optional, default `30` requests/minute per IP)
- `SITE_CHAT_DEFAULT_MODEL` (optional, default `minimax/MiniMax-M2.1`)

## Security notes

- API keys are server-side only.
- Frontend never receives provider credentials.
- Chat messages are rendered as text only to reduce XSS risk.
- Page context sent to backend is metadata-only (URL/title/path).
