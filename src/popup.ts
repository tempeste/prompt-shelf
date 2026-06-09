import {
  chooseDirectory,
  ensureDirectoryPermission,
  permissionStatus,
  readPromptsFromDirectory,
  writePermissionStatus,
  writePromptFile,
} from "./file-access";
import { filterPrompts, loadPrompt, promptOutput, promptTextWithOutput } from "./prompt-core";
import {
  getElements,
  labelForAgent,
  renderApp,
  setFolderLabel,
  setSaveState,
  setStatus,
  updateSyncTime,
} from "./render";
import {
  loadDirectoryHandle,
  loadPromptCache,
  saveDirectoryHandle,
  savePromptCache,
  storageGet,
  storageSet,
} from "./storage";
import type { Agent, AppState, Prompt } from "./types";

const state: AppState = {
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
};

const els = getElements();

init().catch((error: unknown) => setStatus(els, errorMessage(error), true));

async function init(): Promise<void> {
  const settings = await storageGet(["agent", "lastSyncedAt", "lastFolderName"]);
  state.agent = parseAgent(settings.agent) ?? "codex";
  state.lastSyncedAt = settings.lastSyncedAt ?? null;
  els.agent.value = state.agent;

  bindEvents();
  updateSyncTime(els, state);

  const cached = await loadPromptCache();
  if (cached?.prompts.length) {
    state.prompts = cached.prompts;
    state.lastSyncedAt = cached.lastSyncedAt || state.lastSyncedAt;
  }

  state.dirHandle = await loadDirectoryHandle();
  if (state.dirHandle) {
    setFolderLabel(els, settings.lastFolderName || state.dirHandle.name);
  } else if (settings.lastFolderName && state.prompts.length) {
    setFolderLabel(els, settings.lastFolderName);
  }

  render();
  if (state.dirHandle) {
    await refreshPrompts({ quiet: true });
  } else {
    setStatus(els, state.prompts.length ? "Showing saved prompts. Choose a folder to sync." : "Ready");
  }
}

function bindEvents(): void {
  els.chooseFolder.addEventListener("click", chooseFolder);
  els.refresh.addEventListener("click", () => void refreshPrompts({ quiet: false }));
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    selectFirstIfNeeded();
    render();
  });
  els.agent.addEventListener("change", async () => {
    state.agent = parseAgent(els.agent.value) ?? "codex";
    await storageSet({ agent: state.agent });
    render();
  });
  els.edit.addEventListener("click", () => {
    toggleEditing().catch((error: unknown) => setStatus(els, errorMessage(error, "Could not update edit mode."), true));
  });
  els.copy.addEventListener("click", () => void copySelectedPrompt());
  els.preview.addEventListener("input", () => {
    if (!state.editing) return;
    state.dirty = true;
    setSaveState(els, "Unsaved");
  });
}

async function chooseFolder(): Promise<void> {
  try {
    const handle = await chooseDirectory();
    state.dirHandle = handle;
    await saveDirectoryHandle(handle);
    await storageSet({ lastFolderName: handle.name });
    setFolderLabel(els, handle.name);
    await refreshPrompts({ quiet: false });
  } catch (error: unknown) {
    if (errorName(error) === "AbortError") return;
    setStatus(els, errorMessage(error), true);
  }
}

async function refreshPrompts({ quiet }: { quiet: boolean }): Promise<void> {
  if (!state.dirHandle) {
    setStatus(els, "Choose a prompts folder first.", true);
    render();
    return;
  }

  if (!quiet) setStatus(els, "Checking folder access...");
  const permission = await ensureDirectoryPermission(state.dirHandle, { request: !quiet, mode: "read" });
  if (!permission.ok) {
    setStatus(els, permissionStatus(permission.state, { quiet, hasPrompts: state.prompts.length > 0 }), !quiet);
    render();
    return;
  }

  if (!quiet) setStatus(els, "Reading prompt files...");
  state.prompts = await readPromptsFromDirectory(state.dirHandle);
  state.lastSyncedAt = new Date().toISOString();
  await persistPromptCache();
  selectFirstIfNeeded();
  render();
  setStatus(els, `Synced ${state.prompts.length} prompt${state.prompts.length === 1 ? "" : "s"}.`);
}

function selectFirstIfNeeded(): void {
  state.filtered = filterPrompts(state.prompts, state.query);
  if (state.filtered.some((prompt) => prompt.id === state.selectedId)) return;
  state.selectedId = state.filtered[0]?.id || null;
}

function render(): void {
  selectFirstIfNeeded();
  const prompt = selectedPrompt();
  renderApp({
    elements: els,
    state,
    selectedPrompt: prompt,
    selectedOutput: prompt ? promptOutput(prompt, state.agent) : "",
    onSelectPrompt: selectPrompt,
  });
}

async function copySelectedPrompt(): Promise<void> {
  const prompt = selectedPrompt();
  if (!prompt) return;
  try {
    const output = state.editing ? `${els.preview.value.replace(/\s+$/g, "")}\n` : promptOutput(prompt, state.agent);
    await navigator.clipboard.writeText(output);
    setStatus(els, `Copied ${prompt.name} (${labelForAgent(state.agent)}).`);
  } catch (error: unknown) {
    setStatus(els, errorMessage(error, "Clipboard copy failed."), true);
  }
}

function selectPrompt(promptId: string): void {
  if (promptId === state.selectedId) return;
  if (state.editing) {
    setStatus(els, "Click Done to save before switching prompts.", true);
    return;
  }
  state.selectedId = promptId;
  render();
}

async function toggleEditing(): Promise<void> {
  if (state.editing) {
    await saveEditedPrompt();
    state.editing = false;
    state.dirty = false;
    render();
    return;
  }

  const prompt = selectedPrompt();
  if (!prompt) return;
  if (!state.dirHandle) {
    setStatus(els, "Choose a prompts folder before editing.", true);
    return;
  }

  setStatus(els, "Requesting write access...");
  const permission = await ensureDirectoryPermission(state.dirHandle, { request: true, mode: "readwrite" });
  if (!permission.ok) {
    setStatus(els, writePermissionStatus(permission.state), true);
    return;
  }

  state.editing = true;
  state.dirty = false;
  render();
  els.preview.focus();
  els.preview.setSelectionRange(els.preview.value.length, els.preview.value.length);
  setSaveState(els, "Editing");
  setStatus(els, "Editing. Click Done to save changes.");
}

async function saveEditedPrompt(): Promise<void> {
  const prompt = selectedPrompt();
  if (!state.editing || !prompt || !state.dirHandle) return;
  if (!state.dirty) {
    setSaveState(els, "");
    setStatus(els, "No changes to save.");
    return;
  }
  if (state.saving) return;

  const fileName = prompt.fileName;
  const nextRawText = promptTextWithOutput(prompt, state.agent, els.preview.value);
  state.saving = true;
  setSaveState(els, "Saving...");

  try {
    await writePromptFile(state.dirHandle, fileName, nextRawText);
    replacePrompt(loadPrompt(fileName, nextRawText));
    state.lastSyncedAt = new Date().toISOString();
    await persistPromptCache();
    updateSyncTime(els, state);
    state.dirty = false;
    setSaveState(els, "Saved");
    setStatus(els, `Saved ${fileName}.`);
  } catch (error: unknown) {
    state.dirty = true;
    setSaveState(els, "Unsaved");
    setStatus(els, errorMessage(error, "Could not save prompt."), true);
    throw error;
  } finally {
    state.saving = false;
  }
}

function replacePrompt(nextPrompt: Prompt): void {
  const index = state.prompts.findIndex((prompt) => prompt.id === nextPrompt.id);
  if (index === -1) {
    state.prompts.push(nextPrompt);
  } else {
    state.prompts[index] = nextPrompt;
  }
  state.prompts.sort((left, right) => left.name.localeCompare(right.name));
  state.filtered = filterPrompts(state.prompts, state.query);
}

async function persistPromptCache(): Promise<void> {
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

function selectedPrompt(): Prompt | null {
  return state.filtered.find((prompt) => prompt.id === state.selectedId) || null;
}

function parseAgent(value: unknown): Agent | null {
  return value === "codex" || value === "claude" || value === "all" ? value : null;
}

function errorName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name;
  if (typeof error === "object" && error && "name" in error) {
    return String(error.name);
  }
  return null;
}

function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
