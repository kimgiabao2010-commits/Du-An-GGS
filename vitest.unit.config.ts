import { defineConfig } from 'vitest/config';
import source from './scripts/test-config.js';
export default defineConfig({...source,test:{...source.test,include:[
  'packages/sdk/tests/**/*.test.ts','packages/auth/tests/**/*.test.ts',
  'packages/cli/tests/**/*.test.tsx','packages/guardrails/tests/**/*.test.ts',
  'packages/persistence/tests/**/*.test.ts','services/ide-reasoning/tests/**/*.test.ts',
  'services/siem-worker/tests/**/*.test.ts',
]}});
