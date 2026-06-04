import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  buildResearchChatAnswer,
  buildResearchChatSources,
} from './research-chat-context.builder';
import { ResearchChatRetriever } from './research-chat-retriever';
import type {
  ResearchChatAskDto,
  ResearchChatAskResponse,
} from './dto/research-chat.dto';

@Injectable()
export class ResearchChatService {
  constructor(
    private readonly retriever: ResearchChatRetriever,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async ask(
    dto: ResearchChatAskDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchChatAskResponse> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const intent = this.retriever.detectIntent(dto.message);
    const context = await this.retriever.retrieveLatest(dto.symbol, workspaceId);
    return {
      answer: buildResearchChatAnswer(intent, context),
      intent,
      context,
      sources: buildResearchChatSources(context),
    };
  }
}
