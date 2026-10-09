import ApprovalConsole from '../../../components/ApprovalConsole';
import { PageHeader } from '../../../components/ui';
export default function ApprovalsPage() {
  return <><PageHeader eyebrow="CONTROL PLANE · LIVE AUTHORITY" title="Approval desk" description="Two people. One bound artifact. Proposal only — never automatic deployment." /><ApprovalConsole /></>;
}
