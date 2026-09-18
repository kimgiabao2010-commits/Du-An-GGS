import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  plugins: [{
    name: 'asq-typescript-source', enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@asq/sdk') return resolve(root, 'packages/sdk/src/index.ts');
      if (source === '@asq/guardrails') return resolve(root, 'packages/guardrails/src/index.ts');
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const path = resolve(dirname(importer.split('?')[0]), source.slice(0, -3));
      for (const ext of ['.ts', '.tsx']) if (existsSync(path + ext)) return path + ext;
      return null;
    }
  }],
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], testTimeout: 10000 }
});
