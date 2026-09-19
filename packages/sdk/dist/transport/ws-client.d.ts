import type { ASQMessage } from '../types/index.js';
export declare class ASQWebSocketClient {
    private url;
    private token;
    private maxReconnectAttempts;
    private ws;
    private reconnectAttempts;
    private stopped;
    private timer?;
    private callbacks;
    constructor(url: string, token: string, maxReconnectAttempts?: number);
    connect(): void;
    subscribe(event: string, callback: (data: any) => void): void;
    publish(event: string, payload: any): void;
    publishMessage(msg: Partial<ASQMessage>): void;
    private send;
    private emit;
    disconnect(): void;
}
//# sourceMappingURL=ws-client.d.ts.map