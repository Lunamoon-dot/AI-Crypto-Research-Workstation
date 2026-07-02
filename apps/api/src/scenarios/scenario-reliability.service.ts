import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  ScenarioReliabilityProfileResponse,
} from './scenario-reliability.types';
import {
  ScenarioResponse,
  toScenarioReliabilityProfileResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { WorkspacesService } from '../workspaces/workspaces.service';

type ReliabilityFilters = {
  symbol?: string;
  market_type?: string;
  horizon?: string;
  limit: number;
};

@Injectable()
export class ScenarioReliabilityService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async profile(
    filters: ReliabilityFilters,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioReliabilityProfileResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.profileForWorkspace(filters, workspaceId);
  }

  async profileForWorkspace(
    filters: ReliabilityFilters,
    workspaceId: string,
  ): Promise<ScenarioReliabilityProfileResponse[]> {
    const rows = await optionalScenarioLifecycleRows(() =>
      this.journal.listScenarioEvaluationsForReliability(
        {
          symbol: filters.symbol,
          market_type: filters.market_type,
          horizon: filters.horizon,
          limit: filters.limit,
        },
        workspaceId,
      ),
    );
    const groups = new Map<string, JsonRecord[]>();
    for (const row of latestEvaluationPerScenarioWindow(rows)) {
      const key = [
        row.symbol ?? '',
        filters.market_type === 'mixed' ? 'mixed' : row.market_type ?? 'spot',
        row.horizon ?? 'unknown',
        evidenceString(row, 'relation_to_thesis', 'unknown'),
        evidenceString(row, 'action_bias', 'unknown'),
        evidenceNullableString(row, 'setup_type') ?? '',
      ].join('|');
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => this.buildProfile(group, workspaceId, filters.market_type))
      .sort((a, b) => b.sample_size - a.sample_size);
  }

  async profileForScenario(
    scenario: ScenarioResponse,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<ScenarioReliabilityProfileResponse | null> {
    const profiles = await this.profileForWorkspace(
      {
        symbol: nullableString(thesis.symbol ?? scenario.payload.symbol),
        market_type: nullableString(thesis.market_type ?? scenario.payload.market_type),
        horizon: scenario.horizon === 'unknown' ? undefined : scenario.horizon,
        limit: 100,
      },
      workspaceId,
    );
    const setupType = nullableString(thesis.setup_type ?? scenario.payload.setup_type);
    const actionBias = scenario.scenario_recommendation?.action_bias ?? 'unknown';
    const relationActionProfiles = profiles.filter((profile) =>
      profile.relation_to_thesis === scenario.relation_to_thesis &&
      profile.action_bias === actionBias
    );
    if (relationActionProfiles.length === 0) {
      return null;
    }
    if (setupType === undefined) {
      return relationActionProfiles[0] ?? null;
    }
    return (
      relationActionProfiles.find((profile) => profile.setup_type === setupType) ??
      relationActionProfiles[0] ??
      null
    );
  }

  async rebuild(
    filters: ReliabilityFilters,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioReliabilityProfileResponse[]> {
    return this.profile(filters, userId, workspaceHeader);
  }

  private buildProfile(
    group: JsonRecord[],
    workspaceId: string,
    requestedMarketType?: string,
  ): ScenarioReliabilityProfileResponse {
    const first = group[0] ?? {};
    const sampleSize = group.length;
    const enough = sampleSize >= 5;
    const counts = {
      hit: countResult(group, 'hit'),
      invalidated: countResult(group, 'invalidated'),
      mixed: countResult(group, 'mixed'),
      inconclusive: countResult(group, 'inconclusive'),
    };
    const notes: string[] = [];
    if (!enough) {
      notes.push('Not enough history.');
    }
    if (counts.inconclusive > 0) {
      notes.push(`${counts.inconclusive} inconclusive outcome(s).`);
    }
    const completeGroup = group.filter((row) => row.data_quality === 'complete');
    const base = completeGroup.length > 0 ? completeGroup : group;
    return toScenarioReliabilityProfileResponse({
      version: 'scenario_reliability_profile.v1',
      workspace_id: workspaceId,
      symbol: first.symbol ?? null,
      market_type: requestedMarketType === 'mixed' ? 'mixed' : first.market_type ?? 'spot',
      horizon: first.horizon ?? 'unknown',
      relation_to_thesis: evidenceString(first, 'relation_to_thesis', 'unknown'),
      action_bias: evidenceString(first, 'action_bias', 'unknown'),
      setup_type: evidenceNullableString(first, 'setup_type'),
      sample_size: sampleSize,
      hit_rate: enough ? ratio(counts.hit, sampleSize) : null,
      invalidation_rate: enough ? ratio(counts.invalidated, sampleSize) : null,
      mixed_rate: enough ? ratio(counts.mixed, sampleSize) : null,
      inconclusive_rate: enough ? ratio(counts.inconclusive, sampleSize) : null,
      average_mfe: average(base, 'max_favorable_excursion'),
      average_mae: average(base, 'max_adverse_excursion'),
      data_quality_notes: notes,
      recent_lessons: recentLessons(group),
      generated_at: new Date().toISOString(),
    });
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return workspaceId;
  }
}

function countResult(rows: JsonRecord[], result: string): number {
  return rows.filter((row) => row.result === result).length;
}

function latestEvaluationPerScenarioWindow(rows: JsonRecord[]): JsonRecord[] {
  const byWindow = new Map<string, JsonRecord>();
  for (const row of [...rows].sort(compareEvaluatedAtDesc)) {
    const key = scenarioEvaluationWindowKey(row);
    if (!byWindow.has(key)) {
      byWindow.set(key, row);
    }
  }
  return [...byWindow.values()];
}

function scenarioEvaluationWindowKey(row: JsonRecord): string {
  const window = recordValue(row.evaluation_window);
  return [
    row.scenario_id ?? row.id ?? '',
    row.horizon ?? 'unknown',
    window.starts_at ?? '',
    window.ends_at ?? '',
  ].map((value) => String(value ?? '')).join('|');
}

function compareEvaluatedAtDesc(left: JsonRecord, right: JsonRecord): number {
  return String(right.evaluated_at ?? '').localeCompare(String(left.evaluated_at ?? ''));
}

function ratio(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 1000 : 0;
}

function average(rows: JsonRecord[], field: string): number | null {
  const values = rows
    .map((row) => Number(row[field]))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

function evidenceString(row: JsonRecord, field: string, fallback: string): string {
  const evidence = recordValue(row.evidence);
  return String(row[field] ?? evidence[field] ?? fallback);
}

function evidenceNullableString(row: JsonRecord, field: string): string | null {
  const evidence = recordValue(row.evidence);
  const value = row[field] ?? evidence[field];
  return value === null || value === undefined || value === '' ? null : String(value);
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}

function recentLessons(rows: JsonRecord[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => evidenceNullableString(row, 'lesson'))
        .filter((item): item is string => Boolean(item))
        .slice(0, 5),
    ),
  ];
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
