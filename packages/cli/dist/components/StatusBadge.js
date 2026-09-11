import React from 'react';
import { Text, Box } from 'ink';
export const StatusBadge = ({ status, label }) => {
    let bgColor = 'blue';
    switch (status) {
        case 'OK':
            bgColor = 'green';
            break;
        case 'WARNING':
            bgColor = 'yellow';
            break;
        case 'CRITICAL':
            bgColor = 'red';
            break;
    }
    return (React.createElement(Box, null,
        React.createElement(Text, { backgroundColor: bgColor, color: "white", bold: true },
            " ",
            status,
            " "),
        React.createElement(Text, null,
            "  ",
            label)));
};
//# sourceMappingURL=StatusBadge.js.map