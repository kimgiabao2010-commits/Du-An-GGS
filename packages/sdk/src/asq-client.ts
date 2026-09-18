import { ASQWebSocketClient } from './transport/ws-client.js';
import { ASQgRPCClient } from './transport/grpc-client.js';
import { RuleSyncModule } from './modules/rule-sync.js';
import { GrafanaSyncModule } from './modules/grafana-sync.js';
import { SecurityOpsModule } from './modules/security-ops.js';
import { AutonomyManagerModule } from './modules/autonomy-manager.js';
import { BlastRadiusModule } from './modules/blast-radius.js';

export interface ASQClientOptions {
  wsUrl?: string;
  grpcUrl?: string;
  grpcMode?: 'live' | 'mock';
  grafanaUrl?: string;
  token: string;
  grafanaToken?: string;
}

export class ASQClient {
  public ws: ASQWebSocketClient;
  public grpc: ASQgRPCClient;

  public rule: RuleSyncModule;
  public grafana: GrafanaSyncModule;
  public security: SecurityOpsModule;
  public autonomy: AutonomyManagerModule;
  public blast: BlastRadiusModule;

  constructor(options: ASQClientOptions) {
    this.ws = new ASQWebSocketClient(options.wsUrl || 'ws://localhost:4000', options.token);
    this.grpc = new ASQgRPCClient(options.grpcUrl || 'localhost:50051', options.grpcMode);

    this.rule = new RuleSyncModule(this.ws);
    this.grafana = new GrafanaSyncModule(options.grafanaUrl || 'http://localhost:3000', options.grafanaToken || '');
    this.security = new SecurityOpsModule(this.ws);
    this.autonomy = new AutonomyManagerModule(this.ws);
    this.blast = new BlastRadiusModule(this.ws);
  }

  public connect(): void {
    this.ws.connect();
    this.grpc.connect();
  }

  public disconnect(): void {
    this.ws.disconnect();
    this.grpc.disconnect();
  }
}
