import { TokenSigner } from '../packages/sdk/src/security/token-signer.ts';

// Explicit operator action only. Output is a credential: never paste into tickets/logs.
const role = process.argv[2];
if (role !== 'cli' && role !== 'ide') throw new Error('Usage: create-agent-token.ts cli|ide');
const token = new TokenSigner().sign({
  agentId: role === 'cli' ? 'cli-worker-agent' : 'ide-worker-agent',
  role: role === 'cli' ? 'CLI_DAEMON' : 'IDE_AGENT', permissions: ['REPORT'],
  timestamp: Date.now(), expiresAt: Date.now() + 3600000
});
process.stdout.write(token + '\n');
