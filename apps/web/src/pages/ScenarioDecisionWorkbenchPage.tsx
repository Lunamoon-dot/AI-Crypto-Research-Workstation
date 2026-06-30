import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, ListChecks, Play, Radar } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { ErrorState, LoadingState } from '@/components/ui/state';
import { routes } from '@/lib/routes';
import {
  compileScenarioDecisionPlaybook,
  createScenarioDecisionBacktest,
  evaluateScenarioDecisionItem,
  getScenarioDecisionWorkbench,
  resolveScenarioDecisionItem,
  snoozeScenarioDecisionItem,
} from '@/services/scenario-decision';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore, type WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import type { ScenarioDecisionQueueItemResponse } from '@/types';

export function ScenarioDecisionWorkbenchPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.scenarioDecisionWorkbench();
  const workbench = useQuery({
    queryKey,
    queryFn: () => getScenarioDecisionWorkbench(auth),
    staleTime: 30_000,
  });
  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveScenarioDecisionItem(id, auth),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const snoozeMutation = useMutation({
    mutationFn: (id: string) => snoozeScenarioDecisionItem(id, tomorrowIso(), auth),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const actionMutation = useMutation({
    mutationFn: (item: ScenarioDecisionQueueItemResponse) =>
      runScenarioDecisionItemAction(item, auth),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const items = workbench.data?.items ?? [];
  const counts = queueCounts(items);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Scenario Decision"
        title="Scenario decision workbench"
        description="Prioritized scenario evaluations, playbooks, and backtests that need operator action."
        action={
          <HeaderStats
            stats={[
              {
                icon: <ListChecks aria-hidden size={14} />,
                label: 'Open',
                meta: workbench.data?.generated_at ?? 'loading',
                value: workbench.data?.total_open ?? '...',
              },
              {
                icon: <Radar aria-hidden size={14} />,
                label: 'Scenarios',
                meta: 'Triggered or due',
                tone: 'warning',
                value: counts.scenario,
              },
              {
                icon: <Clock3 aria-hidden size={14} />,
                label: 'Evaluation',
                meta: 'Due or inconclusive',
                tone: 'constructive',
                value: counts.evaluation,
              },
            ]}
          />
        }
      />
      {workbench.isLoading ? <LoadingState /> : null}
      {workbench.isError ? <ErrorState error={workbench.error} /> : null}
      <BentoGrid>
        <Panel
          className="span-12 scenario-queue-panel"
          title="Decision queue"
          description={
            workbench.data
              ? `${items.length} open scenario workflow items`
              : 'Loading scenario decision queue'
          }
        >
          {workbench.data && items.length === 0 ? (
            <div className="state-card scenario-queue-empty">
              <strong>No scenario decision items are open.</strong>
              <p>
                Queue items open when a scenario is triggered, due for evaluation,
                inconclusive, compiled into a playbook, or backtested.
              </p>
              <Link className="button ghost scenario-open-button" to={routes.scenarios}>
                Scenarios
              </Link>
            </div>
          ) : null}
          <div className="scenario-monitor-list">
            {items.map((item) => (
              <ScenarioDecisionItemCard
                item={item}
                key={item.id}
                onResolve={() => resolveMutation.mutate(item.id)}
                onRunAction={() => actionMutation.mutate(item)}
                onSnooze={() => snoozeMutation.mutate(item.id)}
                pending={
                  resolveMutation.isPending ||
                  snoozeMutation.isPending ||
                  actionMutation.isPending
                }
              />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function ScenarioDecisionItemCard({
  item,
  onResolve,
  onRunAction,
  onSnooze,
  pending,
}: {
  item: ScenarioDecisionQueueItemResponse;
  onResolve: () => void;
  onRunAction: () => void;
  onSnooze: () => void;
  pending: boolean;
}) {
  const primaryAction = itemPrimaryAction(item);
  return (
    <article className={`scenario-card scenario-card-${itemTone(item)}`}>
      <div className="scenario-monitor-header">
        <div className="scenario-monitor-heading">
          <div className="scenario-monitor-title-row">
            <strong>{item.title}</strong>
            <span className="badge">{itemTypeLabel(item.type)}</span>
            <span className="badge">Priority {item.priority}</span>
          </div>
          <p className="scenario-condition">{item.summary}</p>
        </div>
        <div className="scenario-monitor-status-row">
          {item.thesis_id ? (
            <Link className="button ghost scenario-open-button" to={routes.thesis(item.thesis_id)}>
              Thesis
            </Link>
          ) : null}
          <Link className="button ghost scenario-open-button" to={routes.scenarios}>
            Scenarios
          </Link>
        </div>
      </div>

      <div className="scenario-monitor-facts">
        <div className="scenario-monitor-fact">
          <span>Next action</span>
          <p>{item.next_action}</p>
          {item.due_at ? <p className="small muted">Due {item.due_at}</p> : null}
        </div>
        <div className="scenario-monitor-fact">
          <span>Blockers</span>
          <p>{item.blockers.length ? item.blockers.join(', ') : 'No blockers'}</p>
          <p className="small muted">{item.status}</p>
        </div>
      </div>

      <div className="scenario-filter-controls">
        {primaryAction ? (
          <button
            className="button primary"
            disabled={pending}
            onClick={onRunAction}
            type="button"
          >
            <Play aria-hidden size={14} />
            {primaryAction.label}
          </button>
        ) : null}
        <button
          className={primaryAction ? 'button ghost' : 'button primary'}
          disabled={pending}
          onClick={onResolve}
          type="button"
        >
          <CheckCircle2 aria-hidden size={14} />
          Resolve
        </button>
        <button
          className="button ghost"
          disabled={pending}
          onClick={onSnooze}
          type="button"
        >
          <Clock3 aria-hidden size={14} />
          Snooze
        </button>
      </div>
    </article>
  );
}

function queueCounts(items: ScenarioDecisionQueueItemResponse[]) {
  return {
    scenario: items.filter((item) => item.type === 'active_scenario').length,
    evaluation: items.filter((item) =>
      item.type === 'evaluation_due' ||
      item.type === 'evaluation_inconclusive',
    ).length,
  };
}

async function runScenarioDecisionItemAction(
  item: ScenarioDecisionQueueItemResponse,
  auth: WorkspaceRequestContext,
) {
  const primaryAction = itemPrimaryAction(item);
  if (!primaryAction) {
    return null;
  }
  if (primaryAction.kind === 'evaluate') {
    return evaluateScenarioDecisionItem(primaryAction.id, auth);
  }
  if (primaryAction.kind === 'compile') {
    return compileScenarioDecisionPlaybook(primaryAction.id, auth);
  }
  return createScenarioDecisionBacktest(primaryAction.id, auth);
}

function itemPrimaryAction(
  item: ScenarioDecisionQueueItemResponse,
): { kind: 'evaluate' | 'compile' | 'backtest'; id: string; label: string } | null {
  if (
    (item.type === 'evaluation_due' ||
      item.type === 'evaluation_inconclusive') &&
    item.scenario_id
  ) {
    return { kind: 'evaluate', id: item.scenario_id, label: 'Evaluate' };
  }
  if (item.type === 'active_scenario' && item.scenario_id) {
    return { kind: 'compile', id: item.scenario_id, label: 'Compile playbook' };
  }
  if (item.type === 'playbook_candidate' && item.playbook_id) {
    return { kind: 'backtest', id: item.playbook_id, label: 'Run backtest' };
  }
  return null;
}

function itemTypeLabel(type: ScenarioDecisionQueueItemResponse['type']): string {
  return type
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function itemTone(item: ScenarioDecisionQueueItemResponse) {
  if (item.priority >= 90) return 'risk';
  if (item.priority >= 70) return 'warning';
  return 'primary';
}

function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}
