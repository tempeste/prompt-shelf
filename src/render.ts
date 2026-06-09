import type { Agent, AppState, Elements, Prompt } from "./types";

interface RenderOptions {
  elements: Elements;
  state: AppState;
  selectedPrompt: Prompt | null;
  selectedOutput: string;
  onSelectPrompt: (promptId: string) => void;
}

export function getElements(): Elements {
  return {
    agent: requiredElement<HTMLSelectElement>("#agent"),
    chooseFolder: requiredElement<HTMLButtonElement>("#choose-folder"),
    content: requiredElement<HTMLElement>("#content"),
    copy: requiredElement<HTMLButtonElement>("#copy"),
    edit: requiredElement<HTMLButtonElement>("#edit"),
    emptyState: requiredElement<HTMLElement>("#empty-state"),
    folderLabel: requiredElement<HTMLElement>("#folder-label"),
    list: requiredElement<HTMLElement>("#prompt-list"),
    preview: requiredElement<HTMLTextAreaElement>("#preview"),
    promptCount: requiredElement<HTMLElement>("#prompt-count"),
    promptDescription: requiredElement<HTMLElement>("#prompt-description"),
    promptTitle: requiredElement<HTMLElement>("#prompt-title"),
    refresh: requiredElement<HTMLButtonElement>("#refresh"),
    saveState: requiredElement<HTMLElement>("#save-state"),
    search: requiredElement<HTMLInputElement>("#search"),
    status: requiredElement<HTMLElement>("#status"),
    syncTime: requiredElement<HTMLElement>("#sync-time"),
  };
}

export function renderApp(options: RenderOptions): void {
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

export function setFolderLabel(elements: Elements, name: string | null | undefined): void {
  elements.folderLabel.textContent = name ? `Folder: ${name}` : "No folder selected";
}

export function setStatus(elements: Elements, message: string, isError = false): void {
  elements.status.textContent = message;
  elements.status.dataset.state = isError ? "error" : "ok";
}

export function setSaveState(elements: Elements, message: string): void {
  elements.saveState.textContent = message;
}

export function updateSyncTime(elements: Elements, state: Pick<AppState, "prompts" | "lastSyncedAt">): void {
  const count = state.prompts.length;
  elements.promptCount.textContent = `${count} prompt${count === 1 ? "" : "s"}`;

  if (!state.lastSyncedAt) {
    elements.syncTime.textContent = "";
    return;
  }
  const date = new Date(state.lastSyncedAt);
  elements.syncTime.textContent = `Synced ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function labelForAgent(agent: Agent): string {
  if (agent === "all") return "all";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

function renderList(
  elements: Elements,
  state: Pick<AppState, "editing" | "filtered" | "prompts" | "selectedId">,
  onSelectPrompt: (promptId: string) => void,
): void {
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

function renderPreview(
  elements: Elements,
  state: Pick<AppState, "agent" | "dirHandle" | "editing" | "saving">,
  prompt: Prompt | null,
  selectedOutput: string,
): void {
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
  if (!state.editing || document.activeElement !== elements.preview) {
    elements.preview.value = selectedOutput;
  }
  elements.preview.readOnly = !state.editing;
  elements.edit.disabled = !state.dirHandle;
  elements.edit.textContent = state.editing ? "Done" : "Edit";
  if (!state.editing && !state.saving) setSaveState(elements, "");
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required popup element: ${selector}`);
  }
  return element;
}
