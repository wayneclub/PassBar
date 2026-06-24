import type {NextConfig} from 'next';
import dotenv from 'dotenv';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

// Local app settings live at the repository root.
const rootEnvFile = resolve(process.cwd(), '../.env.local');
if (existsSync(rootEnvFile)) {
  dotenv.config({path: rootEnvFile, override: true, quiet: true});
}

const nextConfig: NextConfig = {
  output: 'standalone',
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
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
