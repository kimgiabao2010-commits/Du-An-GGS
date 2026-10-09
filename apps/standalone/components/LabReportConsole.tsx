'use client';
import { useState, useRef, useEffect, type FormEvent } from 'react';
type Report = { caseId:string;verdict:string;frontierVersion:number;limitations:string[];
  provenance:{sourceKind:string;sourceInstance:string;artifactHash:string;collectedAt:string;queriedAt:string;truncated:boolean};
  timeline:Array<{eventId:string;evidenceId:string;event:{eventTime:string;provider:string;eventCode:number;channel:string}}> };
export default function LabReportConsole() {
  const [caseId,setCaseId]=useState(''),[report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const field=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load(event:FormEvent) {
    event.preventDefault();setError('');setReport(null);
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)){setError('Enter a valid case ID from the lab CLI receipt.');field.current?.focus();return;}
    setBusy(true);const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),10000);
    try {
      const response=await fetch(`/api/control/cases/${caseId}/lab-report`,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error(response.status===401?'Sign in again.':response.status===403?'Case access or profile denied.':response.status===404?'No retained report for this case.':'Control Plane unavailable. No report inferred.');
      const data=await response.json(),r=data.report;
      if(r?.schemaVersion!=='gss.lab-report.v1' || r.caseId!==caseId || r.verdict!=='INSUFFICIENT_EVIDENCE' ||
        !Number.isSafeInteger(r.frontierVersion) || r.frontierVersion<1 ||
        !Array.isArray(r.timeline) || r.timeline.length>100 || !Array.isArray(r.limitations) ||
        r.limitations.length>20 || !r.limitations.every((s:unknown)=>typeof s==='string' && s.length<=1000) ||
        !['LAB_LIVE','REPLAY'].includes(r.provenance?.sourceKind) ||
        typeof r.provenance?.sourceInstance!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.provenance.sourceInstance) ||
        typeof r.provenance?.truncated!=='boolean' ||
        ![r.provenance?.collectedAt,r.provenance?.queriedAt].every(s=>typeof s==='string' && Number.isFinite(Date.parse(s))) ||
        typeof r.provenance?.artifactHash!=='string' || !/^[a-f0-9]{64}$/.test(r.provenance.artifactHash) ||
        r.timeline.some((row:any)=>typeof row?.eventId!=='string' || row.eventId.length>300 ||
          typeof row.evidenceId!=='string' || row.evidenceId.length>128 || typeof row.event?.provider!=='string' || row.event.provider.length>160 ||
          !['System','Application'].includes(row.event?.channel) || !Number.isSafeInteger(row.event?.eventCode) || row.event.eventCode<0 || row.event.eventCode>65535 ||
          typeof row.event?.eventTime!=='string' || !Number.isFinite(Date.parse(row.event.eventTime))))throw new Error('Invalid lab report contract; nothing inferred.');
      setReport(r);
    }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Report request failed.');else setError('Report request timed out.');}
    finally{clearTimeout(timeout);setBusy(false);}
  }
  return <section className="lab-console" aria-label="Persisted lab evidence">
    <aside className="approval-boundary">Own-device metadata only. LAB_LIVE is operator-asserted, not attestation. REPLAY is historical data. Neither verifies Chronicle, model reasoning or sandbox execution.</aside>
    <form className="approval-request" onSubmit={load}>
      <label htmlFor="lab-case">Case ID<input ref={field} id="lab-case" value={caseId} onChange={e=>setCaseId(e.target.value)}
        disabled={busy} aria-invalid={!!error} aria-describedby="lab-help lab-error" /></label>
      <p id="lab-help">Use the case ID emitted by lab:run. Your session must have access to the case.</p>
      {error && <p id="lab-error" className="approval-error" role="alert">{error}</p>}
      <button className="button secondary" disabled={busy} type="submit">{busy?'Loading retained report…':'Load report'}</button>
      <p role="status" aria-atomic="true">{report?`${report.timeline.length} events loaded; verdict insufficient evidence.`:busy?'Request in progress.':'No report loaded.'}</p>
    </form>
    {report && <article className="approval-card"><h2>Evidence-backed timeline</h2>
      <dl><dt>Source</dt><dd>{report.provenance.sourceKind} · {report.provenance.sourceInstance}</dd>
        <dt>Verdict</dt><dd>{report.verdict}</dd><dt>Frontier</dt><dd>Version {report.frontierVersion}</dd>
        <dt>Collected</dt><dd>{report.provenance.collectedAt}</dd><dt>Query time</dt><dd>{report.provenance.queriedAt}</dd>
        <dt>Artifact hash</dt><dd>{report.provenance.artifactHash}</dd><dt>Coverage</dt><dd>{report.provenance.truncated?'Truncated; not exhaustive':'Bounded imported batch; not full host coverage'}</dd></dl>
      <h3>Limits and evidence gaps</h3><ul>{report.limitations.map(line=><li key={line}>{line}</li>)}</ul>
      <ol className="lab-timeline">{report.timeline.map(row=><li key={row.eventId}><time dateTime={row.event.eventTime}>{row.event.eventTime}</time>
        <p>{row.event.channel} · {row.event.provider} · Event {row.event.eventCode}</p><small>Event: {row.eventId}<br/>Evidence: {row.evidenceId}</small></li>)}</ol>
    </article>}
  </section>;
}
