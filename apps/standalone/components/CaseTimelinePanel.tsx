'use client';
import { useEffect, useRef, useState } from 'react';
import type { CaseTimeline } from '@asq/sdk';
import { caseTimelineView } from '../lib/case-timeline-view';
import { caseReportView } from '../lib/case-report-view';

export default function CaseTimelinePanel({ caseId }: { caseId: string }) {
  const [timeline,setTimeline]=useState<CaseTimeline|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[visible,setVisible]=useState(20);
  const controller=useRef<AbortController|null>(null);
  const [reportBusy,setReportBusy]=useState(false);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load() {
    controller.current?.abort(); const abort=new AbortController(); controller.current=abort;
    setBusy(true);setError('');setTimeline(null);setVisible(20);
    const timeout=setTimeout(()=>abort.abort(),10000);
    try {
      const response=await fetch(`/api/control/cases/${encodeURIComponent(caseId)}/timeline`,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error(response.status===401?'Sign in again.':response.status===403?'Case access denied.':
        response.status===409?'Stored timeline failed integrity checks. Ask the operator to inspect the retained artifacts.':
        'Timeline unavailable. No events inferred.');
      const body=await response.text();if(body.length>2_000_000)throw new Error('Timeline exceeds the display budget.');
      const parsed=caseTimelineView(JSON.parse(body),caseId);
      if(!abort.signal.aborted)setTimeline(parsed);
    } catch(e) { if(controller.current===abort)setError(abort.signal.aborted?'Timeline request timed out.':e instanceof Error?e.message:'Timeline unavailable.'); }
    finally { clearTimeout(timeout);if(controller.current===abort)setBusy(false); }
  }
  function saveJson(value:unknown,kind:string) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`GSS-${caseId}-${kind}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function downloadReport() {
    const abort=new AbortController();controller.current=abort;setReportBusy(true);setError('');
    const timeout=setTimeout(()=>abort.abort(),10000);
    try {
      const response=await fetch(`/api/control/cases/${encodeURIComponent(caseId)}/report`,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error(response.status===403?'Case access denied.':'Case report unavailable or integrity check failed.');
      const text=await response.text();if(text.length>2_000_000)throw new Error('Case report exceeds the export budget.');
      const report=caseReportView(JSON.parse(text),caseId);if(!abort.signal.aborted)saveJson(report,'report');
    }catch(e){setError(abort.signal.aborted?'Report request timed out.':e instanceof Error?e.message:'Report unavailable.');}
    finally{clearTimeout(timeout);setReportBusy(false);}
  }
  return <article className="approval-card" aria-labelledby="case-timeline-title" aria-busy={busy||reportBusy}>
    <h2 id="case-timeline-title">Case timeline</h2>
    <p>Retained query results, ordered by event time. Matching event IDs remain separate across queries. Ordering alone does not establish causation.</p>
    <button type="button" className="button secondary" disabled={busy||reportBusy} onClick={load}>{busy?'Loading timeline…':timeline?'Refresh timeline':'Load case timeline'}</button>
    <p><button type="button" className="button secondary" disabled={busy||reportBusy} onClick={downloadReport}>{reportBusy?'Preparing report…':'Download case report'}</button></p>
    <p className="investigation-note">The case report reads the latest frontier, hypotheses and timeline in one database snapshot. Analyst review is required.</p>
    {error && <p role="alert" className="approval-error">{error}</p>}
    <p role="status" aria-atomic="true">{busy?'Reading the authorized case snapshot.':timeline?`${timeline.entries.length} events available. ${timeline.partial?'Coverage is partial.':'No recorded processing overflow.'}`:'Load the timeline to inspect retained event times.'}</p>
    {timeline && <div className="case-timeline">
      <dl><dt>Completed queries</dt><dd>{timeline.completedQueryCount}</dd><dt>Queries without an authority timeline</dt><dd>{timeline.unprojectedQueryCount}</dd>
        <dt>Queries outside this bounded snapshot</dt><dd>{timeline.omittedProjectionCount}</dd>
        <dt>Events in selected query results</dt><dd>{timeline.inputEventCount}</dd><dt>Events omitted from this snapshot</dt><dd>{timeline.omittedEventCount}</dd>
        <dt>Uncertain event times in selected results</dt><dd>{timeline.uncertainTimeCount}</dd></dl>
      {timeline.entries.length===0 && <p>No retained events in this snapshot. This does not establish that the case is benign.</p>}
      <ol className="investigation-facts">{timeline.entries.slice(0,visible).map(entry=>{
        const source=timeline.sources.find(s=>s.taskId===entry.taskId)!;
        return <li key={`${entry.taskId}:${entry.sourceIndex}`}><h3>{entry.eventId}</h3>
          <p>{entry.timeStatus==='VALID'?<time dateTime={entry.occurredAt!}>{entry.rawTimestamp}</time>:`Event time: ${entry.timeStatus}`}</p>
          <p>{source.sourceKind} · {source.sourceInstance}</p>
          <details><summary>Source and timing for {entry.eventId} ({entry.taskId})</summary><dl>
            <dt>Original timestamp</dt><dd>{entry.rawTimestamp??'Unavailable'}</dd><dt>UTC sort time</dt><dd>{entry.occurredAt??'Unknown'}</dd>
            <dt>Evidence</dt><dd>{entry.evidenceId}</dd><dt>Task</dt><dd>{entry.taskId}</dd><dt>Artifact SHA-256</dt><dd>{entry.artifactHash}</dd>
            <dt>Queried at</dt><dd>{source.queriedAt}</dd><dt>Collected at</dt><dd>{source.collectedAt??'Not recorded'}</dd>
            <dt>Query range</dt><dd>{source.queryRange.start} – {source.queryRange.end}</dd>
            <dt>Coverage</dt><dd>{source.truncated?'Partial query results':'No recorded query truncation'}{source.fieldTruncated?'; fields omitted by adapter':''}</dd>
          </dl></details></li>;
      })}</ol>
      {visible<timeline.entries.length && <button type="button" className="button secondary" onClick={()=>setVisible(n=>n+20)}>Show 20 more events</button>}
      <p className="investigation-note">This timeline was read independently of the frontier above. Source labels and hashes do not certify a live Chronicle connection.</p>
      <button type="button" className="button secondary" onClick={()=>saveJson(timeline,'timeline')}>Download timeline JSON</button>
      <details><summary>Snapshot integrity</summary><p>{timeline.snapshotHash}</p></details>
    </div>}
  </article>;
}
