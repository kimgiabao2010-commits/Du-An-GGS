import 'dotenv/config';
import { CliWorkerDaemon } from './worker.js';
const worker = new CliWorkerDaemon();
worker.run();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => worker.stop());
