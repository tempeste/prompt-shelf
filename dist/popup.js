import { filterPrompts, loadPrompt, promptOutput, promptTextWithOutput } from "./prompt-core.js";
//#region src/file-access.ts
async function chooseDirectory() {
	if (!window.showDirectoryPicker) throw new Error("Folder picker is not available in this browser.");
	return await window.showDirectoryPicker({ mode: "read" });
}
async function ensureDirectoryPermission(handle, { request, mode = "read" }) {
	const options = { mode };
	const current = await handle.queryPermission(options);
	if (current === "granted") return {
		ok: true,
		state: current
	};
	if (!request) return {
		ok: false,
		state: current
	};
	try {
		const next = await handle.requestPermission(options);
		return {
			ok: next === "granted",
			state: next
		};
	} catch (error) {
		if (errorName$1(error) === "SecurityError") return {
			ok: false,
			state: "activation-required"
		};
		throw error;
	}
}
function permissionStatus(permissionState, { quiet, hasPrompts }) {
	if (permissionState === "activation-required") return "Chrome needs a direct click to reconnect. Press Refresh again.";
	if (permissionState === "denied") return hasPrompts ? "Folder access is blocked. Showing saved prompts; choose the folder again to reconnect." : "Folder access is blocked. Choose the prompts folder again.";
	if (quiet) return hasPrompts ? "Showing saved prompts. Click Refresh to sync latest files." : "Click Refresh to reconnect the prompts folder.";
	return hasPrompts ? "Chrome did not grant folder access. Showing saved prompts." : "Chrome did not grant folder access.";
}
function writePermissionStatus(permissionState) {
	if (permissionState === "activation-required") return "Chrome needs a direct click to enable editing. Press Edit again.";
	if (permissionState === "denied") return "Chrome did not grant write access. Editing stays off.";
	return "Write access was not granted. Editing stays off.";
}
async function readPromptsFromDirectory(handle) {
	const prompts = [];
	for await (const [name, entry] of handle.entries()) {
		if (entry.kind !== "file" || !name.toLowerCase().endsWith(".md") || name === "README.md") continue;
		const text = await (await entry.getFile()).text();
		prompts.push(loadPrompt(name, text));
	}
	prompts.sort((left, right) => left.name.localeCompare(right.name));
	return prompts;
}
async function writePromptFile(handle, fileName, nextRawText) {
	const writable = await (await handle.getFileHandle(fileName)).createWritable();
	await writable.write(nextRawText);
	await writable.close();
}
function errorName$1(error) {
	if (error instanceof DOMException) return error.name;
	if (typeof error === "object" && error && "name" in error) return String(error.name);
	return null;
}
//#endregion
//#region src/render.ts
function getElements() {
	return {
		agent: requiredElement("#agent"),
		chooseFolder: requiredElement("#choose-folder"),
		content: requiredElement("#content"),
		copy: requiredElement("#copy"),
		edit: requiredElement("#edit"),
		emptyState: requiredElement("#empty-state"),
		folderLabel: requiredElement("#folder-label"),
		list: requiredElement("#prompt-list"),
		preview: requiredElement("#preview"),
		promptCount: requiredElement("#prompt-count"),
		promptDescription: requiredElement("#prompt-description"),
		promptTitle: requiredElement("#prompt-title"),
		refresh: requiredElement("#refresh"),
		saveState: requiredElement("#save-state"),
		search: requiredElement("#search"),
		status: requiredElement("#status"),
		syncTime: requiredElement("#sync-time")
	};
}
function renderApp(options) {
	const { elements, state, selectedPrompt, selectedOutput, onSelectPrompt } = options;
	const hasFolder = Boolean(state.dirHandle);
	const hasLibrary = hasFolder || state.prompts.length > 0;
	const hasPrompts = state.filtered.length > 0;
	elements.emptyState.hidden = hasLibrary;
	elements.content.hidden = !hasLibrary;
	elements.chooseFolder.disabled = state.editing;
	elements.refresh.disabled = !hasFolder || state.editing;
	elements.search.disabled = state.editing;
	elements.agent.disabled = state.editing;
	elements.copy.disabled = !hasPrompts;
	renderList(elements, state, onSelectPrompt);
	renderPreview(elements, state, selectedPrompt, selectedOutput);
	updateSyncTime(elements, state);
}
function setFolderLabel(elements, name) {
	elements.folderLabel.textContent = name ? `Folder: ${name}` : "No folder selected";
}
function setStatus(elements, message, isError = false) {
	elements.status.textContent = message;
	elements.status.dataset.state = isError ? "error" : "ok";
}
function setSaveState(elements, message) {
	elements.saveState.textContent = message;
}
function updateSyncTime(elements, state) {
	const count = state.prompts.length;
	elements.promptCount.textContent = `${count} prompt${count === 1 ? "" : "s"}`;
	if (!state.lastSyncedAt) {
		elements.syncTime.textContent = "";
		return;
	}
	const date = new Date(state.lastSyncedAt);
	elements.syncTime.textContent = `Synced ${date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	})}`;
}
function labelForAgent(agent) {
	if (agent === "all") return "all";
	return agent.charAt(0).toUpperCase() + agent.slice(1);
}
function renderList(elements, state, onSelectPrompt) {
	elements.list.replaceChildren();
	if (!state.filtered.length) {
		const empty = document.createElement("p");
		empty.className = "list-empty";
		empty.textContent = state.prompts.length ? "No matching prompts." : "No prompts found.";
		elements.list.append(empty);
		return;
	}
	for (const prompt of state.filtered) {
		const item = document.createElement("button");
		item.type = "button";
		item.className = "prompt-item";
		item.disabled = state.editing && prompt.id !== state.selectedId;
		item.setAttribute("role", "option");
		item.setAttribute("aria-selected", String(prompt.id === state.selectedId));
		item.addEventListener("click", () => onSelectPrompt(prompt.id));
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
		elements.list.append(item);
	}
}
function renderPreview(elements, state, prompt, selectedOutput) {
	if (!prompt) {
		elements.promptTitle.textContent = "Select a prompt";
		elements.promptDescription.textContent = "";
		elements.preview.value = "";
		elements.preview.readOnly = true;
		elements.edit.disabled = true;
		setSaveState(elements, "");
		return;
	}
	elements.promptTitle.textContent = prompt.name;
	elements.promptDescription.textContent = prompt.description || prompt.whenToUse || prompt.fileName;
	if (!state.editing || document.activeElement !== elements.preview) elements.preview.value = selectedOutput;
	elements.preview.readOnly = !state.editing;
	elements.edit.disabled = !state.dirHandle;
	elements.edit.textContent = state.editing ? "Done" : "Edit";
	if (!state.editing && !state.saving) setSaveState(elements, "");
}
function requiredElement(selector) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`Missing required popup element: ${selector}`);
	return element;
}
//#endregion
//#region src/storage.ts
var DB_NAME = "prompt-shelf";
var STORE_NAME = "handles";
var HANDLE_KEY = "prompts-dir";
var CACHE_KEY = "prompt-cache";
var LOCAL_STORAGE_PREFIX = "prompt-shelf:";
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
		const request = callback(tx.objectStore(STORE_NAME));
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
	return withStore("readwrite", (store) => store.put(handle, HANDLE_KEY)).then(() => void 0);
}
function loadPromptCache() {
	return withStore("readonly", (store) => store.get(CACHE_KEY)).catch(() => null);
}
function savePromptCache(cache) {
	return withStore("readwrite", (store) => store.put(cache, CACHE_KEY)).then(() => void 0);
}
function parseLocalStorageValue(raw) {
	if (!raw) return void 0;
	try {
		return JSON.parse(raw);
	} catch {
		return;
	}
}
async function storageGet(keys) {
	const storage = globalThis.chrome?.storage?.local;
	if (!storage) return Object.fromEntries(keys.map((key) => [key, parseLocalStorageValue(localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`))]));
	return await storage.get(keys);
}
function storageSet(values) {
	const storage = globalThis.chrome?.storage?.local;
	if (!storage) {
		for (const [key, value] of Object.entries(values)) localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(value));
		return Promise.resolve();
	}
	return storage.set(values);
}
//#endregion
//#region src/popup.ts
var state = {
	agent: "codex",
	dirHandle: null,
	prompts: [],
	filtered: [],
	selectedId: null,
	query: "",
	lastSyncedAt: null,
	editing: false,
	dirty: false,
	saving: false
};
var els = getElements();
init().catch((error) => setStatus(els, errorMessage(error), true));
async function init() {
	const settings = await storageGet([
		"agent",
		"lastSyncedAt",
		"lastFolderName"
	]);
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
	if (state.dirHandle) setFolderLabel(els, settings.lastFolderName || state.dirHandle.name);
	else if (settings.lastFolderName && state.prompts.length) setFolderLabel(els, settings.lastFolderName);
	render();
	if (state.dirHandle) await refreshPrompts({ quiet: true });
	else setStatus(els, state.prompts.length ? "Showing saved prompts. Choose a folder to sync." : "Ready");
}
function bindEvents() {
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
		toggleEditing().catch((error) => setStatus(els, errorMessage(error, "Could not update edit mode."), true));
	});
	els.copy.addEventListener("click", () => void copySelectedPrompt());
	els.preview.addEventListener("input", () => {
		if (!state.editing) return;
		state.dirty = true;
		setSaveState(els, "Unsaved");
	});
}
async function chooseFolder() {
	try {
		const handle = await chooseDirectory();
		state.dirHandle = handle;
		await saveDirectoryHandle(handle);
		await storageSet({ lastFolderName: handle.name });
		setFolderLabel(els, handle.name);
		await refreshPrompts({ quiet: false });
	} catch (error) {
		if (errorName(error) === "AbortError") return;
		setStatus(els, errorMessage(error), true);
	}
}
async function refreshPrompts({ quiet }) {
	if (!state.dirHandle) {
		setStatus(els, "Choose a prompts folder first.", true);
		render();
		return;
	}
	if (!quiet) setStatus(els, "Checking folder access...");
	const permission = await ensureDirectoryPermission(state.dirHandle, {
		request: !quiet,
		mode: "read"
	});
	if (!permission.ok) {
		setStatus(els, permissionStatus(permission.state, {
			quiet,
			hasPrompts: state.prompts.length > 0
		}), !quiet);
		render();
		return;
	}
	if (!quiet) setStatus(els, "Reading prompt files...");
	state.prompts = await readPromptsFromDirectory(state.dirHandle);
	state.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
	await persistPromptCache();
	selectFirstIfNeeded();
	render();
	setStatus(els, `Synced ${state.prompts.length} prompt${state.prompts.length === 1 ? "" : "s"}.`);
}
function selectFirstIfNeeded() {
	state.filtered = filterPrompts(state.prompts, state.query);
	if (state.filtered.some((prompt) => prompt.id === state.selectedId)) return;
	state.selectedId = state.filtered[0]?.id || null;
}
function render() {
	selectFirstIfNeeded();
	const prompt = selectedPrompt();
	renderApp({
		elements: els,
		state,
		selectedPrompt: prompt,
		selectedOutput: prompt ? promptOutput(prompt, state.agent) : "",
		onSelectPrompt: selectPrompt
	});
}
async function copySelectedPrompt() {
	const prompt = selectedPrompt();
	if (!prompt) return;
	try {
		const output = state.editing ? `${els.preview.value.replace(/\s+$/g, "")}\n` : promptOutput(prompt, state.agent);
		await navigator.clipboard.writeText(output);
		setStatus(els, `Copied ${prompt.name} (${labelForAgent(state.agent)}).`);
	} catch (error) {
		setStatus(els, errorMessage(error, "Clipboard copy failed."), true);
	}
}
function selectPrompt(promptId) {
	if (promptId === state.selectedId) return;
	if (state.editing) {
		setStatus(els, "Click Done to save before switching prompts.", true);
		return;
	}
	state.selectedId = promptId;
	render();
}
async function toggleEditing() {
	if (state.editing) {
		await saveEditedPrompt();
		state.editing = false;
		state.dirty = false;
		render();
		return;
	}
	if (!selectedPrompt()) return;
	if (!state.dirHandle) {
		setStatus(els, "Choose a prompts folder before editing.", true);
		return;
	}
	setStatus(els, "Requesting write access...");
	const permission = await ensureDirectoryPermission(state.dirHandle, {
		request: true,
		mode: "readwrite"
	});
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
async function saveEditedPrompt() {
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
		state.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
		await persistPromptCache();
		updateSyncTime(els, state);
		state.dirty = false;
		setSaveState(els, "Saved");
		setStatus(els, `Saved ${fileName}.`);
	} catch (error) {
		state.dirty = true;
		setSaveState(els, "Unsaved");
		setStatus(els, errorMessage(error, "Could not save prompt."), true);
		throw error;
	} finally {
		state.saving = false;
	}
}
function replacePrompt(nextPrompt) {
	const index = state.prompts.findIndex((prompt) => prompt.id === nextPrompt.id);
	if (index === -1) state.prompts.push(nextPrompt);
	else state.prompts[index] = nextPrompt;
	state.prompts.sort((left, right) => left.name.localeCompare(right.name));
	state.filtered = filterPrompts(state.prompts, state.query);
}
async function persistPromptCache() {
	await savePromptCache({
		folderName: state.dirHandle?.name || "",
		lastSyncedAt: state.lastSyncedAt,
		prompts: state.prompts
	});
	await storageSet({
		lastFolderName: state.dirHandle?.name || "",
		lastSyncedAt: state.lastSyncedAt
	});
}
function selectedPrompt() {
	return state.filtered.find((prompt) => prompt.id === state.selectedId) || null;
}
function parseAgent(value) {
	return value === "codex" || value === "claude" || value === "all" ? value : null;
}
function errorName(error) {
	if (error instanceof DOMException) return error.name;
	if (typeof error === "object" && error && "name" in error) return String(error.name);
	return null;
}
function errorMessage(error, fallback = "Something went wrong.") {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}
//#endregion

//# sourceMappingURL=popup.js.map