// Builds the static export for GitHub Pages.
//
// The /api/cron/notifications route is a Vercel cron job (see vercel.json) that
// requires a server runtime and cannot be part of a static export. Temporarily
// move it out of src/app while building the static site, then restore it.

import { existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cronDir = path.resolve('src/app/api/cron');
const cronTmpDir = path.resolve('.cron-route-tmp');

const moved = existsSync(cronDir);
if (moved) {
  renameSync(cronDir, cronTmpDir);
}

try {
  const result = spawnSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GITHUB_PAGES: 'true',
      NEXT_PUBLIC_BASE_PATH: '/PassBar',
      NODE_ENV: 'production',
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (moved) {
    renameSync(cronTmpDir, cronDir);
  }
}
