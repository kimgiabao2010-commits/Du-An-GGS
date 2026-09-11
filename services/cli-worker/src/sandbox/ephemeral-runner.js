import crypto from 'crypto';
/**
 * Đóng gói quy trình tạo và Hủy Docker Container.
 * (Đang chạy ở chế độ Safe Mock Execution cho quá trình Scaffolding)
 */
export class EphemeralSandboxRunner {
    async runInSandbox(command, args) {
        const _hash = crypto.randomBytes(4).toString('hex');
        const containerId = `asq-sandbox-${_hash}`;
        console.log(`\n[Sandbox] 🧊 Khởi tạo container cô lập vô danh: ${containerId}`);
        const startTime = Date.now();
        try {
            console.log(`[Sandbox -> ${containerId}] Đang chạy lệnh thực địa: ${command} ${args.join(' ')}`);
            // Giả lập timeout độ trễ Network
            await new Promise(res => setTimeout(res, 350));
            return {
                stdout: `Executed safely in MOCK sandbox mode. Target executed: [${command}]`,
                stderr: '',
                exitCode: 0,
                durationMs: Date.now() - startTime
            };
        }
        finally {
            // Mệnh lệnh sinh tử: Always clean up
            console.log(`[Sandbox] 💥 ĐÃ TIÊU HỦY container: ${containerId} (Zero Residue Rule Enforced)\n`);
        }
    }
}
//# sourceMappingURL=ephemeral-runner.js.map