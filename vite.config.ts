import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(root, "src/popup.ts"),
        "prompt-core": resolve(root, "src/prompt-core.ts"),
      },
      preserveEntrySignatures: "strict",
      output: {
        assetFileNames: "[name][extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "[name].js",
      },
    },
  },
});
