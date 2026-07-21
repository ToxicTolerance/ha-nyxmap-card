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
    // Deliberately NOT passWithNoTests: a glob or config mistake that collects
    // zero tests must fail, not report a silent green — release.yml gates on
    // this job.
    coverage: {
      // Measure the source we ship, not the bundle or the test scaffolding —
      // an `exclude` alone would drop vitest's own defaults and pull dist/ in.
      include: ["src/**/*.ts"],
      // src/index.ts is the window.customCards registration: side-effecting
      // module scope with nothing worth asserting.
      exclude: ["src/index.ts", "src/**/*.test.ts", "src/types/**", "src/vite-env.d.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
