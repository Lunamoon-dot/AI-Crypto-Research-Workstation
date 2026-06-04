import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ResearchChatLlmService } from './research-chat-llm.service';
import { ResearchChatMemoryRepository } from './research-chat-memory.repository';
import { ResearchChatTools } from './research-chat-tools';
import type {
  ResearchChatAgentEvent,
  ResearchChatContextPackResponse,
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
  ) {}

  async run(
    dto: ResearchChatStreamDto,
    workspaceId: string,
    userId: string,
    emit: ResearchChatEmit,
  ): Promise<void> {
    const runId = randomUUID();
    const symbol = dto.symbol.trim().toUpperCase();

    await emit({
      type: 'run_started',
      runId,
      content: `Starting Luna crypto research agent for ${symbol}`,
    });

    const memories =
      dto.useMemory === false
        ? []
        : await this.memory.recall(workspaceId, symbol, dto.message);
    await emit({ type: 'memory_used', runId, memories });

    if (isCasualMessage(dto.message)) {
      const answer = casualAnswer(dto.message, symbol, memories.length);
      await emit({ type: 'delta', runId, content: `${answer}\n\n` });
      await emit({
        type: 'final',
        runId,
        content: answer,
        memories,
        sources: [],
        context: emptyContext(symbol),
      });
      return;
    }

    await emit({
      type: 'tool_call',
      runId,
      toolCall: {
        id: `tool_${runId}_research`,
        name: 'retrieve_structured_research',
        input: { symbol, message: dto.message, scope: dto.scope ?? 'latest' },
      },
    });

    const research =
      dto.useRag === false
        ? {
            intent: 'general' as const,
            context: emptyContext(symbol),
            sources: [],
          }
        : await this.tools.retrieveStructuredResearch(
            workspaceId,
            symbol,
            dto.message,
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
      workspaceId,
      userId,
      symbol,
    );
    const runMemories = savedMemory ? [savedMemory, ...memories] : memories;

    const answer = await this.llm.synthesize({
      symbol: research.context.symbol || symbol,
      message: dto.message,
      memories: runMemories,
      context: research.context,
      sources: research.sources,
    });

    for (const paragraph of answer.split('\n\n')) {
      const content = paragraph.trim();
      if (content) {
        await emit({ type: 'delta', runId, content: `${content}\n\n` });
      }
    }

    await emit({
      type: 'final',
      runId,
      content: answer,
      memories: runMemories,
      sources: research.sources,
      context: research.context,
    });
  }

  private async maybeSaveMemory(
    message: string,
    workspaceId: string,
    userId: string,
    symbol: string,
  ) {
    const content = extractMemoryContent(message);
    if (!content) {
      return null;
    }
    return this.memory.save({
      workspaceId,
      userId,
      symbol,
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
  return normalized.split(/\s+/).length <= 4;
}

function casualAnswer(
  message: string,
  symbol: string,
  memoryCount: number,
): string {
  const vietnamese = /[à-ỹ]|xin chào|chào|cảm ơn/i.test(message);
  if (vietnamese) {
    return [
      `Chào anh. Em là Luna Research Agent cho crypto, đang sẵn sàng đọc structured RAG và memory cho ${symbol}.`,
      `Lượt này em nhớ lại ${memoryCount} memory liên quan.`,
      'Anh có thể hỏi thesis hiện tại, thesis khác run trước chỗ nào, risk mới, scenario active, hoặc vì sao bias/conviction đổi.',
    ].join(' ');
  }
  return [
    `Hey. I am Luna Research Agent for crypto, ready to use structured RAG and memory for ${symbol}.`,
    `I recalled ${memoryCount} relevant memories in this turn.`,
    'Ask me about the current thesis, run-to-run changes, new risks, active scenarios, or bias/conviction changes.',
  ].join(' ');
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
