"use client";
import React, { useState } from 'react';

export default function KillSwitch() {
  const [modalOpen, setModalOpen] = useState(false);
  const [otp, setOtp] = useState('');

  const handleTrigger = async () => {
    // Kết nối tạm thời để bắn tín hiệu
    try {
        const tempWs = new WebSocket('ws://localhost:4000');
        tempWs.onopen = () => {
            tempWs.send(JSON.stringify({ type: 'trigger_killswitch' }));
            setTimeout(() => tempWs.close(), 500);
        };
    } catch(err) {
        console.error("Lỗi gửi tín hiệu KillSwitch", err);
    }
    setModalOpen(false);
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,69,58,0.2)' }}>
      <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-danger)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Emergency System</h3>
      <button 
        onClick={() => setModalOpen(true)}
        style={{
            width: '100%',
            padding: '10px',
            background: 'var(--color-danger)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
            backdropFilter: 'blur(10px)'
        }}
        onMouseOver={e => (e.currentTarget.style.background = '#ff2d20')}
        onMouseOut={e => (e.currentTarget.style.background = 'var(--color-danger)')}
      >
        Trigger Kill-Switch
      </button>

      {modalOpen && (
        <div style={{ 
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(0,0,0,0.4)', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 
        }}>
           {/* macOS System Auth Window Style */}
           <div style={{ 
               width: '380px', 
               background: 'rgba(30, 30, 30, 0.85)', 
               backdropFilter: 'blur(40px)', 
               WebkitBackdropFilter: 'blur(40px)',
               border: '1px solid rgba(255,255,255,0.1)', 
               borderRadius: '14px', 
               boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset', 
               overflow: 'hidden'
           }}>
             <div style={{ padding: '24px 24px 16px 24px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                 {/* Icon ổ khóa macOS */}
                 <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>
                     🔒
                 </div>
                 <div>
                     <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff', marginBottom: '8px', lineHeight: 1.2 }}>
                        System requires authentication to Trigger Kill-Switch.
                     </h2>
                     <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
                         This action severs all connections and quarantines the ASQ Network.
                     </p>
                     
                     <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#ffffff', width: '60px' }}>2FA Code:</span>
                        <input 
                            type="text" 
                            maxLength={6}
                            value={otp} 
                            onChange={e => setOtp(e.target.value)} 
                            autoFocus
                            style={{ 
                                flex: 1, 
                                padding: '6px 8px', 
                                background: 'rgba(255,255,255,0.1)', 
                                color: '#ffffff', 
                                border: '1px solid rgba(255,255,255,0.2)', 
                                borderRadius: '6px', 
                                fontSize: '0.9rem', 
                                outline: 'none',
                                letterSpacing: '2px',
                                fontFamily: 'ui-monospace, monospace'
                            }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#0A84FF'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(10,132,255,0.3)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.boxShadow = 'none'; }}
                        />
                     </div>
                 </div>
             </div>

             {/* macOS Buttons Area */}
             <div style={{ 
                 background: 'rgba(255,255,255,0.03)', 
                 padding: '14px 24px', 
                 display: 'flex', 
                 justifyContent: 'flex-end', 
                 gap: '10px',
                 borderTop: '1px solid rgba(255,255,255,0.08)'
             }}>
                <button 
                   style={{ padding: '6px 16px', background: 'rgba(255,255,255,0.12)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }} 
                   onClick={() => setModalOpen(false)}
                   onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                   onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
                >
                   Cancel
                </button>
                <button 
                   style={{ padding: '6px 16px', background: 'var(--color-danger)', color: '#ffffff', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }} 
                   onClick={handleTrigger}
                >
                   Authenticate
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
