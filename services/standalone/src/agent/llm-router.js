import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();
export class LlmRouter {
    openai;
    modelName = 'gpt-5.6-luna';
    constructor() {
        // Khởi tạo client dùng thư viện OpenAI nhưng chỏ về máy chủ Groq
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || ''
        });
    }
    /**
     * Nhận Prompt tự nhiên, giao Llama 3 phân tích và quyết định gọi Tool nào.
     */
    async routePrompt(prompt) {
        if (!process.env.OPENAI_API_KEY) {
            console.error('[LlmRouter] Thiếu OPENAI_API_KEY. Vui lòng cấu hình biến môi trường.');
            return {
                agent: 'system',
                instruction: 'Error: Chưa cấu hình OPENAI_API_KEY trong môi trường!'
            };
        }
        try {
            console.log(`[LlmRouter] Đang xử lý triage bằng ${this.modelName} (reasoning: medium)...`);
            // Định nghĩa Tool Calling cho Qwen (theo chuẩn Hướng dẫn của CISO)
            const tools = [
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
                        content: prompt
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
                const toolCall = message.tool_calls[0];
                const args = JSON.parse(toolCall.function.arguments);
                const instruction = args.target_instruction || 'Không rõ chỉ đạo';
                if (toolCall.function.name === 'delegate_cli') {
                    return { agent: 'cli', instruction };
                }
                else if (toolCall.function.name === 'delegate_ide') {
                    return { agent: 'ide', instruction };
                }
            }
            // Nếu Qwen chỉ phản hồi bằng text thường
            return {
                agent: 'chat',
                instruction: message.content || 'Tôi không hiểu ý của ngài Chỉ huy.'
            };
        }
        catch (err) {
            console.error('[LlmRouter] Lỗi gọi OpenAI API:', err.message || err);
            // Xử lý cứng một vài câu chào để Demo mượt mà kể cả khi đứt API
            const p = prompt.toLowerCase();
            if (p.includes('hello') || p.includes('chào') || p.includes('hi')) {
                return {
                    agent: 'chat',
                    instruction: 'Xin chào Chỉ Huy. Khối máy chủ AI Cloud của Groq đang tạm thời từ chối truy cập (có thể do API Key hết hạn). Tuy nhiên, Khối Module Nội bộ vẫn hoạt động hoàn hảo! Ban có thể gõ các lệnh cứng như "Inject Zero-day".'
                };
            }
            return {
                agent: 'system',
                instruction: `Error: Trục trặc Neural Network (${err.message || 'Unknown'}). Vui lòng kiểm tra lại OPENAI_API_KEY.`
            };
        }
    }
}
//# sourceMappingURL=llm-router.js.map