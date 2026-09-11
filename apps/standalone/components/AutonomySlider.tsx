"use client";
import React, { useState } from 'react';

export default function AutonomySlider() {
  const [level, setLevel] = useState(2);
  const levels = ['L0 (Manual)', 'L1 (Assisted)', 'L2 (Standard)', 'L3 (Aggressive)', 'L4 (Autonomous)'];

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
         <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>Autonomy Intelligence</h3>
         <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{level}/4</span>
      </div>
      
      <input 
        type="range" 
        min="0" max="4" 
        value={level} 
        onChange={(e) => setLevel(Number(e.target.value))} 
        style={{ 
            width: '100%', 
            accentColor: '#ffffff', 
            cursor: 'pointer',
            height: '4px',
            backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: '2px',
            WebkitAppearance: 'none'
        }} 
      />
      
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: '16px' }}>
         <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{levels[level]}</span>
         {level >= 3 && (
            <span style={{ fontSize: '0.75rem', marginTop: '8px', color: 'var(--color-danger)', fontWeight: 500, letterSpacing: '0.2px' }}>
               Dual Approval Layer Active
            </span>
         )}
      </div>
    </div>
  );
}
