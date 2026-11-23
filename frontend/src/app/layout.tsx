import type { Metadata } from 'next';
import { Geist, Inter } from 'next/font/google';
import '@/components/arc/foundation.css';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-geist',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Image processor | CFactory',
  description:
    'Upload a JPG, PNG, or WebP image up to 20 MB for asynchronous resizing, compression, and WebP conversion.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${inter.variable}`}
      data-accent="blue"
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
