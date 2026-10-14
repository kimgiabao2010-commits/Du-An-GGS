import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedModelConfig,startManagedModel} from '../scripts/local-model-runtime.mjs';
import {resolve} from 'node:path';
const good={GSS_LOCAL_MODEL_MANAGED:'true',GSS_LOCAL_CONVERSATION_ENABLED:'true',GSS_SOC_PROFILE:'lab',GSS_RUNTIME_ENV:'local',
  GSS_LOCAL_MODEL_CANDIDATE_FILE:resolve('data/models/fixture-candidate.json'),GSS_LOCAL_MODEL_CANDIDATE_SHA256:'a'.repeat(64),
  GSS_LOCAL_CONVERSATION_MODEL:'fixture-local-model',GSS_LOCAL_MODEL_URL:'http://127.0.0.1:8080/v1/chat/completions'};
test('owned local model remains opt-in and rejects profile/endpoint/pin/alias injection before assets or execution',()=>{
  assert.equal(managedModelConfig({}),null);
  const unsupported=process.platform!=='win32'||process.arch!=='x64';
  if(unsupported){assert.throws(()=>managedModelConfig(good),/platform/);return;}
  assert.equal(managedModelConfig(good).model,'fixture-local-model');
  for(const patch of [{GSS_RUNTIME_ENV:'staging'},{GSS_SOC_PROFILE:'staging'},{GSS_LOCAL_CONVERSATION_ENABLED:'false'},
    {GSS_LOCAL_MODEL_CANDIDATE_SHA256:'bad'},{GSS_LOCAL_MODEL_CANDIDATE_FILE:'\\\\host\\share\\candidate.json'},
    {GSS_LOCAL_MODEL_URL:'http://localhost:8080/v1/chat/completions'},{GSS_LOCAL_MODEL_URL:'http://0.0.0.0:8080/v1/chat/completions'},
    {GSS_LOCAL_MODEL_URL:'https://api.example/v1/chat/completions'},{GSS_LOCAL_MODEL_URL:'http://127.0.0.1:8080/admin'},
    {GSS_LOCAL_CONVERSATION_MODEL:'model --bad-flag'}])assert.throws(()=>managedModelConfig({...good,...patch}));
});
test('disabled native manager never opens, launches or adopts a provider',async()=>{assert.equal(await startManagedModel({}),null);});
