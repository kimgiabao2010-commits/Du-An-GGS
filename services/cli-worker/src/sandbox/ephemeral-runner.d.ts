export interface SandboxResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}
/**
 * Đóng gói quy trình tạo và Hủy Docker Container.
 * (Đang chạy ở chế độ Safe Mock Execution cho quá trình Scaffolding)
 */
export declare class EphemeralSandboxRunner {
    runInSandbox(command: string, args: string[]): Promise<SandboxResult>;
}
//# sourceMappingURL=ephemeral-runner.d.ts.map