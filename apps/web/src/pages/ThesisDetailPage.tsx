import { Link, useParams } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, GitBranch, ShieldAlert, Target } from 'lucide-react';
import {
  getThesis,
  getThesisScenarios,
  recordThesisDecision,
  recordThesisReview,
} from '@/services/theses';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
} from '@/components/research/badges';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { JsonRecord } from '@/types';

export function ThesisDetailPage() {
  const { id } = useParams();
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const thesisId = id ?? '';
  const thesisQuery = useQuery({
    queryKey: queryKeys.thesis(thesisId),
    queryFn: () => getThesis(thesisId, auth),
  });
  const scenariosQuery = useQuery({
    queryKey: queryKeys.thesisScenarios(thesisId),
    queryFn: () => getThesisScenarios(thesisId, auth),
  });

  const [decisionAction, setDecisionAction] = useState('watched');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [reviewResult, setReviewResult] = useState('unknown');
  const [reviewNotes, setReviewNotes] = useState('');

  const decisionMutation = useMutation({
    mutationFn: () =>
      recordThesisDecision(
        thesisId,
        { action: decisionAction, notes: decisionNotes },
        auth,
      ),
    onSuccess: () => {
      setDecisionNotes('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.theses({}) });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      recordThesisReview(
        thesisId,
        { result: reviewResult, notes: reviewNotes },
        auth,
      ),
    onSuccess: () => {
      setReviewNotes('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
    },
  });

  if (thesisQuery.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading thesis..." />
      </main>
    );
  }
  if (thesisQuery.isError) {
    return (
      <main className="page">
        <ErrorState error={thesisQuery.error} />
      </main>
    );
  }
  const thesis = thesisQuery.data;
  const stabilityGuard = thesis?.stability_guard ?? {};
  if (!thesis) {
    return (
      <main className="page">
        <EmptyState label="Thesis not found." />
      </main>
    );
  }

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    decisionMutation.mutate();
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reviewMutation.mutate();
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="04 Thesis Detail"
        title={`${thesis.symbol} thesis`}
        description={`Created ${formatDateTime(thesis.created_at)}. Review the evidence, contradiction set, scenarios, and journal actions.`}
        action={<DirectionBadge value={thesis.direction} />}
      />

      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<FileText size={18} />}
          label="Rating"
          tone="primary"
          value={thesis.summary.rating || thesis.setup_type || 'n/a'}
        />
        <MetricTile
          className="span-3"
          icon={<CheckCircle2 size={18} />}
          label="Thesis confidence"
          tone="constructive"
          value={<ConfidenceBadge value={thesis.confidence} />}
        />
        <MetricTile
          className="span-3"
          icon={<Target size={18} />}
          label="Targets"
          meta="Target zones"
          value={thesis.target_zones.length}
        />
        <MetricTile
          className="span-3"
          icon={<ShieldAlert size={18} />}
          label="Risk"
          meta="Stale or missing data"
          tone={thesis.stale_or_missing_data.length > 0 ? 'warning' : 'constructive'}
          value={thesis.stale_or_missing_data.length}
        />

        <Panel className="span-4 emphasis" title="Core metrics" description="Setup, entry, invalidation, and run link">
          <div className="stack">
            <p style={{ margin: 0 }}>{thesis.summary.action_summary || thesis.thesis_text || 'No thesis text.'}</p>
            <DataPair label="Setup" value={thesis.setup_type} />
            <DataPair label="Confidence basis" value={thesis.confidence_source || 'n/a'} />
            {stabilityGuard.applied === true ? (
              <DataPair
                label="Stability guard"
                value={<span className="badge primary">{stabilityGuardSummary(stabilityGuard)}</span>}
              />
            ) : null}
            <DataPair label="Quant confidence" value={<ConfidenceBadge value={thesis.quant_confidence} />} />
            <DataPair label="Entry" value={thesis.entry_zone || 'n/a'} />
            <DataPair label="Invalidation" value={<strong>{thesis.invalidation_level || 'n/a'}</strong>} />
            <DataPair label="Run" value={<IdChip value={thesis.research_run_id} />} />
            <div className="top-strip-meta">
              {thesis.research_run_id ? (
                <Link className="button" to={routes.researchRun(thesis.research_run_id)}>
                  Open run
                </Link>
              ) : null}
              {thesis.id ? (
                <Link
                  className="button primary"
                  to={`${routes.watchlists}?track_thesis=${encodeURIComponent(thesis.id)}`}
                >
                  Track this thesis
                </Link>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel className="span-8" title="Evidence and contradictions">
          <div className="grid two">
            <EvidenceBlock title="Supporting signals" tone="constructive" values={thesis.supporting_signal_ids} />
            <EvidenceBlock title="Contradicting signals" tone="risk" values={thesis.contradicting_signal_ids} />
            <EvidenceBlock title="Key reasons" tone="primary" values={thesis.summary.key_reasons} />
            <EvidenceBlock title="Risks" tone="warning" values={thesis.summary.risks} />
          </div>
          {stabilityGuard.applied === true ? (
            <div className="stack small">
              <strong>Stability guard audit</strong>
              <JsonView value={stabilityGuard} />
            </div>
          ) : null}
        </Panel>

        <Panel className="span-4" title="Scenario radar" description="Conditional outcomes">
          {scenariosQuery.isLoading ? <LoadingState /> : null}
          {scenariosQuery.isError ? <ErrorState error={scenariosQuery.error} /> : null}
          {scenariosQuery.data?.length === 0 ? (
            <EmptyState label="No scenarios for this thesis." />
          ) : null}
          <div className="stack">
            {scenariosQuery.data?.map((scenario) => (
              <div className="list-row" key={scenario.id ?? scenario.condition}>
                <div className="row">
                  <strong>{scenario.probability_band || 'scenario'}</strong>
                  <span className="badge primary">{scenario.suggested_user_action || 'review'}</span>
                </div>
                <div className="small"><strong>Condition:</strong> {scenario.condition || 'n/a'}</div>
                <div className="small muted"><strong>Expected:</strong> {scenario.expected_behavior || 'n/a'}</div>
                <JsonView value={scenario.payload} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="span-8" title="Manual decision journal and AI source rail">
          <div className="grid two">
            <form className="stack" onSubmit={submitDecision}>
              <strong>Record decision</strong>
              <label className="label">
                Action
                <select
                  className="select"
                  value={decisionAction}
                  onChange={(event) => setDecisionAction(event.target.value)}
                >
                  <option value="watched">watched</option>
                  <option value="accepted">accepted</option>
                  <option value="rejected">rejected</option>
                  <option value="ignored">ignored</option>
                  <option value="needs_more_research">needs_more_research</option>
                </select>
              </label>
              <label className="label">
                Notes
                <textarea
                  className="textarea"
                  value={decisionNotes}
                  onChange={(event) => setDecisionNotes(event.target.value)}
                />
              </label>
              {decisionMutation.isError ? <span className="badge risk">{errorMessage(decisionMutation.error)}</span> : null}
              {decisionMutation.isSuccess ? <span className="badge constructive">decision recorded</span> : null}
              <button className="button primary" disabled={decisionMutation.isPending} type="submit">
                Record decision
              </button>
            </form>

            <form className="stack" onSubmit={submitReview}>
              <strong>Outcome review</strong>
              <label className="label">
                Result
                <select
                  className="select"
                  value={reviewResult}
                  onChange={(event) => setReviewResult(event.target.value)}
                >
                  <option value="worked">worked</option>
                  <option value="failed">failed</option>
                  <option value="mixed">mixed</option>
                  <option value="invalidated">invalidated</option>
                  <option value="expired">expired</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label className="label">
                Lessons
                <textarea
                  className="textarea"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                />
              </label>
              {reviewMutation.isError ? <span className="badge risk">{errorMessage(reviewMutation.error)}</span> : null}
              {reviewMutation.isSuccess ? <span className="badge constructive">review recorded</span> : null}
              <button className="button" disabled={reviewMutation.isPending} type="submit">
                Record review
              </button>
            </form>
          </div>
        </Panel>

        <Panel className="span-12" title="Monitor next" description="Follow-up IDs, target zones, and missing data">
          <div className="grid three">
            <EvidenceBlock title="Target zones" tone="constructive" values={thesis.target_zones} />
            <EvidenceBlock title="Monitor next" tone="primary" values={thesis.monitor_next} />
            <EvidenceBlock title="Stale or missing data" tone="warning" values={thesis.stale_or_missing_data} />
          </div>
          <div style={{ marginTop: 14 }} className="badge">
            <GitBranch aria-hidden size={14} />
            {thesis.summary.market_type || thesis.summary.direction || 'research thesis'}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function stabilityGuardSummary(guard: JsonRecord) {
  const proposed = asRecord(guard.proposed);
  const rating = stringValue(proposed.rating);
  const direction = stringValue(proposed.direction);
  const confidence = numberValue(proposed.confidence);
  const ageMinutes = numberValue(guard.age_minutes);
  const stance = [rating, direction].filter(Boolean).join(' / ');
  const confidenceText = confidence === null ? '' : ` ${Math.round(confidence * 100)}%`;
  const ageText = ageMinutes === null ? '' : ` at ${ageMinutes.toFixed(1)}m`;
  return stance
    ? `held prior thesis; blocked ${stance}${confidenceText}${ageText}`
    : `held prior thesis${ageText}`;
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

function EvidenceBlock({
  title,
  values,
  tone,
}: {
  title: string;
  values: string[];
  tone: 'primary' | 'constructive' | 'warning' | 'risk';
}) {
  return (
    <div className="state-card">
      <strong>{title}</strong>
      {values.length === 0 ? (
        <p className="small muted">None reported.</p>
      ) : (
        <div className="top-strip-meta">
          {values.map((value) => (
            <span className={`badge ${tone} mono`} key={value} title={value}>
              <span className="badge-label">{value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
