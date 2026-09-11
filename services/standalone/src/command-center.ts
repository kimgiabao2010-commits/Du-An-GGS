import { WsCommandServer, EventBus, TokenSigner } from '@asq/sdk';
import { LlmRouter } from './agent/llm-router.js';
import { SiemReceiver } from './ingestion/siem-receiver.js';
import { EmergencyKillSwitch } from './killswitch/emergency-switch.js';
import { BlastRadiusAssessmentEngine } from './assessment/blast-radius.js';
import { ProgressiveAutonomyController } from './autonomy/progressive-controller.js';

export class CentralCommandOrchestrator {
    private wsServer: WsCommandServer;
    private llmRouter: LlmRouter;
    
    // Core Modules
    private eventBus: EventBus;
    private signer: TokenSigner; 
    private siemReceiver: SiemReceiver;
    private blastRadius: BlastRadiusAssessmentEngine;
    private autonomy: ProgressiveAutonomyController;
    public killSwitch: EmergencyKillSwitch; 
    
    constructor(port: number) {
        this.wsServer = new WsCommandServer(port);
        this.llmRouter = new LlmRouter();
        
        // Init Core Modules
        this.eventBus = EventBus.getInstance();
        this.signer = new TokenSigner();
        this.siemReceiver = new SiemReceiver();
        this.blastRadius = new BlastRadiusAssessmentEngine();
        this.autonomy = new ProgressiveAutonomyController();
        this.killSwitch = new EmergencyKillSwitch();

        this.initializeCommandCenter();
    }

    private initializeCommandCenter(): void {
        console.log(`[Central Command] 👑 BỘ CHỈ HUY TRÍ TUỆ NHÂN TẠO \& ORCHESTRATOR. Lắng nghe các Agent báo cáo tại port 4000...`);

        // ==========================================
        // 1. NGHE SỰ KIỆN TỪ BACKEND EVENT BUS (Core Logic)
        // ==========================================
        
        this.eventBus.subscribe('worker:patch_verification_done', async (sandboxReport: any) => {
            if (this.killSwitch.isHalted()) return;
            
            console.log(`\n[Central Command] 📬 Nhận hồ sơ Nghiệm thu Sandbox. Chuyển cấp Đánh giá Blast Radius.`);
            this.broadcastToUI('System (Orchestrator)', '📬 Đang chạy Đánh giá Bán kính Sát thương (Blast Radius)...');
            
            const targetFiles = ['infra/aws.tf', 'src/db/core-auth.ts']; 
            const blastAssess = this.blastRadius.calculateRiskScore(targetFiles);
            
            this.broadcastToUI('System (BlastRadius)', `Điểm rủi ro: ${blastAssess.score}/100. Đánh giá Mức độ Tự Trị...`);
            
            const finalVerdict = await this.autonomy.coordinateDeployment(blastAssess, 'dummy_patch_data_string');
            
            console.log(`\n[Central Command] 🏁 CHU KỲ KIỂM TOÁN ASQ-V4 ĐÃ ĐÓNG KÍN MẠCH. \nBáo cáo: ${finalVerdict}\n`);
            this.broadcastToUI('System (Autonomy)', `🏁 Kết luận Cấp Tự Trị: ${finalVerdict}`);
        });

        this.eventBus.subscribe('incident:escalate', (payload: any) => {
            console.log(`[Central Command] 🆘 NHẬN LỆNH CẤU CỨU TỪ TIỀN TUYẾN: ${payload.reason}`);
            this.broadcastToUI('System (IncidentResponse)', `🆘 CẤP CỨU: ${payload.reason}`);
        });

        // ==========================================
        // 2. NGHE SỰ KIỆN TỪ FRONTEND UI WEBSOCKET
        // ==========================================
        
        this.wsServer.on('message', async (msg: any) => {
            const { agentId, type, content } = msg;
            
            // Xử lý báo cáo từ các Agent/Worker -> Phát lại lên UI
            if (type === 'agent_report') {
                console.log(`\n[Central Command] 📬 Nhận báo cáo từ ${agentId}: ${content}`);
                this.broadcastToUI(agentId, content);
            }
            // Giao Dịch Từ Nút Khẩn Cấp UI (Kill Switch)
            else if (type === 'trigger_killswitch') {
                console.log(`\n[Central Command] 🔴 SIÊU CẤP: Lệnh ngắt hệ thống từ UI Dashboard!`);
                this.killSwitch.triggerGlobalKillSwitch("CISO kích hoạt từ Web Emergency Panel");
                
                // Cảnh báo đỏ lên UI
                this.broadcastToUI('KILL_SWITCH_ENGINE', '🔴 HỆ THỐNG ĐÃ BỊ ĐÓNG BĂNG HOÀN TOÀN TỪ CHỈ HUY!', true);
            }
            // Inject Test Data để chạy Pipeline Mồi
            else if (type === 'inject_zero_day' || (type==='commander_prompt' && content && content.toLowerCase().includes('inject zero-day'))) {
                this.broadcastToUI('System (Orchestrator)', '⚠️ Phát hiện Luồng tiêm nhiễm giả định! Khởi động SiemReceiver...');
                this.triggerPipelineFlow("ALERT: User Root executed bash script downloaded from 13.54.21.1 to S3 ACL.");
            }
            // Xử lý Mệnh lệnh tự nhiên từ UI (Llm Prompt)
            else if (type === 'commander_prompt') {
                if (this.killSwitch.isHalted()) {
                     this.broadcastToUI('KILL_SWITCH_ENGINE', '❌ Lỗi: Hệ thống đang bị Kéo Phanh. AI không phản hồi!', true);
                     return;
                }

                console.log(`\n[Central Command] 🗣 Chỉ huy ra lệnh: "${content}"`);
                
                const routingDecision = await this.llmRouter.routePrompt(content);
                
                if (routingDecision.agent === 'cli') {
                    console.log(`[Central Command] 👉 LLM Quyết định: Giao cho CLI Worker (${routingDecision.instruction})`);
                    this.wsServer.sendToAgent('cli-worker-agent', {
                        type: 'execute_command',
                        instruction: routingDecision.instruction
                    });
                    this.broadcastToUI('System (LLM Router)', `⚡ Chuyển lệnh Trinh sát CLI: [${routingDecision.instruction}]`);
                }
                else if (routingDecision.agent === 'ide') {
                    console.log(`[Central Command] 👉 LLM Quyết định: Giao cho IDE Agent (Điều tra) (${routingDecision.instruction})`);
                    this.wsServer.sendToAgent('ide-worker-agent', {
                        type: 'execute_command',
                        instruction: routingDecision.instruction
                    });
                    this.broadcastToUI('System (LLM Router)', `🔎 Chuyển lệnh Điều tra (IDE Agent): [${routingDecision.instruction}]`);
                }
                else {
                    this.broadcastToUI('System (AI)', routingDecision.instruction);
                }
            }
        });
    }

    private triggerPipelineFlow(rawPayload: string): void {
        const udm = this.siemReceiver.ingestRawLog(rawPayload);
        this.broadcastToUI('SIEM Receiver', `Đã làm sạch Raw Payload. Sinh UDM tracking ID: ${udm.id}`);

        const signedReconToken = this.signer.sign({
            agentId: 'cmd-hq-001',
            role: 'orchestrator-king',
            permissions: ['EXECUTE_RECON'],
            timestamp: Date.now(),
            expiresAt: Date.now() + 180000 
        });

        this.eventBus.publish('worker:recon_request', { token: signedReconToken, targetIp: udm.details.targetIp });
        this.broadcastToUI('System (Orchestrator)', `Đã kích hoạt Chu trình Pipeline ngầm! (Bắn sự kiện worker:recon_request)`);

        // Giả lập Worker nội bộ (Phục vụ mục đích test Standalone khép kín)
        setTimeout(() => {
            if (this.killSwitch.isHalted()) return;
            this.broadcastToUI('System (CLI Sandbox)', `🤖 Khởi chạy trinh sát đích ${udm.details.targetIp} trong Sandbox... Không phát hiện payload vỡ, biên dịch lại an toàn.`);
            this.eventBus.publish('worker:patch_verification_done', { status: 'safe_to_deploy' });
        }, 1500);
    }

    // Tiện ích gửi tin nhắn xuống UI FrontEnd
    private broadcastToUI(source: string, message: string, isError: boolean = false) {
        this.wsServer.broadcast({
             type: 'ui_flash',
             source: source,
             message: message,
             timestamp: new Date().toISOString(),
             isError: isError
        });
    }
}

// KHỞI KÍCH HOẠT HỆ THỐNG Ở CỔNG 4000
const hq = new CentralCommandOrchestrator(4000);
