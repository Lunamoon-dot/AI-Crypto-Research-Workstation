import type { ReactNode } from 'react';

type Tone = 'default' | 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

export function BentoGrid({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`bento-grid ${className}`.trim()}>{children}</div>;
}

export function MetricTile({
  label,
  value,
  meta,
  icon,
  tone = 'default',
  className = '',
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <section className={`metric-tile ${className}`.trim()}>
      <div className="metric-label">
        <span>{label}</span>
        {icon ? <span className={`tone-${tone}`}>{icon}</span> : null}
      </div>
      <div className={`metric-value tone-${tone}`}>{value}</div>
      {meta ? <div className="metric-meta">{meta}</div> : null}
    </section>
  );
}

export function DataPair({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="data-pair small">
      <span className="data-pair-label muted">{label}</span>
      <span className="data-pair-value">{value}</span>
    </div>
  );
}

export function TimelineRow({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="timeline-row">
      <span className="timeline-dot" aria-hidden />
      <div className="stack">
        <div className="row start">
          <strong>{title}</strong>
          {meta ? <span className="small muted">{meta}</span> : null}
        </div>
        {children ? <div className="small muted">{children}</div> : null}
      </div>
    </div>
  );
}
