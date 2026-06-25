import type {MetadataRoute} from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://getbar.link';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/dashboard', '/review', '/create', '/browse', '/performance', '/profile', '/settings', '/sim-exam', '/tasks', '/topic-study', '/footprint', '/help', '/test', '/pending'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
