export declare class LlmRouter {
    private openai;
    private modelName;
    constructor();
    /**
     * Nhận Prompt tự nhiên, giao Llama 3 phân tích và quyết định gọi Tool nào.
     */
    routePrompt(prompt: string): Promise<any>;
}
//# sourceMappingURL=llm-router.d.ts.map