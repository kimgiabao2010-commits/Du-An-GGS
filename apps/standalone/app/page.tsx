import AutonomySlider from '../components/AutonomySlider';
import KillSwitch from '../components/KillSwitch';
import OrchestratorPrompt from '../components/OrchestratorPrompt';
import Link from 'next/link';

export default function StandaloneDashboard() {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: 'transparent', color: 'var(--text-primary)', overflow: 'hidden', padding: '24px', gap: '24px' }}>
      
      {/* Cột Trái (Sidebar Thiết Lập) - Phong cách Apple VisionOS Floating Panel */}
      <div className="vision-panel" style={{ 
          width: '300px', 
          display: 'flex',
          flexDirection: 'column',
          padding: '28px 24px',
          height: '100%'
      }}>
          <div style={{ marginBottom: '40px' }}>
              <h1 className="text-gradient" style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.5px', margin: 0 }}>ASQ HEADQUARTERS</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '6px', fontWeight: 500 }}>AI Orchestrator Engine</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', flex: 1 }}>
              <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: '16px', fontWeight: 600, letterSpacing: '1px' }}>Global Controls</div>
                  <AutonomySlider />
              </div>

              <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-danger)', marginBottom: '16px', fontWeight: 600, letterSpacing: '1px' }}>Emergency System</div>
                  <KillSwitch />
              </div>
          </div>

          <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '24px' }}>
              <Link href="/siem" target="_blank" className="nav-btn">
                 <span>📊 Mở SIEM Giám Sát</span>
                 <span style={{ fontSize: '1.2rem', marginLeft: 'auto' }}>↗</span>
              </Link>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '24px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #0A84FF, #5E5CE6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(10,132,255,0.3)' }}>
                      👤
                  </div>
                  <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Tư Lệnh ASQ</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', background: 'var(--color-success)', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px var(--color-success)' }}></span> 
                          System Online
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* Cột Phải (Trung tâm Chat) - Phong cách Mac Window mờ */}
      <div className="mac-window" style={{ flex: 1, position: 'relative', height: '100%', display: 'flex' }}>
          <OrchestratorPrompt />
      </div>

    </div>
  );
}
