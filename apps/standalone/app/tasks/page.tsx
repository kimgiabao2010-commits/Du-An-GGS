import { Plus } from 'lucide-react';
import Link from 'next/link';
import TaskExplorer from '../../components/TaskExplorer';
import { DataNotice, PageHeader } from '../../components/ui';
import { tasks } from '../../lib/operations-data';

export const metadata = { title: 'Tasks' };
export default function TasksPage() { return <div className="page-stack"><PageHeader eyebrow="Work queue" title="Tasks" description="Track assignment, execution progress, cost and outcome across the agent fleet." actions={<Link className="button primary" href="/command"><Plus size={16} />New task</Link>} /><DataNotice /><TaskExplorer tasks={tasks} /></div>; }
