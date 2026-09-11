export declare class LogSanitizer {
    /**
     * Regexes để phát hiện prompt injection (Jailbreak / Override patterns)
     */
    private injectionPatterns;
    /**
     * Khử độc chuỗi đầu vào và bọc trong Boundary Nonce
     * @param input Chuỗi log đầu vào từ SIEM
     * @returns Chuỗi log đã cách ly an toàn
     */
    sanitize(input: string): string;
}
//# sourceMappingURL=log-sanitizer.d.ts.map