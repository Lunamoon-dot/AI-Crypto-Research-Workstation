import { AlertTriangle, FileText, Layers3 } from 'lucide-react';
import { ConfidenceBadge, DirectionBadge, IdChip } from '@/components/research/badges';
import { DataPair } from '@/components/research/bento';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type { BriefResponse } from '@/types';

export function BriefCard({
  brief,
  featured = false,
}: {
  brief: BriefResponse;
  featured?: boolean;
}) {
  const points = brief.key_points.slice(0, featured ? 5 : 3);
  const assets = brief.asset_summaries.slice(0, featured ? 4 : 2);
  const theses = brief.thesis_updates.slice(0, featured ? 4 : 2);
  const risks = brief.top_risks.slice(0, featured ? 4 : 2);

  return (
    <article className={`brief-card ${featured ? 'state-card emphasis' : 'state-card'}`}>
      <div className="row start">
        <div className="stack">
          <strong>{brief.title || 'Untitled brief'}</strong>
          <span className="small muted">
            {brief.watchlist_name || 'watchlist'} | {formatDateTime(brief.created_at)}
          </span>
        </div>
        <span className={featured ? 'badge primary' : 'badge'}>
          {formatDate(brief.brief_date)}
        </span>
      </div>

      <p className="muted">{brief.summary || 'No summary.'}</p>

      <div className="top-strip-meta">
        <span className="badge">
          <Layers3 aria-hidden size={13} />
          {brief.asset_summaries.length} assets
        </span>
        <span className="badge">
          <FileText aria-hidden size={13} />
          {brief.thesis_ids.length} theses
        </span>
        {brief.signal_ids.length > 0 ? (
          <span className="badge">{brief.signal_ids.length} signals</span>
        ) : null}
        {brief.previous_brief_id ? <IdChip value={brief.previous_brief_id} /> : null}
      </div>

      {points.length > 0 ? (
        <div className="brief-card-section">
          {points.map((point) => (
            <div className="brief-point small" key={point}>
              <span aria-hidden />
              <span>{point}</span>
            </div>
          ))}
        </div>
      ) : null}

      {assets.length > 0 ? (
        <div className="brief-card-section">
          {assets.map((asset) => (
            <div className="brief-asset-row" key={`${asset.symbol}-${asset.source_timestamp ?? asset.summary}`}>
              <div>
                <strong>{asset.symbol}</strong>
                <p className="small muted">{asset.summary}</p>
              </div>
              <div className="stack small">
                <DataPair label="Price" value={formatNumber(asset.current_price)} />
                <DataPair label="Regime" value={asset.market_regime || 'n/a'} />
                <DataPair label="Trend" value={asset.trend_direction || 'n/a'} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {theses.length > 0 ? (
        <div className="brief-card-section">
          {theses.map((thesis) => (
            <div className="brief-thesis-row" key={`${thesis.thesis_id}-${thesis.status}`}>
              <div className="row">
                <strong>{thesis.symbol}</strong>
                <DirectionBadge value={thesis.direction} />
              </div>
              <p className="small muted">{thesis.update}</p>
              <div className="top-strip-meta">
                <ConfidenceBadge value={thesis.confidence} />
                <span className="badge">{thesis.status || 'watch'}</span>
                {thesis.invalidation_level ? (
                  <span className="badge warning">Invalidation {thesis.invalidation_level}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {risks.length > 0 ? (
        <div className="brief-card-section">
          {risks.map((risk) => (
            <div className="brief-point small" key={risk}>
              <AlertTriangle aria-hidden size={13} />
              <span>{risk}</span>
            </div>
          ))}
        </div>
      ) : null}

      {featured && brief.thesis_ids.length > 0 ? (
        <div className="top-strip-meta">
          {brief.thesis_ids.slice(0, 6).map((id) => (
            <IdChip key={`thesis-${id}`} value={id} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
