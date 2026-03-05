(function initFlintChatbot() {
  const STORAGE = {
    open: "flint_chat_open_v1",
    sessionId: "flint_chat_session_id_v1",
    messages: "flint_chat_messages_v1"
  };

  const MAX_MESSAGES = 20;
  const state = {
    open: readBool(STORAGE.open),
    sending: false,
    sessionId: readOrCreateSessionId(),
    messages: readMessages(),
    previousFocus: null
  };

  const els = {};

  function readBool(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function readOrCreateSessionId() {
    try {
      const existing = localStorage.getItem(STORAGE.sessionId);
      if (existing) return existing;
      const id = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE.sessionId, id);
      return id;
    } catch {
      return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function readMessages() {
    try {
      const raw = localStorage.getItem(STORAGE.messages);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_MESSAGES);
    } catch {
      return [];
    }
  }

  function saveMessages() {
    try {
      localStorage.setItem(STORAGE.messages, JSON.stringify(state.messages.slice(-MAX_MESSAGES)));
    } catch {
      // no-op
    }
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle("error", Boolean(isError));
  }

  function setOpen(open) {
    state.open = open;
    els.panel.hidden = !open;
    els.launcher.setAttribute("aria-expanded", String(open));
    els.launcher.textContent = open ? "Close Chat" : "Ask Flint";

    try {
      localStorage.setItem(STORAGE.open, open ? "1" : "0");
    } catch {
      // no-op
    }

    if (open) {
      state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => els.input.focus());
    } else {
      const returnTarget = state.previousFocus && state.previousFocus.isConnected
        ? state.previousFocus
        : els.launcher;
      returnTarget.focus();
    }
  }

  function addBubble(role, text, persist) {
    const safeRole = role === "user" ? "user" : "assistant";
    const item = document.createElement("li");
    item.className = `flint-chat-bubble ${safeRole}`;
    item.textContent = String(text || "");
    els.messages.appendChild(item);
    els.messages.scrollTop = els.messages.scrollHeight;

    if (persist) {
      state.messages.push({ role: safeRole, content: String(text || "") });
      state.messages = state.messages.slice(-MAX_MESSAGES);
      saveMessages();
    }
  }

  function renderMessages() {
    els.messages.innerHTML = "";
    if (state.messages.length === 0) {
      addBubble("assistant", "Hi, I'm Flint. Ask me about this page or any project on this site.", false);
      return;
    }
    state.messages.forEach((m) => addBubble(m.role, m.content, false));
  }

  function buildPageContext() {
    return {
      url: window.location.href,
      title: document.title || "",
      path: window.location.pathname || ""
    };
  }

  async function sendMessage(text) {
    const content = String(text || "").trim().slice(0, 4000);
    if (!content || state.sending) return;

    if (!state.open) setOpen(true);

    state.sending = true;
    els.send.disabled = true;
    setStatus("Thinking...", false);
    addBubble("user", content, true);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          messages: state.messages.slice(-16),
          page: buildPageContext()
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${err.slice(0, 160)}`);
      }

      const data = await response.json();
      const reply = String(data?.assistant?.content || "").trim();
      if (!reply) throw new Error("Assistant returned an empty response.");

      addBubble("assistant", reply, true);
      setStatus("Ready", false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed", true);
      addBubble("assistant", "I hit a temporary issue. Please try again.", true);
    } finally {
      state.sending = false;
      els.send.disabled = false;
      els.input.focus();
    }
  }

  function buildUi() {
    const root = document.createElement("div");
    root.id = "flintChatRoot";

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "flint-chat-launcher";
    launcher.setAttribute("aria-controls", "flintChatPanel");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Toggle chatbot");

    const panel = document.createElement("section");
    panel.className = "flint-chat-panel";
    panel.id = "flintChatPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Flint chatbot window");

    const head = document.createElement("header");
    head.className = "flint-chat-head";

    const title = document.createElement("h2");
    title.className = "flint-chat-title";
    title.textContent = "Flint Chat";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "flint-chat-close";
    close.setAttribute("aria-label", "Close chat");
    close.textContent = "x";

    head.appendChild(title);
    head.appendChild(close);

    const messages = document.createElement("ul");
    messages.className = "flint-chat-messages";

    const form = document.createElement("form");
    form.className = "flint-chat-form";

    const label = document.createElement("label");
    label.setAttribute("for", "flintChatInput");
    label.textContent = "Message";

    const row = document.createElement("div");
    row.className = "flint-chat-row";

    const input = document.createElement("input");
    input.id = "flintChatInput";
    input.className = "flint-chat-input";
    input.type = "text";
    input.maxLength = 4000;
    input.placeholder = "Ask about this page";
    input.autocomplete = "off";

    const send = document.createElement("button");
    send.type = "submit";
    send.className = "flint-chat-send";
    send.textContent = "Send";

    row.appendChild(input);
    row.appendChild(send);

    const status = document.createElement("p");
    status.className = "flint-chat-status";
    status.textContent = "Ready";

    form.appendChild(label);
    form.appendChild(row);
    form.appendChild(status);

    panel.appendChild(head);
    panel.appendChild(messages);
    panel.appendChild(form);

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    els.root = root;
    els.launcher = launcher;
    els.panel = panel;
    els.close = close;
    els.messages = messages;
    els.form = form;
    els.input = input;
    els.send = send;
    els.status = status;
  }

  function bindUi() {
    els.launcher.addEventListener("click", () => setOpen(!state.open));
    els.close.addEventListener("click", () => setOpen(false));

    els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = els.input.value;
      els.input.value = "";
      sendMessage(value);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.open) {
        setOpen(false);
      }
    });
  }

  function init() {
    buildUi();
    bindUi();
    renderMessages();
    setOpen(state.open);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
