import { EventEmitter } from 'node:events';
import { TokenSigner } from '../security/token-signer.js';
export interface CommandServerOptions {
    signer?: TokenSigner;
    host?: string;
    allowedOrigin?: string;
}
export declare class WsCommandServer extends EventEmitter {
    private wss;
    private clients;
    private signer;
    constructor(port: number, options?: CommandServerOptions);
    sendToAgent(agentId: string, payload: any): boolean;
    broadcast(payload: any): void;
    private envelope;
    ready(): Promise<number>;
    close(): Promise<void>;
}
//# sourceMappingURL=ws-server.d.ts.map