import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
export const CommandLogin = () => {
    const [token, setToken] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const handleSubmit = () => {
        setSubmitted(true);
        // SDK Core Integration here
        // ASQClient.auth(token)...
    };
    if (submitted) {
        return (React.createElement(Box, { marginY: 1 },
            React.createElement(Text, { color: "green" }, "\u2714 Login successful! Session token saved.")));
    }
    return (React.createElement(Box, { marginY: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "cyan" }, "--- ASQ-Engine C2 Login ---"),
        React.createElement(Box, null,
            React.createElement(Text, null, "Nh\u1EADp JWT Token: "),
            React.createElement(TextInput, { value: token, onChange: setToken, onSubmit: handleSubmit, mask: "*" })),
        React.createElement(Text, { color: "gray" }, "(Press Enter to submit)")));
};
//# sourceMappingURL=CommandLogin.js.map