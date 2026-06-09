export type Agent = "codex" | "claude" | "all";
export type FileAccessMode = "read" | "readwrite";
export type DirectoryPermissionState = PermissionState | "activation-required";

export type FrontMatterValue = string | string[];
export type FrontMatter = Record<string, FrontMatterValue>;

export interface Prompt {
  id: string;
  fileName: string;
  rawText: string;
  frontMatter: string;
  bodySource: string;
  name: string;
  description: string;
  whenToUse: string;
  tags: string[];
  body: string;
}

export interface PromptCache {
  folderName: string;
  lastSyncedAt: string | null;
  prompts: Prompt[];
}

export interface StoredSettings {
  agent?: Agent;
  lastFolderName?: string;
  lastSyncedAt?: string | null;
}

export interface PermissionCheck {
  ok: boolean;
  state: DirectoryPermissionState;
}

export interface AppState {
  agent: Agent;
  dirHandle: DirectoryHandle | null;
  prompts: Prompt[];
  filtered: Prompt[];
  selectedId: string | null;
  query: string;
  lastSyncedAt: string | null;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
}

export interface Elements {
  agent: HTMLSelectElement;
  chooseFolder: HTMLButtonElement;
  content: HTMLElement;
  copy: HTMLButtonElement;
  edit: HTMLButtonElement;
  emptyState: HTMLElement;
  folderLabel: HTMLElement;
  list: HTMLElement;
  preview: HTMLTextAreaElement;
  promptCount: HTMLElement;
  promptDescription: HTMLElement;
  promptTitle: HTMLElement;
  refresh: HTMLButtonElement;
  saveState: HTMLElement;
  search: HTMLInputElement;
  status: HTMLElement;
  syncTime: HTMLElement;
}

export type DirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
  queryPermission(options?: { mode?: FileAccessMode }): Promise<PermissionState>;
  requestPermission(options?: { mode?: FileAccessMode }): Promise<PermissionState>;
};

export type FileHandle = FileSystemFileHandle & {
  createWritable(): Promise<FileSystemWritableFileStream>;
};
