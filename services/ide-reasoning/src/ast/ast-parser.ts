export interface AstDefect {
    startLine: number;
    endLine: number;
    rootCause: string;
    type: 'IaC' | 'AppCode';
}

export class AstSemanticParser {
    /**
     * Mô phỏng Engine tách AST từ tệp Manifest / IaC
     */
    public parseIaC(fileContent: string): AstDefect {
        console.log(`[AstParser] 🌳 Đang cày xới Cây Cú pháp IaC (Terraform)... Định vị Root Cause`);
        // Mock tìm thấy lỗi public-read
        return {
            startLine: 12,
            endLine: 15,
            rootCause: 'AWS S3 Bucket ACL configure to `public-read` (CVE Data Leak Threat)',
            type: 'IaC'
        };
    }

    /**
     * Mô phỏng Phân tích Cú pháp mã nguồn (C / Nodejs / Python...)
     */
    public parseAppCode(fileContent: string): AstDefect {
        console.log(`[AstParser] 🌳 Đang cày xới Hệ thống AST Mã Nguồn Ứng Dụng...`);
        return {
            startLine: 45,
            endLine: 45,
            rootCause: 'SQL Injection without parameterized bind in function `getUser()`',
            type: 'AppCode'
        };
    }
}
