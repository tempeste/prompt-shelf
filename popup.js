const DB_NAME = "prompt-shelf";
const STORE_NAME = "handles";
const HANDLE_KEY = "prompts-dir";
const CACHE_KEY = "prompt-cache";

const core = window.PromptShelfCore;
const state = {
  agent: "codex",
  dirHandle: null,
  prompts: [],
  filtered: [],
  selectedId: null,
  query: "",
  lastSyncedAt: null,
  editing: false,
  dirty: false,
  saving: false,
  saveTimer: null,
};

const els = {
  agent: document.querySelector("#agent"),
  chooseFolder: document.querySelector("#choose-folder"),
  content: document.querySelector("#content"),
  copy: document.querySelector("#copy"),
  edit: document.querySelector("#edit"),
  emptyState: document.querySelector("#empty-state"),
  folderLabel: document.querySelector("#folder-label"),
  list: document.querySelector("#prompt-list"),
  preview: document.querySelector("#preview"),
  promptCount: document.querySelector("#prompt-count"),
  promptDescription: document.querySelector("#prompt-description"),
  promptTitle: document.querySelector("#prompt-title"),
  refresh: document.querySelector("#refresh"),
  saveState: document.querySelector("#save-state"),
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

  const cached = await loadPromptCache();
  if (cached?.prompts?.length) {
    state.prompts = cached.prompts;
    state.lastSyncedAt = cached.lastSyncedAt || state.lastSyncedAt;
  }

  state.dirHandle = await loadDirectoryHandle();
  if (state.dirHandle) {
    setFolderLabel(settings.lastFolderName || state.dirHandle.name);
  } else if (settings.lastFolderName && state.prompts.length) {
    setFolderLabel(settings.lastFolderName);
  }

  render();
  if (state.dirHandle) {
    await refreshPrompts({ quiet: true });
  } else {
    setStatus(state.prompts.length ? "Showing saved prompts. Choose a folder to sync." : "Ready");
  }
}

function bindEvents() {
  els.chooseFolder.addEventListener("click", chooseFolder);
  els.refresh.addEventListener("click", () => refreshPrompts({ quiet: false }));
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    if (state.editing) {
      stopEditing({ flush: true }).then(render).catch((error) => setStatus(error.message || String(error), true));
      return;
    }
    selectFirstIfNeeded();
    render();
  });
  els.agent.addEventListener("change", async () => {
    await stopEditing({ flush: true });
    state.agent = els.agent.value;
    await storageSet({ agent: state.agent });
    renderPreview();
  });
  els.edit.addEventListener("click", toggleEditing);
  els.copy.addEventListener("click", copySelectedPrompt);
  els.preview.addEventListener("input", () => {
    if (!state.editing) return;
    state.dirty = true;
    setSaveState("Unsaved");
    queueAutosave();
  });
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

  if (!quiet) {
    await stopEditing({ flush: true });
    setStatus("Checking folder access...");
  }
  const permission = await ensureDirectoryPermission(state.dirHandle, { request: !quiet, mode: "read" });
  if (!permission.ok) {
    setStatus(permissionStatus(permission.state, { quiet, hasPrompts: state.prompts.length > 0 }), !quiet);
    render();
    return;
  }

  if (!quiet) setStatus("Reading prompt files...");
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
  await savePromptCache({
    folderName: state.dirHandle.name,
    lastSyncedAt: state.lastSyncedAt,
    prompts,
  });
  await storageSet({
    lastFolderName: state.dirHandle.name,
    lastSyncedAt: state.lastSyncedAt,
  });
  selectFirstIfNeeded();
  render();
  setStatus(`Synced ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}.`);
}

async function ensureDirectoryPermission(handle, { request, mode = "read" }) {
  const options = { mode };
  const current = await handle.queryPermission(options);
  if (current === "granted") return { ok: true, state: current };
  if (!request) return { ok: false, state: current };
  try {
    const next = await handle.requestPermission(options);
    return { ok: next === "granted", state: next };
  } catch (error) {
    if (error && error.name === "SecurityError") return { ok: false, state: "activation-required" };
    throw error;
  }
}

function permissionStatus(permissionState, { quiet, hasPrompts }) {
  if (permissionState === "activation-required") {
    return "Chrome needs a direct click to reconnect. Press Refresh again.";
  }
  if (permissionState === "denied") {
    return hasPrompts
      ? "Folder access is blocked. Showing saved prompts; choose the folder again to reconnect."
      : "Folder access is blocked. Choose the prompts folder again.";
  }
  if (quiet) {
    return hasPrompts
      ? "Showing saved prompts. Click Refresh to sync latest files."
      : "Click Refresh to reconnect the prompts folder.";
  }
  return hasPrompts
    ? "Chrome did not grant folder access. Showing saved prompts."
    : "Chrome did not grant folder access.";
}

function selectFirstIfNeeded() {
  state.filtered = core.filterPrompts(state.prompts, state.query);
  if (state.filtered.some((prompt) => prompt.id === state.selectedId)) return;
  state.selectedId = state.filtered[0]?.id || null;
}

function render() {
  selectFirstIfNeeded();
  const hasFolder = Boolean(state.dirHandle);
  const hasLibrary = hasFolder || state.prompts.length > 0;
  const hasPrompts = state.filtered.length > 0;

  els.emptyState.hidden = hasLibrary;
  els.content.hidden = !hasLibrary;
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
    item.addEventListener("click", () => selectPrompt(prompt.id));

    const name = document.createElement("strong");
    name.textContent = prompt.name;
    const description = document.createElement("span");
    description.textContent = prompt.description || prompt.whenToUse || prompt.fileName;
    item.append(name, description);

    if (prompt.tags.length) {
      const tagRow = document.createElement("span");
      tagRow.className = "tag-row";
      for (const tag of prompt.tags.slice(0, 2)) {
        const tagEl = document.createElement("span");
        tagEl.className = "tag";
        tagEl.textContent = tag;
        tagRow.append(tagEl);
      }
      item.append(tagRow);
    }

    els.list.append(item);
  }
}

function renderPreview() {
  const prompt = selectedPrompt();
  if (!prompt) {
    els.promptTitle.textContent = "Select a prompt";
    els.promptDescription.textContent = "";
    els.preview.value = "";
    els.preview.readOnly = true;
    els.edit.disabled = true;
    setSaveState("");
    return;
  }

  els.promptTitle.textContent = prompt.name;
  els.promptDescription.textContent = prompt.description || prompt.whenToUse || prompt.fileName;
  if (!state.editing || document.activeElement !== els.preview) {
    els.preview.value = core.promptOutput(prompt, state.agent);
  }
  els.preview.readOnly = !state.editing;
  els.edit.disabled = !state.dirHandle;
  els.edit.textContent = state.editing ? "Done" : "Edit";
  if (!state.editing && !state.saving) setSaveState("");
}

async function copySelectedPrompt() {
  const prompt = selectedPrompt();
  if (!prompt) return;
  try {
    await navigator.clipboard.writeText(state.editing ? `${els.preview.value.replace(/\s+$/g, "")}\n` : core.promptOutput(prompt, state.agent));
    setStatus(`Copied ${prompt.name} (${labelForAgent(state.agent)}).`);
  } catch (error) {
    setStatus(error.message || "Clipboard copy failed.", true);
  }
}

async function selectPrompt(promptId) {
  if (promptId === state.selectedId) return;
  await stopEditing({ flush: true });
  state.selectedId = promptId;
  render();
}

async function toggleEditing() {
  if (state.editing) {
    await stopEditing({ flush: true });
    renderPreview();
    setStatus("Editing stopped.");
    return;
  }

  const prompt = selectedPrompt();
  if (!prompt) return;
  if (!state.dirHandle) {
    setStatus("Choose a prompts folder before editing.", true);
    return;
  }

  setStatus("Requesting write access...");
  const permission = await ensureDirectoryPermission(state.dirHandle, { request: true, mode: "readwrite" });
  if (!permission.ok) {
    setStatus(writePermissionStatus(permission.state), true);
    return;
  }

  state.editing = true;
  state.dirty = false;
  renderPreview();
  els.preview.focus();
  els.preview.setSelectionRange(els.preview.value.length, els.preview.value.length);
  setSaveState("Editing");
  setStatus("Editing. Changes save automatically.");
}

async function stopEditing({ flush }) {
  if (!state.editing) return;
  if (flush) await flushPendingSave();
  state.editing = false;
  state.dirty = false;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSaveState("");
}

function queueAutosave(delay = 650) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    saveEditedPrompt().catch((error) => {
      state.dirty = true;
      setSaveState("Unsaved");
      setStatus(error.message || "Could not save prompt.", true);
    });
  }, delay);
}

async function flushPendingSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (state.dirty) await saveEditedPrompt();
}

async function saveEditedPrompt() {
  const prompt = selectedPrompt();
  if (!state.editing || !prompt || !state.dirHandle) return;
  if (state.saving) {
    queueAutosave(120);
    return;
  }

  const fileName = prompt.fileName;
  const nextPreview = els.preview.value;
  const nextRawText = core.promptTextWithOutput(prompt, state.agent, nextPreview);
  state.saving = true;
  state.dirty = false;
  setSaveState("Saving...");

  try {
    const fileHandle = await state.dirHandle.getFileHandle(fileName);
    const writable = await fileHandle.createWritable();
    await writable.write(nextRawText);
    await writable.close();

    replacePrompt(core.loadPrompt(fileName, nextRawText));
    state.lastSyncedAt = new Date().toISOString();
    await persistPromptCache();
    renderList();
    updateSyncTime();
    setSaveState("Saved");
    setStatus(`Saved ${fileName}.`);
  } finally {
    state.saving = false;
    if (state.editing && els.preview.value !== nextPreview) {
      state.dirty = true;
      setSaveState("Unsaved");
      queueAutosave(120);
    }
  }
}

function replacePrompt(nextPrompt) {
  const index = state.prompts.findIndex((prompt) => prompt.id === nextPrompt.id);
  if (index === -1) {
    state.prompts.push(nextPrompt);
  } else {
    state.prompts[index] = nextPrompt;
  }
  state.filtered = core.filterPrompts(state.prompts, state.query);
}

async function persistPromptCache() {
  await savePromptCache({
    folderName: state.dirHandle?.name || "",
    lastSyncedAt: state.lastSyncedAt,
    prompts: state.prompts,
  });
  await storageSet({
    lastFolderName: state.dirHandle?.name || "",
    lastSyncedAt: state.lastSyncedAt,
  });
}

function writePermissionStatus(permissionState) {
  if (permissionState === "activation-required") {
    return "Chrome needs a direct click to enable editing. Press Edit again.";
  }
  if (permissionState === "denied") {
    return "Chrome did not grant write access. Editing stays off.";
  }
  return "Write access was not granted. Editing stays off.";
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

function setSaveState(message) {
  els.saveState.textContent = message;
}

function updateSyncTime() {
  const count = state.prompts.length;
  els.promptCount.textContent = `${count} prompt${count === 1 ? "" : "s"}`;

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

function loadPromptCache() {
  return withStore("readonly", (store) => store.get(CACHE_KEY)).catch(() => null);
}

function savePromptCache(cache) {
  return withStore("readwrite", (store) => store.put(cache, CACHE_KEY));
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
