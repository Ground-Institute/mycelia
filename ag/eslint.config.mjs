// "the heavy linting we do elsewhere"
// "with regards to dropping errors"
// "with regards tpo hiding things from the user"
//
// 「[Opus 5.5] What the Rust crates deny (unused_must_use, let_underscore_must_use,」
// 「[Opus 5.5] map_err_ignore), for ag: a failure is never caught and left unsaid.」
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['hooks/sacred-error.ts', '.claude-plugin/**'] },
  {
    files: ['hooks/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'all', args: 'none', varsIgnorePattern: '^h$' }],
      'no-restricted-syntax': ['error',
        { selector: "CatchClause[param=null]", message: 'a caught failure is named and said, never dropped' },
        { selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0]", message: 'a .catch that takes no failure drops it' },
      ],
    },
  },
)
