const STORAGE_KEY = "ollama.chat.state.v1";
const DEFAULT_SERVER_FALLBACK = "http://localhost:11434";
let backendDefaultServer = DEFAULT_SERVER_FALLBACK;
const APP_BASE_PATH = detectInitialBasePath();
const FALLBACK_LOCATION_BASE = inferFallbackBaseFromLocation();
let activeBasePath = APP_BASE_PATH || FALLBACK_LOCATION_BASE;

const defaultParams = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  mirostat: 0,
  seed: "",
  show_thinking: true,
};

const dom = {};
const state = {
  serverUrl: DEFAULT_SERVER_FALLBACK,
  defaultModel: "",
  activeChatId: null,
  chats: [],
  requestPending: false,
  editingMessageId: null,
  editingOriginalContent: "",
  editingDraft: "",
  pendingAttachments: [],
};

let currentAbortController = null;

async function init() {
  cacheDom();
  backendDefaultServer = await fetchDefaultServer();
  restoreState();
  state.serverUrl = sanitizeServerUrl(state.serverUrl || getDefaultServer());
  dom.serverUrlInput.value = state.serverUrl;
  setRequestPending(false);
  bindEvents();
  ensureChatExists();
  renderAll();
  renderPendingAttachments();
  refreshModels({ notifyOnSuccess: false });
}

function cacheDom() {
  dom.serverUrlInput = document.getElementById("server-url");
  dom.defaultModelSelect = document.getElementById("default-model");
  dom.refreshModelsBtn = document.getElementById("refresh-models-btn");
  dom.newChatBtn = document.getElementById("new-chat-btn");
  dom.deleteChatBtn = document.getElementById("delete-chat-btn");
  dom.chatItems = document.getElementById("chat-items");
  dom.chatTitleInput = document.getElementById("chat-title");
  dom.chatModelSelect = document.getElementById("chat-model");
  dom.paramTemperature = document.getElementById("param-temperature");
  dom.paramTopK = document.getElementById("param-topk");
  dom.paramTopP = document.getElementById("param-topp");
  dom.paramRepeatPenalty = document.getElementById("param-repeatpenalty");
  dom.paramMirostat = document.getElementById("param-mirostat");
  dom.paramSeed = document.getElementById("param-seed");
  dom.paramShowThinking = document.getElementById("param-showthinking");
  dom.messageList = document.getElementById("message-list");
  dom.messageForm = document.getElementById("message-form");
  dom.messageInput = document.getElementById("message-input");
  dom.imageInput = document.getElementById("image-input");
  dom.imageActionBtn = document.getElementById("image-action-btn");
  dom.imageSourceMenu = document.getElementById("image-source-menu");
  dom.pendingAttachments = document.getElementById("pending-attachments");
  dom.messageSubmit = dom.messageForm?.querySelector('button[type="submit"]');
  dom.cancelRequestBtn = document.getElementById("cancel-request-btn");
  dom.statusBanner = document.getElementById("status-banner");
}

function restoreState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        Object.assign(state, parsed);
      }
    }
  } catch (err) {
    console.warn("Konnte gespeicherten Zustand nicht laden:", err);
  }

  state.requestPending = false;
  currentAbortController = null;
  state.serverUrl = sanitizeServerUrl(state.serverUrl || getDefaultServer());
  state.editingMessageId = null;
  state.editingOriginalContent = "";
  state.editingDraft = "";
  state.pendingAttachments = [];
}

function persistState() {
  try {
    const {
      requestPending,
      editingMessageId,
      editingOriginalContent,
      editingDraft,
      pendingAttachments,
      ...persistable
    } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch (err) {
    console.warn("Konnte Zustand nicht speichern:", err);
  }
}

function bindEvents() {
  dom.serverUrlInput.addEventListener("change", () => {
    state.serverUrl = sanitizeServerUrl(dom.serverUrlInput.value);
    persistState();
    refreshModels({ notifyOnSuccess: true });
  });

  dom.refreshModelsBtn.addEventListener("click", () => {
    refreshModels({ notifyOnSuccess: true });
  });

  dom.defaultModelSelect.addEventListener("change", () => {
    state.defaultModel = dom.defaultModelSelect.value;
    persistState();
    updateChatModelFallbacks();
    renderChatMeta();
  });

  dom.newChatBtn.addEventListener("click", () => {
    if (state.requestPending) {
      showStatus("Bitte warte, bis die aktuelle Antwort beendet ist.", "error", 2500);
      return;
    }
    createNewChat();
  });

  dom.deleteChatBtn.addEventListener("click", handleDeleteActiveChat);

  dom.chatTitleInput.addEventListener("input", () => {
    const chat = getActiveChat();
    if (!chat) return;
    chat.title = dom.chatTitleInput.value.trim() || "Unbenannter Chat";
    chat.updatedAt = new Date().toISOString();
    persistState();
    renderChatList();
  });

  dom.chatModelSelect.addEventListener("change", () => {
    const chat = getActiveChat();
    if (!chat) return;
    chat.model = dom.chatModelSelect.value;
    chat.updatedAt = new Date().toISOString();
    persistState();
    renderChatList();
  });

  dom.paramTemperature.addEventListener("change", () =>
    updateChatParam("temperature", parseFloatOrFallback(dom.paramTemperature.value))
  );
  dom.paramTopK.addEventListener("change", () =>
    updateChatParam("top_k", parseIntOrFallback(dom.paramTopK.value))
  );
  dom.paramTopP.addEventListener("change", () =>
    updateChatParam("top_p", parseFloatOrFallback(dom.paramTopP.value))
  );
  dom.paramRepeatPenalty.addEventListener("change", () =>
    updateChatParam("repeat_penalty", parseFloatOrFallback(dom.paramRepeatPenalty.value))
  );
  dom.paramMirostat.addEventListener("change", () =>
    updateChatParam("mirostat", parseIntOrFallback(dom.paramMirostat.value))
  );
  dom.paramSeed.addEventListener("change", () =>
    updateChatParam("seed", dom.paramSeed.value === "" ? "" : parseIntOrFallback(dom.paramSeed.value))
  );
  dom.paramShowThinking.addEventListener("change", () =>
    updateChatParam("show_thinking", dom.paramShowThinking.checked)
  );

  dom.imageActionBtn?.addEventListener("click", toggleImageSourceMenu);
  dom.imageSourceMenu?.addEventListener("click", handleImageSourceMenuClick);
  dom.imageInput?.addEventListener("change", handleImageFileSelection);
  dom.pendingAttachments?.addEventListener("click", handlePendingAttachmentClick);
  document.addEventListener("click", handleDocumentClickForImageMenu);

  dom.chatItems.addEventListener("click", (event) => {
    const li = event.target.closest("li[data-chat-id]");
    if (!li) return;
    if (state.requestPending) {
      showStatus("Bitte warte, bis die aktuelle Antwort beendet ist.", "error", 2500);
      return;
    }
    const chatId = li.dataset.chatId;
    if (chatId === state.activeChatId) return;
    state.activeChatId = chatId;
    persistState();
    renderAll();
  });

  dom.messageForm.addEventListener("submit", handleMessageSubmit);
  dom.cancelRequestBtn?.addEventListener("click", handleCancelRequest);
  dom.messageList.addEventListener("click", handleMessageListClick);
}

function ensureChatExists() {
  if (!Array.isArray(state.chats)) {
    state.chats = [];
  }
  if (!state.chats.length) {
    const chat = buildChat();
    state.chats.push(chat);
    state.activeChatId = chat.id;
    persistState();
  }
  if (!state.activeChatId) {
    state.activeChatId = state.chats[0]?.id ?? null;
  }
}

function renderAll() {
  renderChatList();
  renderChatMeta();
  renderMessages();
}

function renderChatList() {
  dom.chatItems.innerHTML = "";
  state.chats
    .slice()
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt) - new Date(a.updatedAt ?? a.createdAt))
    .forEach((chat) => {
      const li = document.createElement("li");
      li.dataset.chatId = chat.id;
      li.classList.toggle("active", chat.id === state.activeChatId);

      const titleEl = document.createElement("span");
      titleEl.className = "chat-title";
      titleEl.textContent = chat.title || "Unbenannter Chat";

      const metaEl = document.createElement("span");
      metaEl.className = "chat-meta-line";
      metaEl.textContent = `${chat.model || state.defaultModel || "kein Modell"} • ${
        chat.messages.length
      } Msgs`;

      li.append(titleEl, metaEl);
      dom.chatItems.appendChild(li);
    });
}

function renderChatMeta() {
  const chat = getActiveChat();
  const models = dom.defaultModelSelect.dataset.models
    ? JSON.parse(dom.defaultModelSelect.dataset.models)
    : [];

  if (chat) {
    dom.chatTitleInput.value = chat.title;
    populateModelSelect(dom.chatModelSelect, models, chat.model || state.defaultModel);
    dom.paramTemperature.value =
      chat.params?.temperature ?? defaultParams.temperature;
    dom.paramTopK.value = chat.params?.top_k ?? defaultParams.top_k;
    dom.paramTopP.value = chat.params?.top_p ?? defaultParams.top_p;
    dom.paramRepeatPenalty.value =
      chat.params?.repeat_penalty ?? defaultParams.repeat_penalty;
    dom.paramMirostat.value = chat.params?.mirostat ?? defaultParams.mirostat;
    dom.paramSeed.value = chat.params?.seed ?? defaultParams.seed;
    dom.paramShowThinking.checked =
      chat.params?.show_thinking ?? defaultParams.show_thinking;
  } else {
    dom.chatTitleInput.value = "";
    dom.chatModelSelect.innerHTML = "";
    dom.paramTemperature.value = "";
    dom.paramTopK.value = "";
    dom.paramTopP.value = "";
    dom.paramRepeatPenalty.value = "";
    dom.paramMirostat.value = "";
    dom.paramSeed.value = "";
    dom.paramShowThinking.checked = true;
    dom.messageInput.disabled = true;
  }

  populateModelSelect(dom.defaultModelSelect, models, state.defaultModel, true);

  const inputDisabled = state.requestPending || !chat;
  if (dom.messageInput) {
    dom.messageInput.disabled = inputDisabled;
  }
  if (dom.messageSubmit) {
    dom.messageSubmit.disabled = inputDisabled;
  }
  if (dom.imageInput) {
    dom.imageInput.disabled = inputDisabled;
  }
  if (dom.newChatBtn) {
    dom.newChatBtn.disabled = state.requestPending;
  }
  if (dom.deleteChatBtn) {
    dom.deleteChatBtn.disabled = state.requestPending;
  }
}

function renderMessages() {
  dom.messageList.innerHTML = "";
  const chat = getActiveChat();
  if (!chat) return;

  const template = document.getElementById("message-template");
  chat.messages.forEach((message) => {
    if (message.purpose === "thinking" && message.showThinking === false) {
      return;
    }
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".message");
    article.dataset.messageId = message.id;
    article.classList.add(message.role);
    const isThinkingMessage = message.purpose === "thinking";
    const showThinkingBubble = isThinkingMessage && message.showThinking !== false;
    if (message.pending || showThinkingBubble) {
      article.classList.add("thinking");
    }
    if (message.error) {
      article.classList.add("error");
    }

    const roleLabel =
      message.role === "user"
        ? "Du"
        : showThinkingBubble
        ? "Assistent • Thinking"
        : "Assistent";
    node.querySelector(".role").textContent = roleLabel;
    node.querySelector(".timestamp").textContent = formatTime(message.createdAt);
    const contentEl = node.querySelector(".content");
    const isEditing = state.editingMessageId === message.id;
    if (isEditing) {
      contentEl.hidden = true;
    } else if (isThinkingMessage && message.showThinking === false) {
      contentEl.hidden = false;
      contentEl.textContent = message.content || message.thinking || "";
    } else {
      contentEl.hidden = false;
      contentEl.textContent = message.content ?? "";
    }

    const deleteBtn = node.querySelector(".message-delete");
    if (deleteBtn) {
      deleteBtn.dataset.messageId = message.id;
      deleteBtn.disabled = state.requestPending;
      deleteBtn.hidden = false;
    }

    const editBtn = node.querySelector(".message-edit");
    if (editBtn) {
      if (message.role === "user" && message.id === getLastUserMessageId(chat)) {
        editBtn.dataset.messageId = message.id;
        editBtn.disabled = state.requestPending;
        editBtn.hidden = false;
      } else {
        editBtn.hidden = true;
      }
    }

    const statsEl = node.querySelector(".stats");
    if (statsEl) {
      if (message.stats && message.role === "assistant") {
        statsEl.hidden = false;
        statsEl.innerHTML = renderStats(message.stats);
      } else {
        statsEl.hidden = true;
      }
    }

    // Inline editing UI
    if (isEditing) {
      const editContainer = document.createElement("div");
      editContainer.className = "edit-container";
      const textarea = document.createElement("textarea");
      textarea.value = state.editingDraft ?? message.content ?? "";
      textarea.rows = 4;
      textarea.addEventListener("input", () => {
        state.editingDraft = textarea.value;
      });

      const actions = document.createElement("div");
      actions.className = "edit-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary-btn";
      cancelBtn.textContent = "Abbrechen";
      cancelBtn.addEventListener("click", cancelEditMessage);

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "primary-btn";
      saveBtn.textContent = "Aktualisieren & senden";
      saveBtn.addEventListener("click", () => {
        submitEditedMessage();
      });

      if (state.requestPending) {
        cancelBtn.disabled = true;
        saveBtn.disabled = true;
      }

      actions.append(cancelBtn, saveBtn);
      editContainer.append(textarea, actions);
      article.insertBefore(editContainer, node.querySelector(".thinking"));
    }

    const thinkingEl = node.querySelector(".thinking");
    const thinkingText = typeof message.thinking === "string" ? message.thinking.trim() : "";
    if (thinkingEl) {
      thinkingEl.innerHTML = "";
      if (showThinkingBubble && (thinkingText || message.pending)) {
        thinkingEl.hidden = false;

        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "thinking-toggle";
        toggleBtn.textContent = message.collapsed ? "▼" : "▲";

        const contentSpan = document.createElement("span");
        contentSpan.className = "thinking-content";
        contentSpan.textContent = thinkingText
          ? thinkingText
          : message.content && message.content.length
          ? "Antwort wird generiert …"
          : "Denkt nach …";

        if (message.collapsed) {
          thinkingEl.classList.add("collapsed");
        } else {
          thinkingEl.classList.remove("collapsed");
        }

        toggleBtn.addEventListener("click", () => {
          message.collapsed = !message.collapsed;
          persistState();
          renderMessages();
        });

        thinkingEl.appendChild(toggleBtn);
        thinkingEl.appendChild(contentSpan);
      } else {
        thinkingEl.hidden = true;
      }
    }

    let attachmentsEl = node.querySelector(".attachments");
    if (!attachmentsEl) {
      attachmentsEl = document.createElement("div");
      attachmentsEl.className = "attachments";
      article.appendChild(attachmentsEl);
    }
    attachmentsEl.innerHTML = "";
    if (Array.isArray(message.attachments) && message.attachments.length) {
      message.attachments.forEach((attachment) => {
        if (attachment.dataUrl?.startsWith("data:image")) {
          const img = document.createElement("img");
          img.src = attachment.dataUrl;
          img.alt = "Angehängtes Bild";
          attachmentsEl.appendChild(img);
        }
      });
    }

    dom.messageList.appendChild(node);
  });

  scrollMessageListToBottom({ smooth: true });
}

function createNewChat() {
  const chat = buildChat();
  state.chats.push(chat);
  state.activeChatId = chat.id;
  persistState();
  renderAll();
  showStatus("Neuer Chat erstellt", "success", 2500);
}

function handleDeleteActiveChat() {
  const chat = getActiveChat();
  if (!chat) return;
  const confirmDelete = window.confirm(
    `Chat "${chat.title}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`
  );
  if (!confirmDelete) return;

  state.chats = state.chats.filter((c) => c.id !== chat.id);
  if (!state.chats.length) {
    ensureChatExists();
  } else if (!state.chats.find((c) => c.id === state.activeChatId)) {
    state.activeChatId = state.chats[0].id;
  }
  persistState();
  renderAll();
  showStatus("Chat gelöscht", "success", 2000);
}

function buildChat() {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: "Neuer Chat",
    createdAt: now,
    updatedAt: now,
    model: state.defaultModel || "",
    params: { ...defaultParams },
    messages: [],
  };
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || null;
}

function updateChatParam(key, value) {
  const chat = getActiveChat();
  if (!chat) return;
  chat.params = chat.params || { ...defaultParams };
  chat.params[key] = value === null ? "" : value;
  chat.updatedAt = new Date().toISOString();
  persistState();
}

function parseFloatOrFallback(value) {
  if (value === "" || value === null || Number.isNaN(Number(value))) {
    return "";
  }
  return parseFloat(value);
}

function parseIntOrFallback(value) {
  if (value === "" || value === null || Number.isNaN(Number(value))) {
    return "";
  }
  return parseInt(value, 10);
}

function sanitizeUrl(value, fallback = DEFAULT_SERVER_FALLBACK) {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\/+$/, "") || fallback;
}

function getDefaultServer() {
  return sanitizeUrl(backendDefaultServer, DEFAULT_SERVER_FALLBACK);
}

function sanitizeServerUrl(value) {
  return sanitizeUrl(value, getDefaultServer());
}

function getActiveServerUrl() {
  return sanitizeServerUrl(state.serverUrl || getDefaultServer());
}

function buildOllamaPath(path) {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function ollamaFetch(path, options = {}) {
  const finalPath = buildOllamaPath(path);
  const target = getActiveServerUrl();
  const headers = new Headers(options.headers || {});
  headers.set("X-Ollama-Server", target);

  const merged = {
    ...options,
    headers,
  };

  return fetch(withBasePath(`/ollama${finalPath}`), merged);
}

async function fetchDefaultServer() {
  const triedBases = new Set();
  const tryOrder = [];
  if (activeBasePath && !triedBases.has(activeBasePath)) {
    tryOrder.push(activeBasePath);
    triedBases.add(activeBasePath);
  }
  if (FALLBACK_LOCATION_BASE && !triedBases.has(FALLBACK_LOCATION_BASE)) {
    tryOrder.push(FALLBACK_LOCATION_BASE);
    triedBases.add(FALLBACK_LOCATION_BASE);
  }
  if (!triedBases.has("")) {
    tryOrder.push("");
    triedBases.add("");
  }

  for (const base of tryOrder) {
    if (base !== activeBasePath) {
      activeBasePath = base;
    }
    try {
      const response = await fetch(withBasePath("/api/default-server"));
      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`);
      }
      const data = await response.json();
      updateActiveBasePath(data?.basePath ?? base);
      return sanitizeUrl(data?.defaultServer, DEFAULT_SERVER_FALLBACK);
    } catch (error) {
      if (tryOrder[tryOrder.length - 1] === base) {
        console.warn("Konnte DEFAULT_SERVER nicht vom Backend laden:", error);
      } else {
        console.warn(`Konnte DEFAULT_SERVER mit Basis "${base || "/"}" nicht laden:`, error);
      }
    }
  }

  return DEFAULT_SERVER_FALLBACK;
}

function populateModelSelect(select, models, currentValue, allowEmpty = false) {
  const wasFocused = document.activeElement === select;
  select.innerHTML = "";

  const uniqueModels = Array.from(new Set(models));
  if (allowEmpty) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Modell wählen";
    select.appendChild(placeholder);
  }

  uniqueModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });

  if (currentValue && !uniqueModels.includes(currentValue)) {
    const customOption = document.createElement("option");
    customOption.value = currentValue;
    customOption.textContent = `${currentValue} (nicht geladen)`;
    select.appendChild(customOption);
  }

  select.value = currentValue ?? "";
  if (!select.value && allowEmpty && select.options.length) {
    select.selectedIndex = 0;
  }

  if (!allowEmpty && !select.value && select.options.length) {
    select.selectedIndex = 0;
  }

  if (!select.options.length) {
    const placeholder = document.createElement("option");
    placeholder.value = currentValue ?? "";
    placeholder.textContent = allowEmpty
      ? "Keine Modelle gefunden"
      : currentValue
      ? `${currentValue}`
      : "Keine Modelle geladen";
    select.appendChild(placeholder);
    select.value = placeholder.value;
  }

  if (wasFocused) {
    select.focus();
  }

  select.dataset.models = JSON.stringify(uniqueModels);
}

async function refreshModels({ notifyOnSuccess }) {
  try {
    const response = await ollamaFetch("/api/tags");
    if (!response.ok) {
      throw new Error(`Server antwortete mit Status ${response.status}`);
    }
    const payload = await response.json();
    const models = payload?.models?.map((item) => item?.model).filter(Boolean) ?? [];
    populateModelSelect(dom.defaultModelSelect, models, state.defaultModel, true);
    const chat = getActiveChat();
    populateModelSelect(dom.chatModelSelect, models, chat?.model || state.defaultModel);

    if (!state.defaultModel && models.length) {
      state.defaultModel = models[0];
      persistState();
      dom.defaultModelSelect.value = state.defaultModel;
    }
    if (chat && !chat.model) {
      chat.model = dom.chatModelSelect.value;
      persistState();
    }

    if (notifyOnSuccess) {
      showStatus(`Modelle aktualisiert (${models.length})`, "success", 2500);
    }
  } catch (error) {
    showStatus(`Modelle konnten nicht geladen werden: ${error.message}`, "error");
    console.error(error);
  }
}

function updateChatModelFallbacks() {
  state.chats.forEach((chat) => {
    if (!chat.model) {
      chat.model = state.defaultModel;
    }
  });
  persistState();
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  if (state.requestPending) {
    showStatus("Bitte warte, bis die aktuelle Antwort beendet ist.", "error", 2500);
    return;
  }
  if (state.editingMessageId) {
    showStatus("Bitte schließe zuerst die Bearbeitung der letzten Nachricht ab.", "error", 2500);
    return;
  }
  const chat = getActiveChat();
  if (!chat) {
    showStatus("Kein aktiver Chat verfügbar", "error", 3000);
    return;
  }

  const content = dom.messageInput.value.trim();
  if (!content) return;

  const model = chat.model || state.defaultModel;
  if (!model) {
    showStatus("Bitte zuerst ein Modell auswählen.", "error", 3000);
    return;
  }

  const attachments =
    Array.isArray(state.pendingAttachments) && state.pendingAttachments.length
      ? state.pendingAttachments.map((attachment) => ({ ...attachment }))
      : [];
  state.pendingAttachments = [];
  renderPendingAttachments();
  if (dom.imageInput) {
    dom.imageInput.value = "";
  }

  const now = new Date().toISOString();
  const userMessage = {
    id: createId(),
    role: "user",
    content,
    createdAt: now,
    attachments,
  };

  const thinkingMessage = {
    id: createId(),
    role: "assistant",
    content: "",
    createdAt: now,
    attachments: [],
    pending: true,
    thinking: "",
    purpose: "thinking",
    showThinking: Boolean(chat.params?.show_thinking ?? true),
    collapsed: false,
  };

  const responsePreview = {
    id: createId(),
    role: "assistant",
    content: "",
    createdAt: now,
    attachments: [],
    pending: true,
    purpose: "response_preview",
    stats: null,
    relatedThinkingId: thinkingMessage.id,
  };

  chat.messages.push(userMessage, thinkingMessage, responsePreview);
  chat.updatedAt = now;
  dom.messageInput.value = "";
  state.editingMessageId = null;
  state.editingOriginalContent = "";
  state.editingDraft = "";
  setRequestPending(true);
  currentAbortController = new AbortController();
  persistState();
  renderMessages();
  renderChatList();

  try {
    await streamChatCompletion(chat, thinkingMessage, responsePreview, currentAbortController.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      thinkingMessage.pending = false;
      const existingThinking = (thinkingMessage.thinking || "").trim();
      const abortNote = "Generierung abgebrochen.";
      thinkingMessage.thinking = existingThinking
        ? `${existingThinking}\n${abortNote}`
        : abortNote;
      chat.updatedAt = new Date().toISOString();
      persistState();
      renderMessages();
      showStatus("Generierung abgebrochen.", "success", 2000);
    } else {
      thinkingMessage.pending = false;
      thinkingMessage.error = error.message;
      thinkingMessage.content =
        thinkingMessage.content || `Fehler bei der Antwort: ${error.message}`;
      if (responsePreview) {
        responsePreview.pending = false;
        responsePreview.error = error.message;
        responsePreview.content =
          responsePreview.content || `Fehler bei der Antwort: ${error.message}`;
      }
      chat.updatedAt = new Date().toISOString();
      persistState();
      renderMessages();
      showStatus(error.message, "error");
    }
  } finally {
    if (currentAbortController) {
      currentAbortController = null;
    }
    setRequestPending(false);
    persistState();
    renderMessages();
    renderChatList();
  }
}

async function streamChatCompletion(chat, thinkingMessage, previewMessage, signal) {
  const payload = {
    model: chat.model || state.defaultModel,
    messages: chat.messages
      .filter((message) => message.id !== thinkingMessage.id && message.purpose !== "thinking")
      .map((message) => serializeMessageForRequest(message))
      .filter(Boolean),
    stream: true,
    options: buildOptionsFromParams(chat.params),
  };

  const response = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama antwortet nicht korrekt (Status ${response.status})`);
  }

  const responseState = {
    text: "",
    attachments: [],
    stats: null,
    thinking: thinkingMessage.thinking || "",
    preview: previewMessage,
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  thinkingMessage.pending = true;
  thinkingMessage.thinking = thinkingMessage.thinking || "";
  thinkingMessage.showThinking = Boolean(chat.params?.show_thinking ?? true);
  thinkingMessage.collapsed = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const changed = handleStreamPayload(line, { thinkingMessage, responseState });
      if (changed) {
        persistState();
        renderMessages();
      }
    }
  }

  buffer = buffer.trim();
  if (buffer) {
    const changed = handleStreamPayload(buffer, { thinkingMessage, responseState });
    if (changed) {
      persistState();
      renderMessages();
    }
  }

  finalizeStream(chat, thinkingMessage, responseState);
  currentAbortController = null;
  persistState();
  renderMessages();
  renderChatList();
}

function serializeMessageForRequest(message) {
  if (message.purpose === "thinking") {
    return null;
  }

  const result = {
    role: message.role,
    content: message.content ?? "",
  };

  const imageBases = (message.attachments || [])
    .map((attachment) => attachment.base64 || extractBase64(attachment.dataUrl))
    .filter(Boolean);

  if (imageBases.length) {
    result.images = imageBases;
  }

  return result;
}

function handleStreamPayload(line, context) {
  const { thinkingMessage, responseState } = context;
  const previewMessage = responseState.preview;
  const showThinking = Boolean(thinkingMessage.showThinking);
  let payload;
  try {
    payload = JSON.parse(line);
  } catch (error) {
    console.error("Ungültige Streaming-Zeile:", line, error);
    return false;
  }

  if (payload.error) {
    throw new Error(payload.error);
  }

  let changed = false;
  let updatedThinking = false;
  if (showThinking && typeof payload.thinking === "string" && payload.thinking.length) {
    responseState.thinking = mergeThinkingText(responseState.thinking || "", payload.thinking);
    thinkingMessage.thinking = responseState.thinking.trimStart();
    thinkingMessage.pending = !payload.done;
    updatedThinking = true;
    changed = true;
  }

  if (showThinking && !updatedThinking) {
    const fragments = extractThinkingFragments(payload);
    if (fragments.length) {
      fragments.forEach((fragment) => {
        responseState.thinking = mergeThinkingText(responseState.thinking || "", fragment);
      });
      thinkingMessage.thinking = responseState.thinking.trimStart();
      thinkingMessage.pending = !payload.done;
      changed = true;
    }
  }

  let responseChunk = "";
  if (typeof payload.response === "string" && payload.response.length) {
    responseChunk = payload.response;
  } else if (
    typeof payload.message?.content === "string" &&
    payload.message.content.length &&
    (payload.message.role === "assistant" || !payload.message.role)
  ) {
    responseChunk = payload.message.content;
  }

  if (responseChunk) {
    responseState.text += responseChunk;
    thinkingMessage.content = responseState.text;
    if (previewMessage) {
      previewMessage.content = responseState.text;
      previewMessage.pending = true;
      previewMessage.createdAt = new Date().toISOString();
    }
    changed = true;
  }

  const images = Array.isArray(payload.images)
    ? payload.images
    : Array.isArray(payload.message?.images)
    ? payload.message.images
    : null;

  if (Array.isArray(images) && images.length) {
    responseState.attachments = images.map((base64) => ({
      id: createId(),
      dataUrl: `data:image/png;base64,${base64}`,
      base64,
      mime: "image/png",
    }));
    changed = true;
  }

  if (payload.done) {
    thinkingMessage.pending = false;
    responseState.stats = extractStats(payload);
    if (previewMessage) {
      previewMessage.pending = false;
    }
    changed = true;
  }

  return changed;
}

function finalizeStream(chat, thinkingMessage, responseState) {
  thinkingMessage.pending = false;
  thinkingMessage.createdAt = thinkingMessage.createdAt || new Date().toISOString();

  const previewMessage = responseState.preview;
  const split = splitThinkingFromAnswer(responseState.text || "");
  if (split && split.thinking) {
    thinkingMessage.thinking = split.thinking;
  }

  const finalContent = (split ? split.answer : responseState.text || "").trim();
  if (responseState.stats) {
    responseState.stats.model = chat.model || state.defaultModel;
  }

  if (previewMessage) {
    previewMessage.content = finalContent;
    previewMessage.attachments = responseState.attachments || [];
    previewMessage.stats = responseState.stats || null;
    previewMessage.pending = false;
    previewMessage.purpose = "response";
    previewMessage.createdAt = new Date().toISOString();
  }

  if (thinkingMessage.showThinking === false) {
    removeThinkingMessage(chat, thinkingMessage.id, false);
    chat.updatedAt = new Date().toISOString();
    return;
  }

  thinkingMessage.content = "";
  thinkingMessage.collapsed = true;

  const finalThinking = (thinkingMessage.thinking || "").trim();
  if (!finalThinking) {
    chat.messages = chat.messages.filter((message) => message.id !== thinkingMessage.id);
  }

  if (!previewMessage) {
    const hasAttachments =
      Array.isArray(responseState.attachments) && responseState.attachments.length > 0;
    if (finalContent || hasAttachments || responseState.stats) {
      const assistantMessage = {
        id: createId(),
        role: "assistant",
        content: finalContent,
        createdAt: new Date().toISOString(),
        attachments: hasAttachments ? responseState.attachments : [],
        pending: false,
        purpose: "response",
        stats: responseState.stats || null,
      };
      assistantMessage.relatedThinkingId = thinkingMessage.id;
      chat.messages.push(assistantMessage);
    }
  }

  chat.updatedAt = new Date().toISOString();
}

function splitThinkingFromAnswer(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const THINK_OPEN = "<think>";
  const THINK_CLOSE = "</think>";
  const openIdx = text.indexOf(THINK_OPEN);
  if (openIdx === -1) {
    return null;
  }

  const closeIdx = text.indexOf(THINK_CLOSE, openIdx + THINK_OPEN.length);
  if (closeIdx === -1) {
    const thinking = text.slice(openIdx + THINK_OPEN.length).trim();
    const answer = text.slice(0, openIdx).trim();
    return { thinking, answer };
  }

  const before = text.slice(0, openIdx);
  const thinking = text.slice(openIdx + THINK_OPEN.length, closeIdx).trim();
  const after = text.slice(closeIdx + THINK_CLOSE.length);
  const answer = (before + after).trim();
  return { thinking, answer };
}

function extractStats(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const stats = {};
  const numericKeys = [
    "total_duration",
    "load_duration",
    "prompt_eval_count",
    "prompt_eval_duration",
    "eval_count",
    "eval_duration",
  ];

  numericKeys.forEach((key) => {
    if (typeof payload[key] === "number") {
      stats[key] = payload[key];
    }
  });

  if (typeof payload.done_reason === "string") {
    stats.done_reason = payload.done_reason;
  }

  if (Array.isArray(payload.context)) {
    stats.context = payload.context;
  }

  return Object.keys(stats).length ? stats : null;
}

function renderStats(stats) {
  if (!stats) return "";

  const totalMs = toMilliseconds(stats.total_duration);
  const loadMs = toMilliseconds(stats.load_duration);
  const promptTokens = stats.prompt_eval_count ?? 0;
  const evalTokens = stats.eval_count ?? 0;
  const evalMs = toMilliseconds(stats.eval_duration);

  const totalSeconds = totalMs ? totalMs / 1000 : 0;
  const tokensPerSecond =
    evalTokens && totalSeconds > 0 ? (evalTokens / totalSeconds).toFixed(2) : "-";

  const entries = [
    { label: "Gesamtdauer", value: formatDuration(stats.total_duration) },
    {
      label: "Time to First Token",
      value: loadMs !== null ? formatDuration(stats.load_duration) : "-",
    },
    { label: "Tokens pro Sekunde", value: tokensPerSecond },
    { label: "Tokens (Frage)", value: promptTokens },
    { label: "Tokens (Antwort)", value: evalTokens },
  ];

  return entries
    .map(
      (entry) =>
        `<span><span>${entry.label}</span><span>${entry.value}</span></span>`
    )
    .join("");
}

function formatDuration(nanoseconds) {
  if (typeof nanoseconds !== "number") {
    return String(nanoseconds);
  }

  const seconds = nanoseconds / 1e9;
  if (seconds >= 1) {
    return `${seconds.toFixed(2)} s`;
  }

  const milliseconds = nanoseconds / 1e6;
  if (milliseconds >= 1) {
    return `${milliseconds.toFixed(2)} ms`;
  }

  const microseconds = nanoseconds / 1e3;
  return `${microseconds.toFixed(2)} µs`;
}

function toMilliseconds(value) {
  if (typeof value !== "number") return null;
  return value / 1e6;
}

function buildOptionsFromParams(params = {}) {
  const options = {};
  if (params.temperature !== "" && params.temperature !== undefined) {
    options.temperature = Number(params.temperature);
  }
  if (params.top_k !== "" && params.top_k !== undefined) {
    options.top_k = Number(params.top_k);
  }
  if (params.top_p !== "" && params.top_p !== undefined) {
    options.top_p = Number(params.top_p);
  }
  if (params.repeat_penalty !== "" && params.repeat_penalty !== undefined) {
    options.repeat_penalty = Number(params.repeat_penalty);
  }
  if (params.mirostat !== "" && params.mirostat !== undefined) {
    options.mirostat = Number(params.mirostat);
  }
  if (params.seed !== "" && params.seed !== undefined) {
    options.seed = Number(params.seed);
  }
  if (typeof params.show_thinking === "boolean") {
    options.include_thinking = params.show_thinking;
    options.thinking = params.show_thinking;
  }
  return options;
}

function formatTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    return "";
  }
}

function showStatus(message, type = "info", timeout) {
  if (!dom.statusBanner) return;
  dom.statusBanner.textContent = message;
  dom.statusBanner.classList.remove("error", "success");
  if (type === "error") {
    dom.statusBanner.classList.add("error");
  } else if (type === "success") {
    dom.statusBanner.classList.add("success");
  }
  dom.statusBanner.hidden = false;

  if (timeout) {
    window.clearTimeout(dom.statusBanner._hideTimeout);
    dom.statusBanner._hideTimeout = window.setTimeout(() => {
      dom.statusBanner.hidden = true;
    }, timeout);
  }
}

function extractBase64(dataUrl) {
  if (!dataUrl?.startsWith("data:")) return "";
  const parts = dataUrl.split(",");
  return parts[1] ?? "";
}

function extractThinkingFragments(payload) {
  const fragments = [];
  if (!payload || typeof payload !== "object") {
    return fragments;
  }

  const { message } = payload;

  const candidates = [
    message?.thinking,
    message?.reasoning,
    payload.reasoning,
    payload.delta?.thinking,
    payload.delta?.reasoning,
  ];

  // Bei manchen Modellen wird Thinking als eigener Nachrichtentyp gestreamt
  if (message?.type === "thinking" && typeof message.content === "string") {
    candidates.push(message.content);
  }
  if (payload?.type === "thinking" && typeof payload.content === "string") {
    candidates.push(payload.content);
  }
  if (payload?.delta?.type === "thinking" && typeof payload.delta.content === "string") {
    candidates.push(payload.delta.content);
  }

  candidates.forEach((value) => {
    if (typeof value === "string" && value.trim()) {
      fragments.push(value);
    }
  });

  return fragments;
}

function mergeThinkingText(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;

  if (incoming.startsWith(current)) {
    return incoming;
  }

  if (current.endsWith(incoming)) {
    return current;
  }

  return `${current}${incoming}`;
}

function scrollMessageListToBottom({ smooth } = { smooth: false }) {
  if (!dom.messageList) return;
  const behavior = smooth ? "smooth" : "auto";
  requestAnimationFrame(() => {
    dom.messageList.scroll({
      top: dom.messageList.scrollHeight,
      behavior,
    });
  });
}

function handleCancelRequest() {
  if (!state.requestPending) {
    return;
  }
  if (!currentAbortController) {
    showStatus("Keine laufende Anfrage zum Abbrechen.", "info", 2000);
    return;
  }

  try {
    currentAbortController.abort();
    showStatus("Generierung wird abgebrochen …", "info", 2000);
    const chat = getActiveChat();
    if (chat) {
      removeThinkingMessage(chat);
      persistState();
      renderMessages();
    }
  } catch (error) {
    console.error("Abbruch nicht möglich:", error);
  } finally {
    if (dom.cancelRequestBtn) {
      dom.cancelRequestBtn.disabled = true;
    }
  }
}

function handleMessageListClick(event) {
  const button = event.target.closest('button[data-action="delete-message"]');
  const editButton = event.target.closest('button[data-action="edit-message"]');

  if (button) {
    event.preventDefault();
    event.stopPropagation();

    if (state.requestPending) {
      showStatus("Während einer laufenden Antwort können keine Nachrichten gelöscht werden.", "error", 2500);
      return;
    }

    const messageId = button.dataset.messageId;
    const chat = getActiveChat();
    if (!chat || !messageId) {
      return;
    }

    deleteMessageById(chat, messageId);
    removeThinkingMessage(chat);
    persistState();
    renderMessages();
    renderChatList();
    return;
  }

  if (editButton) {
    event.preventDefault();
    event.stopPropagation();
    handleEditMessage(editButton.dataset.messageId);
  }
}

function removeThinkingMessage(chat, targetId, removePreview = true) {
  if (!chat) return;
  const thinkingId =
    targetId ||
    chat.messages.find((msg) => msg.purpose === "thinking")?.id;
  if (!thinkingId) return;

  const idx = chat.messages.findIndex((msg) => msg.id === thinkingId);
  if (idx !== -1) {
    chat.messages.splice(idx, 1);
  }

  if (removePreview) {
    const previewIdx = chat.messages.findIndex(
      (msg) => msg.relatedThinkingId === thinkingId
    );
    if (previewIdx !== -1) {
      chat.messages.splice(previewIdx, 1);
    }
  }
}

function handleEditMessage(messageId) {
  if (state.requestPending) {
    showStatus("Während einer laufenden Antwort kann nicht bearbeitet werden.", "error", 2500);
    return;
  }

  const chat = getActiveChat();
  if (!chat) return;
  const message = chat.messages.find((msg) => msg.id === messageId && msg.role === "user");
  if (!message) return;

  if (message.id !== getLastUserMessageId(chat)) {
    showStatus("Nur die letzte Nachricht kann bearbeitet werden.", "error", 2500);
    return;
  }

  if (state.editingMessageId && state.editingMessageId !== messageId) {
    showStatus("Bitte schließe zuerst die laufende Bearbeitung ab.", "error", 2500);
    return;
  }

  if (state.editingMessageId === messageId) {
    cancelEditMessage(false);
    return;
  }

  state.editingMessageId = messageId;
  state.editingOriginalContent = message.content ?? "";
  state.editingDraft = message.content ?? "";
  persistState();
  renderMessages();
  showStatus("Nachricht kann bearbeitet und erneut gesendet werden.", "success", 2000);
}

function cancelEditMessage(showNotification = true) {
  if (!state.editingMessageId) return;
  const chat = getActiveChat();
  if (chat && state.editingOriginalContent !== "") {
    const msg = chat.messages.find((m) => m.id === state.editingMessageId);
    if (msg) {
      msg.content = state.editingOriginalContent;
    }
  }
  state.editingMessageId = null;
  state.editingOriginalContent = "";
  state.editingDraft = "";
  persistState();
  renderMessages();
  if (showNotification) {
    showStatus("Bearbeitung abgebrochen.", "info", 2000);
  }
}

async function submitEditedMessage() {
  if (!state.editingMessageId) return;
  if (state.requestPending) {
    showStatus("Bitte warte, bis die aktuelle Antwort beendet ist.", "error", 2500);
    return;
  }

  const chat = getActiveChat();
  if (!chat) return;

  const msgIndex = chat.messages.findIndex((msg) => msg.id === state.editingMessageId);
  if (msgIndex === -1) {
    cancelEditMessage(false);
    return;
  }

  const message = chat.messages[msgIndex];
  const newContent = (state.editingDraft ?? message.content ?? "").trim();
  if (!newContent) {
    showStatus("Nachricht darf nicht leer sein.", "error", 2500);
    return;
  }

  if (newContent === (state.editingOriginalContent ?? "").trim()) {
    cancelEditMessage(false);
    return;
  }

  message.content = newContent;
  message.updatedAt = new Date().toISOString();

  removeResponsesAfter(chat, msgIndex);

  const now = new Date().toISOString();
  const thinkingMessage = {
    id: createId(),
    role: "assistant",
    content: "",
    createdAt: now,
    attachments: [],
    pending: true,
    thinking: "",
    purpose: "thinking",
    showThinking: Boolean(chat.params?.show_thinking ?? true),
    collapsed: false,
  };

  const responsePreview = {
    id: createId(),
    role: "assistant",
    content: "",
    createdAt: now,
    attachments: [],
    pending: true,
    purpose: "response_preview",
    stats: null,
    relatedThinkingId: thinkingMessage.id,
  };

  chat.messages.splice(msgIndex + 1, 0, thinkingMessage, responsePreview);
  chat.updatedAt = now;

  state.editingMessageId = null;
  state.editingOriginalContent = "";
  state.editingDraft = "";

  setRequestPending(true);
  currentAbortController = new AbortController();
  persistState();
  renderMessages();
  renderChatList();

  showStatus("Nachricht aktualisiert, Anfrage wird erneut gesendet …", "success", 2000);

  try {
    await streamChatCompletion(chat, thinkingMessage, responsePreview, currentAbortController.signal);
  } catch (error) {
    thinkingMessage.pending = false;
    thinkingMessage.error = error.message;
    thinkingMessage.content =
      thinkingMessage.content || `Fehler bei der Antwort: ${error.message}`;
    responsePreview.pending = false;
    responsePreview.error = error.message;
    responsePreview.content =
      responsePreview.content || `Fehler bei der Antwort: ${error.message}`;
    chat.updatedAt = new Date().toISOString();
    showStatus(error.message, "error");
  } finally {
    if (currentAbortController) {
      currentAbortController = null;
    }
    setRequestPending(false);
    persistState();
    renderMessages();
    renderChatList();
  }
}

function setRequestPending(isPending) {
  state.requestPending = Boolean(isPending);
  if (dom.newChatBtn) {
    dom.newChatBtn.disabled = state.requestPending;
  }
  if (dom.deleteChatBtn) {
    dom.deleteChatBtn.disabled = state.requestPending;
  }
  if (dom.messageInput) {
    dom.messageInput.disabled = state.requestPending || !getActiveChat();
  }
  if (dom.messageSubmit) {
    dom.messageSubmit.disabled = state.requestPending || !getActiveChat();
  }
  if (dom.imageInput) {
    dom.imageInput.disabled = state.requestPending || !getActiveChat();
  }
  if (dom.cancelRequestBtn) {
    dom.cancelRequestBtn.disabled = !state.requestPending;
    dom.cancelRequestBtn.hidden = !state.requestPending;
  }
}

function deleteMessageById(chat, messageId) {
  if (!chat || !messageId) {
    return;
  }

  const index = chat.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return;
  }

  const [removed] = chat.messages.splice(index, 1);
  chat.updatedAt = new Date().toISOString();
  if (removed && removed.relatedThinkingId) {
    const thinkingIndex = chat.messages.findIndex((msg) => msg.id === removed.relatedThinkingId);
    if (thinkingIndex !== -1) {
      chat.messages.splice(thinkingIndex, 1);
    }
  }

  if (removed.role === "assistant") {
    const previousUser = findPreviousUserMessage(chat.messages, index - 1);
    if (previousUser) {
      const userIndex = chat.messages.findIndex((message) => message.id === previousUser.id);
      const assistantAfterUser = chat.messages.some(
        (message, idx) => idx > userIndex && message.role === "assistant"
      );
      if (!assistantAfterUser && dom.messageInput) {
        dom.messageInput.value = previousUser.content || "";
        dom.messageInput.focus();
        showStatus("Letzte Frage kann erneut gesendet werden.", "info", 2500);
        return;
      }
    }
  }

  showStatus("Nachricht gelöscht.", "success", 2000);
}

function findPreviousUserMessage(messages, startIndex) {
  if (!Array.isArray(messages) || !messages.length) {
    return null;
  }

  for (let i = Math.min(startIndex, messages.length - 1); i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages[i];
    }
  }

  return null;
}

function getLastUserMessageId(chat) {
  if (!chat) return null;
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    if (chat.messages[i]?.role === "user") {
      return chat.messages[i].id;
    }
  }
  return null;
}

function removeResponsesAfter(chat, userIndex) {
  if (!chat) return;
  for (let i = chat.messages.length - 1; i > userIndex; i -= 1) {
    const msg = chat.messages[i];
    if (msg.role === "assistant" || msg.purpose === "thinking" || msg.purpose === "response_preview") {
      chat.messages.splice(i, 1);
    }
  }
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function toggleImageSourceMenu(event) {
  if (!dom.imageSourceMenu) return;
  event.preventDefault();
  event.stopPropagation();
  if (dom.imageSourceMenu.hidden) {
    openImageSourceMenu();
  } else {
    closeImageSourceMenu();
  }
}

function openImageSourceMenu() {
  if (!dom.imageSourceMenu) return;
  dom.imageSourceMenu.hidden = false;
  dom.imageActionBtn?.setAttribute("aria-expanded", "true");
}

function closeImageSourceMenu() {
  if (!dom.imageSourceMenu) return;
  dom.imageSourceMenu.hidden = true;
  dom.imageActionBtn?.setAttribute("aria-expanded", "false");
}

function handleDocumentClickForImageMenu(event) {
  if (!dom.imageSourceMenu || dom.imageSourceMenu.hidden) return;
  if (
    dom.imageSourceMenu.contains(event.target) ||
    dom.imageActionBtn === event.target ||
    dom.imageActionBtn?.contains(event.target)
  ) {
    return;
  }
  closeImageSourceMenu();
}

async function handleImageSourceMenuClick(event) {
  const button = event.target.closest("button[data-source-action]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const action = button.dataset.sourceAction;
  closeImageSourceMenu();

  try {
    if (action === "upload") {
      dom.imageInput?.click();
      return;
    }

    if (action === "screenshot") {
      const attachment = await captureScreenshotAttachment();
      addPendingAttachment(attachment);
      showStatus("Screenshot hinzugefügt.", "success", 2500);
      return;
    }

    if (action === "camera") {
      const attachment = await captureCameraAttachment();
      addPendingAttachment(attachment);
      showStatus("Foto hinzugefügt.", "success", 2500);
      return;
    }

    showStatus("Aktion wird nicht unterstützt.", "error", 2500);
  } catch (error) {
    console.error("Fehler beim Erfassen eines Bildes:", error);
    showStatus(error.message || "Bild konnte nicht aufgenommen werden.", "error", 4000);
  }
}

async function handleImageFileSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  const added = [];
  for (const file of files) {
    try {
      const attachment = await readFileAsAttachment(file);
      addPendingAttachment(attachment);
      added.push(file);
    } catch (error) {
      console.error("Konnte Datei nicht laden:", error);
      showStatus(`Bild konnte nicht gelesen werden: ${error.message}`, "error", 3000);
    }
  }

  if (added.length) {
    showStatus(
      added.length === 1 ? "Bild hinzugefügt." : `${added.length} Bilder hinzugefügt.`,
      "success",
      2500
    );
  }

  event.target.value = "";
}

function handlePendingAttachmentClick(event) {
  const removeBtn = event.target.closest("button.pending-attachment-remove");
  if (!removeBtn) return;
  const { attachmentId } = removeBtn.dataset;
  removePendingAttachment(attachmentId);
}

function addPendingAttachment(attachment) {
  if (!attachment) return;
  if (!Array.isArray(state.pendingAttachments)) {
    state.pendingAttachments = [];
  }
  state.pendingAttachments.push(attachment);
  renderPendingAttachments();
}

function removePendingAttachment(attachmentId) {
  if (!attachmentId || !Array.isArray(state.pendingAttachments)) return;
  const next = state.pendingAttachments.filter((item) => item.id !== attachmentId);
  state.pendingAttachments = next;
  renderPendingAttachments();
}

function renderPendingAttachments() {
  if (!dom.pendingAttachments) return;
  const attachments = Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [];
  dom.pendingAttachments.innerHTML = "";
  if (!attachments.length) {
    dom.pendingAttachments.hidden = true;
    return;
  }
  dom.pendingAttachments.hidden = false;

  attachments.forEach((attachment) => {
    const wrapper = document.createElement("div");
    wrapper.className = "pending-attachment";

    const img = document.createElement("img");
    img.src = attachment.dataUrl;
    img.alt = attachment.name || "Angehängtes Bild";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pending-attachment-remove";
    removeBtn.dataset.attachmentId = attachment.id;
    removeBtn.textContent = "✕";

    wrapper.append(img, removeBtn);
    dom.pendingAttachments.appendChild(wrapper);
  });
}

async function captureScreenshotAttachment() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    throw new Error("Screenshot-Aufnahme wird von diesem Browser nicht unterstützt.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
  });
  return await captureImageFromStream(stream, {
    name: `screenshot-${new Date().toISOString()}.png`,
  });
}

async function captureCameraAttachment() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Kamera wird von diesem Browser nicht unterstützt.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  return await captureImageFromStream(stream, {
    name: `foto-${new Date().toISOString()}.png`,
  });
}

async function captureImageFromStream(stream, { name }) {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
      };
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error || new Error("Videostream konnte nicht geladen werden."));
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    await video.play();

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (!width || !height) {
      throw new Error("Videostream enthält keine gültigen Bilddaten.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Screenshot konnte nicht erstellt werden.");
    }
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/png");
    return {
      id: createId(),
      name,
      mime: "image/png",
      dataUrl,
      base64: extractBase64(dataUrl),
    };
  } finally {
    video.pause();
    video.srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
  }
}

function detectInitialBasePath() {
  try {
    const scriptElementBase = extractBaseFromScriptElements();
    if (scriptElementBase) {
      return scriptElementBase;
    }

    const scriptPath = safeGetPathname(() => new URL(import.meta.url).pathname);
    const scriptBase = extractBaseFromPath(scriptPath);
    if (scriptBase) {
      return scriptBase;
    }

    const locationPath =
      typeof window !== "undefined" && window.location ? window.location.pathname : "";
    const locationBase = extractBaseFromPath(locationPath);
    if (locationBase) {
      return locationBase;
    }

    return "";
  } catch (error) {
    console.warn("Konnte Basis-Pfad nicht bestimmen:", error);
    return "";
  }
}

function inferFallbackBaseFromLocation() {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  const pathname = window.location.pathname || "";
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }
  const first = segments[0];
  if (!first) {
    return "";
  }
  return normalizeBasePathValue(`/${first}`);
}

function safeGetPathname(getter) {
  try {
    return getter() || "";
  } catch (error) {
    return "";
  }
}

function extractBaseFromScriptElements() {
  if (
    typeof document === "undefined" ||
    !document.getElementsByTagName ||
    typeof window === "undefined" ||
    !window.location
  ) {
    return "";
  }
  const scripts = document.getElementsByTagName("script");
  for (const script of scripts) {
    if (!script?.src) continue;
    if (!/app\.js($|\?)/.test(script.src)) {
      continue;
    }
    const pathname = safeGetPathname(() => new URL(script.src, window.location.href).pathname);
    const base = extractBaseFromPath(pathname);
    if (base) {
      return base;
    }
  }
  return "";
}

function extractBaseFromPath(pathname) {
  if (typeof pathname !== "string" || !pathname.length) {
    return "";
  }
  let normalized = pathname.trim();
  if (!normalized) {
    return "";
  }

  const queryIndex = normalized.indexOf("?");
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex);
  }
  const hashIndex = normalized.indexOf("#");
  if (hashIndex >= 0) {
    normalized = normalized.slice(0, hashIndex);
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/\/+/g, "/");

  const collapse = normalized.replace(/\/+$/, "");
  const lastSegment = collapse.split("/").pop();
  if (lastSegment && lastSegment.includes(".")) {
    normalized = collapse.slice(0, collapse.lastIndexOf("/"));
  } else {
    normalized = collapse;
  }

  if (!normalized || normalized === "") {
    return "";
  }

  if (normalized === "/") {
    return "";
  }

  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }

  const baseSegments = segments.slice(0, 1);
  if (!baseSegments.length) {
    return "";
  }
  return `/${baseSegments.join("/")}`;
}

function normalizeBasePathValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  let normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/\/+$/, "");
  normalized = normalized.replace(/\/\/+/g, "/");
  if (normalized === "/" || normalized === "") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }
  return `/${segments.join("/")}`;
}

function updateActiveBasePath(value) {
  const normalized = normalizeBasePathValue(value);
  if (normalized === null || normalized === undefined) {
    return;
  }
  if (!normalized) {
    if (!activeBasePath && FALLBACK_LOCATION_BASE) {
      activeBasePath = FALLBACK_LOCATION_BASE;
    } else if (!activeBasePath) {
      activeBasePath = "";
    }
    return;
  }
  activeBasePath = normalized;
}

function withBasePath(targetPath) {
  if (!targetPath) {
    return activeBasePath || "";
  }
  const ensuredPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  if (!activeBasePath) {
    return ensuredPath;
  }
  return `${activeBasePath}${ensuredPath}`;
}

function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = extractBase64(dataUrl);
      resolve({
        id: createId(),
        name: file.name,
        mime: file.type,
        dataUrl,
        base64,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Unbekannter Fehler beim Lesen"));
    reader.readAsDataURL(file);
  });
}

document.addEventListener("DOMContentLoaded", init);
