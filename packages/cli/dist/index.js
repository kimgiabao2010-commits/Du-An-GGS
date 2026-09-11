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
    const app = render(React.createElement(CommandLogin, null));
    // app.waitUntilExit(); can be used for persistent terminals
});
program.command('kill', { isDefault: false })
    .description('Trigger system-wide Kill Switch')
    .option('--all', 'Kill all subsystems')
    .action((options) => {
    if (!options.all) {
        render(React.createElement(Text, { color: "yellow" }, "\u26A0\uFE0F  Please specify --all to trigger kill switch."));
        return;
    }
    render(React.createElement(CommandKillSwitch, null));
});
program.command('status')
    .description('Check ASQ status')
    .action(() => {
    render(React.createElement(Box, { flexDirection: "column", marginY: 1 },
        React.createElement(StatusBadge, { status: "OK", label: "Core SDK" }),
        React.createElement(StatusBadge, { status: "OK", label: "WORM Database" }),
        React.createElement(StatusBadge, { status: "CRITICAL", label: "Sandbox Layer (Requires setup)" })));
});
program.parse(process.argv);
//# sourceMappingURL=index.js.map