import crypto from 'crypto';
export class LogSanitizer {
    /**
     * Regexes để phát hiện prompt injection (Jailbreak / Override patterns)
     */
    injectionPatterns = [
        /ignore (?:all )?previous instructions/i,
        /forget everything/i,
        /system override/i,
        /developer mode/i,
        /delete files/i,
        /<\|im_start\|>/i,
    ];
    /**
     * Khử độc chuỗi đầu vào và bọc trong Boundary Nonce
     * @param input Chuỗi log đầu vào từ SIEM
     * @returns Chuỗi log đã cách ly an toàn
     */
    sanitize(input) {
        if (!input)
            return '';
        let sanitized = input;
        // Quét và làm mờ các payload tiêm mã
        for (const pattern of this.injectionPatterns) {
            sanitized = sanitized.replace(new RegExp(pattern, 'gi'), '[SANITIZED_PROMPT_INJECTION]');
        }
        // Loại bỏ các control characters
        sanitized = sanitized.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
        // Module 1 Requirement: Đóng gói với Boundary Nonce ngẫu nhiên
        const nonce = crypto.randomBytes(16).toString('hex');
        return `<!-- SECURITY BOUNDARY START [ID: ${nonce}] -->\n${sanitized}\n<!-- SECURITY BOUNDARY END -->`;
    }
}
//# sourceMappingURL=log-sanitizer.js.map