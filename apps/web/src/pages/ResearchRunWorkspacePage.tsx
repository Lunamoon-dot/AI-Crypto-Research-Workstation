import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Brain,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileText,
  Newspaper,
  ShieldAlert,
  Users,
  WalletCards,
} from 'lucide-react';
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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  AgentOpinionResponse,
  ResearchRunArtifactsResponse,
  ResearchRunEventResponse,
  SignalSnapshotResponse,
} from '@/types';

const pipelineStages = [
  {
    key: 'quant',
    label: 'Quant',
    icon: BarChart3,
    aliases: ['quant', 'quant analyst', 'signal'],
  },
  { key: 'market', label: 'Market', icon: Database, aliases: ['market', 'market analyst'] },
  { key: 'news', label: 'News', icon: Newspaper, aliases: ['news', 'news analyst'] },
  {
    key: 'social',
    label: 'Social',
    icon: Users,
    aliases: ['social', 'sentiment', 'sentiment analyst', 'social analyst'],
  },
  {
    key: 'onchain',
    label: 'Onchain',
    icon: WalletCards,
    aliases: ['onchain', 'fundamental', 'onchain analyst'],
  },
  {
    key: 'debate',
    label: 'Bull/Contrarian Debate',
    icon: Brain,
    aliases: ['bull researcher', 'bear researcher', 'contrarian analyst'],
    requiredAliases: [['bull researcher'], ['bear researcher', 'contrarian analyst']],
  },
  {
    key: 'research_manager',
    label: 'Research Manager',
    icon: Users,
    aliases: ['research manager', 'research_manager'],
  },
  {
    key: 'setup_planner',
    label: 'Setup Planner',
    icon: CheckCircle2,
    aliases: ['setup planner', 'setup_planner', 'trader'],
  },
  {
    key: 'spot_checks',
    label: 'Spot Checks',
    icon: WalletCards,
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['spot'],
    detail: 'Accumulation / DCA / allocation',
  },
  {
    key: 'perp_checks',
    label: 'Perp Checks',
    icon: ShieldAlert,
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['perp'],
    detail: 'Funding / OI / liquidation',
  },
  {
    key: 'risk_debate',
    label: 'Risk Debate',
    icon: ShieldAlert,
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
    aliases: ['portfolio manager', 'portfolio_manager'],
  },
  {
    key: 'scenario_planner',
    label: 'Scenario Planner',
    icon: Newspaper,
    aliases: ['scenario planner', 'scenarioplanner', 'scenario.plan', 'scenarios_saved'],
  },
  {
    key: 'thesis',
    label: 'Trade Thesis',
    icon: Brain,
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
      const runStatus = query.state.data?.run.status;
      if (isActiveJobStatus(runStatus)) {
        return 5000;
      }
      if (query.state.error && isActiveJobStatus(jobQuery.data?.status)) {
        return 5000;
      }
      return false;
    },
    retry: false,
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
  const latestFailure = latestRunFailureEvent(workspace.events);
  const failureReason = latestFailure ? runFailureMessage(latestFailure) : '';

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
    <main className="page">
      <PageHeader
        eyebrow="03 Research Workspace"
        title={`${workspace.run.symbol} research run`}
        description={`Run ${workspace.run.run_id ?? workspace.run.id ?? runId}`}
        action={
          <div className="page-header-action-stack">
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
                  icon: <Brain aria-hidden size={14} />,
                  label: 'Opinions',
                  meta: workspace.debate.debate?.conflict_level ?? 'No debate',
                  tone: 'degraded',
                  value: workspace.debate.agent_opinions.length,
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
              {exportingBundle ? 'Exporting' : 'Export evidence'}
            </button>
          </div>
        }
      />
      {exportError ? <div className="badge risk">{exportError}</div> : null}
      {latestFailure ? (
        <div className="callout risk">
          <strong>Run failed during finalization</strong>
          <p>{failureReason}</p>
        </div>
      ) : null}

      <BentoGrid>
        <Panel
          className="span-12 emphasis"
          title="Agent pipeline"
          description="Run stages and artifacts"
        >
          <div className="pipeline">
            {visiblePipelineStages.map((stage) => {
              const Icon = stage.icon;
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
              return (
                <div className="pipeline-node" key={stage.key}>
                  <div className="row">
                    <span className="pipeline-icon">
                      <Icon aria-hidden size={17} />
                    </span>
                    <span className={stageState.badgeClass}>{stageState.label}</span>
                  </div>
                  <h3 style={{ margin: '12px 0 4px' }}>{stage.label}</h3>
                  <div className="small muted">{detail}</div>
                  {opinion ? <ConfidenceBadge value={opinion.confidence} /> : null}
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="span-4" title="Run metadata">
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
          runTerminal={runTerminal}
        />

        <Panel className="span-4" title="Data quality">
          <div className="stack">
            <div>
              <strong>Degradation reasons</strong>
              <p className="small muted">{workspace.run.degradation_reasons.join(', ') || 'None reported.'}</p>
            </div>
            <div>
              <strong>Missing core data</strong>
              <p className="small muted">{workspace.run.missing_core_data.join(', ') || 'None reported.'}</p>
            </div>
            <div>
              <strong>Missing optional data</strong>
              <p className="small muted">{workspace.run.missing_optional_data.join(', ') || 'None reported.'}</p>
            </div>
          </div>
        </Panel>

        <Panel className="span-4" title="Thesis result">
          {workspace.thesis ? (
            <div className="stack">
              <div className="row">
                <strong>{workspace.thesis.symbol}</strong>
                <RatingBadge value={workspace.thesis.summary.rating || 'Hold'} />
                <DirectionBadge value={workspace.thesis.direction} />
              </div>
              <p className="muted">{workspace.thesis.summary.action_summary || workspace.thesis.thesis_text}</p>
              {marketTypeSpecificThesisNote(workspace.thesis.summary, marketType) ? (
                <p className="small muted">
                  {marketTypeSpecificThesisNote(workspace.thesis.summary, marketType)}
                </p>
              ) : null}
              <div className="row small">
                <span>Invalidation: {workspace.thesis.invalidation_level || 'n/a'}</span>
                <ConfidenceBadge value={workspace.thesis.confidence} />
                <DataQualityBadge
                  label={workspace.thesis.summary.data_quality_label}
                  value={workspace.thesis.summary.data_quality}
                />
              </div>
              <div className="top-strip-meta">
                <Link className="button primary" to={routes.thesis(workspace.thesis.id ?? '')}>
                  Open thesis
                </Link>
                {workspace.thesis.id ? (
                  <Link
                    className="button"
                    to={`${routes.watchlists}?track_thesis=${encodeURIComponent(workspace.thesis.id)}`}
                  >
                    Track this thesis
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState label="No thesis generated yet." />
          )}
        </Panel>

        <Panel className="span-6" title="Market snapshot" description="Price and source provenance">
          {market ? (
            <div className="stack small">
              <DataPair label="Current price" value={<strong>{formatNumber(market.current_price)}</strong>} />
              <DataPair label="Source" value={market.source || 'n/a'} />
              <DataPair label="Source time" value={formatDateTime(market.source_timestamp)} />
              <DataPair label="Captured" value={formatDateTime(market.captured_at)} />
              <JsonView value={market.payload} />
            </div>
          ) : (
            <EmptyState label="No market snapshot persisted yet." />
          )}
        </Panel>

        <Panel className="span-6" title="Signal snapshot" description="Aggregated deterministic evidence">
          {signal ? (
            <div className="stack small">
              <DataPair label="Total" value={<strong>{signal.signal_count ?? 0}</strong>} />
              <DataPair label="Bullish" value={signal.bullish_count ?? 0} />
              <DataPair label="Bearish" value={signal.bearish_count ?? 0} />
              <DataPair label="Neutral" value={signal.neutral_count ?? 0} />
              <DataPair label="Stale" value={signal.stale_count ?? 0} />
              <JsonView value={signal.payload} />
            </div>
          ) : (
            <EmptyState label="No signal snapshot persisted yet." />
          )}
        </Panel>

        <Panel className="span-7" title="Timeline and event logs">
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

        <Panel className="span-5" title="Agent debate" description="Consensus and disagreement">
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

function FullReportArtifactPanel({
  artifacts,
  runTerminal,
}: {
  artifacts: ResearchRunArtifactsResponse;
  runTerminal: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const report = artifacts.full_report;
  const state = artifacts.full_state;
  const reportStatus = artifactStatusLabel(report.exists, runTerminal);

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
      className="span-4"
      title="Full report"
      description="Markdown and full-state artifacts"
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
          <DataPair label="Markdown" value={artifactMeta(report)} />
          <DataPair
            label="State JSON"
            value={
              state.exists
                ? artifactMeta(state)
                : artifactStatusLabel(false, runTerminal).label
            }
          />
        </div>
      </div>
    </Panel>
  );
}

function artifactStatusLabel(exists: boolean, runTerminal: boolean) {
  if (exists) {
    return { label: 'Saved', className: 'badge constructive' };
  }
  if (runTerminal) {
    return { label: 'Not found', className: 'badge risk' };
  }
  return { label: 'Pending', className: 'badge warning' };
}

function artifactMeta(artifact: {
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}) {
  if (!artifact.exists) {
    return 'Pending';
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
    hasStageReadyArtifact(stage.key, signal, scenarioCount, thesisReady)
  ) {
    return {
      label: 'ready',
      badgeClass: 'badge constructive',
      detail: readyDetailForStage(stage.key),
    };
  }

  const failed = latestMatchingEvent(events, stage, 'agent.node.failed');
  if (failed || runFailed) {
    return {
      label: 'failed',
      badgeClass: 'badge risk',
      detail: failed?.message || 'No output before failure',
    };
  }

  const completed = latestCompletedStageEvent(events, stage);
  if (completed) {
    return {
      label: 'ready',
      badgeClass: 'badge constructive',
      detail: 'Completed',
    };
  }

  const running = latestStartedStageEvent(events, stage);
  if (running) {
    return {
      label: 'running',
      badgeClass: 'badge primary',
      detail: 'Running',
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

function hasStageReadyArtifact(
  stageKey: string,
  signal: SignalSnapshotResponse | null,
  scenarioCount: number,
  thesisReady: boolean,
): boolean {
  if (stageKey === 'quant') {
    return Boolean(signal);
  }
  if (stageKey === 'scenario_planner') {
    return scenarioCount > 0;
  }
  if (stageKey === 'thesis') {
    return thesisReady;
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
    return 'Thesis persisted';
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
    return latestEventByType(events, ['thesis.generated', 'trade_thesis_saved']);
  }
  return latestMatchingEvent(events, stage, 'agent.node.completed');
}

function latestStartedStageEvent(
  events: ResearchRunEventResponse[],
  stage: PipelineStage,
) {
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
  const text = [
    event.payload.agent_name,
    event.payload.graph_node,
    event.payload.stage,
    event.message,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return aliases.some((alias) => text.includes(alias));
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

function stringValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}
