import { RemediationProposal } from '@asq/sdk';
import { AstDefect } from '../ast/ast-parser.js';

export class PatchGenerator {
    /**
     * Engine sinh mã vá chuẩn Git Diff và luật giám sát YARA-L
     */
    public generateRemediation(defect: AstDefect): RemediationProposal {
        console.log(`[PatchGenerator] 📝 Đang sinh Mã Vá Vi Sai (Git Diff) & YARA-L Rule theo lỗi AST...`);
        
        const mockDiff = `
--- a/infra/aws.tf
+++ b/infra/aws.tf
@@ -12,3 +12,3 @@
 resource "aws_s3_bucket" "b" {
-  acl    = "public-read"
+  acl    = "private"
 }
`.trim();

        const mockYara = `
rule Detect_Public_S3_Terraform {
    meta:
        description = "Detects insecure AWS S3 public-read in Terraform"
    strings:
        $s1 = "acl = \\"public-read\\""
    condition:
        $s1
}
`.trim();

        return {
            codeDiff: mockDiff,
            yaraLRule: mockYara,
            targetFiles: ['infra/aws.tf'],
            suggestedAutonomyLevel: 'Level 1: Zero-Touch'
        };
    }
}
