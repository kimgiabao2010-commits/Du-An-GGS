'use client';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { investigationView, type InvestigationView } from '../lib/investigation-view';
import CaseTimelinePanel from './CaseTimelinePanel';
import CaseEntitiesPanel from './CaseEntitiesPanel';

export default function InvestigationConsole() {
  const [caseId,setCaseId]=useState(''),[view,setView]=useState<InvestigationView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [visible,setVisible]=useState(10),field=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load(event:FormEvent) {
    event.preventDefault();setError('');setView(null);setVisible(10);
    const requestedCase=caseId.trim();
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(requestedCase)){setError('Enter a valid case ID from an authority receipt.');field.current?.focus();return;}
    setBusy(true);const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),10000);
    try {
      const response=await fetch(`/api/control/cases/${requestedCase}/frontier`,{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error(response.status===401?'Sign in again.':response.status===403?'Case access denied.':
        response.status===404?'No retained frontier for this case.':'Control Plane unavailable. No investigation inferred.');
      const body=await response.text();if(body.length>2_000_000)throw new Error('Frontier exceeds the display budget; use an authorized export.');
      setView(investigationView(JSON.parse(body),requestedCase));
    }catch(e){setError(abort.signal.aborted?'Investigation request timed out.':e instanceof Error?e.message:'Investigation request failed.');}
    finally{clearTimeout(timeout);setBusy(false);}
  }
  const plan=view?.hypothesisPlan;
  return <section className="investigation-console" aria-label="Persisted investigation">
    <aside className="approval-boundary">Read-only authority snapshot. A supported hypothesis is not a compromise verdict. Source labels describe provenance, not staging attestation. No model-generated facts or dispatch controls.</aside>
    <form className="approval-request" onSubmit={load}>
      <label htmlFor="investigation-case">Case ID<input ref={field} id="investigation-case" value={caseId} onChange={e=>setCaseId(e.target.value)}
        disabled={busy} aria-invalid={!!error} aria-describedby={`investigation-help${error?' investigation-error':''}`} /></label>
      <p id="investigation-help">Use a retained case ID. Your session must have incident-level access.</p>
      {error && <p id="investigation-error" className="approval-error" role="alert">{error}</p>}
      <button className="button secondary" disabled={busy} type="submit">{busy?'Loading investigation…':'Load investigation'}</button>
      <p role="status" aria-atomic="true">{view?`Frontier version ${view.frontier.version} loaded; ${view.frontier.facts.length} retained facts.`:busy?'Request in progress.':'No investigation loaded.'}</p>
    </form>
    {view && <div className="investigation-snapshot">
      <article className="approval-card"><h2>Authority snapshot</h2><dl>
        <dt>Case</dt><dd>{view.run.caseId}</dd><dt>Run state</dt><dd>{view.run.state}</dd>
        <dt>Frontier</dt><dd>Version {view.frontier.version}</dd><dt>Policy</dt><dd>{view.run.policyVersion}</dd>
        <dt>Updated</dt><dd><time dateTime={view.frontier.updatedAt}>{view.frontier.updatedAt}</time></dd>
        <dt>Depth</dt><dd>{view.run.depth} / {view.run.budget.maxDepth}</dd>
        <dt>External queries</dt><dd>{view.run.usage.externalQueries} / {view.run.budget.maxExternalQueries}</dd>
        <dt>Recorded cost (micro-units)</dt><dd>{view.run.usage.costMicros} / {view.run.budget.maxCostMicros}{view.run.usage.costUnknown?' · Some cost is unknown':''}</dd>
        <dt>Deadline</dt><dd>{view.run.budget.deadlineAt}</dd></dl>
      </article>
      <CaseTimelinePanel key={`${view.run.caseId}:${view.frontier.version}`} caseId={view.run.caseId} />
      <CaseEntitiesPanel key={`entities:${view.run.caseId}:${view.frontier.version}`} caseId={view.run.caseId} />
      <article className="approval-card investigation-decision"><h2>Next evidence step</h2>
        {plan?<><p className="investigation-state">{plan.decision.kind}</p><p>{plan.decision.rationale}</p>
          <dl><dt>Reason</dt><dd>{plan.decision.reasonCode}</dd><dt>Question</dt><dd>{plan.selectedQuestionId??'No safe question selected'}</dd>
            <dt>Stored plan</dt><dd>{plan.planId}</dd><dt>Supporting facts</dt><dd>{plan.selectedFactIds.join(', ')||'None selected'}</dd>
            <dt>Supporting evidence</dt><dd>{plan.selectedEvidenceIds.join(', ')||'None selected'}</dd></dl>
          <p className="investigation-note">This is a retained authority decision, not permission to run an action from this page.</p></>:
          <p className="investigation-note">No stored hypothesis plan. Metadata-only or legacy cases do not prove SOC reasoning. No next step or verdict inferred.</p>}
      </article>
      {plan?.coverage && <article className="approval-card"><h2>Investigation coverage</h2>
        <p>Allowlisted structured fields only. {plan.coverage.evaluatedIndicators} of {plan.coverage.discoveredIndicators} discovered indicators assessed;
          {' '}{plan.coverage.omittedIndicators} not assessed by this bounded plan.</p>
        <p>{plan.coverage.limitations.length?`Limits: ${plan.coverage.limitations.join(', ')}`:'No processing overflow recorded; this does not prove exhaustive telemetry.'}</p>
        {plan.coverage.partialExtractionEvidenceIds.length>0 && <p>Partially extracted evidence: {plan.coverage.partialExtractionEvidenceIds.join(', ')}</p>}
      </article>}
      {plan && <article className="approval-card"><h2>Hypotheses & evidence gaps</h2><ul className="investigation-hypotheses">
        {plan.hypotheses.map(h=><li key={h.hypothesisId}><h3>{h.statement}</h3><p>{h.status} · Gap: {h.gap??'None in this rule'}</p>
          <details><summary>Evidence references for {h.hypothesisId}</summary><p>Facts: {h.factIds.join(', ')||'None'}</p><p>Evidence: {h.evidenceIds.join(', ')||'None'}</p></details></li>)}
      </ul></article>}
      <article className="approval-card"><h2>Contradictions</h2><p>{view.frontier.contradictions.length} retained; conflicting facts are not discarded.</p>
        {view.frontier.contradictions.length>0 && <details><summary>Inspect all contradiction references</summary><ul>
          {view.frontier.contradictions.map(c=><li key={c.contradictionId}>{c.key}: {c.factIds.join(', ')}</li>)}</ul></details>}
      </article>
      <article className="approval-card"><h2>Facts & provenance</h2><p>Showing {Math.min(visible,view.frontier.facts.length)} of {view.frontier.facts.length} retained records. Inferences and hypotheses remain labeled.</p>
        <ol className="investigation-facts">{view.frontier.facts.slice(0,visible).map(f=><li key={f.factId}><h3>{f.key}</h3>
          <p>{f.semanticType}{f.value.length<=180?` · ${f.value}`:''}</p>
          {f.value.length>180 && <details><summary>Inspect full retained value for {f.factId}</summary><p>{f.value}</p></details>}
          <details><summary>Provenance for {f.factId}</summary><ul>{f.provenance.map((p,i)=><li key={i}>
            <dl><dt>Evidence</dt><dd>{p.evidenceRef}</dd><dt>Task</dt><dd>{p.taskId}</dd><dt>Source</dt><dd>{p.source}</dd>
              <dt>Observed</dt><dd>{p.observedAt}</dd><dt>Artifact SHA-256</dt><dd>{p.artifactHash??'Not recorded; integrity unavailable'}</dd></dl></li>)}</ul></details></li>)}</ol>
        {visible<view.frontier.facts.length && <button type="button" className="button secondary" onClick={()=>setVisible(x=>x+10)}>Show 10 more facts</button>}
      </article>
    </div>}
  </section>;
}
