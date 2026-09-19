import { LockKeyhole } from 'lucide-react';
import AutonomySlider from '../../components/AutonomySlider';
import KillSwitch from '../../components/KillSwitch';
import OrchestratorPrompt from '../../components/OrchestratorPrompt';
import { PageHeader } from '../../components/ui';

export const metadata = { title: 'Command Center' };
export default function CommandPage() { return <div className="page-stack"><PageHeader eyebrow="Operate" title="Command Center" description="Submit a bounded task to the local orchestrator and follow backend status messages." /><div className="command-page-grid"><div><OrchestratorPrompt /></div><aside className="command-controls"><section className="boundary-note"><LockKeyhole size={18} /><div><strong>Local control boundary</strong><p>Authentication authorizes the WebSocket session. Model output never grants permissions or approves actions.</p></div></section><AutonomySlider /><KillSwitch /></aside></div></div>; }
