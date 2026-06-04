import { Injectable } from '@nestjs/common';
import { buildResearchChatSources } from './research-chat-context.builder';
import { ResearchChatRetriever } from './research-chat-retriever';
import type {
  ResearchChatContextPackResponse,
  ResearchChatIntent,
  ResearchChatSourceResponse,
} from './dto/research-chat.dto';

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
    const context = await this.retriever.retrieveLatest(symbol, workspaceId);
    return {
      intent,
      context,
      sources: buildResearchChatSources(context),
    };
  }
}
