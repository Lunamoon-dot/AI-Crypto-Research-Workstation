import type { ServerResponse } from 'node:http';
import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ResearchChatAgentService } from './research-chat-agent.service';
import { ResearchChatStreamWriter } from './research-chat-stream.writer';
import {
  ResearchChatAskDto,
  ResearchChatStreamDto,
} from './dto/research-chat.dto';
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
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchChat.ask(dto, userId, workspaceId);
  }

  @Post('stream')
  async stream(
    @Body() dto: ResearchChatStreamDto,
    @Headers('x-user-id') userId = 'local-user',
    @Headers('x-workspace-id') workspaceId = 'local',
    @Res() response: ServerResponse,
  ) {
    const writer = new ResearchChatStreamWriter(response);
    writer.start();

    try {
      await this.agent.run(dto, workspaceId, userId, (event) => {
        writer.write(event);
      });
    } catch (error) {
      writer.write({
        type: 'error',
        runId: 'unknown',
        content:
          error instanceof Error ? error.message : 'Research chat stream failed',
      });
    } finally {
      writer.end();
    }
  }
}
