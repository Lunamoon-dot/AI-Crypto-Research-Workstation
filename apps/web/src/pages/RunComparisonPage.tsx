import { useQuery } from '@tanstack/react-query';
import { GitCompare } from 'lucide-react';
import { useState } from 'react';
import { BentoGrid, MetricTile } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { compareRuns, compareTheses } from '@/services/comparisons';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { ComparisonResponse, DiffFieldResponse } from '@/types';

type CompareMode = 'runs' | 'theses';

export function RunComparisonPage() {
  const auth = useWorkspaceStore();
  const [mode, setMode] = useState<CompareMode>('runs');
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [submitted, setSubmitted] = useState<{
    mode: CompareMode;
    left_id: string;
    right_id: string;
  } | null>(null);
  const diff = useQuery({
    queryKey: queryKeys.comparison(submitted ?? {}),
    enabled: Boolean(submitted),
    queryFn: () => {
      if (!submitted) {
        throw new Error('Comparison is not ready.');
      }
      return submitted.mode === 'runs'
        ? compareRuns(submitted, auth)
        : compareTheses(submitted, auth);
    },
  });

  return (
    <main className="page">
      <PageHeader
        eyebrow="Run Comparison"
        title="Compare"
        description="Compare two research runs or theses side by side, including material severity and signal deltas."
      />

      <Panel title="Comparison Inputs">
        <div className="stack">
          <div className="segmented-control">
            <button
              className={`segment-button${mode === 'runs' ? ' active' : ''}`}
              onClick={() => setMode('runs')}
              type="button"
            >
              Runs
            </button>
            <button
              className={`segment-button${mode === 'theses' ? ' active' : ''}`}
              onClick={() => setMode('theses')}
              type="button"
            >
              Theses
            </button>
          </div>
          <div className="form-grid">
            <label className="label">
              Left ID
              <input
                className="input"
                onChange={(event) => setLeftId(event.target.value)}
                placeholder={mode === 'runs' ? 'run_...' : 'thesis_...'}
                value={leftId}
              />
            </label>
            <label className="label">
              Right ID
              <input
                className="input"
                onChange={(event) => setRightId(event.target.value)}
                placeholder={mode === 'runs' ? 'run_...' : 'thesis_...'}
                value={rightId}
              />
            </label>
          </div>
          <button
            className="button primary"
            disabled={!leftId.trim() || !rightId.trim() || leftId.trim() === rightId.trim()}
            onClick={() =>
              setSubmitted({
                mode,
                left_id: leftId.trim(),
                right_id: rightId.trim(),
              })
            }
            type="button"
          >
            <GitCompare size={16} />
            Compare
          </button>
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      {!submitted ? <EmptyState label="Choose two IDs to compare." /> : null}
      {diff.isLoading ? <LoadingState /> : null}
      {diff.isError ? <ErrorState error={diff.error} /> : null}
      {diff.data ? <ComparisonResult diff={diff.data} /> : null}
    </main>
  );
}

function ComparisonResult({ diff }: { diff: ComparisonResponse }) {
  return (
    <BentoGrid>
      <MetricTile
        className="span-3"
        icon={<GitCompare size={18} />}
        label="Severity"
        tone={diff.change_severity === 'major' ? 'warning' : 'primary'}
        value={diff.change_severity}
        meta={`${diff.changed_count} changed field(s)`}
      />
      <MetricTile
        className="span-3"
        label="Direction flip"
        tone={diff.direction_flip ? 'risk' : 'constructive'}
        value={diff.direction_flip ? 'Yes' : 'No'}
        meta={diff.kind}
      />
      <MetricTile
        className="span-6"
        label="IDs"
        value={<span className="small mono">{diff.id_a} {'->'} {diff.id_b}</span>}
        meta={diff.severity_reasons.join(', ')}
      />
      <Panel className="span-12" title="Changed Fields">
        {diff.changed_fields.length === 0 ? <EmptyState label="No material differences." /> : null}
        <div className="symbol-chip-row">
          {diff.changed_fields.map((field) => (
            <span className="badge warning" key={field}>{field}</span>
          ))}
        </div>
      </Panel>
      <Panel className="span-12" title="Field Diff">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Left</th>
                <th>Right</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diff.fields).map(([field, value]) => (
                <tr key={field}>
                  <td>{field}</td>
                  <td>{renderFieldValue(value, 'a')}</td>
                  <td>{renderFieldValue(value, 'b')}</td>
                  <td>
                    <span className={value.changed ? 'badge warning' : 'badge constructive'}>
                      {value.changed ? 'changed' : 'same'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {diff.thesis_diff ? (
        <Panel className="span-12" title="Nested Thesis Diff">
          <JsonView value={diff.thesis_diff} />
        </Panel>
      ) : null}
    </BentoGrid>
  );
}

function renderFieldValue(field: DiffFieldResponse, side: 'a' | 'b') {
  if ('common' in field || 'only_a' in field || 'only_b' in field) {
    const values = side === 'a' ? field.only_a : field.only_b;
    return values && values.length > 0 ? values.join(', ') : 'n/a';
  }
  const value = field[side];
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  if (typeof value === 'object') {
    return <JsonView value={value as Record<string, unknown>} />;
  }
  return String(value);
}
