import { test } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { serviceEnvironment } from '../scripts/service-environment.mjs';
import { resolve } from 'node:path';

test('launcher gives every child only its intended secret scope and prevents dotenv rehydration', () => {
  const parent = { DATABASE_URL: 'test-db-secret', DATABASE_SSL: 'true', GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64: 'test-signing-secret',
    GSS_CONTROL_PLANE_TOKEN: 'test-control-secret', OPENAI_API_KEY: 'test-model-secret', GROQ_API_KEY: 'test-model-secret',
    GOOGLE_APPLICATION_CREDENTIALS: 'test-google-credential-path', GSS_CHRONICLE_PROJECT: 'test-project', ASQ_JWT_SECRET: 'test-local-demo-secret' };
  for (const name of ['Control Plane', 'Command Center', 'CLI worker', 'IDE agent', 'SIEM worker', 'Web UI']) {
    const env = serviceEnvironment(parent, name);
    dotenv.config({ path: env.DOTENV_CONFIG_PATH, processEnv: env, quiet: true });
    assert.equal(Boolean(env.DATABASE_URL), name === 'Control Plane');
    assert.equal(Boolean(env.GSS_ARTIFACT_SIGNING_PRIVATE_KEY_BASE64), name === 'Control Plane');
    assert.equal(Boolean(env.GSS_CONTROL_PLANE_TOKEN), ['Control Plane', 'Command Center'].includes(name));
    assert.equal(Boolean(env.OPENAI_API_KEY), name === 'Command Center');
    assert.equal(Boolean(env.GOOGLE_APPLICATION_CREDENTIALS), name === 'SIEM worker');
    assert.equal(Boolean(env.GSS_CHRONICLE_PROJECT), name === 'SIEM worker');
    assert.equal(env.ASQ_JWT_SECRET, parent.ASQ_JWT_SECRET);
  }
  assert.equal(parent.DATABASE_URL, 'test-db-secret');
});

test('launcher scopes durable result journals to distinct workers, never UI or authority', () => {
  const parent = { GSS_DATA_DIR: resolve('data'), GSS_WORKER_SPOOL_DIR: 'untrusted-shared-spool' };
  const expected = { 'CLI worker': 'cli', 'IDE agent': 'ide', 'SIEM worker': 'siem' };
  for (const name of ['Control Plane', 'Command Center', 'CLI worker', 'IDE agent', 'SIEM worker', 'Web UI']) {
    const env = serviceEnvironment(parent, name);
    assert.equal(env.GSS_WORKER_SPOOL_DIR, expected[name] ? resolve(parent.GSS_DATA_DIR, 'worker-spool', expected[name]) : undefined);
  }
});
test('verify-only workers receive no signing secret, gateway or artifact cloud credentials', () => {
  const parent = { ASQ_JWT_SECRET:'secret',GSS_TASK_PUBLIC_KEY_BASE64:'public',GSS_TASK_PRIVATE_KEY_BASE64:'private',
    GSS_TASK_KEY_ID:'test',GSS_UI_GATEWAY_TOKEN:'gateway',AWS_SECRET_ACCESS_KEY:'cloud-secret',GSS_S3_BUCKET:'bucket' };
  for (const name of ['CLI worker','IDE agent','SIEM worker']) {
    const env = serviceEnvironment(parent,name);
    assert.equal(env.ASQ_JWT_SECRET,undefined); assert.equal(env.GSS_TASK_PRIVATE_KEY_BASE64,undefined);
    assert.equal(env.GSS_TASK_PUBLIC_KEY_BASE64,'public'); assert.equal(env.GSS_UI_GATEWAY_TOKEN,undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY,undefined);
  }
  assert.equal(serviceEnvironment(parent,'Control Plane').GSS_TASK_PRIVATE_KEY_BASE64,'private');
  assert.equal(serviceEnvironment(parent,'Web UI').GSS_UI_GATEWAY_TOKEN,'gateway');
  assert.equal(serviceEnvironment(parent,'Command Center').AWS_SECRET_ACCESS_KEY,'cloud-secret');
});
test('each worker receives only its own bearer identity', () => {
  const parent = { ASQ_WORKER_TOKEN:'cli',ASQ_IDE_TOKEN:'ide',ASQ_SIEM_TOKEN:'siem' };
  const names = { 'CLI worker':'ASQ_WORKER_TOKEN','IDE agent':'ASQ_IDE_TOKEN','SIEM worker':'ASQ_SIEM_TOKEN' };
  for (const name of ['Control Plane','Command Center','Web UI',...Object.keys(names)]) {
    const env = serviceEnvironment(parent,name);
    for (const key of Object.keys(parent)) assert.equal(env[key], names[name] === key ? parent[key] : undefined);
  }
});
test('launcher selects service-specific TLS private key paths',()=>{
  const parent={GSS_TLS_KEY_FILE:'unscoped-secret',GSS_TLS_CONTROL_KEY_FILE:'control-secret',GSS_TLS_CLI_KEY_FILE:'cli-secret',GSS_TLS_CA_FILE:'public-ca'};
  assert.equal(serviceEnvironment(parent,'Control Plane').GSS_TLS_KEY_FILE,'control-secret');
  assert.equal(serviceEnvironment(parent,'CLI worker').GSS_TLS_KEY_FILE,'cli-secret');
  assert.equal(serviceEnvironment(parent,'Web UI').GSS_TLS_KEY_FILE,undefined);
  assert.equal(serviceEnvironment(parent,'CLI worker').GSS_TLS_CONTROL_KEY_FILE,undefined);
});
test('only Control Plane receives the authoritative model budget policy',()=>{
  const parent={GSS_MODEL_BUDGET_POLICY_JSON:'fixture-policy'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI']) {
    assert.equal(serviceEnvironment(parent,name).GSS_MODEL_BUDGET_POLICY_JSON,name==='Control Plane'?'fixture-policy':undefined);
  }
});
test('public workload pin policy remains server-only, not in workers or Web UI',()=>{
  const parent={GSS_TLS_WORKLOAD_POLICY_FILE:'operator-owned-public-policy.json',GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION:'true'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI']) {
    assert.equal(serviceEnvironment(parent,name).GSS_TLS_WORKLOAD_POLICY_FILE,
      ['Control Plane','Command Center'].includes(name)?parent.GSS_TLS_WORKLOAD_POLICY_FILE:undefined);
    assert.equal(serviceEnvironment(parent,name).GSS_REQUIRE_DURABLE_WORKLOAD_REVOCATION,
      ['Control Plane','Command Center'].includes(name)?'true':undefined);
  }
});
