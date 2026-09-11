# TRẠNG THÁI HIỆN TẠI VÀ LỘ TRÌNH DỰ ÁN: ASQ-ENGINE

Tài liệu này ghi nhận quá trình tái cấu trúc giao diện, kết nối các mạch điều khiển (Central Command) và các bộ vi xử lý ngầm (Agents), cũng như liệt kê các bước hành động tiếp theo để nâng cấp trạm SOC.

---

## 🟢 NHỮNG HẠNG MỤC ĐÃ HOÀN THÀNH (WHAT'S DONE)

### 1. Phân Tách Kiến Trúc Giao Diện (Multi-Tab UI)
Hệ thống đã được thiết kế đúng chuẩn Multi-monitor của dòng Cybersecurity chuyên nghiệp:
- **Standalone Hub (`/`)**: Trạm Chỉ Huy Trung Tâm. Đã được xóa bỏ thiết kế cứng nhắc cũ, thay bằng giao diện trò chuyện Chat-bubble giống hệt ChatGPT / Gemini. Giao diện ưu tiên không gian cho các cuộc hội thoại giữa Chỉ Huy (CISO) và hệ thống phân tích AI. 
- **SIEM Dashboard (`/siem`)**: Bảng điều khiển Giám sát Độc lập. Nơi lý tưởng để kéo sang màn hình thứ hai, vận hành 24/7 cảnh báo lỗ hổng.

### 2. Lột Xác Thẩm Mỹ - Giao diện Chuẩn Apple (VisionOS Glassmorphism)
- Loại bỏ các đường viền gãy khúc, đổi sang thiết kế nền Kính Mờ sâu (`backdrop-filter: blur(40px) saturate(200%)`).
- Bo góc tuyệt đối (`24px`), đổ bóng tinh tế và tái cấu trúc hệ màu sắc chuyển mượt (Mesh Gradients) giống trải nghiệm không gian của Apple.
- Cột *Trái (Sidebar)* thu thập các tính năng Global Settings (Autonomy Slider, Kill Switch) rất tinh giản để giải phóng tầm nhìn.

### 3. Trực Quan Hóa Dữ Liệu Thời Gian Thực (Visual Dashboards)
- Cài đặt thành công `recharts` và `lucide-react` để biến SIEM thành một Bảng Thông tin (Dashboard) sống động.
- Triển khai **Live Network Traffic** (Biểu đồ Đường), **Attack Vectors** (Biểu đồ Tròn vành khuyên) và **Geo-Threat Density** (Biểu đồ Cột ngang). 
- Kết xuất thành công dữ liệu và khắc phục dứt điểm các lỗi Next.js Server Components.

### 4. Kết Nối Luồng (WebSockets)
- Khởi tạo *Command Center (Port 4000)* đóng vai trò như tuyến xương sống (Backbone).
- Khi gõ lệnh từ Standalone Tab, Llama-3/Qwen AI sẽ nhảy vào phân tích ngữ nghĩa, sau đó điều hướng luồng thông điệp ngầm cho *IDE Agent* đang trực bên kia Tab SIEM tự động kích hoạt tiến trình làm việc.

---

## 🚀 NHỮNG HẠNG MỤC DỰ KIẾN (ROADMAP / NEXT STEPS)

### Giai đoạn 1: Thông Luồng Căn Bản Đáy (Backend Data Live-link)
1. **Kết Nối Dữ Liệu CLI Worker**:
   - Khởi động CLI Native Daemon thực sự thay vì ảo hóa.
   - Trả log quét (Ví dụ: `nmap`, quét port) từ Local OS ngược lên thẳng giao diện Tướng Chỉ Huy thông qua WebSocket.
2. **Dữ Liệu Grafana Thật Ngoại Mạch**: 
   - Thay thế dữ liệu nháp của Biểu đồ (`ChartGroups.tsx`) bằng các luồng (stream) Prometheus / Grafana lấy trực tiếp từ Container Docker.

### Giai đoạn 2: Tăng Cường Xử Lý "Trí Tuệ" Của Đặc Vụ (Agents)
1. **IDE Agent Tự Chữa Code (Auto-patching)**: 
   - Cho IDE Agent quyền khả năng thao tác vật lý trên thư mục mã nguồn.
   - Sau khi vá lỗ hổng xong, IDE phải đẩy thẳng bản báo cáo Patch lên màn hình CISO để xin duyệt.
2. **LlmRouter - Memory Context**: 
   - Nâng cấp `llm-router.ts` để lưu nhớ bối cảnh (Context Memory). Nếu CISO gõ "Tiếp tục quét mạng", AI phải nhớ Mạng đó là dải IP nào đã đề cập trước đó.

### Giai đoạn 3: Ràng Buộc An Toàn (Guardrails & Telemetry)
1. Kích hoạt hiệu ứng của `KillSwitch` - Khi CISO giật cần gạt, ngắt tức khắc mọi Worker và Websocket. Hệ thống vào trạng thái Freeze (Khóa Vị Trí).
2. Xử lý triệt để mức độ Autonomy: 
   - **Level 1**: Chờ duyệt 100%.
   - **Level 3**: AI tự vá Code, tự đẩy Database nhưng vẫn báo cáo.
   - **Level 5**: AI chủ động chặn tấn công (Block IP, Đâm Firewall Rule) và chỉ lưu Log cho người dùng xem sau.
