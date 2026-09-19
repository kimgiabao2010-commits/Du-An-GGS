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
exports.default = CliAgentTerminal;
const react_1 = __importStar(require("react"));
function CliAgentTerminal() {
    const [logs, setLogs] = (0, react_1.useState)([
        { id: 1, message: '[✓] Connection to ASQ-Engine established.', timestamp: new Date().toLocaleTimeString(), type: 'success' },
        { id: 2, message: 'Listening on ws://localhost:4000/cli', timestamp: new Date().toLocaleTimeString(), type: 'info' }
    ]);
    const [chatInput, setChatInput] = (0, react_1.useState)('');
    const ws = (0, react_1.useRef)(null);
    const terminalEndRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        ws.current = new WebSocket('ws://localhost:4000');
        ws.current.onopen = () => {
            const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-uuid-${Date.now()}`;
            ws.current?.send(JSON.stringify({
                message_id: msgId,
                incident_id: 'GLOBAL_INCIDENT',
                source: 'CLI_DAEMON',
                target: 'STANDALONE',
                type: 'COMMAND',
                timestamp: Date.now(),
                payload: { action: 'register_agent', agentId: 'cli-ui-terminal' }
            }));
        };
        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'STATUS' && data.payload?.action === 'ui_flash' && (data.source.includes('System (AI)') || data.source.includes('CLI_DAEMON'))) {
                    const isError = data.payload.isError || data.payload.message.includes('POLICY DENY');
                    addLog(data.payload.message, isError ? 'error' : 'action');
                }
            }
            catch (e) {
                console.error("CLI Terminal Websocket Error:", e);
            }
        };
        ws.current.onclose = () => {
            addLog('Connection lost to SIEM Base.', 'error');
        };
        return () => {
            ws.current?.close();
        };
    }, []);
    (0, react_1.useEffect)(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);
    const addLog = (message, type) => {
        setLogs(prev => [...prev, {
                id: Date.now() + Math.random(),
                message,
                timestamp: new Date().toLocaleTimeString(),
                type
            }].slice(-50));
    };
    const handleChatSubmit = (e) => {
        e.preventDefault();
        if (!chatInput.trim() || !ws.current)
            return;
        addLog(`$ ${chatInput}`, 'info');
        const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-uuid-${Date.now()}`;
        ws.current.send(JSON.stringify({
            message_id: msgId,
            incident_id: 'GLOBAL_INCIDENT',
            source: 'CLI_DAEMON',
            target: 'STANDALONE',
            type: 'COMMAND',
            timestamp: Date.now(),
            payload: { action: 'commander_prompt', content: `Ra lệnh cho CLI Agent: ${chatInput}` }
        }));
        setChatInput('');
    };
    return (<div className="mac-window" style={{ background: '#000000', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '400px' }}>
            {/* Terminal Header (macOS dots) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
               <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }}></div>
               <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }}></div>
               <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }}></div>
               <span style={{ marginLeft: '12px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'ui-monospace, monospace' }}>worker@sandbox:~</span>
            </div>
            
            {/* Terminal Body */}
            <div className="hide-scrollbar" style={{ padding: '16px', flex: 1, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.85rem', color: '#c9d1d9', overflowY: 'auto' }}>
                {logs.map(log => {
            let color = '#c9d1d9';
            if (log.type === 'success')
                color = '#7ee787';
            if (log.type === 'action')
                color = '#a5d6ff';
            if (log.type === 'error')
                color = '#ff7b72';
            if (log.type === 'info')
                color = '#8b949e';
            return (<div key={log.id} style={{ marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                            <span style={{ color }}>{log.message}</span>
                        </div>);
        })}
                <div ref={terminalEndRef}/>
            </div>

            {/* Direct Chat Input for CLI */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
                 <form onSubmit={handleChatSubmit} style={{ display: 'flex', alignItems: 'center' }}>
                     <span style={{ color: '#7ee787', marginRight: '8px', fontWeight: 'bold' }}>$</span>
                     <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Nhập OS Command hoặc Yêu cầu trinh sát..." style={{
            flex: 1,
            padding: '8px 0',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            outline: 'none',
            fontSize: '0.85rem',
            fontFamily: 'ui-monospace, Consolas, monospace'
        }}/>
                 </form>
            </div>
            <style jsx>{`
              @keyframes blink { 50% { opacity: 0; } }
            `}</style>
        </div>);
}
//# sourceMappingURL=CliAgentTerminal.js.map