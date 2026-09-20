import 'dotenv/config';
import { SiemWorkerDaemon } from './worker.js';

try {
  const worker = new SiemWorkerDaemon();
  worker.run();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => worker.stop());
} catch (error) {
  console.warn(`[SIEM worker] Disabled safely: ${error instanceof Error ? error.message : 'configuration error'}`);
}
