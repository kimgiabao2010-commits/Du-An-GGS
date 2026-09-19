'use client';

import { ChevronDown, Eye, EyeOff, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EvidenceRecord } from '../lib/operations-data';

export default function EvidenceExplorer({ records }: { records: EvidenceRecord[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const shown = useMemo(() => records.filter(item => `${item.title} ${item.source} ${item.type}`.toLowerCase().includes(query.toLowerCase())), [records, query]);
  return <section className="panel evidence-table-panel"><div className="filter-bar"><label className="search-field"><Search size={16} /><span className="sr-only">Search evidence</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search source, type or conclusion" /></label><span className="filter-summary">{records.filter(item => item.disposition === 'Retained').length} retained · {records.filter(item => item.disposition === 'Discarded').length} discarded</span></div><div className="evidence-list">{shown.map(item => {
    const expanded = open.includes(item.id);
    return <article className="evidence-row" key={item.id}><button onClick={() => setOpen(ids => expanded ? ids.filter(id => id !== item.id) : [...ids, item.id])} aria-expanded={expanded}><span className={`evidence-dot ${item.type.toLowerCase()}`} /><span className="evidence-main"><strong>{item.title}</strong><small>{item.id} · {item.source} · {item.timestamp}</small></span><span className={`evidence-type ${item.type.toLowerCase()}`}>{item.type}</span><span className="relevance"><small>Relevance</small><strong>{item.relevance}%</strong></span><span className={`disposition ${item.disposition.toLowerCase()}`}>{item.disposition === 'Retained' ? <Eye size={14} /> : <EyeOff size={14} />}{item.disposition}</span><ChevronDown className={expanded ? 'expanded' : ''} size={17} /></button>{expanded && <div className="evidence-detail"><span>Relationship to conclusion</span><p>{item.conclusion}</p><code>source_ref: demo://evidence/{item.id.toLowerCase()}</code></div>}</article>;
  })}</div></section>;
}
