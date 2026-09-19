import { OpenAI } from 'openai';
import { ContextBudgeter } from '@asq/guardrails';
import * as dotenv from 'dotenv';
dotenv.config();

export class LlmRouter {
    private openai: OpenAI | null;
    private contextBudgeter = new ContextBudgeter({ maxTokens: Number(process.env.ASQ_CONTEXT_MAX_TOKENS ?? 4096) });
    private modelName = process.env.ASQ_ROUTER_MODEL ||
        (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-5.6-luna');

    constructor() {
        // Khởi tạo client dùng thư viện OpenAI nhưng chỏ về máy chủ Groq
        const apiKey = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
        this.openai = apiKey ? new OpenAI({
            apiKey,
            ...(process.env.OPENAI_API_KEY ? {} : { baseURL: 'https://api.groq.com/openai/v1' }),
            timeout: 20000,
            maxRetries: 0
        }) : null;
    }

    /**
     * Nhận Prompt tự nhiên, giao Llama 3 phân tích và quyết định gọi Tool nào.
     */
    public async routePrompt(prompt: string): Promise<any> {
        if (!this.openai) {
            console.error('[LlmRouter] Thiếu OPENAI_API_KEY. Vui lòng cấu hình biến môi trường.');
            return {
                agent: 'system',
                instruction: 'Error: Chưa cấu hình OPENAI_API_KEY trong môi trường!'
            };
        }

        try {
            const context = this.contextBudgeter.prepare(prompt);
            console.info(`[LlmRouter] Context ${context.inputTokenEstimate} -> ${context.outputTokenEstimate} tokens; ` +
                `pruned=${context.omittedCharacters} quarantined=${context.quarantinedFragments} redacted=${context.redactedSecrets}`);
            console.log(`[LlmRouter] Đang xử lý điều phối bằng ${this.modelName} (reasoning: medium)...`);
            
            // Định nghĩa Tool Calling cho Qwen (theo chuẩn Hướng dẫn của CISO)
            const tools: any = [
                {
                    type: "function",
                    function: {
                        name: "delegate_cli",
                        description: "Ra lệnh cho Lính Thực thi (CLI Worker) đi kiểm tra trực tiếp hệ điều hành ở dưới host. Hãy dùng nó khi cần thu thập bằng chứng từ máy tính: processes, network connections, netstat, open ports, files.",
                        parameters: {
                            type: "object",
                            properties: {
                                target_instruction: {
                                    type: "string",
                                    description: "Lệnh thực thi hoặc mô tả dữ liệu OS cần lấy (Ví dụ: 'Kiểm tra process list', 'Lấy thông tin mạng netstat')"
                                }
                            },
                            required: ["target_instruction"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "delegate_ide",
                        description: "Ra lệnh cho Trinh sát Điều Tra (IDE Agent) đi Threat Hunting, query SIEM, tương quan dữ liệu (Correlation) và lập luận an ninh (Reasoning) từ các bằng chứng bảo mật.",
                        parameters: {
                            type: "object",
                            properties: {
                                target_instruction: {
                                    type: "string",
                                    description: "Yêu cầu điều tra cụ thể (Ví dụ: 'Phân tích các log MSSQL inbound', 'Tìm IP đáng ngờ này trong SIEM')"
                                }
                            },
                            required: ["target_instruction"]
                        }
                    }
                }
            ];

            const response = await this.openai.chat.completions.create({
                model: this.modelName,
                messages: [
                    {
                        role: "system",
                        content: `Bạn là Tướng Tư Lệnh (Standalone CommandCenter) của mạng lưới An Ninh ASQ-Engine đa đặc vụ (Multi-agent System). 
Dưới quyền bạn có 2 Đặc vụ (Agents):
1. IDE Agent: Investigating / Threat Hunting / SIEM Query. Chuyên phân tích Log, đào sâu tương quan sự kiện, suy luận mức độ nguy hiểm.
2. CLI Agent: Executing / Host Operation. Chuyên thu thập bằng chứng máy tính thật (OS, process, network, service).

LUẬT LỆ RẮN CẮN (CỰC KỲ QUAN TRỌNG):
- Bạn KHÔNG BAO GIỜ tự mình đi tra SIEM hay gõ lệnh OS. Bạn là Chỉ huy (Think / Plan / Delegate).
- Dựa vào câu nói của User (đôi khi tự nhiên như 'máy này chạy cái gì lạ không?', hoặc 'điều tra alert này'), bạn phải gọi FUNCTION TOOL tương ứng để uỷ quyền cho đệ tử làm.
- Nếu không cần gọi đệ tử, hãy trò chuyện tự nhiên với User theo ngữ khí của một Tư lệnh bảo mật tối cao.`
                    },
                    {
                        role: "user",
                        content: context.modelInput
                    }
                ],
                tools: tools,
                reasoning_effort: 'medium',
                temperature: 0.4,
                max_tokens: 2048 // Đã gỡ bỏ giới hạn 50 tokens, cho phép AI trả về câu chữ dài và trò chuyện tự nhiên
            });

            // Lấy ra message phản hồi
            const message = response.choices[0].message;

            // Kiểm tra xem LLM có quyết định gọi Tool nào không
            if (message.tool_calls && message.tool_calls.length > 0) {
                const toolCall: any = message.tool_calls[0];
                const args = JSON.parse(toolCall.function.arguments);
                const instruction = args.target_instruction;
                if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 16000) {
                    throw new Error('Invalid tool instruction');
                }
                
                if (toolCall.function.name === 'delegate_cli') {
                    return { agent: 'cli', instruction };
                } else if (toolCall.function.name === 'delegate_ide') {
                    return { agent: 'ide', instruction };
                }
            }
            
            // Nếu Qwen chỉ phản hồi bằng text thường
            return {
                agent: 'chat',
                instruction: message.content || 'Tôi không hiểu ý của ngài Chỉ huy.'
            };

        } catch {
            // Fail closed. Do not fabricate a successful fallback or expose provider error details.
            return { agent: 'system', instruction: 'LLM_UNAVAILABLE: Không thể hoàn tất điều phối. Chưa gửi task tới worker.' };
        }
    }
}
