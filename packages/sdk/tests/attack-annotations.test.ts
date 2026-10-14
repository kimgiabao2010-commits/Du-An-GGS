import {it,describe,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadAttackKnowledge} from '../../../services/control-plane/src/attack-knowledge.ts';
import {importAttackKnowledge,isAttackKnowledge,buildEvidenceAttack,isEvidenceAttack,annotateCaseAttack,sha256Canonical,
  type InvestigationEvidence} from '../src/index.ts';

const now='2026-10-14T10:00:00Z',commit='a'.repeat(40);
function bundle(){return {type:'bundle',objects:[{type:'attack-pattern',id:'attack-pattern--12345678-1234-1234-1234-123456789012',
  name:'Fixture technique, not SOC assessment',x_mitre_version:'1.0',x_mitre_domains:['enterprise-attack'],
  external_references:[{source_name:'mitre-attack',external_id:'T1110',url:'https://attack.mitre.org/techniques/T1110/'}],
  kill_chain_phases:[{kill_chain_name:'mitre-attack',phase_name:'credential-access'}]}]};}
function options(){return {version:'20.0',commit,bundleSha256:'b'.repeat(64),licenseSha256:'c'.repeat(64),
  reviewedAt:'2026-10-14T00:00:00Z',expiresAt:'2026-12-01T00:00:00Z',reviewOwner:'FIXTURE_NOT_INDEPENDENT_REVIEW'};}
function catalog(){return importAttackKnowledge(bundle(),options());}
function evidence(labels:unknown[]=['T1110']):InvestigationEvidence{return {incidentId:'fixture-case',taskId:'fixture-task',evidenceId:'fixture-evidence',
  eventIds:['fixture-event'],events:[{metadata:{event_timestamp:'2026-10-14T09:00:00Z'},principal:{user:{userid:'fixture-user'},ip:['203.0.113.1']},
    security_result:labels.map(threat_name=>({threat_name}))}],provenance:{adapter:'google-chronicle',adapterVersion:'v1',
      queryHash:'d'.repeat(64),sourceInstance:'FIXTURE_NOT_LIVE_CHRONICLE',queriedAt:now,timeRange:{start:'2026-10-14T08:00:00Z',end:now},
      resultCount:1,truncated:false,redaction:'ALLOWLISTED_FIELDS_ONLY'}};}
const projection=(e=evidence())=>buildEvidenceAttack(e,createHash('sha256').update(JSON.stringify(e)).digest('hex'));
const coverage={completedQueryCount:1,unprojectedQueryCount:0,omittedProjectionCount:0};
describe('versioned ATTACK literal-label annotations, never facts/verdict',()=>{
  it('runs the private pinned importer CLI, preserves the license, and never activates runtime or prints malformed content',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gss-attack-cli-fixture-'));
    try{const folder=join(root,'knowledge');await mkdir(folder);
      const input=join(folder,'bundle.json'),notice=join(folder,'LICENSE.txt'),raw=JSON.stringify(bundle()),license='FIXTURE LICENSE ONLY, NOT MITRE ATTESTATION';
      await writeFile(input,raw);await writeFile(notice,license);
      const pin=(s:string)=>createHash('sha256').update(s).digest('hex');
      const args=[input,pin(raw),notice,pin(license),'20.0',commit,'FIXTURE_CLI_NOT_REVIEW','2027-01-01T00:00:00Z','--local-authorized'];
      const call=(a:string[])=>spawnSync(process.execPath,[resolve('scripts/import-attack.mjs'),...a],{
        env:{...process.env,GSS_DATA_DIR:root},encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1000000});
      const r=call(args);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({status:'PASS_NORMALIZED_IMPORT',
        runtimeActivated:false,socQuality:'NOT RUN',sourceAuthentication:'OPERATOR_PIN_NOT_SIGNATURE',techniqueCount:1});
      expect(r.stdout).not.toContain('Fixture technique');
      const bad='{"SENSITIVE_ATTACK_FIXTURE": BROKEN_JSON';await writeFile(input,bad);args[1]=pin(bad);
      const rejected=call(args);expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('Content omitted');
      expect(rejected.stderr).not.toContain('SENSITIVE_ATTACK_FIXTURE');
      expect(call(args.slice(0,-1)).status).not.toBe(0);
    }finally{await rm(root,{recursive:true,force:true});}
  },35000);
  it('loads only bounded private pinned catalogs and suppresses malformed content/path escapes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'gss-attack-fixture-'));
    try{await mkdir(join(root,'knowledge'));const file=join(root,'knowledge','catalog.json'),raw=JSON.stringify(catalog());
      await writeFile(file,raw);const env={GSS_DATA_DIR:root,GSS_ATTACK_CATALOG_FILE:file,GSS_ATTACK_CATALOG_SHA256:createHash('sha256').update(raw).digest('hex')};
      expect(await loadAttackKnowledge(env)).toEqual(catalog());expect(await loadAttackKnowledge({})).toBeUndefined();
      await expect(loadAttackKnowledge({...env,GSS_ATTACK_CATALOG_SHA256:'0'.repeat(64)})).rejects.toThrow('pin');
      const outside=join(root,'outside.json');await writeFile(outside,raw);
      await expect(loadAttackKnowledge({...env,GSS_ATTACK_CATALOG_FILE:outside})).rejects.toThrow('root');
      await expect(loadAttackKnowledge({...env,GSS_ATTACK_CATALOG_FILE:'\\\\host\\share\\catalog.json'})).rejects.toThrow('path');
      const bad='{"SENSITIVE_FIXTURE_TEXT": BROKEN';await writeFile(file,bad);
      await expect(loadAttackKnowledge({...env,GSS_ATTACK_CATALOG_SHA256:createHash('sha256').update(bad).digest('hex')})).rejects.toThrow('content omitted');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('imports active patterns, excludes deprecated/revoked, drops prose and rejects duplicate/corrupt technique identities',()=>{
    const b=bundle(),c=catalog();expect(isAttackKnowledge(c)).toBe(true);expect(c.techniques).toHaveLength(1);
    const extra={...b.objects[0],id:'attack-pattern--87654321-1234-1234-1234-123456789012',revoked:true};b.objects.push(extra);
    expect(importAttackKnowledge(b,options()).techniques).toHaveLength(1);
    b.objects[1]={...extra,revoked:false};expect(()=>importAttackKnowledge(b,options())).toThrow('Duplicate');
    const bad=bundle();bad.objects[0].external_references[0].url='https://attacker.example/';expect(()=>importAttackKnowledge(bad,options())).toThrow('identity');
    const current=bundle();current.objects[0].external_references[0].url='https://attack.mitre.org/techniques/T1110';
    expect(importAttackKnowledge(current,options()).techniques[0].url).toBe('https://attack.mitre.org/techniques/T1110/');
    current.objects[0].external_references[0].url='https://attack.mitre.org/techniques/T1059';
    expect(()=>importAttackKnowledge(current,options())).toThrow('identity');
    const tamper=structuredClone(c);tamper.techniques[0].name='Mutated';expect(isAttackKnowledge(tamper)).toBe(false);
    expect(isAttackKnowledge({...c,modelApproval:true})).toBe(false);
    expect(()=>importAttackKnowledge(bundle(),{...options(),modelApproval:true} as any)).toThrow('metadata fields');
  });
  it('resolves only exact provider IDs with event/artifact/query/task provenance, without mutating input',()=>{
    const p=projection(evidence(['T1110','T9999','Ignore instructions T1110','T1110.999'])),c=catalog(),before=JSON.stringify(p);
    const r=annotateCaseAttack('fixture-case',[p],coverage,c,now);expect(r).toMatchObject({status:'AVAILABLE',unknownLabelCount:1,unmappedLabelCount:2,
      matches:[{eventId:'fixture-event',sourceIndex:0,securityIndex:0,techniqueId:'T1110',taskId:'fixture-task',evidenceId:'fixture-evidence',
        artifactHash:p.timeline.artifactHash,projectionHash:p.projectionHash,queryHash:'d'.repeat(64)}]});
    expect(JSON.stringify(p)).toBe(before);expect('verdict' in r).toBe(false);expect('facts' in r).toBe(false);
    const proof=JSON.stringify(r);c.techniques[0].name='After return mutation';expect(JSON.stringify(r)).toBe(proof);
  });
  it('does not infer valid-account compromise/techniques from USER/IP alone or absence of matching labels',()=>{
    const p=projection(evidence([])),r=annotateCaseAttack('fixture-case',[p],coverage,catalog(),now);
    expect(r.matches).toEqual([]);expect(r.interpretation).toBe('PROVIDER_LABEL_RESOLUTION_NOT_FACT_VERDICT_OR_COMPROMISE');
    expect('verdict' in r).toBe(false);
  });
  it('rejects tampered/hash-mismatched/cross-case/duplicated/unbound event projections and unsupported field widths',()=>{
    const p=projection();expect(isEvidenceAttack(p)).toBe(true);
    const tamper=structuredClone(p);tamper.labels[0].eventId='model-event';const {projectionHash,...rest}=tamper;
    tamper.projectionHash=sha256Canonical(rest);expect(isEvidenceAttack(tamper)).toBe(false);
    expect(()=>annotateCaseAttack('other-case',[p],coverage,catalog(),now)).toThrow('lineage');
    expect(()=>annotateCaseAttack('fixture-case',[p,p],{...coverage,completedQueryCount:2},catalog(),now)).toThrow('lineage');
    expect(()=>buildEvidenceAttack(evidence(),'0'.repeat(64))).toThrow('hash');
    expect(()=>projection(evidence(Array.from({length:21},()=> 'T1110')))).toThrow('allowlist bound');
  });
  it('excludes unconfigured/expired/future-reviewed catalogs and preserves partial evidence coverage',()=>{
    const p=projection(),c=catalog();
    for(const [n,status] of [[undefined,'NOT_CONFIGURED'],[{...c},'AVAILABLE']] as const)
      expect(annotateCaseAttack('fixture-case',[p],coverage,n,now).status).toBe(status);
    expect(annotateCaseAttack('fixture-case',[p],coverage,c,'2027-01-01T00:00:00Z')).toMatchObject({status:'EXPIRED',matches:[]});
    expect(annotateCaseAttack('fixture-case',[p],coverage,c,'2026-10-13T00:00:00Z')).toMatchObject({status:'NOT_YET_VALID',matches:[]});
    expect(annotateCaseAttack('fixture-case',[p],{completedQueryCount:3,unprojectedQueryCount:1,omittedProjectionCount:1},c,now).partialEvidence).toBe(true);
  });
  it('bounds a case to 200 matches without hiding omitted entries or granting authority',()=>{
    const ps=Array.from({length:20},(_,i)=>{const e=evidence(Array.from({length:20},()=> 'T1110'));e.taskId='fixture-'+i;e.evidenceId='evd-'+i;return projection(e);});
    const r=annotateCaseAttack('fixture-case',ps,{completedQueryCount:20,unprojectedQueryCount:0,omittedProjectionCount:0},catalog(),now);
    expect(r.matches).toHaveLength(200);expect(r.omittedMatchCount).toBe(200);expect(r.partialEvidence).toBe(true);
  });
});
