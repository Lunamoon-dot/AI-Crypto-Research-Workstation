import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ResearchChatAgentService } from './research-chat-agent.service';
import { ResearchChatController } from './research-chat.controller';
import { ResearchChatLlmService } from './research-chat-llm.service';
import { ResearchChatMemoryRepository } from './research-chat-memory.repository';
import { ResearchChatRetriever } from './research-chat-retriever';
import { ResearchChatService } from './research-chat.service';
import { ResearchChatTools } from './research-chat-tools';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ResearchChatController],
  providers: [
    ResearchChatRetriever,
    ResearchChatService,
    ResearchChatTools,
    ResearchChatMemoryRepository,
    ResearchChatLlmService,
    ResearchChatAgentService,
  ],
})
export class ResearchChatModule {}
