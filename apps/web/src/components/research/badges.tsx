import { formatConfidence } from '@/lib/format';

export function DirectionBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes('bull') || normalized.includes('long')
    ? 'constructive'
    : normalized.includes('bear') || normalized.includes('short')
      ? 'risk'
      : 'warning';
  return <span className={`badge ${tone}`}>{value || 'watch'}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone =
    normalized === 'completed'
      ? 'constructive'
      : normalized.includes('failed') ||
          normalized === 'timed_out' ||
          normalized === 'cancelled'
        ? 'risk'
        : normalized.includes('degraded')
          ? 'degraded'
          : normalized === 'running'
            ? 'primary'
            : 'warning';
  return <span className={`badge ${tone}`}>{value || 'unknown'}</span>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  return <span className="badge primary">{formatConfidence(value)}</span>;
}

export function IdChip({ value }: { value: string | null | undefined }) {
  if (!value) {
    return <span className="badge">n/a</span>;
  }
  return (
    <span className="badge mono" title={value}>
      <span className="badge-label">{value}</span>
    </span>
  );
}
