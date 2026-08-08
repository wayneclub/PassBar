import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

// 字型透過 CSS 變數（--font-inter → Tailwind font-body）間接套用，next/font 預設的 preload
// 會注入 <link rel="preload" as="font">，但 Chrome 偵測不到「即時直接使用」而在每個頁面狂噴
// 「preloaded but not used within a few seconds」警告。已用 display:'swap'（fallback 先顯示、
// 載好再換），關掉 preload 對體感幾乎無影響，卻能徹底消除警告。
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter', preload: false });

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const publicAsset = (path: string) => `${basePath}${path}`;

export const metadata: Metadata = {
  title: 'PassBar | Bar Exam Practice',
  description: 'Practice MBE-style questions with a curated question bank and focused explanations.',
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
    <html lang="en" className={inter.variable}>
      <body className="font-body antialiased selection:bg-primary selection:text-primary-foreground">
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
