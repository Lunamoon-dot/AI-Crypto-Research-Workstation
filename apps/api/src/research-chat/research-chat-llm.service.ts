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

export class ResearchChatLlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchChatLlmUnavailableError';
  }
}

@Injectable()
export class ResearchChatLlmService {
  async synthesize(input: ResearchChatSynthesisInput): Promise<string> {
    const config = resolveLlmConfig();
    if (!config) {
      throw new ResearchChatLlmUnavailableError(
        'Research chat LLM is not configured. Set RESEARCH_CHAT_LLM_PROVIDER and RESEARCH_CHAT_LLM_MODEL, plus the matching provider API key.',
      );
    }
    return this.callProvider(input, config);
  }

  private async callProvider(
    input: ResearchChatSynthesisInput,
    config: LlmConfig,
  ): Promise<string> {
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
              content: systemPrompt(config),
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
        throw new ResearchChatLlmUnavailableError(
          `Research chat LLM request failed for ${config.provider}/${config.model}: HTTP ${response.status}.`,
        );
      }
      const payload = (await response.json()) as ChatCompletionResponse;
      const answer = normalizeAnswer(payload.choices?.[0]?.message?.content);
      if (!answer) {
        throw new ResearchChatLlmUnavailableError(
          `Research chat LLM returned an empty answer for ${config.provider}/${config.model}.`,
        );
      }
      return answer;
    } catch (error) {
      if (error instanceof ResearchChatLlmUnavailableError) {
        throw error;
      }
      throw new ResearchChatLlmUnavailableError(
        `Research chat LLM request failed for ${config.provider}/${config.model}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
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

function systemPrompt(config: LlmConfig): string {
  return [
    `You are Luna Crypto Research Agent, backed by provider ${config.provider} and model ${config.model}.`,
    'If the user asks what model, provider, or AI is being used, answer that directly and do not include market research.',
    'Answer in the same language as the user.',
    'Be concise by default: answer in 2-4 short sentences unless the user asks for detail.',
    'For greetings or small talk, respond naturally in one short sentence and do not mention missing artifacts, model details, or research status unless asked.',
    'Use only the provided Luna structured artifacts and memories.',
    'Do not include thesis, scenario, risk, or market analysis unless the user asks a research question.',
    'Do not claim live market access unless a provided market snapshot supports it.',
    'Do not place trades, edit theses, launch research runs, or give guaranteed-profit claims.',
    'When the user asks a research question and sources are empty, say which artifact types are missing and do not invent citations.',
    'Prefer this structure when useful: Stance, What changed, Evidence, Risks / invalidation, Scenarios, Confidence.',
  ].join(' ');
}

function compactContext(
  context: ResearchChatContextPackResponse,
): ResearchChatContextPackResponse {
  return {
    ...context,
    recent_continuity_entries: context.recent_continuity_entries.slice(0, 5),
    active_scenarios: context.active_scenarios.slice(0, 5),
    latest_alerts: context.latest_alerts.slice(0, 5),
    ...(context.global_artifacts
      ? {
          global_artifacts: {
          latest_theses: context.global_artifacts.latest_theses.slice(0, 5),
          recent_runs: context.global_artifacts.recent_runs.slice(0, 8),
          latest_alerts: context.global_artifacts.latest_alerts.slice(0, 5),
          active_scenarios: context.global_artifacts.active_scenarios.slice(0, 5),
          market_snapshots: context.global_artifacts.market_snapshots.slice(0, 5),
          signal_snapshots: context.global_artifacts.signal_snapshots.slice(0, 5),
          },
        }
      : {}),
  };
}

function normalizeAnswer(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const answer = value.trim();
  return answer ? answer : null;
}
