import type { Metadata } from 'next';
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google';
import { ReloadScrollRestore } from '@/components/layout/reload-scroll-restore';
import './globals.css';

const sans = Source_Sans_3({
  variable: '--font-sans',
  subsets: ['latin'],
});

const serif = Source_Serif_4({
  variable: '--font-heading',
  subsets: ['latin'],
});

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
      <body
        className={`${sans.variable} ${serif.variable} font-sans antialiased`}
      >
        <ReloadScrollRestore />
        {children}
      </body>
    </html>
  );
}
