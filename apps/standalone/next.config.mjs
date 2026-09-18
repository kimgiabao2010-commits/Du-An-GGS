/** @type {import('next').NextConfig} */
export default function config(phase) {
  return {
    reactStrictMode: true,
    pageExtensions: ['ts', 'tsx'],
    transpilePackages: ['@asq/sdk', '@asq/auth'],
    distDir: phase === 'phase-development-server' ? '.next' : '.next-production',
    webpack(config) {
      config.resolve.extensions = ['.tsx', '.ts', ...config.resolve.extensions.filter(ext => ext !== '.tsx' && ext !== '.ts')];
      return config;
    }
  };
}
