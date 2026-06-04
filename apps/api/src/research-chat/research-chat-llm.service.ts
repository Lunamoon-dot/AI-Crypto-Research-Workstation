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

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface LlmConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

@Injectable()
export class ResearchChatLlmService {
  async synthesize(input: ResearchChatSynthesisInput): Promise<string> {
    const modelAnswer = await this.tryProvider(input);
    if (modelAnswer) {
      return modelAnswer;
    }
    return fallbackSynthesis(input);
  }

  private async tryProvider(
    input: ResearchChatSynthesisInput,
  ): Promise<string | null> {
    const config = resolveLlmConfig();
    if (!config) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: systemPrompt(),
            },
            {
              role: 'user',
              content: JSON.stringify({
                symbol: input.symbol,
                user_message: input.message,
                memories: input.memories,
                sources: input.sources,
                context: compactContext(input.context),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as ChatCompletionResponse;
      return normalizeAnswer(payload.choices?.[0]?.message?.content);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveLlmConfig(): LlmConfig | null {
  const provider = (
    process.env.RESEARCH_CHAT_LLM_PROVIDER ??
    process.env.TRADINGAGENTS_LLM_PROVIDER ??
    ''
  )
    .trim()
    .toLowerCase();
  const model = (
    process.env.RESEARCH_CHAT_LLM_MODEL ??
    process.env.TRADINGAGENTS_QUICK_THINK_LLM ??
    ''
  ).trim();

  if (!provider || !model) {
    return null;
  }

  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    return apiKey
      ? {
          provider,
          apiKey,
          baseUrl:
            process.env.RESEARCH_CHAT_LLM_BASE_URL?.trim() ??
            'https://api.deepseek.com/v1',
          model,
        }
      : null;
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    return apiKey
      ? {
          provider,
          apiKey,
          baseUrl:
            process.env.RESEARCH_CHAT_LLM_BASE_URL?.trim() ??
            'https://api.openai.com/v1',
          model,
        }
      : null;
  }

  return null;
}

function systemPrompt(): string {
  return [
    'You are Luna Crypto Research Agent, a read-only crypto research analyst.',
    'Answer in the same language as the user.',
    'Use only the provided Luna structured artifacts and memories.',
    'Do not claim live market access unless a provided market snapshot supports it.',
    'Do not place trades, edit theses, launch research runs, or give guaranteed-profit claims.',
    'When sources are empty, say which artifact types are missing and do not invent citations.',
    'Prefer this structure when useful: Stance, What changed, Evidence, Risks / invalidation, Scenarios, Confidence.',
  ].join(' ');
}

function fallbackSynthesis(input: ResearchChatSynthesisInput): string {
  if (input.sources.length === 0) {
    return [
      `${input.symbol}: I can chat, but Luna does not have enough saved research artifacts to cite yet.`,
      'Missing likely data: latest thesis, continuity state, continuity entries, active scenarios, recent research runs, market snapshot, or signal snapshot.',
      'Run or import a completed research workflow first, then ask me to compare thesis, risks, scenarios, bias, or conviction.',
    ].join('\n\n');
  }

  const currentView = asRecord(input.context.continuity_state?.current_view);
  const thesis = input.context.latest_thesis;
  const entries = input.context.recent_continuity_entries;
  const scenarios = input.context.active_scenarios;
  const risks = collectRisks(input.context);
  const memories = input.memories.map((memory) => memory.content).slice(0, 3);

  return [
    `Stance:\n${input.symbol} is grounded in the latest Luna artifacts. ${firstText(
      thesis?.thesis_text,
      thesis?.decision,
      asRecord(thesis?.summary).action_summary,
      'No explicit thesis text was found.',
    )}`,
    `What changed:\n${firstText(
      entries[0]?.summary,
      'No continuity delta was available for the latest run.',
    )}`,
    `Evidence:\n${input.sources
      .slice(0, 6)
      .map((source) => `- ${source.label} (${source.type}:${source.id})`)
      .join('\n')}`,
    `Risks / invalidation:\n${
      risks.length ? risks.slice(0, 5).map((risk) => `- ${risk}`).join('\n') : '- No structured risks were found.'
    }`,
    `Scenarios:\n${
      scenarios.length
        ? scenarios
            .slice(0, 5)
            .map((scenario) => `- ${firstText(scenario.condition, scenario.expected_behavior, 'Scenario without condition')}`)
            .join('\n')
        : '- No active scenario is attached to the latest thesis.'
    }`,
    `Confidence:\nBias ${firstText(
      currentView.directional_bias,
      thesis?.direction,
      'unknown',
    )}; conviction ${firstText(currentView.conviction, thesis?.confidence, 'unknown')}.`,
    memories.length ? `Memory used:\n${memories.map((memory) => `- ${memory}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function compactContext(
  context: ResearchChatContextPackResponse,
): ResearchChatContextPackResponse {
  return {
    ...context,
    recent_continuity_entries: context.recent_continuity_entries.slice(0, 5),
    active_scenarios: context.active_scenarios.slice(0, 5),
    latest_alerts: context.latest_alerts.slice(0, 5),
  };
}

function collectRisks(context: ResearchChatContextPackResponse): string[] {
  const summary = asRecord(context.latest_thesis?.summary);
  const thesisRisks = stringList(context.latest_thesis?.risks).concat(
    stringList(summary.risks),
  );
  const stateRisks = records(context.continuity_state?.active_items)
    .filter((item) => ['risk', 'risks'].includes(String(item.type ?? item.item_type)))
    .map((item) => firstText(item.text, item.current_text, item.title));
  return [...new Set([...thesisRisks, ...stateRisks].filter(Boolean))];
}

function normalizeAnswer(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const answer = value.trim();
  return answer ? answer : null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (item === null || item === undefined ? '' : String(item)))
      .filter(Boolean);
  }
  return value === null || value === undefined || value === '' ? [] : [String(value)];
}
