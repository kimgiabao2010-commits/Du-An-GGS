'use client';
import { useEffect, useState } from 'react';
type Approval = { approval_id: string; incident_id: string; artifact_hash: string; requested_by: string;
  expires_at: string; status: string; approval_count: number; policy_version: string };
export default function ApprovalConsole() {
  const [rows,setRows] = useState<Approval[]>([]), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [caseId,setCaseId] = useState(''), [hash,setHash] = useState(''), [notice,setNotice] = useState('');
  async function refresh() {
    const response = await fetch('/api/control/approvals', { cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Approval data unavailable');
    setRows(data.approvals ?? []);
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  async function submit(path: string, input: object) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/control/'+path, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(input) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? data.status ?? 'Approval denied');
      setNotice(data.status === 'APPROVED_FOR_PROPOSAL' ? 'Proposal approved. No execution, merge or deployment was performed.' : 'Decision recorded by Control Plane.');
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'Request failed safely'); } finally { setBusy(false); }
  }
  return <section className="approval-console" aria-busy={busy}>
    <div className="approval-boundary">Live PostgreSQL records only. An empty list means no requests; it does not mean verification passed.</div>
    {error && <p className="approval-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="approval-request" onSubmit={event => { event.preventDefault(); void submit('approvals', { incidentId: caseId, artifactHash: hash,
      action: 'CREATE_GITOPS_PR', parameters: { proposalOnly: true }, policyVersion: 'gss.approval.v1', expiresAt: new Date(Date.now()+3600000).toISOString(), payload: {} }); }}>
      <h2>Request a proposal review</h2><p>The artifact must already belong to this case in the authority registry.</p>
      <label>Case ID<input required maxLength={256} value={caseId} onChange={e => setCaseId(e.target.value)} autoComplete="off" /></label>
      <label>Artifact SHA-256<input required pattern="[a-f0-9]{64}" maxLength={64} value={hash} onChange={e => setHash(e.target.value)} autoComplete="off" aria-describedby="artifact-help" /></label>
      <p id="artifact-help">Exact lowercase hash; expiry is one hour. Changing the artifact requires a new request.</p>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Request review'}</button>
    </form>
    <div className="approval-list"><div className="approval-list-heading"><h2>Durable requests</h2><button className="secondary-button" disabled={busy} onClick={() => { setError(''); void refresh().catch(e => setError(e.message)); }}>Refresh</button></div>
      {!rows.length && !error && <p>No approval requests yet.</p>}
      {rows.map(row => <article className="approval-card" key={row.approval_id}><div><h3>{row.incident_id}</h3><span>{row.status} · {row.approval_count}/2 distinct approvers</span></div>
        <dl><dt>Artifact</dt><dd><code>{row.artifact_hash}</code></dd><dt>Requester</dt><dd>{row.requested_by}</dd><dt>Policy</dt><dd>{row.policy_version}</dd><dt>Expires</dt><dd>{new Date(row.expires_at).toLocaleString()}</dd></dl>
        <button className="secondary-button" disabled={busy || row.status !== 'PENDING'} onClick={() => void submit(`approvals/${row.approval_id}/decision`, { artifactHash: row.artifact_hash })}>Approve this bound proposal</button>
        <p>Requester cannot approve. The authority verifies identity, hash and expiry again.</p>
      </article>)}
    </div>
  </section>;
}
