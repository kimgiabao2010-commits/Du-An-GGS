import Link from 'next/link';
import { ArrowRight, FileCheck2, ShieldCheck, Workflow } from 'lucide-react';
import OrchestratorPrompt from '../components/OrchestratorPrompt';
import { DataNotice, PageHeader } from '../components/ui';

export default function StandaloneSocPage() {
  return <div className="page-stack">
    <PageHeader eyebrow="Security Intelligence" title="Investigation, beautifully controlled." description="A calm command surface for triage, evidence-led reasoning and governed execution—from first signal to defensible verdict." actions={<Link className="button secondary" href="/executions">View control plane <ArrowRight size={15} /></Link>} />
    <DataNotice />
    <div className="soc-workspace-grid">
      <OrchestratorPrompt />
      <aside className="soc-context-column">
        <section className="panel soc-context-card context-feature"><span className="context-orb"><Workflow size={18} /></span><p className="eyebrow">Operating model</p><h2>One workspace.<br />Clear authority.</h2><p>Standalone decides what and why. The Control Plane determines how each capability executes safely.</p><div className="soc-depth"><span className="active">L1 Triage</span><span>L2 Investigate</span><span>L3 Advanced</span></div></section>
        <section className="panel soc-context-card"><p className="eyebrow">Evidence boundary</p><h2>Every conclusion has a trail.</h2><ul><li><FileCheck2 size={15} />Worker output links to a case and task.</li><li><Workflow size={15} />Raw output is immutable and referenced.</li><li><ShieldCheck size={15} />Risky actions require human approval.</li></ul><Link className="text-link" href="/evidence">Explore evidence <ArrowRight size={14} /></Link></section>
      </aside>
    </div>
  </div>;
}
