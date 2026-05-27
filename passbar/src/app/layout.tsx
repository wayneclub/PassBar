import type { Metadata } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const publicAsset = (path: string) => `${basePath}${path}`;

export const metadata: Metadata = {
  title: 'PassBar | Bar Exam Practice',
  description: 'Practice MBE-style questions with a Supabase-backed question bank and focused explanations.',
  icons: {
    icon: [
      { url: publicAsset('/favicon.ico'), sizes: 'any' },
      { url: publicAsset('/favicon-32x32.png'), sizes: '32x32', type: 'image/png' },
      { url: publicAsset('/favicon-16x16.png'), sizes: '16x16', type: 'image/png' },
      { url: publicAsset('/passbar-icon.svg'), type: 'image/svg+xml' },
    ],
    shortcut: [publicAsset('/favicon.ico'), publicAsset('/favicon-32x32.png')],
    apple: [
      { url: publicAsset('/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: publicAsset('/manifest.webmanifest'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased selection:bg-accent selection:text-white">
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
