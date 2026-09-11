import { LogSanitizer } from '@asq/guardrails';
import { UDMEvent } from '@asq/sdk';

export class SiemReceiver {
    private sanitizer: LogSanitizer;

    constructor() {
        // Tái sử dụng LogSanitizer Guardrail đã test ở Phân đoạn 2
        this.sanitizer = new LogSanitizer(); 
    }

    public ingestRawLog(rawPayload: string): UDMEvent {
        console.log(`[SIEM Ingestion] Thu nhận cảnh báo Cấp độ Nguồn. Đang nhúng qua bể lọc (LogSanitizer)...`);
        
        // Trấn áp Payload độc hại từ IP Attackers bằng Boundary Nonces
        const sanitizedLog = this.sanitizer.sanitize(rawPayload);
        
        const trackingId = `siem-alert-${Date.now()}`;
        console.log(`[SIEM Ingestion] Đã làm sạch & Khóa dải Inject. Sinh Chuẩn Dữ liệu Tổ hợp UDM: ${trackingId}`);
        
        return {
            id: trackingId,
            timestamp: Date.now(),
            type: 'SIEM_ALERT',
            severity: 'HIGH',
            source: 'SIEM-Chronicle',
            details: {
                principalIp: '1.2.3.4 (Attacker Mock)',
                targetIp: '192.168.1.1 (Internal Target)',
                rawPayload: `[CLEANSED] ${sanitizedLog}`
            }
        };
    }
}
