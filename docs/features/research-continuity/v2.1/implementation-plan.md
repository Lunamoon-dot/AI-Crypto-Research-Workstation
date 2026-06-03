# Research Continuity V2.1 Engine Prior Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a compact latest Research Continuity prior into new research runs so the Portfolio Manager can explain whether the current thesis continues, weakens, invalidates, or supersedes the prior thesis.

**Architecture:** Build a compact `latest_continuity_context` in the API before the Python engine starts, pass it through `EngineRunRequest.metadata`, copy it from `_engine.metadata` into the LangGraph `AgentState`, and render it only inside the Portfolio Manager prompt. Treat continuity as prior memory, not current evidence; analyst reports and risk debate remain the current evidence layer.

**Tech Stack:** NestJS API, TypeScript contract tests, Python LangGraph state, Pydantic/typed agent output, pytest.

---

## Scope

V2.1 adds a bounded prior-memory injection path. It does not change the append-only continuity ledger, continuity state schema, snapshot builder, delta engine, state projector, scheduler, or UI.

The source of truth remains the Research Continuity ledger. `latest_continuity_context` is a compact read model for the next engine run.

## Non-Goals

- Do not inject continuity into News, Market, Onchain, or Sentiment Analysts.
- Do not inject full continuity reports.
- Do not change the DB unique key from `workspace_id + symbol`.
- Do not let continuity override current analyst reports or risk debate.
- Do not use an LLM to create continuity source-of-truth events.
- Do not create a new public API endpoint.

## File Map

- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
  - Add `buildEngineContinuityContext()` and compact continuity helpers.
- Modify: `apps/api/src/jobs/research-job.processor.ts`
  - Enrich the engine request metadata before `PythonEngineClient.runInline()`.
- Modify: `apps/api/test/api-contract.test.ts`
  - Add contract tests for context building, metadata enrichment, market type guard, and no-state fallback.
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
  - Add `latest_continuity_context` to `AgentState`.
- Modify: `apps/ai-service/luna_workstation/graph/propagation.py`
  - Initialize `latest_continuity_context`.
- Modify: `apps/ai-service/luna_workstation/graph/protocols.py`
  - Keep protocol typing aligned with `Propagator.create_initial_state()`.
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
  - Read metadata from `host.config["_engine"]["metadata"]` and pass compact continuity into initial state.
- Modify: `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`
  - Render guarded prior continuity block in the Portfolio Manager prompt.
- Modify: `apps/ai-service/luna_workstation/agents/schemas.py`
  - Allow `research_continuity` as a `source_artifact` prompt option if the PM cites prior memory.
- Modify: `apps/ai-service/tests/test_engine_contract.py`
  - Verify metadata passthrough remains JSON-safe and available to runtime config.
- Modify: `apps/ai-service/tests/test_graph_state.py` or create it if missing
  - Verify initial state carries `latest_continuity_context`.
- Modify: `apps/ai-service/tests/test_portfolio_manager.py` or create it if missing
  - Verify Portfolio Manager prompt includes guarded continuity context and current-evidence guardrails.
- Modify: `docs/features/research-continuity/README.md`
  - Add the V2.1 version link after implementation.

## Data Shape

Use this compact metadata shape:

```ts
export interface EngineLatestContinuityContext {
  schema_version: 'latest_continuity_context.v1';
  workspace_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  latest_entry_id: string | null;
  latest_run_id: string | null;
  generated_at: string | null;
  staleness: {
    age_hours: number | null;
    is_stale: boolean;
    reason: string | null;
  };
  quality: {
    status: string;
    score: number | null;
    observed_evidence_coverage: number | null;
    warnings: string[];
  };
  prior_view: {
    directional_bias: string | null;
    risk_posture: string | null;
    conviction: string | null;
    time_context: string | null;
  };
  active_thesis_items: string[];
  active_risks: string[];
  active_watchpoints: string[];
  active_invalidations: string[];
  recent_resolved_items: string[];
  recent_invalidated_items: string[];
  summary: string;
}
```

Size limits:

- `active_thesis_items`: max 8
- `active_risks`: max 3
- `active_watchpoints`: max 3
- `active_invalidations`: max 3
- `recent_resolved_items`: max 2
- `recent_invalidated_items`: max 2
- each item string: max 240 characters
- `summary`: max 800 characters

---

### Task 1: API Continuity Context Builder

**Files:**
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write the failing API service test**

Add this test near existing Research Continuity tests in `apps/api/test/api-contract.test.ts`:

```ts
test('research continuity builds compact engine prior context for matching market type', async () => {
  const { researchContinuity, journal } = createResearchContinuityHarness();
  journal.researchRuns.set(key('run_prior_spot', 'workspace_a'), {
    id: 'run_prior_spot',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    status: 'completed',
    created_at: '2026-06-02T00:00:00.000Z',
    completed_at: '2026-06-02T00:10:00.000Z',
    payload: {},
  });
  journal.continuityStates.set(key('BTC/USDT', 'workspace_a'), {
    id: 'state_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    latest_entry_id: 'continuity_prior_spot',
    updated_at: '2026-06-02T00:11:00.000Z',
    payload: {
      current_view: {
        directional_bias: 'bullish continuation while above prior invalidation',
        risk_posture: 'moderate',
        conviction: 'medium',
        time_context: 'daily swing',
      },
      active_items: [
        { item_type: 'claim', text: 'BTC momentum remains constructive above 67000.' },
        { item_type: 'risk', text: 'ETF flow reversal could weaken the thesis.' },
        { item_type: 'watchpoint', text: 'Watch daily close above 70000.' },
        { item_type: 'invalidation', text: 'Invalidate below 65000 on volume.' },
      ],
      recent_resolved_items: [
        { text: 'Funding normalized after prior squeeze.' },
      ],
      recent_invalidated_items: [
        { text: 'Old range breakout level no longer applies.' },
      ],
      data_quality: {
        status: 'completed',
        score: 0.82,
        observed_evidence_coverage: 0.7,
        warnings: ['limited weekend liquidity evidence'],
      },
    },
  });
  journal.continuityEntries.set(key('continuity_prior_spot', 'workspace_a'), {
    id: 'continuity_prior_spot',
    workspace_id: 'workspace_a',
    research_run_id: 'run_prior_spot',
    symbol: 'BTC/USDT',
    entry_type: 'delta',
    status: 'completed',
    generated_at: '2026-06-02T00:11:00.000Z',
    summary: 'Prior thesis stayed bullish but required volume confirmation.',
    payload: { schema_version: 'research_continuity_entry.v1.1' },
  });

  const context = await researchContinuity.buildEngineContinuityContext(
    'BTCUSDT',
    'workspace_a',
    'spot',
  );

  assert.equal(context?.schema_version, 'latest_continuity_context.v1');
  assert.equal(context?.workspace_id, 'workspace_a');
  assert.equal(context?.symbol, 'BTC/USDT');
  assert.equal(context?.market_type, 'spot');
  assert.equal(context?.latest_entry_id, 'continuity_prior_spot');
  assert.equal(context?.latest_run_id, 'run_prior_spot');
  assert.equal(context?.prior_view.directional_bias, 'bullish continuation while above prior invalidation');
  assert.deepEqual(context?.active_thesis_items, ['BTC momentum remains constructive above 67000.']);
  assert.deepEqual(context?.active_risks, ['ETF flow reversal could weaken the thesis.']);
  assert.deepEqual(context?.active_watchpoints, ['Watch daily close above 70000.']);
  assert.deepEqual(context?.active_invalidations, ['Invalidate below 65000 on volume.']);
  assert.equal(context?.quality.status, 'completed');
  assert.equal(context?.summary, 'Prior thesis stayed bullish but required volume confirmation.');
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: FAIL because `buildEngineContinuityContext` does not exist.

- [ ] **Step 3: Add the public internal service method**

In `apps/api/src/research-continuity/research-continuity.service.ts`, add this method inside `ResearchContinuityService` after `getSymbolState()`:

```ts
  async buildEngineContinuityContext(
    symbol: string,
    workspaceId: string,
    marketType: 'spot' | 'perp' | string,
  ): Promise<JsonRecord | null> {
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const normalizedMarketType = normalizeEngineMarketType(marketType);
    const state = await this.journal.getResearchContinuityState(
      normalizedSymbol,
      workspaceId,
    );
    const latestEntryId = nullableString(state?.latest_entry_id);
    if (!state || !latestEntryId) {
      return null;
    }
    const latestEntry = await this.journal.getResearchContinuityEntry(
      latestEntryId,
      workspaceId,
    );
    if (!latestEntry) {
      return null;
    }
    const latestRunId = nullableString(latestEntry.research_run_id);
    const latestRun = latestRunId
      ? await this.journal.getResearchRun(latestRunId, workspaceId)
      : null;
    if (!engineRunMatchesContext(latestRun, normalizedSymbol, normalizedMarketType)) {
      return null;
    }
    return buildLatestContinuityContext({
      state,
      latestEntry,
      latestRun,
      marketType: normalizedMarketType,
      workspaceId,
      symbol: normalizedSymbol,
    });
  }
```

- [ ] **Step 4: Add compact builder helpers**

In the same file near the existing helper functions, add:

```ts
function normalizeEngineMarketType(value: unknown): 'spot' | 'perp' {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['perp', 'perpetual', 'future', 'futures'].includes(normalized)
    ? 'perp'
    : 'spot';
}

function engineRunMatchesContext(
  run: JsonRecord | null,
  symbol: string,
  marketType: 'spot' | 'perp',
): boolean {
  if (!run) {
    return false;
  }
  const runSymbol = normalizeContinuitySymbol(String(run.symbol ?? ''));
  const runMarketType = normalizeEngineMarketType(run.market_type);
  return runSymbol === symbol && runMarketType === marketType;
}

function buildLatestContinuityContext(input: {
  state: JsonRecord;
  latestEntry: JsonRecord;
  latestRun: JsonRecord | null;
  marketType: 'spot' | 'perp';
  workspaceId: string;
  symbol: string;
}): JsonRecord {
  const payload = recordValue(input.state.payload);
  const quality = recordValue(payload.data_quality);
  const currentView = recordValue(payload.current_view);
  const activeItems = arrayValue(payload.active_items);
  const generatedAt = nullableString(input.latestEntry.generated_at);
  return {
    schema_version: 'latest_continuity_context.v1',
    workspace_id: input.workspaceId,
    symbol: input.symbol,
    market_type: input.marketType,
    latest_entry_id: nullableString(input.latestEntry.id),
    latest_run_id: nullableString(input.latestRun?.id),
    generated_at: generatedAt,
    staleness: continuityStaleness(generatedAt),
    quality: {
      status: stringValue(quality.status, stringValue(input.latestEntry.status, 'unknown')),
      score: numberOrNull(quality.score),
      observed_evidence_coverage: numberOrNull(quality.observed_evidence_coverage),
      warnings: compactStringArray(quality.warnings, 5),
    },
    prior_view: {
      directional_bias: nullableString(currentView.directional_bias),
      risk_posture: nullableString(currentView.risk_posture),
      conviction: nullableString(currentView.conviction),
      time_context: nullableString(currentView.time_context),
    },
    active_thesis_items: compactContinuityItems(activeItems, ['claim'], 8),
    active_risks: compactContinuityItems(activeItems, ['risk'], 3),
    active_watchpoints: compactContinuityItems(activeItems, ['watchpoint'], 3),
    active_invalidations: compactContinuityItems(activeItems, ['invalidation'], 3),
    recent_resolved_items: compactContinuityItems(arrayValue(payload.recent_resolved_items), [], 2),
    recent_invalidated_items: compactContinuityItems(arrayValue(payload.recent_invalidated_items), [], 2),
    summary: truncateText(stringValue(input.latestEntry.summary, ''), 800),
  };
}

function continuityStaleness(generatedAt: string | null): JsonRecord {
  if (!generatedAt) {
    return { age_hours: null, is_stale: true, reason: 'missing_generated_at' };
  }
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) {
    return { age_hours: null, is_stale: true, reason: 'invalid_generated_at' };
  }
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  return {
    age_hours: Math.round(ageHours * 10) / 10,
    is_stale: ageHours > 72,
    reason: ageHours > 72 ? 'older_than_72h' : null,
  };
}

function compactContinuityItems(
  values: unknown[],
  allowedTypes: string[],
  limit: number,
): string[] {
  const items: string[] = [];
  for (const value of values) {
    const record = recordValue(value);
    const itemType = String(record.item_type ?? record.type ?? '').trim().toLowerCase();
    if (allowedTypes.length > 0 && !allowedTypes.includes(itemType)) {
      continue;
    }
    const text = truncateText(stringValue(record.text, stringValue(record.title, '')), 240);
    if (text && !items.includes(text)) {
      items.push(text);
    }
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

function compactStringArray(value: unknown, limit: number): string[] {
  return arrayValue(value)
    .map((item) => truncateText(String(item ?? '').trim(), 240))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : normalized;
}
```

- [ ] **Step 5: Run the test**

Run:

```bash
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: PASS for the new context-builder test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/research-continuity/research-continuity.service.ts apps/api/test/api-contract.test.ts
git commit -m "feat(api): build engine continuity prior context"
```

### Task 2: API Engine Request Enrichment

**Files:**
- Modify: `apps/api/src/jobs/research-job.processor.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write the failing processor test**

Add this test near existing `ResearchJobProcessor` tests:

```ts
test('ResearchJobProcessor injects latest continuity context before engine run', async () => {
  const engineRequests: EngineRunRequest[] = [];
  const processor = new ResearchJobProcessor(
    {
      runInline: async (request: EngineRunRequest) => {
        engineRequests.push(request);
        return {
          status: 'completed',
          run_id: request.run_id,
          workspace_id: request.workspace_id,
        };
      },
    } as unknown as PythonEngineClient,
    new JobLifecycleService(),
    undefined,
    {
      generateForCompletedRun: async () => null,
      buildEngineContinuityContext: async () => ({
        schema_version: 'latest_continuity_context.v1',
        workspace_id: 'workspace_a',
        symbol: 'BTC/USDT',
        market_type: 'spot',
        latest_entry_id: 'continuity_prior',
        latest_run_id: 'run_prior',
        generated_at: '2026-06-02T00:11:00.000Z',
        staleness: { age_hours: 12, is_stale: false, reason: null },
        quality: {
          status: 'completed',
          score: 0.82,
          observed_evidence_coverage: 0.7,
          warnings: [],
        },
        prior_view: {
          directional_bias: 'bullish',
          risk_posture: 'moderate',
          conviction: 'medium',
          time_context: 'daily swing',
        },
        active_thesis_items: ['BTC holds constructive momentum.'],
        active_risks: [],
        active_watchpoints: [],
        active_invalidations: [],
        recent_resolved_items: [],
        recent_invalidated_items: [],
        summary: 'Prior thesis remains valid.',
      }),
    } as unknown as ResearchContinuityService,
  );

  await processor.process(engineRequest('run_with_continuity'), {
    jobId: 'run_with_continuity',
    backend: 'memory',
    attempt: 1,
    maxAttempts: 1,
  });

  assert.equal(engineRequests.length, 1);
  assert.equal(
    record(record(engineRequests[0].metadata).latest_continuity_context).latest_entry_id,
    'continuity_prior',
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: FAIL because `ResearchJobProcessor` passes the original request.

- [ ] **Step 3: Enrich request before Python engine execution**

In `apps/api/src/jobs/research-job.processor.ts`, change `runEngineAndSync()` and add `withContinuityContext()`:

```ts
  private async runEngineAndSync(
    request: EngineRunRequest,
    signal: AbortSignal,
  ): Promise<JsonRecord> {
    const enrichedRequest = await this.withContinuityContext(request);
    const result = await this.pythonEngine.runInline(enrichedRequest, { signal });
    await this.lifecycle.heartbeat(request.run_id, { phase: 'postgres_sync' });
    const sync = await this.syncRun(request, result);
    return sync
      ? ({
          ...result,
          postgres_sync: sync,
        } satisfies JsonRecord)
      : result;
  }

  private async withContinuityContext(
    request: EngineRunRequest,
  ): Promise<EngineRunRequest> {
    const latest = await this.continuity?.buildEngineContinuityContext(
      request.symbol,
      request.workspace_id,
      request.market_type,
    );
    if (!latest) {
      return request;
    }
    return {
      ...request,
      metadata: {
        ...(request.metadata ?? {}),
        latest_continuity_context: latest,
      },
    };
  }
```

- [ ] **Step 4: Add no-state preservation test**

Add this test:

```ts
test('ResearchJobProcessor leaves metadata unchanged when continuity context is unavailable', async () => {
  const engineRequests: EngineRunRequest[] = [];
  const processor = new ResearchJobProcessor(
    {
      runInline: async (request: EngineRunRequest) => {
        engineRequests.push(request);
        return {
          status: 'completed',
          run_id: request.run_id,
          workspace_id: request.workspace_id,
        };
      },
    } as unknown as PythonEngineClient,
    new JobLifecycleService(),
    undefined,
    {
      generateForCompletedRun: async () => null,
      buildEngineContinuityContext: async () => null,
    } as unknown as ResearchContinuityService,
  );
  const request = {
    ...engineRequest('run_without_continuity'),
    metadata: { existing: 'kept' },
  };

  await processor.process(request, {
    jobId: 'run_without_continuity',
    backend: 'memory',
    attempt: 1,
    maxAttempts: 1,
  });

  assert.deepEqual(engineRequests[0].metadata, { existing: 'kept' });
});
```

- [ ] **Step 5: Run API contract tests**

Run:

```bash
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobs/research-job.processor.ts apps/api/test/api-contract.test.ts
git commit -m "feat(api): inject continuity prior into engine metadata"
```

### Task 3: Python AgentState Propagation

**Files:**
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
- Modify: `apps/ai-service/luna_workstation/graph/propagation.py`
- Modify: `apps/ai-service/luna_workstation/graph/protocols.py`
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Test: `apps/ai-service/tests/test_graph_state.py`

- [ ] **Step 1: Write the failing propagation test**

Create `apps/ai-service/tests/test_graph_state.py` if it does not exist:

```python
from luna_workstation.graph.propagation import Propagator


def test_initial_state_carries_latest_continuity_context():
    context = {
        "schema_version": "latest_continuity_context.v1",
        "workspace_id": "workspace_a",
        "symbol": "BTC/USDT",
        "market_type": "spot",
        "summary": "Prior thesis remains valid.",
    }

    state = Propagator().create_initial_state(
        "BTC/USDT",
        "2026-06-03",
        latest_continuity_context=context,
    )

    assert state["latest_continuity_context"] == context
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_graph_state.py -q
```

Expected: FAIL because `create_initial_state()` does not accept `latest_continuity_context`.

- [ ] **Step 3: Add `AgentState` field**

In `apps/ai-service/luna_workstation/agents/utils/agent_states.py`, add this field after `past_context`:

```python
    latest_continuity_context: Annotated[
        dict[str, Any] | None,
        "Compact latest Research Continuity prior for same workspace/symbol/market_type; prior memory only, not current evidence",
    ]
```

- [ ] **Step 4: Update `Propagator.create_initial_state()`**

In `apps/ai-service/luna_workstation/graph/propagation.py`, change the signature:

```python
    def create_initial_state(
        self,
        company_name: str,
        trade_date: str,
        past_context: str = "",
        market_type: str = "spot",
        latest_continuity_context: dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
```

Then add this key to the existing returned dictionary next to `past_context`:

```python
            "latest_continuity_context": latest_continuity_context,
```

Keep all existing return keys unchanged.

- [ ] **Step 5: Update graph protocol typing**

In `apps/ai-service/luna_workstation/graph/protocols.py`, add the same optional parameter to the propagator protocol:

```python
    def create_initial_state(
        self,
        company_name: str,
        trade_date: str,
        past_context: str = "",
        market_type: str = "spot",
        latest_continuity_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError
```

- [ ] **Step 6: Add metadata extraction in run orchestrator**

In `apps/ai-service/luna_workstation/graph/run_orchestrator.py`, add this helper near `_build_symbol_past_context()`:

```python
    def _latest_continuity_context(self, host: Any) -> dict[str, Any] | None:
        metadata = (host.config.get("_engine") or {}).get("metadata") or {}
        if not isinstance(metadata, dict):
            return None
        context = metadata.get("latest_continuity_context")
        return context if isinstance(context, dict) else None
```

Then update the existing `create_initial_state()` call:

```python
        init_agent_state = host.propagator.create_initial_state(
            company_name,
            trade_date,
            past_context=self._build_symbol_past_context(host, company_name),
            market_type=host.config.get("market_type", "spot"),
            latest_continuity_context=self._latest_continuity_context(host),
        )
```

- [ ] **Step 7: Run Python state test**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_graph_state.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/ai-service/luna_workstation/agents/utils/agent_states.py apps/ai-service/luna_workstation/graph/propagation.py apps/ai-service/luna_workstation/graph/protocols.py apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/tests/test_graph_state.py
git commit -m "feat(ai): propagate continuity prior into graph state"
```

### Task 4: Portfolio Manager Prompt Injection

**Files:**
- Modify: `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`
- Modify: `apps/ai-service/luna_workstation/agents/schemas.py`
- Test: `apps/ai-service/tests/test_portfolio_manager.py`

- [ ] **Step 1: Write the failing prompt test**

Create `apps/ai-service/tests/test_portfolio_manager.py` if it does not exist:

```python
from types import SimpleNamespace

from luna_workstation.agents.managers.portfolio_manager import create_portfolio_manager


class CapturingLLM:
    def __init__(self):
        self.prompt = None

    def with_structured_output(self, *_args, **_kwargs):
        raise NotImplementedError("force freetext fallback")

    def invoke(self, prompt):
        self.prompt = prompt
        return SimpleNamespace(content="Hold. Prior thesis remains valid but needs confirmation.")


def test_portfolio_manager_injects_guarded_latest_continuity_context():
    llm = CapturingLLM()
    node = create_portfolio_manager(llm, config={"market_type": "spot"})
    state = {
        "company_of_interest": "BTC/USDT",
        "risk_debate_state": {
            "history": "Risk debate says confirmation is required.",
            "aggressive_history": "",
            "conservative_history": "",
            "neutral_history": "",
            "current_aggressive_response": "",
            "current_conservative_response": "",
            "current_neutral_response": "",
            "count": 1,
        },
        "investment_plan": "Research manager plan.",
        "trader_investment_plan": "Setup planner proposal.",
        "market_type": "spot",
        "past_context": "",
        "latest_continuity_context": {
            "schema_version": "latest_continuity_context.v1",
            "latest_entry_id": "continuity_prior",
            "summary": "Prior thesis remained bullish above 67000.",
            "active_invalidations": ["Invalidate below 65000 on volume."],
        },
    }

    node(state)

    assert "Prior Research Continuity Context" in llm.prompt
    assert "prior memory, not current evidence" in llm.prompt
    assert "Current analyst reports and risk debate win on conflict" in llm.prompt
    assert "continuity_prior" in llm.prompt
    assert "research_continuity" in llm.prompt
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_portfolio_manager.py -q
```

Expected: FAIL because the prompt does not include continuity context.

- [ ] **Step 3: Add compact renderer**

In `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`, add this helper above `create_portfolio_manager()`:

```python
def _render_latest_continuity_context(value) -> str:
    if not isinstance(value, dict):
        return ""
    lines = [
        f"schema_version: {value.get('schema_version', '')}",
        f"latest_entry_id: {value.get('latest_entry_id', '')}",
        f"latest_run_id: {value.get('latest_run_id', '')}",
        f"generated_at: {value.get('generated_at', '')}",
        f"staleness: {value.get('staleness', {})}",
        f"quality: {value.get('quality', {})}",
        f"prior_view: {value.get('prior_view', {})}",
        f"summary: {value.get('summary', '')}",
        f"active_thesis_items: {value.get('active_thesis_items', [])}",
        f"active_risks: {value.get('active_risks', [])}",
        f"active_watchpoints: {value.get('active_watchpoints', [])}",
        f"active_invalidations: {value.get('active_invalidations', [])}",
        f"recent_resolved_items: {value.get('recent_resolved_items', [])}",
        f"recent_invalidated_items: {value.get('recent_invalidated_items', [])}",
    ]
    return "\n".join(lines)
```

- [ ] **Step 4: Inject the guarded prompt block**

Inside `portfolio_manager_node()`, after `lessons_line`, add:

```python
        latest_continuity_context = state.get("latest_continuity_context")
        continuity_text = _render_latest_continuity_context(
            latest_continuity_context
        )
        continuity_line = (
            "**Prior Research Continuity Context:**\n"
            f"{guard_untrusted_context('latest_continuity_context', continuity_text)}\n"
            if continuity_text
            else ""
        )
```

Then add `{continuity_line}` into the prompt after `{lessons_line}` and before `{feedback_context}`.

Add these rules to the Portfolio Manager prompt before the `TRADE_THESIS_JSON` block:

```text
Treat Prior Research Continuity Context as prior memory, not current evidence.
Current analyst reports and risk debate win on conflict.
Use continuity only to explain whether the current thesis continues, weakens, invalidates, or supersedes the prior thesis.
If rating or confidence changes because of continuity, cite that in key_reasons, risks, or monitor_next.
Do not copy stale prior claims as fresh evidence.
```

- [ ] **Step 5: Allow `research_continuity` as cited source artifact**

In `apps/ai-service/luna_workstation/agents/schemas.py`, update any prompt/schema text that enumerates `source_artifact` values for Portfolio Manager output so it includes:

```text
research_continuity
```

The PM JSON prompt line should become:

```json
"source_artifact": "market_snapshot | signal_snapshot | trade_thesis | agent_opinion | research_debate | research_run | research_continuity | external_report | unknown"
```

- [ ] **Step 6: Run the prompt test**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_portfolio_manager.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py apps/ai-service/luna_workstation/agents/schemas.py apps/ai-service/tests/test_portfolio_manager.py
git commit -m "feat(ai): inject continuity prior into portfolio manager"
```

### Task 5: Guardrail Tests For No Analyst Contamination

**Files:**
- Test: `apps/ai-service/tests/test_continuity_prior_guardrails.py`

- [ ] **Step 1: Write guardrail tests**

Create `apps/ai-service/tests/test_continuity_prior_guardrails.py`:

```python
from pathlib import Path


def test_continuity_prior_is_not_injected_into_analyst_files():
    analyst_files = [
        Path("apps/ai-service/luna_workstation/agents/analysts/news_analyst.py"),
        Path("apps/ai-service/luna_workstation/agents/analysts/market_analyst.py"),
        Path("apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py"),
        Path("apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py"),
    ]

    for analyst_file in analyst_files:
        source = analyst_file.read_text(encoding="utf-8")
        assert "latest_continuity_context" not in source
        assert "Prior Research Continuity Context" not in source
```

- [ ] **Step 2: Run the guardrail tests**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_continuity_prior_guardrails.py -q
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/ai-service/tests/test_continuity_prior_guardrails.py
git commit -m "test(ai): guard continuity prior analyst boundary"
```

### Task 6: Full Verification And Docs Link

**Files:**
- Modify: `docs/features/research-continuity/README.md`

- [ ] **Step 1: Add V2.1 README link**

In `docs/features/research-continuity/README.md`, add this row after V2.0:

```markdown
| V2.1 | planned | [v2.1/implementation-plan.md](v2.1/implementation-plan.md) |
```

After implementation is complete and tests pass, change `planned` to `implemented`.

- [ ] **Step 2: Run focused Python tests**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_graph_state.py apps/ai-service/tests/test_portfolio_manager.py apps/ai-service/tests/test_continuity_prior_guardrails.py apps/ai-service/tests/test_engine_contract.py -q
```

Expected: all selected tests pass.

- [ ] **Step 3: Run API contract tests**

Run:

```bash
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: all API contract tests pass.

- [ ] **Step 4: Run focused lint and type checks**

Run:

```bash
.\.venv\Scripts\python.exe -m ruff check apps/ai-service/luna_workstation/agents/utils/agent_states.py apps/ai-service/luna_workstation/graph/propagation.py apps/ai-service/luna_workstation/graph/protocols.py apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py apps/ai-service/luna_workstation/agents/schemas.py apps/ai-service/tests/test_graph_state.py apps/ai-service/tests/test_portfolio_manager.py apps/ai-service/tests/test_continuity_prior_guardrails.py
.\.venv\Scripts\python.exe -m ruff format --check apps/ai-service/luna_workstation/agents/utils/agent_states.py apps/ai-service/luna_workstation/graph/propagation.py apps/ai-service/luna_workstation/graph/protocols.py apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py apps/ai-service/luna_workstation/agents/schemas.py apps/ai-service/tests/test_graph_state.py apps/ai-service/tests/test_portfolio_manager.py apps/ai-service/tests/test_continuity_prior_guardrails.py
corepack pnpm --filter @lunaperception/api typecheck
```

Expected: focused ruff passes and API typecheck passes. If repo-wide Python mypy still reports existing `journal_service.py` errors, document them as pre-existing unless this implementation touched that file.

- [ ] **Step 5: Commit docs and final verification**

```bash
git add docs/features/research-continuity/README.md docs/features/research-continuity/v2.1/implementation-plan.md
git commit -m "docs: plan continuity prior engine injection"
```

## Acceptance Criteria

- New engine requests include `metadata.latest_continuity_context` when a latest state exists for the same `workspace_id`, normalized `symbol`, and `market_type`.
- New engine requests do not include continuity context when no continuity state exists.
- New engine requests do not include continuity context when latest continuity is for a different market type.
- Python graph initial state includes `latest_continuity_context`.
- Portfolio Manager prompt includes guarded prior continuity context only when present.
- News, Market, Onchain, and Sentiment Analysts do not receive continuity context.
- Portfolio Manager prompt states that continuity is prior memory, not current evidence.
- Portfolio Manager prompt states that current analyst reports and risk debate win on conflict.
- PM JSON prompt allows `source_artifact = "research_continuity"` when prior memory affects `key_reasons`, `risks`, or `monitor_next`.
- Existing workflow behavior is preserved when continuity context is missing.

## Review Notes

This plan intentionally starts with Portfolio Manager only. Research Manager injection can be added later if the product needs prior unresolved questions to shape the debate, but doing that in V2.1 would increase the risk of anchoring the debate to stale thesis memory before current evidence has been weighed.
