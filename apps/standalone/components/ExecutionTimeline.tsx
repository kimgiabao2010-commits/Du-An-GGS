'use client';

import { useState } from 'react';
import { BrainCircuit, Check, ChevronDown, CircleUserRound, Combine, Database, FileCheck2, Hammer, Minimize2, PackageOpen } from 'lucide-react';
import type { TraceNode } from '../lib/operations-data';

const icons = { task: CircleUserRound, decision: BrainCircuit, fusion: Combine, tool: Hammer, observation: PackageOpen, evidence: FileCheck2, compact: Minimize2, result: Check };

export default function ExecutionTimeline({ nodes }: { nodes: TraceNode[] }) {
  const [expanded, setExpanded] = useState<string[]>(['TR-03', 'TR-05', 'TR-06', 'TR-07']);
  const toggle = (id: string) => setExpanded(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  return <div className="trace-timeline">{nodes.map((node, index) => {
    const Icon = icons[node.type] || Database;
    const isOpen = expanded.includes(node.id) || expanded.some(id => node.id.endsWith(id));
    return <article className={`trace-node trace-${node.type}`} key={node.id}>
      <div className="trace-rail"><span className="trace-icon"><Icon size={17} /></span>{index < nodes.length - 1 && <span className="trace-line" />}</div>
      <button className="trace-content" onClick={() => toggle(node.id)} aria-expanded={isOpen}>
        <span className="trace-heading"><span><span className="trace-kind">{node.title}</span><strong>{node.summary}</strong><small>{node.meta}</small></span><ChevronDown className={isOpen ? 'expanded' : ''} size={17} /></span>
        {isOpen && node.detail && <span className="trace-detail">{node.detail}</span>}
      </button>
    </article>;
  })}</div>;
}
