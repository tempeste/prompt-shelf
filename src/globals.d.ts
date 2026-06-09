interface ChromeStorageArea {
  get(keys: string[] | Record<string, unknown> | string | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface ChromeLike {
  storage?: {
    local?: ChromeStorageArea;
  };
}

declare global {
  var chrome: ChromeLike | undefined;

  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export {};
