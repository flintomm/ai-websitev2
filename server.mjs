import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";

const ALLOWED_ORIGINS = (process.env.SITE_CHAT_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number.parseInt(process.env.SITE_CHAT_RATE_LIMIT_MAX || "30", 10);
const rateLimitStore = new Map();

const MINIMAX_BASE_URL = String(process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic").replace(/\/+$/, "");
const MINIMAX_API_KEY = String(process.env.MINIMAX_API_KEY || "").trim();
const DEFAULT_MODEL = String(process.env.SITE_CHAT_DEFAULT_MODEL || "minimax/MiniMax-M2.1").trim();
const MODEL_ALLOWLIST = [
  "minimax/MiniMax-M2.5",
  "minimax/MiniMax-M2.1",
  "minimax/MiniMax-M2.1-lightning"
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, status, body) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (ALLOWED_ORIGINS.length === 0) return;
  if (!ALLOWED_ORIGINS.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function enforceRateLimit(req) {
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || now - current.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) return false;
  return true;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }))
    .filter((m) => Boolean(m.content))
    .slice(-16);
}

function sanitizePage(page) {
  if (!page || typeof page !== "object") return null;
  return {
    url: String(page.url || "").slice(0, 1000),
    title: String(page.title || "").slice(0, 300),
    path: String(page.path || "").slice(0, 300)
  };
}

function resolveModelRef(inputRef) {
  const requested = String(inputRef || DEFAULT_MODEL).trim();
  if (MODEL_ALLOWLIST.includes(requested)) return requested;
  return DEFAULT_MODEL;
}

function minimaxModelId(modelRef) {
  const parts = String(modelRef).split("/");
  return parts.length > 1 ? parts[1] : "MiniMax-M2.1";
}

function parseAssistantText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b) => b?.type === "text" && typeof b?.text === "string")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function buildSystemPrompt(page) {
  const context = [];
  if (page?.url) context.push(`URL: ${page.url}`);
  if (page?.title) context.push(`Title: ${page.title}`);
  if (page?.path) context.push(`Path: ${page.path}`);

  return [
    "You are Flint, a concise website assistant.",
    "Use only the provided page metadata and user messages for context.",
    "Do not claim to read hidden page content.",
    context.length > 0 ? `Page context:\n${context.join("\n")}` : "Page context: unavailable"
  ].join("\n");
}

async function callMiniMax({ modelRef, messages, page }) {
  if (!MINIMAX_API_KEY) {
    throw new Error("MINIMAX_API_KEY is not configured on the server.");
  }

  const endpoint = `${MINIMAX_BASE_URL}/v1/messages`;
  const payload = {
    model: minimaxModelId(modelRef),
    max_tokens: 900,
    temperature: 0.3,
    system: buildSystemPrompt(page),
    messages
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MINIMAX_API_KEY}`,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax request failed: ${res.status} ${err.slice(0, 180)}`);
  }

  const data = await res.json();
  const text = parseAssistantText(data);
  if (!text) throw new Error("MiniMax returned an empty response.");
  return text;
}

function safeResolveStatic(urlPath) {
  const pathOnly = urlPath.split("?")[0].split("#")[0];
  const rel = pathOnly === "/" ? "index.html" : decodeURIComponent(pathOnly).replace(/^\/+/, "");
  const normalized = path.normalize(rel).replace(/^([.][.][/\\])+/, "");
  const absolute = path.join(__dirname, normalized);
  if (!absolute.startsWith(__dirname)) return null;
  return absolute;
}

function serveStatic(req, res) {
  const target = safeResolveStatic(req.url || "/");
  if (!target) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stats = statSync(target);
    if (!stats.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/api/chat/health") {
    sendJson(res, 200, {
      ok: true,
      mode: "proxy",
      provider: {
        minimaxConfigured: Boolean(MINIMAX_API_KEY),
        baseUrl: MINIMAX_BASE_URL
      },
      models: MODEL_ALLOWLIST
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/chat/models") {
    sendJson(res, 200, {
      models: MODEL_ALLOWLIST.map((ref) => ({ ref, enabled: true }))
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat/message") {
    if (!enforceRateLimit(req)) {
      sendJson(res, 429, { ok: false, error: "Rate limit exceeded. Please retry shortly." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const sessionId = String(body?.sessionId || "").trim().slice(0, 120);
      const messages = sanitizeMessages(body?.messages);
      const page = sanitizePage(body?.page);
      const modelRef = resolveModelRef(body?.modelRef);

      if (!sessionId) {
        sendJson(res, 400, { ok: false, error: "sessionId is required" });
        return;
      }

      if (messages.length === 0 || !messages.some((m) => m.role === "user")) {
        sendJson(res, 400, { ok: false, error: "At least one user message is required" });
        return;
      }

      const assistantText = await callMiniMax({ modelRef, messages, page });
      sendJson(res, 200, {
        ok: true,
        model: modelRef,
        assistant: {
          role: "assistant",
          content: assistantText
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  if (NODE_ENV === "production") {
    console.log("Running static server with MiniMax chat proxy.");
  }
  console.log(`AI Website server running on http://${HOST}:${PORT}`);
});
