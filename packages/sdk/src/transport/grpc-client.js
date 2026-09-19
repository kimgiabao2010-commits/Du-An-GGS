import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
// Load gRPC definition dynamically for large payloads
export class ASQgRPCClient {
    host;
    mode;
    client = null;
    constructor(host, mode = 'live') {
        this.host = host;
        this.mode = mode;
    }
    connect() {
        if (this.mode === 'mock') {
            if (process.env.NODE_ENV === 'production')
                throw new Error('Mock gRPC is forbidden in production');
            this.client = { mock: true };
            return;
        }
        const PROTO_PATH = fileURLToPath(new URL('../proto/asq-patch.proto', import.meta.url));
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Production gRPC requires an mTLS adapter; insecure transport is disabled');
        }
        try {
            const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true
            });
            const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
            const asqProto = protoDescriptor.asq;
            if (asqProto && asqProto.ASQPatchService) {
                this.client = new asqProto.ASQPatchService(this.host, grpc.credentials.createInsecure());
            }
        }
        catch (error) {
            throw new Error(`Unable to initialize ASQ gRPC client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async submitPatch(ruleId, targetFile, astDiffPayload) {
        if (!this.client)
            throw new Error('gRPC Client not connected');
        if (this.client.mock) {
            return { success: true, patch_hash: 'mock-hash-123' };
        }
        const request = {
            rule_id: ruleId,
            target_file: targetFile,
            ast_diff_payload: astDiffPayload,
            timestamp: new Date().toISOString()
        };
        return new Promise((resolve, reject) => {
            this.client.SubmitPatch(request, { deadline: Date.now() + 10000 }, (error, response) => {
                if (error)
                    reject(error);
                else
                    resolve(response);
            });
        });
    }
    disconnect() {
        if (this.client && !this.client.mock)
            this.client.close();
        this.client = null;
    }
}
//# sourceMappingURL=grpc-client.js.map