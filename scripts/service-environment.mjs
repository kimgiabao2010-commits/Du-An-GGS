import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Child services must not reload the privileged workspace .env after filtering. */
export function serviceEnvironment(runtimeEnv, name) {
  const env = { ...runtimeEnv, TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_PREFER_TS_EXTS: 'true',
    DOTENV_CONFIG_PATH: fileURLToPath(new URL('./runtime-child.env', import.meta.url)) };
  const worker = { 'CLI worker': 'cli', 'IDE agent': 'ide', 'SIEM worker': 'siem' }[name];
  if (['lab','replay'].includes(runtimeEnv.GSS_SOC_PROFILE)) {
    delete env.OPENAI_API_KEY; delete env.GROQ_API_KEY;
  }
  const ownToken = { cli: 'ASQ_WORKER_TOKEN', ide: 'ASQ_IDE_TOKEN', siem: 'ASQ_SIEM_TOKEN' }[worker];
  for (const key of ['ASQ_WORKER_TOKEN','ASQ_IDE_TOKEN','ASQ_SIEM_TOKEN']) if (key !== ownToken) delete env[key];
  // Explicit service-specific TLS key paths; never inherit another service's key.
  const tlsPrefix = { 'Control Plane':'CONTROL','Command Center':'COMMAND','CLI worker':'CLI','IDE agent':'IDE','SIEM worker':'SIEM','Web UI':'UI' }[name];
  for (const suffix of ['CERT_FILE','KEY_FILE']) {
    delete env['GSS_TLS_'+suffix];
    if (tlsPrefix && runtimeEnv['GSS_TLS_'+tlsPrefix+'_'+suffix]) env['GSS_TLS_'+suffix]=runtimeEnv['GSS_TLS_'+tlsPrefix+'_'+suffix];
  }
  for (const key of Object.keys(env)) if (/^GSS_TLS_(CONTROL|COMMAND|CLI|IDE|SIEM|UI)_(CERT|KEY)_FILE$/.test(key)) delete env[key];
  delete env.GSS_WORKER_SPOOL_DIR;
  if (worker && runtimeEnv.GSS_DATA_DIR) env.GSS_WORKER_SPOOL_DIR = resolve(runtimeEnv.GSS_DATA_DIR, 'worker-spool', worker);
  if (name !== 'Control Plane') {
    delete env.GSS_LAB_OWN_DEVICE_AUTHORIZED; delete env.GSS_LAB_ALLOWED_SOURCES;
    delete env.GSS_MODEL_BUDGET_POLICY_JSON;
    delete env.DATABASE_URL; delete env.DATABASE_SSL; delete env.GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64;
    delete env.GSS_TASK_PRIVATE_KEY_BASE64;
  }
  if (worker && env.GSS_TASK_PUBLIC_KEY_BASE64) delete env.ASQ_JWT_SECRET;
  if (name !== 'Control Plane' && name !== 'Command Center') delete env.GSS_CONTROL_PLANE_TOKEN;
  if (name !== 'Control Plane' && name !== 'Command Center') delete env.GSS_TLS_WORKLOAD_POLICY_FILE;
  if (name !== 'Control Plane' && name !== 'Command Center') delete env.GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION;
  if (name !== 'Control Plane' && name !== 'Web UI') delete env.GSS_UI_GATEWAY_TOKEN;
  if (name !== 'Command Center') {
    delete env.OPENAI_API_KEY; delete env.GROQ_API_KEY;
    for (const key of Object.keys(env)) if (key.startsWith('AWS_') || key.startsWith('GSS_S3_')) delete env[key];
  }
  if (name === 'Web UI') for (const key of Object.keys(env)) if (key.startsWith('OTEL_')) delete env[key];
  if (name !== 'SIEM worker') {
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    for (const key of Object.keys(env)) if (key.startsWith('GSS_CHRONICLE_')) delete env[key];
  }
  return env;
}
