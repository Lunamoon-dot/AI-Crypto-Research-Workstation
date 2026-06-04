import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { JsonRecord } from '../../database/journal.types';

export type ResearchChatIntent =
  | 'thesis'
  | 'diff'
  | 'risk'
  | 'scenario'
  | 'bias'
  | 'general';

export type ResearchChatSourceType =
  | 'thesis'
  | 'research_run'
  | 'continuity_state'
  | 'continuity_entry'
  | 'scenario'
  | 'alert'
  | 'market_snapshot'
  | 'signal_snapshot';

export class ResearchChatAskDto {
  @IsString()
  @MinLength(1)
  symbol!: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsIn(['latest'])
  scope?: 'latest';
}

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

export interface ResearchChatSourceResponse {
  type: ResearchChatSourceType;
  id: string;
  label: string;
  excerpt: string | null;
}

export interface ResearchChatContextPackResponse {
  symbol: string;
  latest_thesis: JsonRecord | null;
  latest_run: JsonRecord | null;
  previous_run: JsonRecord | null;
  continuity_state: JsonRecord | null;
  recent_continuity_entries: JsonRecord[];
  active_scenarios: JsonRecord[];
  latest_alerts: JsonRecord[];
  market_snapshot: JsonRecord | null;
  signal_snapshot: JsonRecord | null;
}

export interface ResearchChatAskResponse {
  answer: string;
  intent: ResearchChatIntent;
  context: ResearchChatContextPackResponse;
  sources: ResearchChatSourceResponse[];
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
  @IsOptional()
  @IsIn(['agent', 'chat'])
  mode?: ResearchChatRunMode;

  @IsOptional()
  @IsBoolean()
  useMemory?: boolean;

  @IsOptional()
  @IsBoolean()
  useRag?: boolean;

  @IsOptional()
  @IsString()
  sessionId?: string;
}
