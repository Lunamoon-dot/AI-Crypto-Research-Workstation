import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';

type SqliteRow = Record<string, unknown>;
export type ExportedJournal = Record<string, SqliteRow[]>;

export interface SqliteJournalSyncResult {
  run_id: string;
  workspace_id: string;
  sqlite_path: string;
  tables: Record<string, number>;
}

interface SyncContext {
  runId: string;
  workspaceId: string;
}

interface TableSyncConfig {
  table: string;
  columns: string[];
  jsonColumns?: string[];
  sourceColumns?: Record<string, string>;
  defaults?: (row: SqliteRow, context: SyncContext) => Record<string, unknown>;
}

const SYNC_TABLES: TableSyncConfig[] = [
  {
    table: 'research_runs',
    columns: [
      'id',
      'workspace_id',
      'symbol',
      'asset_class',
      'timeframe',
      'status',
      'started_at',
      'completed_at',
      'deep_think_model',
      'quick_think_model',
      'llm_provider',
      'config_hash',
      'market_snapshot_id',
      'signal_snapshot_id',
      'debate_id',
      'thesis_id',
      'decision_id',
      'user_decision_id',
      'outcome_review_id',
      'degradation_reasons_json',
      'missing_core_data_json',
      'missing_optional_data_json',
      'payload_json',
    ],
    jsonColumns: [
      'degradation_reasons_json',
      'missing_core_data_json',
      'missing_optional_data_json',
      'payload_json',
    ],
    defaults: (_row, context) => ({
      workspace_id: context.workspaceId,
      degradation_reasons_json: [],
      missing_core_data_json: [],
      missing_optional_data_json: [],
      payload_json: {},
    }),
  },
  {
    table: 'market_snapshots',
    columns: [
      'id',
      'workspace_id',
      'research_run_id',
      'symbol',
      'captured_at',
      'current_price',
      'source',
      'source_timestamp',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'signals',
    columns: [
      'id',
      'workspace_id',
      'symbol',
      'signal_type',
      'direction',
      'confidence',
      'observed_at',
      'source',
      'source_timestamp',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'signal_snapshots',
    columns: [
      'id',
      'workspace_id',
      'research_run_id',
      'symbol',
      'captured_at',
      'composite_signal_id',
      'signal_count',
      'bullish_count',
      'bearish_count',
      'neutral_count',
      'stale_count',
      'unknown_freshness_count',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'debates',
    columns: [
      'id',
      'workspace_id',
      'research_run_id',
      'symbol',
      'consensus_stance',
      'conflict_level',
      'created_at',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'agent_opinions',
    columns: [
      'id',
      'workspace_id',
      'debate_id',
      'research_run_id',
      'agent_name',
      'agent_role',
      'stance',
      'confidence',
      'created_at',
      'payload_json',
    ],
    sourceColumns: { agent_role: 'role' },
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'trade_theses',
    columns: [
      'id',
      'workspace_id',
      'research_run_id',
      'symbol',
      'direction',
      'setup_type',
      'confidence',
      'created_at',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'scenarios',
    columns: [
      'id',
      'workspace_id',
      'thesis_id',
      'probability_band',
      'suggested_user_action',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'user_decisions',
    columns: ['id', 'thesis_id', 'action', 'decided_at', 'user_notes', 'payload_json'],
    jsonColumns: ['payload_json'],
    defaults: () => ({ payload_json: {} }),
  },
  {
    table: 'outcome_reviews',
    columns: ['id', 'thesis_id', 'result', 'reviewed_at', 'invalidated', 'payload_json'],
    jsonColumns: ['payload_json'],
    defaults: () => ({ invalidated: 0, payload_json: {} }),
  },
  {
    table: 'run_events',
    columns: [
      'id',
      'workspace_id',
      'research_run_id',
      'thesis_id',
      'event_type',
      'created_at',
      'message',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: (_row, context) => ({ workspace_id: context.workspaceId, payload_json: {} }),
  },
  {
    table: 'llm_calls',
    columns: [
      'id',
      'research_run_id',
      'thesis_id',
      'provider',
      'model',
      'stage',
      'agent',
      'input_tokens',
      'output_tokens',
      'latency_ms',
      'status',
      'error_type',
      'error_message',
      'created_at',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: () => ({ input_tokens: 0, output_tokens: 0, payload_json: {} }),
  },
  {
    table: 'data_freshness_checks',
    columns: [
      'id',
      'research_run_id',
      'symbol',
      'source',
      'source_timestamp',
      'observed_timestamp',
      'age_seconds',
      'threshold_seconds',
      'status',
      'payload_json',
    ],
    jsonColumns: ['payload_json'],
    defaults: () => ({ payload_json: {} }),
  },
];

@Injectable()
export class SqliteJournalSyncService implements OnModuleDestroy {
  private readonly pool?: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async syncRun(
    runId: string,
    workspaceId: string,
  ): Promise<SqliteJournalSyncResult | null> {
    if (
      process.env.JOURNAL_POSTGRES_SYNC === '0' ||
      process.env.INLINE_JOURNAL_SYNC === '0'
    ) {
      return null;
    }
    if (!this.pool) {
      return null;
    }

    const sqlitePath = resolveSqlitePath();
    const exported = await this.exportRun(runId);
    if (!exported) {
      throw new Error(`Run ${runId} was not found in SQLite journal ${sqlitePath}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const counts: Record<string, number> = {};
      const context = { runId, workspaceId };
      for (const config of SYNC_TABLES) {
        const rows = exported[config.table] ?? [];
        counts[config.table] = rows.length;
        for (const row of rows) {
          await upsertRow(client, config, row, context);
        }
      }
      await client.query('COMMIT');
      return {
        run_id: runId,
        workspace_id: workspaceId,
        sqlite_path: sqlitePath,
        tables: counts,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async exportRun(runId: string): Promise<ExportedJournal | null> {
    const sqlitePath = resolveSqlitePath();
    if (!existsSync(sqlitePath)) {
      return null;
    }

    const exported = await exportSqliteRun(sqlitePath, runId);
    if (!exported.research_runs?.length) {
      return null;
    }
    return exported;
  }

  async exportThesis(thesisId: string): Promise<ExportedJournal | null> {
    const sqlitePath = resolveSqlitePath();
    if (!existsSync(sqlitePath)) {
      return null;
    }

    const exported = await exportSqliteThesis(sqlitePath, thesisId);
    if (!exported.trade_theses?.length) {
      return null;
    }
    return exported;
  }
}

async function exportSqliteRun(
  sqlitePath: string,
  runId: string,
): Promise<ExportedJournal> {
  return exportSqliteJournal(sqlitePath, [runId]);
}

async function exportSqliteThesis(
  sqlitePath: string,
  thesisId: string,
): Promise<ExportedJournal> {
  return exportSqliteJournal(sqlitePath, ['--thesis', thesisId]);
}

async function exportSqliteJournal(
  sqlitePath: string,
  args: string[],
): Promise<ExportedJournal> {
  const command = resolvePythonSyncCommand();
  const scriptPath = resolveExportScriptPath();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [scriptPath, sqlitePath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `SQLite export exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ExportedJournal);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function upsertRow(
  client: PoolClient,
  config: TableSyncConfig,
  row: SqliteRow,
  context: SyncContext,
): Promise<void> {
  const jsonColumns = new Set(config.jsonColumns ?? []);
  const defaults = config.defaults?.(row, context) ?? {};
  const values = config.columns.map((column) =>
    valueForColumn(row, column, config, defaults),
  );
  const placeholders = config.columns.map(
    (column, index) => `$${index + 1}${jsonColumns.has(column) ? '::jsonb' : ''}`,
  );
  const updates = config.columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');

  await client.query(
    `INSERT INTO ${config.table} (${config.columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values.map((value, index) =>
      jsonColumns.has(config.columns[index]) ? normalizeJson(value) : value,
    ),
  );
}

function valueForColumn(
  row: SqliteRow,
  column: string,
  config: TableSyncConfig,
  defaults: Record<string, unknown>,
): unknown {
  const sourceColumn = config.sourceColumns?.[column] ?? column;
  if (row[sourceColumn] !== undefined) {
    return row[sourceColumn];
  }
  if (row[column] !== undefined) {
    return row[column];
  }
  if (defaults[column] !== undefined) {
    return defaults[column];
  }
  return null;
}

function normalizeJson(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '{}';
  }
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify({ raw: value });
    }
  }
  return JSON.stringify(value);
}

function resolveExportScriptPath(): string {
  const configured = process.env.SQLITE_JOURNAL_EXPORT_SCRIPT?.trim();
  if (configured) {
    if (existsSync(configured)) {
      return configured;
    }
    throw new Error(`Configured SQLite export script was not found at ${configured}`);
  }

  const candidates = unique([
    join(process.cwd(), 'apps', 'api', 'scripts', 'export-sqlite-journal.py'),
    join(process.cwd(), 'scripts', 'export-sqlite-journal.py'),
    join(__dirname, '..', '..', 'scripts', 'export-sqlite-journal.py'),
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'apps',
      'api',
      'scripts',
      'export-sqlite-journal.py',
    ),
  ]);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }
  throw new Error(
    `SQLite export script not found. Checked: ${candidates.join(', ')}`,
  );
}

function resolvePythonSyncCommand(): string {
  const configured = process.env.PYTHON_SYNC_COMMAND?.trim();
  if (configured) {
    return configured;
  }

  const executable = process.platform === 'win32' ? 'python.exe' : 'python';
  const candidates = unique([
    resolve(process.cwd(), '.venv', binDir(), executable),
    resolve(process.cwd(), '..', '..', '.venv', binDir(), executable),
    resolve(__dirname, '..', '..', '..', '..', '..', '.venv', binDir(), executable),
    resolve(__dirname, '..', '..', '..', '..', '.venv', binDir(), executable),
    process.platform === 'win32' ? 'py' : 'python3',
    executable,
  ]);
  return (
    candidates.find((candidate) => isHealthyExecutable(candidate, ['--version'])) ??
    executable
  );
}

function isHealthyExecutable(command: string, args: string[]): boolean {
  if (command.includes('\\') || command.includes('/')) {
    if (!existsSync(command)) {
      return false;
    }
  }
  const result = spawnSync(command, args, {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

function binDir(): string {
  return process.platform === 'win32' ? 'Scripts' : 'bin';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveSqlitePath(): string {
  return (
    process.env.TRADINGAGENTS_JOURNAL_DB ??
    join(homedir(), '.luna_workstation', 'cache', 'research_journal.sqlite')
  );
}
