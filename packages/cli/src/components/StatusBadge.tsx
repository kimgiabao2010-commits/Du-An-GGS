import React from 'react';
import { Text, Box } from 'ink';

export const StatusBadge = ({ status, label }: { status: 'OK' | 'WARNING' | 'CRITICAL' | 'INFO', label: string }) => {
  let bgColor = 'blue';
  switch (status) {
    case 'OK': bgColor = 'green'; break;
    case 'WARNING': bgColor = 'yellow'; break;
    case 'CRITICAL': bgColor = 'red'; break;
  }
  return (
    <Box>
      <Text backgroundColor={bgColor} color="white" bold> {status} </Text>
      <Text>  {label}</Text>
    </Box>
  );
};
