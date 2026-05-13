import { AppShell } from '@/app/app-shell';

export default function WorkstationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
