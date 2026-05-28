import { configApp } from '@adonisjs/eslint-config'
export default configApp(
  {},
  {
    ignores: ['.adonisjs/**', 'ace.js', 'server.js', 'scripts/**', 'libs/agent/bridge/**/*.mjs'],
  },
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'prettier/prettier': 'off',
    },
  }
)
