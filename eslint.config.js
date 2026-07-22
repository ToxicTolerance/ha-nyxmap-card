import js from "@eslint/js";
import tseslint from "typescript-eslint";
import lit from "eslint-plugin-lit";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Applies project-wide (src, test, dev, config files) — `npm run lint` is
    // `eslint . --max-warnings 0`, matching what tsconfig type-checks. The
    // severity below stays "warn" so an in-progress edit isn't screaming red in
    // an editor, but `--max-warnings 0` means CI still fails on it: eslint exits
    // 0 on warnings otherwise, which would leave release.yml's lint gate unable
    // to fail. Same reasoning covers eslint 9's default-on
    // `reportUnusedDisableDirectives` ("warn"): a stale eslint-disable is a
    // build failure, not a suggestion.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { lit },
    rules: lit.configs.recommended.rules,
  },
  {
    // Type-aware linting over the shipped source. The rules that matter here
    // are no-floating-promises and no-misused-promises: this card is unusually
    // async for its size (the history refresh chain, queueMicrotask,
    // requestAnimationFrame, setInterval, a deferred teardown), and a wave-3
    // fix was exactly a promise chain with no terminating .catch, whose
    // rejections surfaced only as unhandled-rejection warnings. Those are
    // mechanically detectable rather than review-detectable.
    //
    // Scoped to src/** rather than the whole project: type-aware linting needs
    // a TS program, which roughly doubles lint time, and the payoff is in the
    // shipped code. Tests deliberately float promises (fire-and-forget
    // fixtures) and would need per-file noise to pass.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
);
