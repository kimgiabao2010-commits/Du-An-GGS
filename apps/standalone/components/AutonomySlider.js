"use client";
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AutonomySlider;
const react_1 = __importStar(require("react"));
function AutonomySlider() {
    const [level, setLevel] = (0, react_1.useState)(2);
    const levels = ['L0 (Manual)', 'L1 (Assisted)', 'L2 (Standard)', 'L3 (Aggressive)', 'L4 (Autonomous)'];
    return (<div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
         <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>Autonomy Intelligence</h3>
         <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{level}/4</span>
      </div>
      
      <input type="range" min="0" max="4" value={level} onChange={(e) => setLevel(Number(e.target.value))} style={{
            width: '100%',
            accentColor: '#ffffff',
            cursor: 'pointer',
            height: '4px',
            backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: '2px',
            WebkitAppearance: 'none'
        }}/>
      
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: '16px' }}>
         <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{levels[level]}</span>
         {level >= 3 && (<span style={{ fontSize: '0.75rem', marginTop: '8px', color: 'var(--color-danger)', fontWeight: 500, letterSpacing: '0.2px' }}>
               Dual Approval Layer Active
            </span>)}
      </div>
    </div>);
}
//# sourceMappingURL=AutonomySlider.js.map