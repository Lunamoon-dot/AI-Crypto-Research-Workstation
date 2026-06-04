import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import type { ResearchChatMemoryRef } from './dto/research-chat.dto';

export interface SaveResearchMemoryInput {
  workspaceId: string;
  userId: string;
  symbol?: string;
  content: string;
  category: ResearchChatMemoryRef['category'];
}

interface MemoryRow {
  id: string;
  workspace_id: string;
  user_id: string;
  symbol: string | null;
  content: string;
  category: ResearchChatMemoryRef['category'];
}

const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_chat_memories (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  user_id text NOT NULL,
  symbol text,
  content text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS research_chat_memories_workspace_created_idx
  ON research_chat_memories (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS research_chat_memories_symbol_idx
  ON research_chat_memories (workspace_id, symbol);
`;

export const RESEARCH_CHAT_MEMORY_DATABASE_URL =
  'RESEARCH_CHAT_MEMORY_DATABASE_URL';

@Injectable()
export class ResearchChatMemoryRepository implements OnModuleDestroy {
  private readonly memories = new Map<string, ResearchChatMemoryRef[]>();
  private readonly pool?: Pool;
  private schemaReady: Promise<void> | null = null;
  private dbUnavailable = false;

  constructor(
    @Optional()
    @Inject(RESEARCH_CHAT_MEMORY_DATABASE_URL)
    databaseUrl?: string,
  ) {
    const resolvedDatabaseUrl = databaseUrl ?? process.env.DATABASE_URL;
    if (resolvedDatabaseUrl?.trim()) {
      this.pool = new Pool({ connectionString: resolvedDatabaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async recall(
    workspaceId: string,
    symbol: string,
    message: string,
  ): Promise<ResearchChatMemoryRef[]> {
    const dbRows = await this.recallFromDb(workspaceId, symbol, message);
    if (dbRows) {
      return dbRows;
    }

    const terms = searchTerms(symbol, message);
    return (this.memories.get(workspaceId) ?? [])
      .map((memory) => ({
        ...memory,
        relevance: relevanceFor(memory.content, terms),
      }))
      .filter((memory) => memory.relevance >= 0.35)
      .sort((left, right) => right.relevance - left.relevance)
      .slice(0, 5);
  }

  async save(input: SaveResearchMemoryInput): Promise<ResearchChatMemoryRef> {
    const memory: ResearchChatMemoryRef = {
      id: `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: input.symbol ? `${input.symbol} memory` : 'Workspace memory',
      content: input.content,
      category: input.category,
      relevance: 1,
    };

    const saved = await this.saveToDb(input, memory);
    if (saved) {
      return saved;
    }

    this.memories.set(input.workspaceId, [
      memory,
      ...(this.memories.get(input.workspaceId) ?? []),
    ].slice(0, 100));
    return memory;
  }

  private async recallFromDb(
    workspaceId: string,
    symbol: string,
    message: string,
  ): Promise<ResearchChatMemoryRef[] | null> {
    if (!this.pool || this.dbUnavailable) {
      return null;
    }

    try {
      await this.ensureSchema();
      const result = await this.pool.query<MemoryRow>(
        `
        SELECT id, workspace_id, user_id, symbol, content, category
        FROM research_chat_memories
        WHERE workspace_id = $1 AND (symbol IS NULL OR symbol = $2)
        ORDER BY created_at DESC
        LIMIT 50
        `,
        [workspaceId, symbol],
      );
      const terms = searchTerms(symbol, message);
      const memories = result.rows
        .map((row) => toMemoryRef(row, relevanceFor(row.content, terms)))
        .filter((memory) => memory.relevance >= 0.35)
        .sort((left, right) => right.relevance - left.relevance)
        .slice(0, 5);

      if (memories.length > 0) {
        await this.pool.query(
          `
          UPDATE research_chat_memories
          SET last_used_at = now(), use_count = use_count + 1
          WHERE workspace_id = $1 AND id = ANY($2)
          `,
          [workspaceId, memories.map((memory) => memory.id)],
        );
      }
      return memories;
    } catch {
      this.dbUnavailable = true;
      return null;
    }
  }

  private async saveToDb(
    input: SaveResearchMemoryInput,
    memory: ResearchChatMemoryRef,
  ): Promise<ResearchChatMemoryRef | null> {
    if (!this.pool || this.dbUnavailable) {
      return null;
    }

    try {
      await this.ensureSchema();
      await this.pool.query(
        `
        INSERT INTO research_chat_memories
          (id, workspace_id, user_id, symbol, content, category)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          memory.id,
          input.workspaceId,
          input.userId,
          input.symbol ?? null,
          input.content,
          input.category,
        ],
      );
      return memory;
    } catch {
      this.dbUnavailable = true;
      return null;
    }
  }

  private async ensureSchema(): Promise<void> {
    if (!this.pool) {
      return;
    }
    this.schemaReady ??= this.pool.query(MEMORY_SCHEMA_SQL).then(() => undefined);
    await this.schemaReady;
  }
}

function toMemoryRef(row: MemoryRow, relevance: number): ResearchChatMemoryRef {
  return {
    id: row.id,
    label: row.symbol ? `${row.symbol} memory` : 'Workspace memory',
    content: row.content,
    category: row.category,
    relevance,
  };
}

function searchTerms(symbol: string, message: string): string[] {
  return `${symbol} ${message}`
    .toLowerCase()
    .split(/[^a-z0-9/]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

function relevanceFor(content: string, terms: string[]): number {
  const normalized = content.toLowerCase();
  const hits = terms.filter((term) => normalized.includes(term)).length;
  if (hits === 0) {
    return 0.2;
  }
  return Math.min(1, 0.35 + hits / Math.max(terms.length, 1));
}
