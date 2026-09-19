'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LogRecord } from '../lib/operations-data';

export default function LogExplorer({ logs }: { logs: LogRecord[] }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('All');
  const [open, setOpen] = useState<string[]>([]);
  const shown = useMemo(() => logs.filter(log => (severity === 'All' || log.severity === severity) && `${log.message} ${log.agent} ${log.executionId}`.toLowerCase().includes(query.toLowerCase())), [logs, query, severity]);
  return <section className="panel log-panel"><div className="filter-bar"><label className="search-field"><Search size={16} /><span className="sr-only">Search logs</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search message, execution or agent" /></label><label className="select-field"><span className="sr-only">Severity</span><select value={severity} onChange={event => setSeverity(event.target.value)}><option>All</option><option>INFO</option><option>WARN</option><option>ERROR</option></select></label></div><div className="log-header"><span>Time</span><span>Severity</span><span>Execution</span><span>Agent</span><span>Message</span><span /></div><div className="log-list">{shown.map(log => {
    const expanded = open.includes(log.id);
    return <article className="log-entry" key={log.id}><button onClick={() => setOpen(ids => expanded ? ids.filter(id => id !== log.id) : [...ids, log.id])} aria-expanded={expanded}><span className="mono">{log.timestamp}</span><span className={`log-severity ${log.severity.toLowerCase()}`}>{log.severity}</span><span className="mono">{log.executionId}</span><span>{log.agent}</span><strong>{log.message}</strong><ChevronDown className={expanded ? 'expanded' : ''} size={16} /></button>{expanded && <pre>{log.payload}</pre>}</article>;
  })}{shown.length === 0 && <div className="empty-state">No log entries match this view.</div>}</div></section>;
}
