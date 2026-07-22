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
      // module scope with nothing worth asserting. MapLibreLoader.ts is a bare
      // re-export of the bundled maplibregl + its CSS (no branches, no
      // functions) that reports 0% because nothing imports it under `node`
      // tests — excluded rather than left to trip the per-file floor below.
      // MapSeamConformance.ts is type-only and emits no runtime code at all.
      // The *.styles.ts files are bare `css` template literals — no branches,
      // no functions, 100% by construction — so counting them only pads the
      // aggregate without ever being able to fail.
      exclude: [
        "src/index.ts",
        "src/**/*.test.ts",
        "src/**/*.styles.ts",
        "src/types/**",
        "src/vite-env.d.ts",
        "src/maplibre/MapLibreLoader.ts",
        "src/maplibre/MapSeamConformance.ts",
      ],
      // These are *per-file* floors, not aggregate gates: vitest applies
      // `perFile` to every threshold set it resolves, so it is one or the
      // other, and the per-file form is what closes the actual hole — with
      // aggregate-only thresholds a single module can rot to 0% while the rest
      // of the tree carries the average and the gate stays green. Actuals are
      // far above this (~98% statements/lines, ~96% functions, ~91% branches
      // overall); the weakest single file is LayerSwitcherControl.ts at ~80%
      // lines / 75% functions / 76% branches, so the floors sit a few points
      // under that rather than being pinned to today's numbers. Raise them when
      // the weakest file improves; do not lower them to make a red run pass.
      thresholds: {
        perFile: true,
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
      },
    },
  },
});
