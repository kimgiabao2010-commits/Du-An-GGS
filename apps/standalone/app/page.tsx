import Link from 'next/link';
import { ArrowRight, FileCheck2, ShieldCheck, Workflow } from 'lucide-react';
import OrchestratorPrompt from '../components/OrchestratorPrompt';
import { DataNotice, PageHeader } from '../components/ui';

export default function StandaloneSocPage() {
  return <div className="page-stack">
    <PageHeader eyebrow="Standalone SOC" title="Investigation workspace" description="One operator surface for conversation, L1-L3 investigation depth, evidence review and governed execution." actions={<Link className="button secondary" href="/executions">Control Plane <ArrowRight size={15} /></Link>} />
    <DataNotice />
    <div className="soc-workspace-grid">
      <OrchestratorPrompt />
      <aside className="soc-context-column">
        <section className="panel soc-context-card"><p className="eyebrow">Operating model</p><h2>Standalone decides what and why</h2><p>The Control Plane decides how to execute safely. CLI, IDE and SIEM remain governed capabilities beneath this workspace.</p><div className="soc-depth"><span className="active">L1 Triage</span><span>L2 Investigation</span><span>L3 Advanced</span></div></section>
        <section className="panel soc-context-card"><p className="eyebrow">Evidence boundary</p><h2>No silent conclusions</h2><ul><li><FileCheck2 size={14} />Worker output must link to a case and task.</li><li><Workflow size={14} />Raw output is stored once and referenced.</li><li><ShieldCheck size={14} />Risky actions still require human approval.</li></ul><Link className="text-link" href="/evidence">Open evidence workspace <ArrowRight size={14} /></Link></section>
      </aside>
    </div>
  </div>;
}
