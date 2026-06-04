import { mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { JsonRecord } from '../database/journal.types';

export interface ContinuityMarkdownArtifact {
  kind: 'continuity_report';
  label: string;
  path: string | null;
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}

export interface ContinuityMarkdownExportInput {
  entry: JsonRecord;
  run: JsonRecord;
}

export interface ContinuityMarkdownExportPort {
  export(input: ContinuityMarkdownExportInput): Promise<ContinuityMarkdownArtifact>;
}

export class NoopContinuityMarkdownExporter implements ContinuityMarkdownExportPort {
  async export(): Promise<ContinuityMarkdownArtifact> {
    return emptyContinuityMarkdownArtifact();
  }
}

export class ContinuityMarkdownExporter implements ContinuityMarkdownExportPort {
  async export(
    input: ContinuityMarkdownExportInput,
  ): Promise<ContinuityMarkdownArtifact> {
    const path = continuityReportPath(input.entry, input.run);
    const markdown = renderContinuityMarkdown(input.entry);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, markdown, 'utf8');
    const stats = await stat(path);
    return {
      kind: 'continuity_report',
      label: 'Continuity report',
      path,
      exists: true,
      size_bytes: stats.size,
      modified_at: stats.mtime.toISOString(),
    };
  }
}

export function emptyContinuityMarkdownArtifact(): ContinuityMarkdownArtifact {
  return {
    kind: 'continuity_report',
    label: 'Continuity report',
    path: null,
    exists: false,
    size_bytes: null,
    modified_at: null,
  };
}

function renderContinuityMarkdown(entry: JsonRecord): string {
  const lines = [
    '# Research Continuity Report',
    '',
    metadataLine('Symbol', entry.symbol),
    metadataLine('Run', entry.research_run_id),
    metadataLine('Entry', entry.id),
    metadataLine('Type', entry.entry_type),
    metadataLine('Status', entry.status),
    metadataLine('Generated', entry.generated_at),
    '',
  ].filter((line) => line !== null) as string[];

  for (const section of arrayRecords(entry.sections)) {
    const title = stringValue(section.title, 'Untitled');
    lines.push(`## ${title}`, '');
    const items = stringList(section.items);
    if (items.length === 0) {
      lines.push(stringValue(section.empty_state, 'No data available.'), '');
      continue;
    }
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function metadataLine(label: string, value: unknown): string | null {
  const text = nullableString(value);
  return text ? `**${label}:** ${text}` : null;
}

function continuityReportPath(entry: JsonRecord, run: JsonRecord): string {
  return join(
    resolveResultsDir(),
    reportTickerComponent(stringValue(entry.symbol, stringValue(run.symbol, 'unknown'))),
    researchDateComponent(run),
    'continuity_report.md',
  );
}

function resolveResultsDir(): string {
  const configured = process.env.TRADINGAGENTS_RESULTS_DIR?.trim();
  return configured
    ? resolve(configured)
    : join(homedir(), '.luna_workstation', 'logs');
}

function researchDateComponent(run: JsonRecord): string {
  const raw =
    nullableString(run.timeframe) ??
    nullableString(run.analysis_date) ??
    nullableString(run.trade_date) ??
    datePart(nullableString(run.completed_at)) ??
    datePart(nullableString(run.started_at));
  const date = datePart(raw) ?? 'unknown';
  return date.replace(/[^0-9-]/g, '_') || 'unknown';
}

function datePart(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function reportTickerComponent(symbol: string): string {
  const trimmed = symbol.trim();
  if (!trimmed || trimmed.includes('..')) {
    return 'unknown';
  }
  const sanitized = trimmed
    .replace(/[\\/:]/g, '-')
    .replace(/[^A-Za-z0-9._\-\^]/g, '_')
    .slice(0, 64);
  return sanitized && !/^[.]+$/.test(sanitized) ? sanitized : 'unknown';
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = nullableString(value);
    return text ? [text] : [];
  }
  return value
    .map((item) => nullableString(item))
    .filter((item): item is string => Boolean(item));
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}
