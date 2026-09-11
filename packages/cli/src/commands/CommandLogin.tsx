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
        return (
            <Box marginY={1}>
                <Text color="green">✔ Login successful! Session token saved.</Text>
            </Box>
        );
    }

    return (
        <Box marginY={1} flexDirection="column">
            <Text bold color="cyan">--- ASQ-Engine C2 Login ---</Text>
            <Box>
                <Text>Nhập JWT Token: </Text>
                <TextInput 
                    value={token} 
                    onChange={setToken} 
                    onSubmit={handleSubmit} 
                    mask="*" 
                />
            </Box>
            <Text color="gray">(Press Enter to submit)</Text>
        </Box>
    );
};
