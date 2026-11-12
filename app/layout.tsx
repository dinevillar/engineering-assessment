import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_BOOT_SCRIPT } from './components/ThemeToggle.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'Subscription Report Review',
  description: 'Investigate weekly subscription figures against publisher sources, decide, and generate the client report.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e13' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set before hydration by the boot script; suppress the expected mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
