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
      { url: publicAsset('/favicon.svg'), type: 'image/svg+xml' },
      { url: publicAsset('/favicon-96x96.png'), sizes: '96x96', type: 'image/png' },
      { url: publicAsset('/favicon.ico'), sizes: '48x48' },
    ],
    shortcut: publicAsset('/favicon.ico'),
    apple: publicAsset('/apple-touch-icon.png'),
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
