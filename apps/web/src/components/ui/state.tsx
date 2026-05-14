import { errorMessage } from '@/services/client';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="state-card">
      <div className="loading-line" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state-card">{label}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="state-card">
      <span className="badge risk">error</span>
      <p className="muted small">{errorMessage(error)}</p>
    </div>
  );
}
