export interface AstDefect {
    startLine: number;
    endLine: number;
    rootCause: string;
    type: 'IaC' | 'AppCode';
}
export declare class AstSemanticParser {
    /**
     * Mô phỏng Engine tách AST từ tệp Manifest / IaC
     */
    parseIaC(fileContent: string): AstDefect;
    /**
     * Mô phỏng Phân tích Cú pháp mã nguồn (C / Nodejs / Python...)
     */
    parseAppCode(fileContent: string): AstDefect;
}
//# sourceMappingURL=ast-parser.d.ts.map