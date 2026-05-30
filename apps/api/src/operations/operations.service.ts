import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
} from '../research-continuity/research-continuity-audit.repository';
import type {
  ResearchContinuityAuditRepository,
} from '../research-continuity/research-continuity-audit.types';
import {
  RESEARCH_CONTINUITY_SETTINGS_REPOSITORY,
} from '../research-continuity/research-continuity-settings.repository';
import type {
  ResearchContinuitySettingsRepository,
} from '../research-continuity/research-continuity-settings.types';
import {
  DataFreshnessResponse,
  LlmCallResponse,
  LlmHealthSummaryResponse,
  OperationsHealthResponse,
  ProviderHealthResponse,
  toDataFreshnessResponse,
  toLlmCallResponse,
  toProviderHealthResponse,
} from '../contracts/frontend-contract';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class OperationsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    @Inject(RESEARCH_CONTINUITY_AUDIT_REPOSITORY)
    private readonly continuityAudit: ResearchContinuityAuditRepository,
    @Inject(RESEARCH_CONTINUITY_SETTINGS_REPOSITORY)
    private readonly continuitySettings: ResearchContinuitySettingsRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async health(
    limit: number,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<OperationsHealthResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const [providers, llmCalls, freshness] = await Promise.all([
      this.providerHealth(limit),
      this.llmCallsForWorkspace(limit, workspaceId),
      this.dataFreshnessForWorkspace(limit, workspaceId),
    ]);
    const monitoring = await this.monitoringHealthForWorkspace(workspaceId);
    const continuity = await this.continuityHealthForWorkspace(workspaceId);
    return {
      generated_at: new Date().toISOString(),
      providers,
      llm: summarizeLlmCalls(llmCalls),
      freshness: {
        total_checks: freshness.length,
        stale_checks: freshness.filter((row) => staleStatus(row.status)).length,
        status_counts: countBy(freshness, (row) => row.status),
        rows: freshness,
      },
      queue: {
        backend: (process.env.JOBS_EXECUTION_MODE ?? 'memory').toLowerCase(),
        redis_configured: Boolean(process.env.REDIS_URL?.trim()),
      },
      ...monitoring,
      continuity,
    };
  }

  async providerHealth(limit: number): Promise<ProviderHealthResponse[]> {
    let rows: JsonRecord[] = [];
    try {
      rows = await this.journal.listProviderHealth(limit);
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
    }
    const persisted = rows.map(toProviderHealthResponse);
    if (persisted.length > 0) {
      return persisted;
    }
    return derivedProviderHealth();
  }

  async llmCalls(
    limit: number,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<LlmCallResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.llmCallsForWorkspace(limit, workspaceId);
  }

  async dataFreshness(
    limit: number,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<DataFreshnessResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.dataFreshnessForWorkspace(limit, workspaceId);
  }

  async monitoringRetentionDryRun(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<JsonRecord> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    if (!this.journal.runMonitoringRetention) {
      throw new ServiceUnavailableException(
        'Monitoring retention requires Postgres repository support.',
      );
    }
    return this.journal.runMonitoringRetention(workspaceId, {
      dryRun: true,
      pulseKeepDays: intFromEnv('MONITORING_RETENTION_PULSE_DAYS', 30),
      pulseKeepLatestPerThesis: intFromEnv(
        'MONITORING_RETENTION_PULSE_KEEP_LATEST',
        10_000,
      ),
      memoKeepDays: intFromEnv('MONITORING_RETENTION_MEMO_DAYS', 180),
      succeededJobKeepDays: intFromEnv(
        'MONITORING_RETENTION_SUCCEEDED_JOB_DAYS',
        30,
      ),
      failedJobKeepDays: intFromEnv('MONITORING_RETENTION_FAILED_JOB_DAYS', 180),
    });
  }

  private async llmCallsForWorkspace(
    limit: number,
    workspaceId: string,
  ): Promise<LlmCallResponse[]> {
    let rows: JsonRecord[] = [];
    try {
      rows = await this.journal.listLlmCalls(limit, workspaceId);
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
    }
    return rows.map(toLlmCallResponse);
  }

  private async dataFreshnessForWorkspace(
    limit: number,
    workspaceId: string,
  ): Promise<DataFreshnessResponse[]> {
    let rows: JsonRecord[] = [];
    try {
      rows = await this.journal.listDataFreshnessChecks(limit, workspaceId);
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
    }
    return rows.map(toDataFreshnessResponse);
  }

  private async monitoringHealthForWorkspace(
    workspaceId: string,
  ): Promise<Pick<
    OperationsHealthResponse,
    | 'monitoring_queue'
    | 'monitoring_scheduler'
    | 'monitoring_workers'
    | 'monitoring_retention'
    | 'llm_memo_health'
  >> {
    try {
      const health =
        await this.journal.getMonitoringOperationsHealth?.(workspaceId);
      if (health) {
        return {
          monitoring_queue: {
            queued: numberValue(
              recordValue(health.monitoring_queue).queued,
              0,
            ),
            running: numberValue(
              recordValue(health.monitoring_queue).running,
              0,
            ),
            failed: numberValue(
              recordValue(health.monitoring_queue).failed,
              0,
            ),
            dead_letter: numberValue(
              recordValue(health.monitoring_queue).dead_letter,
              0,
            ),
            oldest_queued_at: nullableString(
              recordValue(health.monitoring_queue).oldest_queued_at,
            ),
          },
          monitoring_scheduler: {
            enabled_plans: numberValue(
              recordValue(health.monitoring_scheduler).enabled_plans,
              0,
            ),
            due_plans: numberValue(
              recordValue(health.monitoring_scheduler).due_plans,
              0,
            ),
            last_enqueue_at: nullableString(
              recordValue(health.monitoring_scheduler).last_enqueue_at,
            ),
            last_enqueue_error: nullableString(
              recordValue(health.monitoring_scheduler).last_enqueue_error,
            ),
          },
          monitoring_workers: {
            active_workers: numberValue(
              recordValue(health.monitoring_workers).active_workers,
              0,
            ),
            last_success_at: nullableString(
              recordValue(health.monitoring_workers).last_success_at,
            ),
            last_error_at: nullableString(
              recordValue(health.monitoring_workers).last_error_at,
            ),
            recent_error_types: stringList(
              recordValue(health.monitoring_workers).recent_error_types,
            ),
          },
          monitoring_retention: {
            last_run_at: nullableString(
              recordValue(health.monitoring_retention).last_run_at,
            ),
            last_deleted_counts: {
              deleted_pulses: numberValue(
                recordValue(
                  recordValue(health.monitoring_retention)
                    .last_deleted_counts,
                ).deleted_pulses,
                0,
              ),
              deleted_memos: numberValue(
                recordValue(
                  recordValue(health.monitoring_retention)
                    .last_deleted_counts,
                ).deleted_memos,
                0,
              ),
              deleted_jobs: numberValue(
                recordValue(
                  recordValue(health.monitoring_retention)
                    .last_deleted_counts,
                ).deleted_jobs,
                0,
              ),
              dry_run: booleanValue(
                recordValue(
                  recordValue(health.monitoring_retention)
                    .last_deleted_counts,
                ).dry_run,
                true,
              ),
            },
            last_error: nullableString(
              recordValue(health.monitoring_retention).last_error,
            ),
          },
          llm_memo_health: {
            recent_calls: numberValue(
              recordValue(health.llm_memo_health).recent_calls,
              0,
            ),
            failure_rate: nullableNumber(
              recordValue(health.llm_memo_health).failure_rate,
            ),
            average_latency_ms: nullableNumber(
              recordValue(health.llm_memo_health).average_latency_ms,
            ),
          },
        };
      }
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
    }
    return defaultMonitoringHealth();
  }

  private async continuityHealthForWorkspace(
    workspaceId: string,
  ): Promise<OperationsHealthResponse['continuity']> {
    const lookbackDays = 30;
    const scheduler = await this.continuitySchedulerHealthForWorkspace(workspaceId);
    try {
      const health = await this.continuityAudit.getContinuityOperationsHealth(
        workspaceId,
        { lookbackDays },
      );
      return {
        workspace_id: workspaceId,
        lookback_days: numberValue(health.lookback_days, lookbackDays),
        audit_available: booleanValue(health.audit_available, true),
        missing_entries_recent: numberValue(health.missing_entries_recent, 0),
        degraded_entries_recent: numberValue(health.degraded_entries_recent, 0),
        stale_symbols: numberValue(health.stale_symbols, 0),
        last_repair_run_at: nullableString(health.last_repair_run_at),
        last_repair_status: nullableString(health.last_repair_status),
        repair_failures_24h: numberValue(health.repair_failures_24h, 0),
        debug_access_24h: numberValue(health.debug_access_24h, 0),
        debug_denied_24h: numberValue(health.debug_denied_24h, 0),
        scheduled_repair_mode: scheduler.scheduled_repair_mode,
        scheduled_repair_due: scheduler.scheduled_repair_due,
        next_scheduled_repair_due_at:
          scheduler.next_scheduled_repair_due_at,
        last_scheduled_repair_run_id:
          scheduler.last_scheduled_repair_run_id,
      };
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
      return {
        ...defaultContinuityHealth(workspaceId, lookbackDays),
        ...scheduler,
      };
    }
  }

  private async continuitySchedulerHealthForWorkspace(
    workspaceId: string,
  ): Promise<Pick<
    OperationsHealthResponse['continuity'],
    | 'scheduled_repair_mode'
    | 'scheduled_repair_due'
    | 'next_scheduled_repair_due_at'
    | 'last_scheduled_repair_run_id'
  >> {
    try {
      const settings =
        await this.continuitySettings.getWorkspaceSettings(workspaceId);
      if (!settings) {
        return defaultContinuitySchedulerHealth();
      }
      const mode = scheduledRepairModeValue(settings.scheduled_repair_mode);
      const nextDue = nullableString(settings.next_scheduled_repair_due_at);
      return {
        scheduled_repair_mode: mode,
        scheduled_repair_due: mode !== 'disabled' && isDue(nextDue),
        next_scheduled_repair_due_at: nextDue,
        last_scheduled_repair_run_id: nullableString(
          settings.last_scheduled_repair_run_id,
        ),
      };
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
      return defaultContinuitySchedulerHealth();
    }
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }
}

function summarizeLlmCalls(calls: LlmCallResponse[]): LlmHealthSummaryResponse {
  const errors = calls.filter((call) => call.status !== 'success' && call.status !== 'ok');
  const latencies = calls
    .map((call) => call.latency_ms)
    .filter((value): value is number => value !== null);
  const byProvider: Record<string, { calls: number; errors: number; tokens: number }> = {};
  for (const call of calls) {
    const provider = call.provider || 'unknown';
    const current = byProvider[provider] ?? { calls: 0, errors: 0, tokens: 0 };
    current.calls += 1;
    current.tokens += call.input_tokens + call.output_tokens;
    if (call.status !== 'success' && call.status !== 'ok') {
      current.errors += 1;
    }
    byProvider[provider] = current;
  }
  return {
    total_calls: calls.length,
    success_rate: calls.length > 0 ? (calls.length - errors.length) / calls.length : null,
    total_tokens: calls.reduce((sum, call) => sum + call.input_tokens + call.output_tokens, 0),
    average_latency_ms:
      latencies.length > 0
        ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        : null,
    recent_errors: errors.length,
    by_provider: byProvider,
  };
}

function derivedProviderHealth(): ProviderHealthResponse[] {
  const now = new Date().toISOString();
  return [
    envProvider('ccxt', 'market-data', 'CCXT market data is configured by default.', now),
    envProvider('deepseek', 'llm', 'DeepSeek API key presence controls live LLM access.', now, 'DEEPSEEK_API_KEY'),
    envProvider('openai', 'llm', 'OpenAI API key presence controls fallback LLM access.', now, 'OPENAI_API_KEY'),
    envProvider('google', 'llm', 'Google API key presence controls Gemini access.', now, 'GOOGLE_API_KEY'),
    envProvider('redis', 'queue', 'Redis is required only when JOBS_EXECUTION_MODE=bullmq.', now, 'REDIS_URL'),
  ];
}

function envProvider(
  provider: string,
  component: string,
  message: string,
  checkedAt: string,
  envName?: string,
): ProviderHealthResponse {
  const configured = envName ? Boolean(process.env[envName]?.trim()) : true;
  return {
    id: null,
    provider,
    component,
    status: configured ? 'configured' : 'missing_config',
    checked_at: checkedAt,
    latency_ms: null,
    error_type: configured ? null : 'missing_env',
    error_message: configured ? null : `${envName} is not set.`,
    payload: {
      source: 'api_env_snapshot',
      message,
      env_name: envName ?? null,
      secret_value_exposed: false,
    },
  };
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function staleStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized.includes('stale') || normalized.includes('expired') || normalized.includes('failed');
}

function defaultMonitoringHealth(): Pick<
  OperationsHealthResponse,
  | 'monitoring_queue'
  | 'monitoring_scheduler'
  | 'monitoring_workers'
  | 'monitoring_retention'
  | 'llm_memo_health'
> {
  return {
    monitoring_queue: {
      queued: 0,
      running: 0,
      failed: 0,
      dead_letter: 0,
      oldest_queued_at: null,
    },
    monitoring_scheduler: {
      enabled_plans: 0,
      due_plans: 0,
      last_enqueue_at: null,
      last_enqueue_error: null,
    },
    monitoring_workers: {
      active_workers: 0,
      last_success_at: null,
      last_error_at: null,
      recent_error_types: [],
    },
    monitoring_retention: {
      last_run_at: null,
      last_deleted_counts: {
        deleted_pulses: 0,
        deleted_memos: 0,
        deleted_jobs: 0,
        dry_run: true,
      },
      last_error: null,
    },
    llm_memo_health: {
      recent_calls: 0,
      failure_rate: null,
      average_latency_ms: null,
    },
  };
}

function defaultContinuityHealth(
  workspaceId: string,
  lookbackDays: number,
): OperationsHealthResponse['continuity'] {
  return {
    workspace_id: workspaceId,
    lookback_days: lookbackDays,
    audit_available: false,
    missing_entries_recent: 0,
    degraded_entries_recent: 0,
    stale_symbols: 0,
    last_repair_run_at: null,
    last_repair_status: null,
    repair_failures_24h: 0,
    debug_access_24h: 0,
    debug_denied_24h: 0,
    ...defaultContinuitySchedulerHealth(),
  };
}

function defaultContinuitySchedulerHealth(): Pick<
  OperationsHealthResponse['continuity'],
  | 'scheduled_repair_mode'
  | 'scheduled_repair_due'
  | 'next_scheduled_repair_due_at'
  | 'last_scheduled_repair_run_id'
> {
  return {
    scheduled_repair_mode: 'disabled',
    scheduled_repair_due: false,
    next_scheduled_repair_due_at: null,
    last_scheduled_repair_run_id: null,
  };
}

function scheduledRepairModeValue(
  value: unknown,
): OperationsHealthResponse['continuity']['scheduled_repair_mode'] {
  const mode = String(value ?? 'disabled');
  return mode === 'dry_run' || mode === 'enabled' ? mode : 'disabled';
}

function isDue(value: string | null): boolean {
  if (!value) {
    return true;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function recordValue(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);
  return parsed ?? fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function isRepositoryUnavailable(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ServiceUnavailableException') {
    return true;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 503) {
    return true;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return ['42P01', '42703'].includes(String(code));
}
