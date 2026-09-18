import { cpSync, mkdirSync } from 'node:fs';
const target = new URL('../packages/sdk/dist/proto/', import.meta.url);
mkdirSync(target, { recursive: true });
cpSync(new URL('../packages/sdk/src/proto/asq-patch.proto', import.meta.url), new URL('asq-patch.proto', target));
