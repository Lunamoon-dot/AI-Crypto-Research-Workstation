import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import {
  PerformanceAnalyticsResponse,
  PerformanceHealthResponse,
  PerformanceOutcomeReviewResponse,
  PerformanceTrendPointResponse,
  RetrospectiveInsightResponse,
  toPerformanceOutcomeReviewResponse,
} from '../contracts/frontend-contract';
import { WorkspacesService } from '../workspaces/workspaces.service';

const HIT_RESULTS = new Set(['hit_target', 'hit', 'target_hit']);
const MIXED_RESULTS = new Set(['mixed', 'partial', 'partial_hit']);
const INVALIDATED_RESULTS = new Set(['invalidated', 'stopped_out', 'stop_loss']);

@Injectable()
export class PerformanceService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async outcomes(
    options: { symbol?: string; limit: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PerformanceOutcomeReviewResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const rows = await this.journal.listOutcomeReviews(
      normalizeSymbol(options.symbol),
      options.limit,
      workspaceId,
    );
    return rows.map(toPerformanceOutcomeReviewResponse);
  }

  async analytics(
    options: { symbol?: string; limit: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PerformanceAnalyticsResponse> {
    const reviews = await this.outcomes(options, userId, workspaceHeader);
    return buildAnalytics(reviews, normalizeSymbol(options.symbol) ?? null);
  }

  async trend(
    days: number,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PerformanceTrendPointResponse[]> {
    const reviews = await this.outcomes(
      { limit: 500 },
      userId,
      workspaceHeader,
    );
    const cutoff = startOfUtcDay(Date.now() - days * 86_400_000);
    const buckets = new Map<string, PerformanceOutcomeReviewResponse[]>();
    for (const review of reviews) {
      const basis = parseTime(review.thesis_created_at ?? review.reviewed_at);
      if (basis === null || basis < cutoff) {
        continue;
      }
      const week = weekStartIso(new Date(basis));
      buckets.set(week, [...(buckets.get(week) ?? []), review]);
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([weekStart, bucket]) => ({
        week_start: weekStart,
        sample_size: bucket.length,
        hit_rate: ratio(bucket.filter((review) => isHit(review.result)).length, bucket.length),
        average_mfe: average(bucket.map((review) => review.max_favorable_excursion)),
        average_mae: average(bucket.map((review) => review.max_adverse_excursion)),
        calibration_quality: bucket.length >= 10 ? 'directional_sample' : 'insufficient_data',
      }));
  }

  async health(
    options: { recentDays: number; baselineDays: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PerformanceHealthResponse> {
    const reviews = await this.outcomes(
      { limit: 500 },
      userId,
      workspaceHeader,
    );
    const now = Date.now();
    const recentCutoff = startOfUtcDay(now - options.recentDays * 86_400_000);
    const baselineCutoff = startOfUtcDay(now - options.baselineDays * 86_400_000);
    const recent: PerformanceOutcomeReviewResponse[] = [];
    const baseline: PerformanceOutcomeReviewResponse[] = [];

    for (const review of reviews) {
      const basis = parseTime(review.thesis_created_at ?? review.reviewed_at);
      if (basis === null) {
        continue;
      }
      if (basis >= recentCutoff) {
        recent.push(review);
      } else if (basis >= baselineCutoff) {
        baseline.push(review);
      }
    }

    const recentHitRate = ratio(
      recent.filter((review) => isHit(review.result)).length,
      recent.length,
    );
    const baselineHitRate = ratio(
      baseline.filter((review) => isHit(review.result)).length,
      baseline.length,
    );
    const alerts: string[] = [];
    let status = 'healthy';
    let recommendation = 'Performance is stable across the available reviewed theses.';

    if (reviews.length < 5 || (recent.length === 0 && baseline.length === 0)) {
      status = 'insufficient_data';
      recommendation =
        'Record at least five outcome reviews before trusting performance health.';
    } else if (
      recentHitRate !== null &&
      baselineHitRate !== null &&
      baselineHitRate > 0
    ) {
      const drop = (baselineHitRate - recentHitRate) / baselineHitRate;
      if (drop >= 0.4) {
        status = 'critical';
        alerts.push(`Hit rate dropped ${formatPercent(drop)} versus baseline.`);
        recommendation =
          'Review recent theses, provider freshness, and model routing before scaling usage.';
      } else if (drop >= 0.2) {
        status = 'degraded';
        alerts.push(`Hit rate dropped ${formatPercent(drop)} versus baseline.`);
        recommendation =
          'Monitor closely and inspect recent miss patterns before changing position sizing.';
      }
    }

    if (recentHitRate !== null && recentHitRate < 0.25) {
      if (status === 'healthy') {
        status = 'degraded';
      }
      alerts.push(`Recent hit rate is ${formatPercent(recentHitRate)}.`);
    }

    return {
      overall_status: status,
      recent_sample_size: recent.length,
      baseline_sample_size: baseline.length,
      recent_hit_rate: recentHitRate,
      baseline_hit_rate: baselineHitRate,
      alerts,
      recommendation,
    };
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

function buildAnalytics(
  reviews: PerformanceOutcomeReviewResponse[],
  symbol: string | null,
): PerformanceAnalyticsResponse {
  const resultCounts: Record<string, number> = {};
  for (const review of reviews) {
    resultCounts[review.result] = (resultCounts[review.result] ?? 0) + 1;
  }
  const sampleSize = reviews.length;
  return {
    sample_size: sampleSize,
    symbol,
    result_counts: resultCounts,
    hit_rate: ratio(reviews.filter((review) => isHit(review.result)).length, sampleSize),
    invalidation_rate: ratio(
      reviews.filter((review) => review.invalidated || isInvalidated(review.result)).length,
      sampleSize,
    ),
    mixed_rate: ratio(
      reviews.filter((review) => MIXED_RESULTS.has(review.result)).length,
      sampleSize,
    ),
    average_mfe: average(reviews.map((review) => review.max_favorable_excursion)),
    average_mae: average(reviews.map((review) => review.max_adverse_excursion)),
    reviewed_thesis_ids: reviews
      .map((review) => review.thesis_id)
      .filter((id) => id.length > 0),
    recent_lessons: reviews
      .map((review) => review.lessons.trim())
      .filter(Boolean)
      .slice(0, 8),
    insights: buildInsights(reviews),
  };
}

function buildInsights(
  reviews: PerformanceOutcomeReviewResponse[],
): RetrospectiveInsightResponse[] {
  const insights: RetrospectiveInsightResponse[] = [];
  const bySetup = groupBy(reviews, (review) => review.setup_type || 'unspecified');
  for (const [setupType, group] of bySetup) {
    if (group.length < 2) {
      continue;
    }
    const hitRate = ratio(group.filter((review) => isHit(review.result)).length, group.length);
    if (hitRate !== null && hitRate >= 0.6) {
      insights.push({
        insight_type: 'setup_strength',
        message: `${setupType} setups are working better than the reviewed average.`,
        thesis_ids: group.map((review) => review.thesis_id).slice(0, 5),
        evidence_count: group.length,
      });
    } else if (hitRate !== null && hitRate <= 0.25) {
      insights.push({
        insight_type: 'setup_weakness',
        message: `${setupType} setups have weak reviewed outcomes.`,
        thesis_ids: group.map((review) => review.thesis_id).slice(0, 5),
        evidence_count: group.length,
      });
    }
  }
  return insights.slice(0, 6);
}

function normalizeSymbol(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isHit(result: string): boolean {
  return HIT_RESULTS.has(result);
}

function isInvalidated(result: string): boolean {
  return INVALIDATED_RESULTS.has(result);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null);
  if (finite.length === 0) {
    return null;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function parseTime(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function startOfUtcDay(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function weekStartIso(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function groupBy<T>(
  values: T[],
  keyFn: (value: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}
