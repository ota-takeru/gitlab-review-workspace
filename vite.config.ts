import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "media/webview",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "webview/sidebar/main.ts"),
        "review-file": resolve(__dirname, "webview/review-file/main.ts"),
        "commit-diff": resolve(__dirname, "webview/commit-diff/main.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]"
      }
    }
  }
});
