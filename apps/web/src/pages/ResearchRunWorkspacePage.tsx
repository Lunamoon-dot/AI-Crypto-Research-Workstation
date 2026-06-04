import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Brain,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileText,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  generateResearchRunContinuity,
  getResearchRunContinuity,
} from '@/services/research-continuity';
import {
  getJobStatus,
  getJournalRunEvidenceBundle,
  getJournalRunWorkspace,
  getResearchRunEvidenceBundle,
  getResearchRunWorkspace,
} from '@/services/research-runs';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DataQualityBadge,
  DirectionBadge,
  IdChip,
  RatingBadge,
  StatusBadge,
} from '@/components/research/badges';
import { BentoGrid, DataPair, TimelineRow } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import {
  WorkflowVisualization,
  type WorkflowVisualizationStage,
} from '@/components/research/workflow-visualization';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatConfidence, formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  AgentOpinionResponse,
  ResearchRunArtifactsResponse,
  ResearchContinuityEntrySummaryResponse,
  ResearchRunEventResponse,
  JournalRunWorkspaceResponse,
  ResearchRunStageTimingResponse,
  SignalSnapshotResponse,
} from '@/types';

const agentAvatarSrc = (fileName: string) => `/agent-avatars/${fileName}`;
const terminalArtifactPollWindowMs = 2 * 60 * 1000;
const continuityEntryPollWindowMs = 30 * 1000;

const pipelineStages = [
  {
    key: 'quant',
    label: 'Quant',
    icon: BarChart3,
    avatarSrc: agentAvatarSrc('signal.png'),
    aliases: ['quant', 'quant analyst', 'signal'],
  },
  {
    key: 'market',
    label: 'Market',
    icon: Database,
    avatarSrc: agentAvatarSrc('market-analyst.png'),
    aliases: ['market', 'market analyst'],
  },
  {
    key: 'news',
    label: 'News',
    icon: Newspaper,
    avatarSrc: agentAvatarSrc('news-analyst.png'),
    aliases: ['news', 'news analyst'],
  },
  {
    key: 'social',
    label: 'Social',
    icon: Users,
    avatarSrc: agentAvatarSrc('social-analyst.png'),
    aliases: ['social', 'sentiment', 'sentiment analyst', 'social analyst'],
  },
  {
    key: 'onchain',
    label: 'Onchain',
    icon: WalletCards,
    avatarSrc: agentAvatarSrc('onchain-analyst.png'),
    aliases: ['onchain', 'fundamental', 'onchain analyst'],
  },
  {
    key: 'debate',
    label: 'Bull/Contrarian Debate',
    icon: Brain,
    avatarSrc: agentAvatarSrc('bull-contrarian-debate-agent.png'),
    aliases: ['bull researcher', 'bear researcher', 'contrarian analyst'],
    requiredAliases: [['bull researcher'], ['bear researcher', 'contrarian analyst']],
  },
  {
    key: 'research_manager',
    label: 'Research Manager',
    icon: Users,
    avatarSrc: agentAvatarSrc('research-manager-agent.png'),
    aliases: ['research manager', 'research_manager'],
  },
  {
    key: 'setup_planner',
    label: 'Setup Planner',
    icon: CheckCircle2,
    avatarSrc: agentAvatarSrc('setup-planner-agent.png'),
    aliases: ['setup planner', 'setup_planner', 'trader'],
  },
  {
    key: 'spot_checks',
    label: 'Spot Checks',
    icon: WalletCards,
    avatarSrc: agentAvatarSrc('spot-checks.png'),
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['spot'],
    detail: 'Accumulation / DCA / allocation',
  },
  {
    key: 'perp_checks',
    label: 'Perp Checks',
    icon: ShieldAlert,
    avatarSrc: agentAvatarSrc('spot-checks.png'),
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['perp'],
    detail: 'Funding / OI / liquidation',
  },
  {
    key: 'risk_debate',
    label: 'Risk Debate',
    icon: ShieldAlert,
    avatarSrc: agentAvatarSrc('risk-debate-agent.png'),
    aliases: [
      'risk',
      'risk analyst',
      'aggressive analyst',
      'conservative analyst',
      'neutral analyst',
    ],
    requiredAliases: [
      ['aggressive analyst', 'risk analyst - aggressive'],
      ['conservative analyst', 'risk analyst - conservative'],
      ['neutral analyst', 'risk analyst - neutral'],
    ],
  },
  {
    key: 'portfolio_manager',
    label: 'Portfolio Manager',
    icon: BarChart3,
    avatarSrc: agentAvatarSrc('portfolio-manager-agent.png'),
    aliases: ['portfolio manager', 'portfolio_manager'],
  },
  {
    key: 'scenario_planner',
    label: 'Scenario Planner',
    icon: Newspaper,
    avatarSrc: agentAvatarSrc('scenario-planner-agent.png'),
    aliases: ['scenario planner', 'scenarioplanner', 'scenario.plan', 'scenarios_saved'],
  },
  {
    key: 'thesis',
    label: 'Trade Thesis',
    icon: Brain,
    avatarSrc: agentAvatarSrc('trade-thesis-agent.png'),
    aliases: ['thesis', 'trade thesis', 'trade_thesis', 'thesis.generated'],
  },
] as const;
type PipelineStage = (typeof pipelineStages)[number];
type MarketTypeKey = 'spot' | 'perp';
const analystStageKeys = new Set(['market', 'news', 'social', 'onchain']);

export function ResearchRunWorkspacePage({ journal = false }: { journal?: boolean }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const runId = id ?? '';
  const [exportingBundle, setExportingBundle] = useState(false);
  const [exportError, setExportError] = useState('');
  const jobId = searchParams.get('job_id') ?? searchParams.get('job') ?? runId;
  const jobQuery = useQuery({
    queryKey: queryKeys.jobStatus(jobId),
    queryFn: () => getJobStatus(jobId, auth),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isActiveJobStatus(status) ? 5000 : false;
    },
    retry: false,
  });
  const query = useQuery({
    queryKey: queryKeys.researchRunWorkspace(runId),
    queryFn: () =>
      journal
        ? getJournalRunWorkspace(runId, auth)
        : getResearchRunWorkspace(runId, auth),
    refetchInterval: (query) => {
      const workspace = query.state.data;
      if (isActiveJobStatus(workspace?.run.status)) {
        return 5000;
      }
      if (shouldPollTerminalArtifacts(workspace, query.state.dataUpdatedAt)) {
        return 5000;
      }
      if (query.state.error && isActiveJobStatus(jobQuery.data?.status)) {
        return 5000;
      }
      return false;
    },
    retry: false,
  });
  const workspaceForContinuity = query.data;
  const continuityQueryEnabled = Boolean(
    runId &&
      workspaceForContinuity &&
      isContinuityEligibleRunStatus(workspaceForContinuity.run.status),
  );
  const continuityQuery = useQuery({
    queryKey: queryKeys.researchRunContinuity(runId),
    queryFn: () => getResearchRunContinuity(runId, auth),
    enabled: continuityQueryEnabled,
    refetchInterval: (query) => {
      if (!continuityQueryEnabled || query.state.data) {
        return false;
      }
      return shouldPollRecentTerminalRun(
        workspaceForContinuity,
        query.state.dataUpdatedAt,
        continuityEntryPollWindowMs,
      )
        ? 5000
        : false;
    },
    refetchOnMount: 'always',
    retry: (failureCount) =>
      failureCount < 3 &&
      shouldPollRecentTerminalRun(
        workspaceForContinuity,
        0,
        continuityEntryPollWindowMs,
      ),
    retryDelay: 1000,
  });
  const continuityMutation = useMutation({
    mutationFn: () => generateResearchRunContinuity(runId, { force: true }, auth),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.researchRunContinuity(runId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.researchContinuityState(response.entry.symbol),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.researchContinuityEntries({
          symbol: response.entry.symbol,
        }),
      });
    },
  });

  if (query.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading run workspace..." />
      </main>
    );
  }

  if (query.isError) {
    if (jobQuery.isLoading) {
      return (
        <main className="page">
          <LoadingState label="Checking run job status..." />
        </main>
      );
    }
    if (jobQuery.data) {
      const activeJob = isActiveJobStatus(jobQuery.data.status);
      const failedJob = jobQuery.data.status === 'failed';
      return (
        <main className="page">
          <PageHeader
            eyebrow="03 Research Workspace"
            title={
              activeJob
                ? 'Research run pending'
                : failedJob
                  ? 'Research run failed'
                  : 'Research artifacts unavailable'
            }
            description={`Run ${jobQuery.data.run_id}`}
            action={<StatusBadge value={jobQuery.data.status} />}
          />
          <BentoGrid>
            <Panel className="span-6 emphasis" title="Job status">
              <div className="stack small">
                <DataPair label="Backend" value={jobQuery.data.backend} />
                <DataPair label="Created" value={formatDateTime(jobQuery.data.created_at)} />
                <DataPair label="Started" value={formatDateTime(jobQuery.data.started_at)} />
                <DataPair label="Completed" value={formatDateTime(jobQuery.data.completed_at)} />
                <DataPair label="Retries" value={jobQuery.data.retry_count} />
              </div>
            </Panel>
            <Panel className="span-6" title="Artifacts">
              <EmptyState
                label={
                  activeJob
                    ? 'Run artifacts have not been persisted yet. This page will keep polling.'
                    : failedJob
                      ? 'The research engine failed before artifacts were persisted.'
                      : 'The job is no longer active, but persisted artifacts were not found.'
                }
              />
              {jobQuery.data.error_message ? (
                <div className="badge risk">{jobQuery.data.error_message}</div>
              ) : null}
            </Panel>
          </BentoGrid>
        </main>
      );
    }
    return (
      <main className="page">
        <ErrorState error={query.error} />
      </main>
    );
  }

  const workspace = query.data;
  if (!workspace) {
    return (
      <main className="page">
        <EmptyState label="Run workspace not found." />
      </main>
    );
  }

  const market = workspace.snapshots.market_snapshot;
  const signal = workspace.snapshots.signal_snapshot;
  const runFailed = workspace.run.status === 'failed';
  const runTerminal = isTerminalRunStatus(workspace.run.status);
  const continuityPending =
    isActiveJobStatus(workspace.run.status) ||
    (isContinuityEligibleRunStatus(workspace.run.status) &&
      !continuityQuery.data &&
      shouldPollRecentTerminalRun(
        workspace,
        query.dataUpdatedAt,
        continuityEntryPollWindowMs,
      ));
  const continuityError =
    continuityMutation.error ??
    (continuityPending ? null : continuityQuery.error);
  const continuityIsError =
    continuityMutation.isError || (!continuityPending && continuityQuery.isError);
  const artifactPolling = shouldPollTerminalArtifacts(workspace);
  const marketType = normalizeMarketType(workspace.run.market_type);
  const artifacts = workspace.artifacts ?? emptyArtifacts();
  const selectedAnalysts = selectedAnalystKeysFromEvents(workspace.events);
  const visiblePipelineStages = pipelineStages.filter(
    (stage) =>
      stageIsVisibleForMarketType(stage, marketType) &&
      (!analystStageKeys.has(stage.key) ||
        selectedAnalysts === null ||
        selectedAnalysts.has(stage.key)),
  );
  const perpMissingData =
    marketType === 'perp'
      ? uniqueStrings([
          ...workspace.run.missing_core_data,
          ...workspace.run.missing_optional_data,
          ...(workspace.thesis?.summary.missing_data ?? []),
        ])
      : [];
  const workflowStages: WorkflowVisualizationStage[] = visiblePipelineStages.map(
    (stage) => {
      const stageOpinions = workspace.debate.agent_opinions.filter((item) =>
        matchesStageOpinion(item, stage.aliases),
      );
      const opinion = stageOpinions[0];
      const debateMatch = stage.key === 'debate' ? workspace.debate.debate : null;
      const stageState = resolvePipelineStageState({
        stage,
        events: workspace.events,
        opinionCount: stageOpinions.length,
        debateReady: Boolean(debateMatch),
        signal,
        scenarioCount: workspace.scenarios.length,
        thesisReady: Boolean(workspace.thesis),
        runFailed,
        runTerminal,
      });
      const detail = pipelineStageDetail({
        stage,
        opinion,
        opinionCount: stageOpinions.length,
        debateStance: debateMatch?.consensus_stance,
        stateDetail: stageState.detail,
      });
      return {
        key: stage.key,
        label: stage.label,
        icon: stage.icon,
        avatarSrc: stage.avatarSrc,
        statusLabel: stageState.label,
        badgeClass: stageState.badgeClass,
        detail,
        confidence: opinion?.confidence ?? null,
        warning:
          stage.key === 'perp_checks' && perpMissingData.length > 0
            ? `Missing: ${perpMissingData.join(', ')}`
            : undefined,
      };
    },
  );
  const workflowStageTimings = mergeWorkflowStageTimings(
    workspace.stage_timings ?? [],
    visiblePipelineStages,
    workspace.events,
    runTerminal,
  );
  const latestFailure = latestRunFailureEvent(workspace.events);
  const failureReason = latestFailure ? runFailureMessage(latestFailure) : '';
  const failedStageLabel = workflowStageTimings.find(
    (timing) => timing.event_state === 'failed',
  )?.label;
  const failureTitle = failedStageLabel
    ? `Run failed during ${failedStageLabel}`
    : 'Run failed';

  async function exportEvidenceBundle() {
    setExportingBundle(true);
    setExportError('');
    try {
      const bundle = journal
        ? await getJournalRunEvidenceBundle(runId, auth)
        : await getResearchRunEvidenceBundle(runId, auth);
      downloadJson(bundle, `evidence-bundle-${safeFileName(runId)}.json`);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportingBundle(false);
    }
  }

  return (
    <main className="page research-workspace-page">
      <PageHeader
        eyebrow="Luna Research"
        title={`${workspace.run.symbol} dossier workspace`}
        description={`${marketType.toUpperCase()} research run ${workspace.run.run_id ?? workspace.run.id ?? runId}. Review the memo, evidence health, continuity entry, and artifact provenance from one place.`}
        action={
          <div className="page-header-action-stack research-workspace-header-actions">
            <HeaderStats
              stats={[
                {
                  icon: <CheckCircle2 aria-hidden size={14} />,
                  label: 'Status',
                  tone: workspace.run.status === 'completed' ? 'constructive' : 'warning',
                  value: <StatusBadge value={workspace.run.status} />,
                },
                {
                  icon: <Database aria-hidden size={14} />,
                  label: 'Market price',
                  meta: market?.source || 'No market snapshot',
                  tone: 'primary',
                  value: formatNumber(market?.current_price),
                },
                {
                  icon: <BarChart3 aria-hidden size={14} />,
                  label: 'Signals',
                  meta: 'Bullish / bearish / neutral',
                  value: signal?.signal_count ?? 0,
                },
                {
                  icon: <FileText aria-hidden size={14} />,
                  label: 'Continuity',
                  meta: continuityQuery.data?.entry_type ?? (continuityPending ? 'writing ledger' : 'ledger entry'),
                  tone: continuityQuery.data ? 'constructive' : continuityPending ? 'warning' : 'degraded',
                  value: continuityQuery.data ? <StatusBadge value={continuityQuery.data.status} /> : continuityPending ? 'pending' : 'not written',
                },
              ]}
            />
            <button
              className="button"
              disabled={exportingBundle}
              onClick={exportEvidenceBundle}
              type="button"
            >
              <Download aria-hidden size={15} />
              {exportingBundle ? 'Exporting' : 'Export evidence bundle'}
            </button>
          </div>
        }
      />
      {exportError ? <div className="badge risk">{exportError}</div> : null}
      {latestFailure ? (
        <div className="callout risk">
          <strong>{failureTitle}</strong>
          <p>{failureReason}</p>
        </div>
      ) : null}

      <BentoGrid className="research-workspace-grid">
        <WorkspaceDossierPanel
          continuityEntry={continuityQuery.data ?? null}
          marketType={marketType}
          workspace={workspace}
        />

        <Panel
          className="span-12 emphasis research-pipeline-panel"
          title="Research assembly line"
          description="Analyst fan-out, debate, risk checks, and final synthesis for this dossier"
        >
          <WorkflowVisualization
            marketType={marketType}
            stageTimings={workflowStageTimings}
            stages={workflowStages}
          />
        </Panel>

        <DailyDeltaPanel
          entry={continuityQuery.data ?? null}
          error={continuityError}
          isError={continuityIsError}
          isLoading={
            continuityPending ||
            (continuityQueryEnabled &&
              continuityQuery.isFetching &&
              !continuityQuery.data)
          }
          isRegenerating={continuityMutation.isPending}
          onRegenerate={() => continuityMutation.mutate()}
        />

        <Panel
          className="span-4 research-provenance-panel"
          title="Run provenance"
          description="Identifiers and timestamps for auditability"
        >
          <div className="stack small">
            <DataPair label="Market type" value={workspace.run.market_type} />
            <DataPair label="Started" value={formatDateTime(workspace.run.started_at)} />
            <DataPair label="Completed" value={formatDateTime(workspace.run.completed_at)} />
            <DataPair label="Thesis" value={<IdChip value={workspace.run.thesis_id} />} />
            <DataPair label="Market snapshot" value={<IdChip value={workspace.run.market_snapshot_id} />} />
            <DataPair label="Signal snapshot" value={<IdChip value={workspace.run.signal_snapshot_id} />} />
            {jobQuery.data ? <DataPair label="Job" value={jobQuery.data.status} /> : null}
          </div>
        </Panel>

        <FullReportArtifactPanel
          artifacts={artifacts}
          artifactPolling={artifactPolling}
          runTerminal={runTerminal}
        />

        <Panel
          className="span-4 research-quality-panel"
          title="Evidence health"
          description="What is clean, missing, or degraded"
        >
          <div className="quality-reason-list">
            <QualityReasonGroup
              emptyLabel="No degradation reasons reported."
              label="Degradation"
              tone="warning"
              values={workspace.run.degradation_reasons}
            />
            <QualityReasonGroup
              emptyLabel="No core data gaps reported."
              label="Core data"
              tone="risk"
              values={workspace.run.missing_core_data}
            />
            <QualityReasonGroup
              emptyLabel="No optional data gaps reported."
              label="Optional data"
              tone="warning"
              values={workspace.run.missing_optional_data}
            />
          </div>
        </Panel>

        <Panel
          className="span-5 research-memo-panel"
          title="Research memo"
          description="Manager output distilled into decision-readable evidence"
        >
          {workspace.thesis ? (
            <div className="research-memo-layout">
              <div className="research-memo-heading">
                <div>
                  <span className="small muted">{workspace.thesis.symbol}</span>
                  <strong>{workspace.thesis.summary.rating || 'Hold'}</strong>
                </div>
                <div className="research-memo-badges">
                  <DirectionBadge value={workspace.thesis.direction} />
                  <ConfidenceBadge value={workspace.thesis.confidence} />
                  <DataQualityBadge
                    label={workspace.thesis.summary.data_quality_label}
                    value={workspace.thesis.summary.data_quality}
                  />
                </div>
              </div>
              <p className="research-memo-copy">
                {workspace.thesis.summary.action_summary || workspace.thesis.thesis_text}
              </p>
              {marketTypeSpecificThesisNote(workspace.thesis.summary, marketType) ? (
                <p className="small muted">
                  {marketTypeSpecificThesisNote(workspace.thesis.summary, marketType)}
                </p>
              ) : null}
              <div className="research-memo-facts">
                <DataPair label="Entry" value={workspace.thesis.entry_zone || 'n/a'} />
                <DataPair label="Invalidation" value={workspace.thesis.invalidation_level || 'n/a'} />
                <DataPair label="Targets" value={workspace.thesis.target_zones.join(' / ') || 'n/a'} />
              </div>
              <div className="research-memo-section-grid">
                <MemoBulletList
                  emptyLabel="No key reasons persisted."
                  items={workspace.thesis.summary.key_reasons}
                  title="Key reasons"
                />
                <MemoBulletList
                  emptyLabel="No risks persisted."
                  items={workspace.thesis.summary.risks}
                  title="Risks"
                />
              </div>
              {workspace.thesis.id ? (
                <div className="top-strip-meta">
                  <Link className="button primary" to={routes.thesis(workspace.thesis.id)}>
                    Open research memo
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState label="The research manager has not generated a memo yet." />
          )}
        </Panel>

        <Panel className="span-7 research-snapshot-panel" title="Market snapshot" description="Price and source provenance">
          {market ? (
            <div className="snapshot-card small">
              <div className="snapshot-card-primary">
                <span className="small muted">Current price</span>
                <strong>{formatNumber(market.current_price)}</strong>
                <p>{market.source || 'No source reported'}</p>
              </div>
              <div className="snapshot-metric-grid">
                <DataPair label="Source time" value={formatDateTime(market.source_timestamp)} />
                <DataPair label="Captured" value={formatDateTime(market.captured_at)} />
                <DataPair label="Snapshot" value={<IdChip value={market.id} />} />
              </div>
              <JsonView value={market.payload} />
            </div>
          ) : (
            <EmptyState label="No market snapshot persisted yet." />
          )}
        </Panel>

        <Panel className="span-5 research-snapshot-panel" title="Signal snapshot" description="Aggregated deterministic evidence">
          {signal ? (
            <div className="snapshot-card small">
              <div className="signal-count-strip">
                <SignalCount label="Bullish" tone="constructive" value={signal.bullish_count ?? 0} />
                <SignalCount label="Bearish" tone="risk" value={signal.bearish_count ?? 0} />
                <SignalCount label="Neutral" tone="primary" value={signal.neutral_count ?? 0} />
                <SignalCount label="Stale" tone="warning" value={signal.stale_count ?? 0} />
              </div>
              <div className="snapshot-metric-grid">
                <DataPair label="Total" value={<strong>{signal.signal_count ?? 0}</strong>} />
                <DataPair label="Captured" value={formatDateTime(signal.captured_at)} />
                <DataPair label="Snapshot" value={<IdChip value={signal.id} />} />
              </div>
              <JsonView value={signal.payload} />
            </div>
          ) : (
            <EmptyState label="No signal snapshot persisted yet." />
          )}
        </Panel>

        <Panel className="span-12 research-trace-panel" title="Execution trace" description="Chronological run events and raw payloads">
          {workspace.events.length === 0 ? <EmptyState label="No run events yet." /> : null}
          <div className="timeline-list">
            {workspace.events.map((event) => (
              <TimelineRow
                key={event.id ?? `${event.event_type}-${event.created_at}`}
                meta={formatDateTime(event.created_at)}
                title={event.event_type}
              >
                {event.message}
                <JsonView value={event.payload} />
              </TimelineRow>
            ))}
          </div>
        </Panel>

        <Panel className="span-12 research-debate-panel" title="Analyst debate" description="Consensus, disagreement, confidence, and raw evidence payloads">
          {workspace.debate.debate ? (
            <div className="stack">
              <div className="row">
                <DirectionBadge value={workspace.debate.debate.consensus_stance} />
                <span className="badge warning">{workspace.debate.debate.conflict_level}</span>
              </div>
              {workspace.debate.agent_opinions.map((opinion) => (
                <div className="list-row" key={opinion.id ?? opinion.agent_name}>
                  <div className="row">
                    <strong>{opinion.agent_name}</strong>
                    <ConfidenceBadge value={opinion.confidence} />
                    <DataQualityBadge
                      label={opinion.data_quality_label}
                      value={opinion.data_quality}
                    />
                  </div>
                  <div className="small muted">{opinion.agent_role} | {opinion.stance}</div>
                  <JsonView value={opinion.payload} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="No debate persisted yet." />
          )}
        </Panel>
      </BentoGrid>
    </main>
  );
}


type ResearchTone = 'default' | 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

function WorkspaceDossierPanel({
  continuityEntry,
  marketType,
  workspace,
}: {
  continuityEntry: ResearchContinuityEntrySummaryResponse | null;
  marketType: MarketTypeKey;
  workspace: JournalRunWorkspaceResponse;
}) {
  const market = workspace.snapshots.market_snapshot;
  const signal = workspace.snapshots.signal_snapshot;
  const thesis = workspace.thesis;
  const debate = workspace.debate.debate;
  const continuityQuality = continuityEntry?.thin_report?.quality;
  const memoCopy =
    thesis?.summary.action_summary ||
    thesis?.thesis_text ||
    'The research memo is still pending. The workspace will keep the pipeline, artifacts, and continuity state visible as they arrive.';

  return (
    <Panel
      className="span-12 workspace-briefing-panel"
      title="Dossier readout"
      description="Fast answer first, with provenance and raw evidence kept below"
    >
      <div className="workspace-briefing">
        <section className="workspace-briefing-primary">
          <div className="workspace-briefing-kicker">
            <span className="badge primary">{marketType.toUpperCase()}</span>
            <StatusBadge value={workspace.run.status} />
            {thesis ? (
              <RatingBadge value={thesis.summary.rating || 'Hold'} />
            ) : (
              <span className="badge warning">memo pending</span>
            )}
          </div>
          <h3>
            {thesis
              ? `${thesis.symbol} ${thesis.direction || 'direction pending'}`
              : `${workspace.run.symbol} memo pending`}
          </h3>
          <p>{memoCopy}</p>
          {thesis?.summary.is_degraded ? (
            <div className="callout warning workspace-briefing-warning">
              <ShieldAlert aria-hidden size={15} />
              <div>
                <strong>Degraded evidence</strong>
                <p>
                  {thesis.summary.degradation_reasons.join(', ') ||
                    'The memo was generated with partial evidence.'}
                </p>
              </div>
            </div>
          ) : null}
          <div className="workspace-briefing-actions">
            {thesis?.id ? (
              <Link className="button primary" to={routes.thesis(thesis.id)}>
                Open research memo
              </Link>
            ) : null}
            {continuityEntry ? (
              <Link
                className="button"
                to={routes.researchContinuity(continuityEntry.symbol)}
              >
                Open continuity ledger
              </Link>
            ) : null}
          </div>
        </section>

        <div className="workspace-briefing-rail" aria-label="Dossier facts">
          <DossierFact
            icon={<Database aria-hidden size={15} />}
            label="Market"
            meta={market?.source || 'No market snapshot'}
            tone="primary"
            value={formatNumber(market?.current_price)}
          />
          <DossierFact
            icon={<BarChart3 aria-hidden size={15} />}
            label="Signals"
            meta={`${signal?.bullish_count ?? 0} bullish / ${signal?.bearish_count ?? 0} bearish`}
            tone="constructive"
            value={signal?.signal_count ?? 0}
          />
          <DossierFact
            icon={<Brain aria-hidden size={15} />}
            label="Debate"
            meta={debate?.conflict_level ?? `${workspace.debate.agent_opinions.length} opinions`}
            tone={debate ? 'warning' : 'degraded'}
            value={debate?.consensus_stance ?? 'pending'}
          />
          <DossierFact
            icon={<FileText aria-hidden size={15} />}
            label="Continuity"
            meta={
              continuityQuality
                ? `Quality ${continuityQuality.status} / coverage ${formatConfidence(
                    continuityQuality.observed_evidence_coverage,
                  )}`
                : 'Ledger entry pending'
            }
            tone={continuityEntry ? 'constructive' : 'degraded'}
            value={continuityEntry?.status ?? 'not written'}
          />
        </div>
      </div>
    </Panel>
  );
}

function DossierFact({
  icon,
  label,
  meta,
  tone = 'default',
  value,
}: {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  tone?: ResearchTone;
  value: ReactNode;
}) {
  return (
    <div className="dossier-fact">
      <div className="dossier-fact-label">
        <span>{label}</span>
        <span className={`tone-${tone}`}>{icon}</span>
      </div>
      <strong className={`tone-${tone}`}>{value}</strong>
      {meta ? <p>{meta}</p> : null}
    </div>
  );
}

function QualityReasonGroup({
  emptyLabel,
  label,
  tone,
  values,
}: {
  emptyLabel: string;
  label: string;
  tone: Exclude<ResearchTone, 'default' | 'degraded'>;
  values: string[];
}) {
  const clean = values.length === 0;
  return (
    <section className={`quality-reason-group${clean ? ' clean' : ''}`}>
      <div className="quality-reason-header">
        <strong>{label}</strong>
        <span className={`badge ${clean ? 'constructive' : tone}`}>
          {clean ? 'clear' : `${values.length} item${values.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {clean ? (
        <p className="small muted">{emptyLabel}</p>
      ) : (
        <div className="quality-chip-list">
          {values.map((value) => (
            <span className={`pill ${tone}`} key={value}>
              {value}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function MemoBulletList({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: string[];
  title: string;
}) {
  const visibleItems = items.filter(Boolean).slice(0, 4);
  return (
    <section className="research-memo-section">
      <span>{title}</span>
      {visibleItems.length ? (
        <ul>
          {visibleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </section>
  );
}

function SignalCount({
  label,
  tone,
  value,
}: {
  label: string;
  tone: Exclude<ResearchTone, 'default' | 'degraded'>;
  value: number;
}) {
  return (
    <div className="signal-count">
      <span>{label}</span>
      <strong className={`tone-${tone}`}>{value}</strong>
    </div>
  );
}

function ContinuityQualityRow({
  entry,
}: {
  entry: ResearchContinuityEntrySummaryResponse;
}) {
  const quality = entry.thin_report?.quality;
  if (!quality) {
    return null;
  }
  return (
    <div className="daily-delta-quality-row">
      <div>
        <span>Quality</span>
        <strong>{quality.status}</strong>
      </div>
      <div>
        <span>Score</span>
        <strong>{formatConfidence(quality.score)}</strong>
      </div>
      <div>
        <span>Observed coverage</span>
        <strong>{formatConfidence(quality.observed_evidence_coverage)}</strong>
      </div>
      <div>
        <span>Provenance</span>
        <strong>{quality.provenance_status ?? 'n/a'}</strong>
      </div>
    </div>
  );
}

function DailyDeltaPanel({
  entry,
  error,
  isError,
  isLoading,
  isRegenerating,
  onRegenerate,
}: {
  entry: ResearchContinuityEntrySummaryResponse | null;
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  const detailSections = entry?.thin_report?.sections ?? [];

  return (
    <Panel
      className="span-12 daily-delta-panel"
      title="Continuity ledger entry"
      description="Memory written from this research run for the next dossier"
    >
      {isLoading ? <LoadingState label="Writing continuity ledger entry..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {!isLoading && !isError && !entry ? (
        <div className="stack">
          <EmptyState label="No continuity entry has been written for this run." />
          <button
            className="button"
            disabled={isRegenerating}
            onClick={onRegenerate}
            type="button"
          >
            <RefreshCw aria-hidden size={15} />
            {isRegenerating ? 'Regenerating' : 'Write continuity entry'}
          </button>
        </div>
      ) : null}
      {entry ? (
        <div className="daily-delta-layout">
          <div className="daily-delta-toolbar">
            <div className="daily-delta-status">
              <span className="badge primary">{entry.entry_type}</span>
              <StatusBadge value={entry.status} />
              <span className="small muted">{formatDateTime(entry.generated_at)}</span>
            </div>
            <div className="daily-delta-actions">
              <Link
                className="button"
                to={routes.researchContinuity(entry.symbol)}
              >
                Open continuity
              </Link>
              {entry.id ? (
                <Link className="button" to={routes.researchContinuityEntry(entry.id)}>
                  Details
                </Link>
              ) : null}
              <button
                className="button"
                disabled={isRegenerating}
                onClick={onRegenerate}
                type="button"
              >
                <RefreshCw aria-hidden size={15} />
                {isRegenerating ? 'Regenerating' : 'Regenerate'}
              </button>
            </div>
          </div>

          <div className="daily-delta-summary">
            <strong>Ledger summary</strong>
            <p>{entry.summary}</p>
          </div>

          <ContinuityQualityRow entry={entry} />
          <ContinuityMarkdownArtifactRow entry={entry} />

          {detailSections.length > 0 ? (
            <div className="daily-delta-section-grid">
              {detailSections.slice(0, 4).map((section) => (
                <section className="daily-delta-section" key={section.id}>
                  <h4>{section.title}</h4>
                  <p>{section.items[0] ?? 'No changes reported.'}</p>
                </section>
              ))}
            </div>
          ) : null}

          <div className="daily-delta-meta">
            <div>
              <span className="small muted">Source run</span>
              <IdChip value={entry.research_run_id} />
            </div>
            <div>
              <span className="small muted">Entry</span>
              <IdChip value={entry.id} />
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ContinuityMarkdownArtifactRow({
  entry,
}: {
  entry: ResearchContinuityEntrySummaryResponse;
}) {
  const [copied, setCopied] = useState(false);
  const artifact = entry.markdown_artifact;
  const status = artifact?.exists
    ? { label: 'Markdown saved', className: 'badge constructive' }
    : { label: 'Markdown not exported', className: 'badge warning' };

  async function copyPath() {
    if (!artifact?.path) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(artifact.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="daily-delta-artifact">
      <div className="row">
        <span className={status.className}>{status.label}</span>
        <button
          className="button"
          disabled={!artifact?.path}
          onClick={copyPath}
          type="button"
        >
          <Clipboard aria-hidden size={15} />
          {copied ? 'Copied' : 'Copy path'}
        </button>
      </div>
      <div className="artifact-path">
        <FileText aria-hidden size={15} />
        <code>{artifact?.path ?? 'No continuity_report.md path resolved.'}</code>
      </div>
      {artifact?.exists ? (
        <div className="small muted">
          {formatBytes(artifact.size_bytes)} | {formatDateTime(artifact.modified_at)}
        </div>
      ) : null}
    </div>
  );
}

function FullReportArtifactPanel({
  artifactPolling,
  artifacts,
  runTerminal,
}: {
  artifactPolling: boolean;
  artifacts: ResearchRunArtifactsResponse;
  runTerminal: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const report = artifacts.full_report;
  const state = artifacts.full_state;
  const reportStatus = artifactStatusLabel(
    report.exists,
    runTerminal,
    artifactPolling,
  );

  async function copyPath() {
    if (!report.path) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(report.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Panel
      className="span-4 research-artifact-panel"
      title="Evidence bundle"
      description="Persisted Markdown report and full-state JSON"
    >
      <div className="stack">
        <div className="row">
          <span className={reportStatus.className}>{reportStatus.label}</span>
          <button
            className="button"
            disabled={!report.path}
            onClick={copyPath}
            type="button"
          >
            <Clipboard aria-hidden size={15} />
            {copied ? 'Copied' : 'Copy path'}
          </button>
        </div>
        <div className="artifact-path">
          <FileText aria-hidden size={15} />
          <code>{report.path ?? 'No report path resolved.'}</code>
        </div>
        <div className="stack small">
          <DataPair
            label="Markdown"
            value={artifactMeta(report, runTerminal, artifactPolling)}
          />
          <DataPair
            label="State JSON"
            value={
              state.exists
                ? artifactMeta(state, runTerminal, artifactPolling)
                : artifactStatusLabel(false, runTerminal, artifactPolling).label
            }
          />
        </div>
      </div>
    </Panel>
  );
}

function artifactStatusLabel(
  exists: boolean,
  runTerminal: boolean,
  artifactPolling = false,
) {
  if (exists) {
    return { label: 'Saved', className: 'badge constructive' };
  }
  if (!runTerminal || artifactPolling) {
    return { label: 'Pending', className: 'badge warning' };
  }
  return { label: 'Not found', className: 'badge risk' };
}

function artifactMeta(artifact: {
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}, runTerminal: boolean, artifactPolling = false) {
  if (!artifact.exists) {
    return artifactStatusLabel(false, runTerminal, artifactPolling).label;
  }
  const size = formatBytes(artifact.size_bytes);
  const modified = formatDateTime(artifact.modified_at);
  return `${size} | ${modified}`;
}

function formatBytes(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'n/a';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function emptyArtifacts(): ResearchRunArtifactsResponse {
  return {
    full_report: emptyArtifact('full_report', 'Full report'),
    full_state: emptyArtifact('full_state', 'Full state JSON'),
  };
}

function emptyArtifact(
  kind: 'full_report' | 'full_state',
  label: string,
) {
  return {
    kind,
    label,
    path: null,
    exists: false,
    size_bytes: null,
    modified_at: null,
  };
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function isActiveJobStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running';
}

function isTerminalRunStatus(status: string | undefined): boolean {
  return Boolean(
    status &&
      !['created', 'queued', 'running', 'submitted', 'pending'].includes(status),
  );
}

function isContinuityEligibleRunStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'completed_degraded';
}

function shouldPollRecentTerminalRun(
  workspace: JournalRunWorkspaceResponse | undefined,
  observedAt = 0,
  windowMs = terminalArtifactPollWindowMs,
): boolean {
  if (!workspace || !isTerminalRunStatus(workspace.run.status)) {
    return false;
  }
  const terminalAt = Math.max(
    timestampMs(workspace.run.completed_at) ?? 0,
    timestampMs(workspace.run.started_at) ?? 0,
    observedAt,
  );
  if (terminalAt <= 0) {
    return false;
  }
  return Date.now() - terminalAt < windowMs;
}

function shouldPollTerminalArtifacts(
  workspace: JournalRunWorkspaceResponse | undefined,
  observedAt = 0,
): boolean {
  if (!workspace || !isTerminalRunStatus(workspace.run.status)) {
    return false;
  }
  if (
    workspace.artifacts.full_report.exists &&
    workspace.artifacts.full_state.exists
  ) {
    return false;
  }
  return shouldPollRecentTerminalRun(workspace, observedAt);
}

function timestampMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function matchesStageOpinion(
  opinion: AgentOpinionResponse,
  aliases: readonly string[],
): boolean {
  const text = `${opinion.agent_name} ${opinion.agent_role}`.toLowerCase();
  return aliases.some((alias) => text.includes(alias));
}

function selectedAnalystKeysFromEvents(
  events: ResearchRunEventResponse[],
): Set<string> | null {
  const startedEvent = events.find(
    (event) =>
      event.event_type === 'run.started' &&
      Array.isArray(event.payload.analysts),
  );
  if (!startedEvent) {
    return null;
  }

  return new Set(
    (startedEvent.payload.analysts as unknown[])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => analystStageKeys.has(value)),
  );
}

function normalizeMarketType(value: string | null | undefined): MarketTypeKey {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['perp', 'perpetual', 'future', 'futures'].includes(normalized)
    ? 'perp'
    : 'spot';
}

function stageIsVisibleForMarketType(
  stage: PipelineStage,
  marketType: MarketTypeKey,
): boolean {
  return (
    !('marketTypes' in stage) ||
    (stage.marketTypes as readonly MarketTypeKey[]).includes(marketType)
  );
}

function resolvePipelineStageState({
  stage,
  events,
  opinionCount,
  debateReady,
  signal,
  scenarioCount,
  thesisReady,
  runFailed,
  runTerminal,
}: {
  stage: PipelineStage;
  events: ResearchRunEventResponse[];
  opinionCount: number;
  debateReady: boolean;
  signal: SignalSnapshotResponse | null;
  scenarioCount: number;
  thesisReady: boolean;
  runFailed: boolean;
  runTerminal: boolean;
}) {
  if (
    stageHasReadyOpinion(stage.key, opinionCount) ||
    debateReady ||
    hasStageReadyArtifact(stage.key, signal, scenarioCount)
  ) {
    return {
      label: 'completed',
      badgeClass: 'badge constructive',
      detail: readyDetailForStage(stage.key),
    };
  }

  const failed = latestMatchingEvent(events, stage, 'agent.node.failed');
  if (failed) {
    return {
      label: 'failed',
      badgeClass: 'badge risk',
      detail: failed.message || 'No output before failure',
    };
  }

  const completed = latestCompletedStageEvent(events, stage);
  if (completed) {
    return {
      label: 'completed',
      badgeClass: 'badge constructive',
      detail: 'Completed',
    };
  }

  const running = latestStartedStageEvent(events, stage);
  if (running) {
    if (runFailed) {
      return {
        label: 'missing',
        badgeClass: 'badge warning',
        detail: 'Interrupted before completion',
      };
    }

    return {
      label: 'running',
      badgeClass: 'badge primary',
      detail: 'Running',
    };
  }

  if (stage.key === 'thesis' && thesisReady) {
    return {
      label: 'missing',
      badgeClass: 'badge warning',
      detail: 'Persisted without generation event',
    };
  }

  if (runFailed) {
    return {
      label: 'missing',
      badgeClass: 'badge warning',
      detail: 'Not reached before run failed',
    };
  }

  if (runTerminal) {
    return {
      label: 'missing',
      badgeClass: 'badge warning',
      detail: 'No persisted output',
    };
  }

  return {
    label: 'pending',
    badgeClass: 'badge',
    detail: 'Waiting for output',
  };
}

function mergeWorkflowStageTimings(
  apiTimings: ResearchRunStageTimingResponse[],
  stages: readonly PipelineStage[],
  events: ResearchRunEventResponse[],
  runTerminal: boolean,
): ResearchRunStageTimingResponse[] {
  const apiByStage = new Map(apiTimings.map((timing) => [timing.stage_key, timing]));
  return stages.map((stage) =>
    mergeStageTiming(
      apiByStage.get(stage.key),
      fallbackStageTiming(stage, events, runTerminal),
    ),
  );
}

function mergeStageTiming(
  apiTiming: ResearchRunStageTimingResponse | undefined,
  fallbackTiming: ResearchRunStageTimingResponse,
): ResearchRunStageTimingResponse {
  if (!apiTiming) {
    return fallbackTiming;
  }
  const apiHasTimingData = Boolean(
    apiTiming.started_at ||
      apiTiming.completed_at ||
      apiTiming.duration_ms !== null ||
      apiTiming.source_event_ids.length > 0,
  );
  if (!apiHasTimingData) {
    return fallbackTiming;
  }
  return {
    ...apiTiming,
    event_state:
      apiTiming.event_state === 'pending' || apiTiming.event_state === 'missing'
        ? fallbackTiming.event_state
        : apiTiming.event_state,
    started_at: apiTiming.started_at ?? fallbackTiming.started_at,
    completed_at: apiTiming.completed_at ?? fallbackTiming.completed_at,
    duration_ms: apiTiming.duration_ms ?? fallbackTiming.duration_ms,
    source_event_ids:
      apiTiming.source_event_ids.length > 0
        ? apiTiming.source_event_ids
        : fallbackTiming.source_event_ids,
  };
}

function fallbackStageTiming(
  stage: PipelineStage,
  events: ResearchRunEventResponse[],
  runTerminal: boolean,
): ResearchRunStageTimingResponse {
  const marketBranch = isMarketBranchStage(stage.key);
  const startedEvents = startedEventsForStage(stage, events);
  const completedEvents = completedEventsForStage(stage, events);
  const failedEvents = events.filter(
    (event) =>
      event.event_type === 'agent.node.failed' &&
      eventMatchesAliases(event, stage.aliases),
  );
  const latestCompleted = latestEvent(completedEvents);
  const latestFailed = latestEvent(failedEvents);
  const latestTerminal =
    latestFailed && eventIsSameOrAfter(latestFailed, latestCompleted)
      ? latestFailed
      : latestCompleted;
  const startedAt = earliestEventTimestamp(startedEvents);
  const completedAt = latestTerminal ? latestTerminal.created_at : null;
  const eventState = fallbackStageEventState({
    hasStarted: startedEvents.length > 0,
    latestCompleted,
    latestFailed,
    runTerminal,
  });
  const durationMs = marketBranch
    ? null
    : eventDurationMs(latestTerminal) ??
      wallClockDurationMs(startedAt, completedAt) ??
      runningDurationMs(startedAt, eventState);

  return {
    stage_key: stage.key,
    label: stage.label,
    event_state: eventState,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    source_event_ids: uniqueEventIds([
      ...startedEvents,
      ...completedEvents,
      ...failedEvents,
    ]),
  };
}

function startedEventsForStage(
  stage: PipelineStage,
  events: ResearchRunEventResponse[],
): ResearchRunEventResponse[] {
  if (stage.key === 'spot_checks' || stage.key === 'perp_checks') {
    return [];
  }
  if (stage.key === 'quant') {
    return events.filter((event) => event.event_type === 'run.started').slice(0, 1);
  }
  return events.filter(
    (event) =>
      event.event_type === 'agent.node.started' &&
      eventMatchesAliases(event, stage.aliases),
  );
}

function completedEventsForStage(
  stage: PipelineStage,
  events: ResearchRunEventResponse[],
): ResearchRunEventResponse[] {
  const milestoneTypes = completedEventTypesForStage(stage.key);
  const milestoneEvents = events.filter((event) =>
    milestoneTypes.includes(event.event_type),
  );
  if (isMarketBranchStage(stage.key)) {
    const completed =
      latestEvent(milestoneEvents) ??
      latestMatchingEvent(events, stage, 'agent.node.completed');
    return completed ? [completed] : [];
  }
  if (stage.key === 'quant') {
    return milestoneEvents;
  }
  return [
    ...events.filter(
      (event) =>
        event.event_type === 'agent.node.completed' &&
        eventMatchesAliases(event, stage.aliases),
    ),
    ...milestoneEvents,
  ];
}

function completedEventTypesForStage(stageKey: string): string[] {
  if (stageKey === 'quant') {
    return ['signal.generated', 'snapshot.health'];
  }
  if (stageKey === 'debate') {
    return ['debate.recorded'];
  }
  if (stageKey === 'setup_planner') {
    return ['plan.recorded'];
  }
  if (stageKey === 'spot_checks' || stageKey === 'perp_checks') {
    return ['plan.recorded'];
  }
  if (stageKey === 'risk_debate') {
    return ['risk.debate.recorded', 'risk.checked'];
  }
  if (stageKey === 'scenario_planner') {
    return ['scenario.plan.recorded', 'scenarios_saved'];
  }
  if (stageKey === 'thesis') {
    return ['thesis.generated'];
  }
  return [];
}

function fallbackStageEventState({
  hasStarted,
  latestCompleted,
  latestFailed,
  runTerminal,
}: {
  hasStarted: boolean;
  latestCompleted: ResearchRunEventResponse | null;
  latestFailed: ResearchRunEventResponse | null;
  runTerminal: boolean;
}): ResearchRunStageTimingResponse['event_state'] {
  if (latestFailed && eventIsSameOrAfter(latestFailed, latestCompleted)) {
    return 'failed';
  }
  if (latestCompleted) {
    return 'completed';
  }
  if (hasStarted) {
    return 'running';
  }
  return runTerminal ? 'missing' : 'pending';
}

function hasStageReadyArtifact(
  stageKey: string,
  signal: SignalSnapshotResponse | null,
  scenarioCount: number,
): boolean {
  if (stageKey === 'quant') {
    return Boolean(signal);
  }
  if (stageKey === 'scenario_planner') {
    return scenarioCount > 0;
  }
  return false;
}

function readyDetailForStage(stageKey: string): string {
  if (stageKey === 'quant') {
    return 'Signal snapshot persisted';
  }
  if (stageKey === 'scenario_planner') {
    return 'Scenarios persisted';
  }
  if (stageKey === 'thesis') {
    return 'Thesis generated';
  }
  if (stageKey === 'spot_checks') {
    return 'Spot checks applied';
  }
  if (stageKey === 'perp_checks') {
    return 'Perp checks applied';
  }
  return 'Completed';
}

function stageHasReadyOpinion(stageKey: string, opinionCount: number): boolean {
  if (stageKey === 'debate') {
    return opinionCount >= 2;
  }
  if (stageKey === 'risk_debate') {
    return opinionCount >= 3;
  }
  return opinionCount > 0;
}

function latestCompletedStageEvent(
  events: ResearchRunEventResponse[],
  stage: PipelineStage,
) {
  if (stage.key === 'quant') {
    return latestEventByType(events, ['signal.generated', 'snapshot.health']);
  }
  if (stage.key === 'risk_debate') {
    return (
      latestEventByType(events, ['risk.debate.recorded', 'risk.checked']) ??
      latestCompletedGroupEvent(events, stage)
    );
  }
  if (stage.key === 'debate') {
    return (
      latestEventByType(events, ['debate.recorded']) ??
      latestCompletedGroupEvent(events, stage)
    );
  }
  if (stage.key === 'setup_planner') {
    return (
      latestEventByType(events, ['plan.recorded']) ??
      latestMatchingEvent(events, stage, 'agent.node.completed')
    );
  }
  if (stage.key === 'spot_checks' || stage.key === 'perp_checks') {
    return (
      latestEventByType(events, ['plan.recorded']) ??
      latestMatchingEvent(events, stage, 'agent.node.completed')
    );
  }
  if (stage.key === 'scenario_planner') {
    return (
      latestEventByType(events, ['scenario.plan.recorded', 'scenarios_saved']) ??
      latestMatchingEvent(events, stage, 'agent.node.completed')
    );
  }
  if (stage.key === 'thesis') {
    return (
      latestEventByType(events, ['thesis.generated']) ??
      latestMatchingEvent(events, stage, 'agent.node.completed')
    );
  }
  return latestMatchingEvent(events, stage, 'agent.node.completed');
}

function latestStartedStageEvent(
  events: ResearchRunEventResponse[],
  stage: PipelineStage,
) {
  if (stage.key === 'spot_checks' || stage.key === 'perp_checks') {
    return null;
  }
  if (stage.key === 'risk_debate') {
    return latestMatchingEvent(events, stage, 'agent.node.started', [
      'risk',
      'aggressive analyst',
      'conservative analyst',
      'neutral analyst',
    ]);
  }
  if (stage.key === 'debate') {
    return latestMatchingEvent(events, stage, 'agent.node.started', [
      'bull researcher',
      'contrarian analyst',
      'bear researcher',
    ]);
  }
  return latestMatchingEvent(events, stage, 'agent.node.started');
}

function isMarketBranchStage(stageKey: string): boolean {
  return stageKey === 'spot_checks' || stageKey === 'perp_checks';
}

function latestCompletedGroupEvent(
  events: ResearchRunEventResponse[],
  stage: PipelineStage,
) {
  if (!('requiredAliases' in stage)) {
    return null;
  }
  const completedEvents = stage.requiredAliases.map((aliases) =>
    latestMatchingEvent(events, stage, 'agent.node.completed', aliases),
  );
  if (completedEvents.some((event) => !event)) {
    return null;
  }
  return completedEvents
    .filter((event): event is ResearchRunEventResponse => Boolean(event))
    .sort((left, right) => {
      const leftTime = Date.parse(left.created_at ?? '');
      const rightTime = Date.parse(right.created_at ?? '');
      return (leftTime || 0) - (rightTime || 0);
    })
    .at(-1) ?? null;
}

function latestMatchingEvent(
  events: ResearchRunEventResponse[],
  stage: PipelineStage,
  eventType: string,
  aliases: readonly string[] = stage.aliases,
) {
  return [...events]
    .reverse()
    .find((event) => event.event_type === eventType && eventMatchesAliases(event, aliases));
}

function latestEventByType(events: ResearchRunEventResponse[], eventTypes: string[]) {
  return [...events].reverse().find((event) => eventTypes.includes(event.event_type));
}

function latestEvent(events: ResearchRunEventResponse[]): ResearchRunEventResponse | null {
  return [...events].sort((left, right) => eventTimeMs(left) - eventTimeMs(right)).at(-1) ?? null;
}

function eventIsSameOrAfter(
  event: ResearchRunEventResponse,
  baseline: ResearchRunEventResponse | null,
): boolean {
  if (!baseline) {
    return true;
  }
  return eventTimeMs(event) >= eventTimeMs(baseline);
}

function earliestEventTimestamp(events: ResearchRunEventResponse[]): string | null {
  return [...events].sort((left, right) => eventTimeMs(left) - eventTimeMs(right)).at(0)?.created_at ?? null;
}

function eventTimeMs(event: ResearchRunEventResponse): number {
  return parseTimestampMs(event.created_at) ?? 0;
}

function eventDurationMs(event: ResearchRunEventResponse | null): number | null {
  const value = event?.payload.duration_ms;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function wallClockDurationMs(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  const started = parseTimestampMs(startedAt);
  const completed = parseTimestampMs(completedAt);
  if (started === null || completed === null) {
    return null;
  }
  const duration = completed - started;
  return duration >= 0 ? duration : null;
}

function runningDurationMs(
  startedAt: string | null,
  eventState: ResearchRunStageTimingResponse['event_state'],
): number | null {
  if (eventState !== 'running') {
    return null;
  }
  const started = parseTimestampMs(startedAt);
  if (started === null) {
    return null;
  }
  const duration = Date.now() - started;
  return duration >= 0 ? duration : null;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(
    /\.(\d{3})\d+([zZ]|[+-]\d{2}:?\d{2})$/,
    '.$1$2',
  );
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueEventIds(events: ResearchRunEventResponse[]): string[] {
  return [
    ...new Set(
      events
        .map((event) => event.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function latestRunFailureEvent(events: ResearchRunEventResponse[]) {
  return [...events].reverse().find((event) => event.event_type === 'run.failed');
}

function runFailureMessage(event: ResearchRunEventResponse): string {
  const error = stringValue(event.payload.error);
  const errorType = stringValue(event.payload.error_type);
  const message = event.message || 'Research run failed.';
  return [errorType, error || message].filter(Boolean).join(': ');
}

function eventMatchesAliases(
  event: ResearchRunEventResponse,
  aliases: readonly string[],
): boolean {
  const identifiers = [
    event.payload.agent_name,
    event.payload.analyst_name,
    event.payload.graph_node,
    event.payload.stage,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  if (identifiers.length > 0) {
    return identifiers.some((value) =>
      aliases.some((alias) => textMatchesAlias(value, alias)),
    );
  }
  return typeof event.message === 'string'
    ? aliases.some((alias) => textMatchesAlias(event.message, alias))
    : false;
}

function textMatchesAlias(value: string, alias: string): boolean {
  const normalizedValue = normalizeAliasText(value);
  const normalizedAlias = normalizeAliasText(alias);
  if (!normalizedValue || !normalizedAlias) {
    return false;
  }
  return normalizedValue === normalizedAlias || normalizedValue.includes(normalizedAlias);
}

function normalizeAliasText(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized ? ` ${normalized} ` : '';
}

function pipelineStageDetail({
  stage,
  opinion,
  opinionCount,
  debateStance,
  stateDetail,
}: {
  stage: PipelineStage;
  opinion?: AgentOpinionResponse;
  opinionCount: number;
  debateStance?: string;
  stateDetail: string;
}): string {
  if (stage.key === 'debate' && debateStance) {
    return debateStance;
  }
  if ('detail' in stage) {
    return stage.detail;
  }
  if (opinionCount > 1) {
    return `${opinionCount} opinions`;
  }
  if (opinion) {
    return opinion.stance;
  }
  return stateDetail;
}

function marketTypeSpecificThesisNote(
  summary: { spot_notes: string; perp_notes: string; missing_data: string[] },
  marketType: MarketTypeKey,
): string {
  if (marketType === 'perp') {
    const parts = [
      summary.perp_notes,
      summary.missing_data.length > 0
        ? `Missing perp data: ${summary.missing_data.join(', ')}`
        : '',
    ].filter(Boolean);
    return parts.join(' ');
  }
  return summary.spot_notes;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}
