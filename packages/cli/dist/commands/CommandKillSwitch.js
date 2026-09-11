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
        return (React.createElement(Box, { flexDirection: "column", marginY: 1 },
            React.createElement(Text, { color: "red", bold: true }, "\u26A0\uFE0F  C\u1EA2NH B\u00C1O: L\u1EC7nh n\u00E0y s\u1EBD d\u1EEBng TO\u00C0N B\u1ED8 h\u1EC7 th\u1ED1ng ASQ tr\u00EAn m\u00F4i tr\u01B0\u1EDDng \u0111ang c\u1EA5u h\u00ECnh."),
            error && React.createElement(Text, { color: "yellow" },
                "\u274C ",
                error),
            React.createElement(Box, null,
                React.createElement(Text, null, "G\u00F5 t\u00EAn m\u00F4i tr\u01B0\u1EDDng [PRODUCTION] \u0111\u1EC3 x\u00E1c nh\u1EADn: "),
                React.createElement(TextInput, { value: envName, onChange: setEnvName, onSubmit: handleEnvSubmit }))));
    }
    if (step === 2) {
        return (React.createElement(Box, { flexDirection: "column", marginY: 1 },
            React.createElement(Text, { color: "red", bold: true }, "\uD83D\uDD10 X\u00E1c nh\u1EADn b\u1EA3o m\u1EADt \u0111a l\u1EDBp (MFA)"),
            error && React.createElement(Text, { color: "yellow" },
                "\u274C ",
                error),
            React.createElement(Box, null,
                React.createElement(Text, null, "Nh\u1EADp m\u00E3 TOTP (6 s\u1ED1 t\u1EEB Authenticator): "),
                React.createElement(TextInput, { value: otp, onChange: setOtp, onSubmit: handleOtpSubmit }))));
    }
    return (React.createElement(Box, { marginY: 1, flexDirection: "column", borderStyle: "double", borderColor: "red", padding: 1 },
        React.createElement(Text, { color: "white", backgroundColor: "red", bold: true }, " KILL-SWITCH TRIGGERED "),
        React.createElement(Text, { color: "red" }, "M\u1ECDi k\u1EBFt n\u1ED1i CLI/Sandbox/Worker \u0111\u00E3 b\u1ECB h\u1EC7 th\u1ED1ng c\u1EAFt \u0111\u1EE9t th\u00E0nh c\u00F4ng qua SDK EventBus."),
        React.createElement(Text, { color: "gray" }, "Audit Log \u0111\u00E3 \u0111\u01B0\u1EE3c l\u01B0u l\u1EA1i th\u1EDDi \u0111i\u1EC3m n\u00E0y chu\u1EA9n WORM.")));
};
//# sourceMappingURL=CommandKillSwitch.js.map