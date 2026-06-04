import { Link } from 'react-router-dom';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTheses } from '@/services/theses';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
  RatingBadge,
} from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { filterThesesByLibraryFilters } from '@/pages/thesis-library-filters';
import type { JsonRecord, ThesisResponse } from '@/types';

export function ThesisLibraryPage() {
  const auth = useWorkspaceStore();
  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const [createdDate, setCreatedDate] = useState('');
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState('');
  const effectiveSymbolFilter = fixedWorkspaceSymbol ?? symbol;
  const query = useQuery({
    queryKey: queryKeys.theses({ limit: 100 }),
    queryFn: () => listTheses({ limit: 100 }, auth),
  });

  const theses = useMemo(() => {
    return filterThesesByLibraryFilters(query.data ?? [], {
      createdDate,
      direction,
      symbol: effectiveSymbolFilter,
    });
  }, [createdDate, direction, effectiveSymbolFilter, query.data]);
  const thesisSummary = useMemo(() => summarizeTheses(theses), [theses]);
  const thesisSummaryContent = query.isLoading ? (
    'Loading theses'
  ) : (
    <div className="thesis-summary-chips" aria-label="Thesis summary">
      <span className="badge primary">{theses.length} shown</span>
      <span className="badge">{query.data?.length ?? 0} total</span>
      <span className="badge constructive">{thesisSummary.bullish} bullish</span>
      <span className="badge risk">{thesisSummary.bearish} bearish</span>
      <span className="badge warning">{thesisSummary.watch} watch-neutral</span>
    </div>
  );
  const thesisFilters = (
    <div className="scenario-filter-controls thesis-panel-filters">
      <label className="scenario-filter-label">
        Date
        <div className="thesis-date-filter-row">
          <input
            className="input"
            type="date"
            value={createdDate}
            onChange={(event) => setCreatedDate(event.target.value)}
          />
          <button
            className="button ghost thesis-date-all-button"
            onClick={() => setCreatedDate('')}
            type="button"
          >All</button>
        </div>
      </label>
      {!fixedWorkspaceSymbol ? (
        <label className="scenario-filter-label">
          Symbol
          <input
            className="input"
            placeholder="BTC"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </label>
      ) : (
        <div className="scenario-filter-label thesis-workspace-symbol-filter">
          Workspace symbol
          <span className="badge primary">{fixedWorkspaceSymbol}</span>
        </div>
      )}
      <label className="scenario-filter-label">
        Direction
        <select
          className="select"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        >
          <option value="">All</option>
          <option value="bullish">bullish</option>
          <option value="bearish">bearish</option>
          <option value="neutral">neutral</option>
          <option value="watch">watch</option>
        </select>
      </label>
    </div>
  );

  return (
    <main className="page">
      <PageHeader
        title="Thesis library"
        description="Research memory with confidence, invalidation, evidence, and run links."
      />
      <Panel
        className="thesis-list-panel"
        title="Theses"
        action={thesisFilters}
        description={thesisSummaryContent}
      >
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} /> : null}
        {query.data?.length === 0 ? <EmptyState label="No theses yet." /> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Rating</th>
                <th>Setup</th>
                <th>Confidence</th>
                <th>Memory</th>
                <th>Invalidation</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {theses.map((thesis) => (
                <tr key={thesis.id ?? `${thesis.symbol}-${thesis.created_at}`}>
                  <td>{formatDateTime(thesis.created_at)}</td>
                  <td>
                    <Link to={routes.thesis(thesis.id ?? '')}>
                      <strong>{thesis.symbol}</strong>
                    </Link>
                  </td>
                  <td><DirectionBadge value={thesis.direction} /></td>
                  <td><RatingBadge value={thesis.summary.rating || 'Hold'} /></td>
                  <td>{thesis.setup_type}</td>
                  <td><ConfidenceBadge value={thesis.confidence} /></td>
                  <td><StabilityGuardBadge thesis={thesis} /></td>
                  <td>
                    <InvalidationPreview value={thesis.invalidation_level} />
                  </td>
                  <td><IdChip value={thesis.research_run_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}

function summarizeTheses(theses: ThesisResponse[]) {
  return theses.reduce(
    (summary, thesis) => {
      const direction = thesis.direction.toLowerCase();
      if (direction.includes('bull') || direction.includes('long')) {
        summary.bullish += 1;
      } else if (direction.includes('bear') || direction.includes('short')) {
        summary.bearish += 1;
      } else {
        summary.watch += 1;
      }
      return summary;
    },
    { bearish: 0, bullish: 0, watch: 0 },
  );
}

function InvalidationPreview({ value }: { value: string | null | undefined }) {
  const text = value?.trim() || 'n/a';
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    setExpanded(false);
    if (text === 'n/a') {
      setCanExpand(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = textRef.current;
      setCanExpand(Boolean(element && element.scrollHeight > element.clientHeight + 1));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [text]);

  return (
    <div className="invalidation-preview">
      <p
        className={`invalidation-preview-text${expanded ? '' : ' clamped'}`}
        ref={textRef}
      >
        {text}
      </p>
      {canExpand ? (
        <button
          aria-expanded={expanded}
          className="invalidation-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  );
}

function StabilityGuardBadge({ thesis }: { thesis: ThesisResponse }) {
  const guard = thesis.stability_guard ?? {};
  if (guard.applied !== true) {
    return <span className="small muted">raw</span>;
  }
  return (
    <div className="stack small">
      <span className="badge primary">guarded</span>
      <span className="muted">{guardProposedSummary(guard)}</span>
    </div>
  );
}

function guardProposedSummary(guard: JsonRecord) {
  const proposed = asRecord(guard.proposed);
  const rating = stringValue(proposed.rating);
  const direction = stringValue(proposed.direction);
  const confidence = numberValue(proposed.confidence);
  const stance = [rating, direction].filter(Boolean).join(' / ');
  const confidenceText = confidence === null ? '' : ` ${Math.round(confidence * 100)}%`;
  return stance ? `blocked ${stance}${confidenceText}` : 'blocked proposed flip';
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
