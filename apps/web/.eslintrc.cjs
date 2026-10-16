/**
 * ESLint for apps/web (`next lint` in CI, `eslint` on staged files in the pre-commit hook).
 *
 * v0.2 S0 tightened this without a mass rewrite: new code lives in `src/features/**` and is held to
 * every rule as an ERROR (docs on exports, import order, accessibility); the v0.1 code elsewhere
 * gets the same rules as WARNINGS until the revamp moves it into a feature folder (#175).
 * See CONTRIBUTING.md, "Lint and format".
 */

/** Import order: node, packages, `@/` app modules, relative, then type-only imports. */
const importOrder = {
  groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
  pathGroups: [{ pattern: '@/**', group: 'internal' }],
  pathGroupsExcludedImportTypes: ['type'],
  'newlines-between': 'always',
};

/** Docs on everything exported: functions, components, hooks, classes, interfaces and types. */
const requireDocs = {
  publicOnly: true,
  // No autofix: `eslint --fix` would insert empty `/** */` stubs that satisfy this rule and say nothing.
  enableFixer: false,
  require: {
    FunctionDeclaration: true,
    ClassDeclaration: true,
    ArrowFunctionExpression: true,
    FunctionExpression: true,
  },
  contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
};

module.exports = {
  root: true,
  extends: ['next/core-web-vitals', 'plugin:jsx-a11y/recommended'],
  plugins: ['@typescript-eslint', 'jsx-a11y', 'jsdoc'],
  settings: { jsdoc: { mode: 'typescript' } },
  rules: {
    // Off before v0.2; warn so new `any`s show up without failing the v0.1 code that has them.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'import/order': ['warn', importOrder],
    'jsdoc/require-jsdoc': ['warn', requireDocs],
  },
  overrides: [
    {
      // Five v0.1 elements break these (measured at 79f637d); each sits in a surface the revamp
      // rewrites. They are errors again everywhere else, src/features included.
      files: ['src/components/**/*.tsx'],
      rules: {
        'jsx-a11y/no-static-element-interactions': 'warn',
        'jsx-a11y/no-noninteractive-element-interactions': 'warn',
        'jsx-a11y/no-interactive-element-to-noninteractive-role': 'warn',
        'jsx-a11y/no-noninteractive-tabindex': 'warn',
      },
    },
    {
      files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
      rules: {
        'import/order': ['error', importOrder],
        'jsdoc/require-jsdoc': ['error', requireDocs],
        'jsdoc/require-description': ['error', { contexts: ['any'] }],
        // TypeScript carries the types; a JSDoc {type} would only drift from it.
        'jsdoc/no-types': 'error',
      },
    },
    {
      // Pure logic and hooks (.ts) document params and returns. Components (.tsx) document their
      // props interface instead, so a destructured `props` needs no @param.
      files: ['src/features/**/*.ts'],
      excludedFiles: ['src/features/**/*.spec.ts', 'src/features/**/*.test.ts'],
      rules: {
        'jsdoc/require-param': ['error', { checkDestructuredRoots: false }],
        'jsdoc/require-param-description': 'error',
        'jsdoc/require-returns': ['error', { publicOnly: true }],
        'jsdoc/require-returns-description': 'error',
      },
    },
    {
      files: ['src/features/**/*.spec.ts', 'src/features/**/*.spec.tsx'],
      rules: { 'jsdoc/require-jsdoc': 'off', 'jsdoc/require-description': 'off' },
    },
  ],
  ignorePatterns: ['public/pdf.worker.min.mjs'],
};
