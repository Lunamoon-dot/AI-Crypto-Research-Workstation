'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getThesis,
  getThesisScenarios,
  recordThesisDecision,
  recordThesisReview,
} from '@/api/theses';
import { errorMessage } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
} from '@/components/research/badges';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function ThesisDetail({ thesisId }: { thesisId: string }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
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
        title={`${thesis.symbol} thesis`}
        description={`Created ${formatDateTime(thesis.created_at)}`}
        action={<DirectionBadge value={thesis.direction} />}
      />
      <div className="grid two">
        <Panel title="Summary">
          <div className="stack">
            <div className="row">
              <strong>{thesis.summary.rating || thesis.setup_type}</strong>
              <ConfidenceBadge value={thesis.confidence} />
            </div>
            <p>{thesis.summary.action_summary || thesis.thesis_text || 'No thesis text.'}</p>
            <div className="row small"><span>Setup</span><span>{thesis.setup_type}</span></div>
            <div className="row small"><span>Entry</span><span>{thesis.entry_zone || 'n/a'}</span></div>
            <div className="row small"><span>Invalidation</span><strong>{thesis.invalidation_level || 'n/a'}</strong></div>
            <div className="row small"><span>Run</span><IdChip value={thesis.research_run_id} /></div>
            {thesis.research_run_id ? (
              <Link className="button" href={routes.researchRun(thesis.research_run_id)}>
                Open run
              </Link>
            ) : null}
          </div>
        </Panel>

        <Panel title="Evidence">
          <div className="stack">
            <EvidenceBlock title="Supporting signals" values={thesis.supporting_signal_ids} />
            <EvidenceBlock title="Contradicting signals" values={thesis.contradicting_signal_ids} />
            <EvidenceBlock title="Stale or missing data" values={thesis.stale_or_missing_data} />
            <EvidenceBlock title="Monitor next" values={thesis.monitor_next} />
          </div>
        </Panel>

        <Panel title="Reasons and risks">
          <div className="grid two">
            <EvidenceBlock title="Key reasons" values={thesis.summary.key_reasons} />
            <EvidenceBlock title="Risks" values={thesis.summary.risks} />
          </div>
        </Panel>

        <Panel title="Scenarios">
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
                  <span className="badge">{scenario.suggested_user_action || 'review'}</span>
                </div>
                <div className="small"><strong>Condition:</strong> {scenario.condition || 'n/a'}</div>
                <div className="small muted"><strong>Expected:</strong> {scenario.expected_behavior || 'n/a'}</div>
                <JsonView value={scenario.payload} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Record decision" description="User-reviewed journal action">
          <form className="stack" onSubmit={submitDecision}>
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
        </Panel>

        <Panel title="Outcome review" description="Capture what happened later">
          <form className="stack" onSubmit={submitReview}>
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
            <button className="button primary" disabled={reviewMutation.isPending} type="submit">
              Record review
            </button>
          </form>
        </Panel>
      </div>
    </main>
  );
}

function EvidenceBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <strong>{title}</strong>
      {values.length === 0 ? (
        <p className="small muted">None reported.</p>
      ) : (
        <div className="top-strip-meta" style={{ marginTop: 8 }}>
          {values.map((value) => (
            <span className="badge mono" key={value}>
              {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
