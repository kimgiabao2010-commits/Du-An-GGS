import Link from 'next/link';
import { ArrowRight, Workflow } from 'lucide-react';
import { DataNotice, OptimizationValue, PageHeader, StatusBadge } from '../../components/ui';
import { executions } from '../../lib/operations-data';

export const metadata = { title: 'Executions' };
export default function ExecutionsPage() { return <div className="page-stack"><PageHeader eyebrow="Trace history" title="Executions" description="Follow every decision, action, observation and evidence transition without losing provenance." /><DataNotice /><div className="execution-list">{executions.map(execution => <Link href={`/executions/${execution.id}`} className="execution-row" key={execution.id}><span className="execution-row-icon"><Workflow size={18} /></span><div className="execution-row-main"><strong>{execution.title}</strong><span>{execution.id} · {execution.agent} · started {execution.startedAt}</span></div><StatusBadge status={execution.status} /><div className="execution-row-metric"><span>Context</span><OptimizationValue before={execution.contextBefore} after={execution.contextAfter} saving={execution.contextSaving} /></div><div className="execution-row-metric"><span>Cost</span><OptimizationValue before={execution.costBefore} after={execution.costAfter} /></div><span className="row-arrow"><ArrowRight size={17} /></span></Link>)}</div></div>; }
