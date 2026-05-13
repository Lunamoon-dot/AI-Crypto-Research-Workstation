import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import {
  EngineRunRequest,
  JournalRepository,
  JsonRecord,
} from '../src/database/journal.types';
import { AuthService } from '../src/auth/auth.service';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsController } from '../src/jobs/jobs.controller';
import { PythonEngineClient } from '../src/jobs/python-engine.client';
import { ResearchRunsController } from '../src/research-runs/research-runs.controller';
import { CreateResearchRunDto } from '../src/research-runs/dto/create-research-run.dto';
import { ResearchRunsService } from '../src/research-runs/research-runs.service';
import { SignalsService } from '../src/signals/signals.service';
import { ThesesService } from '../src/theses/theses.service';
import { WatchlistsService } from '../src/watchlists/watchlists.service';
import { BriefsService } from '../src/briefs/briefs.service';
import { AlertsService } from '../src/alerts/alerts.service';

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

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    return this.events.get(key(runId, workspaceId)) ?? [];
  }

  async getMarketSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.marketSnapshots.get(key(id, workspaceId)) ?? null;
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
  ): Promise<JsonRecord[]> {
    return this.briefs
      .filter((brief) => brief.workspace_id === workspaceId)
      .filter((brief) => !date || brief.brief_date === date)
      .slice(0, limit);
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

test('POST /research-runs enqueues the exact engine request contract', async () => {
  const { researchRunsController, jobs } = buildHarness();

  const response = await researchRunsController.create(
    {
      run_id: 'run_contract',
      workspace_id: 'workspace_a',
      symbol: 'ETH/USDT',
      analysis_date: '2026-05-12',
      analysts: ['market', 'news'],
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
    },
  ]);
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

test('POST /research-runs passes explicit market_type to engine request', async () => {
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
  });
  assert.equal(dto.workspace_id, 'workspace_a');
  assert.equal(dto.market_type, 'perp');
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

test('JobsService memory mode queues requests when Redis and inline are disabled', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: undefined, REDIS_URL: undefined },
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

test('GET /jobs/:id exposes workspace-scoped job status', async () => {
  const { jobs, jobsController } = buildHarness();
  await jobs.enqueueResearchRun(engineRequest('run_status'));

  const status = await jobsController.get('run_status', 'user_1', 'workspace_a');

  assert.equal(status.run_id, 'run_status');
  assert.equal(status.status, 'queued');
  await assert.rejects(
    () => jobsController.get('run_status', 'user_1', 'workspace_b'),
    isException(NotFoundException),
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
    'BTC/USDT',
    50,
    'user_1',
    'workspace_b',
  );
  assert.deepEqual(
    workspaceSignals.map((signal) => signal.id),
    ['sig_b'],
  );
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

function isException(
  exceptionType: new (...args: string[]) => Error,
): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof exceptionType;
}
