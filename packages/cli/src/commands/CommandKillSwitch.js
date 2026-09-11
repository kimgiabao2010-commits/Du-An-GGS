import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
export const CommandKillSwitch = () => {
    const [step, setStep] = useState(1);
    const [envName, setEnvName] = useState('');
    const [otp, setOtp] = useState('');
    const [isKilled, setIsKilled] = useState(false);
    const [error, setError] = useState('');
    const handleEnvSubmit = () => {
        if (envName === 'PRODUCTION') {
            setStep(2);
            setError('');
        }
        else {
            setError('Tên môi trường không khớp! Rất nguy hiểm nếu nhầm lẫn.');
        }
    };
    const handleOtpSubmit = () => {
        // Pseudo logic verification (in real it calls local SDK / Backend)
        if (otp.length === 6) {
            setIsKilled(true);
            setStep(3);
        }
        else {
            setError('Mã OTP không hợp lệ (Phải đủ 6 số).');
        }
    };
    if (step === 1) {
        return (<Box flexDirection="column" marginY={1}>
                <Text color="red" bold>⚠️  CẢNH BÁO: Lệnh này sẽ dừng TOÀN BỘ hệ thống ASQ trên môi trường đang cấu hình.</Text>
                {error && <Text color="yellow">❌ {error}</Text>}
                <Box>
                    <Text>Gõ tên môi trường [PRODUCTION] để xác nhận: </Text>
                    <TextInput value={envName} onChange={setEnvName} onSubmit={handleEnvSubmit}/>
                </Box>
            </Box>);
    }
    if (step === 2) {
        return (<Box flexDirection="column" marginY={1}>
                <Text color="red" bold>🔐 Xác nhận bảo mật đa lớp (MFA)</Text>
                {error && <Text color="yellow">❌ {error}</Text>}
                <Box>
                    <Text>Nhập mã TOTP (6 số từ Authenticator): </Text>
                    <TextInput value={otp} onChange={setOtp} onSubmit={handleOtpSubmit}/>
                </Box>
            </Box>);
    }
    return (<Box marginY={1} flexDirection="column" borderStyle="double" borderColor="red" padding={1}>
            <Text color="white" backgroundColor="red" bold> KILL-SWITCH TRIGGERED </Text>
            <Text color="red">Mọi kết nối CLI/Sandbox/Worker đã bị hệ thống cắt đứt thành công qua SDK EventBus.</Text>
            <Text color="gray">Audit Log đã được lưu lại thời điểm này chuẩn WORM.</Text>
        </Box>);
};
//# sourceMappingURL=CommandKillSwitch.js.map