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
    grafanaUrl?: string;
    token: string;
    grafanaToken?: string;
}
export declare class ASQClient {
    ws: ASQWebSocketClient;
    grpc: ASQgRPCClient;
    rule: RuleSyncModule;
    grafana: GrafanaSyncModule;
    security: SecurityOpsModule;
    autonomy: AutonomyManagerModule;
    blast: BlastRadiusModule;
    constructor(options: ASQClientOptions);
    connect(): void;
    disconnect(): void;
}
//# sourceMappingURL=asq-client.d.ts.map