import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Same single source of truth the build uses, so tests exercise the real
// version rather than a hardcoded copy that could silently drift.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  define: { __EXTENSION_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
});
