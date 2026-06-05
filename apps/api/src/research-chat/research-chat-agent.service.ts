import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ResearchChatLlmService } from './research-chat-llm.service';
import { ResearchChatMemoryRepository } from './research-chat-memory.repository';
import { resolveResearchChatSymbol } from './research-chat-symbol-resolver';
import { resolveResearchChatWorkspace } from './research-chat-workspace-resolver';
import { ResearchChatTools } from './research-chat-tools';
import type {
  ResearchChatAgentEvent,
  ResearchChatContextPackResponse,
  ResearchChatMemoryRef,
  ResearchChatSourceResponse,
  ResearchChatStreamDto,
} from './dto/research-chat.dto';

export type ResearchChatEmit = (
  event: ResearchChatAgentEvent,
) => void | Promise<void>;

@Injectable()
export class ResearchChatAgentService {
  constructor(
    private readonly tools: ResearchChatTools,
    private readonly memory: ResearchChatMemoryRepository,
    private readonly llm: ResearchChatLlmService,
    private readonly workspaces?: WorkspacesService,
  ) {}

  async run(
    dto: ResearchChatStreamDto,
    workspaceId: string,
    userId: string,
    emit: ResearchChatEmit,
  ): Promise<void> {
    const runId = randomUUID();
    const scope = resolveResearchChatSymbol(dto.message, dto.symbol);
    const symbol = scope.symbol;
    const memorySymbol = symbol ?? 'global';
    const retrievalWorkspaceId = this.workspaces
      ? await resolveResearchChatWorkspace(
          this.workspaces,
          userId,
          workspaceId,
          symbol,
        )
      : workspaceId;

    await emit({
      type: 'run_started',
      runId,
      content: symbol
        ? `Starting Luna crypto research agent for ${symbol}`
        : 'Starting Luna crypto research agent',
    });

    const memories =
      dto.useMemory === false
        ? []
        : await this.memory.recall(
            retrievalWorkspaceId,
            memorySymbol,
            dto.message,
          );
    await emit({ type: 'memory_used', runId, memories });

    if (
      isCasualMessage(dto.message) ||
      (isMetaMessage(dto.message) && !isDataAccessMessage(dto.message))
    ) {
      await this.synthesizeAndEmit({
        runId,
        symbol: symbol ?? 'global',
        message: dto.message,
        memories,
        context: emptyContext(symbol ?? 'global'),
        sources: [],
        emit,
      });
      return;
    }

    await emit({
      type: 'tool_call',
      runId,
      toolCall: {
        id: `tool_${runId}_research`,
        name: 'retrieve_structured_research',
        input: symbol
          ? { symbol, message: dto.message, scope: dto.scope ?? 'latest' }
          : { message: dto.message, scope: dto.scope ?? 'latest' },
      },
    });

    const research =
      dto.useRag === false
        ? {
            intent: 'general' as const,
            context: emptyContext(symbol ?? 'global'),
            sources: [],
          }
        : await this.tools.retrieveStructuredResearch(
            retrievalWorkspaceId,
            symbol,
            dto.message,
            { allowWorkspaceFallback: !scope.explicitSymbol },
          );

    await emit({
      type: 'tool_result',
      runId,
      toolResult: {
        intent: research.intent,
        sourceCount: research.sources.length,
        hasThesis: Boolean(research.context.latest_thesis),
        hasContinuity: Boolean(research.context.continuity_state),
        activeScenarioCount: research.context.active_scenarios.length,
      },
    });

    await emit({
      type: 'rag_sources',
      runId,
      sources: research.sources,
      context: research.context,
    });

    const savedMemory = await this.maybeSaveMemory(
      dto.message,
      retrievalWorkspaceId,
      userId,
      symbol,
    );
    const runMemories = savedMemory ? [savedMemory, ...memories] : memories;

    await this.synthesizeAndEmit({
      runId,
      symbol: research.context.symbol || symbol || 'global',
      message: dto.message,
      memories: runMemories,
      context: research.context,
      sources: research.sources,
      emit,
    });
  }

  private async synthesizeAndEmit(input: {
    runId: string;
    symbol: string;
    message: string;
    memories: ResearchChatMemoryRef[];
    context: ResearchChatContextPackResponse;
    sources: ResearchChatSourceResponse[];
    emit: ResearchChatEmit;
  }): Promise<void> {
    const answer = await this.llm.synthesize({
      symbol: input.symbol,
      message: input.message,
      memories: input.memories,
      context: input.context,
      sources: input.sources,
    });
    for (const paragraph of answer.split('\n\n')) {
      const content = paragraph.trim();
      if (content) {
        await input.emit({
          type: 'delta',
          runId: input.runId,
          content: `${content}\n\n`,
        });
      }
    }

    await input.emit({
      type: 'final',
      runId: input.runId,
      content: answer,
      memories: input.memories,
      sources: input.sources,
      context: input.context,
    });
  }

  private async maybeSaveMemory(
    message: string,
    workspaceId: string,
    userId: string,
    symbol: string | null,
  ) {
    const content = extractMemoryContent(message);
    if (!content) {
      return null;
    }
    return this.memory.save({
      workspaceId,
      userId,
      symbol: symbol ?? 'global',
      content,
      category: 'research_note',
    });
  }
}

function emptyContext(symbol: string): ResearchChatContextPackResponse {
  return {
    symbol,
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
  };
}

function extractMemoryContent(message: string): string | null {
  const trimmed = message.trim();
  const match = /^(remember|save|note|ghi nho|ghi nhớ|lưu|luu)\b[:\s-]*/i.exec(
    trimmed,
  );
  if (!match) {
    return null;
  }
  const content = trimmed.slice(match[0].length).trim();
  return content.length >= 3 ? content : null;
}

function isCasualMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (
    /^(hi|hello|hey|yo|gm|good morning|good evening|thanks|thank you|ok|okay|xin chao|chao|cam on|xin chào|chào|cảm ơn)[.!?]*$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    includesAny(normalized, [
      'btc',
      'eth',
      'usdt',
      'thesis',
      'risk',
      'scenario',
      'bias',
      'conviction',
      'run',
      'market',
      'price',
      'alert',
      'signal',
      'continuity',
      'luận điểm',
      'luan diem',
      'rủi ro',
      'rui ro',
      'kịch bản',
      'kich ban',
      'giá',
      'gia',
    ])
  ) {
    return false;
  }
  return false;
}

function isMetaMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return includesAny(normalized, [
    'model',
    'provider',
    'llm',
    'ai nao',
    'mo hinh',
    'dung model',
    'dang dung',
    'ai nào',
    'mô hình',
    'dùng model',
    'đang dùng',
  ]);
}

function isDataAccessMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return includesAny(normalized, [
    'artifact',
    'artifacts',
    'database',
    'db',
    'data',
    'dataset',
    'internal',
    'source',
    'sources',
    'memory',
    'memories',
    'rag',
    'workspace',
    'thesis',
    'run',
    'alert',
    'signal',
    'market',
    'truy cap',
    'quyen truy cap',
    'du lieu',
    'noi bo',
    'nguon',
  ]);
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
