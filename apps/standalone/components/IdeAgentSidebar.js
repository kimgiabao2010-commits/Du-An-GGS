'use client';
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
exports.default = IdeAgentSidebar;
const react_1 = __importStar(require("react"));
const lucide_react_1 = require("lucide-react");
function IdeAgentSidebar() {
    const [logs, setLogs] = (0, react_1.useState)([]);
    const [chatInput, setChatInput] = (0, react_1.useState)('');
    const ws = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        // Tích hợp thẳng Web Agent vào Website SIEM
        ws.current = new WebSocket('ws://localhost:4000');
        ws.current.onopen = () => {
            const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-uuid-${Date.now()}`;
            ws.current?.send(JSON.stringify({
                message_id: msgId,
                incident_id: 'GLOBAL_INCIDENT',
                source: 'IDE_AGENT',
                target: 'STANDALONE',
                type: 'COMMAND',
                timestamp: Date.now(),
                payload: { action: 'register_agent', agentId: 'ide-worker-agent' }
            }));
            addLog('IDE Agent Connected to SIEM Orchestrator.', 'success');
        };
        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Lắng nghe bản tin ASQMessage
                if (data.type === 'TASK' && data.payload?.action === 'execute_command') {
                    const instruction = data.payload.instruction;
                    addLog(`Received Directive: ${instruction}`, 'action');
                    addLog(`Analyzing Virtual AST & Finding Vulnerabilistic Nodes...`, 'action');
                    // Giả lập AI tự tư duy và vá code trong thời gian thực
                    setTimeout(() => {
                        const patchResult = `[PATCH GENERATED]\n- Remove insecure rule in infra/aws.tf\n+ Enforce TLS 1.3 Strict Mode.`;
                        addLog(`Patch generation complete. Sending to Commander.`, 'success');
                        // Báo cáo hoàn tất
                        const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-uuid-${Date.now()}`;
                        ws.current?.send(JSON.stringify({
                            message_id: msgId,
                            incident_id: 'GLOBAL_INCIDENT',
                            source: 'IDE_AGENT',
                            target: 'STANDALONE',
                            type: 'EVIDENCE',
                            timestamp: Date.now(),
                            payload: { agentId: 'ide-worker-agent', content: `Đã vá mã nguồn tự động: \n${patchResult}` }
                        }));
                    }, 3000);
                }
                // Bắt cả tin nhắn từ Tổng bộ (Nút mạng LLM)
                if (data.type === 'STATUS' && data.payload?.action === 'ui_flash' && (data.source.includes('System (AI)') || data.source.includes('IDE_AGENT'))) {
                    addLog(`Tư Lệnh: ${data.payload.message}`, 'info');
                }
            }
            catch (e) {
                console.error("IDE Agent Websocket Error:", e);
            }
        };
        ws.current.onclose = () => {
            addLog('Connection lost to SIEM Base.', 'info');
        };
        return () => {
            ws.current?.close();
        };
    }, []);
    const addLog = (message, type) => {
        setLogs(prev => [...prev, {
                id: Date.now() + Math.random(),
                message,
                timestamp: new Date().toLocaleTimeString(),
                type
            }].slice(-30)); // Giữ 30 log
    };
    const handleChatSubmit = (e) => {
        e.preventDefault();
        if (!chatInput.trim() || !ws.current)
            return;
        // Gửi lệnh trực tiếp vào Mạng Lưới
        addLog(`$ ${chatInput}`, 'info');
        const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-uuid-${Date.now()}`;
        ws.current.send(JSON.stringify({
            message_id: msgId,
            incident_id: 'GLOBAL_INCIDENT',
            source: 'IDE_AGENT',
            target: 'STANDALONE',
            type: 'COMMAND',
            timestamp: Date.now(),
            payload: { action: 'commander_prompt', content: `Ra lệnh cho IDE Agent: ${chatInput}` }
        }));
        setChatInput('');
    };
    return (<div style={{
            width: '380px',
            background: 'rgba(28, 28, 30, 0.7)',
            backdropFilter: 'blur(40px)',
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
            borderTopLeftRadius: '24px',
            borderBottomLeftRadius: '24px'
        }}>
            <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
        }}>
                <div style={{ background: 'rgba(10,132,255,0.15)', padding: '8px', borderRadius: '12px', border: '1px solid rgba(10,132,255,0.3)' }}>
                    <lucide_react_1.Terminal size={24} color="#0A84FF"/>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#ffffff', fontWeight: 600, letterSpacing: '0.5px' }}>
                      IDE Agent Sandbox
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Auto-Patching & AST Analysis
                  </p>
                </div>
            </div>

            <div className="hide-scrollbar" style={{
            flex: 1,
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontFamily: 'ui-monospace, Consolas, monospace'
        }}>
                {logs.map(log => {
            let color = '#a1a1aa';
            if (log.type === 'action')
                color = '#38bdf8';
            if (log.type === 'success')
                color = '#34d399';
            return (<div key={log.id} style={{
                    padding: '12px 14px',
                    background: 'rgba(0,0,0,0.4)',
                    borderLeft: log.type === 'action' ? '3px solid #38bdf8' : log.type === 'success' ? '3px solid #34d399' : '3px solid #52525b',
                    borderRadius: '0 12px 12px 0',
                    fontSize: '0.85rem'
                }}>
                            <div style={{ fontSize: '0.7rem', color: '#71717a', marginBottom: '6px' }}>[{log.timestamp}]</div>
                            <div style={{ color, whiteSpace: 'pre-line', lineHeight: '1.5' }}>{log.message}</div>
                        </div>);
        })}
            </div>
            
            {/* Direct Chat Input */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
                 <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.5)', padding: '2px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                     <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Nhập chẩn đoán hoặc lệnh SIEM..." style={{
            flex: 1,
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            outline: 'none',
            fontSize: '0.9rem',
            fontFamily: 'ui-monospace, Consolas, monospace'
        }}/>
                     <button type="submit" style={{ padding: '0 20px', background: '#0A84FF', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', margin: '2px' }}>
                         Send
                     </button>
                 </form>
                 <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                     <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)', boxShadow: '0 0 10px var(--color-success)' }}></span>
                     Agent Online (Syncing with SIEM Base)
                 </div>
            </div>
        </div>);
}
//# sourceMappingURL=IdeAgentSidebar.js.map