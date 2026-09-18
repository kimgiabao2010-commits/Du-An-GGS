import IdeAgentSidebar from '../../components/IdeAgentSidebar';
import ChartsGroup from '../../components/ChartsGroup';
import CliAgentTerminal from '../../components/CliAgentTerminal';
import Link from 'next/link';
import { Shield } from 'lucide-react';

export default function SiemDashboard() {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: 'transparent', color: 'var(--text-primary)', overflow: 'hidden', padding: '24px', gap: '24px' }}>
      
      {/* SIEM Main Content (Left) - Apple Dashboard Form Factor */}
      <div className="vision-panel hide-scrollbar" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '36px 40px', overflowY: 'auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div>
              <h1 className="text-gradient" style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ background: 'rgba(10, 132, 255, 0.15)', padding: '8px', borderRadius: '14px', border: '1px solid rgba(10, 132, 255, 0.3)', display: 'flex' }}>
                    <Shield size={28} color="var(--accent-neon)" /> 
                  </div>
                  SOC DASHBOARD
              </h1>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px', fontSize: '0.95rem', fontWeight: 500, letterSpacing: '0.5px' }}>Tập trung Giám sát Xâm nhập Hiện Trường</p>
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div style={{ padding: '10px 24px', background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.2)', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 12px rgba(255,69,58,0.1)' }}>
                  <span style={{ width: '10px', height: '10px', background: 'var(--color-danger)', borderRadius: '50%', boxShadow: '0 0 12px var(--color-danger)' }}></span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-danger)', letterSpacing: '1px' }}>DEFCON 3</span>
              </div>
              <Link href="/" className="nav-btn" style={{ width: 'auto', padding: '12px 24px', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)' }}>
                ⬅ Về Chỉ Huy
              </Link>
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
           
           <p role="note" style={{ color: '#ffb74d' }}>DEMO: biểu đồ, DEFCON và inbox bên dưới dùng dữ liệu mô phỏng, không phải telemetry SIEM. Chỉ các panel trạng thái nhận phản hồi backend.</p>
           <ChartsGroup />

           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
             {/* Inbox (Notification Style) */}
             <div className="mac-window" style={{ padding: '24px', background: 'rgba(20,20,20,0.4)', borderRadius: '20px' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                   Blast Radius Inbox
                </h3>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <li style={{ padding: '18px 20px', background: 'rgba(255, 69, 58, 0.08)', borderRadius: '14px', display: 'flex', gap: '16px', alignItems: 'center', border: '1px solid rgba(255, 69, 58, 0.15)', backdropFilter: 'blur(10px)' }}>
                     <span className="font-mono" style={{ color: 'var(--color-danger)', background: 'rgba(255, 69, 58, 0.2)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 'bold' }}>SEV-1</span> 
                     <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Zero-day payload localized in US-East.</span>
                  </li>
                  <li style={{ padding: '18px 20px', background: 'rgba(10, 132, 255, 0.08)', borderRadius: '14px', display: 'flex', gap: '16px', alignItems: 'center', border: '1px solid rgba(10, 132, 255, 0.15)', backdropFilter: 'blur(10px)' }}>
                     <span className="font-mono" style={{ color: '#0A84FF', background: 'rgba(10, 132, 255, 0.2)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 'bold' }}>INFO</span> 
                     <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Patch #992 Approved via Sandbox.</span>
                  </li>
                </ul>
             </div>

             {/* Dynamic CLI Agent Terminal */}
             <CliAgentTerminal />
           </div>

        </div>
      </div>

      {/* IDE Agent Sidebar (Right Edge) - Already styled in component but encapsulate in mac-window / vision-panel */}
      <div className="vision-panel" style={{ width: '400px', display: 'flex' }}>
         <IdeAgentSidebar />
      </div>

    </div>
  );
}
