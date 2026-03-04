import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "127.0.0.1";
const NODE_ENV = process.env.NODE_ENV || "development";
const ALLOWED_ORIGINS = (process.env.JAMF_AGENT_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number.parseInt(process.env.JAMF_AGENT_RATE_LIMIT_MAX || "30", 10);
const rateLimitStore = new Map();

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

const KNOWN_MODELS = [
  { ref: "kimi-coding/k2p5", providerId: "kimi-coding", modelId: "k2p5", label: "Kimi K2.5" },
  { ref: "minimax/MiniMax-M2.5", providerId: "minimax", modelId: "MiniMax-M2.5", label: "MiniMax M2.5" },
  { ref: "minimax/MiniMax-M2.1", providerId: "minimax", modelId: "MiniMax-M2.1", label: "MiniMax M2.1" },
  { ref: "minimax/MiniMax-M2.1-lightning", providerId: "minimax", modelId: "MiniMax-M2.1-lightning", label: "MiniMax M2.1 Lightning" }
];

const READ_BASE = "https://r.jina.ai/http://";
const JAMF_FIXED_SOURCES = [
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Jamf_Pro_Documentation.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Computer_Groups.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Computer_Policies.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Configuration_Profiles.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Patch_Management.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Scripts.html",
  "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Packages.html",
  "https://learn.jamf.com/en-US/bundle/technical-articles/page/Technical_Articles.html",
  "https://developer.jamf.com/jamf-pro/reference/post_v1-auth-token",
  "https://developer.jamf.com/jamf-pro/reference/get_v1-computers-inventory"
];

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function defaultBaseUrlForProvider(providerId) {
  if (providerId === "kimi-coding") return normalizeBaseUrl(process.env.KIMI_BASE_URL || "https://api.kimi.com/coding/");
  if (providerId === "minimax") return normalizeBaseUrl(process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic");
  return "";
}

function loadEnvProviders() {
  const providers = {};
  if (process.env.KIMI_API_KEY) {
    providers["kimi-coding"] = {
      baseUrl: normalizeBaseUrl(process.env.KIMI_BASE_URL || "https://api.kimi.com/coding/"),
      apiKey: process.env.KIMI_API_KEY
    };
  }
  if (process.env.MINIMAX_API_KEY) {
    providers.minimax = {
      baseUrl: normalizeBaseUrl(process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic"),
      apiKey: process.env.MINIMAX_API_KEY
    };
  }
  return providers;
}

async function loadRuntimeProviders() {
  const envProviders = loadEnvProviders();
  return envProviders;
}

function resolveModelRoute(modelRef, providers) {
  const match = KNOWN_MODELS.find((m) => m.ref === modelRef);
  if (!match) throw new Error("Unsupported model");
  const provider = providers[match.providerId];
  const apiKey = provider?.apiKey || "";
  const baseUrl = provider?.baseUrl || defaultBaseUrlForProvider(match.providerId);

  if (!apiKey || !baseUrl) {
    throw new Error(`Provider unavailable for model: ${modelRef}. Configure backend env keys.`);
  }
  return {
    providerId: match.providerId,
    modelId: match.modelId,
    baseUrl,
    apiKey,
    modelRef: match.ref
  };
}

function listAvailableModels(providers) {
  return KNOWN_MODELS
    .filter((m) => Boolean(providers[m.providerId]?.apiKey && providers[m.providerId]?.baseUrl))
    .map((m) => ({ ref: m.ref, label: m.label, configured: true }));
}

async function fetchJamfSources(query, limit) {
  const q = String(query || "").toLowerCase();
  const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);

  const scored = JAMF_FIXED_SOURCES.map((url) => {
    const haystack = url.toLowerCase();
    const score = tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
    return { url, score };
  }).sort((a, b) => b.score - a.score);

  const picked = scored.filter((s) => s.score > 0).map((s) => s.url);
  if (picked.length > 0) return picked.slice(0, limit);
  return JAMF_FIXED_SOURCES.slice(0, limit);
}

async function fetchDocSnippets(urls) {
  const snippets = [];
  for (const url of urls) {
    try {
      const readerUrl = READ_BASE + url.replace(/^https?:\/\//, "");
      const res = await fetch(readerUrl);
      if (!res.ok) continue;
      const text = await res.text();
      snippets.push({ url, text: text.slice(0, 2200) });
    } catch {
      // Skip any source fetch error.
    }
  }
  return snippets;
}

function buildSystemPrompt(snippets) {
  const context = snippets.length
    ? snippets.map((s, i) => `Source ${i + 1}: ${s.url}\n${s.text}`).join("\n\n")
    : "No documentation snippets were available.";

  return [
    "You are JAMF Agent, a JAMF-focused assistant.",
    "Use JAMF documentation context when present.",
    "If context is missing or uncertain, say so clearly.",
    "Give concise, actionable steps and mention key UI paths.",
    "If a step depends on Jamf Pro version, mention that.",
    "Context:",
    context
  ].join("\n");
}

function toAnthropicMessages(history, question) {
  const past = Array.isArray(history) ? history.slice(-8) : [];
  const valid = past
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  return [...valid, { role: "user", content: question }];
}

function parseAnthropicText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks.filter((b) => b?.type === "text" && typeof b?.text === "string").map((b) => b.text).join("\n\n").trim();
  return text;
}

async function callProvider({ provider, modelRef, question, history, snippets }) {
  const endpoint = `${provider.baseUrl}/v1/messages`;
  const payload = {
    model: provider.modelId,
    max_tokens: 1200,
    temperature: 0.2,
    system: buildSystemPrompt(snippets),
    messages: toAnthropicMessages(history, question)
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Provider request failed (${modelRef}): ${res.status} ${err.slice(0, 220)}`);
  }

  const data = await res.json();
  const text = parseAnthropicText(data);
  if (!text) throw new Error(`Provider returned no text for ${modelRef}`);
  return text;
}

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
      if (raw.length > 1_000_000) {
        reject(new Error("Request too large"));
      }
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

function clampQuestion(question) {
  return String(question || "").trim().slice(0, 4000);
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

  if (req.method === "POST" && pathname === "/api/jamf-agent/chat") {
    if (!enforceRateLimit(req)) {
      sendJson(res, 429, { ok: false, error: "Rate limit exceeded. Please retry shortly." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const question = clampQuestion(body?.question);
      const modelRef = String(body?.modelRef || "kimi-coding/k2p5").trim();
      const useDocs = body?.useDocs !== false;
      const history = Array.isArray(body?.history) ? body.history : [];
      const docLimit = Math.min(Math.max(Number.parseInt(String(body?.docLimit ?? "2"), 10) || 2, 1), 4);

      if (!question) {
        sendJson(res, 400, { error: "Question is required" });
        return;
      }

      const providers = await loadRuntimeProviders();
      const availableModels = listAvailableModels(providers);
      if (availableModels.length === 0) {
        sendJson(res, 500, { ok: false, error: "No models available." });
        return;
      }
      const provider = resolveModelRoute(modelRef, providers);

      let sourceUrls = [];
      let snippets = [];
      if (useDocs) {
        sourceUrls = await fetchJamfSources(question, docLimit);
        snippets = await fetchDocSnippets(sourceUrls);
      }

      const answer = await callProvider({ provider, modelRef, question, history, snippets });
      sendJson(res, 200, {
        ok: true,
        answer,
        sources: sourceUrls,
        modelRef,
        usedDocs: useDocs
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/jamf-agent/models") {
    const providers = await loadRuntimeProviders();
    sendJson(res, 200, {
      models: listAvailableModels(providers)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/jamf-agent/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  if (NODE_ENV === "production" && ALLOWED_ORIGINS.length === 0) {
    console.warn("Warning: JAMF_AGENT_ALLOWED_ORIGINS is empty in production. Set an origin allowlist.");
  }
  console.log(`AI Website server running on http://${HOST}:${PORT}`);
});
