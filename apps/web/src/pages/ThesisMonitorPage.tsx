import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { ThesisMonitorSection } from '@/components/theses/ThesisMonitorPanel';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { queryKeys } from '@/services/query-keys';
import {
  getThesisMonitorPlan,
  getThesisSchedulerStatus,
  listThesisPulseMemos,
  listThesisPulses,
  pauseThesisScheduler,
  resumeThesisScheduler,
  runThesisPulse,
  runThesisPulseMemo,
  runThesisSchedulerDue,
  updateThesisMonitorPlan,
} from '@/services/thesis-monitoring';
import { getThesis } from '@/services/theses';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { routes } from '@/lib/routes';
import type { PatchThesisMonitorPlanRequest } from '@/types';

export function ThesisMonitorPage() {
  const { id } = useParams();
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const thesisId = id ?? '';
  const hasThesisId = thesisId.length > 0;

  const thesisQuery = useQuery({
    enabled: hasThesisId,
    queryKey: queryKeys.thesis(thesisId),
    queryFn: () => getThesis(thesisId, auth),
  });
  const monitorPlanQuery = useQuery({
    enabled: hasThesisId,
    queryKey: queryKeys.thesisMonitorPlan(thesisId),
    queryFn: () => getThesisMonitorPlan(thesisId, auth),
  });
  const pulsesQuery = useQuery({
    enabled: hasThesisId,
    queryKey: queryKeys.thesisPulses(thesisId),
    queryFn: () => listThesisPulses(thesisId, auth, { limit: 240 }),
  });
  const memoQuery = useQuery({
    enabled: hasThesisId,
    queryKey: queryKeys.thesisPulseMemos(thesisId),
    queryFn: () => listThesisPulseMemos(thesisId, auth, { limit: 50 }),
  });
  const schedulerQuery = useQuery({
    enabled: hasThesisId,
    queryKey: queryKeys.thesisScheduler(thesisId),
    queryFn: () => getThesisSchedulerStatus(thesisId, auth),
  });

  function invalidateMonitorQueries() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisMonitorPlan(thesisId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisPulses(thesisId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisPulseMemos(thesisId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisScheduler(thesisId),
    });
  }

  const runPulseMutation = useMutation({
    mutationFn: () => runThesisPulse(thesisId, {}, auth),
    onSuccess: invalidateMonitorQueries,
  });
  const runMemoMutation = useMutation({
    mutationFn: () => runThesisPulseMemo(thesisId, {}, auth),
    onSuccess: invalidateMonitorQueries,
  });
  const updateMonitorPlanMutation = useMutation({
    mutationFn: (request: PatchThesisMonitorPlanRequest) =>
      updateThesisMonitorPlan(thesisId, request, auth),
    onSuccess: invalidateMonitorQueries,
  });
  const resumeSchedulerMutation = useMutation({
    mutationFn: () => resumeThesisScheduler(thesisId, auth),
    onSuccess: invalidateMonitorQueries,
  });
  const pauseSchedulerMutation = useMutation({
    mutationFn: () => pauseThesisScheduler(thesisId, auth),
    onSuccess: invalidateMonitorQueries,
  });
  const runSchedulerDueMutation = useMutation({
    mutationFn: () => runThesisSchedulerDue(thesisId, {}, auth),
    onSuccess: invalidateMonitorQueries,
  });

  if (!hasThesisId) {
    return (
      <main className="page thesis-monitor-page">
        <EmptyState label="Thesis id is missing." />
      </main>
    );
  }

  const thesis = thesisQuery.data;
  const symbol = thesis?.symbol ?? monitorPlanQuery.data?.symbol ?? 'Thesis';

  return (
    <main className="page thesis-monitor-page">
      <PageHeader
        eyebrow="Thesis Monitor"
        title={`${symbol} monitor`}
        description="Run deterministic thesis pulses, inspect scheduler state, generate memos, and update the monitoring contract."
        action={
          <div className="page-header-action-stack">
            <Link className="button" to={routes.thesis(thesisId)}>
              <ArrowLeft aria-hidden size={15} />
              Thesis detail
            </Link>
          </div>
        }
      />

      {thesisQuery.isError ? <ErrorState error={thesisQuery.error} /> : null}

      <Panel
        className="span-12"
        title="Thesis pulse monitor"
        description="Manual deterministic monitoring against baseline, invalidation, scheduler, and targets."
      >
        <ThesisMonitorSection
          error={
            monitorPlanQuery.error ??
            pulsesQuery.error ??
            memoQuery.error ??
            schedulerQuery.error ??
            runPulseMutation.error ??
            runMemoMutation.error ??
            resumeSchedulerMutation.error ??
            pauseSchedulerMutation.error ??
            runSchedulerDueMutation.error ??
            updateMonitorPlanMutation.error
          }
          isError={
            monitorPlanQuery.isError ||
            pulsesQuery.isError ||
            memoQuery.isError ||
            schedulerQuery.isError ||
            runPulseMutation.isError ||
            runMemoMutation.isError ||
            resumeSchedulerMutation.isError ||
            pauseSchedulerMutation.isError ||
            runSchedulerDueMutation.isError ||
            updateMonitorPlanMutation.isError
          }
          isLoading={
            monitorPlanQuery.isLoading ||
            pulsesQuery.isLoading ||
            memoQuery.isLoading ||
            schedulerQuery.isLoading
          }
          isRunningMemo={runMemoMutation.isPending}
          isRunning={runPulseMutation.isPending}
          isRunningScheduler={runSchedulerDueMutation.isPending}
          isSavingPlan={updateMonitorPlanMutation.isPending}
          isTogglingScheduler={
            resumeSchedulerMutation.isPending || pauseSchedulerMutation.isPending
          }
          memoRunResult={runMemoMutation.data ?? null}
          memos={memoQuery.data ?? []}
          onPauseScheduler={() => pauseSchedulerMutation.mutate()}
          onRunMemo={() => runMemoMutation.mutate()}
          onRunPulse={() => runPulseMutation.mutate()}
          onRunSchedulerDue={() => runSchedulerDueMutation.mutate()}
          onSavePlan={(request) => updateMonitorPlanMutation.mutateAsync(request)}
          onResumeScheduler={() => resumeSchedulerMutation.mutate()}
          plan={monitorPlanQuery.data ?? null}
          pulses={pulsesQuery.data ?? []}
          scheduler={schedulerQuery.data ?? null}
          thesisId={thesisId}
        />
      </Panel>
    </main>
  );
}
