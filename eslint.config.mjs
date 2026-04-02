import js from "@eslint/js";
import globals from "globals";

/** Browser IIFE scripts — no modules, no bundler. */
export default [
  js.configs.recommended,
  {
    files: ["static/js/**/*.js"],
    ignores: ["static/libs/**"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        ...globals.browser,
        VideoEditor: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
      // Legacy `catch (e) {}` cleanup is a separate pass
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
