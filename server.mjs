import { createServer } from "node:http";
import { createReadStream, statSync, readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";
const ALLOWED_ORIGINS = (process.env.JAMF_AGENT_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number.parseInt(process.env.JAMF_AGENT_RATE_LIMIT_MAX || "30", 10);
const rateLimitStore = new Map();

// RAG Data Paths
const RAG_BASE = path.join(__dirname, ".data", "jamf-pro-docs");
const RAG_INDEX_DIR = path.join(RAG_BASE, "index");
const MAX_INDEX_FILE_BYTES = 300 * 1024 * 1024;

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

// Cache for loaded indexes
let ragIndexCache = null;
let ragCacheTime = 0;
const RAG_CACHE_TTL_MS = 60_000; // 1 minute cache

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
  return loadEnvProviders();
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

// ==================== RAG Functions ====================

async function loadRagIndexes() {
  const now = Date.now();
  if (ragIndexCache && (now - ragCacheTime) < RAG_CACHE_TTL_MS) {
    return { index: ragIndexCache };
  }

  try {
    const indexes = [];

    try {
      const indexFiles = readdirSync(RAG_INDEX_DIR).filter(f => f.endsWith("_index.json"));
      for (const file of indexFiles) {
        const filePath = path.join(RAG_INDEX_DIR, file);
        const stats = statSync(filePath);
        if (stats.size > MAX_INDEX_FILE_BYTES) {
          console.warn(`Skipping oversized index file: ${file} (${stats.size} bytes)`);
          continue;
        }
        const indexData = JSON.parse(readFileSync(filePath, "utf-8"));
        indexes.push(indexData);
      }
    } catch (e) {
      console.log("RAG indexes not found or error loading:", e.message);
      return { index: null };
    }

    if (indexes.length === 0) {
      return { index: null };
    }

    // Merge indexes
    const mergedIndex = {
      keyword_index: {},
      chunks: {},
      chunk_count: 0
    };

    for (const idx of indexes) {
      mergedIndex.chunk_count += idx.chunk_count || 0;
      // Merge keyword index
      for (const [word, ids] of Object.entries(idx.keyword_index || {})) {
        if (!mergedIndex.keyword_index[word]) {
          mergedIndex.keyword_index[word] = [];
        }
        mergedIndex.keyword_index[word].push(...ids);
      }
      // Merge chunk previews
      Object.assign(mergedIndex.chunks, idx.chunks);
    }

    ragIndexCache = mergedIndex;
    ragCacheTime = now;

    return { index: mergedIndex };
  } catch (e) {
    console.error("Error loading RAG indexes:", e);
    return { index: null };
  }
}

function searchLocalIndex(query, index, topK = 5) {
  if (!index || !index.keyword_index) return [];

  const queryWords = query.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3);

  const scores = {};
  for (const word of queryWords) {
    const matches = index.keyword_index[word];
    if (matches) {
      for (const chunkId of matches) {
        scores[chunkId] = (scores[chunkId] || 0) + 1;
      }
    }
  }

  // Sort by score
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  return sorted.map(([chunkId, score]) => ({
    id: chunkId,
    score,
    source: "local"
  }));
}

async function fetchLocalChunks(chunkIds, index) {
  const results = [];
  for (const id of chunkIds) {
    const chunk = index?.chunks?.[id];
    if (chunk) {
      results.push({
        id,
        text: chunk.text,
        source: chunk.source || "JAMF Pro Documentation",
        chunk_num: Number.isFinite(chunk.chunk_num) ? chunk.chunk_num : null
      });
    }
  }
  return results;
}

// ==================== End RAG Functions ====================

async function fetchDocSnippetsFromWeb(urls) {
  const snippets = [];
  for (const url of urls) {
    try {
      const readerUrl = READ_BASE + url.replace(/^https?:\/\//, "");
      const res = await fetch(readerUrl);
      if (!res.ok) continue;
      const text = await res.text();
      snippets.push({ url, text: text.slice(0, 2200), source: url });
    } catch {
      // Skip any source fetch error.
    }
  }
  return snippets;
}

function buildSystemPrompt(snippets, hasEvidence) {
  if (!hasEvidence || snippets.length === 0) {
    return [
      "You are JAMF Agent, a JAMF Pro assistant.",
      "CRITICAL: No relevant documentation was found for this query.",
      "Respond with exactly: NO_EVIDENCE",
      "Do not provide generic advice. Only use the NO_EVIDENCE response when no context is available."
    ].join("\n");
  }

  const context = snippets
    .map((s, i) => `Source ${i + 1}: ${s.source || s.url || "JAMF Pro Documentation"}\n${s.text.slice(0, 3000)}`)
    .join("\n\n");

  return [
    "You are JAMF Agent, a JAMF Pro expert assistant.",
    "Use ONLY the provided documentation context to answer.",
    "Give concise, actionable steps and mention key UI paths.",
    "If context is insufficient, say so clearly.",
    "Cite sources by number [1], [2], etc.",
    "",
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

async function callProvider({ provider, modelRef, question, history, snippets, hasEvidence }) {
  const endpoint = `${provider.baseUrl}/v1/messages`;
  const payload = {
    model: provider.modelId,
    max_tokens: 1200,
    temperature: 0.2,
    system: buildSystemPrompt(snippets, hasEvidence),
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
      const docLimit = Math.min(Math.max(Number.parseInt(String(body?.docLimit ?? "5"), 10) || 5, 1), 10);

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

      // ==================== RAG Flow ====================
      let snippets = [];
      let sources = [];
      let hasEvidence = false;
      let usedLocalIndex = false;

      if (useDocs) {
        // 1. Try local index first
        const { index } = await loadRagIndexes();
        
        if (index) {
          const searchResults = searchLocalIndex(question, index, docLimit);
          
          if (searchResults.length > 0) {
            const chunkIds = searchResults.map(r => r.id);
            const localSnippets = await fetchLocalChunks(chunkIds, index);
            
            if (localSnippets.length > 0) {
              snippets = localSnippets.map(s => ({
                text: s.text,
                source: Number.isFinite(s.chunk_num)
                  ? `JAMF Pro Docs (chunk ${s.chunk_num + 1})`
                  : "JAMF Pro Docs"
              }));
              sources = searchResults.map(r => `chunk:${r.id}`);
              hasEvidence = true;
              usedLocalIndex = true;
            }
          }
        }

        // 2. Fall back to web sources if no local evidence
        if (!hasEvidence) {
          // Use a minimal fallback - no evidence path
          hasEvidence = false;
        }
      }

      const answer = await callProvider({ 
        provider, 
        modelRef, 
        question, 
        history, 
        snippets, 
        hasEvidence 
      });

      // Check for NO_EVIDENCE response
      const isNoEvidence = answer.includes("NO_EVIDENCE") || 
                           (!hasEvidence && answer.toLowerCase().includes("no evidence"));

      sendJson(res, 200, {
        ok: true,
        answer: isNoEvidence 
          ? "I don't have specific documentation for that query. Please try a more specific JAMF Pro question, or the documentation may not cover this topic."
          : answer,
        sources,
        modelRef,
        usedDocs: useDocs,
        usedLocalIndex,
        hasEvidence: !isNoEvidence,
        citations: snippets.map((s, i) => ({ id: i + 1, source: s.source }))
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
    // Also return RAG status
    const { index } = await loadRagIndexes();
    sendJson(res, 200, { 
      ok: true,
      rag: {
        available: !!index,
        chunkCount: index?.chunk_count || 0
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  // Create RAG directories if they don't exist
  try {
    if (!existsSync(RAG_BASE)) {
      mkdirSync(RAG_BASE, { recursive: true });
      mkdirSync(path.join(RAG_BASE, "raw"), { recursive: true });
      mkdirSync(path.join(RAG_BASE, "normalized"), { recursive: true });
      mkdirSync(path.join(RAG_BASE, "chunks"), { recursive: true });
      mkdirSync(path.join(RAG_BASE, "index"), { recursive: true });
      mkdirSync(path.join(RAG_BASE, "manifests"), { recursive: true });
      console.log("Created RAG data directories");
    }
  } catch (e) {
    console.warn("Could not create RAG directories:", e.message);
  }

  if (NODE_ENV === "production" && ALLOWED_ORIGINS.length === 0) {
    console.warn("Warning: JAMF_AGENT_ALLOWED_ORIGINS is empty in production. Set an origin allowlist.");
  }
  console.log(`AI Website server running on http://${HOST}:${PORT}`);
  console.log(`RAG data path: ${RAG_BASE}`);
});
