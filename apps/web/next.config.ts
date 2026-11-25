import type { NextConfig } from 'next';

// Server-side proxy target for /api/* so the browser only ever talks to the
// Next origin (httpOnly auth cookie stays same-origin; PLAN §12.3).
const apiOrigin = (process.env.API_ORIGIN ?? 'http://localhost:3001').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@shopping-agent/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },
};

export default nextConfig;
