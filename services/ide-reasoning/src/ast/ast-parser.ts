export interface AstDefect { startLine:number; endLine:number; rootCause:string; type:'IaC' | 'AppCode' }

/** A defect requires a language parser and source provenance, never a canned answer. */
export class AstSemanticParser {
  public parseIaC(_fileContent:string):AstDefect {
    throw new Error('AST_BLOCKED: approved HCL parser and source provenance are not configured');
  }
  public parseAppCode(_fileContent:string):AstDefect {
    throw new Error('AST_BLOCKED: use the read-only investigator for source-backed findings; no synthetic defect returned');
  }
}
