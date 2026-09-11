import { RemediationProposal } from '@asq/sdk';
import { AstDefect } from '../ast/ast-parser.js';
export declare class PatchGenerator {
    /**
     * Engine sinh mã vá chuẩn Git Diff và luật giám sát YARA-L
     */
    generateRemediation(defect: AstDefect): RemediationProposal;
}
//# sourceMappingURL=patch-generator.d.ts.map