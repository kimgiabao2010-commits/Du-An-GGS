export declare class ASQgRPCClient {
    private host;
    private mode;
    private client;
    constructor(host: string, mode?: 'live' | 'mock');
    connect(): void;
    submitPatch(ruleId: string, targetFile: string, astDiffPayload: Buffer): Promise<any>;
    disconnect(): void;
}
//# sourceMappingURL=grpc-client.d.ts.map