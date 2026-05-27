import { JsonRecord } from '../database/journal.types';

export class ContinuityDeltaEngine {
  compute(snapshot: JsonRecord, previousState: JsonRecord | null): JsonRecord[] {
    const events: JsonRecord[] = [];
    const currentView = recordValue(snapshot.symbol_view);
    if (!previousState) {
      events.push({
        event_type: 'baseline_initialized',
        severity: 'medium',
        from: null,
        to: currentView,
        item_key: null,
        reason: 'First valid research snapshot initialized continuity state.',
      });
      events.push({
        event_type: 'view_observed',
        severity: 'low',
        from: null,
        to: currentView,
        item_key: null,
        reason: 'Initial symbol view recorded for continuity tracking.',
      });
      for (const item of arrayRecords(snapshot.tracked_items)) {
        events.push(itemAddedEvent(item));
      }
      return events;
    }

    const previousView = recordValue(previousState.current_view);
    const changedView = changedFields(previousView, currentView, [
      'directional_bias',
      'risk_posture',
      'conviction',
      'time_context',
    ]);
    if (changedView.length > 0) {
      events.push({
        event_type: 'view_changed',
        severity: changedView.includes('directional_bias') ? 'medium' : 'low',
        from: pickFields(previousView, changedView),
        to: pickFields(currentView, changedView),
        item_key: null,
        reason: `Symbol view changed: ${changedView.join(', ')}.`,
      });
    } else {
      events.push({
        event_type: 'view_observed',
        severity: 'low',
        from: previousView,
        to: currentView,
        item_key: null,
        reason: 'Top-level symbol view remained stable.',
      });
    }

    const previousItems = byItemKey(arrayRecords(previousState.active_items));
    const currentItems = byItemKey(arrayRecords(snapshot.tracked_items));
    for (const [itemKey, item] of currentItems) {
      if (!previousItems.has(itemKey)) {
        events.push(itemAddedEvent(item));
        continue;
      }
      events.push(itemCarriedEvent(item));
    }
    for (const [itemKey, item] of previousItems) {
      if (currentItems.has(itemKey)) {
        continue;
      }
      events.push(itemResolvedEvent(item));
    }

    const previousQuality = recordValue(previousState.data_quality);
    const currentQuality = recordValue(snapshot.data_quality);
    if (
      stringValue(previousQuality.status) !== stringValue(currentQuality.status) ||
      String(previousQuality.score ?? '') !== String(currentQuality.score ?? '')
    ) {
      events.push({
        event_type: 'data_quality_changed',
        severity: stringValue(currentQuality.status) === 'clean' ? 'low' : 'medium',
        from: previousQuality,
        to: currentQuality,
        item_key: null,
        reason: 'Snapshot data quality changed.',
      });
    }
    return events;
  }
}

function itemAddedEvent(item: JsonRecord): JsonRecord {
  const type = stringValue(item.type, 'claim');
  const eventType =
    type === 'risk'
      ? 'risk_added'
      : type === 'watchpoint'
        ? 'watchpoint_added'
        : type === 'level'
          ? 'level_added'
          : type === 'invalidation'
            ? 'invalidation_added'
            : 'claim_added';
  return {
    event_type: eventType,
    severity: type === 'risk' || type === 'invalidation' ? 'medium' : 'low',
    from: null,
    to: item,
    item_key: stringValue(item.item_key),
    reason: stringValue(item.text, 'New tracked item observed.'),
  };
}

function itemCarriedEvent(item: JsonRecord): JsonRecord {
  const type = stringValue(item.type, 'claim');
  const eventType =
    type === 'risk'
      ? 'risk_reinforced'
      : type === 'watchpoint'
        ? 'watchpoint_carried'
        : type === 'claim'
          ? 'claim_reinforced'
          : 'view_observed';
  return {
    event_type: eventType,
    severity: 'low',
    from: item,
    to: item,
    item_key: stringValue(item.item_key),
    reason: stringValue(item.text, 'Tracked item carried forward.'),
  };
}

function itemResolvedEvent(item: JsonRecord): JsonRecord {
  const type = stringValue(item.type, 'claim');
  const eventType =
    type === 'risk'
      ? 'risk_resolved'
      : type === 'watchpoint'
        ? 'watchpoint_resolved'
        : type === 'level'
          ? 'level_invalidated'
          : type === 'claim'
            ? 'claim_weakened'
            : 'claim_weakened';
  return {
    event_type: eventType,
    severity: type === 'risk' || type === 'level' ? 'medium' : 'low',
    from: item,
    to: null,
    item_key: stringValue(item.item_key),
    reason: stringValue(item.text, 'Tracked item did not appear in the current snapshot.'),
  };
}

function changedFields(
  previousView: JsonRecord,
  currentView: JsonRecord,
  fields: string[],
): string[] {
  return fields.filter(
    (field) => stringValue(previousView[field]) !== stringValue(currentView[field]),
  );
}

function pickFields(source: JsonRecord, fields: string[]): JsonRecord {
  const picked: JsonRecord = {};
  for (const field of fields) {
    picked[field] = source[field] ?? null;
  }
  return picked;
}

function byItemKey(items: JsonRecord[]): Map<string, JsonRecord> {
  const result = new Map<string, JsonRecord>();
  for (const item of items) {
    const key = stringValue(item.item_key);
    if (key) {
      result.set(key, item);
    }
  }
  return result;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}
