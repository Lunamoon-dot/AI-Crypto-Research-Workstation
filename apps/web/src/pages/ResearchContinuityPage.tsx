import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, History, RefreshCw } from 'lucide-react';
import {
  getResearchContinuityState,
  listResearchContinuityEntries,
} from '@/services/research-continuity';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { StatusBadge } from '@/components/research/badges';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  ResearchContinuityEntryResponse,
  ResearchContinuityStateResponse,
} from '@/types';

export function ResearchContinuityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = searchParams.get('symbol') ?? 'BTC/USDT';
  const [symbolInput, setSymbolInput] = useState(initialSymbol);
  const symbol = useMemo(() => initialSymbol.trim() || 'BTC/USDT', [initialSymbol]);
  const auth = useWorkspaceStore();
  const stateQuery = useQuery({
    queryKey: queryKeys.researchContinuityState(symbol),
    queryFn: () => getResearchContinuityState(symbol, auth),
    enabled: Boolean(symbol),
    retry: false,
  });
  const entriesQuery = useQuery({
    queryKey: queryKeys.researchContinuityEntries({ symbol, limit: 20 }),
    queryFn: () => listResearchContinuityEntries(symbol, { limit: 20 }, auth),
    enabled: Boolean(symbol),
    retry: false,
  });

  function applySymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSymbol = symbolInput.trim();
    if (nextSymbol) {
      setSearchParams({ symbol: nextSymbol });
    }
  }

  const state = stateQuery.data?.state ?? null;
  const entries = entriesQuery.data?.entries ?? [];

  return (
    <main className="page">
      <PageHeader
        eyebrow="Research Continuity"
        title="Daily Research Delta"
        description={symbol}
        action={
          <form className="top-strip-meta" onSubmit={applySymbol}>
            <label className="field">
              <span>Symbol</span>
              <input
                list="research-continuity-symbols"
                onChange={(event) => setSymbolInput(event.target.value)}
                value={symbolInput}
              />
            </label>
            <datalist id="research-continuity-symbols">
              <option value="BTC/USDT" />
              <option value="ETH/USDT" />
              <option value="SOL/USDT" />
            </datalist>
            <button className="button" type="submit">
              <RefreshCw aria-hidden size={15} />
              Load
            </button>
          </form>
        }
      />

      <BentoGrid>
        <Panel className="span-4 emphasis" title="Latest state">
          {stateQuery.isLoading ? <LoadingState label="Loading continuity state..." /> : null}
          {stateQuery.isError ? <ErrorState error={stateQuery.error} /> : null}
          {!stateQuery.isLoading && !stateQuery.isError ? (
            <ContinuityStateSummary state={state} />
          ) : null}
        </Panel>

        <Panel className="span-8" title="Current view">
          {state ? (
            <div className="stack">
              <div className="bento-grid compact">
                {Object.entries(state.current_view).map(([name, value]) => (
                  <DataPair key={name} label={name.replaceAll('_', ' ')} value={String(value)} />
                ))}
              </div>
              <details>
                <summary className="button">Raw state</summary>
                <JsonView value={state} />
              </details>
            </div>
          ) : (
            <EmptyState label="No continuity state for this symbol yet." />
          )}
        </Panel>

        <Panel className="span-5" title="Active tracked items">
          {state?.active_items.length ? (
            <div className="stack">
              {state.active_items.slice(0, 8).map((item, index) => (
                <div className="list-row" key={String(item.item_key ?? index)}>
                  <div className="row">
                    <strong>{String(item.type ?? 'item')}</strong>
                    <span className="badge">{String(item.importance ?? 'medium')}</span>
                  </div>
                  <p className="small muted">{String(item.text ?? '')}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="No active tracked items." />
          )}
        </Panel>

        <Panel className="span-7" title="Recent entries">
          {entriesQuery.isLoading ? <LoadingState label="Loading continuity entries..." /> : null}
          {entriesQuery.isError ? <ErrorState error={entriesQuery.error} /> : null}
          {!entriesQuery.isLoading && !entriesQuery.isError && entries.length === 0 ? (
            <EmptyState label="No Daily Research Delta entries found." />
          ) : null}
          <div className="stack">
            {entries.map((entry) => (
              <ContinuityEntryRow entry={entry} key={entry.id ?? entry.research_run_id} />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function ContinuityStateSummary({
  state,
}: {
  state: ResearchContinuityStateResponse | null;
}) {
  if (!state) {
    return <EmptyState label="Continuity state has not been initialized." />;
  }
  return (
    <div className="stack small">
      <DataPair label="Symbol" value={state.symbol} />
      <DataPair label="Updated" value={formatDateTime(state.updated_at)} />
      <DataPair label="Latest run" value={state.latest_run_id ?? 'n/a'} />
      <DataPair label="Latest entry" value={state.latest_entry_id ?? 'n/a'} />
      <DataPair
        label="Quality"
        value={String(state.data_quality.status ?? 'unknown')}
      />
      <div className="row">
        <span className="badge primary">
          <Activity aria-hidden size={13} />
          {state.active_items.length} active
        </span>
        <span className="badge">
          <History aria-hidden size={13} />
          {state.recent_resolved_items.length} resolved
        </span>
      </div>
    </div>
  );
}

function ContinuityEntryRow({
  entry,
}: {
  entry: ResearchContinuityEntryResponse;
}) {
  return (
    <div className="list-row">
      <div className="row">
        <span className="badge primary">{entry.entry_type}</span>
        <StatusBadge value={entry.status} />
        <span className="small muted">{formatDateTime(entry.generated_at)}</span>
      </div>
      <p className="muted">{entry.summary}</p>
      <div className="top-strip-meta">
        <Link className="button" to={routes.researchRun(entry.research_run_id)}>
          Open run
        </Link>
        <details>
          <summary className="button">Details</summary>
          <JsonView value={entry} />
        </details>
      </div>
    </div>
  );
}
