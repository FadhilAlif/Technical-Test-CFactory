import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CFactory Async Image Processor (CAIP)',
  description: 'Asynchronous image resizing, compression (80%), and WebP conversion powered by Hono, BullMQ, NeonDB & Sharp.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
