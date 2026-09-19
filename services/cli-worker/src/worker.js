import { exec } from 'child_process';
import { ASQWebSocketClient } from '@asq/sdk';
import { NetworkReconScanner } from './scanners/network-recon.js';
export class CliWorkerDaemon {
    wsClient;
    reconScanner;
    constructor() {
        this.wsClient = new ASQWebSocketClient('ws://localhost:4000', 'worker-token-mock');
        this.reconScanner = new NetworkReconScanner();
        this.initializeListeners();
    }
    // Cơ chế phân quyền Security Boundary rẽ nhánh Policy
    isSafeCommand(cmd) {
        const lower = cmd.toLowerCase();
        const allowedPrefixes = ['ping', 'netstat', 'ipconfig', 'hostname', 'systeminfo'];
        return allowedPrefixes.some(prefix => lower.startsWith(prefix));
    }
    initializeListeners() {
        console.log(`[CLI Daemon] Đang Boot... Lên nòng súng chờ lệnh qua WebSocket.`);
        this.wsClient.subscribe('system:connected', () => {
            console.log(`[CLI Daemon] 🔗 Đã kết nối Thành Công tới Command Center!`);
            // Đăng ký với commander
            this.wsClient.publishMessage({
                source: 'CLI_DAEMON',
                target: 'STANDALONE',
                type: 'COMMAND',
                payload: { action: 'register_agent', agentId: 'cli-worker-agent' }
            });
        });
        // Nhận lệnh tùy biến (Prompt-based Command) từ Standalone FrontEnd
        this.wsClient.subscribe('message', async (data) => {
            if (data.type === 'TASK' && data.payload?.action === 'execute_command') {
                const instruction = data.payload.instruction;
                console.log(`\n[CLI Daemon] 🎯 NHẬN LỆNH TỪ CHỈ HUY: "${instruction}"`);
                // Trích xuất lệnh mô phỏng từ Câu lệnh tự nhiên (Vì AI Groq ở trên có thể trả về câu Instruction dạng "Hãy chạy lệnh ping 8.8.8.8" hoặc "ping 8.8.8.8")
                let commandToRun = instruction;
                // Thủ thuật bóc tách nếu instruction là văn bản dài
                const match = instruction.match(/(ping|netstat|ipconfig|hostname|systeminfo)[\s\w\.\-]+/i);
                if (match) {
                    commandToRun = match[0];
                }
                console.log(`[CLI Daemon] 🛠 Chuẩn bị thực thi OS Host Command: [${commandToRun}]`);
                if (!this.isSafeCommand(commandToRun)) {
                    console.error(`[CLI Daemon] ⛔ TỪ CHỐI THỰC THI (Policy Deny): ${commandToRun}`);
                    this.wsClient.publishMessage({
                        source: 'CLI_DAEMON',
                        target: 'STANDALONE',
                        type: 'EVIDENCE',
                        payload: { agentId: 'cli-worker-agent', content: `⚠️ [POLICY DENY] Hành động \`${commandToRun}\` bị hệ thống chặn vì nằm ngoài Security Boundary (Trinh sát OS).` }
                    });
                    return;
                }
                // Thực thi thật (Execution)
                exec(commandToRun, (error, stdout, stderr) => {
                    const output = stdout ? stdout.substring(0, 500) : (stderr || error?.message || 'No output');
                    console.log(`[CLI Daemon] ✅ Thực thi xong. Output: \n${output}`);
                    this.wsClient.publishMessage({
                        source: 'CLI_DAEMON',
                        target: 'STANDALONE',
                        type: 'EVIDENCE',
                        payload: { agentId: 'cli-worker-agent', content: `Hoàn tất thu thập Host Evidence:\nLệnh: \`${commandToRun}\`\nKết quả:\n${output}\n---\n*Truy xuất bởi CLI Agent OS*` }
                    });
                });
            }
        });
    }
    run() {
        this.wsClient.connect();
    }
}
// Khởi chạy
const daemon = new CliWorkerDaemon();
daemon.run();
//# sourceMappingURL=worker.js.map