import type {
  CompiledThesisSectionResponse,
  JsonRecord,
  ThesisResponse,
  ThesisSummaryResponse,
  ThesisValidationIssueResponse,
} from '../types';

type ThesisLike = Partial<ThesisResponse> & {
  summary?: Partial<ThesisSummaryResponse> | null;
};

export function normalizeThesisResponse(thesis: ThesisLike): ThesisResponse {
  const summary = normalizeThesisSummary(thesis.summary);
  return {
    ...(thesis as ThesisResponse),
    thesis_text: stringValue(thesis.thesis_text),
    stability_guard: recordValue(thesis.stability_guard),
    target_zones: stringArray(thesis.target_zones),
    profit_targets: stringArray(thesis.profit_targets),
    downside_objectives: stringArray(thesis.downside_objectives),
    accumulation_zones: stringArray(thesis.accumulation_zones),
    indicator_thresholds: stringArray(thesis.indicator_thresholds),
    supporting_signal_ids: stringArray(thesis.supporting_signal_ids),
    contradicting_signal_ids: stringArray(thesis.contradicting_signal_ids),
    stale_or_missing_data: stringArray(thesis.stale_or_missing_data),
    monitor_next: stringArray(thesis.monitor_next),
    compiled_sections: objectArray(thesis.compiled_sections) as unknown as CompiledThesisSectionResponse[],
    validation_issues: objectArray(thesis.validation_issues) as unknown as ThesisValidationIssueResponse[],
    degradation_reasons: stringArray(thesis.degradation_reasons),
    blocked_reasons: stringArray(thesis.blocked_reasons),
    summary,
  };
}

function normalizeThesisSummary(input: ThesisLike['summary']): ThesisSummaryResponse {
  const summary = recordValue(input);
  return {
    ...(summary as unknown as ThesisSummaryResponse),
    rating: stringValue(summary.rating, 'Hold'),
    direction: stringValue(summary.direction, 'watch'),
    confidence: nullableNumber(summary.confidence),
    market_type: stringValue(summary.market_type, 'spot'),
    action_summary: stringValue(summary.action_summary),
    recommended_action: stringValue(summary.recommended_action),
    market_bias: stringValue(summary.market_bias),
    entry_plan_status: stringValue(summary.entry_plan_status),
    confirmation_condition: stringValue(summary.confirmation_condition),
    entry_zone: stringValue(summary.entry_zone),
    upside_catalyst: stringValue(summary.upside_catalyst),
    invalidation: stringValue(summary.invalidation),
    target_zones: stringArray(summary.target_zones),
    profit_targets: stringArray(summary.profit_targets),
    downside_objectives: stringArray(summary.downside_objectives),
    accumulation_zones: stringArray(summary.accumulation_zones),
    indicator_thresholds: stringArray(summary.indicator_thresholds),
    key_reasons: stringArray(summary.key_reasons),
    risks: stringArray(summary.risks),
    spot_notes: stringValue(summary.spot_notes),
    perp_notes: stringValue(summary.perp_notes),
    missing_data: stringArray(summary.missing_data),
    missing_data_reason_codes: stringArray(summary.missing_data_reason_codes),
    data_quality: nullableNumber(summary.data_quality),
    data_quality_label: stringValue(summary.data_quality_label, 'unknown'),
    is_degraded: Boolean(summary.is_degraded),
    degradation_reasons: stringArray(summary.degradation_reasons),
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item).trim())
      .filter(Boolean);
  }
  const text = stringValue(value).trim();
  return text ? [text] : [];
}

function objectArray(value: unknown): JsonRecord[] {
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
  return typeof value === 'string' ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
