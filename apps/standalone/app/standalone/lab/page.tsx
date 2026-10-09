import { PageHeader } from '../../../components/ui';
import LabReportConsole from '../../../components/LabReportConsole';
export const metadata = { title: 'Lab evidence' };
export default function LabPage() {
  return <div className="page-stack"><PageHeader eyebrow="Standalone · Authorized lab" title="Lab evidence"
    description="Inspect persisted telemetry, timeline and evidence boundaries. No demo incidents or inferred success." />
    <LabReportConsole /></div>;
}
