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

    const previousItems = arrayRecords(previousState.active_items);
    const currentItems = arrayRecords(snapshot.tracked_items);
    const previousByKey = byItemKey(previousItems);
    const matchedPreviousKeys = new Set<string>();
    const matchedCurrentKeys = new Set<string>();

    for (const item of currentItems) {
      const match = findPreviousItem(item, previousByKey, matchedPreviousKeys);
      const itemKey = stringValue(item.item_key);
      if (!match) {
        events.push(itemAddedEvent(item));
        if (itemKey) {
          matchedCurrentKeys.add(itemKey);
        }
        continue;
      }
      matchedPreviousKeys.add(match.key);
      if (itemKey) {
        matchedCurrentKeys.add(itemKey);
      }
      const update = itemUpdateEvent(match.item, item);
      events.push(update ?? itemCarriedEvent(match.item, item));
    }

    for (const item of previousItems) {
      const itemKey = stringValue(item.item_key);
      const legacyKey = stringValue(item.legacy_item_key);
      if (
        (itemKey && matchedPreviousKeys.has(itemKey)) ||
        (legacyKey && matchedCurrentKeys.has(legacyKey))
      ) {
        continue;
      }
      events.push(itemResolvedEvent(item));
    }

    const previousQuality = recordValue(previousState.data_quality);
    const currentQuality = recordValue(snapshot.data_quality);
    if (
      stringValue(previousQuality.status) !== stringValue(currentQuality.status) ||
      String(previousQuality.score ?? '') !== String(currentQuality.score ?? '') ||
      String(previousQuality.source_coverage ?? '') !==
        String(currentQuality.source_coverage ?? '') ||
      String(previousQuality.evidence_coverage ?? '') !==
        String(currentQuality.evidence_coverage ?? '')
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

function findPreviousItem(
  currentItem: JsonRecord,
  previousByKey: Map<string, JsonRecord>,
  matchedPreviousKeys: Set<string>,
): { key: string; item: JsonRecord } | null {
  const candidateKeys = [
    stringValue(currentItem.item_key),
    stringValue(currentItem.legacy_item_key),
  ].filter(Boolean);
  for (const key of candidateKeys) {
    if (matchedPreviousKeys.has(key)) {
      continue;
    }
    const item = previousByKey.get(key);
    if (item) {
      return { key, item };
    }
  }
  for (const [key, item] of previousByKey) {
    if (matchedPreviousKeys.has(key)) {
      continue;
    }
    if (
      stringValue(item.legacy_item_key) &&
      stringValue(item.legacy_item_key) === stringValue(currentItem.item_key)
    ) {
      return { key, item };
    }
  }
  return null;
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
    source: sourcePayload(item),
  };
}

function itemCarriedEvent(previousItem: JsonRecord, currentItem: JsonRecord): JsonRecord {
  const type = stringValue(currentItem.type, 'claim');
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
    from: previousItem,
    to: currentItem,
    item_key: stringValue(currentItem.item_key),
    reason: stringValue(currentItem.text, 'Tracked item carried forward.'),
    source: sourcePayload(currentItem),
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

function itemUpdateEvent(previousItem: JsonRecord, currentItem: JsonRecord): JsonRecord | null {
  const changedFields: string[] = [];
  if (stringValue(previousItem.text) !== stringValue(currentItem.text)) {
    changedFields.push('text');
  }
  if (
    stringValue(previousItem.canonical_text) !==
    stringValue(currentItem.canonical_text)
  ) {
    changedFields.push('canonical_text');
  }
  const changedAttributes = changedAttributeValues(
    recordValue(previousItem.attributes),
    recordValue(currentItem.attributes),
  );
  changedFields.push(
    ...Object.keys(changedAttributes).map((key) => `attributes.${key}`),
  );
  if (evidenceSummary(previousItem) !== evidenceSummary(currentItem)) {
    changedFields.push('evidence');
  }
  if (changedFields.length === 0) {
    return null;
  }
  const type = stringValue(currentItem.type, 'claim');
  const eventType =
    type === 'risk'
      ? 'risk_updated'
      : type === 'watchpoint'
        ? 'watchpoint_updated'
        : type === 'level'
          ? 'level_updated'
          : type === 'invalidation'
            ? 'invalidation_updated'
            : 'claim_updated';
  return {
    event_type: eventType,
    severity: type === 'claim' || type === 'watchpoint' ? 'low' : 'medium',
    from: previousItem,
    to: currentItem,
    item_key: stringValue(currentItem.item_key),
    changed_fields: changedFields,
    changed_attributes: changedAttributes,
    previous_text: stringValue(
      previousItem.current_text ?? previousItem.text,
      'Previous tracked item text unavailable.',
    ),
    current_text: stringValue(currentItem.text),
    source: sourcePayload(currentItem),
    reason: `${labelForType(type)} updated: ${stringValue(currentItem.text)}`,
  };
}

function changedAttributeValues(
  previousAttributes: JsonRecord,
  currentAttributes: JsonRecord,
): JsonRecord {
  const result: JsonRecord = {};
  const keys = new Set([
    ...Object.keys(previousAttributes),
    ...Object.keys(currentAttributes),
  ]);
  for (const key of keys) {
    const from = previousAttributes[key] ?? null;
    const to = currentAttributes[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      result[key] = { from, to };
    }
  }
  return result;
}

function evidenceSummary(item: JsonRecord): string {
  return JSON.stringify(arrayValues(item.evidence).map(stableEvidenceValue).sort());
}

function stableEvidenceValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return stringValue(value);
}

function sourcePayload(item: JsonRecord): JsonRecord {
  return {
    source_artifact: item.source_artifact ?? null,
    source_id: item.source_id ?? null,
    source_field: item.source_field ?? null,
  };
}

function labelForType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
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

function arrayValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => stringValue(item))
    .filter(Boolean);
}

function stringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}
