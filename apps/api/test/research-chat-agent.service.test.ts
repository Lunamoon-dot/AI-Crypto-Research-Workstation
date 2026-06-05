import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalRepository, JsonRecord } from '../src/database/journal.types';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
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
  const captured = { input: null as ResearchChatSynthesisInput | null };
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      captured.input = input;
      return 'Chào bạn, mình là Luna Research Agent.';
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
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
  assert.ok(captured.input);
  const capturedGreetingInput = captured.input;
  assert.equal(capturedGreetingInput.message, 'hello');
  assert.equal(capturedGreetingInput.symbol, 'global');
  assert.equal(capturedGreetingInput.sources.length, 0);
  assert.match(events.at(-1)?.content ?? '', /Luna Research Agent/i);
});

test('research chat agent answers model questions without pulling research artifacts', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_text: 'BTC thesis should not be included in model identity answers.',
    created_at: '2026-06-04T08:00:00.000Z',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const captured = { input: null as ResearchChatSynthesisInput | null };
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      captured.input = input;
      return 'Mình đang dùng DeepSeek qua cấu hình research chat.';
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      message: 'bạn đang dùng model j',
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
  assert.ok(captured.input);
  const capturedModelInput = captured.input;
  assert.equal(capturedModelInput.symbol, 'global');
  assert.equal(capturedModelInput.sources.length, 0);
  assert.equal(capturedModelInput.context.latest_thesis, null);
  assert.doesNotMatch(events.at(-1)?.content ?? '', /BTC thesis should not be included/);
});

test('research chat agent inspects workspace artifacts for database access questions', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push(
    {
      id: 'thesis_btc',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      thesis_text: 'BTC constructive while spot demand holds.',
      created_at: '2026-06-04T08:00:00.000Z',
    },
    {
      id: 'thesis_eth',
      workspace_id: 'workspace_a',
      symbol: 'ETH/USDT',
      thesis_text: 'ETH constructive while L2 flows improve.',
      created_at: '2026-06-04T09:00:00.000Z',
    },
  );
  journal.researchRuns.push({
    id: 'run_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'completed',
    completed_at: '2026-06-04T09:05:00.000Z',
    thesis_id: 'thesis_eth',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const captured = { input: null as ResearchChatSynthesisInput | null };
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      captured.input = input;
      return `Workspace has ${input.sources.length} source refs for ${input.symbol}.`;
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      message: 'tôi tưởng bạn được quyền truy cập vô database',
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

  assert.ok(events.some((event) => event.type === 'tool_call'));
  assert.ok(events.some((event) => event.type === 'rag_sources'));
  assert.ok(captured.input);
  assert.equal(captured.input.symbol, 'global');
  assert.equal(captured.input.context.symbol, 'global');
  assert.ok(captured.input.sources.some((source) => source.id === 'thesis_btc'));
  assert.ok(captured.input.sources.some((source) => source.id === 'thesis_eth'));
  assert.match(events.at(-1)?.content ?? '', /source refs/);
});

test('research chat agent treats short corrections as research follow-ups', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    thesis_text: 'ETH thesis exists and should be retrieved.',
    created_at: '2026-06-04T09:00:00.000Z',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      return `${input.symbol}: ${String(input.context.latest_thesis?.thesis_text)}`;
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      symbol: 'ETH/USDT',
      message: 'có mà',
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

  assert.ok(events.some((event) => event.type === 'tool_call'));
  assert.equal(events.at(-1)?.context?.symbol, 'ETH/USDT');
  assert.equal(events.at(-1)?.sources?.[0]?.id, 'thesis_eth');
  assert.match(events.at(-1)?.content ?? '', /ETH thesis exists/);
});

test('research chat agent resolves explicit message symbol over default scope', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push(
    {
      id: 'thesis_btc',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      thesis_text: 'BTC thesis should not answer an ETH question.',
      created_at: '2026-06-04T08:00:00.000Z',
    },
    {
      id: 'thesis_eth',
      workspace_id: 'workspace_a',
      symbol: 'ETH/USDT',
      thesis_text: 'ETH constructive while L2 flows improve.',
      created_at: '2026-06-04T09:00:00.000Z',
    },
  );

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      return `Agent answer for ${input.symbol}: ${String(input.context.latest_thesis?.thesis_text)}`;
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      symbol: 'BTC/USDT',
      message: 'What is the current ETH thesis?',
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

  const final = events.at(-1);
  assert.equal(final?.context?.symbol, 'ETH/USDT');
  assert.equal(final?.sources?.[0]?.id, 'thesis_eth');
  assert.match(final?.content ?? '', /ETH constructive/);
  assert.doesNotMatch(final?.content ?? '', /BTC thesis should not answer/);
});

test('research chat agent routes explicit symbol questions to matching fixed workspace', async () => {
  const journal = new AgentChatFakeJournal();
  journal.theses.push({
    id: 'thesis_eth',
    workspace_id: 'workspace_eth',
    symbol: 'ETH/USDT',
    thesis_text: 'ETH stream thesis exists in the ETH workspace.',
    created_at: '2026-06-04T09:00:00.000Z',
  });
  journal.researchRuns.push({
    id: 'run_eth',
    workspace_id: 'workspace_eth',
    symbol: 'ETH/USDT',
    status: 'completed',
    completed_at: '2026-06-04T09:05:00.000Z',
    thesis_id: 'thesis_eth',
  });

  const retriever = new ResearchChatRetriever(journal as unknown as JournalRepository);
  const tools = new ResearchChatTools(retriever);
  const memory = new ResearchChatMemoryRepository('');
  const llm = {
    async synthesize(input: ResearchChatSynthesisInput) {
      return `Agent answer for ${input.symbol}: ${String(input.context.latest_thesis?.thesis_text)}`;
    },
  } as ResearchChatLlmService;
  const workspaces = new WorkspacesService();
  workspaces.setWorkspaceMetadataForTest([
    {
      id: 'workspace_eth',
      name: 'eth workspace',
      scope_type: 'fixed_symbol',
      symbol: 'ETH/USDT',
      market_type: 'spot',
      default_timeframe: null,
      archived: false,
      created_at: '2026-06-04T00:00:00.000Z',
      updated_at: '2026-06-04T00:00:00.000Z',
    },
  ]);
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'local', role: 'viewer' },
    { user_id: 'user_1', workspace_id: 'workspace_eth', role: 'viewer' },
  ]);
  const agent = new ResearchChatAgentService(tools, memory, llm, workspaces);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      message: 'What is the latest ETH thesis?',
      scope: 'latest',
      mode: 'agent',
      useMemory: true,
      useRag: true,
    },
    'local',
    'user_1',
    (event) => {
      events.push(event);
    },
  );

  const final = events.at(-1);
  assert.equal(final?.context?.symbol, 'ETH/USDT');
  assert.equal(final?.sources?.[0]?.id, 'thesis_eth');
  assert.match(final?.content ?? '', /ETH stream thesis exists/);
});

test('research chat agent does not fall back to BTC when explicit ETH has no artifacts', async () => {
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
      return `${input.symbol}: no structured artifacts were found for this request.`;
    },
  } as ResearchChatLlmService;
  const agent = new ResearchChatAgentService(tools, memory, llm);
  const events: ResearchChatAgentEvent[] = [];

  await agent.run(
    {
      symbol: 'BTC/USDT',
      message: 'Tell me the ETH thesis',
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

  const final = events.at(-1);
  assert.equal(final?.context?.symbol, 'ETH/USDT');
  assert.equal(final?.sources?.length, 0);
  assert.match(final?.content ?? '', /ETH\/USDT/);
  assert.doesNotMatch(final?.content ?? '', /BTC constructive/);
});

test('research chat LLM fails fast when no model is configured', async () => {
  const previousProvider = process.env.RESEARCH_CHAT_LLM_PROVIDER;
  const previousTradingProvider = process.env.TRADINGAGENTS_LLM_PROVIDER;
  const previousModel = process.env.RESEARCH_CHAT_LLM_MODEL;
  const previousTradingModel = process.env.TRADINGAGENTS_QUICK_THINK_LLM;
  delete process.env.RESEARCH_CHAT_LLM_PROVIDER;
  delete process.env.TRADINGAGENTS_LLM_PROVIDER;
  delete process.env.RESEARCH_CHAT_LLM_MODEL;
  delete process.env.TRADINGAGENTS_QUICK_THINK_LLM;
  try {
    const llm = new ResearchChatLlmService();
    await assert.rejects(
      () =>
        llm.synthesize({
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
            workspace_inventory: {
              symbols: [],
              thesis_count: 0,
              run_count: 0,
              completed_run_count: 0,
              alert_count: 0,
              scenario_count: 0,
              market_snapshot_count: 0,
              signal_snapshot_count: 0,
            },
            global_artifacts: {
              latest_theses: [],
              recent_runs: [],
              latest_alerts: [],
              active_scenarios: [],
              market_snapshots: [],
              signal_snapshots: [],
            },
          },
        }),
      /Research chat LLM is not configured/,
    );
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
    if (previousModel === undefined) {
      delete process.env.RESEARCH_CHAT_LLM_MODEL;
    } else {
      process.env.RESEARCH_CHAT_LLM_MODEL = previousModel;
    }
    if (previousTradingModel === undefined) {
      delete process.env.TRADINGAGENTS_QUICK_THINK_LLM;
    } else {
      process.env.TRADINGAGENTS_QUICK_THINK_LLM = previousTradingModel;
    }
  }
});

test('research chat LLM tells the provider which model is backing the agent', async () => {
  const previousProvider = process.env.RESEARCH_CHAT_LLM_PROVIDER;
  const previousModel = process.env.RESEARCH_CHAT_LLM_MODEL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = globalThis.fetch;
  const captured = { requestBody: null as Record<string, unknown> | null };

  process.env.RESEARCH_CHAT_LLM_PROVIDER = 'deepseek';
  process.env.RESEARCH_CHAT_LLM_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = (async (_url, init) => {
    captured.requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const llm = new ResearchChatLlmService();
    await llm.synthesize({
      symbol: 'BTC/USDT',
      message: 'bạn đang dùng model j',
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
        workspace_inventory: {
          symbols: [],
          thesis_count: 0,
          run_count: 0,
          completed_run_count: 0,
          alert_count: 0,
          scenario_count: 0,
          market_snapshot_count: 0,
          signal_snapshot_count: 0,
        },
        global_artifacts: {
          latest_theses: [],
          recent_runs: [],
          latest_alerts: [],
          active_scenarios: [],
          market_snapshots: [],
          signal_snapshots: [],
        },
      },
    });

    assert.ok(captured.requestBody);
    const capturedRequest = captured.requestBody;
    const messages = capturedRequest.messages as Array<{ content: string }>;
    assert.equal(capturedRequest.model, 'deepseek-chat');
    assert.match(messages[0].content, /provider deepseek/i);
    assert.match(messages[0].content, /model deepseek-chat/i);
    assert.match(messages[0].content, /concise/i);
    assert.match(messages[0].content, /greetings or small talk/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) {
      delete process.env.RESEARCH_CHAT_LLM_PROVIDER;
    } else {
      process.env.RESEARCH_CHAT_LLM_PROVIDER = previousProvider;
    }
    if (previousModel === undefined) {
      delete process.env.RESEARCH_CHAT_LLM_MODEL;
    } else {
      process.env.RESEARCH_CHAT_LLM_MODEL = previousModel;
    }
    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey;
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
