import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import {
  EngineRunRequest,
  JournalRepository,
  JsonRecord,
  SignalSummary,
} from '../src/database/journal.types';
import { AuthService } from '../src/auth/auth.service';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { JobLifecycleService } from '../src/jobs/job-lifecycle.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsController } from '../src/jobs/jobs.controller';
import { PythonEngineClient } from '../src/jobs/python-engine.client';
import { ResearchJobProcessor } from '../src/jobs/research-job.processor';
import { SqliteJournalSyncService } from '../src/jobs/sqlite-journal-sync.service';
import { ResearchRunsController } from '../src/research-runs/research-runs.controller';
import { CreateResearchRunDto } from '../src/research-runs/dto/create-research-run.dto';
import { MarketDataGuardService } from '../src/research-runs/market-data-guard.service';
import { ResearchRunsService } from '../src/research-runs/research-runs.service';
import { SignalsController } from '../src/signals/signals.controller';
import { SignalsService } from '../src/signals/signals.service';
import { ThesesController } from '../src/theses/theses.controller';
import { ThesesService } from '../src/theses/theses.service';
import { WatchlistsService } from '../src/watchlists/watchlists.service';
import { BriefsService } from '../src/briefs/briefs.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { openApiDocument } from '../src/contracts/openapi.generated';

class FakeJournalRepository implements JournalRepository {
  readonly researchRuns = new Map<string, JsonRecord>();
  readonly events = new Map<string, JsonRecord[]>();
  readonly marketSnapshots = new Map<string, JsonRecord>();
  readonly signalSnapshots = new Map<string, JsonRecord>();
  readonly debates = new Map<string, JsonRecord>();
  readonly agentOpinions = new Map<string, JsonRecord[]>();
  readonly theses = new Map<string, JsonRecord>();
  readonly scenarios = new Map<string, JsonRecord[]>();
  readonly signals: JsonRecord[] = [];
  readonly watchlists: JsonRecord[] = [];
  readonly watchlistItems: JsonRecord[] = [];
  readonly briefs: JsonRecord[] = [];
  readonly alerts: JsonRecord[] = [];
  readonly decisionCalls: Array<{
    thesisId: string;
    action: string;
    notes: string;
    workspaceId: string;
  }> = [];
  readonly reviewCalls: Array<{
    thesisId: string;
    result: string;
    notes: string;
    workspaceId: string;
  }> = [];

  async listResearchRuns(
    filters: { symbol?: string; status?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.researchRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) => !filters.symbol || run.symbol === filters.symbol)
      .filter((run) => !filters.status || run.status === filters.status)
      .slice(0, filters.limit);
  }

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.researchRuns.get(key(id, workspaceId)) ?? null;
  }

  async markResearchRunFailed(
    id: string,
    workspaceId: string,
    failure: { reason: string; message: string; completedAt?: string },
  ): Promise<JsonRecord | null> {
    const run = this.researchRuns.get(key(id, workspaceId));
    if (!run) {
      return null;
    }
    if (['created', 'queued', 'running'].includes(String(run.status))) {
      const completedAt =
        failure.completedAt ?? new Date('2026-05-12T00:00:00.000Z').toISOString();
      run.status = 'failed';
      run.completed_at = completedAt;
      run.degradation_reasons = appendUniqueString(
        run.degradation_reasons,
        failure.reason,
      );
      run.missing_core_data = appendUniqueString(
        run.missing_core_data,
        failure.reason,
      );
      const events = this.events.get(key(id, workspaceId)) ?? [];
      events.push({
        id: `event_${events.length + 1}`,
        workspace_id: workspaceId,
        research_run_id: id,
        event_type: 'run.failed',
        created_at: completedAt,
        message: failure.message,
        payload: {
          event: 'research_run_failed',
          failure_reason: failure.reason,
        },
      });
      this.events.set(key(id, workspaceId), events);
    }
    return run;
  }

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    return this.events.get(key(runId, workspaceId)) ?? [];
  }

  async getMarketSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.marketSnapshots.get(key(id, workspaceId)) ?? null;
  }

  async getLatestMarketSnapshot(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.marketSnapshots.values()]
        .filter(
          (snapshot) =>
            snapshot.workspace_id === workspaceId && snapshot.symbol === symbol,
        )
        .sort((a, b) =>
          String(b.captured_at ?? '').localeCompare(String(a.captured_at ?? '')),
        )[0] ?? null
    );
  }

  async getSignalSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.signalSnapshots.get(key(id, workspaceId)) ?? null;
  }

  async getDebate(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.debates.get(key(id, workspaceId)) ?? null;
  }

  async listAgentOpinions(
    debateId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.agentOpinions.get(key(debateId, workspaceId)) ?? [];
  }

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return [...this.theses.values()]
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async getThesis(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.theses.get(key(id, workspaceId)) ?? null;
  }

  async listScenarios(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.scenarios.get(key(thesisId, workspaceId)) ?? [];
  }

  async recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    this.decisionCalls.push({ thesisId, action, notes, workspaceId });
    return {
      id: 'decision_1',
      workspace_id: workspaceId,
      thesis_id: thesisId,
      action,
      user_notes: notes,
      decided_at: '2026-05-12T00:00:00.000Z',
    };
  }

  async recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    this.reviewCalls.push({ thesisId, result, notes, workspaceId });
    return {
      id: 'outcome_1',
      workspace_id: workspaceId,
      thesis_id: thesisId,
      result,
      lessons: notes,
      reviewed_at: '2026-05-12T00:00:00.000Z',
      invalidated: result === 'invalidated',
    };
  }

  async listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .filter((signal) => !symbol || signal.symbol === symbol)
      .slice(0, limit);
  }

  async summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary> {
    return this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .filter((signal) => !symbol || signal.symbol === symbol)
      .reduce<SignalSummary>(
        (summary, signal) => {
          const direction = String(signal.direction ?? '').toLowerCase();
          summary.total += 1;
          if (direction.includes('bull') || direction.includes('long')) {
            summary.bullish += 1;
          } else if (direction.includes('bear') || direction.includes('short')) {
            summary.bearish += 1;
          } else {
            summary.neutral += 1;
          }
          return summary;
        },
        { total: 0, bullish: 0, bearish: 0, neutral: 0 },
      );
  }

  async listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return this.watchlists
      .filter((watchlist) => watchlist.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async createWatchlist(
    input: { name: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = {
      id: `watch_${this.watchlists.length + 1}`,
      workspace_id: workspaceId,
      name: input.name,
      enabled: input.enabled ?? true,
      created_at: '2026-05-12T00:00:00.000Z',
    };
    this.watchlists.unshift(watchlist);
    return watchlist;
  }

  async getWatchlist(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return (
      this.watchlists.find(
        (watchlist) =>
          watchlist.id === id && watchlist.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async getWatchlistByName(
    name: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.watchlists.find(
        (watchlist) =>
          watchlist.name === name && watchlist.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async listWatchlistItems(
    watchlistId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.watchlistItems.filter(
      (item) =>
        item.watchlist_id === watchlistId && item.workspace_id === workspaceId,
    );
  }

  async addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const exists = this.watchlists.some(
      (watchlist) =>
        watchlist.id === watchlistId && watchlist.workspace_id === workspaceId,
    );
    if (!exists) {
      throw new NotFoundException(`Watchlist ${watchlistId} not found`);
    }
    const created = {
      id: `watch_item_${this.watchlistItems.length + 1}`,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      item_type: item.item_type ?? 'symbol',
      symbol: item.symbol ?? null,
      thesis_id: item.thesis_id ?? null,
      setup_type: item.setup_type ?? null,
      enabled: true,
      created_at: '2026-05-12T00:00:00.000Z',
    };
    this.watchlistItems.unshift(created);
    return created;
  }

  async updateWatchlist(
    id: string,
    input: { name?: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = await this.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    if (input.name !== undefined) {
      watchlist.name = input.name;
    }
    if (input.enabled !== undefined) {
      watchlist.enabled = input.enabled;
    }
    return watchlist;
  }

  async removeWatchlistItem(
    watchlistId: string,
    itemId: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const index = this.watchlistItems.findIndex(
      (item) =>
        item.id === itemId &&
        item.watchlist_id === watchlistId &&
        item.workspace_id === workspaceId,
    );
    if (index === -1) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }
    this.watchlistItems.splice(index, 1);
    return {
      id: itemId,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      removed: true,
    };
  }

  async listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
    watchlistName?: string,
    throughDate?: string,
  ): Promise<JsonRecord[]> {
    return this.briefs
      .filter((brief) => brief.workspace_id === workspaceId)
      .filter((brief) => !date || brief.brief_date === date)
      .filter((brief) => !throughDate || String(brief.brief_date) <= throughDate)
      .filter((brief) => !watchlistName || brief.watchlist_name === watchlistName)
      .slice(0, limit);
  }

  async getLatestMarketBrief(
    watchlistName: string | undefined,
    beforeDate: string | undefined,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.briefs
        .filter((brief) => brief.workspace_id === workspaceId)
        .filter((brief) => !watchlistName || brief.watchlist_name === watchlistName)
        .filter((brief) => !beforeDate || String(brief.brief_date) < beforeDate)
        .sort((a, b) =>
          String(b.brief_date ?? '').localeCompare(String(a.brief_date ?? '')),
        )[0] ?? null
    );
  }

  async saveMarketBrief(
    brief: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = {
      ...brief,
      workspace_id: workspaceId,
    };
    const index = this.briefs.findIndex(
      (candidate) =>
        candidate.id === saved.id && candidate.workspace_id === workspaceId,
    );
    if (index === -1) {
      this.briefs.unshift(saved);
    } else {
      this.briefs[index] = saved;
    }
    return saved;
  }

  async listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.alerts
      .filter((alert) => alert.workspace_id === workspaceId)
      .filter((alert) => !symbol || alert.symbol === symbol)
      .filter((alert) => !thesisId || alert.thesis_id === thesisId)
      .filter((alert) => !unreadOnly || !alert.read_at)
      .slice(0, limit);
  }

  async findAlert(
    alertType: string,
    thesisId: string | undefined,
    watchlistItemId: string | undefined,
    triggerKey: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.alerts.find(
        (alert) =>
          alert.workspace_id === workspaceId &&
          alert.alert_type === alertType &&
          alert.trigger_key === triggerKey &&
          (alert.thesis_id ?? null) === (thesisId ?? null) &&
          (alert.watchlist_item_id ?? null) === (watchlistItemId ?? null),
      ) ?? null
    );
  }

  async createAlert(alert: JsonRecord, workspaceId: string): Promise<JsonRecord> {
    const saved = { ...alert, workspace_id: workspaceId };
    this.alerts.unshift(saved);
    return saved;
  }

  async markAlertRead(id: string, workspaceId: string): Promise<JsonRecord> {
    const alert = this.alerts.find(
      (candidate) =>
        candidate.id === id && candidate.workspace_id === workspaceId,
    );
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    alert.read_at = alert.read_at ?? '2026-05-12T00:00:00.000Z';
    return alert;
  }
}

test('POST /research-runs rejects x-workspace-id mismatches', async () => {
  const { researchRuns } = buildHarness();

  await assert.rejects(
    () =>
      researchRuns.create(
        {
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_b',
      ),
    isException(BadRequestException),
  );
});

test('AuthService requires an explicit authenticated user', () => {
  const auth = new AuthService();

  assert.throws(
    () => auth.resolveUser(undefined),
    isException(UnauthorizedException),
  );
  assert.throws(() => auth.resolveUser('   '), isException(UnauthorizedException));
});

test('WorkspacesService enforces membership roles', async () => {
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'viewer_1', workspace_id: 'workspace_a', role: 'viewer' },
    { user_id: 'editor_1', workspace_id: 'workspace_a', role: 'editor' },
  ]);

  const viewer = await workspaces.assertAccess(
    'viewer_1',
    'workspace_a',
    'viewer',
  );
  assert.equal(viewer.role, 'viewer');
  await assert.rejects(
    () => workspaces.assertAccess('viewer_1', 'workspace_a', 'editor'),
    isException(ForbiddenException),
  );
  await assert.rejects(
    () => workspaces.assertAccess('viewer_1', 'workspace_b', 'viewer'),
    isException(ForbiddenException),
  );
  const editor = await workspaces.assertAccess(
    'editor_1',
    'workspace_a',
    'editor',
  );
  assert.equal(editor.role, 'editor');
});

test('WorkspacesService grants default local membership without DATABASE_URL', async () => {
  await withEnv(
    {
      DATABASE_URL: undefined,
      WORKSPACE_MEMBERSHIPS: undefined,
      LOCAL_WORKSPACE_MEMBERSHIP: undefined,
      LOCAL_USER_ID: undefined,
      LOCAL_WORKSPACE_ID: undefined,
    },
    async () => {
      const workspaces = new WorkspacesService();

      const membership = await workspaces.assertAccess(
        'local-user',
        'local',
        'editor',
      );

      assert.equal(membership.role, 'owner');
      await workspaces.onModuleDestroy();
    },
  );
});

test('POST /research-runs enqueues the exact engine request contract', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      const response = await researchRunsController.create(
        {
          run_id: 'run_contract',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market', 'news'],
          exchange: 'binance',
          dry_run: true,
          metadata: { source: 'contract-test' },
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(response.run_id, 'run_contract');
      assert.equal(response.workspace_id, 'workspace_a');
      assert.equal(response.status, 'queued');
      assert.equal(response.queue_backend, 'memory');
      assert.deepEqual(jobs.listMemoryJobs(), [
        {
          run_id: 'run_contract',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          asset_class: 'crypto',
          market_type: 'spot',
          analysis_date: '2026-05-12',
          analysts: ['market', 'news'],
          config_profile: 'default',
          exchange: 'binance',
          dry_run: true,
          metadata: { source: 'contract-test' },
        },
      ]);
    },
  );
});

test('POST /research-runs normalizes common crypto symbol inputs', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_symbol_normalized',
          workspace_id: 'workspace_a',
          symbol: ' ethdt ',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.symbol, 'ETH/USDT');
    },
  );
});

test('POST /research-runs sends only graph analyst lanes to the engine', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_analyst_lanes',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market', 'quant', 'risk', 'social'],
        },
        'user_1',
        'workspace_a',
      );

      assert.deepEqual(jobs.listMemoryJobs()[0]?.analysts, ['market', 'social']);
    },
  );
});

test('GET /research-runs lists only the active workspace and filters runs', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_btc', 'workspace_a'), {
    id: 'run_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed',
  });
  journal.researchRuns.set(key('run_eth', 'workspace_a'), {
    id: 'run_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'failed',
  });
  journal.researchRuns.set(key('run_other', 'workspace_b'), {
    id: 'run_other',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    status: 'completed',
  });

  const runs = await researchRuns.list(
    { symbol: 'BTC/USDT', status: 'completed', limit: 50 },
    'user_1',
    'workspace_a',
  );

  assert.deepEqual(
    runs.map((run) => run.id),
    ['run_btc'],
  );
});

test('GET /research-runs includes active jobs before run artifacts persist', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const journal = new FakeJournalRepository();
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      let releaseEngine!: () => void;
      let resolveStarted!: () => void;
      const engineStarted = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const engineBlocker = new Promise<void>((resolve) => {
        releaseEngine = resolve;
      });
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          resolveStarted();
          await engineBlocker;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as PythonEngineClient);
      const researchRuns = new ResearchRunsService(
        journal,
        jobs,
        auth,
        workspaces,
      );

      try {
        await jobs.enqueueResearchRun(engineRequest('run_active_history'));
        await engineStarted;
        const listed = await researchRuns.list(
          { limit: 10 },
          'user_1',
          'workspace_a',
        );
        const active = listed.find(
          (run) => run.run_id === 'run_active_history',
        );
        assert.equal(active?.status, 'running');
        assert.equal(active?.symbol, 'BTC/USDT');
      } finally {
        releaseEngine();
        await waitForJobStatus(jobs, 'run_active_history', 'completed');
        await jobs.onModuleDestroy();
      }
    },
  );
});

test('POST /research-runs passes explicit market_type to engine request', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_perp_contract',
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market'],
          market_type: 'perp',
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.market_type, 'perp');
    },
  );
});

test('POST /research-runs rejects unavailable market data before enqueue', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { journal, jobs } = buildHarness();
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      const guard = {
        assertAvailable: async () => {
          throw new BadRequestException(
            'Market data unavailable for ONDO/USDT on binance. Research was not queued.',
          );
        },
      } as unknown as MarketDataGuardService;
      const researchRuns = new ResearchRunsService(
        journal,
        jobs,
        auth,
        workspaces,
        undefined,
        guard,
      );

      await assert.rejects(
        () =>
          researchRuns.create(
            {
              run_id: 'run_ondo_unavailable',
              workspace_id: 'workspace_a',
              symbol: 'ONDO/USDT',
              analysis_date: '2026-05-12',
              analysts: ['market'],
            },
            'user_1',
            'workspace_a',
          ),
        isException(BadRequestException),
      );
      assert.equal(jobs.listMemoryJobs().length, 0);
      await jobs.onModuleDestroy();
    },
  );
});

test('CreateResearchRunDto rejects invalid boundary payloads', async () => {
  const validPayload = {
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    analysis_date: '2026-05-12',
    analysts: ['market'],
  };
  const invalidPayloads: JsonRecord[] = [
    { ...validPayload, unexpected: true },
    { ...validPayload, market_type: 'futures' },
    { ...validPayload, symbol: '   ' },
    { ...validPayload, workspace_id: '   ' },
    { ...validPayload, analysts: [] },
    { ...validPayload, analysts: ['market', '   '] },
    { ...validPayload, analysis_date: 'not-a-date' },
    { ...validPayload, dry_run: 'true' },
    { ...validPayload, metadata: [] },
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      () => validateCreateResearchRun(payload),
      isException(BadRequestException),
    );
  }

  const dto = await validateCreateResearchRun({
    ...validPayload,
    market_type: 'perp',
    exchange: 'coinbase',
    dry_run: true,
    metadata: { source: 'api-contract-test' },
  });
  assert.equal(dto.workspace_id, 'workspace_a');
  assert.equal(dto.market_type, 'perp');
  assert.equal(dto.exchange, 'coinbase');
  assert.equal(dto.dry_run, true);
  assert.deepEqual(dto.metadata, { source: 'api-contract-test' });
});

test('OpenAPI contract exposes the worker engine request fields', () => {
  const engineProperties =
    openApiDocument.components.schemas.EngineRunRequest.properties;
  const createProperties =
    openApiDocument.components.schemas.CreateResearchRunRequest.properties;

  for (const field of ['exchange', 'dry_run', 'metadata'] as const) {
    assert.ok(field in engineProperties);
    assert.ok(field in createProperties);
  }
  assert.deepEqual(engineProperties.market_type.enum, ['spot', 'perp']);
  assert.deepEqual(createProperties.market_type.enum, ['spot', 'perp']);
});

test('OpenAPI contract covers the frontend-facing controller routes', () => {
  const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;
  const expectedRoutes: Array<[string, string[]]> = [
    ['/research-runs', ['get', 'post']],
    ['/research-runs/{id}', ['get']],
    ['/research-runs/{id}/events', ['get']],
    ['/research-runs/{id}/snapshots', ['get']],
    ['/research-runs/{id}/debate', ['get']],
    ['/research-runs/{id}/workspace', ['get']],
    ['/journal/runs/{id}/workspace', ['get']],
    ['/signals', ['get']],
    ['/signals/count', ['get']],
    ['/theses', ['get']],
    ['/theses/{id}', ['get']],
    ['/theses/{id}/scenarios', ['get']],
    ['/theses/{id}/decision', ['post']],
    ['/theses/{id}/review', ['post']],
    ['/watchlists', ['get', 'post']],
    ['/watchlists/{id}', ['get', 'patch']],
    ['/watchlists/{id}/items', ['get', 'post']],
    ['/watchlists/{id}/items/{itemId}', ['delete']],
    ['/watchlists/{id}/check', ['post']],
    ['/briefs/daily', ['get', 'post']],
    ['/alerts', ['get']],
    ['/alerts/{id}/read', ['post']],
    ['/jobs/{id}', ['get']],
    ['/jobs/{id}/cancel', ['post']],
  ];

  for (const [path, methods] of expectedRoutes) {
    assert.ok(paths[path], `OpenAPI missing ${path}`);
    for (const method of methods) {
      assert.ok(paths[path]?.[method], `OpenAPI missing ${method.toUpperCase()} ${path}`);
    }
  }
});

test('JobsService inline mode returns engine result without memory queue', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'inline', REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(engineRequest('run_inline'));

      assert.equal(result.backend, 'inline');
      assert.match(result.id, /^inline_/);
      assert.deepEqual(result.result, {
        status: 'completed',
        run_id: 'run_inline',
        workspace_id: 'workspace_a',
      });
      assert.equal(captured?.run_id, 'run_inline');
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService defaults to memory mode when no execution mode is configured', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: undefined, REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(
        engineRequest('run_default_memory'),
      );
      const status = await waitForJobStatus(
        jobs,
        'run_default_memory',
        'completed',
      );

      assert.deepEqual(result, {
        id: 'run_default_memory',
        backend: 'memory',
      });
      assert.equal(captured?.run_id, 'run_default_memory');
      assert.equal(status.id, result.id);
      assert.equal(status.status, 'completed');
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService memory mode queues requests when explicitly configured', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const jobs = new JobsService({
        runInline: async () => {
          throw new Error('inline engine should not run');
        },
      } as PythonEngineClient);
      const request = engineRequest('run_memory');

      const result = await jobs.enqueueResearchRun(request);
      const listed = jobs.listMemoryJobs();

      assert.deepEqual(result, { id: 'run_memory', backend: 'memory' });
      assert.deepEqual(listed, [request]);
      listed.length = 0;
      assert.equal(jobs.listMemoryJobs().length, 1);
      const status = await jobs.getJobStatus('run_memory');
      assert.equal(status.status, 'queued');
      assert.equal(status.workspace_id, 'workspace_a');
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService memory mode processes queued requests in the API process', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(
        engineRequest('run_memory_background'),
      );
      assert.deepEqual(result, {
        id: 'run_memory_background',
        backend: 'memory',
      });
      const queuedCaptured = captured;
      assert.equal(queuedCaptured, undefined);

      const completed = await waitForJobStatus(
        jobs,
        'run_memory_background',
        'completed',
      );

      const processedCaptured = captured;
      assert.equal(processedCaptured?.run_id, 'run_memory_background');
      assert.equal(completed.backend, 'memory');
      assert.equal(completed.started_at !== null, true);
      assert.equal(completed.completed_at !== null, true);
      assert.deepEqual(completed.result, {
        status: 'completed',
        run_id: 'run_memory_background',
        workspace_id: 'workspace_a',
      });
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('GET /jobs/:id exposes workspace-scoped job status', async () => {
  const { jobs, jobsController } = buildHarness();
  const enqueued = await jobs.enqueueResearchRun(engineRequest('run_status'));
  await waitForJobStatus(jobs, 'run_status', 'completed');

  const status = await jobsController.get('run_status', 'user_1', 'workspace_a');

  assert.equal(status.id, enqueued.id);
  assert.equal(status.run_id, 'run_status');
  assert.equal(status.status, 'completed');
  await assert.rejects(
    () => jobsController.get('run_status', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
});

test('JobsService reads lifecycle state after replacing the service instance', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const lifecycle = new JobLifecycleService();
      const first = new JobsService(
        {
          runInline: async () => {
            throw new Error('memory worker should be stopped before running');
          },
        } as PythonEngineClient,
        undefined,
        lifecycle,
      );
      const request = engineRequest('run_durable_lifecycle');

      const enqueued = await first.enqueueResearchRun(request);
      await first.onModuleDestroy();
      const second = new JobsService(
        {
          runInline: async () => ({
            status: 'completed',
            run_id: request.run_id,
          }),
        } as PythonEngineClient,
        undefined,
        lifecycle,
      );

      const status = await second.getJobStatus(enqueued.id);

      assert.equal(status.status, 'queued');
      assert.equal(status.run_id, 'run_durable_lifecycle');
      assert.equal(status.attempts, 0);
      assert.equal(status.progress.phase, 'queued');
      await second.onModuleDestroy();
      await lifecycle.onModuleDestroy();
    },
  );
});

test('ResearchJobProcessor persists completion and syncs SQLite artifacts from worker path', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_sync');
    await lifecycle.create({
      id: 'job_processor_sync',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_sync',
      maxAttempts: 2,
    });
    const sqliteSync = {
      syncRun: async (runId: string, workspaceId: string) => ({
        run_id: runId,
        workspace_id: workspaceId,
        sqlite_path: '/tmp/research.sqlite',
        tables: { research_runs: 1, run_events: 2 },
      }),
    } as unknown as SqliteJournalSyncService;
    const processor = new ResearchJobProcessor(
      {
        runInline: async (engineRequest: EngineRunRequest) => ({
          status: 'completed',
          run_id: engineRequest.run_id,
          workspace_id: engineRequest.workspace_id,
        }),
      } as PythonEngineClient,
      lifecycle,
      sqliteSync,
    );

    const result = await processor.process(request, {
      jobId: 'job_processor_sync',
      backend: 'bullmq',
      attempt: 1,
      maxAttempts: 2,
    });
    const status = await lifecycle.get('run_processor_sync');

    assert.equal(result.postgres_sync && typeof result.postgres_sync, 'object');
    assert.equal(status?.status, 'completed');
    assert.equal(status?.attempts, 1);
    assert.equal(status?.heartbeat_at !== null, true);
    assert.deepEqual(status?.result_summary, result);
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchJobProcessor marks timed out jobs and aborts the engine process', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_timeout');
    await lifecycle.create({
      id: 'job_processor_timeout',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_timeout',
      maxAttempts: 1,
    });
    const processor = new ResearchJobProcessor(
      {
        runInline: async (
          _request: EngineRunRequest,
          options?: { signal?: AbortSignal },
        ) =>
          new Promise<JsonRecord>((_resolve, reject) => {
            const holdOpen = setTimeout(() => {
              reject(new Error('timeout test did not abort'));
            }, 1000);
            options?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(holdOpen);
                reject(new Error('aborted by test'));
              },
              { once: true },
            );
          }),
      } as PythonEngineClient,
      lifecycle,
    );

    await assert.rejects(
      () =>
        processor.process(request, {
          jobId: 'job_processor_timeout',
          backend: 'bullmq',
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 5,
        }),
      (error) =>
        error instanceof Error && error.message === 'aborted by test',
    );
    const status = await lifecycle.get('job_processor_timeout');

    assert.equal(status?.status, 'timed_out');
    assert.equal(status?.error_code, 'job_timed_out');
    assert.equal(status?.timeout_at !== null, true);
    await lifecycle.onModuleDestroy();
  });
});

test('POST /jobs/:id/cancel records durable cancellation for queued jobs', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const lifecycle = new JobLifecycleService();
      const jobs = new JobsService(
        {
          runInline: async () => {
            throw new Error('cancelled job should not run');
          },
        } as PythonEngineClient,
        undefined,
        lifecycle,
      );
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      const jobsController = new JobsController(jobs, auth, workspaces);

      await jobs.enqueueResearchRun(engineRequest('run_cancelled'));
      const cancelled = await jobsController.cancel(
        'run_cancelled',
        'user_1',
        'workspace_a',
      );

      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.cancellation_requested_at !== null, true);
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
      await lifecycle.onModuleDestroy();
    },
  );
});

test('PythonEngineClient resolves JSON output from the configured command', async () => {
  const scriptPath = await writeEngineScript(`
    const fs = require('node:fs');
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify({
      status: 'completed',
      run_id: request.run_id,
      workspace_id: request.workspace_id
    }));
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      const result = await new PythonEngineClient().runInline(
        engineRequest('run_python_success'),
      );

      assert.deepEqual(result, {
        status: 'completed',
        run_id: 'run_python_success',
        workspace_id: 'workspace_a',
      });
    },
  );
});

test('PythonEngineClient preserves failed engine JSON from non-zero exits', async () => {
  const scriptPath = await writeEngineScript(`
    const fs = require('node:fs');
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify({
      status: 'failed',
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      error_type: 'quality_gate_failed',
      error: 'missing market snapshot'
    }));
    process.exit(1);
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      const result = await new PythonEngineClient().runInline(
        engineRequest('run_python_failed_json'),
      );

      assert.deepEqual(result, {
        status: 'failed',
        run_id: 'run_python_failed_json',
        workspace_id: 'workspace_a',
        error_type: 'quality_gate_failed',
        error: 'missing market snapshot',
      });
    },
  );
});

test('PythonEngineClient rejects non-zero engine exits with stderr', async () => {
  const scriptPath = await writeEngineScript(`
    process.stderr.write('engine failed');
    process.exit(7);
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      await assert.rejects(
        () => new PythonEngineClient().runInline(engineRequest('run_python_fail')),
        (error: unknown) =>
          error instanceof Error && /engine failed/.test(error.message),
      );
    },
  );
});

test('PythonEngineClient rejects successful exits with invalid JSON stdout', async () => {
  const scriptPath = await writeEngineScript(`
    process.stdout.write('not json');
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      await assert.rejects(
        () =>
          new PythonEngineClient().runInline(engineRequest('run_python_bad_json')),
        (error: unknown) => error instanceof SyntaxError,
      );
    },
  );
});

test('SqliteJournalSyncService uses configured export script outside repo cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'api-sqlite-sync-'));
  const scriptPath = join(dir, 'export.js');
  const sqlitePath = join(dir, 'research_journal.sqlite');
  await writeFile(sqlitePath, 'placeholder', 'utf8');
  await writeFile(
    scriptPath,
    `
      const runId = process.argv[3];
      process.stdout.write(JSON.stringify({
        research_runs: [{
          id: runId,
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          status: 'completed'
        }]
      }));
    `,
    'utf8',
  );

  await withEnv(
    {
      DATABASE_URL: undefined,
      PYTHON_SYNC_COMMAND: process.execPath,
      SQLITE_JOURNAL_EXPORT_SCRIPT: scriptPath,
      TRADINGAGENTS_JOURNAL_DB: sqlitePath,
    },
    async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpdir());
      try {
        const exported = await new SqliteJournalSyncService().exportRun(
          'run_exported',
        );

        assert.equal(exported?.research_runs[0]?.id, 'run_exported');
      } finally {
        process.chdir(previousCwd);
      }
    },
  );
});

test('ResearchRunsService workspace falls back to SQLite export artifacts', async () => {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite'
        ? {
            research_runs: [
              {
                id: 'run_sqlite',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'completed',
                market_snapshot_id: 'market_1',
                signal_snapshot_id: 'signal_snapshot_1',
                debate_id: 'debate_1',
                thesis_id: 'thesis_1',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            market_snapshots: [
              {
                id: 'market_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                current_price: 42000,
                source: 'fixture',
                payload_json: '{"source":"fixture"}',
              },
            ],
            signal_snapshots: [
              {
                id: 'signal_snapshot_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                signal_count: 2,
                bullish_count: 1,
                bearish_count: 0,
                neutral_count: 1,
                payload_json: '{}',
              },
            ],
            debates: [
              {
                id: 'debate_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                consensus_stance: 'bullish',
                conflict_level: 'low',
                payload_json: '{}',
              },
            ],
            agent_opinions: [
              {
                id: 'opinion_1',
                workspace_id: 'workspace_a',
                debate_id: 'debate_1',
                research_run_id: 'run_sqlite',
                agent_name: 'Market Analyst',
                agent_role: 'market',
                stance: 'bullish',
                confidence: 0.7,
                payload_json: '{}',
              },
            ],
            trade_theses: [
              {
                id: 'thesis_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                direction: 'long',
                setup_type: 'breakout',
                confidence: 0.8,
                payload_json:
                  '{"thesis_text":"Long setup","structured_summary":{"action_summary":"Watch breakout"}}',
              },
            ],
            scenarios: [
              {
                id: 'scenario_1',
                workspace_id: 'workspace_a',
                thesis_id: 'thesis_1',
                probability_band: 'base',
                suggested_user_action: 'watch',
                payload_json:
                  '{"condition":"breakout holds","expected_behavior":"uptrend continuation"}',
              },
            ],
            run_events: [
              {
                id: 'event_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                event_type: 'completed',
                message: 'done',
                payload_json: '{}',
              },
            ],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.run_id, 'run_sqlite');
  assert.equal(workspace.snapshots.market_snapshot?.current_price, 42000);
  assert.equal(workspace.debate.agent_opinions.length, 1);
  assert.equal(workspace.thesis?.thesis_text, 'Long setup');
  assert.equal(workspace.scenarios[0]?.condition, 'breakout holds');
  await jobs.onModuleDestroy();
});

test('ResearchRunsService workspace exposes full report artifact metadata', async () => {
  const resultsDir = await mkdtemp(join(tmpdir(), 'lunacrypto-artifacts-'));
  const reportDir = join(resultsDir, 'BTC-USDT', '2026-05-12');
  const stateDir = join(resultsDir, 'BTC_USDT', 'ResearchWorkspace_logs');
  await mkdir(reportDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(reportDir, 'complete_report.md'), '# Report\n', 'utf8');
  await writeFile(
    join(stateDir, 'full_states_log_2026-05-12.json'),
    '{}\n',
    'utf8',
  );

  await withEnv({ TRADINGAGENTS_RESULTS_DIR: resultsDir }, async () => {
    const { journal, researchRuns, jobs } = buildHarness();
    journal.researchRuns.set(key('run_artifacts', 'workspace_a'), {
      id: 'run_artifacts',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      asset_class: 'crypto',
      market_type: 'spot',
      timeframe: '2026-05-12',
      status: 'completed',
      started_at: '2026-05-12T00:00:00.000Z',
      degradation_reasons: [],
      missing_core_data: [],
      missing_optional_data: [],
    });

    const workspace = await researchRuns.workspace(
      'run_artifacts',
      'user_1',
      'workspace_a',
    );

    assert.equal(workspace.artifacts.full_report.exists, true);
    assert.equal(workspace.artifacts.full_state.exists, true);
    assert.match(
      workspace.artifacts.full_report.path ?? '',
      /BTC-USDT[\\/]+2026-05-12[\\/]complete_report\.md$/,
    );
    assert.match(
      workspace.artifacts.full_state.path ?? '',
      /BTC_USDT[\\/]ResearchWorkspace_logs[\\/]full_states_log_2026-05-12\.json$/,
    );
    await jobs.onModuleDestroy();
  });
});

test('ResearchRunsService keeps active runs when durable job lifecycle exists', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const journal = new FakeJournalRepository();
    const auth = new AuthService();
    const workspaces = new WorkspacesService();
    workspaces.setMembershipsForTest([
      { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
    ]);
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_durable_active');
    await lifecycle.create({
      id: request.run_id,
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: request.run_id,
      maxAttempts: 3,
    });
    const jobs = new JobsService(
      {
        runInline: async () => ({
          status: 'completed',
          run_id: request.run_id,
        }),
      } as PythonEngineClient,
      undefined,
      lifecycle,
    );
    journal.researchRuns.set(key('run_durable_active', 'workspace_a'), {
      id: 'run_durable_active',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      asset_class: 'crypto',
      market_type: 'spot',
      status: 'running',
    });
    const researchRuns = new ResearchRunsService(
      journal,
      jobs,
      auth,
      workspaces,
    );

    const workspace = await researchRuns.workspace(
      'run_durable_active',
      'user_1',
      'workspace_a',
    );

    assert.equal(workspace.run.status, 'running');
    assert.deepEqual(workspace.events, []);
    await jobs.onModuleDestroy();
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchRunsService marks active runs with missing job state as failed', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_orphaned', 'workspace_a'), {
    id: 'run_orphaned',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'running',
    started_at: '2026-05-12T00:00:00.000Z',
    degradation_reasons: [],
    missing_core_data: [],
    missing_optional_data: [],
  });

  const workspace = await researchRuns.workspace(
    'run_orphaned',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.equal(workspace.run.completed_at !== null, true);
  assert.deepEqual(workspace.run.degradation_reasons, ['orphaned_job_state']);
  assert.deepEqual(workspace.run.missing_core_data, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
});

test('ResearchRunsService marks orphaned SQLite fallback runs as failed in workspace response', async () => {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite_orphaned'
        ? {
            research_runs: [
              {
                id: 'run_sqlite_orphaned',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'running',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            run_events: [],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite_orphaned',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.deepEqual(workspace.run.degradation_reasons, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
  await jobs.onModuleDestroy();
});

test('ResearchRunsService keeps SQLite fallback usable when Postgres failure marking is unavailable', async () => {
  class UnavailableJournalRepository extends FakeJournalRepository {
    override async markResearchRunFailed(): Promise<JsonRecord | null> {
      throw new ServiceUnavailableException('database unavailable');
    }
  }

  const journal = new UnavailableJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite_unavailable_mark'
        ? {
            research_runs: [
              {
                id: 'run_sqlite_unavailable_mark',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'running',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            run_events: [],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite_unavailable_mark',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.deepEqual(workspace.run.missing_core_data, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
  await jobs.onModuleDestroy();
});

test('read APIs scope research runs and signals to the request workspace', async () => {
  const { journal, researchRuns, signals } = buildHarness();
  journal.researchRuns.set(key('run_1', 'workspace_a'), {
    id: 'run_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed',
  });
  journal.signals.push(
    {
      id: 'sig_a',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'regime',
      direction: 'bullish',
    },
    {
      id: 'sig_b',
      workspace_id: 'workspace_b',
      symbol: 'BTC/USDT',
      signal_type: 'funding',
      direction: 'bearish',
    },
  );

  const run = await researchRuns.get('run_1', 'user_1', 'workspace_a');
  assert.equal(run.workspace_id, 'workspace_a');
  await assert.rejects(
    () => researchRuns.get('run_1', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );

  const workspaceSignals = await signals.list(
    'BTC',
    50,
    'user_1',
    'workspace_b',
  );
  assert.deepEqual(
    workspaceSignals.map((signal) => signal.id),
    ['sig_b'],
  );
  assert.deepEqual(await signals.count('BTC/USDT', 'user_1', 'workspace_b'), {
    total: 1,
    bullish: 0,
    bearish: 1,
    neutral: 0,
  });
  assert.deepEqual(await signals.count('BTC', 'user_1', 'workspace_b'), {
    total: 1,
    bullish: 0,
    bearish: 1,
    neutral: 0,
  });
});

test('signals and theses limits reject invalid values before repository reads', async () => {
  const { journal, signals, theses } = buildHarness();
  const signalsController = new SignalsController(signals);
  const thesesController = new ThesesController(theses);

  for (let index = 0; index < 150; index += 1) {
    journal.signals.push({
      id: `sig_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'regime',
      direction: 'neutral',
    });
    journal.theses.set(key(`thesis_${index}`, 'workspace_a'), {
      id: `thesis_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      direction: 'watch',
    });
  }

  await assert.rejects(
    async () =>
      signalsController.list(undefined, 'not-a-number', 'user_1', 'workspace_a'),
    isException(BadRequestException),
  );
  await assert.rejects(
    async () => thesesController.list('not-a-number', 'user_1', 'workspace_a'),
    isException(BadRequestException),
  );

  const limitedSignals = await signalsController.list(
    undefined,
    '1000',
    'user_1',
    'workspace_a',
  );
  const limitedTheses = await thesesController.list(
    '1000',
    'user_1',
    'workspace_a',
  );

  assert.equal(limitedSignals.length, 100);
  assert.equal(limitedTheses.length, 100);
});

test('thesis decision and review verify workspace before writing', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Structured thesis.',
    structured_summary: {
      rating: 'Buy',
      direction: 'long',
      entry_zone: '100000',
      invalidation: '95000',
      target_zones: ['110000'],
    },
  });

  await assert.rejects(
    () => theses.decide('thesis_1', 'accepted', 'ok', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
  await assert.rejects(
    () => theses.review('thesis_1', 'invalidated', 'bad', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
  assert.equal(journal.decisionCalls.length, 0);
  assert.equal(journal.reviewCalls.length, 0);

  const decision = await theses.decide(
    'thesis_1',
    'accepted',
    'ok',
    'user_1',
    'workspace_a',
  );
  const review = await theses.review(
    'thesis_1',
    'invalidated',
    'bad',
    'user_1',
    'workspace_a',
  );

  assert.equal(decision.workspace_id, 'workspace_a');
  assert.equal(review.workspace_id, 'workspace_a');
  assert.equal(journal.decisionCalls[0]?.workspaceId, 'workspace_a');
  assert.equal(journal.reviewCalls[0]?.workspaceId, 'workspace_a');
});

test('frontend contract responses are normalized for thesis, watchlist, and brief', async () => {
  const { journal, theses, watchlists, briefs } = buildHarness();
  journal.theses.set(key('thesis_2', 'workspace_a'), {
    id: 'thesis_2',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    direction: 'short',
    confidence: '0.7',
    thesis_text: 'Fade failed reclaim.',
    structured_summary: {
      rating: 'Sell',
      direction: 'short',
      action_summary: 'Fade failed reclaim',
      entry_zone: '180',
      invalidation: '190',
      target_zones: ['160'],
      is_degraded: false,
    },
  });
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: 1,
  });
  journal.briefs.push({
    id: 'brief_1',
    workspace_id: 'workspace_a',
    brief_date: '2026-05-12',
    title: 'Daily Brief',
    summary: 'Risk-on tone.',
    key_points: ['Liquidity improving'],
    thesis_ids: ['thesis_2'],
  });

  const thesis = await theses.get('thesis_2', 'user_1', 'workspace_a');
  const listedWatchlists = await watchlists.list(50, 'user_1', 'workspace_a');
  const item = await watchlists.addItem(
    'watch_1',
    { symbol: 'SOL/USDT', item_type: 'symbol' },
    'user_1',
    'workspace_a',
  );
  const createdWatchlist = await watchlists.create(
    { name: 'Momentum' },
    'user_1',
    'workspace_a',
  );
  const watchItems = await watchlists.items('watch_1', 'user_1', 'workspace_a');
  const updatedWatchlist = await watchlists.update(
    'watch_1',
    { name: 'Core renamed', enabled: false },
    'user_1',
    'workspace_a',
  );
  const removedItem = await watchlists.removeItem(
    'watch_1',
    item.id ?? '',
    'user_1',
    'workspace_a',
  );
  const dailyBriefs = await briefs.daily(
    '2026-05-12',
    20,
    'user_1',
    'workspace_a',
  );

  assert.equal(thesis.summary.entry_zone, '180');
  assert.deepEqual(thesis.summary.target_zones, ['160']);
  assert.equal(listedWatchlists[0]?.enabled, true);
  assert.equal(createdWatchlist.name, 'Momentum');
  assert.equal(item.workspace_id, 'workspace_a');
  assert.equal(watchItems[0]?.id, item.id);
  assert.equal(updatedWatchlist.name, 'Core renamed');
  assert.equal(updatedWatchlist.enabled, false);
  assert.equal(removedItem.removed, true);
  assert.equal(dailyBriefs[0]?.summary, 'Risk-on tone.');
  assert.deepEqual(dailyBriefs[0]?.thesis_ids, ['thesis_2']);
});

test('watchlist thesis tracking rejects pasted run IDs with a useful correction', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
  });
  journal.researchRuns.set(key('run_b97', 'workspace_a'), {
    id: 'run_b97',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'completed',
    thesis_id: 'thesis_b39b6f77',
  });
  journal.theses.set(key('thesis_b39b6f77', 'workspace_a'), {
    id: 'thesis_b39b6f77',
    workspace_id: 'workspace_a',
    research_run_id: 'run_b97',
    symbol: 'ETH/USDT',
    direction: 'long',
    confidence: 0.35,
  });

  await assert.rejects(
    () =>
      watchlists.addItem(
        'watch_1',
        { item_type: 'thesis', thesis_id: 'run_b97' },
        'user_1',
        'workspace_a',
      ),
    (error) =>
      error instanceof BadRequestException &&
      error.message ===
        'No thesis found for this ID. You pasted a run ID. Use thesis thesis_b39b6f77 instead.',
  );

  const item = await watchlists.addItem(
    'watch_1',
    { item_type: 'thesis', thesis_id: 'thesis_b39b6f77' },
    'user_1',
    'workspace_a',
  );

  assert.equal(item.symbol, 'ETH/USDT');
  assert.equal(item.thesis_id, 'thesis_b39b6f77');
});

test('watchlist check creates deduped alerts from latest snapshots', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.82,
    thesis_text: 'Breakout continuation.',
    target_zones: ['110000'],
    invalidation_level: '95000',
  });
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 111000,
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });

  const first = await watchlists.check(
    'watch_1',
    {},
    'user_1',
    'workspace_a',
  );
  const second = await watchlists.check(
    'watch_1',
    {},
    'user_1',
    'workspace_a',
  );

  assert.equal(first.checked_items, 1);
  assert.equal(first.alerts_created.length, 1);
  assert.equal(first.alerts_created[0]?.alert_type, 'target_zone_reached');
  assert.equal(second.alerts_created.length, 0);
});

test('daily brief generation persists a usable watchlist brief', async () => {
  const { journal, briefs } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.82,
    thesis_text: 'Breakout continuation.',
    target_zones: ['110000'],
    invalidation_level: '95000',
    supporting_signal_ids: ['sig_1'],
  });
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 108000,
    market_regime: 'risk-on',
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });

  const brief = await briefs.createDaily(
    { watchlist_id: 'watch_1', date: '2026-05-14' },
    'user_1',
    'workspace_a',
  );

  assert.equal(brief.watchlist_name, 'Core');
  assert.equal(brief.brief_date, '2026-05-14');
  assert.deepEqual(brief.thesis_ids, ['thesis_1']);
  assert.deepEqual(brief.signal_ids, ['sig_1']);
  assert.equal(brief.asset_summaries.some((asset) => asset.symbol === 'BTC/USDT'), true);
  assert.equal(journal.briefs.length, 1);
});

test('daily brief archive can be scoped to a selected watchlist and rejects future dates', async () => {
  const { journal, briefs } = buildHarness();
  journal.watchlists.push(
    {
      id: 'watch_1',
      workspace_id: 'workspace_a',
      name: 'Core',
      enabled: true,
    },
    {
      id: 'watch_2',
      workspace_id: 'workspace_a',
      name: 'Alt',
      enabled: true,
    },
  );
  journal.briefs.push(
    {
      id: 'brief_core',
      workspace_id: 'workspace_a',
      brief_date: '2026-05-14',
      watchlist_name: 'Core',
      title: 'Core brief',
    },
    {
      id: 'brief_alt',
      workspace_id: 'workspace_a',
      brief_date: '2026-05-14',
      watchlist_name: 'Alt',
      title: 'Alt brief',
    },
    {
      id: 'brief_future',
      workspace_id: 'workspace_a',
      brief_date: '2999-01-01',
      watchlist_name: 'Core',
      title: 'Future brief',
    },
  );

  const scoped = await briefs.daily(
    undefined,
    20,
    'user_1',
    'workspace_a',
    'watch_1',
  );

  assert.deepEqual(
    scoped.map((brief) => brief.id),
    ['brief_core'],
  );
  await assert.rejects(
    () => briefs.daily('2999-01-01', 20, 'user_1', 'workspace_a', 'watch_1'),
    isException(BadRequestException),
  );
  await assert.rejects(
    () =>
      briefs.createDaily(
        { watchlist_id: 'watch_1', date: '2999-01-01' },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
});

test('research workspace exposes snapshots, debate, scenarios, and events', async () => {
  const { journal, researchRuns, theses } = buildHarness();
  journal.researchRuns.set(key('run_workspace', 'workspace_a'), {
    id: 'run_workspace',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    status: 'completed',
    market_snapshot_id: 'market_1',
    signal_snapshot_id: 'snapshot_1',
    debate_id: 'debate_1',
    thesis_id: 'thesis_3',
  });
  journal.events.set(key('run_workspace', 'workspace_a'), [
    {
      id: 'event_1',
      workspace_id: 'workspace_a',
      research_run_id: 'run_workspace',
      event_type: 'run.completed',
      message: 'completed',
      payload: { status: 'completed' },
    },
  ]);
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    current_price: '100100',
    source: 'ccxt',
  });
  journal.signalSnapshots.set(key('snapshot_1', 'workspace_a'), {
    id: 'snapshot_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    signal_count: 3,
    bullish_count: 2,
    bearish_count: 1,
    neutral_count: 0,
    stale_count: 0,
    unknown_freshness_count: 0,
  });
  journal.debates.set(key('debate_1', 'workspace_a'), {
    id: 'debate_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    consensus_stance: 'bullish',
    conflict_level: 'medium',
  });
  journal.agentOpinions.set(key('debate_1', 'workspace_a'), [
    {
      id: 'opinion_1',
      workspace_id: 'workspace_a',
      debate_id: 'debate_1',
      research_run_id: 'run_workspace',
      agent_name: 'market_analyst',
      agent_role: 'analyst',
      stance: 'bullish',
      confidence: '0.64',
    },
  ]);
  journal.theses.set(key('thesis_3', 'workspace_a'), {
    id: 'thesis_3',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'trend_pullback',
  });
  journal.scenarios.set(key('thesis_3', 'workspace_a'), [
    {
      id: 'scenario_1',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_3',
      probability_band: 'high',
      suggested_user_action: 'watch',
      payload: {
        condition: 'Holds entry zone',
        expected_behavior: 'Rotation higher',
      },
    },
  ]);

  const snapshots = await researchRuns.snapshots(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const debate = await researchRuns.debate(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const workspace = await researchRuns.workspace(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const scenarios = await theses.scenarios(
    'thesis_3',
    'user_1',
    'workspace_a',
  );

  assert.equal(snapshots.market_snapshot?.current_price, 100100);
  assert.equal(snapshots.signal_snapshot?.signal_count, 3);
  assert.equal(debate.debate?.consensus_stance, 'bullish');
  assert.equal(debate.agent_opinions[0]?.confidence, 0.64);
  assert.equal(workspace.events[0]?.event_type, 'run.completed');
  assert.equal(workspace.thesis?.id, 'thesis_3');
  assert.equal(scenarios[0]?.condition, 'Holds entry zone');
});

test('alerts list and read APIs are workspace scoped', async () => {
  const { journal, alerts } = buildHarness();
  journal.alerts.push(
    {
      id: 'alert_1',
      workspace_id: 'workspace_a',
      alert_type: 'scenario_activated',
      symbol: 'SOL/USDT',
      thesis_id: 'thesis_a',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'Scenario activated',
    },
    {
      id: 'alert_2',
      workspace_id: 'workspace_b',
      alert_type: 'target_zone_reached',
      symbol: 'SOL/USDT',
      thesis_id: 'thesis_b',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'Target reached',
    },
  );

  const unread = await alerts.list(
    { symbol: 'SOL/USDT', unreadOnly: true },
    'user_1',
    'workspace_a',
  );
  const read = await alerts.markRead('alert_1', 'user_1', 'workspace_a');

  assert.deepEqual(
    unread.map((alert) => alert.id),
    ['alert_1'],
  );
  assert.equal(read.read_at, '2026-05-12T00:00:00.000Z');
  await assert.rejects(
    () => alerts.markRead('alert_2', 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
});

const createResearchRunMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateResearchRunDto,
  data: '',
};

const createResearchRunPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function validateCreateResearchRun(
  payload: JsonRecord,
): Promise<CreateResearchRunDto> {
  return (await createResearchRunPipe.transform(
    payload,
    createResearchRunMetadata,
  )) as CreateResearchRunDto;
}

function engineRequest(runId: string): EngineRunRequest {
  return {
    run_id: runId,
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    analysis_date: '2026-05-12',
    analysts: ['market'],
    config_profile: 'default',
    exchange: null,
    dry_run: false,
    metadata: {},
  };
}

async function writeEngineScript(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'api-engine-client-'));
  const scriptPath = join(dir, 'engine.js');
  await writeFile(scriptPath, source, 'utf8');
  return scriptPath;
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function waitForJobStatus(
  jobs: JobsService,
  id: string,
  expectedStatus: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await jobs.getJobStatus(id);
    if (status.status === expectedStatus) {
      return status;
    }
    await delay(10);
  }
  const status = await jobs.getJobStatus(id);
  throw new Error(
    `Timed out waiting for job ${id} to reach ${expectedStatus}; current status is ${status.status}`,
  );
}

function buildHarness() {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
    { user_id: 'user_1', workspace_id: 'workspace_b', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  });
  const researchRuns = new ResearchRunsService(journal, jobs, auth, workspaces);
  return {
    journal,
    jobs,
    researchRuns,
    researchRunsController: new ResearchRunsController(researchRuns),
    jobsController: new JobsController(jobs, auth, workspaces),
    signals: new SignalsService(journal, auth, workspaces),
    theses: new ThesesService(journal, auth, workspaces),
    watchlists: new WatchlistsService(journal, auth, workspaces),
    briefs: new BriefsService(journal, auth, workspaces),
    alerts: new AlertsService(journal, auth, workspaces),
  };
}

function key(id: string, workspaceId: string): string {
  return `${workspaceId}:${id}`;
}

function appendUniqueString(value: unknown, item: string): string[] {
  const current = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return current.includes(item) ? current : [...current, item];
}

function isException(
  exceptionType: new (...args: string[]) => Error,
): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof exceptionType;
}
