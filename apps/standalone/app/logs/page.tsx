import LogExplorer from '../../components/LogExplorer';
import { DataNotice, PageHeader } from '../../components/ui';
import { logs } from '../../lib/operations-data';

export const metadata = { title: 'Logs' };
export default function LogsPage() { return <div className="page-stack"><PageHeader eyebrow="Diagnostics" title="Logs" description="Search structured runtime events. Raw payloads remain collapsed until they are needed." /><DataNotice /><LogExplorer logs={logs} /></div>; }
