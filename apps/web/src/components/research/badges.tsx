import { useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatConfidence } from '@/lib/format';

export function RatingBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized === 'buy' || normalized === 'overweight'
    ? 'constructive'
    : normalized === 'sell'
      ? 'risk'
      : normalized === 'underweight'
        ? 'warning'
        : 'primary';
  return <span className={`badge ${tone}`}>{value || 'Hold'}</span>;
}

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

export function DataQualityBadge({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const normalized = label.toLowerCase();
  const tone = normalized.includes('insufficient')
    ? 'risk'
    : normalized.includes('degraded')
      ? 'degraded'
      : 'constructive';
  return (
    <span className={`badge ${tone}`}>
      {label || 'unknown'} {value === null ? '' : formatConfidence(value)}
    </span>
  );
}

export function IdChip({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className="badge">n/a</span>;
  }
  const id = value;

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    await copyText(id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <span className="badge mono id-chip" title={id}>
      <span className="badge-label">{shortId(id)}</span>
      <button
        aria-label={`Copy ID ${id}`}
        className="id-copy-button"
        title={copied ? 'Copied' : 'Copy full ID'}
        type="button"
        onClick={handleCopy}
      >
        {copied ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={13} />}
      </button>
    </span>
  );
}

function shortId(value: string): string {
  if (value.length <= 20) {
    return value;
  }
  const separatorIndex = value.indexOf('_');
  if (separatorIndex > 0 && separatorIndex < 12) {
    const prefix = value.slice(0, separatorIndex + 1);
    const body = value.slice(separatorIndex + 1);
    return `${prefix}${body.slice(0, 6)}...${body.slice(-6)}`;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for restricted clipboard contexts.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
