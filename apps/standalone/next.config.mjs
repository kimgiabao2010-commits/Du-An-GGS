/** @type {import('next').NextConfig} */
export default function config(phase) {
  return {
    reactStrictMode: true,
    pageExtensions: ['ts', 'tsx'],
    transpilePackages: ['@asq/sdk', '@asq/auth'],
    distDir: phase === 'phase-development-server' ? '.next' : '.next-production',
    async redirects() {
      return [
        { source: '/tasks', destination: '/standalone/tasks', permanent: false },
        { source: '/evidence', destination: '/standalone/evidence', permanent: false },
        { source: '/command', destination: '/standalone/command', permanent: false },
        { source: '/executions', destination: '/control/executions', permanent: false },
        { source: '/executions/:path*', destination: '/control/executions/:path*', permanent: false },
        { source: '/agents', destination: '/control/agents', permanent: false },
        { source: '/context', destination: '/control/context', permanent: false },
        { source: '/logs', destination: '/control/logs', permanent: false },
        { source: '/siem', destination: '/control/siem', permanent: false },
      ];
    },
  };
}
