export declare class ASQgRPCClient {
    private host;
    private client;
    constructor(host: string);
    connect(): void;
    submitPatch(ruleId: string, targetFile: string, astDiffPayload: Buffer): Promise<any>;
}
//# sourceMappingURL=grpc-client.d.ts.map