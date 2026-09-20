import './globals.css';
import type { Metadata } from 'next';
import AppShell from '../components/AppShell';

export const metadata: Metadata = {
  title: { default: 'GSS Security Intelligence', template: '%s · GSS' },
  description: 'Evidence-first AI security operations and investigation workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="apple-spatial"><body><AppShell>{children}</AppShell></body></html>;
}
