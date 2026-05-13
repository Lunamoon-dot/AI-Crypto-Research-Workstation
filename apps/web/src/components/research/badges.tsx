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
      : normalized === 'failed'
        ? 'risk'
        : normalized === 'degraded'
          ? 'degraded'
          : 'warning';
  return <span className={`badge ${tone}`}>{value || 'unknown'}</span>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  return <span className="badge">{formatConfidence(value)}</span>;
}

export function IdChip({ value }: { value: string | null | undefined }) {
  if (!value) {
    return <span className="badge">n/a</span>;
  }
  return <span className="badge mono">{value}</span>;
}
