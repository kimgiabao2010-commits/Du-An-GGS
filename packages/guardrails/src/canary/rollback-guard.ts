export type RolloutStage = '5%' | '25%' | '100%';

/** Local threshold advisory only, not an actual deployment or rollback controller. */
export class CanaryRollbackGuard {
  private totalRequests=0;
  private errorRequests=0;
  public currentStage:RolloutStage='5%';
  constructor(private errorThresholdRate=0.02) {
    if(!Number.isFinite(errorThresholdRate) || errorThresholdRate<0 || errorThresholdRate>1) throw new Error('Invalid error threshold');
  }
  public advanceStage():void {
    if(this.currentStage==='5%') this.currentStage='25%';else if(this.currentStage==='25%') this.currentStage='100%';
    this.totalRequests=0;this.errorRequests=0;
  }
  public recordRequest(isError:boolean):void {
    this.totalRequests++;if(isError) this.errorRequests++;
    if(this.totalRequests>=50 && this.errorRequests/this.totalRequests>this.errorThresholdRate) {
      throw new Error('ROLLBACK_RECOMMENDED: deployment adapter and approval required; no rollback performed');
    }
  }
  public reset():void {this.totalRequests=0;this.errorRequests=0;this.currentStage='5%';}
}
