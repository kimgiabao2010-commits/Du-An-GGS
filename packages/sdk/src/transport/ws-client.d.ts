export declare class ASQWebSocketClient {
    private ws;
    private url;
    private token;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private callbacks;
    constructor(url: string, token: string, maxReconnectAttempts?: number);
    connect(): void;
    private handleDisconnect;
    subscribe(event: string, callback: (data: any) => void): void;
    publish(event: string, payload: any): void;
    private emit;
    disconnect(): void;
}
//# sourceMappingURL=ws-client.d.ts.map