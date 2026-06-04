import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalRepository, JsonRecord } from '../src/database/journal.types';
import { ResearchChatAgentService } from '../src/research-chat/research-chat-agent.service';
import {
  ResearchChatLlmService,
  type ResearchChatSynthesisInput,
} from '../src/research-chat/research-chat-llm.service';
import { ResearchChatMemoryRepository } from '../src/research-chat/research-chat-memory.repository';
import { ResearchChatRetriever } from '../src/research-chat/research-chat-retriever';
import { ResearchChatTools } from '../src/research-chat/research-chat-tools';
import type {
  ResearchChatAgentEvent,
} from '../src/research-chat/dto/research-chat.dto';

test('research chat tools propagate structured sources', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_text: 'BTC constructive while spot demand holds.',
    created_at: '2026-06-04T08:00:00.000Z',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);

  const result = await tools.retrieveStructuredResearch(
    'workspace_a',
    'BTC/USDT',
    'What is the current BTC thesis?',
  );

  assert.equal(result.intent, 'thesis');
  assert.ok(
    result.sources.some(
      (source) => source.type === 'thesis' && source.id === 'thesis_btc',
    ),
  );
});

test('research chat memory saves and recalls workspace notes', async () => {
  const memory = new ResearchChatMemoryRepository('');
  await memory.save({
    workspaceId: 'workspace_a',
    userId: 'user_1',
    symbol: 'BTC/USDT',
    content: 'I prefer BTC answers to include invalidation levels.',
    category: 'preference',
  });

  const memories = await memory.recall(
    'workspace_a',
    'BTC/USDT',
    'Explain BTC invalidation levels',
  );

  assert.equal(memories.length, 1);
  assert.match(memories[0].content, /invalidation levels/);
});

test('research chat agent emits stream events in agent run order', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_text: 'BTC constructive while spot demand holds.',
    created_at: '2026-06-04T08:00:00.000Z',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      return `Agent answer for ${input.symbol} with ${input.sources.length} sources.`;
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      symbol: 'BTC/USDT',
      message: 'What is the current BTC thesis?',
      scope: 'latest',
      mode: 'agent',
      useMemory: true,
      useRag: true,
    },
    'workspace_a',
    'user_1',
    (event) => {
      events.push(event);
    },
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'run_started',
      'memory_used',
      'tool_call',
      'tool_result',
      'rag_sources',
      'delta',
      'final',
    ],
  );
  assert.equal(events.at(-1)?.sources?.[0]?.id, 'thesis_btc');
});

test('research chat agent answers casual greetings without forcing research RAG', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_text: 'BTC constructive while spot demand holds.',
    created_at: '2026-06-04T08:00:00.000Z',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const llm = {
    async synthesize() {
      throw new Error('casual greeting should not call research synthesis');
    },
  } as unknown as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      symbol: 'BTC/USDT',
      message: 'hello',
      scope: 'latest',
      mode: 'agent',
      useMemory: true,
      useRag: true,
    },
    'workspace_a',
    'user_1',
    (event) => {
      events.push(event);
    },
  );

  assert.ok(!events.some((event) => event.type === 'tool_call'));
  assert.equal(events.at(-1)?.type, 'final');
  assert.equal(events.at(-1)?.sources?.length, 0);
  assert.match(events.at(-1)?.content ?? '', /Luna Research Agent/i);
});

test('research chat LLM fallback explains missing artifacts without fake sources', async () => {
  const previousProvider = process.env.RESEARCH_CHAT_LLM_PROVIDER;
  const previousTradingProvider = process.env.TRADINGAGENTS_LLM_PROVIDER;
  delete process.env.RESEARCH_CHAT_LLM_PROVIDER;
  delete process.env.TRADINGAGENTS_LLM_PROVIDER;
  try {
    const llm = new ResearchChatLlmService();
    const answer = await llm.synthesize({
      symbol: 'BTC/USDT',
      message: 'BTC thesis?',
      memories: [],
      sources: [],
      context: {
        symbol: 'BTC/USDT',
        latest_thesis: null,
        latest_run: null,
        previous_run: null,
        continuity_state: null,
        recent_continuity_entries: [],
        active_scenarios: [],
        latest_alerts: [],
        market_snapshot: null,
        signal_snapshot: null,
      },
    });

    assert.match(answer, /does not have enough saved research artifacts/i);
    assert.match(answer, /Missing likely data/i);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.RESEARCH_CHAT_LLM_PROVIDER;
    } else {
      process.env.RESEARCH_CHAT_LLM_PROVIDER = previousProvider;
    }
    if (previousTradingProvider === undefined) {
      delete process.env.TRADINGAGENTS_LLM_PROVIDER;
    } else {
      process.env.TRADINGAGENTS_LLM_PROVIDER = previousTradingProvider;
    }
  }
});

class AgentChatFakeJournal implements Partial<JournalRepository> {
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
      .slice(0, filters.limit);
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
