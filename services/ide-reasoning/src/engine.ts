import { ASQWebSocketClient, TokenSigner } from '@asq/sdk';

export class IdeInvestigatorDaemon {
    private wsClient: ASQWebSocketClient;

    constructor() {
        this.wsClient = new ASQWebSocketClient('ws://localhost:4000', 'worker-token-mock');
        this.initializeListeners();
    }

    private initializeListeners(): void {
        console.log(`[IDE Agent] Đang Boot... Lên nòng súng chờ lệnh Threat Hunting qua WebSocket.`);
        
        this.wsClient.subscribe('system:connected', () => {
            console.log(`[IDE Agent] 🔗 Đã kết nối Thành Công tới Command Center!`);
            this.wsClient.publish('message', { type: 'register_agent', agentId: 'ide-worker-agent' });
        });

        // Nhận lệnh đi săn (Threat Hunting) từ Chỉ Huy
        this.wsClient.subscribe('message', async (data: any) => {
            if (data.type === 'execute_command') {
                const instruction = data.instruction;
                console.log(`\n[IDE Agent] 🔍 NHẬN LỆNH TỪ CHỈ HUY: "${instruction}"`);
                
                console.log(`[IDE Agent] 🕵️‍♂️ Khởi chạy truy vấn chéo dữ liệu SIEM và Threat Intel...`);
                
                // Trích xuất IP giả định để điều tra nếu có
                const ipMatch = instruction.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
                const targetIoC = ipMatch ? ipMatch[0] : 'Không rõ IP';

                setTimeout(() => {
                    console.log(`[IDE Agent] ✅ Truy vấn hoàn tất. Tìm thấy Bằng chứng mạng lưới.`);
                    
                    let fakeEvidence = `Qua kiểm tra SIEM (Logs tương quan):
- IP/Thực thể: ${targetIoC} có 124 liên kết dạng Scanning (Không phải Brute-Force).
- Kết luận sơ bộ: Mức độ Đe dọa [MEDIUM]. Cần kết hợp CLI thu thập Network Service ở Host để chốt hạ.`;

                    if (!ipMatch) {
                        fakeEvidence = `Qua kiểm tra phân tích Logs của Hạm đội:\n- Đã duyệt 14,000 sự kiện liên quan.\n- Kết luận: Không phát hiện bất thường cục bộ rõ ràng, cần thêm dữ liệu Host OS.`;
                    }

                    this.wsClient.publish('message', {
                        type: 'agent_report',
                        agentId: 'ide-worker-agent',
                        content: `${fakeEvidence}\n---\n*Phân tích bởi Đặc vụ Điều tra (IDE)*`
                    });
                }, 3500); // 3.5 giây phân tích giả định
            }
        });
    }
    
    public run(): void {
        this.wsClient.connect();
    }
}

// Khởi chạy
const daemon = new IdeInvestigatorDaemon();
daemon.run();
