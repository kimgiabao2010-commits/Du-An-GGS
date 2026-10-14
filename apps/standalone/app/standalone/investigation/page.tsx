import { PageHeader } from '../../../components/ui';
import InvestigationConsole from '../../../components/InvestigationConsole';
export const metadata = { title: 'Investigation' };
export default function InvestigationPage() {
  return <div className="page-stack"><PageHeader eyebrow="Standalone · Evidence first" title="Investigation"
    description="Follow the retained evidence frontier. Inspect what is known, what is missing, and why the authority chose its next step." />
    <InvestigationConsole /></div>;
}
