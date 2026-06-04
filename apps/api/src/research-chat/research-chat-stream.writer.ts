import type { ServerResponse } from 'node:http';
import type { ResearchChatAgentEvent } from './dto/research-chat.dto';

export class ResearchChatStreamWriter {
  constructor(private readonly response: ServerResponse) {}

  start(): void {
    this.response.statusCode = 200;
    this.response.setHeader('Content-Type', 'text/event-stream');
    this.response.setHeader('Cache-Control', 'no-cache, no-transform');
    this.response.setHeader('Connection', 'keep-alive');
    this.response.flushHeaders?.();
  }

  write(event: ResearchChatAgentEvent): void {
    this.response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    this.response.end();
  }
}
