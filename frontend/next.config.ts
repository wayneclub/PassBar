import type {NextConfig} from 'next';
import dotenv from 'dotenv';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

// Local app settings live at the repository root.
const rootEnvFile = resolve(process.cwd(), '../.env.local');
if (existsSync(rootEnvFile)) {
  dotenv.config({path: rootEnvFile, override: true, quiet: true});
}

// The repository root owns the npm workspaces and canonical lockfile — but only
// in a full repo checkout. The Docker build context is frontend/ alone, and
// pointing `turbopack.root` at its parent there nests the standalone output
// (server.js stops being at the standalone root, so the container can't start).
const repoRoot = resolve(process.cwd(), '..');
const isRepoCheckout = existsSync(resolve(repoRoot, 'package-lock.json'));

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(isRepoCheckout ? { turbopack: { root: repoRoot } } : {}),
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'getbar.link',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
