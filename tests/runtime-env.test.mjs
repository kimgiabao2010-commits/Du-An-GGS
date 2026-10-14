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

test('only Control Plane receives bounded-dispatch authority; environment cannot grant it to UI/workers',()=>{
  const parent={GSS_BOUNDED_DISPATCH:'true'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI'])
    assert.equal(serviceEnvironment(parent,name).GSS_BOUNDED_DISPATCH,name==='Control Plane'?'true':undefined);
});
test('ATTACK catalog path/pin are Control Plane-only and cannot leak to UI/worker/conversation environments',()=>{
  const parent={GSS_ATTACK_CATALOG_FILE:'private-catalog.json',GSS_ATTACK_CATALOG_SHA256:'a'.repeat(64)};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI'])
    for(const key of Object.keys(parent))assert.equal(serviceEnvironment(parent,name)[key],name==='Control Plane'?parent[key]:undefined);
});
test('local model bearer belongs only to Conversation; native candidate control remains launcher-only',()=>{
  const parent={GSS_LOCAL_MODEL_API_KEY:'fixture-provider-key',GSS_LOCAL_MODEL_MANAGED:'true',
    GSS_LOCAL_MODEL_CANDIDATE_FILE:'private-assets',GSS_LOCAL_MODEL_CANDIDATE_SHA256:'a'.repeat(64),GSS_LOCAL_MODEL_ASSET_DIR:'private-models'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI']){
    const env=serviceEnvironment(parent,name);
    assert.equal(env.GSS_LOCAL_MODEL_API_KEY,name==='Command Center'?parent.GSS_LOCAL_MODEL_API_KEY:undefined);
    for(const key of ['GSS_LOCAL_MODEL_MANAGED','GSS_LOCAL_MODEL_CANDIDATE_FILE','GSS_LOCAL_MODEL_CANDIDATE_SHA256','GSS_LOCAL_MODEL_ASSET_DIR'])assert.equal(env[key],undefined);
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
test('only Control Plane receives hypothesis policy activation and SIEM authorization',()=>{
  const parent={GSS_INVESTIGATION_POLICY:'gss.soc-evidence.v1',GSS_SOC_SIEM_READ_ONLY_AUTHORIZED:'true'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI']) {
    for(const key of Object.keys(parent)) assert.equal(serviceEnvironment(parent,name)[key],name==='Control Plane'?parent[key]:undefined);
  }
});

test('local model configuration reaches only the conversation service',()=>{
  const parent={GSS_LOCAL_CONVERSATION_ENABLED:'true',GSS_LOCAL_MODEL_URL:'http://127.0.0.1:8080/v1/chat/completions',GSS_LOCAL_CONVERSATION_MODEL:'fixture'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI']) {
    for(const key of Object.keys(parent)) assert.equal(serviceEnvironment(parent,name)[key],name==='Command Center'?parent[key]:undefined);
  }
});
test('offline-intel path and reviewed pin reach only Control Plane, never browser/workers',()=>{
  const parent={GSS_OFFLINE_INTEL_CATALOG_FILE:'private.json',GSS_OFFLINE_INTEL_CATALOG_SHA256:'fixture-pin'};
  for(const name of ['Control Plane','Command Center','CLI worker','IDE agent','SIEM worker','Web UI'])
    for(const key of Object.keys(parent))assert.equal(serviceEnvironment(parent,name)[key],name==='Control Plane'?parent[key]:undefined);
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
