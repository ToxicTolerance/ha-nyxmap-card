/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Lit/reactive-element and other libs ship a Node-conditioned build (for
  // SSR) that pulls in @lit-labs/ssr-dom-shim instead of using real DOM
  // globals. We only ever target browsers (HA custom card) — forcing the
  // "browser" condition picks the right build both for the production
  // bundle and for Vitest's jsdom environment (without this, jsdom tests
  // that touch Lit components fail with a ssr-dom-shim localStorage error).
  resolve: {
    conditions: ["browser"],
  },
  server: {
    open: "/dev/harness.html",
  },
  build: {
    lib: {
      entry: resolvePath("src/index.ts"),
      name: "NyxmapCard",
      formats: ["es"],
      fileName: () => "nyxmap-card.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    passWithNoTests: true,
  },
});
