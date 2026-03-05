(function siteAssistantBootstrap() {
  const STORAGE = {
    unlocked: "site_assistant_unlocked_v1",
    email: "site_assistant_email_v1",
    sessionId: "site_assistant_session_id_v1",
    messages: "site_assistant_messages_v1",
    apiBase: "site_assistant_api_base_v1"
  };

  const SESSION = {
    revealPlayed: "site_assistant_reveal_played_v1"
  };

  const config = window.SITE_ASSISTANT_CONFIG || {};
  const defaultApiBase = "https://fantastic-strength-production-7563.up.railway.app";
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const trackedControls = new Set();
  let lastPageKey = "";

  const state = {
    unlocked: readBool(STORAGE.unlocked),
    freshUnlock: false,
    gateState: "locked",
    chatOpen: false,
    sending: false,
    sessionId: readOrInitSessionId(),
    apiBase: resolveApiBase(),
    messages: readMessages(),
    currentPage: buildPageView(),
    previousFocus: null,
    pendingGateError: ""
  };

  const els = {};

  function readBool(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function readMessages() {
    try {
      const raw = localStorage.getItem(STORAGE.messages);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-30);
    } catch {
      return [];
    }
  }

  function readOrInitSessionId() {
    try {
      const existing = localStorage.getItem(STORAGE.sessionId);
      if (existing) return existing;
      const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE.sessionId, id);
      return id;
    } catch {
      return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function resolveApiBase() {
    const configured = String(config.apiBase || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    try {
      const saved = String(localStorage.getItem(STORAGE.apiBase) || "").trim();
      if (saved) return saved.replace(/\/+$/, "");
    } catch {
      // no-op
    }
    return defaultApiBase.replace(/\/+$/, "");
  }

  function toApiUrl(pathname) {
    if (!state.apiBase) return pathname;
    return `${state.apiBase}${pathname}`;
  }

  function buildPageView() {
    return {
      type: "page_view",
      url: window.location.href,
      title: document.title || "",
      siteName: window.location.hostname || "",
      path: window.location.pathname || "",
      referrer: document.referrer || "",
      ts: Date.now()
    };
  }

  function emitEvent(event) {
    const payload = {
      sessionId: state.sessionId,
      source: "site-assistant",
      event
    };

    return fetch(toApiUrl("/api/site-chat/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {
      // Silent failure to avoid blocking browsing.
    });
  }

  function emitGateState(nextState, extra) {
    state.gateState = nextState;
    const event = {
      type: "gate_state",
      state: nextState,
      ts: Date.now()
    };

    if (extra && typeof extra.email === "string") event.email = extra.email;
    if (extra && typeof extra.error === "string") event.error = extra.error;

    emitEvent(event);
  }

  function emitChatCommand(action) {
    emitEvent({
      type: "chat_command",
      action,
      ts: Date.now()
    });
  }

  function maybeEmitPageView() {
    const page = buildPageView();
    const key = `${page.url}|${page.title}`;
    if (key === lastPageKey) return;
    lastPageKey = key;
    state.currentPage = page;
    emitEvent(page);
  }

  function bindNavigationObserver() {
    maybeEmitPageView();

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function patchedPushState() {
      originalPushState.apply(this, arguments);
      setTimeout(maybeEmitPageView, 0);
    };

    history.replaceState = function patchedReplaceState() {
      originalReplaceState.apply(this, arguments);
      setTimeout(maybeEmitPageView, 0);
    };

    window.addEventListener("popstate", maybeEmitPageView);
    window.addEventListener("hashchange", maybeEmitPageView);
    window.addEventListener("pageshow", maybeEmitPageView);
  }

  function isValidEmail(value) {
    const email = String(value || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function collectGatedControls() {
    const explicit = Array.from(document.querySelectorAll("[data-gated-control]"));
    explicit.forEach((el) => trackedControls.add(el));
  }

  function setControlLocked(el, locked) {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.siteGateManaged !== "1") {
      el.dataset.siteGateManaged = "1";
      if ("disabled" in el) {
        el.dataset.siteGateWasDisabled = String(Boolean(el.disabled));
      }
      el.dataset.siteGateTabIndex = el.getAttribute("tabindex") || "";
      if (el.tagName === "A") {
        el.dataset.siteGateHref = el.getAttribute("href") || "";
      }
    }

    if (locked) {
      el.classList.add("site-gated-disabled");
      if ("disabled" in el) {
        el.disabled = true;
      }
      el.setAttribute("aria-disabled", "true");
      if (el.getAttribute("role") === "button" || el.tagName === "A" || el.tagName === "SUMMARY") {
        el.setAttribute("tabindex", "-1");
      }
      return;
    }

    el.classList.remove("site-gated-disabled");
    if ("disabled" in el) {
      el.disabled = el.dataset.siteGateWasDisabled === "true";
    }
    el.removeAttribute("aria-disabled");
    if (el.getAttribute("role") === "button" || el.tagName === "A" || el.tagName === "SUMMARY") {
      const prev = el.dataset.siteGateTabIndex || "";
      if (prev) {
        el.setAttribute("tabindex", prev);
      } else {
        el.removeAttribute("tabindex");
      }
    }
  }

  function applyGateToControls(locked) {
    trackedControls.forEach((el) => setControlLocked(el, locked));
  }

  function addMessage(role, content, persist) {
    const safeRole = role === "user" ? "user" : "assistant";
    const item = document.createElement("li");
    item.className = `site-assistant-bubble ${safeRole}`;
    item.textContent = String(content || "");
    els.messageList.appendChild(item);
    els.messageList.scrollTop = els.messageList.scrollHeight;

    if (persist) {
      state.messages.push({ role: safeRole, content: String(content || "") });
      state.messages = state.messages.slice(-30);
      try {
        localStorage.setItem(STORAGE.messages, JSON.stringify(state.messages));
      } catch {
        // no-op
      }
    }
  }

  function renderMessages() {
    els.messageList.innerHTML = "";
    if (state.messages.length === 0) {
      addMessage("assistant", "Welcome. Unlock access with your email to begin.", false);
      return;
    }
    state.messages.forEach((m) => addMessage(m.role, m.content, false));
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle("error", Boolean(isError));
  }

  function setChatOpen(open) {
    state.chatOpen = open;
    els.chatWindow.hidden = !open;
    els.chatToggle.setAttribute("aria-expanded", String(open));

    if (open) {
      state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      emitChatCommand("open");
      els.chatWindow.classList.remove("blurb-open");
      void els.chatWindow.offsetWidth;
      els.chatWindow.classList.add("blurb-open");
      requestAnimationFrame(() => els.chatInput.focus());
    } else {
      emitChatCommand("close");
      const returnTarget = state.previousFocus && state.previousFocus.isConnected ? state.previousFocus : els.chatToggle;
      returnTarget.focus();
    }
  }

  async function sendChatMessage(question) {
    const trimmed = String(question || "").trim().slice(0, 4000);
    if (!trimmed || state.sending) return;

    state.sending = true;
    els.chatSend.disabled = true;
    addMessage("user", trimmed, true);
    setStatus("Thinking...", false);

    try {
      const response = await fetch(toApiUrl("/api/site-chat/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          modelRef: "minimax/MiniMax-M2.1",
          messages: state.messages.slice(-16)
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${text.slice(0, 160)}`);
      }

      const data = await response.json();
      const assistant = String(data?.assistantMessage?.content || "").trim();
      if (!assistant) throw new Error("Assistant returned an empty response.");
      addMessage("assistant", assistant, true);
      setStatus("Ready", false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed", true);
      addMessage("assistant", "I ran into a temporary error. Please try again.", true);
    } finally {
      state.sending = false;
      els.chatSend.disabled = false;
      els.chatInput.focus();
    }
  }

  async function submitEmailGate(email) {
    emitGateState("unlocking", { email });
    els.gateError.textContent = "";
    els.gateProgress.textContent = "Unlocking...";
    els.gateSubmit.disabled = true;

    state.unlocked = true;
    state.freshUnlock = true;
    try {
      localStorage.setItem(STORAGE.unlocked, "1");
      localStorage.setItem(STORAGE.email, email);
    } catch {
      // no-op
    }

    emitGateState("unlocked", { email });
    updateUiForGateState();
    revealHeaderOncePerSession();
    setStatus("Ready", false);
    els.gateSubmit.disabled = false;
    els.gateProgress.textContent = "";
  }

  function revealHeaderOncePerSession() {
    if (reducedMotion) return;
    try {
      if (sessionStorage.getItem(SESSION.revealPlayed) === "1") return;
      sessionStorage.setItem(SESSION.revealPlayed, "1");
    } catch {
      // no-op
    }

    els.chatToggle.classList.add("reveal");
    window.setTimeout(() => els.chatToggle.classList.remove("reveal"), 320);
  }

  function playVaultAnimation(onComplete) {
    if (reducedMotion) { onComplete(); return; }
    els.gate.classList.add("vault-opening");
    window.setTimeout(() => {
      els.gate.classList.remove("vault-opening");
      onComplete();
    }, 750);
  }

  function triggerTagGlow() {
    if (reducedMotion) return;
    els.chatToggle.classList.remove("sa-glow");
    void els.chatToggle.offsetWidth; // reflow to restart animation
    els.chatToggle.classList.add("sa-glow");
    window.setTimeout(() => els.chatToggle.classList.remove("sa-glow"), 1700);
  }

  function revealButtons() {
    if (reducedMotion) return;
    const dropdowns = document.querySelectorAll(".work-dropdown");
    dropdowns.forEach((el, i) => {
      window.setTimeout(() => el.classList.add("gate-revealed"), i * 90);
    });
  }

  function updateUiForGateState() {
    const locked = !state.unlocked;
    applyGateToControls(locked);

    els.chatToggle.hidden = locked;

    if (locked) {
      els.gate.hidden = false;
      if (state.pendingGateError) {
        els.gateError.textContent = state.pendingGateError;
      } else {
        els.gateError.textContent = "";
      }
      if (state.chatOpen) setChatOpen(false);
      requestAnimationFrame(() => els.gateEmail.focus());
      return;
    }

    if (state.freshUnlock) {
      state.freshUnlock = false;
      els.gate.hidden = false;
      playVaultAnimation(() => {
        els.gate.hidden = true;
        setChatOpen(true);
        triggerTagGlow();
      });
      revealButtons();
    } else {
      els.gate.hidden = true;
    }
    els.gateError.textContent = "";
    state.pendingGateError = "";
  }

  function buildUi() {
    const root = document.createElement("div");
    root.id = "siteAssistantRoot";
    root.setAttribute("data-site-chat-owned", "1");


    const chatWindow = document.createElement("section");
    chatWindow.className = "site-assistant-window";
    chatWindow.id = "siteAssistantWindow";
    chatWindow.setAttribute("role", "dialog");
    chatWindow.setAttribute("aria-modal", "false");
    chatWindow.setAttribute("aria-label", "Site assistant chat window");
    chatWindow.hidden = true;

    const head = document.createElement("header");
    head.className = "site-assistant-head";

    const title = document.createElement("h2");
    title.className = "site-assistant-title";
    title.textContent = "Site Assistant";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "site-assistant-close";
    close.setAttribute("aria-label", "Close assistant chat");
    close.textContent = "x";

    head.appendChild(title);
    head.appendChild(close);

    const messageList = document.createElement("ul");
    messageList.className = "site-assistant-messages";
    messageList.id = "siteAssistantMessages";

    const composer = document.createElement("form");
    composer.className = "site-assistant-form";

    const inputLabel = document.createElement("label");
    inputLabel.setAttribute("for", "siteAssistantInput");
    inputLabel.textContent = "Message";

    const row = document.createElement("div");
    row.className = "site-assistant-row";

    const input = document.createElement("input");
    input.id = "siteAssistantInput";
    input.className = "site-assistant-input";
    input.type = "text";
    input.placeholder = "Ask about this page";
    input.maxLength = 4000;
    input.autocomplete = "off";

    const send = document.createElement("button");
    send.type = "submit";
    send.className = "site-assistant-send";
    send.textContent = "Send";

    row.appendChild(input);
    row.appendChild(send);

    const status = document.createElement("p");
    status.className = "site-assistant-status";
    status.id = "siteAssistantStatus";
    status.textContent = "Ready";

    composer.appendChild(inputLabel);
    composer.appendChild(row);
    composer.appendChild(status);

    chatWindow.appendChild(head);
    chatWindow.appendChild(messageList);
    chatWindow.appendChild(composer);

    const gate = document.createElement("section");
    gate.className = "site-email-gate";
    gate.id = "siteEmailGate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "siteEmailGateTitle");

    const gatePanel = document.createElement("div");
    gatePanel.className = "site-email-gate-panel";

    const gateTitle = document.createElement("h2");
    gateTitle.id = "siteEmailGateTitle";
    gateTitle.className = "site-email-gate-title";
    const gateForm = document.createElement("form");
    gateForm.className = "site-email-gate-form";

    const gateEmail = document.createElement("input");
    gateEmail.id = "siteGateEmail";
    gateEmail.type = "email";
    gateEmail.required = true;
    gateEmail.placeholder = "your@email.com";
    gateEmail.autocomplete = "email";

    const gateSubmit = document.createElement("button");
    gateSubmit.type = "submit";
    gateSubmit.className = "site-email-gate-submit";
    gateSubmit.textContent = "Unlock";

    const gateProgress = document.createElement("p");
    gateProgress.className = "site-email-gate-progress";
    gateProgress.id = "siteGateProgress";

    const gateError = document.createElement("p");
    gateError.className = "site-email-gate-error";
    gateError.id = "siteGateError";

    gateForm.appendChild(gateEmail);
    gateForm.appendChild(gateSubmit);
    gateForm.appendChild(gateProgress);
    gateForm.appendChild(gateError);

    gatePanel.appendChild(gateForm);
    gate.appendChild(gatePanel);

    root.appendChild(chatWindow);

    document.body.appendChild(root);

    const chatToggle = document.createElement("button");
    chatToggle.type = "button";
    chatToggle.className = "sa-header-btn";
    chatToggle.setAttribute("aria-expanded", "false");
    chatToggle.setAttribute("aria-controls", "siteAssistantWindow");
    chatToggle.setAttribute("aria-label", "Open assistant chat");
    chatToggle.textContent = "Chat";
    chatToggle.hidden = true;
    const wordmark = document.querySelector(".site-wordmark");
    if (wordmark) wordmark.appendChild(chatToggle);

    const workCloud = document.getElementById("workCloud");
    if (workCloud) {
      workCloud.style.position = "relative";
      workCloud.appendChild(gate);
    } else {
      root.appendChild(gate);
    }

    els.root = root;
    els.chatToggle = chatToggle;
    els.chatWindow = chatWindow;
    els.chatClose = close;
    els.messageList = messageList;
    els.chatForm = composer;
    els.chatInput = input;
    els.chatSend = send;
    els.status = status;
    els.gate = gate;
    els.gateForm = gateForm;
    els.gateEmail = gateEmail;
    els.gateSubmit = gateSubmit;
    els.gateProgress = gateProgress;
    els.gateError = gateError;
  }

  function bindUi() {
    els.chatToggle.addEventListener("click", () => {
      const next = !state.chatOpen;
      emitChatCommand("toggle");
      setChatOpen(next);
    });

    els.chatClose.addEventListener("click", () => setChatOpen(false));

    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = els.chatInput.value;
      els.chatInput.value = "";
      sendChatMessage(value);
    });

    els.gateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = String(els.gateEmail.value || "").trim();
      if (!isValidEmail(email)) {
        state.pendingGateError = "Enter a valid email address.";
        updateUiForGateState();
        emitGateState("error", { email, error: state.pendingGateError });
        return;
      }
      state.pendingGateError = "";
      submitEmailGate(email);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.chatOpen) {
        setChatOpen(false);
      }
    });

    document.addEventListener("click", (event) => {
      if (state.unlocked) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const blocked = target.closest("[data-gated-control]");
      if (!blocked) return;
      if (els.root && els.root.contains(blocked)) return;
      event.preventDefault();
      event.stopPropagation();
      requestAnimationFrame(() => els.gateEmail.focus());
    }, true);
  }

  function init() {
    buildUi();
    renderMessages();
    bindUi();
    collectGatedControls();

    if (state.unlocked) {
      emitGateState("unlocked");
    } else {
      emitGateState("locked");
    }

    updateUiForGateState();
    bindNavigationObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
