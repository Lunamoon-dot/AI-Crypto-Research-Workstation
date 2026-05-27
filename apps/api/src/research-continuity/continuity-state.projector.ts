import { JsonRecord } from '../database/journal.types';

export class ContinuityStateProjector {
  project(
    previousState: JsonRecord | null,
    snapshot: JsonRecord | null,
    entry: JsonRecord,
    events: JsonRecord[],
  ): JsonRecord | null {
    if (entry.entry_type === 'skipped' || !snapshot) {
      return null;
    }
    const quality = recordValue(entry.snapshot_quality ?? snapshot.data_quality);
    const cleanEntry = entry.entry_type === 'baseline' || entry.entry_type === 'delta';
    const canUpdateTopLevelView =
      cleanEntry || booleanValue(quality.can_update_top_level_view);
    const canUpdateItems = cleanEntry || numberValue(quality.score) >= 0.65;
    const currentView = canUpdateTopLevelView
      ? recordValue(snapshot.symbol_view)
      : recordValue(previousState?.current_view);
    const activeItems = canUpdateItems
      ? arrayRecords(snapshot.tracked_items)
      : arrayRecords(previousState?.active_items);
    const resolved = events
      .filter((event) =>
        ['risk_resolved', 'watchpoint_resolved', 'claim_weakened'].includes(
          stringValue(event.event_type),
        ),
      )
      .map((event) => recordValue(event.from))
      .filter((item) => Object.keys(item).length > 0);
    const invalidated = events
      .filter((event) => stringValue(event.event_type) === 'level_invalidated')
      .map((event) => recordValue(event.from))
      .filter((item) => Object.keys(item).length > 0);
    return {
      id:
        nullableString(previousState?.id) ??
        `continuity_state_${safeId(stringValue(entry.symbol))}`,
      workspace_id: stringValue(entry.workspace_id, 'local'),
      symbol: stringValue(entry.symbol),
      current_snapshot_id: nullableString(entry.current_snapshot_id),
      latest_entry_id: nullableString(entry.id),
      latest_run_id: nullableString(entry.research_run_id),
      current_view: currentView,
      active_items: activeItems,
      recent_resolved_items: [...resolved, ...arrayRecords(previousState?.recent_resolved_items)].slice(0, 20),
      recent_invalidated_items: [
        ...invalidated,
        ...arrayRecords(previousState?.recent_invalidated_items),
      ].slice(0, 20),
      data_quality: quality,
      updated_at: stringValue(entry.generated_at, new Date().toISOString()),
      payload: {
        schema_version: 'research_continuity_state.v1',
        last_entry_type: stringValue(entry.entry_type),
        last_status: stringValue(entry.status),
      },
    };
  }
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
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

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return String(value).toLowerCase() === 'true';
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}
