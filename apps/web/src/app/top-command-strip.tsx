'use client';

import Link from 'next/link';
import { PlayCircle } from 'lucide-react';
import { WorkspaceSwitcher } from '@/auth/workspace-switcher';
import { routes } from '@/lib/routes';

export function TopCommandStrip() {
  return (
    <header className="top-strip">
      <div>
        <p className="top-strip-title">Evidence-first crypto research</p>
        <div className="small muted">Local header auth. Hosted auth comes later.</div>
      </div>
      <WorkspaceSwitcher />
      <Link className="button primary" href={routes.researchNew}>
        <PlayCircle size={16} aria-hidden />
        Run research
      </Link>
    </header>
  );
}
