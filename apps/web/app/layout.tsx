import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/app/providers';

export const metadata: Metadata = {
  title: 'LunaCrypto Research Workstation',
  description: 'Local-first AI crypto research workstation.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
