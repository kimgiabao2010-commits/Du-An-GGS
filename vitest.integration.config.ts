import { mergeConfig } from 'vitest/config';
import source from './scripts/test-config.js';
export default mergeConfig(source, { test: { include: ['tests/integration/**/*.test.ts'] } });
