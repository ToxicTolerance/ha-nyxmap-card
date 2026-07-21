import js from "@eslint/js";
import tseslint from "typescript-eslint";
import lit from "eslint-plugin-lit";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Applies project-wide (src, test, dev, config files) — `npm run lint` is
    // `eslint .`, matching what tsconfig type-checks.
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
