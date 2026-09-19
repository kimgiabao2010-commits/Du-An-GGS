'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { OperationTask, TaskStatus } from '../lib/operations-data';
import { StatusBadge } from './ui';

const filters: Array<'All' | TaskStatus> = ['All', 'Running', 'Completed', 'Failed', 'Queued'];

export default function TaskExplorer({ tasks }: { tasks: OperationTask[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof filters)[number]>('All');
  const shown = useMemo(() => tasks.filter(task => (filter === 'All' || task.status === filter) && `${task.title} ${task.id} ${task.agent}`.toLowerCase().includes(query.toLowerCase())), [tasks, query, filter]);
  return <section className="panel table-panel explorer-panel">
    <div className="filter-bar"><label className="search-field"><Search size={16} /><span className="sr-only">Search tasks</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks" /></label><div className="segmented" aria-label="Task status filter">{filters.map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    <div className="table-wrap"><table><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>Progress</th><th>Duration</th><th className="numeric">Cost</th><th>Result</th></tr></thead><tbody>{shown.map(task => <tr key={task.id}><td><Link className="table-primary" href={task.id === 'TSK-2481' ? '/executions/EXE-8421' : '/tasks'}>{task.title}</Link><span className="table-secondary">{task.id} · {task.startedAt}</span></td><td><StatusBadge status={task.status} /></td><td>{task.agent}</td><td><div className="table-progress"><span style={{ width: `${task.progress}%` }} /></div><span className="progress-value">{task.progress}%</span></td><td className="mono">{task.duration}</td><td className="numeric mono">{task.cost}</td><td>{task.result}</td></tr>)}</tbody></table>{shown.length === 0 && <div className="empty-state">No tasks match this view.</div>}</div>
  </section>;
}
