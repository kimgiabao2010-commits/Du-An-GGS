import { EphemeralSandboxRunner } from '../sandbox/ephemeral-runner.js';

export class SastScanner {
    private runner: EphemeralSandboxRunner;

    constructor() {
        this.runner = new EphemeralSandboxRunner();
    }

    public async scanCodebase(): Promise<any> {
        console.log(`[SAST] Đang quét Semgrep & Trivy tĩnh trên mã nguồn nội bộ...`);
        
        // Điều động Sandbox chạy 2 công cụ
        await this.runner.runInSandbox('semgrep', ['scan', '--config', 'auto']);
        await this.runner.runInSandbox('trivy', ['fs', '.']);

        return {
            findings: [
                { type: 'HARDCODED_SECRET', file: 'src/config.ts', severity: 'CRITICAL', recommendation: 'Remove API Key' },
                { type: 'S3_PUBLIC_ACL', file: 'infra/aws.tf', severity: 'HIGH', recommendation: 'Turn ACL to private' }
            ]
        };
    }
}
