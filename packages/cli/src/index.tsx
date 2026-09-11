#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { CommandLogin } from './commands/CommandLogin.js';
import { CommandKillSwitch } from './commands/CommandKillSwitch.js';
import { StatusBadge } from './components/StatusBadge.js';
import { Box, Text } from 'ink';

const program = new Command();
program.name('asq').description('ASQ-Engine Command Line Workspace').version('4.0.0');

program.command('login')
  .description('Login to ASQ Command Center')
  .action(() => {
    // Inject React component to console
    const app = render(<CommandLogin />);
    // app.waitUntilExit(); can be used for persistent terminals
  });

program.command('kill', { isDefault: false })
  .description('Trigger system-wide Kill Switch')
  .option('--all', 'Kill all subsystems')
  .action((options) => {
    if (!options.all) {
        render(<Text color="yellow">⚠️  Please specify --all to trigger kill switch.</Text>);
        return;
    }
    render(<CommandKillSwitch />);
  });

program.command('status')
  .description('Check ASQ status')
  .action(() => {
    render(
      <Box flexDirection="column" marginY={1}>
         <StatusBadge status="OK" label="Core SDK" />
         <StatusBadge status="OK" label="WORM Database" />
         <StatusBadge status="CRITICAL" label="Sandbox Layer (Requires setup)" />
      </Box>
    );
  });

program.parse(process.argv);
