import Link from 'next/link';
import { ArrowRight, Bot, CircleAlert, Command, FileCheck2, Gauge, Sparkles, Workflow } from 'lucide-react';
import { agents, executions, tasks } from '../lib/operations-data';
import { DataNotice, Metric, PageHeader, StatusBadge } from '../components/ui';

export default function OverviewPage() {
  const current = executions[0];
  return <div className="page-stack">
    <PageHeader eyebrow="Operations overview" title="Good morning. GSS is healthy." description="The control plane is responsive, three agents are available, and one investigation needs attention." actions={<><Link className="button secondary" href="/executions">View executions</Link><Link className="button primary" href="/command"><Command size={16} />New task</Link></>} />
    <DataNotice />
    <section className="health-hero" aria-label="System health">
      <div className="health-summary"><span className="health-icon"><Gauge size={24} aria-hidden="true" /></span><div><span className="metric-label">System health</span><h2>All core services operational</h2><p>Command Center, worker channel and evidence pipeline are responding normally.</p></div></div>
      <div className="hero-metrics"><Metric label="Active agents" value={`${agents.filter(agent => agent.state === 'Active').length} / ${agents.length}`} note="1 degraded" /><Metric label="Tasks running" value="1" note="3 queued or complete" /><Metric label="Failures" value="1" note="Last 60 minutes" /><Metric label="Spend today" value="$4.82" note="−41% optimized" trend="down" /></div>
    </section>
    <div className="overview-grid">
      <section className="panel active-execution">
        <div className="section-heading"><div><p className="eyebrow">Now running</p><h2>{current.title}</h2></div><StatusBadge status={current.status} /></div>
        <div className="execution-progress"><div><span>Investigation progress</span><strong>68%</strong></div><div className="progress-track"><span style={{ width: '68%' }} /></div></div>
        <div className="optimization-strip">
          <div><span>Context</span><strong>{current.contextBefore} <ArrowRight size={14} /> {current.contextAfter}</strong><small>−{current.contextSaving}</small></div>
          <div><span>LLM calls</span><strong>{current.llmBefore} <ArrowRight size={14} /> {current.llmAfter}</strong><small>5 avoided</small></div>
          <div><span>Tool calls</span><strong>{current.toolsBefore} <ArrowRight size={14} /> {current.toolsAfter}</strong><small>7 avoided</small></div>
          <div><span>Estimated cost</span><strong>{current.costBefore} <ArrowRight size={14} /> {current.costAfter}</strong><small>−53.6%</small></div>
        </div>
        <div className="current-step"><span className="trace-mini-icon"><FileCheck2 size={16} /></span><div><span>Current step</span><strong>Correlating retained evidence with identity activity</strong></div><span className="pulse-label"><span className="status-dot info" />Live</span></div>
        <Link className="text-link" href={`/executions/${current.id}`}>Open execution trace <ArrowRight size={15} /></Link>
      </section>
      <section className="panel attention-panel">
        <div className="section-heading"><div><p className="eyebrow">Attention</p><h2>One item needs review</h2></div><CircleAlert size={20} className="warning-icon" /></div>
        <div className="attention-item"><span className="status-icon error"><CircleAlert size={16} /></span><div><strong>Research provider timeout</strong><p>EXE-8418 stopped without creating evidence. The retry boundary held as expected.</p><small>7 minutes ago</small></div></div>
        <Link className="text-link" href="/logs">Inspect failure logs <ArrowRight size={15} /></Link>
      </section>
    </div>
    <section className="panel table-panel">
      <div className="section-heading"><div><p className="eyebrow">Recent activity</p><h2>Tasks</h2></div><Link className="text-link" href="/tasks">View all <ArrowRight size={15} /></Link></div>
      <div className="table-wrap"><table><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>Progress</th><th className="numeric">Cost</th></tr></thead><tbody>{tasks.slice(0, 4).map(task => <tr key={task.id}><td><Link className="table-primary" href={task.id === 'TSK-2481' ? '/executions/EXE-8421' : '/tasks'}>{task.title}</Link><span className="table-secondary">{task.id} · {task.startedAt}</span></td><td><StatusBadge status={task.status} /></td><td>{task.agent}</td><td><div className="table-progress"><span style={{ width: `${task.progress}%` }} /></div><span className="progress-value">{task.progress}%</span></td><td className="numeric mono">{task.cost}</td></tr>)}</tbody></table></div>
    </section>
    <div className="insight-grid">
      <section className="quiet-section"><div className="insight-icon"><Sparkles size={18} /></div><div><span className="metric-label">Optimization savings</span><strong>$3.29</strong><p>Saved today through Action Fusion, context compaction and evidence reduction.</p></div></section>
      <section className="quiet-section"><div className="insight-icon"><Bot size={18} /></div><div><span className="metric-label">Agent reliability</span><strong>96.5%</strong><p>Average successful completion across the last 50 read-only operations.</p></div></section>
      <section className="quiet-section"><div className="insight-icon"><Workflow size={18} /></div><div><span className="metric-label">Evidence lineage</span><strong>100%</strong><p>Every current verdict links to retained evidence and a policy version.</p></div></section>
    </div>
  </div>;
}
