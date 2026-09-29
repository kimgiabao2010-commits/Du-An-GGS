import 'dotenv/config';
import { ControlPlaneServer } from './server.js';

const app = new ControlPlaneServer();
await app.ready();
console.log(`GSS Control Plane ready on http://127.0.0.1:${process.env.CONTROL_PLANE_PORT ?? 4100}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
