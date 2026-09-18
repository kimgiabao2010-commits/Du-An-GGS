import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';

// Load gRPC definition dynamically for large payloads
export class ASQgRPCClient {
  private client: grpc.Client | null = null;

  constructor(
    private host: string,
    private mode: 'live' | 'mock' = 'live'
  ) {}

  public connect(): void {
    if (this.mode === 'mock') {
      if (process.env.NODE_ENV === 'production') throw new Error('Mock gRPC is forbidden in production');
      this.client = { mock: true } as unknown as grpc.Client;
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
        const asqProto = protoDescriptor.asq as any;

        if (asqProto && asqProto.ASQPatchService) {
            this.client = new asqProto.ASQPatchService(
                this.host,
                grpc.credentials.createInsecure() 
            );
        }
    } catch (error) {
        throw new Error(`Unable to initialize ASQ gRPC client: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async submitPatch(ruleId: string, targetFile: string, astDiffPayload: Buffer): Promise<any> {
    if (!this.client) throw new Error('gRPC Client not connected');
    if ((this.client as any).mock) {
        return { success: true, patch_hash: 'mock-hash-123' };
    }

    const request = {
      rule_id: ruleId,
      target_file: targetFile,
      ast_diff_payload: astDiffPayload,
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      (this.client as any).SubmitPatch(request, { deadline: Date.now() + 10000 }, (error: any, response: any) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  public disconnect(): void {
    if (this.client && !(this.client as any).mock) this.client.close();
    this.client = null;
  }
}
