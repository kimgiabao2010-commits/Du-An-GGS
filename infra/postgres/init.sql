-- Khởi tạo bảng Audit Logs chuẩn WORM (Write Once Read Many)
CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    target_resource VARCHAR(255),
    action_payload JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tạo function ném Exception nếu cố tình UPDATE
CREATE OR REPLACE FUNCTION prevent_audit_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'WORM Violation: Cập nhật dòng trên bảng audit_events bị cấm tuyệt đối theo chính sách bảo mật Zero-Trust.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Tạo function ném Exception nếu cố tình DELETE
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'WORM Violation: Xóa dòng trên bảng audit_events bị cấm tuyệt đối. Hãy cấu hình Data Retention Policy để xóa tự động nếu cần thiết.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Gắn Trigger khoá UPDATE
CREATE TRIGGER trigger_prevent_audit_update
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();

-- Gắn Trigger khoá DELETE
CREATE TRIGGER trigger_prevent_audit_delete
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();
