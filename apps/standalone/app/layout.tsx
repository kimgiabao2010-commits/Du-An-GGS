import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ASQ-Engine Central',
  description: 'Autonomous SecOps & AI Reasoning Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: '2rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
