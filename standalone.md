1. 🧠 Standalone — Bộ não / Control Plane

Vai trò: quản lý toàn bộ hệ thống và điều phối các agent.

Standalone không phải worker chính. Nó giống một người quản lý/điều phối có khả năng tự suy nghĩ và trò chuyện.

Chức năng

① Chat với người dùng

Không chỉ nhận command:

“Có chuyện gì đáng chú ý hôm nay?”

Standalone có thể trả lời tự nhiên:

“Có một cụm MSSQL traffic đang tăng. Tôi chưa thấy dấu hiệu đủ mạnh để gọi là incident nghiêm trọng, nhưng tôi nghĩ nên kiểm tra thêm.”

② Hiểu mục tiêu của người dùng

Ví dụ:

“Điều tra IP này giúp tôi.”

Standalone hiểu mục tiêu → lập investigation plan.

③ Lập kế hoạch

Ví dụ:

Alert
 ↓
Standalone
 ↓
Cần:
 ├─ Network evidence
 ├─ SIEM history
 ├─ Threat intelligence
 └─ Host evidence

④ Chia việc cho Agent

Standalone
 ├──→ IDE Agent 1: Hunt SIEM
 ├──→ IDE Agent 2: Correlate events
 └──→ CLI: Collect host evidence

⑤ Theo dõi trạng thái Agent

Biết:

IDE 1 → Working
IDE 2 → Idle
CLI   → Offline

và tự xử lý khi agent lỗi/bận.

⑥ Nhận và tổng hợp kết quả

IDE 1 ──┐
IDE 2 ──┼──→ Standalone
CLI  ───┘

Standalone ghép tất cả evidence thành một context chung.

⑦ Tự quyết định bước tiếp theo

Đây là phần quan trọng nhất.

Agent result
     ↓
Standalone
     ↓
"Chưa đủ evidence"
     ↓
Tạo task mới
     ↓
Agent khác

Nó không phải workflow cứng A → B → C.

⑧ Correlation + Verdict

Standalone có thể tổng hợp:

timeline
source/destination
frequency
threat intelligence
host evidence
các finding của agent

rồi đưa ra:

FP / Suspicious / TP
Low / Medium / High / Critical

⑨ Autonomy

Quản lý mức agent được tự động làm đến đâu.

Ví dụ:

L1 → chỉ phân tích
L2 → query + investigation
L3 → được thực hiện action giới hạn
L4 → autonomous response

⑩ Permission / Approval

Đặc biệt khi CLI muốn chạy command.

Agent
 ↓
Request action
 ↓
Standalone
 ↓
Policy
 ↓
Allowed / Denied / Human approval

⑪ Audit

Ghi lại:

Agent nào làm gì, lúc nào, tại sao, task nào, kết quả gì.

⑫ Emergency control

Kill-switch, pause agent, stop autonomous workflow...

Tóm lại Standalone:

Nói chuyện + hiểu mục tiêu + lập kế hoạch + giao việc + theo dõi + tổng hợp + quyết định + kiểm soát quyền + quản lý toàn bộ agent.