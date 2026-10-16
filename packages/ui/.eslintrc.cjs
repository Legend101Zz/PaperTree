/**
 * ESLint for @papertree/ui: docs only. oxlint (`lint`) does the rest; it has no rule that requires
 * a doc comment, and every component here is shared, so every export is documented (v0.2 S0).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['jsdoc'],
  settings: { jsdoc: { mode: 'typescript' } },
  ignorePatterns: ['**/*.spec.ts', '**/*.spec.tsx', 'test/**'],
  rules: {
    'jsdoc/require-jsdoc': [
      'error',
      {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: true,
          FunctionExpression: true,
        },
        contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
      },
    ],
    'jsdoc/require-description': ['error', { contexts: ['any'] }],
    'jsdoc/no-types': 'error',
  },
};
