import type { CSSProperties, ReactNode } from 'react';

export type HeaderStatTone =
  | 'default'
  | 'primary'
  | 'constructive'
  | 'warning'
  | 'risk'
  | 'degraded';

export type HeaderStat = {
  icon?: ReactNode;
  label: string;
  meta?: ReactNode;
  tone?: HeaderStatTone;
  value: ReactNode;
};

export function HeaderStats({
  stats,
  className = '',
}: {
  stats: HeaderStat[];
  className?: string;
}) {
  const style = {
    '--header-stat-count': Math.min(Math.max(stats.length, 1), 4),
  } as CSSProperties;

  return (
    <div className={`page-header-stats ${className}`.trim()} style={style}>
      {stats.map((stat) => {
        const tone = stat.tone ?? 'default';
        return (
          <div className="page-header-stat" key={stat.label}>
            <div className="page-header-stat-label">
              <span>{stat.label}</span>
              {stat.icon ? <span className={`tone-${tone}`}>{stat.icon}</span> : null}
            </div>
            <strong className={`tone-${tone}`}>{stat.value}</strong>
            {stat.meta ? <span title={plainTitle(stat.meta)}>{stat.meta}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function plainTitle(value: ReactNode): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
