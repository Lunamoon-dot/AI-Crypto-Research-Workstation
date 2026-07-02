# Luna Crypto Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Odysseus-style AI agent chat for crypto research that can stream responses, use structured RAG, recall/save memory, cite research artifacts, and explain market thesis changes without being a deterministic scripted bot.

**Architecture:** Keep `/research-chat` as a separate full-screen agent workspace, not a Workbench panel. Backend adds a streaming agent run endpoint that coordinates memory, structured research tools, LLM synthesis, citations, and safe crypto guardrails. Vector RAG is deferred until after this structured agent loop is working and verified.

**Tech Stack:** NestJS API, React/Vite web app, existing Luna structured research tables/services, fetch streaming over `ReadableStream`, existing test runners via `corepack pnpm --filter @lunaperception/api test` and `corepack pnpm --filter @lunaperception/web build`.

---

## Product Definition

This is not a programming assistant clone. The persona is **Luna Crypto Research Agent**:

- Helps analyze crypto symbols such as `BTC/USDT`, `ETH/USDT`, scenarios, alerts, signal snapshots, thesis history, continuity deltas, workbench attention, and research runs.
- Answers in an analyst style: current stance, evidence, change from prior state, risks, invalidation, scenarios, confidence, missing data.
- Uses sources from Luna artifacts first. If data is missing, it says exactly which artifact class is missing instead of hallucinating.
- Saves useful user preferences and research memory when explicitly asked or when the user gives stable preference/context.
- Does not place trades, edit thesis, run research jobs, or trigger automated actions in V0.

## Success Criteria

- `/research-chat` visually behaves like a real AI agent chat: sidebar, thread list, streaming assistant messages, bottom composer, source/memory/tool traces.
- A user can ask the five MVP questions:
  - "BTC thesis hiện tại là gì?"
  - "Thesis hôm nay khác run trước chỗ nào?"
  - "Risk nào mới xuất hiện?"
  - "Scenario nào đang active?"
  - "Vì sao hệ thống chuyển bias / conviction?"
- Each answer includes source events and final `sources` when artifacts exist.
- When DB has no thesis/continuity data, the agent still streams a useful explanation and names missing artifact types.
- Memory can be saved and later retrieved in a separate message in the same workspace.
- Existing JSON endpoint remains compatible during migration.
- API tests and web build pass.

## Files To Create Or Modify

### Backend

- Modify: `apps/api/src/research-chat/research-chat.module.ts`
  - Register agent, stream, memory, and tools providers.
- Modify: `apps/api/src/research-chat/research-chat.controller.ts`
  - Keep `POST /research-chat/ask`.
  - Add `POST /research-chat/stream`.
- Modify: `apps/api/src/research-chat/dto/research-chat.dto.ts`
  - Add stream request, agent event, memory, run mode, and tool event types.
- Create: `apps/api/src/research-chat/research-chat-agent.service.ts`
  - Owns the agent run loop and emits stream events.
- Create: `apps/api/src/research-chat/research-chat-stream.writer.ts`
  - Small utility for writing server-sent JSON events over a Nest response.
- Create: `apps/api/src/research-chat/research-chat-tools.ts`
  - Read-only crypto research tools around the existing structured retriever.
- Create: `apps/api/src/research-chat/research-chat-memory.repository.ts`
  - Persists and retrieves V0 memory.
- Create: `apps/api/src/research-chat/research-chat-llm.service.ts`
  - Isolates model selection and prompt construction. If no provider key is configured, returns a non-hallucinated fallback.
- Create: `apps/api/test/research-chat-agent.service.test.ts`
  - Tests streaming event order, memory usage, source propagation, and empty workspace behavior.
- Modify: `apps/api/test/research-chat.service.test.ts`
  - Preserve current structured endpoint tests.

### Frontend

- Modify: `apps/web/src/pages/ResearchChatPage.tsx`
  - Replace one-shot ask UI with streaming agent thread UI.
- Modify: `apps/web/src/services/research-chat.ts`
  - Keep `askResearchChat`.
  - Add `streamResearchChat`.
- Modify: `apps/web/src/types/index.ts`
  - Add stream event/message/session types.
- Modify: `apps/web/src/styles/index.css`
  - Refine standalone agent layout, source drawer, memory/tool event timeline, mobile behavior.
- Optional create after page grows too large:
  - `apps/web/src/pages/research-chat-agent-types.ts`
  - `apps/web/src/pages/research-chat-sidebar.tsx`
  - `apps/web/src/pages/research-chat-message.tsx`
  - `apps/web/src/pages/research-chat-composer.tsx`

---

### Task 1: Define Agent Stream Contract

**Files:**
- Modify: `apps/api/src/research-chat/dto/research-chat.dto.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Add backend stream DTO and event types**

Add these types near the existing research chat DTOs:

```ts
export type ResearchChatRunMode = 'agent' | 'chat';

export type ResearchChatAgentEventType =
  | 'run_started'
  | 'memory_used'
  | 'tool_call'
  | 'tool_result'
  | 'rag_sources'
  | 'delta'
  | 'final'
  | 'error';

export interface ResearchChatMemoryRef {
  id: string;
  label: string;
  content: string;
  category: 'preference' | 'research_note' | 'symbol_context' | 'workflow';
  relevance: number;
}

export interface ResearchChatToolCallEvent {
  id: string;
  name:
    | 'recall_memory'
    | 'retrieve_structured_research'
    | 'inspect_active_scenarios'
    | 'inspect_recent_risks'
    | 'explain_missing_artifacts';
  input: Record<string, unknown>;
}

export interface ResearchChatAgentEvent {
  type: ResearchChatAgentEventType;
  runId: string;
  messageId?: string;
  content?: string;
  toolCall?: ResearchChatToolCallEvent;
  toolResult?: Record<string, unknown>;
  memories?: ResearchChatMemoryRef[];
  sources?: ResearchChatSourceResponse[];
  context?: ResearchChatContextPackResponse;
}

export class ResearchChatStreamDto extends ResearchChatAskDto {
  mode?: ResearchChatRunMode;
  useMemory?: boolean;
  useRag?: boolean;
  sessionId?: string;
}
```

- [ ] **Step 2: Mirror the same contract in web types**

Add equivalent exported types to `apps/web/src/types/index.ts`. Keep names identical so frontend code can use the same event vocabulary.

- [ ] **Step 3: Run type checks through existing test/build commands**

Run:

```powershell
corepack pnpm --filter @lunaperception/api test
corepack pnpm --filter @lunaperception/web build
```

Expected:

- API tests pass.
- Web build passes.

---

### Task 2: Add Server-Sent Stream Writer

**Files:**
- Create: `apps/api/src/research-chat/research-chat-stream.writer.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Create a tiny SSE writer**

```ts
import type { Response } from 'express';
import type { ResearchChatAgentEvent } from './dto/research-chat.dto';

export class ResearchChatStreamWriter {
  constructor(private readonly response: Response) {}

  start(): void {
    this.response.status(200);
    this.response.setHeader('Content-Type', 'text/event-stream');
    this.response.setHeader('Cache-Control', 'no-cache, no-transform');
    this.response.setHeader('Connection', 'keep-alive');
    this.response.flushHeaders?.();
  }

  write(event: ResearchChatAgentEvent): void {
    this.response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    this.response.end();
  }
}
```

- [ ] **Step 2: Add a test helper for collecting events**

In `apps/api/test/research-chat-agent.service.test.ts`, add a local test helper:

```ts
function collectEvent(event: unknown, events: unknown[]) {
  events.push(event);
}
```

This file will be expanded by later tasks.

---

### Task 3: Create Read-Only Crypto Research Tools

**Files:**
- Create: `apps/api/src/research-chat/research-chat-tools.ts`
- Modify: `apps/api/src/research-chat/research-chat.module.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Wrap existing structured retriever as agent tools**

```ts
import { Injectable } from '@nestjs/common';
import { ResearchChatRetriever } from './research-chat-retriever';
import type {
  ResearchChatContextPackResponse,
  ResearchChatIntent,
  ResearchChatSourceResponse,
} from './dto/research-chat.dto';
import { buildResearchChatSources } from './research-chat-context.builder';

export interface ResearchChatToolResult {
  intent: ResearchChatIntent;
  context: ResearchChatContextPackResponse;
  sources: ResearchChatSourceResponse[];
}

@Injectable()
export class ResearchChatTools {
  constructor(private readonly retriever: ResearchChatRetriever) {}

  async retrieveStructuredResearch(
    workspaceId: string,
    symbol: string,
    message: string,
  ): Promise<ResearchChatToolResult> {
    const intent = this.retriever.detectIntent(message);
    const context = await this.retriever.retrieve(workspaceId, symbol, intent);
    return {
      intent,
      context,
      sources: buildResearchChatSources(context),
    };
  }
}
```

- [ ] **Step 2: Register `ResearchChatTools` in the module**

Update providers:

```ts
providers: [ResearchChatRetriever, ResearchChatService, ResearchChatTools],
```

- [ ] **Step 3: Test source propagation**

Add a test that stubs `ResearchChatRetriever.retrieve()` to return a context with a thesis and verifies `retrieveStructuredResearch()` returns at least one `thesis` source.

---

### Task 4: Add Memory V0 Repository

**Files:**
- Create: `apps/api/src/research-chat/research-chat-memory.repository.ts`
- Modify: `apps/api/src/research-chat/research-chat.module.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Implement backend memory interface**

For the first implementation, keep the repository small and isolated. If the existing DB layer exposes a simple query interface, back this with Postgres. If not, use a file-local in-memory map only for V0 tests and replace it with DB persistence in the next task before shipping.

```ts
import { Injectable } from '@nestjs/common';
import type { ResearchChatMemoryRef } from './dto/research-chat.dto';

export interface SaveResearchMemoryInput {
  workspaceId: string;
  userId: string;
  symbol?: string;
  content: string;
  category: ResearchChatMemoryRef['category'];
}

@Injectable()
export class ResearchChatMemoryRepository {
  private readonly memories = new Map<string, ResearchChatMemoryRef[]>();

  async recall(workspaceId: string, symbol: string, message: string): Promise<ResearchChatMemoryRef[]> {
    const key = this.key(workspaceId);
    const terms = `${symbol} ${message}`.toLowerCase().split(/\s+/).filter(Boolean);
    return (this.memories.get(key) ?? [])
      .map((memory) => ({
        ...memory,
        relevance: terms.some((term) => memory.content.toLowerCase().includes(term)) ? 0.8 : 0.2,
      }))
      .filter((memory) => memory.relevance >= 0.5)
      .slice(0, 5);
  }

  async save(input: SaveResearchMemoryInput): Promise<ResearchChatMemoryRef> {
    const memory: ResearchChatMemoryRef = {
      id: `memory_${Date.now()}`,
      label: input.symbol ? `${input.symbol} memory` : 'Workspace memory',
      content: input.content,
      category: input.category,
      relevance: 1,
    };
    const key = this.key(input.workspaceId);
    this.memories.set(key, [memory, ...(this.memories.get(key) ?? [])].slice(0, 100));
    return memory;
  }

  private key(workspaceId: string): string {
    return workspaceId;
  }
}
```

- [ ] **Step 2: Register memory repository**

```ts
providers: [
  ResearchChatRetriever,
  ResearchChatService,
  ResearchChatTools,
  ResearchChatMemoryRepository,
],
```

- [ ] **Step 3: Test save then recall**

Add a test that saves `"I prefer BTC answers to include invalidation levels"` and recalls it with a later BTC prompt.

---

### Task 5: Add LLM Synthesis Service With Safe Crypto Prompt

**Files:**
- Create: `apps/api/src/research-chat/research-chat-llm.service.ts`
- Modify: `apps/api/src/research-chat/research-chat.module.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Add service boundary**

```ts
import { Injectable } from '@nestjs/common';
import type {
  ResearchChatContextPackResponse,
  ResearchChatMemoryRef,
  ResearchChatSourceResponse,
} from './dto/research-chat.dto';

export interface ResearchChatSynthesisInput {
  symbol: string;
  message: string;
  memories: ResearchChatMemoryRef[];
  context: ResearchChatContextPackResponse;
  sources: ResearchChatSourceResponse[];
}

@Injectable()
export class ResearchChatLlmService {
  async synthesize(input: ResearchChatSynthesisInput): Promise<string> {
    if (input.sources.length === 0) {
      return [
        `${input.symbol}: I can chat, but Luna does not have enough saved research artifacts to cite yet.`,
        'Missing likely data: latest thesis, continuity state, continuity entries, active scenarios, or recent research runs.',
        'Run or import a completed research workflow first, then ask me to compare thesis, risks, scenarios, bias, or conviction.',
      ].join('\n\n');
    }

    const thesis = input.context.latest_thesis as Record<string, unknown> | null;
    const continuity = input.context.continuity_state as Record<string, unknown> | null;
    const memoryLine = input.memories.length
      ? `Relevant memory: ${input.memories.map((memory) => memory.content).join(' | ')}`
      : 'Relevant memory: none';

    return [
      `For ${input.symbol}, my answer is grounded in Luna's structured research artifacts.`,
      memoryLine,
      thesis ? `Latest thesis artifact: ${JSON.stringify(thesis).slice(0, 500)}` : 'No latest thesis artifact was available.',
      continuity ? `Continuity state: ${JSON.stringify(continuity).slice(0, 500)}` : 'No continuity state was available.',
      `Sources: ${input.sources.map((source) => `${source.type}:${source.id}`).join(', ')}`,
    ].join('\n\n');
  }
}
```

- [ ] **Step 2: Add crypto guardrail to the service documentation**

At the top of the class, keep this behavior explicit in code comments:

```ts
// V0 is read-only: synthesize research, cite artifacts, and explain missing data.
// It must not place trades, edit theses, or trigger research jobs.
```

- [ ] **Step 3: Register `ResearchChatLlmService`**

Add it to `ResearchChatModule.providers`.

---

### Task 6: Build Agent Run Service

**Files:**
- Create: `apps/api/src/research-chat/research-chat-agent.service.ts`
- Modify: `apps/api/src/research-chat/research-chat.module.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Implement event-driven agent loop**

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ResearchChatLlmService } from './research-chat-llm.service';
import { ResearchChatMemoryRepository } from './research-chat-memory.repository';
import { ResearchChatTools } from './research-chat-tools';
import type { ResearchChatAgentEvent, ResearchChatStreamDto } from './dto/research-chat.dto';

export type ResearchChatEmit = (event: ResearchChatAgentEvent) => void | Promise<void>;

@Injectable()
export class ResearchChatAgentService {
  constructor(
    private readonly tools: ResearchChatTools,
    private readonly memory: ResearchChatMemoryRepository,
    private readonly llm: ResearchChatLlmService,
  ) {}

  async run(dto: ResearchChatStreamDto, workspaceId: string, userId: string, emit: ResearchChatEmit): Promise<void> {
    const runId = randomUUID();
    const symbol = dto.symbol.trim().toUpperCase();

    await emit({ type: 'run_started', runId, content: `Starting Luna crypto research agent for ${symbol}` });

    const memories = dto.useMemory === false ? [] : await this.memory.recall(workspaceId, symbol, dto.message);
    await emit({ type: 'memory_used', runId, memories });

    await emit({
      type: 'tool_call',
      runId,
      toolCall: {
        id: `tool_${runId}_research`,
        name: 'retrieve_structured_research',
        input: { symbol, message: dto.message, scope: dto.scope ?? 'latest' },
      },
    });

    const research = dto.useRag === false
      ? { intent: 'general' as const, context: { symbol }, sources: [] }
      : await this.tools.retrieveStructuredResearch(workspaceId, symbol, dto.message);

    await emit({
      type: 'tool_result',
      runId,
      toolResult: {
        intent: research.intent,
        sourceCount: research.sources.length,
        hasThesis: Boolean(research.context.latest_thesis),
        hasContinuity: Boolean(research.context.continuity_state),
      },
    });

    await emit({ type: 'rag_sources', runId, sources: research.sources, context: research.context });

    const answer = await this.llm.synthesize({
      symbol,
      message: dto.message,
      memories,
      context: research.context,
      sources: research.sources,
    });

    for (const paragraph of answer.split('\n\n')) {
      await emit({ type: 'delta', runId, content: `${paragraph}\n\n` });
    }

    await emit({
      type: 'final',
      runId,
      content: answer,
      memories,
      sources: research.sources,
      context: research.context,
    });

    if (/^(remember|save|note|ghi nhớ|lưu)\b/i.test(dto.message.trim())) {
      await this.memory.save({
        workspaceId,
        userId,
        symbol,
        content: dto.message.replace(/^(remember|save|note|ghi nhớ|lưu)\b/i, '').trim(),
        category: 'research_note',
      });
    }
  }
}
```

- [ ] **Step 2: Register service in module**

Add `ResearchChatAgentService` to providers.

- [ ] **Step 3: Test event order**

Expected event order:

```ts
['run_started', 'memory_used', 'tool_call', 'tool_result', 'rag_sources', 'delta', 'final']
```

---

### Task 7: Expose `POST /research-chat/stream`

**Files:**
- Modify: `apps/api/src/research-chat/research-chat.controller.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Add controller method**

```ts
import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ResearchChatAgentService } from './research-chat-agent.service';
import { ResearchChatStreamWriter } from './research-chat-stream.writer';
import { ResearchChatAskDto, ResearchChatStreamDto } from './dto/research-chat.dto';
import { ResearchChatService } from './research-chat.service';

@Controller('research-chat')
export class ResearchChatController {
  constructor(
    private readonly researchChat: ResearchChatService,
    private readonly agent: ResearchChatAgentService,
  ) {}

  @Post('ask')
  ask(
    @Body() dto: ResearchChatAskDto,
    @Headers('x-workspace-id') workspaceId = 'local',
  ) {
    return this.researchChat.ask(dto, workspaceId);
  }

  @Post('stream')
  async stream(
    @Body() dto: ResearchChatStreamDto,
    @Headers('x-workspace-id') workspaceId = 'local',
    @Headers('x-user-id') userId = 'local-user',
    @Res() response: Response,
  ) {
    const writer = new ResearchChatStreamWriter(response);
    writer.start();

    try {
      await this.agent.run(dto, workspaceId, userId, (event) => writer.write(event));
    } catch (error) {
      writer.write({
        type: 'error',
        runId: 'unknown',
        content: error instanceof Error ? error.message : 'Research chat stream failed',
      });
    } finally {
      writer.end();
    }
  }
}
```

- [ ] **Step 2: Run API tests**

Run:

```powershell
corepack pnpm --filter @lunaperception/api test
```

Expected: all tests pass.

---

### Task 8: Add Frontend Streaming Client

**Files:**
- Modify: `apps/web/src/services/research-chat.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Add `streamResearchChat`**

```ts
import { API_BASE_URL, getDefaultHeaders } from './client';
import type { ResearchChatAgentEvent, ResearchChatStreamRequest } from '@/types';

export async function streamResearchChat(
  request: ResearchChatStreamRequest,
  onEvent: (event: ResearchChatAgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/research-chat/stream`, {
    method: 'POST',
    headers: {
      ...getDefaultHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Research chat stream failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const line = chunk.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as ResearchChatAgentEvent);
    }
  }
}
```

- [ ] **Step 2: If `API_BASE_URL` or `getDefaultHeaders` are not exported**

Open `apps/web/src/services/client.ts` and export the existing internal equivalents instead of duplicating base URL/header logic.

- [ ] **Step 3: Run web build**

```powershell
corepack pnpm --filter @lunaperception/web build
```

Expected: build passes.

---

### Task 9: Rebuild Research Chat Page As Agent UI

**Files:**
- Modify: `apps/web/src/pages/ResearchChatPage.tsx`
- Modify: `apps/web/src/styles/index.css`

- [ ] **Step 1: Change message model**

Use this local model inside `ResearchChatPage.tsx`:

```ts
interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'done' | 'error';
  events?: ResearchChatAgentEvent[];
  sources?: ResearchChatSourceResponse[];
  memories?: ResearchChatMemoryRef[];
}
```

- [ ] **Step 2: Submit through streaming client**

On submit:

```ts
const assistantId = crypto.randomUUID();
const abortController = new AbortController();

setMessages((current) => [
  ...current,
  { id: crypto.randomUUID(), role: 'user', content: prompt },
  { id: assistantId, role: 'assistant', content: '', status: 'streaming', events: [] },
]);

await streamResearchChat(
  {
    symbol,
    message: prompt,
    scope: 'latest',
    mode: 'agent',
    useMemory,
    useRag,
    sessionId,
  },
  (event) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== assistantId) return message;
        return {
          ...message,
          content: event.type === 'delta' ? `${message.content}${event.content ?? ''}` : message.content,
          status: event.type === 'final' ? 'done' : message.status,
          events: [...(message.events ?? []), event],
          sources: event.sources ?? message.sources,
          memories: event.memories ?? message.memories,
        };
      }),
    );
  },
  abortController.signal,
);
```

- [ ] **Step 3: Render Odysseus-like event trace**

Assistant messages should show:

- compact model label: `luna-agent`
- status row: memory, RAG, sources count
- collapsible `Sources`
- collapsible `Agent trace`
- final content streamed into the main bubble

- [ ] **Step 4: Add controls important for crypto agent**

Header/composer controls:

- Symbol input.
- `Agent` / `Chat` segmented control.
- `RAG` toggle.
- `Memory` toggle.
- New chat button.
- Stop button while streaming.

- [ ] **Step 5: Keep sidebar useful but focused**

Sidebar items:

- New Chat.
- Search.
- Chats.
- Memory.
- Sources.
- Scenario/Attention Context.
- Settings.

Do not re-add Workbench/Continuity/Theses as full app navigation here. This page is its own chat workspace.

---

### Task 10: Crypto-Specific Agent Behavior

**Files:**
- Modify: `apps/api/src/research-chat/research-chat-llm.service.ts`
- Test: `apps/api/test/research-chat-agent.service.test.ts`

- [ ] **Step 1: Enforce answer shape for research questions**

For thesis/risk/scenario/bias questions, final answer should prefer this structure:

```text
Stance:
[current thesis or missing data]

What changed:
[continuity/run delta]

Evidence:
[artifact-backed bullets]

Risks / invalidation:
[risk list or missing risk data]

Scenarios:
[active scenario list]

Confidence:
[conviction/bias when available]
```

- [ ] **Step 2: Add safety rules**

The service prompt or synthesis logic must enforce:

- No trade execution.
- No guaranteed profit claims.
- No pretending to have live market data if only stored snapshots exist.
- No citations when sources are empty.
- Always state missing artifacts explicitly.

- [ ] **Step 3: Test empty artifact behavior**

Input: no sources.

Expected final includes:

```text
does not have enough saved research artifacts
Missing likely data
```

---

### Task 11: Session Persistence V0

**Files:**
- Modify: `apps/web/src/pages/ResearchChatPage.tsx`

- [ ] **Step 1: Store sessions in localStorage**

Use keys:

```ts
const CHAT_SESSIONS_KEY = 'luna.research-chat.sessions.v1';
const ACTIVE_SESSION_KEY = 'luna.research-chat.active-session.v1';
```

Persist:

- session id
- title
- symbol
- updatedAt
- messages

- [ ] **Step 2: Render sidebar chat sessions**

Clicking a session loads its messages. New chat creates a new session with empty messages.

- [ ] **Step 3: Generate title from first message**

Use first user message truncated to 48 characters.

---

### Task 12: Verification

**Files:**
- No new files unless fixing bugs found by verification.

- [ ] **Step 1: API test**

```powershell
corepack pnpm --filter @lunaperception/api test
```

Expected: all tests pass.

- [ ] **Step 2: Web build**

```powershell
corepack pnpm --filter @lunaperception/web build
```

Expected: build passes.

- [ ] **Step 3: Browser verification**

Open:

```text
http://localhost:3003/research-chat
```

Verify:

- The page is standalone, not inside `MainLayout`.
- Sidebar is present.
- Composer is fixed near the bottom.
- Sending a message streams visible assistant content.
- Agent trace shows memory/RAG/tool events.
- Sources drawer appears when sources exist.
- Empty DB produces a useful missing-artifact answer.

- [ ] **Step 4: Manual MVP prompts**

Run these five prompts with `BTC/USDT`:

```text
BTC thesis hiện tại là gì?
Thesis hôm nay khác run trước chỗ nào?
Risk nào mới xuất hiện?
Scenario nào đang active?
Vì sao hệ thống chuyển bias / conviction?
```

Expected:

- With artifacts: cited answer using thesis/run/continuity/scenario sources.
- Without artifacts: clear missing-data explanation and no fake citation.

---

## Deferred Until V1

- Vector DB, embeddings, semantic search over raw reports.
- Agent write actions: edit thesis, launch research run, trade action.
- Multi-agent planner/executor.
- Web search.
- Long-term summarization memory.
- Background detached runs like Odysseus `/resume` and `/stop`.

## Self-Review

- Spec coverage: The plan covers standalone page, Odysseus-like agent UX, streaming, structured RAG, memory, crypto-specific behavior, citations, and safe missing-data behavior.
- Placeholder scan: Vector RAG and write actions are explicitly deferred. V0 tasks are concrete.
- Type consistency: Event names, request names, and source/memory names are shared across backend and frontend tasks.
