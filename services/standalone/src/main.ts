import 'dotenv/config';
import { CentralCommandOrchestrator } from './command-center.js';
const app = new CentralCommandOrchestrator(Number(process.env.ASQ_PORT ?? 4000));
await app.ready();
console.log('ASQ control server ready');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
