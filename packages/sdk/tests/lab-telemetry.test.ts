import { describe, it, expect, vi } from 'vitest';
import { LlmRouter } from '../../../services/standalone/src/agent/llm-router.js';
import { LabTelemetryAdapter, validateLabBatch, labBatchHash, labObservation, labReport, socProfile,
  isInvestigationEvidence, correlateEvidence, reduceEvidenceFrontier, type LabBatch, type InvestigationRequest } from '../src/index.js';
const hostId='host-'+'a'.repeat(64);
const batch=():LabBatch=>({schemaVersion:'gss.lab-telemetry.v1',sourceId:'local-windows',sourceKind:'REPLAY',collectedAt:'2026-10-09T01:00:00Z',
  truncated:false,events:[{recordId:'1',eventCode:1001,channel:'System',provider:'Test provider',eventTime:'2026-10-09T00:00:00+00:00',hostId,level:2}]});
const request=():InvestigationRequest=>({incidentId:'case-1',taskId:'task-1',idempotencyKey:'key-1',requestedBy:'test',indicator:{type:'HOSTNAME',value:hostId},timeRange:{start:'2026-10-08T00:00:00Z',end:'2026-10-10T00:00:00Z'}});
const adapter=(b=batch())=>new LabTelemetryAdapter(b,labBatchHash(b),'artifact://lab/'+labBatchHash(b)+'.json');
describe('lab telemetry is bounded, explicit and distinct from Chronicle',()=>{
  it('preserves timestamps/lineage and emits versioned evidence usable by the existing validator',async()=>{
    const ev=await adapter().investigate(request());
    expect(isInvestigationEvidence(ev,{incidentId:'case-1',taskId:'task-1'})).toBe(true);
    expect(ev.provenance).toMatchObject({adapter:'lab-windows-events',sourceKind:'REPLAY',schemaVersion:'gss.evidence-provenance.v2'});
    expect(isInvestigationEvidence({...ev,provenance:{...ev.provenance,adapter:['lab-windows-events']}})).toBe(false);
    expect(isInvestigationEvidence({...ev,provenance:{...ev.provenance,sourceKind:['REPLAY']}})).toBe(false);
    expect(ev.events[0].eventTime).toBe('2026-10-09T00:00:00+00:00');
  });
  it('cannot infer benign or confirmed from nonempty lab metadata',async()=>expect(correlateEvidence(await adapter().investigate(request())).verdict).toBe('INSUFFICIENT_EVIDENCE'));
  it('zero results retain truthful query provenance and do not fabricate an event',async()=>{
    const ev=await adapter().investigate({...request(),indicator:{type:'HOSTNAME',value:'host-'+'b'.repeat(64)}});
    expect(ev.eventIds).toEqual([]);expect(ev.events).toEqual([]);expect(correlateEvidence(ev).verdict).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('rejects secret/payload fields and invalid scalar types rather than silently dropping them',()=>{
    expect(()=>validateLabBatch({...batch(),password:'secret'})).toThrow('Unexpected');
    expect(()=>validateLabBatch({...batch(),sourceId:123})).toThrow('Invalid');
    expect(()=>validateLabBatch({...batch(),sourceKind:['REPLAY']})).toThrow('Invalid');
    expect(()=>validateLabBatch({...batch(),events:[{...batch().events[0],channel:['System']}]})).toThrow('Invalid');
    expect(()=>validateLabBatch({...batch(),events:[{...batch().events[0],Message:'secret'}]})).toThrow('Unexpected');
  });
  it('rejects missing timezone, duplicate event lineage and oversized collection',()=>{
    expect(()=>validateLabBatch({...batch(),collectedAt:'2026-10-09'})).toThrow();
    expect(()=>validateLabBatch({...batch(),events:[batch().events[0],batch().events[0]]})).toThrow('Duplicate');
    expect(()=>validateLabBatch({...batch(),events:Array(1001).fill(batch().events[0])})).toThrow();
  });
  it('checks hash and cancellation before emitting evidence',async()=>{
    expect(()=>new LabTelemetryAdapter(batch(),'b'.repeat(64),'artifact://fake')).toThrow('hash mismatch');
    const abort=new AbortController();abort.abort();await expect(adapter().investigate(request(),abort.signal)).rejects.toThrow();
  });
  it('bounds range, result count, supported indicator and missing parameters',async()=>{
    await expect(adapter().investigate({...request(),limit:101})).rejects.toThrow();
    await expect(adapter().investigate({...request(),indicator:{type:'IP',value:'203.0.113.1'}})).rejects.toThrow();
    await expect(adapter().investigate({...request(),timeRange:{start:'2026-01-01T00:00:00Z',end:'2026-10-09T00:00:00Z'}})).rejects.toThrow();
    await expect(adapter().investigate({...request(),indicator:undefined as any})).rejects.toThrow('Invalid bounded');
  });
  it('sorts timeline and retains both collection and query truncation',async()=>{
    const b=batch();b.events.push({...b.events[0],recordId:'2',eventTime:'2026-10-08T23:00:00Z'});
    const ev=await adapter(b).investigate({...request(),limit:1});expect(ev.events[0].recordId).toBe('2');expect(ev.provenance.truncated).toBe(true);
    expect((await adapter({...batch(),truncated:true}).investigate(request())).provenance.truncated).toBe(true);
  });
  it('report fact claims carry evidence/event references and Frontier task/artifact provenance',async()=>{
    const ev=await adapter().investigate(request()),observation=labObservation(ev);
    const frontier=reduceEvidenceFrontier({runId:'run-1',caseId:'case-1',observation,source:'REPLAY:local-windows',artifactHash:labBatchHash(batch())});
    const report=labReport(ev,frontier);expect(report.timeline[0]).toMatchObject({evidenceId:ev.evidenceId,eventId:ev.eventIds[0]});
    expect(frontier.facts[0].provenance[0]).toMatchObject({taskId:'task-1',artifactHash:labBatchHash(batch())});
    expect(()=>labReport(ev,{...frontier,evidenceRefs:[]})).toThrow('lineage');
  });
  it('staging cannot bypass its hard gates using lab/replay profile',()=>{
    expect(socProfile({})).toBe('staging');
    expect(()=>socProfile({GSS_RUNTIME_ENV:'staging',GSS_SOC_PROFILE:'lab'})).toThrow();
    expect(()=>socProfile({GSS_SOC_PROFILE:'invalid'})).toThrow();
    expect(socProfile({GSS_RUNTIME_ENV:'local',GSS_SOC_PROFILE:'lab'})).toBe('lab');
  });
  it('lab disables external provider even when a key exists; no paid fallback',async()=>{
    vi.stubEnv('GSS_SOC_PROFILE','lab');vi.stubEnv('GSS_RUNTIME_ENV','local');vi.stubEnv('OPENAI_API_KEY','fixture-not-real');
    try {expect(await new LlmRouter().routePrompt('Summarize an unknown case')).toMatchObject({agent:'system',instruction:expect.stringContaining('LOCAL_REASONING_UNAVAILABLE')});}
    finally {vi.unstubAllEnvs();}
  });
});
