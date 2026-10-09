/** Network egress is disabled in the staging evidence-first sandbox. */
export class NetworkReconScanner {
  public async scanTarget(ip:string) {
    return {status:'BLOCKED' as const,target:ip,openPorts:[],vulnerabilities:[],
      reason:'NETWORK_RECON_BLOCKED: no authorized network execution adapter. No scan was performed.'};
  }
}
