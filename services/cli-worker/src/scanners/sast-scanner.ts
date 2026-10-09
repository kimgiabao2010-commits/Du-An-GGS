/** A configured offline scanner image/ruleset and verified parser are prerequisites. */
export class SastScanner {
  public async scanCodebase() {
    return {status:'BLOCKED' as const,findings:[],
      reason:'SAST_BLOCKED: source-bound scanner output is required. No synthetic findings or clean-scan claim returned.'};
  }
}
