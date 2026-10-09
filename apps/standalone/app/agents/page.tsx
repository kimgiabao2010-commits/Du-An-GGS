import FleetConsole from '../../components/FleetConsole';
import { PageHeader } from '../../components/ui';

export const metadata = { title: 'Agents' };
export default function AgentsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Control Plane · Fleet" title="Agents"
    description="Durable connection leases. Clear boundaries between presence, readiness and verified execution." />
    <FleetConsole /></div>;
}
