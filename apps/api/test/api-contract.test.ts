import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EngineRunRequest,
  JournalRepository,
  JsonRecord,
} from '../src/database/journal.types';
import { AuthService } from '../src/auth/auth.service';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { JobsService } from '../src/jobs/jobs.service';
import { ResearchRunsController } from '../src/research-runs/research-runs.controller';
import { ResearchRunsService } from '../src/research-runs/research-runs.service';
import { SignalsService } from '../src/signals/signals.service';
import { ThesesService } from '../src/theses/theses.service';
import { WatchlistsService } from '../src/watchlists/watchlists.service';
import { BriefsService } from '../src/briefs/briefs.service';

class FakeJournalRepository implements JournalRepository {
  readonly researchRuns = new Map<string, JsonRecord>();
  readonly events = new Map<string, JsonRecord[]>();
  readonly theses = new Map<string, JsonRecord>();
  readonly signals: JsonRecord[] = [];
  readonly watchlists: JsonRecord[] = [];
  readonly briefs: JsonRecord[] = [];
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

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.researchRuns.get(key(id, workspaceId)) ?? null;
  }

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    return this.events.get(key(runId, workspaceId)) ?? [];
  }

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return [...this.theses.values()]
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async getThesis(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.theses.get(key(id, workspaceId)) ?? null;
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
    return {
      id: 'watch_item_1',
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      item_type: item.item_type ?? 'symbol',
      symbol: item.symbol ?? null,
      thesis_id: item.thesis_id ?? null,
      setup_type: item.setup_type ?? null,
      enabled: true,
      created_at: '2026-05-12T00:00:00.000Z',
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
  const dailyBriefs = await briefs.daily(
    '2026-05-12',
    20,
    'user_1',
    'workspace_a',
  );

  assert.equal(thesis.summary.entry_zone, '180');
  assert.deepEqual(thesis.summary.target_zones, ['160']);
  assert.equal(listedWatchlists[0]?.enabled, true);
  assert.equal(item.workspace_id, 'workspace_a');
  assert.equal(dailyBriefs[0]?.summary, 'Risk-on tone.');
  assert.deepEqual(dailyBriefs[0]?.thesis_ids, ['thesis_2']);
});

function buildHarness() {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
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
    signals: new SignalsService(journal, auth, workspaces),
    theses: new ThesesService(journal, auth, workspaces),
    watchlists: new WatchlistsService(journal, auth, workspaces),
    briefs: new BriefsService(journal, auth, workspaces),
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
