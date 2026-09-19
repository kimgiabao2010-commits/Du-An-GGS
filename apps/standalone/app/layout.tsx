import './globals.css';
import type { Metadata } from 'next';
import AppShell from '../components/AppShell';

export const metadata: Metadata = {
  title: { default: 'GSS Agent Operations', template: '%s · GSS' },
  description: 'Evidence-first AI agent operations and execution workspace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
