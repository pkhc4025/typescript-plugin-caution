import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['dist/', '.yarn/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
]);
