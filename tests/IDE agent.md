🔬 IDE Agent — Agent điều tra / phân tích

IDE Agent khác CLI ở chỗ nó thiên về investigation + analysis + reasoning + security tooling.

Chức năng

① Chat với user

User:

“Ông nghĩ alert này có đáng lo không?”

IDE:

“Tôi chưa muốn kết luận High. Có repeated connection nhưng hiện tại evidence vẫn thiên về scanning. Tôi muốn kéo timeline dài hơn trước.”

② Nhận task từ Standalone

Ví dụ:

Investigate suspicious inbound MSSQL traffic.

③ Query SIEM

Đây sẽ là một chức năng rất quan trọng:

IDE
 ↓
SIEM
 ↓
Search / Hunt
 ↓
Events

④ Threat hunting

Tìm:

IP
domain
port
timeline
repeated behavior
related events
lateral activity
attack pattern

⑤ Correlation

Ví dụ:

Source IP X
    ↓
MSSQL 1433
    ↓
500 attempts
    ↓
Multiple timestamps
    ↓
Same target

IDE phân tích mối liên hệ.

⑥ Threat Intelligence

Có thể kiểm tra:

reputation
IOC
malicious history
related indicators

⑦ Phân tích security evidence

IDE có thể nói:

“Evidence này phù hợp với scanning hơn brute force vì chưa thấy authentication attempts thực sự.”

⑧ Có thể gọi tool

Ví dụ:

SIEM query
Threat Intel
Log search
Parser
Analyzer
Security tools

⑨ Trả finding về Standalone

IDE
 ↓
Finding
 ↓
Evidence
 ↓
Confidence
 ↓
Standalone

⑩ Có personality riêng

IDE có thể thiên về kiểu:

tò mò, thích đào sâu, thận trọng, sẵn sàng nói “tôi chưa chắc”.

Nó không nhất thiết nói giống Standalone.