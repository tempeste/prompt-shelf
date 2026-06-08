const DB_NAME = "prompt-shelf";
const STORE_NAME = "handles";
const HANDLE_KEY = "prompts-dir";

const core = window.PromptShelfCore;
const state = {
  agent: "codex",
  dirHandle: null,
  prompts: [],
  filtered: [],
  selectedId: null,
  query: "",
  lastSyncedAt: null,
};

const els = {
  agent: document.querySelector("#agent"),
  chooseFolder: document.querySelector("#choose-folder"),
  content: document.querySelector("#content"),
  copy: document.querySelector("#copy"),
  emptyState: document.querySelector("#empty-state"),
  folderLabel: document.querySelector("#folder-label"),
  list: document.querySelector("#prompt-list"),
  preview: document.querySelector("#preview"),
  promptDescription: document.querySelector("#prompt-description"),
  promptTitle: document.querySelector("#prompt-title"),
  refresh: document.querySelector("#refresh"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status"),
  syncTime: document.querySelector("#sync-time"),
};

init().catch((error) => setStatus(error.message || String(error), true));

async function init() {
  const settings = await storageGet(["agent", "lastSyncedAt", "lastFolderName"]);
  state.agent = settings.agent || "codex";
  state.lastSyncedAt = settings.lastSyncedAt || null;
  els.agent.value = state.agent;

  bindEvents();
  updateSyncTime();

  state.dirHandle = await loadDirectoryHandle();
  if (state.dirHandle) {
    setFolderLabel(settings.lastFolderName || state.dirHandle.name);
    await refreshPrompts({ quiet: true });
  } else {
    render();
  }
}

function bindEvents() {
  els.chooseFolder.addEventListener("click", chooseFolder);
  els.refresh.addEventListener("click", () => refreshPrompts({ quiet: false }));
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    selectFirstIfNeeded();
    render();
  });
  els.agent.addEventListener("change", async () => {
    state.agent = els.agent.value;
    await storageSet({ agent: state.agent });
    renderPreview();
  });
  els.copy.addEventListener("click", copySelectedPrompt);
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("Folder picker is not available in this browser.", true);
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    state.dirHandle = handle;
    await saveDirectoryHandle(handle);
    await storageSet({ lastFolderName: handle.name });
    setFolderLabel(handle.name);
    await refreshPrompts({ quiet: false });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || String(error), true);
  }
}

async function refreshPrompts({ quiet }) {
  if (!state.dirHandle) {
    setStatus("Choose a prompts folder first.", true);
    render();
    return;
  }

  if (!quiet) setStatus("Refreshing...");
  const permission = await ensureDirectoryPermission(state.dirHandle);
  if (!permission) {
    setStatus("Reconnect the prompts folder to refresh.", true);
    render();
    return;
  }

  const prompts = [];
  for await (const [name, handle] of state.dirHandle.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".md") || name === "README.md") {
      continue;
    }
    const file = await handle.getFile();
    const text = await file.text();
    prompts.push(core.loadPrompt(name, text));
  }

  prompts.sort((left, right) => left.name.localeCompare(right.name));
  state.prompts = prompts;
  state.lastSyncedAt = new Date().toISOString();
  await storageSet({
    lastFolderName: state.dirHandle.name,
    lastSyncedAt: state.lastSyncedAt,
  });
  selectFirstIfNeeded();
  render();
  setStatus(`Loaded ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}.`);
}

async function ensureDirectoryPermission(handle) {
  const options = { mode: "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

function selectFirstIfNeeded() {
  state.filtered = core.filterPrompts(state.prompts, state.query);
  if (state.filtered.some((prompt) => prompt.id === state.selectedId)) return;
  state.selectedId = state.filtered[0]?.id || null;
}

function render() {
  selectFirstIfNeeded();
  const hasFolder = Boolean(state.dirHandle);
  const hasPrompts = state.filtered.length > 0;

  els.emptyState.hidden = hasFolder;
  els.content.hidden = !hasFolder;
  els.refresh.disabled = !hasFolder;
  els.copy.disabled = !hasPrompts;

  renderList();
  renderPreview();
  updateSyncTime();
}

function renderList() {
  els.list.replaceChildren();
  if (!state.filtered.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = state.prompts.length ? "No matching prompts." : "No prompts found.";
    els.list.append(empty);
    return;
  }

  for (const prompt of state.filtered) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "prompt-item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(prompt.id === state.selectedId));
    item.addEventListener("click", () => {
      state.selectedId = prompt.id;
      render();
    });

    const name = document.createElement("strong");
    name.textContent = prompt.name;
    const description = document.createElement("span");
    description.textContent = prompt.description || prompt.whenToUse || prompt.fileName;
    item.append(name, description);
    els.list.append(item);
  }
}

function renderPreview() {
  const prompt = selectedPrompt();
  if (!prompt) {
    els.promptTitle.textContent = "Select a prompt";
    els.promptDescription.textContent = "";
    els.preview.textContent = "";
    return;
  }

  els.promptTitle.textContent = prompt.name;
  els.promptDescription.textContent = prompt.description || prompt.whenToUse || prompt.fileName;
  els.preview.textContent = core.promptOutput(prompt, state.agent);
}

async function copySelectedPrompt() {
  const prompt = selectedPrompt();
  if (!prompt) return;
  try {
    await navigator.clipboard.writeText(core.promptOutput(prompt, state.agent));
    setStatus(`Copied ${prompt.name} (${labelForAgent(state.agent)}).`);
  } catch (error) {
    setStatus(error.message || "Clipboard copy failed.", true);
  }
}

function selectedPrompt() {
  return state.filtered.find((prompt) => prompt.id === state.selectedId) || null;
}

function labelForAgent(agent) {
  if (agent === "all") return "all";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

function setFolderLabel(name) {
  els.folderLabel.textContent = name ? `Folder: ${name}` : "No folder selected";
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.dataset.state = isError ? "error" : "ok";
}

function updateSyncTime() {
  if (!state.lastSyncedAt) {
    els.syncTime.textContent = "";
    return;
  }
  const date = new Date(state.lastSyncedAt);
  els.syncTime.textContent = `Synced ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

function loadDirectoryHandle() {
  return withStore("readonly", (store) => store.get(HANDLE_KEY)).catch(() => null);
}

function saveDirectoryHandle(handle) {
  return withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

function storageGet(keys) {
  if (!globalThis.chrome?.storage?.local) {
    const names = Array.isArray(keys) ? keys : Object.keys(keys || {});
    return Promise.resolve(
      Object.fromEntries(
        names.map((key) => {
          const raw = localStorage.getItem(`prompt-shelf:${key}`);
          return [key, raw ? JSON.parse(raw) : undefined];
        }),
      ),
    );
  }
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  if (!globalThis.chrome?.storage?.local) {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(`prompt-shelf:${key}`, JSON.stringify(value));
    }
    return Promise.resolve();
  }
  return chrome.storage.local.set(values);
}
