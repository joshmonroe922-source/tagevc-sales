import type { Metadata } from 'next';
import { ReloadScrollRestore } from '@/components/layout/reload-scroll-restore';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tage VC Operating System',
  description:
    'Internal operating system for Tage Venture Capital — Command Center, deal flow, portfolio, and firm ops.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ReloadScrollRestore />
        {children}
      </body>
    </html>
  );
}
