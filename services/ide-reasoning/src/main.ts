import 'dotenv/config';
import { IdeInvestigatorDaemon } from './engine.js';
const worker = new IdeInvestigatorDaemon();
worker.run();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => worker.stop());
