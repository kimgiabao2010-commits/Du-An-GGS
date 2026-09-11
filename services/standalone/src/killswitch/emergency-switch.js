import { EventBus } from '@asq/sdk';
export class EmergencyKillSwitch {
    revokedNonces;
    isSystemHalted;
    eventBus;
    constructor() {
        this.revokedNonces = new Set();
        this.isSystemHalted = false;
        // Bám vào mạch sự kiện tổng để ngắt nguồn Toàn Mạng nếu cần
        this.eventBus = EventBus.getInstance();
    }
    triggerGlobalKillSwitch(reason) {
        this.isSystemHalted = true;
        console.error(`\n[EMERGENCY KILL-SWITCH] 🔴 KÍCH HOẠT ĐÓNG ĐƯỜNG MÁU TOÀN CỤC!`);
        console.error(`[EMERGENCY KILL-SWITCH] Lý do đình chỉ: ${reason}`);
        console.error(`[EMERGENCY KILL-SWITCH] Trạng thái: Hủy mọi Container, Tệ liệt hoá Trí tuệ Sinh tạo AI.`);
        this.eventBus.publish('system:halt', { timestamp: Date.now(), reason });
    }
    resetKillSwitch() {
        this.isSystemHalted = false;
        console.log(`\n[EMERGENCY KILL-SWITCH] 🟢 Khôi phục thành công. Hệ thống sống lại.`);
    }
    revokeNonce(nonce) {
        this.revokedNonces.add(nonce);
        console.log(`[EMERGENCY KILL-SWITCH] Trảm vĩnh viễn Token (Gắn mã Blacklist): ${nonce}`);
    }
    isNonceRevoked(nonce) {
        return this.revokedNonces.has(nonce);
    }
    isHalted() {
        return this.isSystemHalted;
    }
}
//# sourceMappingURL=emergency-switch.js.map