# Báo cáo Nghiệm thu: Phase 4 (IDE Reasoning Extensions)

**Ngày hoàn thành**: Tự động sinh
**Mục tiêu**: Một Tiện ích mở rộng VSCode đưa luồng xử lý vá lỗi trực tiếp về môi trường Dev. Giới thiệu vòng lặp Self-Healing Memory thông qua tính năng Reject Patch từ Dev.

## 1. Kết quả Bàn giao
Dự án VSCode Extension đã được dựng xong tại `apps/ide-extension/`:
- **Webview UI** (`PatchWebviewProvider.ts`): Bảng Tab riêng biệt trong VSCode giả lập luồng Diff Highlight mã độc. Code được dán nhãn Red (Removed) và Green (Fixed) để Dev trực quan.
- **AST Patcher** (`ast-patcher.ts`): Trạm trung gian ứng dụng trực tiếp `@asq/sdk` từ Core Phase 1 để ném data học ngược về ASQ Server.
- **Tính năng Duyệt Bác (Approve / Reject)**:
  - `Approve`: Extension gọi `ApplyWorkspaceEdit` để dán Code vá thẳng vào File đang mở.
  - `Reject`: Một khung Input Box sổ xuống "Bạn muốn dạy ASQ điều gì?". Lý do sẽ được capture đẩy sang Vector Database qua WebSocket kết nối liên tục!

## 2. Kịch bản Trải nghiệm cho QA Team

Team QA thực hiện các bước sau trên IDE VSCode:
1. Trỏ vào thư mục `apps/ide-extension` ấn `npm install`.
2. Gõ `F5` trên VSCode (hoặc qua debug panel) để chạy môi trường `Extension Development Host` (Trình biên tập VSCode phụ).
3. Trong cửa sổ VSCode phụ đó, tạo 1 file code rác.
4. Mở Command Palette (`Ctrl/Cmd + Shift + P`).
5. Gõ và phím Enter lệnh: **"ASQ: Preview Incoming Patch"**.

✅ **Pass Condition (Kết quả mong đợi)**:
1. Màn hình Webview "Đề xuất Vá lỗi từ ASQ-Engine" bung ra bên phải. Hiển thị code Fix lỗi Injection (VD: SQLite -> Param query).
2. Khi ấn `Approve`, một dòng code sẽ tự động nhảy vào file code hiện tại.
3. Khi ấn `Reject`, một Popup native của VSCode bung xuống đòi nhập lý do. Nhập xong, Toast Message thông báo "Đã đẩy Feedback từ chối về Standalone Server!"
