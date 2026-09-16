import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
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
