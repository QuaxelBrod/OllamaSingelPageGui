const STORAGE_KEY = "ollama.chat.state.v1";
const DEFAULT_SERVER = "http://localhost:11434";

const defaultParams = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  mirostat: 0,
  seed: "",
};

const dom = {};
const state = {
  serverUrl: DEFAULT_SERVER,
  defaultModel: "",
  activeChatId: null,
  chats: [],
  requestPending: false,
};

function init() {
  cacheDom();
  restoreState();
  setRequestPending(false);
  bindEvents();
  ensureChatExists();
  renderAll();
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
  dom.messageList = document.getElementById("message-list");
  dom.messageForm = document.getElementById("message-form");
  dom.messageInput = document.getElementById("message-input");
  dom.imageInput = document.getElementById("image-input");
  dom.messageSubmit = dom.messageForm?.querySelector('button[type="submit"]');
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
  dom.serverUrlInput.value = state.serverUrl || DEFAULT_SERVER;
}

function persistState() {
  try {
    const { requestPending, ...persistableState } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState));
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

  dom.chatItems.addEventListener("click", (event) => {
    const li = event.target.closest("li[data-chat-id]");
    if (!li) return;
    const chatId = li.dataset.chatId;
    if (chatId === state.activeChatId) return;
    state.activeChatId = chatId;
    persistState();
    renderAll();
  });

  dom.messageForm.addEventListener("submit", handleMessageSubmit);
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
  } else {
    dom.chatTitleInput.value = "";
    dom.chatModelSelect.innerHTML = "";
    dom.paramTemperature.value = "";
    dom.paramTopK.value = "";
    dom.paramTopP.value = "";
    dom.paramRepeatPenalty.value = "";
    dom.paramMirostat.value = "";
    dom.paramSeed.value = "";
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
}

function renderMessages() {
  dom.messageList.innerHTML = "";
  const chat = getActiveChat();
  if (!chat) return;

  const template = document.getElementById("message-template");
  chat.messages.forEach((message) => {
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".message");
    article.dataset.messageId = message.id;
    article.classList.add(message.role);

    const isThinkingMessage = message.purpose === "thinking";

    if (isThinkingMessage || message.pending) {
      article.classList.add("thinking");
    }
    if (message.error) {
      article.classList.add("error");
    }

    const roleLabel =
      message.role === "user"
        ? "Du"
        : isThinkingMessage
        ? "Assistent • Thinking"
        : "Assistent";
    node.querySelector(".role").textContent = roleLabel;
    node.querySelector(".timestamp").textContent = formatTime(message.createdAt);
    const displayContent =
      typeof message.content === "string" && message.content.length
        ? message.content
        : typeof message.thinking === "string"
        ? message.thinking
        : "";
    node.querySelector(".content").textContent = displayContent;

    const thinkingEl = node.querySelector(".thinking");
    if (isThinkingMessage) {
      if (message.pending && !(message.content && message.content.trim())) {
        thinkingEl.textContent = "Denkt nach …";
        thinkingEl.hidden = false;
      } else {
        thinkingEl.textContent = "";
        thinkingEl.hidden = true;
      }
    } else if (message.pending) {
      thinkingEl.textContent = "Antwort wird generiert …";
      thinkingEl.hidden = false;
    } else {
      thinkingEl.textContent = "";
      thinkingEl.hidden = true;
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
  if (state.requestPending) {
    showStatus("Während einer laufenden Antwort kann kein neuer Chat erstellt werden.", "error", 2500);
    return;
  }
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

function sanitizeServerUrl(value) {
  if (!value) return DEFAULT_SERVER;
  return value.replace(/\/+$/, "");
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
  const url = sanitizeServerUrl(state.serverUrl || DEFAULT_SERVER);
  const endpoint = `${url}/api/tags`;
  try {
    const response = await fetch(endpoint);
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

  const attachments = [];
  const file = dom.imageInput.files?.[0];
  if (file) {
    try {
      const attachment = await readFileAsAttachment(file);
      attachments.push(attachment);
    } catch (error) {
      showStatus(`Bild konnte nicht gelesen werden: ${error.message}`, "error", 3000);
      return;
    } finally {
      // reset file input
      dom.imageInput.value = "";
    }
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
    purpose: "thinking",
  };

  chat.messages.push(userMessage, thinkingMessage);
  chat.updatedAt = now;
  dom.messageInput.value = "";
  setRequestPending(true);
  persistState();
  renderMessages();
  renderChatList();

  try {
    await streamChatCompletion(chat, thinkingMessage);
  } catch (error) {
    thinkingMessage.pending = false;
    thinkingMessage.error = error.message;
    thinkingMessage.content =
      thinkingMessage.content || `Fehler bei der Antwort: ${error.message}`;
    thinkingMessage.purpose = "thinking";
    chat.updatedAt = new Date().toISOString();
    persistState();
    renderMessages();
    showStatus(error.message, "error");
  } finally {
    setRequestPending(false);
  }
}

async function streamChatCompletion(chat, thinkingMessage) {
  const url = sanitizeServerUrl(state.serverUrl || DEFAULT_SERVER);
  const endpoint = `${url}/api/chat`;

  const payload = {
    model: chat.model || state.defaultModel,
    messages: chat.messages
      .filter((message) => message.id !== thinkingMessage.id && message.purpose !== "thinking")
      .map((message) => serializeMessageForRequest(message))
      .filter(Boolean),
    stream: true,
    options: buildOptionsFromParams(chat.params),
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama antwortet nicht korrekt (Status ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  thinkingMessage.pending = true;
  thinkingMessage.content = thinkingMessage.content || "";

  const responseDraft = {
    id: createId(),
    text: "",
    attachments: [],
    pending: true,
    thinking: "",
    stats: null,
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      processStreamLine(line, { thinkingMessage, responseDraft, chat });
    }
  }

  buffer = buffer.trim();
  if (buffer) {
    processStreamLine(buffer, { thinkingMessage, responseDraft, chat });
  }

  thinkingMessage.pending = false;
  thinkingMessage.createdAt = thinkingMessage.createdAt || new Date().toISOString();

  const finalThinking = (responseDraft.thinking || thinkingMessage.content || "").trim();
  thinkingMessage.content = finalThinking;

  let finalContent = responseDraft.text.trim();
  if (responseDraft.stats) {
    const statsSection = formatStatsSection(responseDraft.stats);
    finalContent = finalContent
      ? `${finalContent}\n\n${statsSection}`
      : statsSection;
  }

  const hasResponse =
    finalContent.length > 0 ||
    (Array.isArray(responseDraft.attachments) && responseDraft.attachments.length > 0);

  if (hasResponse) {
    const assistantMessage = {
      id: createId(),
      role: "assistant",
      content: finalContent,
      createdAt: new Date().toISOString(),
      attachments: responseDraft.attachments || [],
      pending: false,
      purpose: "response",
    };
    chat.messages.push(assistantMessage);
  }

  if (!finalThinking) {
    chat.messages = chat.messages.filter((message) => message.id !== thinkingMessage.id);
  }

  chat.updatedAt = new Date().toISOString();
  persistState();
  renderMessages();
  renderChatList();
}

function processStreamLine(line, context) {
  const { thinkingMessage, responseDraft } = context;
  try {
    const payload = JSON.parse(line);
    if (payload.error) {
      throw new Error(payload.error);
    }

    let hasDirectThinking = false;
    if (typeof payload.thinking === "string" && payload.thinking.length) {
      responseDraft.thinking = mergeThinkingText(responseDraft.thinking || "", payload.thinking);
      thinkingMessage.content = responseDraft.thinking.trimStart();
      thinkingMessage.pending = !payload.done;
      hasDirectThinking = true;
    }

    if (!hasDirectThinking) {
      const fragments = extractThinkingFragments(payload);
      if (fragments.length) {
        fragments.forEach((fragment) => {
          responseDraft.thinking = mergeThinkingText(responseDraft.thinking || "", fragment);
        });
        thinkingMessage.content = responseDraft.thinking.trimStart();
        thinkingMessage.pending = !payload.done;
      }
    }

    if (typeof payload.response === "string" && payload.response.length) {
      responseDraft.text += payload.response;
    }

    const messageImages = Array.isArray(payload.message?.images)
      ? payload.message.images
      : null;
    const images = Array.isArray(payload.images) ? payload.images : messageImages;
    if (Array.isArray(images) && images.length) {
      responseDraft.attachments = images.map((base64, index) => ({
        id: `${responseDraft.id}-img-${index}`,
        dataUrl: `data:image/png;base64,${base64}`,
        base64,
        mime: "image/png",
      }));
    }

    if (payload.done) {
      thinkingMessage.pending = false;
      responseDraft.pending = false;
      responseDraft.stats = extractStats(payload);
    }

    persistState();
    renderMessages();
  } catch (error) {
    console.error("Streaming-Daten konnten nicht verarbeitet werden:", error, line);
  }
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

  const { message = {}, delta = {} } = payload;

  const candidates = [
    message?.thinking,
    message?.reasoning,
    payload.reasoning,
    delta?.thinking,
    delta?.reasoning,
  ];

  // Bei manchen Modellen wird Thinking als eigener Nachrichtentyp gestreamt
  if (message?.type === "thinking" && typeof message.content === "string") {
    candidates.push(message.content);
  }
  if (message?.thinking && typeof message.thinking === "string") {
    candidates.push(message.thinking);
  }
  if (payload.type === "thinking" && typeof payload.content === "string") {
    candidates.push(payload.content);
  }
  if (delta?.type === "thinking" && typeof delta.content === "string") {
    candidates.push(delta.content);
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

    const lastMessage = dom.messageList.lastElementChild;
    if (lastMessage) {
      lastMessage.scrollIntoView({ behavior, block: "end" });
    }
  });
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

function formatStatsSection(stats) {
  if (!stats) return "";

  const lines = ["---", "Statistiken:"];

  if (typeof stats.done_reason === "string") {
    lines.push(`- Beendigungsgrund: ${stats.done_reason}`);
  }
  if (typeof stats.total_duration === "number") {
    lines.push(`- Gesamtdauer: ${formatDuration(stats.total_duration)}`);
  }
  if (typeof stats.load_duration === "number") {
    lines.push(`- Ladedauer: ${formatDuration(stats.load_duration)}`);
  }
  if (typeof stats.prompt_eval_count === "number") {
    lines.push(`- Prompt-Tokens: ${stats.prompt_eval_count}`);
  }
  if (typeof stats.prompt_eval_duration === "number") {
    lines.push(`- Prompt-Dauer: ${formatDuration(stats.prompt_eval_duration)}`);
  }
  if (typeof stats.eval_count === "number") {
    lines.push(`- Antwort-Tokens: ${stats.eval_count}`);
  }
  if (typeof stats.eval_duration === "number") {
    lines.push(`- Antwort-Dauer: ${formatDuration(stats.eval_duration)}`);
  }
  if (Array.isArray(stats.context)) {
    lines.push(`- Kontext-Länge: ${stats.context.length}`);
  }

  return lines.join("\n");
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

function setRequestPending(isPending) {
  state.requestPending = Boolean(isPending);

  if (dom.newChatBtn) {
    dom.newChatBtn.disabled = state.requestPending;
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
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
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
