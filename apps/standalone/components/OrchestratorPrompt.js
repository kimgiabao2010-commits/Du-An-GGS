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
exports.default = OrchestratorPrompt;
const react_1 = __importStar(require("react"));
function OrchestratorPrompt() {
    const [messages, setMessages] = (0, react_1.useState)([]);
    const [inputValue, setInputValue] = (0, react_1.useState)('');
    const ws = (0, react_1.useRef)(null);
    const messagesEndRef = (0, react_1.useRef)(null);
    // Auto-scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    (0, react_1.useEffect)(() => {
        scrollToBottom();
    }, [messages]);
    (0, react_1.useEffect)(() => {
        // Khởi tạo tin nhắn chào mừng
        setMessages([{
                id: Date.now(),
                source: 'System',
                text: 'Xin chào Chỉ huy. Tôi là hệ thống điều phối AI (Qwen/Llama) của ASQ-Engine. Tôi có thể giúp gì cho ngài trong việc vận hành hạ tầng SOC hôm nay?',
                timestamp: new Date().toLocaleTimeString()
            }]);
        // Kết nối tới Cổng 4000 của CommandCenter
        console.log("Connecting to Orchestrator Ws at ws://localhost:4000");
        ws.current = new WebSocket('ws://localhost:4000');
        ws.current.onopen = () => {
            ws.current?.send(JSON.stringify({ type: 'register_agent', agentId: 'web-dashboard' }));
        };
        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ui_flash' || data.type === 'agent_report') {
                    addMessage(data.source, data.message);
                }
            }
            catch (e) {
                console.error("Lỗi tin nhắn:", e);
            }
        };
        ws.current.onclose = () => {
            addMessage('System', '⚠️ Mất kết nối tới máy chủ Chỉ huy (Port 4000). Vui lòng kiểm tra lại dịch vụ Backend.');
        };
        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, []);
    const addMessage = (source, text) => {
        setMessages(prev => [...prev, {
                id: Date.now() + Math.random(),
                source,
                text,
                timestamp: new Date().toLocaleTimeString()
            }]);
    };
    const handleSend = () => {
        if (inputValue.trim() === '')
            return;
        const cmd = inputValue.trim();
        addMessage('CISO_Admin', cmd);
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
                type: 'commander_prompt',
                content: cmd
            }));
        }
        setInputValue('');
    };
    return (<div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: '900px', margin: '0 auto' }}>
            
            {/* Vùng Lịch Sử Chat (Flex 1 để đẩy xuống đáy) */}
            <div className="hide-scrollbar" style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px 24px 20px 24px'
        }}>
                {messages.map((msg) => {
            const isUser = msg.source === 'CISO_Admin';
            return (<div key={msg.id} className="animate-fade-in" style={{
                    display: 'flex',
                    flexDirection: isUser ? 'row-reverse' : 'row',
                    gap: '12px',
                    alignItems: 'flex-end'
                }}>
                            {/* Khung Chat iMessage Style */}
                            <div style={{
                    maxWidth: '75%',
                    background: isUser ? 'var(--chat-user-bg)' : 'var(--chat-ai-bg)',
                    borderRadius: isUser ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                    padding: '12px 18px',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    lineHeight: '1.5',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}>
                                {!isUser && (<div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
                                        {msg.source}
                                    </div>)}
                                <div style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: msg.source === 'CISO_Admin' ? 'inherit' : '"JetBrains Mono", ui-monospace, monospace'
                }}>
                                    {msg.text}
                                </div>
                            </div>
                        </div>);
        })}
                <div ref={messagesEndRef}/>
            </div>

            {/* Vùng Nhập Input (Nằm Tĩnh Ở Đáy) */}
            <div style={{
            flex: 'none',
            padding: '16px 24px 24px 24px',
            width: '100%'
        }}>
                <div style={{
            display: 'flex',
            gap: '12px',
            padding: '8px 8px 8px 20px',
            borderRadius: '30px',
            background: 'rgba(28, 28, 30, 0.8)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            alignItems: 'center'
        }}>
                    <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter')
        handleSend(); }} placeholder="Yêu cầu hệ thống SOC (VD: 'Inject Zero-day')..." style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#ffffff',
            fontSize: '1rem',
            outline: 'none',
        }}/>
                    <button onClick={handleSend} style={{
            background: inputValue.trim() ? '#ffffff' : 'rgba(255,255,255,0.1)',
            color: inputValue.trim() ? '#000000' : 'rgba(255,255,255,0.4)',
            border: 'none',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: inputValue.trim() ? 'pointer' : 'default',
            transition: 'all 0.2s',
            fontWeight: 'bold'
        }}>
                        ↑
                    </button>
                </div>
                <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    AI Orchestrator có thể mắc sai lầm. Hãy kiểm soát vòng lặp.
                </div>
            </div>
        </div>);
}
//# sourceMappingURL=OrchestratorPrompt.js.map