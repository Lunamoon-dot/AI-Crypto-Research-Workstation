import { API_BASE_URL, apiRequest, authHeaders } from '@/services/client';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import type {
  ResearchChatAgentEvent,
  ResearchChatAskRequest,
  ResearchChatAskResponse,
  ResearchChatStreamRequest,
} from '@/types';

export function askResearchChat(
  request: ResearchChatAskRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ResearchChatAskResponse>(
    '/research-chat/ask',
    {
      method: 'POST',
      body: request,
    },
    auth,
  );
}

export async function streamResearchChat(
  request: ResearchChatStreamRequest,
  auth: WorkspaceRequestContext,
  onEvent: (event: ResearchChatAgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/research-chat/stream`, {
    method: 'POST',
    headers: {
      ...(await authHeaders(auth)),
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Research chat stream failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const line = chunk.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) {
        continue;
      }
      onEvent(JSON.parse(line.slice(6)) as ResearchChatAgentEvent);
    }
  }
}
