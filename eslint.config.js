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
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
);
