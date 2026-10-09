import type { RemediationProposal } from '@asq/sdk';
import type { AstDefect } from '../ast/ast-parser.js';

export class PatchGenerator {
  public generateRemediation(_defect:AstDefect):RemediationProposal {
    throw new Error('PATCH_BLOCKED: source-bound proposal and isolated verification required. No fabricated diff or deployment generated.');
  }
}
