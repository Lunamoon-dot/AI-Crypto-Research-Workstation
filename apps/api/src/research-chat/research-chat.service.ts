import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  buildResearchChatAnswer,
  buildResearchChatSources,
} from './research-chat-context.builder';
import { ResearchChatRetriever } from './research-chat-retriever';
import { resolveResearchChatSymbol } from './research-chat-symbol-resolver';
import { resolveResearchChatWorkspace } from './research-chat-workspace-resolver';
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
    const scope = resolveResearchChatSymbol(dto.message, dto.symbol);
    const retrievalWorkspaceId = await resolveResearchChatWorkspace(
      this.workspaces,
      user,
      workspaceId,
      scope.symbol,
    );
    const intent = this.retriever.detectIntent(dto.message);
    const context = await this.retriever.retrieveLatest(
      scope.symbol,
      retrievalWorkspaceId,
      {
        allowWorkspaceFallback: !scope.explicitSymbol,
      },
    );
    return {
      answer: buildResearchChatAnswer(intent, context),
      intent,
      context,
      sources: buildResearchChatSources(context),
    };
  }
}
