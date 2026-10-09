import 'dotenv/config';
import { SiemWorkerDaemon } from './worker.js';
import { socProfile } from '@asq/sdk';

try {
  if (socProfile() !== 'staging') throw new Error('Lab/replay uses explicit Control Plane telemetry queries; Chronicle worker not started.');
  const worker = new SiemWorkerDaemon();
  worker.run();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => worker.stop());
} catch (error) {
  console.warn(`[SIEM worker] Disabled safely: ${error instanceof Error ? error.message : 'configuration error'}`);
}
