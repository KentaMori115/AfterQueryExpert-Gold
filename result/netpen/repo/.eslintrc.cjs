/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    '@vue/eslint-config-typescript',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.app.json', './tsconfig.node.json'],
    extraFileExtensions: ['.vue'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['import'],
  settings: {
    'import/resolver': {
      typescript: { project: ['./tsconfig.app.json', './tsconfig.node.json'] },
    },
  },
  rules: {
    // Single word component names are fine for a route view, which is the
    // only place they occur here, and renaming them to satisfy the rule makes
    // the router table read worse than the components it points at.
    'vue/multi-word-component-names': 'off',
    'vue/component-api-style': ['error', ['script-setup']],
    'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],
    'vue/no-unused-refs': 'error',
    'vue/prefer-true-attribute-shorthand': 'error',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'import/order': [
      'error',
      {
        groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
        pathGroups: [
          { pattern: '@/**', group: 'internal' },
          { pattern: '@tests/**', group: 'internal' },
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    // consistent-type-imports splits a type import onto its own line, and
    // no-duplicates then merges the two back together and folds the value
    // import into the type one. The pair silently deletes working imports,
    // so only one of them gets to have an opinion.
    'import/no-duplicates': 'off',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    curly: ['error', 'multi-line'],
  },
  overrides: [
    {
      // The domain and the data layer must never read the clock. Everything
      // there takes the instant it acts on, which is what makes a pinned test
      // and a reproducible export possible.
      files: ['src/domain/**/*.ts', 'src/data/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='Date'][property.name='now']",
            message: 'Take the instant as an argument rather than reading the clock here.',
          },
        ],
      },
    },
    {
      files: ['tests/**/*.ts', 'tests/**/*.vue'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.cjs'],
};
