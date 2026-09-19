import EvidenceExplorer from '../../components/EvidenceExplorer';
import { DataNotice, PageHeader } from '../../components/ui';
import { evidence } from '../../lib/operations-data';

export const metadata = { title: 'Evidence' };
export default function EvidencePage() { return <div className="page-stack"><PageHeader eyebrow="Provenance" title="Evidence" description="Verify supporting, contradictory and unresolved material without hiding what the reducer discarded." /><DataNotice /><div className="evidence-overview"><div><span className="evidence-dot supporting" /><strong>6</strong><span>Supporting</span></div><div><span className="evidence-dot contradictory" /><strong>2</strong><span>Contradictory</span></div><div><span className="evidence-dot unresolved" /><strong>4</strong><span>Unresolved</span></div><div className="reduction-total"><strong>37 → 12</strong><span>67.6% reduced · contradictory evidence preserved</span></div></div><EvidenceExplorer records={evidence} /></div>; }
