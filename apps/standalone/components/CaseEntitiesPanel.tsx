'use client';
import {useEffect,useRef,useState} from 'react';
import type {CaseEntities} from '@asq/sdk';
import {caseEntitiesView} from '../lib/case-entities-view';

export default function CaseEntitiesPanel({caseId}:{caseId:string}) {
  const [data,setData]=useState<CaseEntities|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[visible,setVisible]=useState(10);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();controller.current=null;},[]);
  async function load(){
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const timer=setTimeout(()=>abort.abort(),10000);setBusy(true);setError('');setData(null);setVisible(10);
    try{
      const response=await fetch(`/api/control/cases/${encodeURIComponent(caseId)}/entities`,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error(response.status===403?'Case access denied.':response.status===401?'Sign in again.':
        response.status===409?'Stored entity projection failed integrity checks. Ask the operator to inspect evidence.':'Entity evidence unavailable. Retry after checking the Control Plane.');
      const body=await response.text();if(body.length>2_000_000)throw new Error('Entity snapshot exceeds the display budget.');
      const parsed=caseEntitiesView(JSON.parse(body),caseId);if(controller.current===abort&&!abort.signal.aborted)setData(parsed);
    }catch(e){if(controller.current===abort)setError(abort.signal.aborted?'Entity request timed out. Retry the read.':e instanceof Error?e.message:'Entity evidence unavailable.');}
    finally{clearTimeout(timer);if(controller.current===abort)setBusy(false);}
  }
  function download(){
    if(!data)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`GSS-${caseId}-entities.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <article className="approval-card" aria-labelledby="entity-heading" aria-busy={busy}>
    <h2 id="entity-heading">Entity co-observations</h2>
    <p>Inspect structured IP, domain, user, hostname and hash values in each event. Shared values alone do not establish the same asset, a causal link or compromise.</p>
    <button type="button" className="button secondary" disabled={busy} onClick={load}>{busy?'Loading entities.':data?'Refresh entity evidence':'Load entity evidence'}</button>
    {error&&<p className="approval-error" role="alert">{error}</p>}
    <p role="status" aria-atomic="true">{busy?'Reading retained event evidence.':data?`${data.entries.length} event groups retained. ${data.partial?'Coverage is partial.':'No recorded processing overflow.'}`:'Entity evidence has not been loaded.'}</p>
    {data&&<div className="case-entities">
      <dl><dt>Completed queries</dt><dd>{data.completedQueryCount}</dd><dt>Queries without an authority entity projection</dt><dd>{data.unprojectedQueryCount}</dd>
        <dt>Queries outside this snapshot</dt><dd>{data.omittedProjectionCount}</dd><dt>Events omitted</dt><dd>{data.omittedEventCount}</dd>
        <dt>Parsed mentions omitted</dt><dd>{data.omittedParsedMentionCount}</dd></dl>
      <p className="investigation-note">Mention counts cover processed fields only; omitted events may contain additional uncounted entities. Snapshot read independently of the Frontier above.</p>
      {data.entries.length===0&&<p>No retained structured entity events. This does not establish a benign case.</p>}
      <ol className="investigation-facts">{data.entries.slice(0,visible).map(e=>{const source=data.sources.find(s=>s.taskId===e.taskId)!;return <li key={`${e.taskId}:${e.sourceIndex}`}>
        <h3>{e.eventId}</h3><p>{e.timeStatus==='VALID'?<time dateTime={e.occurredAt!}>{e.rawTimestamp}</time>:`Event time: ${e.timeStatus}`}</p>
        <p>{e.mentions.length} retained mentions in this event.</p>
        {e.mentions.length===0?<p>No allowlisted values retained.</p>:<ul>{e.mentions.map(m=><li key={`${m.field}:${m.type}:${m.value}`}><span>{m.field} · {m.type}</span>: {m.value}</li>)}</ul>}
        <details><summary>Entity provenance for {e.eventId} ({e.taskId})</summary><dl>
          <dt>Evidence</dt><dd>{e.evidenceId}</dd><dt>Task</dt><dd>{e.taskId}</dd><dt>Artifact SHA-256</dt><dd>{e.artifactHash}</dd>
          <dt>Relationship</dt><dd>Co-observed in this event only</dd><dt>Source</dt><dd>{source.sourceInstance}</dd>
          <dt>Source classification</dt><dd>{source.sourceKind}</dd><dt>Query SHA-256</dt><dd>{source.queryHash}</dd>
          <dt>Coverage</dt><dd>{source.truncated?'Partial projection':'No recorded processing overflow'}
            {source.limits?.fieldArrays?'; field arrays limited':''}{source.limits?.perEventMentions?'; per-event mentions limited':''}
            {source.limits?.totalMentions?'; total mentions limited':''}{source.fieldTruncated?'; provider fields omitted':''}
            {source.invalidParsedValues?`; ${source.invalidParsedValues} invalid parsed values ignored`:''}</dd>
        </dl></details>
      </li>})}</ol>
      {visible<data.entries.length&&<button type="button" className="button secondary" onClick={()=>setVisible(n=>n+10)}>Show 10 more event groups</button>}
      <button type="button" className="button secondary" onClick={download}>Download entity JSON</button>
    </div>}
  </article>;
}
