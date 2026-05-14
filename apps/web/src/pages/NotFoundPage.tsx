import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { routes } from '@/lib/routes';

export function NotFoundPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="404"
        title="Page not found"
        description="The route does not match an active LunaCrypto workstation screen."
        action={
          <Link className="button primary" to={routes.workbench}>
            Open workbench
          </Link>
        }
      />
      <Panel className="span-12" title="Route unavailable">
        <p className="muted" style={{ margin: 0 }}>
          Check the URL or return to the workbench.
        </p>
      </Panel>
    </main>
  );
}
