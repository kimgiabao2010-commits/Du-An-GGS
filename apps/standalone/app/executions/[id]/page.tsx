import Link from 'next/link';
import { ArrowLeft, Clock3, MoreHorizontal } from 'lucide-react';
import { notFound } from 'next/navigation';
import ExecutionTimeline from '../../../components/ExecutionTimeline';
import CopyButton from '../../../components/CopyButton';
import { DataNotice, OptimizationValue, StatusBadge } from '../../../components/ui';
import { executions, getExecution } from '../../../lib/operations-data';

export function generateStaticParams() { return executions.map(execution => ({ id: execution.id })); }
export default function ExecutionDetailPage({ params }: { params: { id: string } }) {
  const execution = getExecution(params.id);
  if (!execution) notFound();
  return <div className="page-stack execution-detail">
    <div className="breadcrumb"><Link href="/executions"><ArrowLeft size={15} />Executions</Link><span>/</span><span>{execution.id}</span></div>
    <header className="execution-header"><div><div className="execution-title-row"><h1>{execution.title}</h1><StatusBadge status={execution.status} /></div><p>{execution.id} · {execution.agent} · Read-only investigation</p></div><div className="page-actions"><CopyButton value={execution.id} /><button className="icon-button" aria-label="More execution actions" disabled title="No additional actions are available"><MoreHorizontal size={19} /></button></div></header>
    <DataNotice />
    <section className="execution-summary">
      <div className="summary-identity"><span className="metric-label">Duration</span><strong><Clock3 size={17} />{execution.duration}</strong><small>Started today at {execution.startedAt}</small></div>
      <div><span className="metric-label">Context</span><OptimizationValue before={execution.contextBefore} after={execution.contextAfter} saving={execution.contextSaving} /></div>
      <div><span className="metric-label">LLM calls</span><OptimizationValue before={execution.llmBefore} after={execution.llmAfter} /></div>
      <div><span className="metric-label">Tool calls</span><OptimizationValue before={execution.toolsBefore} after={execution.toolsAfter} /></div>
      <div><span className="metric-label">Estimated cost</span><OptimizationValue before={execution.costBefore} after={execution.costAfter} /></div>
    </section>
    <div className="detail-layout">
      <section className="panel trace-panel"><div className="section-heading"><div><p className="eyebrow">Execution trace</p><h2>What happened</h2></div><span className="subtle-label">{execution.trace.length} events</span></div><ExecutionTimeline nodes={execution.trace} /></section>
      <aside className="detail-inspector">
        <section className="panel"><p className="eyebrow">Verdict</p><h3>Suspicious</h3><p className="inspector-copy">Awaiting one unresolved identity correlation before confirmation.</p><div className="confidence"><span>Confidence</span><strong>78%</strong></div><div className="progress-track"><span style={{ width: '78%' }} /></div></section>
        <section className="panel evidence-summary"><p className="eyebrow">Evidence</p><div><span className="evidence-dot supporting" /><span>Supporting</span><strong>6</strong></div><div><span className="evidence-dot contradictory" /><span>Contradictory</span><strong>2</strong></div><div><span className="evidence-dot unresolved" /><span>Unresolved</span><strong>4</strong></div><Link className="text-link" href="/evidence">Inspect evidence <ArrowLeft className="link-arrow-right" size={14} /></Link></section>
        <section className="panel policy-panel"><p className="eyebrow">Boundary</p><strong>Read-only · evidence-first</strong><p>No remediation, SIEM write-back or deployment can be initiated from this execution.</p></section>
      </aside>
    </div>
  </div>;
}
