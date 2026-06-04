import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalRepository, JsonRecord } from '../src/database/journal.types';
import { AuthService } from '../src/auth/auth.service';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { ResearchChatRetriever } from '../src/research-chat/research-chat-retriever';
import { ResearchChatService } from '../src/research-chat/research-chat.service';

test('research chat answers continuity diff questions with structured sources', async () => {
  const journal = new ResearchChatFakeJournal();
  journal.theses.push({
    id: 'thesis_latest',
    workspace_id: 'workspace_a',
    research_run_id: 'run_latest',
    symbol: 'BTC/USDT',
    direction: 'long',
    confidence: 0.72,
    created_at: '2026-06-04T08:00:00.000Z',
    thesis_text: 'BTC remains constructive while spot demand holds.',
    summary: {
      key_reasons: ['Spot demand remained the main support.'],
      risks: ['Funding moved hot again.'],
    },
    monitor_next: ['Watch ETF inflows and funding reset.'],
  });
  journal.researchRuns.push(
    {
      id: 'run_latest',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      status: 'completed',
      completed_at: '2026-06-04T08:05:00.000Z',
      market_snapshot_id: 'market_latest',
      signal_snapshot_id: 'signal_latest',
      thesis_id: 'thesis_latest',
    },
    {
      id: 'run_previous',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      status: 'completed',
      completed_at: '2026-06-03T08:05:00.000Z',
      thesis_id: 'thesis_previous',
    },
  );
  journal.continuityState = {
    id: 'state_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    latest_entry_id: 'continuity_latest',
    active_items: [
      {
        type: 'risk',
        text: 'Funding moved hot again.',
        source_artifact: 'trade_thesis',
      },
    ],
    current_view: {
      directional_bias: 'bullish',
      conviction: 'medium-high',
      risk_posture: 'selective',
    },
  };
  journal.continuityEntries.push(
    {
      id: 'continuity_latest',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      research_run_id: 'run_latest',
      generated_at: '2026-06-04T08:10:00.000Z',
      summary: 'Bias stayed bullish but risk posture became more selective.',
      events: [
        {
          event_type: 'view_changed',
          before: 'bullish / medium',
          after: 'bullish / medium-high',
          reason: 'Spot demand held while funding risk increased.',
        },
      ],
    },
    {
      id: 'continuity_previous',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      research_run_id: 'run_previous',
      generated_at: '2026-06-03T08:10:00.000Z',
      summary: 'Previous run was bullish with cleaner funding.',
    },
  );
  journal.scenarios.set('thesis_latest', [
    {
      id: 'scenario_breakout',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_latest',
      probability_band: 'medium-high',
      condition: 'Break above resistance with volume.',
      suggested_user_action: 'watch',
      expected_behavior: 'Trend continuation.',
    },
  ]);
  journal.alerts.push({
    id: 'alert_funding',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_id: 'thesis_latest',
    message: 'Funding threshold warning.',
    created_at: '2026-06-04T07:55:00.000Z',
  });

  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'viewer' },
  ]);
  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const service = new ResearchChatService(retriever, auth, workspaces);

  const response = await service.ask(
    {
      symbol: 'BTC/USDT',
      message: 'Thesis hôm nay khác run trước chỗ nào?',
      scope: 'latest',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.intent, 'diff');
  assert.equal(response.context.symbol, 'BTC/USDT');
  assert.match(response.answer, /run trước|previous/i);
  assert.match(response.answer, /selective|funding|rủi ro/i);
  assert.ok(response.sources.some((source) => source.type === 'thesis' && source.id === 'thesis_latest'));
  assert.ok(
    response.sources.some(
      (source) =>
        source.type === 'thesis' &&
        source.id === 'thesis_latest' &&
        source.excerpt?.includes('BTC remains constructive'),
    ),
  );
  assert.ok(
    response.sources.some(
      (source) =>
        source.type === 'continuity_entry' &&
        source.id === 'continuity_latest',
    ),
  );
  assert.ok(
    response.sources.some(
      (source) => source.type === 'scenario' && source.id === 'scenario_breakout',
    ),
  );
});

test('research chat falls back to latest workspace thesis when symbol has no exact artifacts', async () => {
  const journal = new ResearchChatFakeJournal();
  journal.theses.push({
    id: 'thesis_eth',
    workspace_id: 'workspace_a',
    research_run_id: 'run_eth',
    symbol: 'ETH/USDT',
    direction: 'watch',
    confidence: 0.61,
    created_at: '2026-06-04T09:00:00.000Z',
    thesis_text: 'ETH remains range-bound while flows are mixed.',
  });
  journal.researchRuns.push({
    id: 'run_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'completed',
    completed_at: '2026-06-04T09:05:00.000Z',
    thesis_id: 'thesis_eth',
  });

  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'viewer' },
  ]);
  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const service = new ResearchChatService(retriever, auth, workspaces);

  const response = await service.ask(
    {
      symbol: 'BTC/USDT',
      message: 'What is the current thesis?',
      scope: 'latest',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.context.symbol, 'ETH/USDT');
  assert.match(response.answer, /ETH remains range-bound/);
  assert.ok(response.sources.some((source) => source.id === 'thesis_eth'));
});

class ResearchChatFakeJournal implements Partial<JournalRepository> {
  readonly theses: JsonRecord[] = [];
  readonly researchRuns: JsonRecord[] = [];
  readonly continuityEntries: JsonRecord[] = [];
  readonly scenarios = new Map<string, JsonRecord[]>();
  readonly alerts: JsonRecord[] = [];
  readonly marketSnapshots: JsonRecord[] = [];
  readonly signalSnapshots: JsonRecord[] = [];
  continuityState: JsonRecord | null = null;

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return this.theses
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async listResearchRuns(
    filters: { symbol?: string; status?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.researchRuns
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) => !filters.symbol || run.symbol === filters.symbol)
      .filter((run) => !filters.status || run.status === filters.status)
      .sort((left, right) =>
        String(right.completed_at ?? '').localeCompare(String(left.completed_at ?? '')),
      )
      .slice(0, filters.limit);
  }

  async getResearchRun(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return (
      this.researchRuns.find(
        (run) => run.workspace_id === workspaceId && run.id === id,
      ) ?? null
    );
  }

  async getResearchContinuityState(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.continuityState?.workspace_id === workspaceId &&
      this.continuityState.symbol === symbol
      ? this.continuityState
      : null;
  }

  async listResearchContinuityEntriesBySymbol(
    symbol: string,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.continuityEntries
      .filter((entry) => entry.workspace_id === workspaceId && entry.symbol === symbol)
      .sort((left, right) =>
        String(right.generated_at ?? '').localeCompare(String(left.generated_at ?? '')),
      )
      .slice(0, limit);
  }

  async listScenarios(thesisId: string, workspaceId: string): Promise<JsonRecord[]> {
    return (this.scenarios.get(thesisId) ?? []).filter(
      (scenario) => scenario.workspace_id === workspaceId,
    );
  }

  async listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    void unreadOnly;
    return this.alerts
      .filter((alert) => alert.workspace_id === workspaceId)
      .filter((alert) => !symbol || alert.symbol === symbol)
      .filter((alert) => !thesisId || alert.thesis_id === thesisId)
      .slice(0, limit);
  }

  async getLatestMarketSnapshot(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.marketSnapshots.find(
        (snapshot) => snapshot.workspace_id === workspaceId && snapshot.symbol === symbol,
      ) ?? null
    );
  }

  async getSignalSnapshot(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return (
      this.signalSnapshots.find(
        (snapshot) => snapshot.workspace_id === workspaceId && snapshot.id === id,
      ) ?? null
    );
  }
}
