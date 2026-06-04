import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  Braces,
  ChevronRight,
  Circle,
  Database,
  FileText,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Send,
  Settings,
  Square,
  User,
  Zap,
} from 'lucide-react';
import { errorMessage } from '@/services/client';
import { streamResearchChat } from '@/services/research-chat';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IdChip } from '@/components/research/badges';
import type {
  ResearchChatAgentEvent,
  ResearchChatMemoryRef,
  ResearchChatRunMode,
  ResearchChatSourceResponse,
} from '@/types';

interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'done' | 'error';
  events?: ResearchChatAgentEvent[];
  sources?: ResearchChatSourceResponse[];
  memories?: ResearchChatMemoryRef[];
}

interface AgentChatSession {
  id: string;
  title: string;
  symbol: string;
  updatedAt: string;
  messages: AgentChatMessage[];
}

interface StoredChatState {
  activeSessionId: string;
  sessions: AgentChatSession[];
}

const CHAT_SESSIONS_KEY = 'luna.research-chat.sessions.v1';
const ACTIVE_SESSION_KEY = 'luna.research-chat.active-session.v1';

const PROMPTS = [
  'What is the current BTC thesis?',
  'How is today thesis different from the previous run?',
  'What new risks appeared?',
  'Which scenarios are active?',
  'Why did bias or conviction change?',
];

export function ResearchChatPage() {
  const auth = useWorkspaceStore();
  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const initialState = useMemo(() => loadStoredChatState(fixedWorkspaceSymbol ?? 'BTC/USDT'), [fixedWorkspaceSymbol]);
  const [sessions, setSessions] = useState<AgentChatSession[]>(initialState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const [symbol, setSymbol] = useState(activeSession?.symbol ?? fixedWorkspaceSymbol ?? 'BTC/USDT');
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ResearchChatRunMode>('agent');
  const [useRag, setUseRag] = useState(true);
  const [useMemory, setUseMemory] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const effectiveSymbol = (fixedWorkspaceSymbol ?? symbol.trim()) || 'BTC/USDT';

  useEffect(() => {
    window.localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 30)));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeSession?.messages, isStreaming]);

  function setActiveMessages(updater: (messages: AgentChatMessage[]) => AgentChatMessage[]) {
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSessionId
          ? { ...session, messages: updater(session.messages), updatedAt: new Date().toISOString() }
          : session,
      ),
    );
  }

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isStreaming || !activeSession) {
      return;
    }

    const assistantId = crypto.randomUUID();
    setStreamError(null);
    setDraft('');
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== activeSessionId) {
          return session;
        }
        const isFirstUserMessage = !session.messages.some((message) => message.role === 'user');
        return {
          ...session,
          title: isFirstUserMessage ? titleFromPrompt(prompt) : session.title,
          symbol: effectiveSymbol,
          updatedAt: new Date().toISOString(),
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: prompt,
            },
            {
              id: assistantId,
              role: 'assistant',
              content: '',
              status: 'streaming',
              events: [],
              sources: [],
              memories: [],
            },
          ],
        };
      }),
    );

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    void streamResearchChat(
      {
        symbol: effectiveSymbol,
        message: prompt,
        scope: 'latest',
        mode,
        useMemory,
        useRag,
        sessionId: activeSessionId,
      },
      auth,
      (agentEvent) => applyAgentEvent(assistantId, agentEvent),
      controller.signal,
    )
      .catch((error) => {
        if (controller.signal.aborted) {
          markAssistantStopped(assistantId);
          return;
        }
        setStreamError(errorMessage(error));
        markAssistantError(assistantId, errorMessage(error));
      })
      .finally(() => {
        abortRef.current = null;
        setIsStreaming(false);
      });
  }

  function applyAgentEvent(assistantId: string, agentEvent: ResearchChatAgentEvent) {
    setActiveMessages((messages) =>
      messages.map((message) => {
        if (message.id !== assistantId) {
          return message;
        }
        return {
          ...message,
          content:
            agentEvent.type === 'delta'
              ? `${message.content}${agentEvent.content ?? ''}`
              : agentEvent.type === 'final' && agentEvent.content
                ? agentEvent.content
                : message.content,
          status:
            agentEvent.type === 'final'
              ? 'done'
              : agentEvent.type === 'error'
                ? 'error'
                : message.status,
          events: [...(message.events ?? []), agentEvent],
          sources: agentEvent.sources ?? message.sources,
          memories: agentEvent.memories ?? message.memories,
        };
      }),
    );
  }

  function markAssistantStopped(assistantId: string) {
    setActiveMessages((messages) =>
      messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              status: 'done',
              content: message.content || 'Stopped.',
            }
          : message,
      ),
    );
  }

  function markAssistantError(assistantId: string, messageText: string) {
    setActiveMessages((messages) =>
      messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              status: 'error',
              content: message.content || messageText,
            }
          : message,
      ),
    );
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function startNewChat() {
    const session = createSession(effectiveSymbol);
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setSymbol(session.symbol);
    setDraft('');
    setStreamError(null);
  }

  function selectSession(session: AgentChatSession) {
    if (isStreaming) {
      return;
    }
    setActiveSessionId(session.id);
    setSymbol(session.symbol);
    setStreamError(null);
  }

  function stopStream() {
    abortRef.current?.abort();
  }

  return (
    <main className="research-chat-page">
      <aside className="research-chat-app-sidebar" aria-label="Research chat sidebar">
        <div className="research-chat-sidebar-head">
          <button aria-label="Collapse sidebar" className="research-chat-icon-button" type="button">
            <Menu aria-hidden size={18} />
          </button>
          <strong>Luna Agent</strong>
        </div>

        <nav className="research-chat-sidebar-nav" aria-label="Chat navigation">
          <button onClick={startNewChat} type="button">
            <Plus aria-hidden size={16} />
            <span>New Chat</span>
          </button>
          <button type="button">
            <Search aria-hidden size={16} />
            <span>Search</span>
          </button>
          <button className="active" type="button">
            <MessageSquare aria-hidden size={16} />
            <span>Chats</span>
            <ChevronRight aria-hidden size={14} />
          </button>
          <button type="button">
            <BrainCircuit aria-hidden size={16} />
            <span>Memory</span>
          </button>
          <button type="button">
            <Database aria-hidden size={16} />
            <span>Sources</span>
          </button>
          <button type="button">
            <Settings aria-hidden size={16} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="research-chat-session-list" aria-label="Chat sessions">
          {sessions.map((session) => (
            <button
              className={session.id === activeSessionId ? 'active' : ''}
              key={session.id}
              onClick={() => selectSession(session)}
              type="button"
            >
              <MessageSquare aria-hidden size={14} />
              <span>{session.title}</span>
            </button>
          ))}
        </div>

        <div className="research-chat-sidebar-bottom">
          <span className="research-chat-user-mark">L</span>
          <div>
            <strong>LunaCrypto</strong>
            <span>crypto research agent</span>
          </div>
        </div>
      </aside>

      <section className="research-chat-shell" aria-label="Luna research agent chat">
        <header className="research-chat-header">
          <div className="research-chat-brand">
            <span className="research-chat-mark">
              <Bot aria-hidden size={18} />
            </span>
            <div>
              <h1>Luna Research Agent</h1>
              <p>Structured RAG + memory for crypto research</p>
            </div>
          </div>
          <div className="research-chat-model-pill">
            luna-agent
            <span>streaming</span>
          </div>
          <div className="research-chat-header-actions">
            <label className="research-chat-symbol">
              <span>Symbol</span>
              <input
                disabled={Boolean(fixedWorkspaceSymbol) || isStreaming}
                onChange={(event) => setSymbol(event.target.value)}
                value={effectiveSymbol}
              />
            </label>
            <button
              aria-label="Start new chat"
              className="research-chat-reset"
              onClick={startNewChat}
              type="button"
            >
              <Plus aria-hidden size={16} />
              <span>New chat</span>
            </button>
          </div>
        </header>

        <div className="research-chat-thread">
          {(activeSession?.messages ?? []).map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {streamError ? <div className="research-chat-error">{streamError}</div> : null}
          <div ref={bottomRef} />
        </div>

        <footer className="research-chat-composer-wrap">
          <div className="research-chat-prompts" aria-label="Suggested questions">
            {PROMPTS.map((prompt) => (
              <button key={prompt} onClick={() => setDraft(prompt)} type="button">
                {prompt}
              </button>
            ))}
          </div>
          <div className="research-chat-agent-controls">
            <div className="research-chat-segmented" aria-label="Run mode">
              <button className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')} type="button">
                Agent
              </button>
              <button className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')} type="button">
                Chat
              </button>
            </div>
            <label>
              <input checked={useRag} onChange={(event) => setUseRag(event.target.checked)} type="checkbox" />
              RAG
            </label>
            <label>
              <input checked={useMemory} onChange={(event) => setUseMemory(event.target.checked)} type="checkbox" />
              Memory
            </label>
          </div>
          <form className="research-chat-composer" onSubmit={submit}>
            <textarea
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={`Ask Luna about ${effectiveSymbol} research...`}
              rows={1}
              value={draft}
            />
            <button
              aria-label={isStreaming ? 'Stop stream' : 'Send message'}
              disabled={!isStreaming && !draft.trim()}
              onClick={isStreaming ? stopStream : undefined}
              type={isStreaming ? 'button' : 'submit'}
            >
              {isStreaming ? <Square aria-hidden size={18} /> : <Send aria-hidden size={18} />}
            </button>
          </form>
        </footer>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <article className={isUser ? 'chat-message user' : 'chat-message assistant'}>
      <div className="chat-message-avatar">
        {isUser ? <User aria-hidden size={16} /> : <Bot aria-hidden size={16} />}
      </div>
      <div className="chat-message-body">
        {!isUser ? <AssistantStatus message={message} /> : null}
        <div className="chat-message-copy">{message.content || (message.status === 'streaming' ? 'Thinking' : '')}</div>
        {!isUser ? (
          <div className="chat-answer-meta">
            <div className="chat-answer-badges">
              <span>luna-agent</span>
              <span>{message.status ?? 'done'}</span>
              <span>{message.sources?.length ?? 0} sources</span>
              <span>{message.memories?.length ?? 0} memories</span>
            </div>
            <details className="chat-source-details">
              <summary>Sources</summary>
              <SourcesList sources={message.sources ?? []} />
            </details>
            <details className="chat-source-details">
              <summary>Agent trace</summary>
              <AgentTrace events={message.events ?? []} />
            </details>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AssistantStatus({ message }: { message: AgentChatMessage }) {
  const lastEvent = message.events?.at(-1);
  return (
    <div className="research-chat-agent-status">
      <Circle aria-hidden className={message.status === 'streaming' ? 'live' : ''} size={9} />
      <span>{lastEvent ? eventLabel(lastEvent) : 'Ready'}</span>
    </div>
  );
}

function AgentTrace({ events }: { events: ResearchChatAgentEvent[] }) {
  if (events.length === 0) {
    return <p className="chat-source-empty">No agent events yet.</p>;
  }
  return (
    <div className="research-chat-event-list">
      {events.map((event, index) => (
        <div className="research-chat-event-row" key={`${event.type}-${index}`}>
          <Zap aria-hidden size={13} />
          <div>
            <strong>{event.type}</strong>
            <span>{eventLabel(event)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourcesList({ sources }: { sources: ResearchChatSourceResponse[] }) {
  if (sources.length === 0) {
    return <p className="chat-source-empty">No source refs returned.</p>;
  }
  return (
    <div className="chat-source-list">
      {sources.map((source) => (
        <div className="chat-source-row" key={`${source.type}-${source.id}`}>
          <div className="chat-source-main">
            <div className="chat-source-title">
              {sourceIcon(source.type)}
              <span>{source.label}</span>
            </div>
            {source.excerpt ? <p className="chat-source-excerpt">{source.excerpt}</p> : null}
          </div>
          <IdChip value={source.id} />
        </div>
      ))}
    </div>
  );
}

function sourceIcon(type: string) {
  if (type.includes('continuity')) {
    return <Braces aria-hidden size={15} />;
  }
  if (type === 'thesis' || type === 'research_run') {
    return <FileText aria-hidden size={15} />;
  }
  return <Database aria-hidden size={15} />;
}

function eventLabel(event: ResearchChatAgentEvent): string {
  switch (event.type) {
    case 'run_started':
      return event.content ?? 'Run started';
    case 'memory_used':
      return `${event.memories?.length ?? 0} memories recalled`;
    case 'tool_call':
      return event.toolCall?.name ?? 'Calling tool';
    case 'tool_result':
      return `${String(event.toolResult?.sourceCount ?? 0)} sources found`;
    case 'rag_sources':
      return `${event.sources?.length ?? 0} source refs loaded`;
    case 'delta':
      return 'Streaming answer';
    case 'final':
      return 'Final answer ready';
    case 'error':
      return event.content ?? 'Agent error';
    default:
      return event.type;
  }
}

function createSession(symbol: string): AgentChatSession {
  return {
    id: crypto.randomUUID(),
    title: 'New crypto research chat',
    symbol,
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Ask me about thesis, continuity diff, active scenarios, risks, bias, conviction, or what data is missing. I use Luna structured research artifacts and memory in this V0.',
        status: 'done',
        events: [],
        sources: [],
        memories: [],
      },
    ],
  };
}

function loadStoredChatState(defaultSymbol: string): StoredChatState {
  const fallback = createSession(defaultSymbol);
  try {
    const raw = window.localStorage.getItem(CHAT_SESSIONS_KEY);
    const activeSessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return { activeSessionId: fallback.id, sessions: [fallback] };
    }
    const sessions = parsed.filter(isStoredSession).slice(0, 30);
    if (sessions.length === 0) {
      return { activeSessionId: fallback.id, sessions: [fallback] };
    }
    return {
      activeSessionId: activeSessionId && sessions.some((session) => session.id === activeSessionId)
        ? activeSessionId
        : sessions[0].id,
      sessions,
    };
  } catch {
    return { activeSessionId: fallback.id, sessions: [fallback] };
  }
}

function isStoredSession(value: unknown): value is AgentChatSession {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<AgentChatSession>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.symbol === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.messages)
  );
}

function titleFromPrompt(prompt: string): string {
  return prompt.length > 48 ? `${prompt.slice(0, 45).trimEnd()}...` : prompt;
}
