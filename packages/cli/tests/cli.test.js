import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusBadge } from '../src/components/StatusBadge';
describe('CLI Components', () => {
    it('StatusBadge should render CRITICAL correctly', () => {
        // Testing React Terminal rendering
        const { lastFrame } = render(<StatusBadge status="CRITICAL" label="System Breach"/>);
        const output = lastFrame();
        // Assert that the text shows up
        expect(output).toContain('System Breach');
        expect(output).toContain('CRITICAL');
    });
    it('StatusBadge should render OK properly', () => {
        const { lastFrame } = render(<StatusBadge status="OK" label="All good"/>);
        const output = lastFrame();
        expect(output).toContain('OK');
    });
});
//# sourceMappingURL=cli.test.js.map