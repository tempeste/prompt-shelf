import { loadPrompt } from "./prompt-core";
import type { DirectoryHandle, FileAccessMode, FileHandle, PermissionCheck, Prompt } from "./types";

export async function chooseDirectory(): Promise<DirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder picker is not available in this browser.");
  }
  return (await window.showDirectoryPicker({ mode: "read" })) as DirectoryHandle;
}

export async function ensureDirectoryPermission(
  handle: DirectoryHandle,
  { request, mode = "read" }: { request: boolean; mode?: FileAccessMode },
): Promise<PermissionCheck> {
  const options = { mode };
  const current = await handle.queryPermission(options);
  if (current === "granted") return { ok: true, state: current };
  if (!request) return { ok: false, state: current };
  try {
    const next = await handle.requestPermission(options);
    return { ok: next === "granted", state: next };
  } catch (error) {
    if (errorName(error) === "SecurityError") return { ok: false, state: "activation-required" };
    throw error;
  }
}

export function permissionStatus(
  permissionState: PermissionCheck["state"],
  { quiet, hasPrompts }: { quiet: boolean; hasPrompts: boolean },
): string {
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

export function writePermissionStatus(permissionState: PermissionCheck["state"]): string {
  if (permissionState === "activation-required") {
    return "Chrome needs a direct click to enable editing. Press Edit again.";
  }
  if (permissionState === "denied") {
    return "Chrome did not grant write access. Editing stays off.";
  }
  return "Write access was not granted. Editing stays off.";
}

export async function readPromptsFromDirectory(handle: DirectoryHandle): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file" || !name.toLowerCase().endsWith(".md") || name === "README.md") {
      continue;
    }
    const file = await (entry as FileHandle).getFile();
    const text = await file.text();
    prompts.push(loadPrompt(name, text));
  }

  prompts.sort((left, right) => left.name.localeCompare(right.name));
  return prompts;
}

export async function writePromptFile(
  handle: DirectoryHandle,
  fileName: string,
  nextRawText: string,
): Promise<void> {
  const fileHandle = (await handle.getFileHandle(fileName)) as FileHandle;
  const writable = await fileHandle.createWritable();
  await writable.write(nextRawText);
  await writable.close();
}

function errorName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name;
  if (typeof error === "object" && error && "name" in error) {
    return String(error.name);
  }
  return null;
}
