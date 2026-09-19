import { ArrowDownRight, ArrowRight, CheckCircle2, CircleAlert, CircleDashed, Clock3, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentState, TaskStatus } from '../lib/operations-data';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function StatusBadge({ status }: { status: TaskStatus | AgentState }) {
  const icon = status === 'Completed' ? <CheckCircle2 /> : status === 'Failed' || status === 'Degraded' ? <XCircle /> : status === 'Running' || status === 'Active' ? <CircleDashed /> : <Clock3 />;
  return <span className={`status-badge status-${status.toLowerCase()}`}>{icon}{status}</span>;
}

export function Metric({ label, value, note, trend, className = '' }: { label: string; value: string; note?: string; trend?: string; className?: string }) {
  return <div className={`metric ${className}`}><span className="metric-label">{label}</span><strong>{value}</strong>{note && <span className="metric-note">{trend && <ArrowDownRight size={13} aria-hidden="true" />}{note}</span>}</div>;
}

export function OptimizationValue({ before, after, saving }: { before: string | number; after: string | number; saving?: string }) {
  return <div className="optimization-value"><span>{before}</span><ArrowRight size={16} aria-hidden="true" /><strong>{after}</strong>{saving && <em>−{saving}</em>}</div>;
}

export function DataNotice() {
  return <div className="data-notice" role="note"><CircleAlert size={16} aria-hidden="true" /><span><strong>Demo adapter</strong> — representative local data, isolated from live control-plane evidence.</span></div>;
}
