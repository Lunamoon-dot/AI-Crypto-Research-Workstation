import { errorMessage } from '@/api/client';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <div className="panel-body muted small">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="panel-body muted small">{label}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="panel-body">
      <span className="badge risk">error</span>
      <p className="muted small">{errorMessage(error)}</p>
    </div>
  );
}
